import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { useOrderChatUnread } from "../hooks/use-order-chat-unread";
import { parseMoneyInput } from "../lib/finance";
import { formatCurrency, formatDatabaseDate } from "../lib/tickets";
import { supabase } from "../lib/supabase";

type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "in_production"
  | "ready_for_delivery"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

type OrderListItem = {
  id: string;
  order_number: number;
  status: OrderStatus;
  quantity: number;
  total_cents: number;
  delivery_street: string;
  delivery_number: string;
  delivery_neighborhood: string;
  delivery_city: string;
  delivery_state: string;
  created_at: string;
  payment_provider: "stripe" | "pix" | "cash";
  payment_status: string;
  cash_change_for_cents?: number | null;
  stripe_checkout_session_id: string | null;
  assigned_courier_id: string | null;
  pix_payment_submissions:
    | { status: "pending" | "approved" | "rejected"; admin_note: string | null }
    | { status: "pending" | "approved" | "rejected"; admin_note: string | null }[]
    | null;
  ticket_drafts: {
    event_name: string;
    event_date: string;
    event_time: string;
    location: string;
    primary_color: string;
    accent_color: string;
    ticket_templates: { name: string } | null;
  } | null;
};

export default function OrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    payment?: string | string[];
    session_id?: string | string[];
  }>();
  const paymentResult = firstParam(params.payment);
  const returnedSessionId = firstParam(params.session_id);
  const { session } = useAuth();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isPayingOrderId, setIsPayingOrderId] = useState<string | null>(null);
  const [isPixEnabled, setIsPixEnabled] = useState(false);
  const [cashSettings, setCashSettings] = useState<{ is_enabled: boolean; max_order_cents: number } | null>(null);
  const [cashFormOrderId, setCashFormOrderId] = useState<string | null>(null);
  const [cashChangeInput, setCashChangeInput] = useState("");
  const [isChoosingCash, setIsChoosingCash] = useState(false);
  const unreadCounts = useOrderChatUnread(orders.map((order) => order.id));

  const loadOrders = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!session?.user.id) return;

    if (!silent) setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, quantity, total_cents, delivery_street, delivery_number, delivery_neighborhood, delivery_city, delivery_state, created_at, payment_provider, payment_status, stripe_checkout_session_id, assigned_courier_id, pix_payment_submissions(status, admin_note), ticket_drafts(event_name, event_date, event_time, location, primary_color, accent_color, ticket_templates(name))",
      )
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(
        "Não foi possível carregar seus pedidos. Confirme se o SQL da Etapa 6 foi executado.",
      );
    } else {
      const loadedOrders = (data ?? []) as unknown as OrderListItem[];

      // O troco fica em consulta separada: antes do SQL 017 a coluna nao existe
      // e uma falha aqui nao pode derrubar a lista de pedidos.
      const cashOrderIds = loadedOrders
        .filter((order) => order.payment_provider === "cash")
        .map((order) => order.id);

      if (cashOrderIds.length > 0) {
        const { data: cashRows } = await supabase
          .from("orders")
          .select("id, cash_change_for_cents")
          .in("id", cashOrderIds);

        for (const row of cashRows ?? []) {
          const target = loadedOrders.find((order) => order.id === row.id);
          if (target) target.cash_change_for_cents = row.cash_change_for_cents;
        }
      }

      setOrders(loadedOrders);

      const returnedOrder = returnedSessionId
        ? loadedOrders.find(
            (order) => order.stripe_checkout_session_id === returnedSessionId,
          )
        : null;

      if (paymentResult === "success" && returnedOrder?.status === "paid") {
        setPaymentMessage("Pagamento confirmado! Seu pedido já está marcado como pago.");
      }
    }

    const { data: pixSettings } = await supabase
      .from("pix_settings")
      .select("is_enabled")
      .eq("id", 1)
      .maybeSingle();
    setIsPixEnabled(Boolean(pixSettings?.is_enabled));

    // Se o SQL 017 ainda nao foi executado, a consulta falha e a opcao some.
    const { data: cashData } = await supabase
      .from("cash_settings")
      .select("is_enabled, max_order_cents")
      .eq("id", 1)
      .maybeSingle();
    setCashSettings(cashData ?? null);

    if (!silent) setIsLoading(false);
  };

  const handleChooseCash = async (order: OrderListItem) => {
    setPaymentError(null);
    setPaymentMessage(null);

    let changeForCents: number | null = null;
    if (cashChangeInput.trim()) {
      changeForCents = parseMoneyInput(cashChangeInput);

      if (changeForCents === null || changeForCents < order.total_cents) {
        setPaymentError(
          `Informe um valor igual ou maior que o total do pedido (${formatCurrency(order.total_cents)}), ou deixe em branco se não precisa de troco.`,
        );
        return;
      }
    }

    setIsChoosingCash(true);
    const { error } = await supabase.rpc("choose_cash_payment", {
      p_order_id: order.id,
      p_change_for_cents: changeForCents,
    });
    setIsChoosingCash(false);

    if (error) {
      setPaymentError(translateCashError(error.message));
      return;
    }

    setCashFormOrderId(null);
    setCashChangeInput("");
    setPaymentMessage(
      "Pagamento em dinheiro registrado. Aguarde o aceite do pedido; você pagará ao entregador na entrega.",
    );
    await loadOrders({ silent: true });
  };

  useEffect(() => {
    void loadOrders();
    // O carregamento deve ser repetido somente quando o usuário mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || !paymentResult) return;

    if (paymentResult === "cancelled") {
      setPaymentMessage("Pagamento cancelado. Nenhum valor foi cobrado e você pode tentar novamente.");
      return;
    }

    if (paymentResult !== "success") return;

    setPaymentMessage(
      "Pagamento recebido pelo Stripe. Estamos confirmando o status do pedido...",
    );

    const timers = [0, 1800, 4500, 8000].map((delay) =>
      setTimeout(() => void loadOrders({ silent: true }), delay),
    );

    return () => timers.forEach(clearTimeout);
    // A atualização precisa ocorrer quando o usuário retornar do Stripe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentResult, returnedSessionId, session?.user.id]);

  const handleStartPayment = async (orderId: string) => {
    setIsPayingOrderId(orderId);
    setPaymentError(null);
    setPaymentMessage(null);

    try {
      const returnUrl = Linking.createURL("/pedidos");
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-checkout",
        {
          body: {
            order_id: orderId,
            return_url: returnUrl,
          },
        },
      );

      if (error) {
        setPaymentError(
          "Não foi possível abrir o pagamento. Confirme a configuração da função Stripe no Supabase.",
        );
        return;
      }

      if (data?.already_paid) {
        setPaymentMessage("Este pedido já está pago.");
        await loadOrders({ silent: true });
        return;
      }

      const checkoutUrl = data?.checkout_url;

      if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://")) {
        setPaymentError("O Stripe não devolveu uma página de pagamento válida.");
        return;
      }

      if (Platform.OS === "web") {
        const webLocation = (
          globalThis as unknown as { location?: { assign: (url: string) => void } }
        ).location;

        if (webLocation) {
          webLocation.assign(checkoutUrl);
          return;
        }
      }

      await Linking.openURL(checkoutUrl);
    } catch {
      setPaymentError(
        "Não foi possível conectar ao Stripe. Verifique sua internet e tente novamente.",
      );
    } finally {
      setIsPayingOrderId(null);
    }
  };

  return (
    <ProtectedRoleScreen
      eyebrow="ACOMPANHAMENTO"
      requiredRole="client"
      subtitle="Consulte o valor, pagamento, produção e entrega dos seus ingressos físicos."
      title="Meus pedidos"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/cliente")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Área do cliente</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/catalogo")}
          style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
        >
          <Text style={styles.newButtonText}>+ Criar ingresso</Text>
        </Pressable>
      </View>

      {paymentMessage ? (
        <View accessibilityLiveRegion="polite" style={styles.paymentMessageCard}>
          <Text style={styles.paymentMessageText}>{paymentMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadOrders({ silent: true })}
            style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          >
            <Text style={styles.refreshButtonText}>Atualizar pedidos</Text>
          </Pressable>
        </View>
      ) : null}

      {paymentError ? (
        <View accessibilityLiveRegion="polite" style={styles.paymentErrorCard}>
          <Text style={styles.paymentErrorText}>{paymentError}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando pedidos...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.stateCard}>
          <Text style={styles.errorTitle}>Pedidos indisponíveis</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadOrders()}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>Nenhum pedido ainda</Text>
          <Text style={styles.stateText}>
            Finalize um rascunho para acompanhar o pedido nesta tela.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/rascunhos")}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Ver rascunhos</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {orders.map((order) => {
            const isCashPending =
              order.payment_provider === "cash" && order.payment_status === "on_delivery";
            const details = statusDetails(order.status, isCashPending);
            const draft = order.ticket_drafts;
            const pixSubmission = firstSubmission(order.pix_payment_submissions);
            const canChooseCash =
              Boolean(cashSettings?.is_enabled) &&
              order.total_cents <= (cashSettings?.max_order_cents ?? 0) &&
              pixSubmission?.status !== "pending";

            return (
              <View key={order.id} style={styles.orderCard}>
                <View
                  style={[
                    styles.ticketSide,
                    { backgroundColor: draft?.primary_color ?? "#071D2D" },
                  ]}
                >
                  <View
                    style={[
                      styles.accentLine,
                      { backgroundColor: draft?.accent_color ?? "#38D6D2" },
                    ]}
                  />
                  <Text style={styles.orderNumber}>
                    PEDIDO #{String(order.order_number).padStart(5, "0")}
                  </Text>
                  <Text numberOfLines={2} style={styles.eventName}>
                    {draft?.event_name ?? "Ingresso SeuChico"}
                  </Text>
                  {draft ? (
                    <Text style={styles.eventDate}>
                      {formatDatabaseDate(draft.event_date)} · {draft.event_time.slice(0, 5)}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.orderBody}>
                  <View style={styles.statusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: details.background }]}> 
                      <Text style={[styles.statusText, { color: details.color }]}>
                        {details.label}
                      </Text>
                    </View>
                    <Text style={styles.createdAt}>{formatCreatedAt(order.created_at)}</Text>
                  </View>

                  <View style={styles.infoGrid}>
                    <InfoItem label="MODELO" value={draft?.ticket_templates?.name ?? "SeuChico"} />
                    <InfoItem label="QUANTIDADE" value={`${order.quantity} unidades`} />
                    <InfoItem label="TOTAL" value={formatCurrency(order.total_cents)} strong />
                    <InfoItem
                      label="ENTREGA"
                      value={`${order.delivery_street}, ${order.delivery_number} · ${order.delivery_neighborhood} · ${order.delivery_city}/${order.delivery_state}`}
                      wide
                    />
                  </View>

                  {order.status === "awaiting_payment" ? (
                    <View style={styles.nextStepNotice}>
                      <Text style={styles.nextStepTitle}>
                        {isCashPending
                          ? "Dinheiro na entrega · aguardando aceite"
                          : pixSubmission?.status === "pending"
                            ? "Comprovante PIX em análise"
                            : pixSubmission?.status === "rejected"
                              ? "Comprovante PIX não aprovado"
                              : "Aguardando pagamento"}
                      </Text>
                      <Text style={styles.nextStepText}>
                        {isCashPending
                          ? `Você pagará ${formatCurrency(order.total_cents)} ao entregador.${cashChangeText(order)} A produção começa quando o pedido for aceito. Se preferir, ainda pode pagar por PIX ou cartão.`
                          : pixSubmission?.status === "pending"
                            ? "Aguarde a conferência do administrador. A produção ainda não foi iniciada."
                            : pixSubmission?.status === "rejected"
                              ? pixSubmission.admin_note || "Revise o pagamento e envie um novo comprovante."
                              : "Escolha PIX com comprovante, cartão pela página oficial do Stripe" +
                                (canChooseCash ? " ou pague em dinheiro na entrega." : ".")}
                      </Text>
                      {pixSubmission?.status === "pending" ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() =>
                            router.push({ pathname: "/pix", params: { order: order.id } })
                          }
                          style={({ pressed }) => [styles.pixButton, styles.pixButtonStandalone, pressed && styles.pressed]}
                        >
                          <Text style={styles.pixButtonText}>Ver pagamento PIX →</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.paymentButtons}>
                          {isPixEnabled ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() =>
                                router.push({ pathname: "/pix", params: { order: order.id } })
                              }
                              style={({ pressed }) => [styles.pixButton, pressed && styles.pressed]}
                            >
                              <Text style={styles.pixButtonText}>Pagar por PIX</Text>
                              <Text style={styles.pixButtonArrow}>→</Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            disabled={isPayingOrderId !== null}
                            onPress={() => void handleStartPayment(order.id)}
                            style={({ pressed }) => [
                              styles.payButton,
                              isPayingOrderId !== null && styles.disabled,
                              pressed && styles.pressed,
                            ]}
                          >
                            {isPayingOrderId === order.id ? (
                              <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : null}
                            <Text style={styles.payButtonText}>
                              {isPayingOrderId === order.id ? "Abrindo..." : "Pagar com cartão"}
                            </Text>
                          </Pressable>
                          {canChooseCash && !isCashPending ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => {
                                setCashChangeInput("");
                                setCashFormOrderId(cashFormOrderId === order.id ? null : order.id);
                              }}
                              style={({ pressed }) => [styles.cashButton, pressed && styles.pressed]}
                            >
                              <Text style={styles.cashButtonText}>Dinheiro na entrega</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      )}

                      {cashFormOrderId === order.id && canChooseCash && !isCashPending ? (
                        <View style={styles.cashForm}>
                          <Text style={styles.cashFormTitle}>Pagar em dinheiro na entrega</Text>
                          <Text style={styles.cashFormText}>
                            Total: {formatCurrency(order.total_cents)}. Pague direto ao entregador quando receber os ingressos. Se precisar de troco, diga com qual valor você vai pagar (opcional).
                          </Text>
                          <TextInput
                            accessibilityLabel="Valor com que vai pagar"
                            keyboardType="decimal-pad"
                            onChangeText={setCashChangeInput}
                            placeholder="Troco para R$ (ex.: 50,00)"
                            placeholderTextColor="#91A4AD"
                            style={styles.cashInput}
                            value={cashChangeInput}
                          />
                          <View style={styles.cashFormButtons}>
                            <Pressable
                              accessibilityRole="button"
                              disabled={isChoosingCash}
                              onPress={() => void handleChooseCash(order)}
                              style={({ pressed }) => [styles.cashConfirmButton, isChoosingCash && styles.disabled, pressed && styles.pressed]}
                            >
                              {isChoosingCash ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                              <Text style={styles.cashConfirmText}>{isChoosingCash ? "Registrando..." : "Confirmar dinheiro na entrega"}</Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setCashFormOrderId(null)}
                              style={({ pressed }) => [styles.cashCancelButton, pressed && styles.pressed]}
                            >
                              <Text style={styles.cashCancelText}>Cancelar</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {isCashPending && order.status !== "awaiting_payment" && order.status !== "delivered" && order.status !== "cancelled" ? (
                    <View style={styles.cashNotice}>
                      <Text style={styles.cashNoticeTitle}>Pagamento em dinheiro na entrega</Text>
                      <Text style={styles.cashNoticeText}>
                        Tenha {formatCurrency(order.total_cents)} separado para pagar ao entregador.{cashChangeText(order)}
                      </Text>
                    </View>
                  ) : null}

                  {order.status === "out_for_delivery" ? (
                    <View style={styles.trackingNotice}>
                      <View style={styles.trackingNoticeText}>
                        <Text style={styles.trackingNoticeTitle}>
                          Seu pedido está a caminho
                        </Text>
                        <Text style={styles.trackingNoticeDescription}>
                          Acompanhe a posição compartilhada pelo entregador e a previsão de chegada.
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/rastreamento",
                            params: { order: order.id },
                          })
                        }
                        style={({ pressed }) => [
                          styles.trackingButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.trackingButtonText}>
                          Acompanhar entrega →
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {order.assigned_courier_id &&
                  ["ready_for_delivery", "out_for_delivery", "delivered"].includes(
                    order.status,
                  ) ? (
                    <View style={styles.chatNotice}>
                      <View style={styles.chatNoticeText}>
                        <Text style={styles.chatNoticeTitle}>
                          {order.status === "delivered"
                            ? "Histórico da conversa"
                            : "Fale com o entregador"}
                        </Text>
                        <Text style={styles.chatNoticeDescription}>
                          {order.status === "delivered"
                            ? "Consulte as mensagens trocadas durante a entrega."
                            : "Combine detalhes da entrega pelo chat privado deste pedido."}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/chat",
                            params: { order: order.id },
                          })
                        }
                        style={({ pressed }) => [
                          styles.chatButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.chatButtonText}>
                          {order.status === "delivered" ? "Ver conversa" : "Abrir chat"}
                          {(unreadCounts[order.id] ?? 0) > 0
                            ? ` · ${unreadCounts[order.id]} nova${unreadCounts[order.id] === 1 ? "" : "s"}`
                            : ""}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

function InfoItem({ label, value, strong = false, wide = false }: { label: string; value: string; strong?: boolean; wide?: boolean }) {
  return (
    <View style={wide ? styles.infoItemWide : styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={wide ? 3 : 2} style={strong ? styles.infoValueStrong : styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

function cashChangeText(order: OrderListItem) {
  if (!order.cash_change_for_cents) return "";
  const change = order.cash_change_for_cents - order.total_cents;
  return change > 0
    ? ` Troco solicitado: ${formatCurrency(change)} (você pagará com ${formatCurrency(order.cash_change_for_cents)}).`
    : "";
}

function translateCashError(message: string) {
  if (message.includes("CASH_NOT_ENABLED")) return "O pagamento em dinheiro não está disponível no momento.";
  if (message.includes("CASH_LIMIT_EXCEEDED")) return "Este pedido passa do valor máximo aceito em dinheiro. Use PIX ou cartão.";
  if (message.includes("INVALID_CHANGE_AMOUNT")) return "O valor para troco precisa ser igual ou maior que o total do pedido.";
  if (message.includes("ORDER_NOT_AWAITING_PAYMENT")) return "Este pedido não aceita mais mudança na forma de pagamento.";
  return "Não foi possível registrar o pagamento em dinheiro. Confirme se o SQL da Etapa 17 foi executado.";
}

function statusDetails(status: OrderStatus, isCashPending = false) {
  if (status === "awaiting_payment" && isCashPending) return { label: "DINHEIRO NA ENTREGA", color: "#245F7A", background: "#E1F3FA" };
  if (status === "paid") return { label: "PAGO", color: "#176A50", background: "#DFF6EC" };
  if (status === "in_production") return { label: "EM PRODUÇÃO", color: "#77530D", background: "#FFF0C9" };
  if (status === "ready_for_delivery") return { label: "PRONTO PARA ENTREGA", color: "#245F7A", background: "#E1F3FA" };
  if (status === "out_for_delivery") return { label: "SAIU PARA ENTREGA", color: "#5E3A8A", background: "#F0E7FA" };
  if (status === "delivered") return { label: "ENTREGUE", color: "#176A50", background: "#DFF6EC" };
  if (status === "cancelled") return { label: "CANCELADO", color: "#8A3325", background: "#FFE7E2" };
  return { label: "AGUARDANDO PAGAMENTO", color: "#7A4B1C", background: "#FFF0DE" };
}

function formatCreatedAt(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function firstSubmission(value: OrderListItem["pix_payment_submissions"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 22, marginBottom: 14 },
  backButton: { paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  newButton: { borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 15, paddingVertical: 12 },
  newButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  list: { gap: 14 },
  orderCard: { ...visualShadows.card, overflow: "hidden", flexDirection: Platform.OS === "web" ? "row" : "column", borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF" },
  ticketSide: { width: Platform.OS === "web" ? 320 : "100%", minHeight: 210, justifyContent: "flex-end", padding: 23 },
  accentLine: { position: "absolute", top: 22, left: 23, width: 54, height: 4, borderRadius: 2 },
  orderNumber: { color: "#BFD0D7", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  eventName: { color: "#FFFFFF", fontSize: 25, lineHeight: 30, fontWeight: "900", textTransform: "uppercase", marginTop: 9 },
  eventDate: { color: "#DCE7EA", fontSize: 9, fontWeight: "800", marginTop: 9 },
  orderBody: { flex: 1, padding: 23 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  createdAt: { color: "#8298A2", fontSize: 10 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 15, marginTop: 20 },
  infoItem: { minWidth: 120, flex: 1, gap: 5 },
  infoItemWide: { width: "100%", gap: 5 },
  infoLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  infoValue: { color: "#102A43", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  infoValueStrong: { color: "#087E83", fontSize: 15, fontWeight: "900" },
  nextStepNotice: { borderRadius: 14, backgroundColor: "#FFF5E9", padding: 13, marginTop: 18 },
  nextStepTitle: { color: "#7A4B1C", fontSize: 10, fontWeight: "900" },
  nextStepText: { color: "#8A6848", fontSize: 9, lineHeight: 15, marginTop: 3 },
  paymentButtons: { flexDirection: Platform.OS === "web" ? "row" : "column", gap: 9, marginTop: 12 },
  payButton: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 15 },
  payButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  payButtonArrow: { color: "#071D2D", fontSize: 18, fontWeight: "900" },
  pixButton: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 15 },
  cashButton: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#087E83", backgroundColor: "#FFFFFF", paddingHorizontal: 15 },
  cashButtonText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  cashForm: { gap: 10, borderRadius: 14, borderWidth: 1, borderColor: "#CFE8E8", backgroundColor: "#F3FBFB", padding: 14, marginTop: 12 },
  cashFormTitle: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  cashFormText: { color: "#627D8A", fontSize: 10, lineHeight: 16 },
  cashInput: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", color: "#102A43", fontSize: 13, paddingHorizontal: 14 },
  cashFormButtons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  cashConfirmButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, backgroundColor: "#087E83", paddingHorizontal: 16 },
  cashConfirmText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  cashCancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 16 },
  cashCancelText: { color: "#486876", fontSize: 11, fontWeight: "900" },
  cashNotice: { borderRadius: 14, backgroundColor: "#E1F3FA", padding: 14, marginTop: 14 },
  cashNoticeTitle: { color: "#245F7A", fontSize: 11, fontWeight: "900" },
  cashNoticeText: { color: "#3D6F86", fontSize: 10, lineHeight: 16, marginTop: 4 },
  pixButtonStandalone: { marginTop: 12 },
  pixButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  pixButtonArrow: { color: "#071D2D", fontSize: 18, fontWeight: "900" },
  trackingNotice: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: Platform.OS === "web" ? "center" : "stretch", justifyContent: "space-between", gap: 12, borderRadius: 14, borderWidth: 1, borderColor: "#C9B5E3", backgroundColor: "#F7F1FC", padding: 13, marginTop: 18 },
  trackingNoticeText: { flex: 1 },
  trackingNoticeTitle: { color: "#5E3A8A", fontSize: 11, fontWeight: "900" },
  trackingNoticeDescription: { color: "#71568E", fontSize: 9, lineHeight: 15, marginTop: 3 },
  trackingButton: { alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#5E3A8A", paddingHorizontal: 14, paddingVertical: 11 },
  trackingButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  chatNotice: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: Platform.OS === "web" ? "center" : "stretch", justifyContent: "space-between", gap: 12, borderRadius: 14, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13, marginTop: 12 },
  chatNoticeText: { flex: 1 },
  chatNoticeTitle: { color: "#176A50", fontSize: 11, fontWeight: "900" },
  chatNoticeDescription: { color: "#437565", fontSize: 9, lineHeight: 15, marginTop: 3 },
  chatButton: { alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#176A50", paddingHorizontal: 14, paddingVertical: 11 },
  chatButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  paymentMessageCard: { flexDirection: Platform.OS === "web" ? "row" : "column", alignItems: Platform.OS === "web" ? "center" : "stretch", justifyContent: "space-between", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 14, marginBottom: 14 },
  paymentMessageText: { flex: 1, color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  refreshButton: { alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#176A50", paddingHorizontal: 13, paddingVertical: 10 },
  refreshButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  paymentErrorCard: { borderRadius: 16, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginBottom: 14 },
  paymentErrorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  stateCard: { ...visualShadows.card, minHeight: 250, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  stateText: { maxWidth: 470, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { color: "#102A43", fontSize: 20, fontWeight: "900" },
  errorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  primaryButton: { borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 17, paddingVertical: 13 },
  primaryButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  darkButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

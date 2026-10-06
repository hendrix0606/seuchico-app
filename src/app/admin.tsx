import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { StarRating } from "../components/StarRating";
import { visualShadows } from "../constants/visual-style";
import {
  fetchBlockedClients,
  fetchCashBalances,
  registerCashSettlement,
  releaseCashBlock,
  translateSettlementError,
  type BlockedClient,
  type CashBalance,
} from "../lib/cash-settlement";
import { formatMoneyInput, parseMoneyInput } from "../lib/finance";
import { notifyOrderEvent } from "../lib/push-notifications";
import {
  fetchRatingSummary,
  fetchRecentComments,
  formatAverage,
  type CourierRatingSummary,
  type RecentRating,
} from "../lib/ratings";
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

type PaymentStatus =
  | "pending"
  | "creating"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "on_delivery";

type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: "client" | "courier" | "admin";
  is_active: boolean;
};

type AdminOrder = {
  id: string;
  order_number: number;
  user_id: string;
  assigned_courier_id: string | null;
  status: OrderStatus;
  payment_provider: "stripe" | "pix" | "cash";
  payment_status: PaymentStatus;
  quantity: number;
  total_cents: number;
  delivery_recipient: string;
  delivery_phone: string;
  delivery_zip_code: string;
  delivery_street: string;
  delivery_number: string;
  delivery_complement: string | null;
  delivery_neighborhood: string;
  delivery_city: string;
  delivery_state: string;
  delivery_reference: string | null;
  production_notes: string | null;
  created_at: string;
  paid_at: string | null;
  ticket_drafts: {
    event_name: string;
    event_date: string;
    event_time: string;
    location: string;
    primary_color: string;
    accent_color: string;
    ticket_templates: { name: string } | null;
  } | null;
  order_status_history: {
    id: number;
    from_status: OrderStatus | null;
    to_status: OrderStatus;
    note: string | null;
    created_at: string;
  }[];
};

type Filter = "all" | OrderStatus;
type Feedback = { tone: "success" | "error"; text: string } | null;

const filters: { label: string; value: Filter }[] = [
  { label: "Todos", value: "all" },
  { label: "Aguardando pagamento", value: "awaiting_payment" },
  { label: "Pagos", value: "paid" },
  { label: "Em produção", value: "in_production" },
  { label: "Prontos", value: "ready_for_delivery" },
  { label: "Em entrega", value: "out_for_delivery" },
  { label: "Entregues", value: "delivered" },
];

export default function AdminScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [ratingSummary, setRatingSummary] = useState<CourierRatingSummary[] | null>(null);
  const [recentComments, setRecentComments] = useState<RecentRating[]>([]);
  const [cashBalances, setCashBalances] = useState<CashBalance[] | null>(null);
  const [settleCourierId, setSettleCourierId] = useState<string | null>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [isSettling, setIsSettling] = useState(false);
  const [blockedClients, setBlockedClients] = useState<BlockedClient[] | null>(null);
  const [releaseConfirmId, setReleaseConfirmId] = useState<string | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);

  const loadDashboard = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setIsLoading(true);
    setErrorMessage(null);

    const [ordersResult, profilesResult] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, order_number, user_id, assigned_courier_id, status, payment_provider, payment_status, quantity, total_cents, delivery_recipient, delivery_phone, delivery_zip_code, delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_state, delivery_reference, production_notes, created_at, paid_at, ticket_drafts(event_name, event_date, event_time, location, primary_color, accent_color, ticket_templates(name)), order_status_history(id, from_status, to_status, note, created_at)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, full_name, phone, role, is_active")
        .order("full_name"),
    ]);

    if (ordersResult.error || profilesResult.error) {
      setErrorMessage(
        "Não foi possível carregar a operação. Confirme se o SQL da Etapa 8 foi executado.",
      );
    } else {
      setOrders((ordersResult.data ?? []) as unknown as AdminOrder[]);
      setProfiles((profilesResult.data ?? []) as Profile[]);
    }

    // Avaliacoes ficam em consultas separadas: antes do SQL 018 elas falham e
    // so escondem o painel, sem afetar a operacao.
    const [summary, comments] = await Promise.all([
      fetchRatingSummary(),
      fetchRecentComments(5),
    ]);
    setRatingSummary(summary);
    setRecentComments(comments);

    // Saldo do dinheiro com os entregadores: antes do SQL 019 so esconde o painel.
    setCashBalances(await fetchCashBalances());
    setBlockedClients(await fetchBlockedClients());

    if (!silent) setIsLoading(false);
  };

  const handleReleaseBlock = async (clientId: string) => {
    setIsReleasing(true);
    setFeedback(null);

    try {
      await releaseCashBlock(clientId);
      setReleaseConfirmId(null);
      setFeedback({ tone: "success", text: "Cliente liberado para pagar em dinheiro novamente." });
      setBlockedClients(await fetchBlockedClients());
    } catch {
      setFeedback({ tone: "error", text: "Não foi possível liberar o cliente. Confirme se o SQL da Etapa 20 foi executado." });
    }

    setIsReleasing(false);
  };

  const handleRegisterSettlement = async (courierId: string) => {
    const amountCents = parseMoneyInput(settleAmount);

    if (amountCents === null || amountCents <= 0) {
      setFeedback({ tone: "error", text: "Informe o valor do repasse, maior que zero." });
      return;
    }

    setIsSettling(true);
    setFeedback(null);

    try {
      await registerCashSettlement(courierId, amountCents, settleNote);
      setSettleCourierId(null);
      setSettleAmount("");
      setSettleNote("");
      setFeedback({ tone: "success", text: `Repasse de ${formatCurrency(amountCents)} registrado.` });
      setCashBalances(await fetchCashBalances());
    } catch (error) {
      setFeedback({
        tone: "error",
        text: translateSettlementError(error instanceof Error ? error.message : String(error)),
      });
    }

    setIsSettling(false);
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const couriers = useMemo(
    () => profiles.filter((item) => item.role === "courier" && item.is_active),
    [profiles],
  );
  const profilesById = useMemo(
    () => new Map(profiles.map((item) => [item.id, item])),
    [profiles],
  );
  const visibleOrders = useMemo(
    () => (filter === "all" ? orders : orders.filter((item) => item.status === filter)),
    [filter, orders],
  );
  const paidRevenue = useMemo(
    () =>
      orders
        .filter((item) => item.payment_status === "paid")
        .reduce((total, item) => total + item.total_cents, 0),
    [orders],
  );

  const handleAssignCourier = async (orderId: string, courierId: string) => {
    setBusyOrderId(orderId);
    setFeedback(null);

    const { error } = await supabase.rpc("admin_assign_order_courier", {
      p_order_id: orderId,
      p_courier_id: courierId,
      p_note: null,
    });

    if (error) {
      setFeedback({
        tone: "error",
        text: "Não foi possível atribuir o entregador. Confira se ele está ativo.",
      });
    } else {
      setFeedback({ tone: "success", text: "Entregador atribuído ao pedido." });
      await notifyOrderEvent(orderId, "courier_assigned");
      await loadDashboard({ silent: true });
    }
    setBusyOrderId(null);
  };

  const handleTransition = async (order: AdminOrder) => {
    const action = workflowAction(order);
    if (!action) return;

    if (action.nextStatus === "out_for_delivery" && !order.assigned_courier_id) {
      setFeedback({
        tone: "error",
        text: "Atribua um entregador antes de iniciar a entrega.",
      });
      return;
    }

    setBusyOrderId(order.id);
    setFeedback(null);
    const { error } = await supabase.rpc("admin_transition_order", {
      p_order_id: order.id,
      p_next_status: action.nextStatus,
      p_note: notes[order.id]?.trim() || null,
    });

    if (error) {
      setFeedback({ tone: "error", text: translateWorkflowError(error.message) });
    } else {
      setNotes((current) => ({ ...current, [order.id]: "" }));
      setFeedback({
        tone: "success",
        text: `Pedido #${String(order.order_number).padStart(5, "0")} atualizado para ${statusDetails(action.nextStatus).label}.`,
      });
      await notifyOrderEvent(order.id, "order_status");
      await loadDashboard({ silent: true });
    }
    setBusyOrderId(null);
  };

  return (
    <ProtectedRoleScreen
      eyebrow="PAINEL ADMINISTRATIVO"
      requiredRole="admin"
      subtitle="Controle pedidos pagos, produção e preparação das entregas em uma área protegida."
      title="Operação"
    >
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.sectionEyebrow}>VISÃO GERAL</Text>
          <Text style={styles.sectionTitle}>Operação do SeuChico</Text>
        </View>
        <View style={styles.toolbarActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/financeiro")}
            style={({ pressed }) => [
              styles.financeButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.financeButtonText}>Financeiro e relatórios</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/usuarios")}
            style={({ pressed }) => [
              styles.accessButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.accessButtonText}>Gerenciar acessos</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/pagamentos-pix")}
            style={({ pressed }) => [
              styles.pixReviewButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.pixReviewButtonText}>Analisar PIX</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/configuracoes")}
            style={({ pressed }) => [
              styles.settingsButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.settingsButtonText}>Aparência e PIX</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => void loadDashboard()}
            style={({ pressed }) => [
              styles.refreshButton,
              isLoading && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.refreshButtonText}>↻ Atualizar</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryCard accent="cyan" label="PAGOS PARA PRODUZIR" value={countStatus(orders, "paid")} />
        <SummaryCard accent="warm" label="EM PRODUÇÃO" value={countStatus(orders, "in_production")} />
        <SummaryCard accent="blue" label="PRONTOS" value={countStatus(orders, "ready_for_delivery")} />
        <SummaryCard accent="purple" label="EM ENTREGA" value={countStatus(orders, "out_for_delivery")} />
        <SummaryCard accent="green" label="RECEITA PAGA" value={formatCurrency(paidRevenue)} wide />
      </View>

      {ratingSummary ? (
        <View style={styles.ratingPanel}>
          <Text style={styles.ratingPanelEyebrow}>AVALIAÇÃO DOS ENTREGADORES</Text>
          {ratingSummary.length === 0 ? (
            <Text style={styles.ratingPanelEmpty}>Nenhuma avaliação recebida ainda.</Text>
          ) : (
            ratingSummary.map((item) => (
              <View key={item.courier_id ?? item.courier_name} style={styles.ratingRow}>
                <Text numberOfLines={1} style={styles.ratingName}>{item.courier_name}</Text>
                <StarRating size={16} value={item.rating_average} />
                <Text style={styles.ratingValue}>
                  {formatAverage(item.rating_average)} · {item.rating_count} {item.rating_count === 1 ? "avaliação" : "avaliações"}
                </Text>
              </View>
            ))
          )}
          {recentComments.length > 0 ? (
            <View style={styles.ratingComments}>
              <Text style={styles.ratingCommentsTitle}>COMENTÁRIOS RECENTES</Text>
              {recentComments.map((item) => (
                <View key={item.id} style={styles.ratingCommentRow}>
                  <StarRating size={12} value={item.rating} />
                  <Text style={styles.ratingCommentText}>
                    {profilesById.get(item.courier_id ?? "")?.full_name ?? "Entregador"}: “{item.comment}”
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {cashBalances && cashBalances.length > 0 ? (
        <View style={styles.cashPanel}>
          <Text style={styles.cashPanelEyebrow}>DINHEIRO COM ENTREGADORES</Text>
          {cashBalances.map((item) => {
            const isOpen = settleCourierId === item.courier_id;
            return (
              <View key={item.courier_id} style={styles.cashRow}>
                <View style={styles.cashRowHeader}>
                  <View style={styles.cashRowInfo}>
                    <Text numberOfLines={1} style={styles.cashName}>{item.courier_name}</Text>
                    <Text style={styles.cashDetails}>
                      Recebido {formatCurrency(item.received_cents)} · Repassado {formatCurrency(item.settled_cents)}
                    </Text>
                  </View>
                  <Text style={item.balance_cents > 0 ? styles.cashBalanceDue : styles.cashBalanceOk}>
                    {item.balance_cents > 0 ? `A repassar ${formatCurrency(item.balance_cents)}` : "Em dia"}
                  </Text>
                  {item.balance_cents > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setSettleCourierId(isOpen ? null : item.courier_id);
                        setSettleAmount(formatMoneyInput(item.balance_cents));
                        setSettleNote("");
                      }}
                      style={({ pressed }) => [styles.cashSettleButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.cashSettleButtonText}>{isOpen ? "Fechar" : "Registrar repasse"}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {isOpen ? (
                  <View style={styles.cashForm}>
                    <TextInput
                      accessibilityLabel="Valor do repasse"
                      keyboardType="decimal-pad"
                      onChangeText={setSettleAmount}
                      placeholder="Valor do repasse (R$)"
                      placeholderTextColor="#91A4AD"
                      style={styles.cashInput}
                      value={settleAmount}
                    />
                    <TextInput
                      accessibilityLabel="Observação do repasse"
                      maxLength={300}
                      onChangeText={setSettleNote}
                      placeholder="Observação (opcional)"
                      placeholderTextColor="#91A4AD"
                      style={styles.cashInput}
                      value={settleNote}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={isSettling}
                      onPress={() => void handleRegisterSettlement(item.courier_id)}
                      style={({ pressed }) => [styles.cashConfirmButton, isSettling && styles.disabled, pressed && styles.pressed]}
                    >
                      <Text style={styles.cashConfirmText}>{isSettling ? "Registrando..." : "Confirmar repasse"}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {blockedClients && blockedClients.length > 0 ? (
        <View style={styles.blockedPanel}>
          <Text style={styles.blockedPanelEyebrow}>CLIENTES BLOQUEADOS PARA DINHEIRO</Text>
          {blockedClients.map((item) => (
            <View key={item.client_id} style={styles.blockedRow}>
              <View style={styles.blockedInfo}>
                <Text numberOfLines={1} style={styles.blockedName}>
                  {item.client_name}{item.client_phone ? ` · ${item.client_phone}` : ""}
                </Text>
                <Text style={styles.blockedDetails}>
                  Recusou em {formatDateTime(item.refused_at)} · bloqueado até {formatDateTime(item.blocked_until)}
                </Text>
                {item.refusal_note ? (
                  <Text style={styles.blockedNote}>Motivo: {item.refusal_note}</Text>
                ) : null}
              </View>
              {releaseConfirmId === item.client_id ? (
                <View style={styles.blockedActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isReleasing}
                    onPress={() => setReleaseConfirmId(null)}
                    style={({ pressed }) => [styles.blockedCancelButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.blockedCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isReleasing}
                    onPress={() => void handleReleaseBlock(item.client_id)}
                    style={({ pressed }) => [styles.blockedReleaseButton, isReleasing && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.blockedReleaseText}>{isReleasing ? "Liberando..." : "Confirmar liberação"}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReleaseConfirmId(item.client_id)}
                  style={({ pressed }) => [styles.blockedReleaseButton, pressed && styles.pressed]}
                >
                  <Text style={styles.blockedReleaseText}>Liberar</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      {feedback ? (
        <View
          accessibilityLiveRegion="polite"
          style={feedback.tone === "success" ? styles.successCard : styles.errorCard}
        >
          <Text style={feedback.tone === "success" ? styles.successText : styles.errorText}>
            {feedback.text}
          </Text>
        </View>
      ) : null}

      <View style={styles.filters}>
        {filters.map((item) => {
          const active = filter === item.value;
          return (
            <Pressable
              accessibilityRole="button"
              key={item.value}
              onPress={() => setFilter(item.value)}
              style={({ pressed }) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={active ? styles.filterTextActive : styles.filterText}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando operação...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateErrorTitle}>Painel indisponível</Text>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadDashboard()}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      ) : visibleOrders.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>Nenhum pedido neste filtro</Text>
          <Text style={styles.stateText}>
            Os pedidos aparecerão aqui conforme avançarem na operação.
          </Text>
        </View>
      ) : (
        <View style={styles.orderList}>
          {visibleOrders.map((order) => {
            const draft = order.ticket_drafts;
            const client = profilesById.get(order.user_id);
            const courier = order.assigned_courier_id
              ? profilesById.get(order.assigned_courier_id)
              : null;
            const status = statusDetails(order.status);
            const action = workflowAction(order);
            const isCashPending = isCashOnDelivery(order);
            const isBusy = busyOrderId === order.id;

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
                  <Text style={styles.ticketModel}>
                    {draft?.ticket_templates?.name ?? "Modelo SeuChico"}
                  </Text>
                  <Text numberOfLines={2} style={styles.ticketEventName}>
                    {draft?.event_name ?? "Ingresso personalizado"}
                  </Text>
                  {draft ? (
                    <Text style={styles.ticketDetails}>
                      {formatDatabaseDate(draft.event_date)} · {draft.event_time.slice(0, 5)}
                    </Text>
                  ) : null}
                  <Text style={styles.ticketOrderNumber}>
                    PEDIDO #{String(order.order_number).padStart(5, "0")}
                  </Text>
                </View>

                <View style={styles.orderBody}>
                  <View style={styles.orderHeading}>
                    <View>
                      <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
                        <Text style={[styles.statusText, { color: status.color }]}>
                          {status.label}
                        </Text>
                      </View>
                      <Text style={styles.createdAt}>Criado em {formatDateTime(order.created_at)}</Text>
                    </View>
                    <View style={styles.totalBlock}>
                      <Text style={styles.totalLabel}>
                        {order.payment_status === "paid" ? "TOTAL PAGO" : "TOTAL DO PEDIDO"}
                      </Text>
                      <Text style={styles.totalValue}>{formatCurrency(order.total_cents)}</Text>
                    </View>
                  </View>

                  <View style={styles.infoGrid}>
                    <Info label="CLIENTE" value={client?.full_name ?? order.delivery_recipient} />
                    <Info label="TELEFONE" value={client?.phone ?? order.delivery_phone} />
                    <Info label="QUANTIDADE" value={`${order.quantity} unidades`} />
                    <Info label="PAGAMENTO" value={paymentLabel(order)} />
                    <Info label="ENTREGA" value={formatAddress(order)} wide />
                    <Info label="ENTREGADOR" value={courier?.full_name ?? "Ainda não atribuído"} wide />
                  </View>

                  {order.production_notes ? (
                    <View style={styles.savedNote}>
                      <Text style={styles.savedNoteLabel}>ÚLTIMA OBSERVAÇÃO</Text>
                      <Text style={styles.savedNoteText}>{order.production_notes}</Text>
                    </View>
                  ) : null}

                  {order.status !== "awaiting_payment" &&
                  order.status !== "delivered" &&
                  order.status !== "cancelled" ? (
                    <View style={styles.operationPanel}>
                      <Text style={styles.operationTitle}>EQUIPE DE ENTREGA</Text>
                      {couriers.length === 0 ? (
                        <Text style={styles.operationHelp}>
                          Nenhum entregador ativo. Cadastre uma conta e altere o papel para courier no Supabase.
                        </Text>
                      ) : (
                        <View style={styles.courierChips}>
                          {couriers.map((item) => {
                            const selected = item.id === order.assigned_courier_id;
                            return (
                              <Pressable
                                accessibilityRole="button"
                                disabled={isBusy || selected}
                                key={item.id}
                                onPress={() => void handleAssignCourier(order.id, item.id)}
                                style={({ pressed }) => [
                                  styles.courierChip,
                                  selected && styles.courierChipSelected,
                                  (isBusy || selected) && styles.disabled,
                                  pressed && styles.pressed,
                                ]}
                              >
                                <Text style={selected ? styles.courierChipTextSelected : styles.courierChipText}>
                                  {selected ? "✓ " : "+ "}{item.full_name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}

                      {action ? (
                        <>
                          <Text style={styles.noteLabel}>Observação da produção</Text>
                          <TextInput
                            maxLength={1000}
                            multiline
                            onChangeText={(value) =>
                              setNotes((current) => ({ ...current, [order.id]: value }))
                            }
                            placeholder="Ex.: impressão conferida, material separado..."
                            placeholderTextColor="#91A4AD"
                            style={styles.noteInput}
                            value={notes[order.id] ?? ""}
                          />
                          <Pressable
                            accessibilityRole="button"
                            disabled={
                              isBusy ||
                              (action.nextStatus === "out_for_delivery" && !order.assigned_courier_id)
                            }
                            onPress={() => void handleTransition(order)}
                            style={({ pressed }) => [
                              styles.actionButton,
                              (isBusy ||
                                (action.nextStatus === "out_for_delivery" && !order.assigned_courier_id)) &&
                                styles.disabled,
                              pressed && styles.pressed,
                            ]}
                          >
                            {isBusy ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                            <Text style={styles.actionButtonText}>
                              {isBusy ? "Atualizando..." : action.label}
                            </Text>
                            {!isBusy ? <Text style={styles.actionArrow}>→</Text> : null}
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  ) : order.status === "awaiting_payment" && isCashPending ? (
                    <View style={styles.awaitingNotice}>
                      <Text style={styles.awaitingTitle}>Dinheiro na entrega · aguardando seu aceite</Text>
                      <Text style={styles.awaitingText}>
                        O cliente vai pagar {formatCurrency(order.total_cents)} em dinheiro ao entregador. Ao aceitar, a produção começa antes do recebimento. O pagamento só entra na receita quando o entregador confirmar a entrega.
                      </Text>
                      {action ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={isBusy}
                          onPress={() => void handleTransition(order)}
                          style={({ pressed }) => [styles.actionButton, isBusy && styles.disabled, pressed && styles.pressed]}
                        >
                          {isBusy ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                          <Text style={styles.actionButtonText}>{isBusy ? "Atualizando..." : action.label}</Text>
                          {!isBusy ? <Text style={styles.actionArrow}>→</Text> : null}
                        </Pressable>
                      ) : null}
                    </View>
                  ) : order.status === "awaiting_payment" ? (
                    <View style={styles.awaitingNotice}>
                      <Text style={styles.awaitingTitle}>Pagamento pendente</Text>
                      <Text style={styles.awaitingText}>
                        A produção só poderá começar depois da confirmação do cartão ou da aprovação do comprovante PIX.
                      </Text>
                    </View>
                  ) : null}

                  {order.order_status_history.length > 0 ? (
                    <View style={styles.historyPanel}>
                      <Text style={styles.historyTitle}>HISTÓRICO DO PEDIDO</Text>
                      {[...order.order_status_history]
                        .sort(
                          (a, b) =>
                            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
                        )
                        .slice(0, 5)
                        .map((item) => (
                          <View key={item.id} style={styles.historyRow}>
                            <View style={styles.historyDot} />
                            <View style={styles.historyContent}>
                              <Text style={styles.historyStatus}>
                                {statusDetails(item.to_status).label}
                              </Text>
                              <Text style={styles.historyDate}>
                                {formatDateTime(item.created_at)}
                              </Text>
                              {item.note ? (
                                <Text style={styles.historyNote}>{item.note}</Text>
                              ) : null}
                            </View>
                          </View>
                        ))}
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

function SummaryCard({ accent, label, value, wide = false }: {
  accent: "cyan" | "warm" | "blue" | "purple" | "green";
  label: string;
  value: number | string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, wide && styles.summaryCardWide]}>
      <View style={[styles.summaryAccent, summaryAccentStyle(accent)]} />
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function Info({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={wide ? styles.infoWide : styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function countStatus(orders: AdminOrder[], status: OrderStatus) {
  return orders.filter((item) => item.status === status).length;
}

function isCashOnDelivery(order: AdminOrder) {
  return order.payment_provider === "cash" && order.payment_status === "on_delivery";
}

function paymentLabel(order: AdminOrder) {
  if (order.payment_provider === "cash") {
    if (order.payment_status === "paid") return "Dinheiro · recebido na entrega";
    if (order.payment_status === "cancelled") return "Dinheiro · recusado pelo cliente";
    return "Dinheiro na entrega · a receber";
  }
  return order.payment_provider === "pix" ? "PIX" : "Cartão · Stripe";
}

function workflowAction(order: AdminOrder) {
  const status = order.status;
  if (status === "awaiting_payment" && isCashOnDelivery(order)) {
    return { label: "Aceitar pedido e iniciar produção", nextStatus: "in_production" as const };
  }
  // Pedido em dinheiro a receber: quem confirma entrega e recebimento e o entregador.
  if (status === "out_for_delivery" && isCashOnDelivery(order)) return null;
  if (status === "paid") return { label: "Iniciar produção", nextStatus: "in_production" as const };
  if (status === "in_production") return { label: "Marcar como pronto para entrega", nextStatus: "ready_for_delivery" as const };
  if (status === "ready_for_delivery") return { label: "Registrar saída para entrega", nextStatus: "out_for_delivery" as const };
  if (status === "out_for_delivery") return { label: "Confirmar entrega", nextStatus: "delivered" as const };
  return null;
}

function statusDetails(status: OrderStatus) {
  if (status === "paid") return { label: "PAGO", color: "#176A50", background: "#DFF6EC" };
  if (status === "in_production") return { label: "EM PRODUÇÃO", color: "#77530D", background: "#FFF0C9" };
  if (status === "ready_for_delivery") return { label: "PRONTO PARA ENTREGA", color: "#245F7A", background: "#E1F3FA" };
  if (status === "out_for_delivery") return { label: "SAIU PARA ENTREGA", color: "#5E3A8A", background: "#F0E7FA" };
  if (status === "delivered") return { label: "ENTREGUE", color: "#176A50", background: "#DFF6EC" };
  if (status === "cancelled") return { label: "CANCELADO", color: "#8A3325", background: "#FFE7E2" };
  return { label: "AGUARDANDO PAGAMENTO", color: "#7A4B1C", background: "#FFF0DE" };
}

function summaryAccentStyle(accent: "cyan" | "warm" | "blue" | "purple" | "green") {
  if (accent === "warm") return { backgroundColor: "#F0B85A" };
  if (accent === "blue") return { backgroundColor: "#4EA4C7" };
  if (accent === "purple") return { backgroundColor: "#9A76C5" };
  if (accent === "green") return { backgroundColor: "#4CB88A" };
  return { backgroundColor: "#38D6D2" };
}

function formatAddress(order: AdminOrder) {
  const complement = order.delivery_complement ? `, ${order.delivery_complement}` : "";
  return `${order.delivery_street}, ${order.delivery_number}${complement} · ${order.delivery_neighborhood} · ${order.delivery_city}/${order.delivery_state} · CEP ${order.delivery_zip_code}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function translateWorkflowError(message: string) {
  if (message.includes("COURIER_REQUIRED")) return "Atribua um entregador antes de iniciar a entrega.";
  if (message.includes("PAYMENT_REQUIRED")) return "A produção só pode começar depois da confirmação do pagamento.";
  if (message.includes("CASH_RECEIPT_REQUIRED")) return "Em pedidos em dinheiro, o entregador confirma a entrega e o recebimento.";
  if (message.includes("INVALID_STATUS_TRANSITION")) return "Essa mudança não é permitida para o estado atual do pedido.";
  return "Não foi possível atualizar o pedido. Atualize o painel e tente novamente.";
}

const styles = StyleSheet.create({
  blockedPanel: { gap: 12, borderRadius: 18, borderWidth: 1, borderColor: "#F1D3CD", backgroundColor: "#FFF8F6", padding: 16, marginTop: 14 },
  blockedPanelEyebrow: { color: "#A74435", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  blockedRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  blockedInfo: { flexGrow: 1, flexBasis: 200, gap: 2 },
  blockedName: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  blockedDetails: { color: "#627D8A", fontSize: 10 },
  blockedNote: { color: "#8A5A52", fontSize: 10, lineHeight: 15 },
  blockedActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  blockedReleaseButton: { minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#A13B2C", paddingHorizontal: 13 },
  blockedReleaseText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  blockedCancelButton: { minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 13 },
  blockedCancelText: { color: "#486876", fontSize: 10, fontWeight: "900" },
  cashPanel: { gap: 10, borderRadius: 18, borderWidth: 1, borderColor: "#CFE8E8", backgroundColor: "#F3FBFB", padding: 16, marginTop: 14 },
  cashPanelEyebrow: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  cashRow: { gap: 10 },
  cashRowHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  cashRowInfo: { flexGrow: 1, flexBasis: 160 },
  cashName: { color: "#102A43", fontSize: 12, fontWeight: "900" },
  cashDetails: { color: "#627D8A", fontSize: 10, marginTop: 2 },
  cashBalanceDue: { color: "#A13B2C", fontSize: 12, fontWeight: "900" },
  cashBalanceOk: { color: "#176A50", fontSize: 12, fontWeight: "900" },
  cashSettleButton: { minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#087E83", paddingHorizontal: 13 },
  cashSettleButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  cashForm: { gap: 8, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE7EA", padding: 12 },
  cashInput: { height: 44, borderRadius: 11, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#F9FBFC", color: "#102A43", fontSize: 12, paddingHorizontal: 12 },
  cashConfirmButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#38D6D2", paddingHorizontal: 14 },
  cashConfirmText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  ratingPanel: { gap: 10, borderRadius: 18, borderWidth: 1, borderColor: "#F0E2B8", backgroundColor: "#FFFBEF", padding: 16, marginTop: 14 },
  ratingPanelEyebrow: { color: "#8A6A12", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  ratingPanelEmpty: { color: "#8A6848", fontSize: 11 },
  ratingRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  ratingName: { flexGrow: 1, flexBasis: 140, color: "#102A43", fontSize: 12, fontWeight: "900" },
  ratingValue: { color: "#627D8A", fontSize: 10, fontWeight: "700" },
  ratingComments: { gap: 8, borderTopWidth: 1, borderTopColor: "#F0E2B8", paddingTop: 10, marginTop: 4 },
  ratingCommentsTitle: { color: "#8A6A12", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  ratingCommentRow: { gap: 3 },
  ratingCommentText: { color: "#486876", fontSize: 11, lineHeight: 17 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 24 },
  toolbarActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  accessButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 15 },
  accessButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  pixReviewButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#176A50", paddingHorizontal: 15 },
  pixReviewButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  settingsButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#9FD9DA", backgroundColor: "#E9F8F8", paddingHorizontal: 15 },
  settingsButtonText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  financeButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 15 },
  financeButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  sectionEyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  sectionTitle: { color: "#102A43", fontSize: 23, lineHeight: 29, fontWeight: "900", marginTop: 5 },
  refreshButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 15 },
  refreshButtonText: { color: "#102A43", fontSize: 11, fontWeight: "900" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 18 },
  summaryCard: { ...visualShadows.subtle, overflow: "hidden", minWidth: Platform.OS === "web" ? 170 : "46%", flexGrow: 1, flexBasis: Platform.OS === "web" ? "18%" : "46%", minHeight: 112, borderRadius: 19, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 17 },
  summaryCardWide: { flexBasis: Platform.OS === "web" ? "22%" : "100%" },
  summaryAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  summaryLabel: { color: "#8298A2", fontSize: 8, lineHeight: 12, fontWeight: "900", letterSpacing: 0.8 },
  summaryValue: { color: "#102A43", fontSize: 25, lineHeight: 31, fontWeight: "900", marginTop: 11 },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 13, marginTop: 15 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 13, marginTop: 15 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18, marginBottom: 14 },
  filterChip: { borderRadius: 20, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 9 },
  filterChipActive: { borderColor: "#071D2D", backgroundColor: "#071D2D" },
  filterText: { color: "#627D8A", fontSize: 9, fontWeight: "800" },
  filterTextActive: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  orderList: { gap: 15 },
  orderCard: { ...visualShadows.card, overflow: "hidden", flexDirection: Platform.OS === "web" ? "row" : "column", borderRadius: 24, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF" },
  ticketSide: { width: Platform.OS === "web" ? 300 : "100%", minHeight: Platform.OS === "web" ? 360 : 220, justifyContent: "flex-end", padding: 23 },
  accentLine: { position: "absolute", top: 23, left: 23, width: 55, height: 4, borderRadius: 2 },
  ticketModel: { color: "#BFD0D7", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  ticketEventName: { color: "#FFFFFF", fontSize: 25, lineHeight: 30, fontWeight: "900", textTransform: "uppercase", marginTop: 9 },
  ticketDetails: { color: "#DCE7EA", fontSize: 9, lineHeight: 15, fontWeight: "800", marginTop: 8 },
  ticketOrderNumber: { color: "#BFD0D7", fontSize: 8, fontWeight: "900", letterSpacing: 1.1, marginTop: 20 },
  orderBody: { flex: 1, minWidth: 0, padding: 22 },
  orderHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 15 },
  statusBadge: { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  createdAt: { color: "#8298A2", fontSize: 9, marginTop: 8 },
  totalBlock: { alignItems: "flex-end" },
  totalLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  totalValue: { color: "#087E83", fontSize: 18, fontWeight: "900", marginTop: 5 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 15, marginTop: 20 },
  infoItem: { minWidth: 125, flex: 1, gap: 5 },
  infoWide: { width: "100%", gap: 5 },
  infoLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 0.9 },
  infoValue: { color: "#102A43", fontSize: 11, lineHeight: 17, fontWeight: "700" },
  savedNote: { borderRadius: 14, backgroundColor: "#F3F8FA", padding: 13, marginTop: 16 },
  savedNoteLabel: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  savedNoteText: { color: "#486876", fontSize: 10, lineHeight: 16, marginTop: 5 },
  operationPanel: { borderRadius: 17, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#F8FBFC", padding: 15, marginTop: 18 },
  operationTitle: { color: "#087E83", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  operationHelp: { color: "#7A4B1C", fontSize: 10, lineHeight: 16, marginTop: 9 },
  courierChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  courierChip: { borderRadius: 18, borderWidth: 1, borderColor: "#C8D9DE", backgroundColor: "#FFFFFF", paddingHorizontal: 11, paddingVertical: 8 },
  courierChipSelected: { borderColor: "#087E83", backgroundColor: "#E5FAF9" },
  courierChipText: { color: "#486876", fontSize: 9, fontWeight: "800" },
  courierChipTextSelected: { color: "#087E83", fontSize: 9, fontWeight: "900" },
  noteLabel: { color: "#102A43", fontSize: 10, fontWeight: "900", marginTop: 14 },
  noteInput: { minHeight: 72, borderRadius: 13, borderWidth: 1, borderColor: "#D4E1E5", backgroundColor: "#FFFFFF", color: "#102A43", fontSize: 11, lineHeight: 17, padding: 12, marginTop: 7, textAlignVertical: "top" },
  actionButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 13, backgroundColor: "#38D6D2", paddingHorizontal: 15, marginTop: 12 },
  actionButtonText: { color: "#071D2D", fontSize: 11, fontWeight: "900" },
  actionArrow: { color: "#071D2D", fontSize: 18, fontWeight: "900" },
  awaitingNotice: { borderRadius: 15, backgroundColor: "#FFF5E9", padding: 14, marginTop: 18 },
  awaitingTitle: { color: "#7A4B1C", fontSize: 10, fontWeight: "900" },
  awaitingText: { color: "#8A6848", fontSize: 9, lineHeight: 15, marginTop: 4 },
  historyPanel: { borderTopWidth: 1, borderTopColor: "#E2EBEE", paddingTop: 17, marginTop: 19 },
  historyTitle: { color: "#102A43", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  historyRow: { flexDirection: "row", gap: 10, marginTop: 11 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#38D6D2", marginTop: 4 },
  historyContent: { flex: 1, minWidth: 0 },
  historyStatus: { color: "#102A43", fontSize: 10, fontWeight: "900" },
  historyDate: { color: "#8298A2", fontSize: 8, marginTop: 2 },
  historyNote: { color: "#627D8A", fontSize: 9, lineHeight: 14, marginTop: 3 },
  stateCard: { ...visualShadows.card, minHeight: 250, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  stateText: { maxWidth: 470, color: "#627D8A", fontSize: 12, lineHeight: 19, textAlign: "center" },
  stateErrorTitle: { color: "#8A3325", fontSize: 18, fontWeight: "900" },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { color: "#102A43", fontSize: 19, fontWeight: "900" },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", padding: 13 },
  darkButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

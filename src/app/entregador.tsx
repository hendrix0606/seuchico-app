import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DeliveryRouteMap } from "../components/DeliveryRouteMap";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import { useOrderChatUnread } from "../hooks/use-order-chat-unread";
import {
  computeDeliveryRoute,
  formatDeliveryAddress,
  formatDistance,
  formatDuration,
  formatLocationTime,
  openExternalRoute,
  statusLabel,
} from "../lib/delivery";
import { notifyOrderEvent } from "../lib/push-notifications";
import { supabase } from "../lib/supabase";
import { formatCurrency, formatDatabaseDate } from "../lib/tickets";
import type {
  Coordinate,
  DeliveryOrder,
  DeliveryRoute,
} from "../types/delivery";

const ORDER_SELECT =
  "id, order_number, user_id, assigned_courier_id, status, payment_status, payment_provider, quantity, total_cents, delivery_recipient, delivery_phone, delivery_zip_code, delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_state, delivery_reference, updated_at, ticket_drafts(event_name, event_date, event_time, location, primary_color, accent_color, ticket_templates(name))";

export default function CourierScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingGps, setIsStartingGps] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showDeliveryConfirmation, setShowDeliveryConfirmation] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [lastLocationAt, setLastLocationAt] = useState<string | null>(null);
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const lastRouteRequestRef = useRef(0);
  const unreadCounts = useOrderChatUnread(orders.map((order) => order.id));

  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? orders[0] ?? null;

  const loadOrders = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!session?.user.id) return;

    if (!silent) setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("assigned_courier_id", session.user.id)
      .in("status", ["ready_for_delivery", "out_for_delivery", "delivered"])
      .order("updated_at", { ascending: false });

    if (error) {
      setErrorMessage(
        "Não foi possível carregar suas entregas. Confirme se o SQL da Etapa 9 foi executado.",
      );
    } else {
      const nextOrders = (data ?? []) as unknown as DeliveryOrder[];

      // O troco fica em consulta separada: antes do SQL 017 a coluna nao existe
      // e uma falha aqui nao pode derrubar a lista de entregas.
      const cashOrderIds = nextOrders
        .filter((order) => order.payment_provider === "cash")
        .map((order) => order.id);

      if (cashOrderIds.length > 0) {
        const { data: cashRows } = await supabase
          .from("orders")
          .select("id, cash_change_for_cents")
          .in("id", cashOrderIds);

        for (const row of cashRows ?? []) {
          const target = nextOrders.find((order) => order.id === row.id);
          if (target) target.cash_change_for_cents = row.cash_change_for_cents;
        }
      }

      setOrders(nextOrders);
      setSelectedOrderId((current) =>
        nextOrders.some((order) => order.id === current)
          ? current
          : nextOrders[0]?.id ?? null,
      );
    }

    if (!silent) setIsLoading(false);
  };

  useEffect(() => {
    void loadOrders();
    // O carregamento muda somente quando o entregador autenticado mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    return () => watcherRef.current?.remove();
  }, []);

  useEffect(() => {
    stopTracking();
    setCurrentLocation(null);
    setLastLocationAt(null);
    setRoute(null);
    setMessage(null);
    setShowDeliveryConfirmation(false);
    // A troca de pedido precisa interromper o rastreamento anterior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

  const refreshRoute = async (order: DeliveryOrder, origin: Coordinate) => {
    setIsRouteLoading(true);
    lastRouteRequestRef.current = Date.now();

    try {
      const nextRoute = await computeDeliveryRoute(order.id, origin);
      setRoute(nextRoute);
      setErrorMessage(null);
    } catch {
      setErrorMessage(
        "O GPS está ativo, mas a rota não pôde ser calculada. Confirme a função e a chave do serviço de rotas no Supabase.",
      );
    } finally {
      setIsRouteLoading(false);
    }
  };

  const publishLocation = async (
    order: DeliveryOrder,
    location: Location.LocationObject,
  ) => {
    const point = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    const recordedAt = new Date(location.timestamp).toISOString();
    const accuracy = normalizeAccuracy(location.coords.accuracy);
    const heading = normalizeHeading(location.coords.heading);
    const speed = normalizeSpeed(location.coords.speed);

    setCurrentLocation(point);
    setLastLocationAt(recordedAt);

    const { error } = await supabase.rpc("courier_update_delivery_location", {
      p_order_id: order.id,
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_accuracy_meters: accuracy,
      p_heading_degrees: heading,
      p_speed_mps: speed,
      p_recorded_at: recordedAt,
    });

    if (error) {
      setErrorMessage(
        "O celular encontrou sua posição, mas não conseguiu enviá-la ao cliente.",
      );
      return;
    }

    setMessage("Localização compartilhada com o cliente.");

    if (Date.now() - lastRouteRequestRef.current > 45000) {
      await refreshRoute(order, point);
    }
  };

  const startTracking = async () => {
    if (!selectedOrder || selectedOrder.status !== "out_for_delivery") return;

    setIsStartingGps(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== "granted") {
        setErrorMessage(
          "Permissão de localização negada. Autorize o GPS nas configurações do celular e tente novamente.",
        );
        return;
      }

      watcherRef.current?.remove();
      const firstLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await publishLocation(selectedOrder, firstLocation);

      watcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 15,
        },
        (location) => void publishLocation(selectedOrder, location),
      );
      setIsTracking(true);
    } catch {
      setErrorMessage(
        Platform.OS === "web"
          ? "O navegador não liberou o GPS. Teste em localhost e permita a localização quando ele perguntar."
          : "Não foi possível iniciar o GPS. Verifique se a localização do aparelho está ligada.",
      );
    } finally {
      setIsStartingGps(false);
    }
  };

  function stopTracking() {
    watcherRef.current?.remove();
    watcherRef.current = null;
    setIsTracking(false);
  }

  const confirmDelivery = async () => {
    if (!selectedOrder) return;

    setIsConfirming(true);
    setErrorMessage(null);

    const { error } = await supabase.rpc("courier_confirm_delivery", {
      p_order_id: selectedOrder.id,
      p_note: "Entrega confirmada no aplicativo pelo entregador.",
    });

    if (error) {
      setErrorMessage(
        "Não foi possível confirmar a entrega. Atualize a tela e tente novamente.",
      );
    } else {
      stopTracking();
      setShowDeliveryConfirmation(false);
      setMessage(
        isCashToCollect(selectedOrder)
          ? "Entrega confirmada e pagamento em dinheiro registrado."
          : "Entrega confirmada com sucesso.",
      );
      await notifyOrderEvent(selectedOrder.id, "order_status");
      await loadOrders({ silent: true });
    }

    setIsConfirming(false);
  };

  return (
    <ProtectedRoleScreen
      eyebrow="ÁREA DO ENTREGADOR"
      requiredRole="courier"
      subtitle="Compartilhe sua posição somente durante a entrega e siga a rota autorizada."
      title="Bom trabalho"
    >
      {message ? (
        <View accessibilityLiveRegion="polite" style={styles.successCard}>
          <Text style={styles.successText}>{message}</Text>
        </View>
      ) : null}

      {errorMessage ? (
        <View accessibilityLiveRegion="polite" style={styles.errorCard}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando suas entregas...</Text>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateIcon}>🛵</Text>
          <Text style={styles.stateTitle}>Nenhuma entrega atribuída</Text>
          <Text style={styles.stateText}>
            Quando o administrador atribuir um pedido, ele aparecerá aqui.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadOrders()}
            style={({ pressed }) => [styles.darkButton, pressed && styles.pressed]}
          >
            <Text style={styles.darkButtonText}>Atualizar</Text>
          </Pressable>
        </View>
      ) : selectedOrder ? (
        <View style={styles.content}>
          {orders.length > 1 ? (
            <View style={styles.orderTabs}>
              {orders.map((order) => (
                <Pressable
                  accessibilityRole="button"
                  key={order.id}
                  onPress={() => setSelectedOrderId(order.id)}
                  style={({ pressed }) => [
                    styles.orderTab,
                    order.id === selectedOrder.id && styles.orderTabActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={
                      order.id === selectedOrder.id
                        ? styles.orderTabTextActive
                        : styles.orderTabText
                    }
                  >
                    #{String(order.order_number).padStart(5, "0")}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.deliveryCard}>
            <View style={styles.cardTop}>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.eyebrow}>{statusLabel(selectedOrder.status)}</Text>
                <Text style={styles.cardTitle}>
                  Pedido #{String(selectedOrder.order_number).padStart(5, "0")}
                </Text>
                <Text style={styles.eventName}>
                  {selectedOrder.ticket_drafts?.event_name ?? "Ingresso SeuChico"}
                </Text>
              </View>
              <View style={styles.quantityBadge}>
                <Text style={styles.quantityValue}>{selectedOrder.quantity}</Text>
                <Text style={styles.quantityLabel}>INGRESSOS</Text>
              </View>
            </View>

            <View style={styles.infoGrid}>
              <Info label="DESTINATÁRIO" value={selectedOrder.delivery_recipient} />
              <Info label="TELEFONE" value={selectedOrder.delivery_phone} />
              <Info
                label="EVENTO"
                value={
                  selectedOrder.ticket_drafts
                    ? `${formatDatabaseDate(selectedOrder.ticket_drafts.event_date)} · ${selectedOrder.ticket_drafts.event_time.slice(0, 5)}`
                    : "Não informado"
                }
              />
              <Info label="VALOR" value={formatCurrency(selectedOrder.total_cents)} />
              <Info
                label="ENDEREÇO"
                value={formatDeliveryAddress(selectedOrder)}
                wide
              />
              {selectedOrder.delivery_reference ? (
                <Info
                  label="REFERÊNCIA"
                  value={selectedOrder.delivery_reference}
                  wide
                />
              ) : null}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/chat",
                params: { order: selectedOrder.id },
              })
            }
            style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
          >
            <View style={styles.chatButtonTextGroup}>
              <Text style={styles.chatButtonTitle}>
                {selectedOrder.status === "delivered"
                  ? "Ver conversa da entrega"
                  : "Conversar com o cliente"}
              </Text>
              <Text style={styles.chatButtonSubtitle}>
                {selectedOrder.status === "delivered"
                  ? "Histórico disponível para consulta"
                  : "Chat privado do pedido"}
              </Text>
            </View>
            <Text style={styles.chatButtonAction}>
              {(unreadCounts[selectedOrder.id] ?? 0) > 0
                ? `${unreadCounts[selectedOrder.id]} nova${unreadCounts[selectedOrder.id] === 1 ? "" : "s"}`
                : "Abrir →"}
            </Text>
          </Pressable>

          {selectedOrder.status === "out_for_delivery" ? (
            <View style={styles.routeCard}>
              <View style={styles.routeHeader}>
                <View>
                  <Text style={styles.eyebrow}>ROTA E GPS</Text>
                  <Text style={styles.routeTitle}>Entrega em andamento</Text>
                </View>
                <View style={[styles.liveBadge, isTracking && styles.liveBadgeActive]}>
                  <View style={[styles.liveDot, isTracking && styles.liveDotActive]} />
                  <Text style={isTracking ? styles.liveTextActive : styles.liveText}>
                    {isTracking ? "GPS ATIVO" : "GPS PARADO"}
                  </Text>
                </View>
              </View>

              {currentLocation ? (
                <>
                  <DeliveryRouteMap
                    currentLocation={currentLocation}
                    onOpenExternal={() =>
                      void openExternalRoute(selectedOrder, currentLocation)
                    }
                    route={route}
                  />
                  <View style={styles.routeStats}>
                    <RouteStat
                      label="DISTÂNCIA"
                      value={formatDistance(route?.distance_meters ?? null)}
                    />
                    <RouteStat
                      label="PREVISÃO"
                      value={formatDuration(route?.duration_seconds ?? null)}
                    />
                    <RouteStat
                      label="ÚLTIMO GPS"
                      value={lastLocationAt ? formatLocationTime(lastLocationAt) : "—"}
                    />
                  </View>
                  {isRouteLoading ? (
                    <View style={styles.routeLoading}>
                      <ActivityIndicator color="#087E83" size="small" />
                      <Text style={styles.routeLoadingText}>Atualizando rota...</Text>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      void openExternalRoute(selectedOrder, currentLocation)
                    }
                    style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.outlineButtonText}>Abrir navegação no Google Maps →</Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.gpsPlaceholder}>
                  <Text style={styles.gpsIcon}>📍</Text>
                  <Text style={styles.gpsTitle}>GPS ainda não iniciado</Text>
                  <Text style={styles.gpsText}>
                    A localização só será compartilhada com o cliente deste pedido enquanto esta tela estiver aberta.
                  </Text>
                </View>
              )}

              <Pressable
                accessibilityRole="button"
                disabled={isStartingGps}
                onPress={isTracking ? stopTracking : () => void startTracking()}
                style={({ pressed }) => [
                  isTracking ? styles.stopButton : styles.primaryButton,
                  isStartingGps && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isStartingGps ? <ActivityIndicator color="#071D2D" size="small" /> : null}
                <Text style={isTracking ? styles.stopButtonText : styles.primaryButtonText}>
                  {isStartingGps
                    ? "Localizando..."
                    : isTracking
                      ? "Pausar compartilhamento"
                      : "Iniciar GPS e compartilhar rota"}
                </Text>
              </Pressable>

              {isCashToCollect(selectedOrder) ? (
                <View style={styles.cashCard}>
                  <Text style={styles.cashCardTitle}>
                    Receber {formatCurrency(selectedOrder.total_cents)} em dinheiro
                  </Text>
                  <Text style={styles.cashCardText}>
                    {cashChangeInstruction(selectedOrder)}
                  </Text>
                </View>
              ) : null}

              {!showDeliveryConfirmation ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowDeliveryConfirmation(true)}
                  style={({ pressed }) => [styles.deliveryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.deliveryButtonText}>
                    {isCashToCollect(selectedOrder)
                      ? "Confirmar entrega e recebimento"
                      : "Confirmar que o pedido foi entregue"}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmTitle}>
                    {isCashToCollect(selectedOrder)
                      ? `Você recebeu ${formatCurrency(selectedOrder.total_cents)} em dinheiro e entregou o pedido?`
                      : "O cliente já recebeu o pedido?"}
                  </Text>
                  <Text style={styles.confirmText}>
                    {isCashToCollect(selectedOrder)
                      ? "Ao confirmar, o pagamento em dinheiro é registrado em seu nome e a entrega é encerrada. Esta ação fica no histórico."
                      : "Esta ação encerra a entrega e fica registrada no histórico."}
                  </Text>
                  <View style={styles.confirmActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isConfirming}
                      onPress={() => setShowDeliveryConfirmation(false)}
                      style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.cancelButtonText}>Ainda não</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isConfirming}
                      onPress={() => void confirmDelivery()}
                      style={({ pressed }) => [
                        styles.confirmButton,
                        isConfirming && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.confirmButtonText}>
                        {isConfirming
                          ? "Confirmando..."
                          : isCashToCollect(selectedOrder)
                            ? "Sim, recebi e entreguei"
                            : "Sim, foi entregue"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ) : selectedOrder.status === "ready_for_delivery" ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Aguardando saída para entrega</Text>
              <Text style={styles.noticeText}>
                O administrador precisa registrar a saída antes que o GPS possa ser compartilhado.
              </Text>
            </View>
          ) : (
            <View style={styles.deliveredCard}>
              <Text style={styles.deliveredTitle}>✓ Entrega concluída</Text>
              <Text style={styles.deliveredText}>
                Este pedido foi entregue e o compartilhamento de localização foi encerrado.
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </ProtectedRoleScreen>
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

function RouteStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.routeStat}>
      <Text style={styles.routeStatLabel}>{label}</Text>
      <Text style={styles.routeStatValue}>{value}</Text>
    </View>
  );
}

function normalizeHeading(value: number | null) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 360
    ? value
    : null;
}

function normalizeSpeed(value: number | null) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 120
    ? value
    : null;
}

function normalizeAccuracy(value: number | null) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10000
    ? value
    : null;
}

function isCashToCollect(order: DeliveryOrder) {
  return order.payment_provider === "cash" && order.payment_status === "on_delivery";
}

function cashChangeInstruction(order: DeliveryOrder) {
  if (!order.cash_change_for_cents) {
    return "O cliente não pediu troco. Confirme o valor antes de entregar os ingressos.";
  }

  const change = order.cash_change_for_cents - order.total_cents;
  return change > 0
    ? `O cliente vai pagar com ${formatCurrency(order.cash_change_for_cents)}. Leve ${formatCurrency(change)} de troco.`
    : "O cliente vai pagar o valor exato, sem troco.";
}

const styles = StyleSheet.create({
  cashCard: { borderRadius: 16, borderWidth: 1, borderColor: "#F0D79C", backgroundColor: "#FFF8E6", padding: 16 },
  cashCardTitle: { color: "#77530D", fontSize: 15, fontWeight: "900" },
  cashCardText: { color: "#8A6848", fontSize: 11, lineHeight: 18, marginTop: 6 },
  content: { gap: 16, marginTop: 22 },
  successCard: { borderRadius: 15, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", padding: 14, marginTop: 18 },
  successText: { color: "#176A50", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginTop: 12 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  stateCard: { minHeight: 280, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30, marginTop: 22 },
  stateIcon: { fontSize: 40 },
  stateTitle: { color: "#102A43", fontSize: 20, fontWeight: "900" },
  stateText: { maxWidth: 480, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  orderTabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  orderTab: { borderRadius: 12, borderWidth: 1, borderColor: "#CFE0E5", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10 },
  orderTabActive: { borderColor: "#071D2D", backgroundColor: "#071D2D" },
  orderTabText: { color: "#526E7A", fontSize: 10, fontWeight: "900" },
  orderTabTextActive: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  deliveryCard: { ...visualShadows.card, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 22 },
  chatButton: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, borderRadius: 18, borderWidth: 1, borderColor: "#A9E1D0", backgroundColor: "#ECFBF5", paddingHorizontal: 17, paddingVertical: 13 },
  chatButtonTextGroup: { flex: 1 },
  chatButtonTitle: { color: "#176A50", fontSize: 13, fontWeight: "900" },
  chatButtonSubtitle: { color: "#437565", fontSize: 9, marginTop: 4 },
  chatButtonAction: { color: "#087E83", fontSize: 10, fontWeight: "900" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 18 },
  cardTitleGroup: { flex: 1 },
  eyebrow: { color: "#087E83", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  cardTitle: { color: "#102A43", fontSize: 23, fontWeight: "900", marginTop: 7 },
  eventName: { color: "#526E7A", fontSize: 12, fontWeight: "800", marginTop: 5 },
  quantityBadge: { minWidth: 82, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "#E7F8F7", padding: 12 },
  quantityValue: { color: "#087E83", fontSize: 23, fontWeight: "900" },
  quantityLabel: { color: "#087E83", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 22, paddingTop: 20, borderTopWidth: 1, borderTopColor: "#E4ECEF" },
  infoItem: { flex: 1, minWidth: 150, gap: 5 },
  infoWide: { width: "100%", gap: 5 },
  infoLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  infoValue: { color: "#102A43", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  routeCard: { ...visualShadows.card, gap: 15, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 20 },
  routeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 15 },
  routeTitle: { color: "#102A43", fontSize: 20, fontWeight: "900", marginTop: 6 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 20, backgroundColor: "#EDF2F4", paddingHorizontal: 11, paddingVertical: 8 },
  liveBadgeActive: { backgroundColor: "#DFF6EC" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#8298A2" },
  liveDotActive: { backgroundColor: "#18A376" },
  liveText: { color: "#627D8A", fontSize: 8, fontWeight: "900" },
  liveTextActive: { color: "#176A50", fontSize: 8, fontWeight: "900" },
  routeStats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  routeStat: { flex: 1, minWidth: 115, borderRadius: 14, backgroundColor: "#F3F7F8", padding: 13 },
  routeStatLabel: { color: "#8298A2", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  routeStatValue: { color: "#102A43", fontSize: 12, fontWeight: "900", marginTop: 5 },
  routeLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeLoadingText: { color: "#627D8A", fontSize: 10 },
  gpsPlaceholder: { minHeight: 210, alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 20, backgroundColor: "#E8F3F4", padding: 25 },
  gpsIcon: { fontSize: 34 },
  gpsTitle: { color: "#102A43", fontSize: 17, fontWeight: "900" },
  gpsText: { maxWidth: 450, color: "#526E7A", fontSize: 11, lineHeight: 18, textAlign: "center" },
  primaryButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 14, backgroundColor: "#38D6D2", paddingHorizontal: 16 },
  primaryButtonText: { color: "#071D2D", fontSize: 12, fontWeight: "900" },
  stopButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: "#E7B6AA", backgroundColor: "#FFF4F1", paddingHorizontal: 16 },
  stopButtonText: { color: "#8A3325", fontSize: 12, fontWeight: "900" },
  outlineButton: { minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#BFD3D9", backgroundColor: "#FFFFFF", paddingHorizontal: 15 },
  outlineButtonText: { color: "#087E83", fontSize: 11, fontWeight: "900" },
  deliveryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#071D2D", paddingHorizontal: 16 },
  deliveryButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  confirmCard: { gap: 8, borderRadius: 16, borderWidth: 1, borderColor: "#FFD7B3", backgroundColor: "#FFF7EB", padding: 15 },
  confirmTitle: { color: "#7A4B1C", fontSize: 13, fontWeight: "900" },
  confirmText: { color: "#8A6848", fontSize: 10, lineHeight: 16 },
  confirmActions: { flexDirection: "row", gap: 10, marginTop: 5 },
  cancelButton: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#D8C5B0", padding: 12 },
  cancelButtonText: { color: "#7A6045", fontSize: 10, fontWeight: "900" },
  confirmButton: { flex: 1, alignItems: "center", borderRadius: 12, backgroundColor: "#176A50", padding: 12 },
  confirmButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  noticeCard: { borderRadius: 18, backgroundColor: "#FFF5DE", padding: 18 },
  noticeTitle: { color: "#77530D", fontSize: 14, fontWeight: "900" },
  noticeText: { color: "#8A6848", fontSize: 11, lineHeight: 18, marginTop: 6 },
  deliveredCard: { borderRadius: 18, backgroundColor: "#ECFBF5", padding: 18 },
  deliveredTitle: { color: "#176A50", fontSize: 15, fontWeight: "900" },
  deliveredText: { color: "#437565", fontSize: 11, lineHeight: 18, marginTop: 6 },
  darkButton: { borderRadius: 13, backgroundColor: "#071D2D", paddingHorizontal: 16, paddingVertical: 12 },
  darkButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { DeliveryRouteMap } from "../components/DeliveryRouteMap";
import { ProtectedRoleScreen } from "../components/ProtectedRoleScreen";
import { visualShadows } from "../constants/visual-style";
import { useAuth } from "../context/auth-context";
import {
  computeDeliveryRoute,
  formatDeliveryAddress,
  formatDistance,
  formatDuration,
  formatLocationTime,
  openExternalRoute,
} from "../lib/delivery";
import { supabase } from "../lib/supabase";
import type {
  DeliveryLocation,
  DeliveryOrder,
  DeliveryRoute,
} from "../types/delivery";

const ORDER_SELECT =
  "id, order_number, user_id, assigned_courier_id, status, payment_status, quantity, total_cents, delivery_recipient, delivery_phone, delivery_zip_code, delivery_street, delivery_number, delivery_complement, delivery_neighborhood, delivery_city, delivery_state, delivery_reference, updated_at, ticket_drafts(event_name, event_date, event_time, location, primary_color, accent_color, ticket_templates(name))";

export default function DeliveryTrackingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ order?: string | string[] }>();
  const orderId = firstParam(params.order);
  const { session } = useAuth();
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastRouteRequestRef = useRef(0);

  const loadTracking = async () => {
    if (!session?.user.id || !orderId) {
      setErrorMessage("Pedido inválido.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("id", orderId)
      .eq("user_id", session.user.id)
      .single();

    if (orderError || !orderData) {
      setErrorMessage("Este pedido não foi encontrado ou não pertence à sua conta.");
      setIsLoading(false);
      return;
    }

    const nextOrder = orderData as unknown as DeliveryOrder;
    setOrder(nextOrder);

    const { data: locationData, error: locationError } = await supabase
      .from("delivery_locations")
      .select(
        "order_id, courier_id, latitude, longitude, accuracy_meters, heading_degrees, speed_mps, recorded_at, updated_at",
      )
      .eq("order_id", orderId)
      .maybeSingle();

    if (locationError) {
      setErrorMessage(
        "Não foi possível consultar a localização. Confirme o SQL da Etapa 9.",
      );
    } else if (locationData) {
      const nextLocation = locationData as DeliveryLocation;
      setLocation(nextLocation);
      if (nextOrder.status === "out_for_delivery") {
        await refreshRoute(nextOrder, nextLocation);
      }
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void loadTracking();
    // O pedido ou o cliente autenticado exigem uma nova leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, session?.user.id]);

  useEffect(() => {
    if (!orderId || !session?.user.id) return;

    const channel = supabase
      .channel(`delivery-location-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "delivery_locations",
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setLocation(null);
            setRoute(null);
            void loadTracking();
            return;
          }

          const nextLocation = payload.new as DeliveryLocation;
          if (!nextLocation?.order_id) return;

          setLocation(nextLocation);
          if (
            order?.status === "out_for_delivery" &&
            Date.now() - lastRouteRequestRef.current > 45000
          ) {
            void refreshRoute(order, nextLocation);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [order, orderId, session?.user.id]);

  const refreshRoute = async (
    routeOrder: DeliveryOrder,
    routeLocation: DeliveryLocation,
  ) => {
    setIsRouteLoading(true);
    lastRouteRequestRef.current = Date.now();

    try {
      const nextRoute = await computeDeliveryRoute(routeOrder.id, {
        latitude: routeLocation.latitude,
        longitude: routeLocation.longitude,
      });
      setRoute(nextRoute);
      setErrorMessage(null);
    } catch {
      setErrorMessage(
        "A localização chegou, mas a rota ainda não pôde ser calculada. Tente atualizar em instantes.",
      );
    } finally {
      setIsRouteLoading(false);
    }
  };

  return (
    <ProtectedRoleScreen
      eyebrow="ACOMPANHAMENTO DA ENTREGA"
      requiredRole="client"
      subtitle="Veja a posição compartilhada pelo entregador e a previsão de chegada."
      title="Seu pedido está a caminho"
    >
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/pedidos")}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backButtonText}>← Meus pedidos</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void loadTracking()}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          <Text style={styles.refreshButtonText}>Atualizar</Text>
        </Pressable>
      </View>

      {errorMessage ? (
        <View accessibilityLiveRegion="polite" style={styles.errorCard}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateText}>Carregando o rastreamento...</Text>
        </View>
      ) : !order ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Rastreamento indisponível</Text>
          <Text style={styles.stateText}>
            Volte aos seus pedidos e tente novamente.
          </Text>
        </View>
      ) : order.status === "delivered" ? (
        <View style={styles.deliveredCard}>
          <Text style={styles.deliveredIcon}>✓</Text>
          <Text style={styles.deliveredTitle}>Pedido entregue</Text>
          <Text style={styles.deliveredText}>
            A entrega #{String(order.order_number).padStart(5, "0")} foi concluída e o compartilhamento do GPS terminou.
          </Text>
        </View>
      ) : order.status !== "out_for_delivery" ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateIcon}>📦</Text>
          <Text style={styles.stateTitle}>A entrega ainda não começou</Text>
          <Text style={styles.stateText}>
            O rastreamento aparecerá assim que o administrador registrar a saída do pedido.
          </Text>
        </View>
      ) : !location ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color="#087E83" size="large" />
          <Text style={styles.stateTitle}>Aguardando o GPS do entregador</Text>
          <Text style={styles.stateText}>
            O pedido já saiu para entrega. A posição aparecerá quando o entregador tocar em “Iniciar GPS”.
          </Text>
        </View>
      ) : (
        <View style={styles.trackingCard}>
          <View style={styles.trackingHeader}>
            <View style={styles.headerText}>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LOCALIZAÇÃO AO VIVO</Text>
              </View>
              <Text style={styles.trackingTitle}>
                Pedido #{String(order.order_number).padStart(5, "0")}
              </Text>
              <Text style={styles.trackingSubtitle}>
                {order.ticket_drafts?.event_name ?? "Ingressos SeuChico"}
              </Text>
            </View>
            {isRouteLoading ? <ActivityIndicator color="#087E83" size="small" /> : null}
          </View>

          <DeliveryRouteMap
            currentLocation={{
              latitude: location.latitude,
              longitude: location.longitude,
            }}
            onOpenExternal={() =>
              void openExternalRoute(order, {
                latitude: location.latitude,
                longitude: location.longitude,
              })
            }
            route={route}
          />

          <View style={styles.stats}>
            <Stat label="DISTÂNCIA" value={formatDistance(route?.distance_meters ?? null)} />
            <Stat label="PREVISÃO" value={formatDuration(route?.duration_seconds ?? null)} />
            <Stat label="ATUALIZADO" value={formatLocationTime(location.recorded_at)} />
          </View>

          <View style={styles.addressCard}>
            <Text style={styles.addressLabel}>DESTINO</Text>
            <Text style={styles.addressValue}>{formatDeliveryAddress(order)}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void openExternalRoute(order, {
                latitude: location.latitude,
                longitude: location.longitude,
              })
            }
            style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
          >
            <Text style={styles.mapButtonText}>Abrir no Google Maps →</Text>
          </Pressable>

          <Text style={styles.privacyNote}>
            Por privacidade, o GPS só fica disponível durante esta entrega e apenas para as contas autorizadas.
          </Text>
        </View>
      )}
    </ProtectedRoleScreen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, marginTop: 22, marginBottom: 14 },
  backButton: { paddingVertical: 8 },
  backButtonText: { color: "#087E83", fontSize: 12, fontWeight: "900" },
  refreshButton: { borderRadius: 12, backgroundColor: "#071D2D", paddingHorizontal: 14, paddingVertical: 10 },
  refreshButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  errorCard: { borderRadius: 15, borderWidth: 1, borderColor: "#FFC8BF", backgroundColor: "#FFF4F1", padding: 14, marginBottom: 14 },
  errorText: { color: "#8A3325", fontSize: 11, lineHeight: 17, fontWeight: "800" },
  stateCard: { ...visualShadows.card, minHeight: 300, alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 30 },
  stateIcon: { fontSize: 40 },
  stateTitle: { color: "#102A43", fontSize: 20, fontWeight: "900", textAlign: "center" },
  stateText: { maxWidth: 500, color: "#627D8A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  deliveredCard: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 23, backgroundColor: "#ECFBF5", padding: 30 },
  deliveredIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#176A50", color: "#FFFFFF", fontSize: 28, lineHeight: 54, fontWeight: "900", textAlign: "center" },
  deliveredTitle: { color: "#176A50", fontSize: 22, fontWeight: "900" },
  deliveredText: { maxWidth: 500, color: "#437565", fontSize: 12, lineHeight: 19, textAlign: "center" },
  trackingCard: { ...visualShadows.card, gap: 16, borderRadius: 23, borderWidth: 1, borderColor: "#DCE7EA", backgroundColor: "#FFFFFF", padding: 20 },
  trackingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  headerText: { flex: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#18A376" },
  liveText: { color: "#176A50", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  trackingTitle: { color: "#102A43", fontSize: 22, fontWeight: "900", marginTop: 7 },
  trackingSubtitle: { color: "#627D8A", fontSize: 11, fontWeight: "700", marginTop: 4 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { flex: 1, minWidth: 120, borderRadius: 14, backgroundColor: "#F3F7F8", padding: 13 },
  statLabel: { color: "#8298A2", fontSize: 7, fontWeight: "900", letterSpacing: 0.9 },
  statValue: { color: "#102A43", fontSize: 12, fontWeight: "900", marginTop: 5 },
  addressCard: { borderRadius: 14, borderWidth: 1, borderColor: "#DCE7EA", padding: 14 },
  addressLabel: { color: "#8298A2", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  addressValue: { color: "#102A43", fontSize: 11, lineHeight: 18, fontWeight: "700", marginTop: 6 },
  mapButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#071D2D", paddingHorizontal: 16 },
  mapButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  privacyNote: { color: "#8298A2", fontSize: 9, lineHeight: 15, textAlign: "center" },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
});

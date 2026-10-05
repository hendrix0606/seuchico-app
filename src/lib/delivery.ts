import * as Linking from "expo-linking";
import { supabase } from "./supabase";
import type {
  Coordinate,
  DeliveryOrder,
  DeliveryRoute,
} from "../types/delivery";

export async function computeDeliveryRoute(
  orderId: string,
  origin: Coordinate,
) {
  const { data, error } = await supabase.functions.invoke(
    "compute-delivery-route",
    {
      body: {
        order_id: orderId,
        origin,
      },
    },
  );

  if (error) {
    throw new Error("ROUTE_FUNCTION_ERROR");
  }

  const route = data?.route as DeliveryRoute | undefined;

  if (
    !route ||
    !Array.isArray(route.coordinates) ||
    route.coordinates.length < 2
  ) {
    throw new Error("INVALID_ROUTE_RESPONSE");
  }

  return route;
}

export function formatDeliveryAddress(order: DeliveryOrder) {
  const complement = order.delivery_complement
    ? `, ${order.delivery_complement}`
    : "";

  return `${order.delivery_street}, ${order.delivery_number}${complement} · ${order.delivery_neighborhood} · ${order.delivery_city}/${order.delivery_state} · CEP ${order.delivery_zip_code}`;
}

export function formatDistance(distanceMeters: number | null) {
  if (distanceMeters === null) return "Calculando distância";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDuration(durationSeconds: number | null) {
  if (durationSeconds === null) return "Tempo em cálculo";
  const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
  if (minutes < 60) return `aprox. ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `aprox. ${hours}h ${remainingMinutes}min`
    : `aprox. ${hours}h`;
}

export function formatLocationTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export async function openExternalRoute(
  order: DeliveryOrder,
  origin?: Coordinate | null,
) {
  const destination = encodeURIComponent(
    `${order.delivery_street}, ${order.delivery_number}, ${order.delivery_neighborhood}, ${order.delivery_city} - ${order.delivery_state}, ${order.delivery_zip_code}, Brasil`,
  );
  const originQuery = origin
    ? `&origin=${origin.latitude},${origin.longitude}`
    : "";
  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}${originQuery}&travelmode=driving`;

  await Linking.openURL(url);
}

export function statusLabel(status: DeliveryOrder["status"]) {
  if (status === "out_for_delivery") return "SAIU PARA ENTREGA";
  if (status === "ready_for_delivery") return "PRONTO PARA ENTREGA";
  if (status === "delivered") return "ENTREGUE";
  if (status === "in_production") return "EM PRODUÇÃO";
  if (status === "paid") return "PAGO";
  if (status === "cancelled") return "CANCELADO";
  return "AGUARDANDO PAGAMENTO";
}

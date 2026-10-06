import { supabase } from "./supabase";

export type MyRating = { order_id: string; rating: number; comment: string | null };

export type CourierRatingSummary = {
  courier_id: string | null;
  courier_name: string;
  rating_count: number;
  rating_average: number;
};

export type RecentRating = {
  id: string;
  order_id: string;
  courier_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
};

// Antes do SQL 018 a tabela nao existe: as consultas devolvem vazio em vez de
// derrubar a tela.
export async function fetchMyRatings(orderIds: string[]) {
  if (orderIds.length === 0) return [] as MyRating[];

  const { data, error } = await supabase
    .from("courier_ratings")
    .select("order_id, rating, comment")
    .in("order_id", orderIds);

  if (error) return [] as MyRating[];
  return (data ?? []) as MyRating[];
}

export async function rateCourier(orderId: string, rating: number, comment: string) {
  const { error } = await supabase.rpc("rate_order_courier", {
    p_order_id: orderId,
    p_rating: rating,
    p_comment: comment.trim() || null,
  });

  if (error) throw error;
}

export async function fetchRatingSummary() {
  const { data, error } = await supabase.rpc("admin_courier_rating_summary");
  if (error) return null;

  return ((data ?? []) as CourierRatingSummary[]).map((item) => ({
    ...item,
    rating_count: Number(item.rating_count),
    rating_average: Number(item.rating_average),
  }));
}

export async function fetchRecentComments(limit = 5) {
  const { data, error } = await supabase
    .from("courier_ratings")
    .select("id, order_id, courier_id, rating, comment, created_at")
    .not("comment", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [] as RecentRating[];
  return (data ?? []) as RecentRating[];
}

export function translateRatingError(message: string) {
  if (message.includes("ALREADY_RATED")) return "Este pedido já foi avaliado.";
  if (message.includes("ORDER_NOT_DELIVERED")) return "Você só pode avaliar depois da entrega.";
  if (message.includes("INVALID_RATING")) return "Escolha de 1 a 5 estrelas.";
  if (message.includes("COMMENT_TOO_LONG")) return "O comentário pode ter até 500 caracteres.";
  return "Não foi possível enviar a avaliação. Confirme se o SQL da Etapa 18 foi executado.";
}

export function formatAverage(value: number) {
  return value.toFixed(1).replace(".", ",");
}

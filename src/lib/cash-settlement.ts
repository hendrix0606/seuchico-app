import { supabase } from "./supabase";

export type CashBalance = {
  courier_id: string;
  courier_name: string;
  received_cents: number;
  settled_cents: number;
  balance_cents: number;
};

// Antes do SQL 019 a funcao nao existe: devolve null e a tela esconde o painel.
export async function fetchCashBalances() {
  const { data, error } = await supabase.rpc("courier_cash_balances");
  if (error) return null;

  return ((data ?? []) as CashBalance[]).map((item) => ({
    ...item,
    received_cents: Number(item.received_cents),
    settled_cents: Number(item.settled_cents),
    balance_cents: Number(item.balance_cents),
  }));
}

export async function registerCashSettlement(
  courierId: string,
  amountCents: number,
  note: string,
) {
  const { error } = await supabase.rpc("admin_register_cash_settlement", {
    p_courier_id: courierId,
    p_amount_cents: amountCents,
    p_note: note.trim() || null,
  });

  if (error) throw error;
}

export async function reportCashRefusal(orderId: string, note: string) {
  const { error } = await supabase.rpc("courier_report_cash_refusal", {
    p_order_id: orderId,
    p_note: note.trim(),
  });

  if (error) throw error;
}

export type BlockedClient = {
  client_id: string;
  client_name: string;
  client_phone: string | null;
  refused_at: string;
  refusal_note: string | null;
  blocked_until: string;
};

// Antes do SQL 020 a funcao nao existe: devolve null e o painel fica escondido.
export async function fetchBlockedClients() {
  const { data, error } = await supabase.rpc("admin_cash_blocked_clients");
  if (error) return null;
  return (data ?? []) as BlockedClient[];
}

export async function releaseCashBlock(clientId: string) {
  const { error } = await supabase.rpc("admin_release_cash_block", {
    p_client_id: clientId,
    p_note: null,
  });

  if (error) throw error;
}

export function translateSettlementError(message: string) {
  if (message.includes("AMOUNT_EXCEEDS_BALANCE")) return "O valor é maior que o saldo a repassar deste entregador.";
  if (message.includes("INVALID_AMOUNT")) return "Informe um valor maior que zero.";
  if (message.includes("NOTE_TOO_LONG")) return "A observação pode ter até 300 caracteres.";
  return "Não foi possível registrar o repasse. Confirme se o SQL da Etapa 19 foi executado.";
}

export function translateRefusalError(message: string) {
  if (message.includes("NOTE_REQUIRED")) return "Descreva o motivo da recusa (mínimo de 3 caracteres).";
  if (message.includes("NOT_CASH_ON_DELIVERY")) return "Este pedido não é de dinheiro a receber.";
  if (message.includes("INVALID_STATUS_TRANSITION")) return "A recusa só pode ser registrada com o pedido em entrega.";
  return "Não foi possível registrar a recusa. Atualize a tela e tente novamente.";
}

import type {
  FinancialCategory,
  FinancialEntry,
  FinancialOrder,
  FinancialSettings,
  FinancialSummary,
  OrderCostBreakdown,
} from "../types/finance";

export function estimateOrderCost(
  order: FinancialOrder,
  settings: FinancialSettings,
): OrderCostBreakdown {
  const materialCents = order.quantity * settings.material_cost_per_ticket_cents;
  const printingCents = order.quantity * settings.printing_cost_per_ticket_cents;
  const paymentFeeCents =
    order.payment_provider === "stripe"
      ? Math.round((order.total_cents * settings.payment_fee_basis_points) / 10_000) +
        settings.payment_fixed_fee_cents
      : 0;
  const deliveryCents = settings.delivery_operational_cost_cents;
  const otherCents = settings.other_cost_per_order_cents;

  return {
    material_cents: materialCents,
    printing_cents: printingCents,
    payment_fee_cents: paymentFeeCents,
    delivery_cents: deliveryCents,
    other_cents: otherCents,
    total_cents:
      materialCents + printingCents + paymentFeeCents + deliveryCents + otherCents,
  };
}

export function calculateFinancialSummary(
  orders: FinancialOrder[],
  entries: FinancialEntry[],
  settings: FinancialSettings,
): FinancialSummary {
  const revenueOrders = orders.filter((order) =>
    ["paid", "refunded"].includes(order.payment_status),
  );
  const orderRevenue = revenueOrders.reduce((total, order) => total + order.total_cents, 0);
  const manualRevenue = entries
    .filter((entry) => entry.entry_type === "revenue")
    .reduce((total, entry) => total + entry.amount_cents, 0);
  const orderRefunds = revenueOrders
    .filter((order) => order.payment_status === "refunded")
    .reduce((total, order) => total + order.total_cents, 0);
  const manualRefunds = entries
    .filter((entry) => entry.entry_type === "refund")
    .reduce((total, entry) => total + entry.amount_cents, 0);
  const recordedExpenses = entries
    .filter((entry) => entry.entry_type === "expense")
    .reduce((total, entry) => total + entry.amount_cents, 0);
  const estimatedOrderCosts = revenueOrders.reduce(
    (total, order) => total + estimateOrderCost(order, settings).total_cents,
    0,
  );
  const grossRevenue = orderRevenue + manualRevenue;
  const refunds = orderRefunds + manualRefunds;
  const netRevenue = grossRevenue - refunds;
  const totalCosts = estimatedOrderCosts + recordedExpenses;
  const estimatedProfit = netRevenue - totalCosts;

  return {
    gross_revenue_cents: grossRevenue,
    refunds_cents: refunds,
    net_revenue_cents: netRevenue,
    estimated_order_costs_cents: estimatedOrderCosts,
    recorded_expenses_cents: recordedExpenses,
    total_costs_cents: totalCosts,
    estimated_profit_cents: estimatedProfit,
    margin_percent: netRevenue > 0 ? (estimatedProfit / netRevenue) * 100 : 0,
    average_ticket_cents:
      revenueOrders.length > 0 ? Math.round(orderRevenue / revenueOrders.length) : 0,
    paid_orders: revenueOrders.length,
    units_sold: revenueOrders.reduce((total, order) => total + order.quantity, 0),
  };
}

export function financialCategoryLabel(category: FinancialCategory) {
  const labels: Record<FinancialCategory, string> = {
    ticket_sale: "Venda de ingressos",
    material: "Materiais",
    printing: "Impressão",
    delivery: "Entrega",
    payment_fee: "Taxas de pagamento",
    marketing: "Marketing",
    software: "Software e serviços",
    tax: "Impostos",
    refund: "Reembolso",
    other: "Outros",
  };
  return labels[category];
}

export function parseMoneyInput(value: string) {
  const cleaned = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function formatMoneyInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function parsePercentInput(value: string) {
  const amount = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return null;
  return Math.round(amount * 100);
}

export function formatPercentInput(basisPoints: number) {
  return (basisPoints / 100).toFixed(2).replace(".", ",");
}

export function isRevenueOrder(order: FinancialOrder) {
  return order.payment_status === "paid" || order.payment_status === "refunded";
}

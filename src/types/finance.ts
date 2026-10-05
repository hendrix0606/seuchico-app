export type FinancialEntryType = "revenue" | "expense" | "refund";

export type FinancialCategory =
  | "ticket_sale"
  | "material"
  | "printing"
  | "delivery"
  | "payment_fee"
  | "marketing"
  | "software"
  | "tax"
  | "refund"
  | "other";

export type FinancialSettings = {
  id: number;
  material_cost_per_ticket_cents: number;
  printing_cost_per_ticket_cents: number;
  payment_fee_basis_points: number;
  payment_fixed_fee_cents: number;
  delivery_operational_cost_cents: number;
  other_cost_per_order_cents: number;
  updated_at: string;
};

export type PricingSettings = {
  id: number;
  unit_price_cents: number;
  delivery_fee_cents: number;
  updated_at: string;
};

export type FinancialEntry = {
  id: number;
  entry_type: FinancialEntryType;
  category: FinancialCategory;
  description: string;
  amount_cents: number;
  occurred_on: string;
  order_id: string | null;
  created_at: string;
};

export type FinancialOrder = {
  id: string;
  order_number: number;
  user_id: string;
  payment_provider: "stripe" | "pix";
  status:
    | "awaiting_payment"
    | "paid"
    | "in_production"
    | "ready_for_delivery"
    | "out_for_delivery"
    | "delivered"
    | "cancelled";
  payment_status:
    | "pending"
    | "creating"
    | "processing"
    | "paid"
    | "failed"
    | "cancelled"
    | "refunded";
  quantity: number;
  total_cents: number;
  delivery_city: string;
  delivery_state: string;
  created_at: string;
  paid_at: string | null;
  ticket_drafts: {
    event_name: string;
    ticket_templates: {
      name: string;
      category: "party" | "wedding" | "show" | "corporate";
    } | null;
  } | null;
};

export type OrderCostBreakdown = {
  material_cents: number;
  printing_cents: number;
  payment_fee_cents: number;
  delivery_cents: number;
  other_cents: number;
  total_cents: number;
};

export type FinancialSummary = {
  gross_revenue_cents: number;
  refunds_cents: number;
  net_revenue_cents: number;
  estimated_order_costs_cents: number;
  recorded_expenses_cents: number;
  total_costs_cents: number;
  estimated_profit_cents: number;
  margin_percent: number;
  average_ticket_cents: number;
  paid_orders: number;
  units_sold: number;
};

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type DeliveryRoute = {
  coordinates: Coordinate[];
  distance_meters: number | null;
  duration_seconds: number | null;
  destination_address: string;
};

export type DeliveryLocation = Coordinate & {
  order_id: string;
  courier_id: string;
  accuracy_meters: number | null;
  heading_degrees: number | null;
  speed_mps: number | null;
  recorded_at: string;
  updated_at: string;
};

export type DeliveryOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "in_production"
  | "ready_for_delivery"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type DeliveryOrder = {
  id: string;
  order_number: number;
  user_id: string;
  assigned_courier_id: string | null;
  status: DeliveryOrderStatus;
  payment_status: string;
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
  updated_at: string;
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

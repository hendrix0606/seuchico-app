import type { UserRole } from "../context/auth-context";
import type { DeliveryOrderStatus } from "./delivery";

export type OrderMessage = {
  id: number;
  order_id: string;
  sender_id: string | null;
  sender_role: UserRole;
  sender_name: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type ChatOrder = {
  id: string;
  order_number: number;
  user_id: string;
  assigned_courier_id: string | null;
  status: DeliveryOrderStatus;
  ticket_drafts: {
    event_name: string;
  } | null;
};

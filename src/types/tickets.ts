export type TicketCategory = "party" | "wedding" | "show" | "corporate";

export type TicketTemplate = {
  id: string;
  slug: string;
  name: string;
  category: TicketCategory;
  description: string;
  primary_color: string;
  accent_color: string;
  sort_order: number;
};

export type TicketDraft = {
  id: string;
  template_id: string;
  event_name: string;
  event_date: string;
  event_time: string;
  location: string;
  primary_color: string;
  accent_color: string;
  quantity: number;
  notes: string | null;
  status?: "draft" | "ordered";
  updated_at: string;
};

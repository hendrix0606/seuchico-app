export type PixKeyType = "random" | "email" | "phone" | "cpf" | "cnpj";

export type PixSettings = {
  id: number;
  is_enabled: boolean;
  pix_key: string | null;
  pix_key_type: PixKeyType;
  recipient_name: string | null;
  recipient_city: string | null;
  pix_copy_paste: string | null;
  instructions: string | null;
  updated_at: string;
};

export type PixSubmissionStatus = "pending" | "approved" | "rejected";

export type PixPaymentSubmission = {
  id: string;
  order_id: string;
  client_id: string;
  proof_path: string;
  proof_name: string;
  proof_mime_type: string | null;
  customer_note: string | null;
  status: PixSubmissionStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

import { supabase } from "@/integrations/supabase/client";

export type Customer = {
  id: string; user_id: string; name: string; phone: string | null; address: string | null;
  category?: string | null; company_name?: string | null; contact_person?: string | null;
  sales_channel?: string | null; sales_event_id?: string | null; source_notes?: string | null;
  created_at: string; updated_at: string;
  created_by_email?: string | null; updated_by_email?: string | null;
};
export type SalesEvent = {
  id: string; name: string; year: number | null; event_type: string | null;
  starts_at: string | null; ends_at: string | null; location: string | null; notes: string | null;
  is_active: boolean; created_at: string; updated_at: string;
};
export type Product = {
  id: string; user_id: string; name: string; serial_number: string | null; color: string | null;
  price: number; stock_quantity: number; low_stock_threshold: number; qr_code: string | null;
  image_url?: string | null;
  collection?: string | null;
  cost_price?: number;
  is_spare_part?: boolean | null;
  parent_product_id?: string | null;
  reserved_quantity?: number | null;
  available_quantity?: number | null;
  created_at: string; updated_at: string;
  created_by_email?: string | null; updated_by_email?: string | null;
};

export const COLLECTIONS = ["JOY", "UP", "ART", "QUATRO"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export type Invoice = {
  id: string; user_id: string; invoice_number: string;
  customer_id: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null;
  customer_category?: string | null; sales_channel?: string | null; sales_event_id?: string | null;
  subtotal: number; discount: number; total: number;
  notes: string | null; status: string; language: string;
  created_at: string; updated_at: string;
};
export type InvoiceItem = {
  id: string; invoice_id: string; product_id: string | null;
  product_name: string; serial_number: string | null; color: string | null;
  quantity: number; unit_price: number; discount: number; line_total: number;
  created_at: string;
};
export type Settings = {
  id: string; user_id: string;
  company_name: string | null; company_address: string | null; company_phone: string | null; company_email: string | null;
  logo_url: string | null;
  payment_terms: string | null; delivery_terms: string | null;
  social_facebook: string | null; social_instagram: string | null; social_twitter: string | null; social_website: string | null;
  currency: string; default_language: string;
};

export async function getSettings(userId: string): Promise<Settings | null> {
  const { data } = await supabase.from("settings").select("*").eq("user_id", userId).maybeSingle();
  return data as Settings | null;
}

export async function upsertSettings(userId: string, patch: Partial<Settings>) {
  const existing = await getSettings(userId);
  if (existing) {
    const { error } = await supabase.from("settings").update(patch).eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("settings").insert({ user_id: userId, ...patch } as any);
    if (error) throw error;
  }
}

export async function nextInvoiceNumber(userId: string) {
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  const n = (count ?? 0) + 1;
  const yr = new Date().getFullYear();
  return `INV-${yr}-${String(n).padStart(4, "0")}`;
}

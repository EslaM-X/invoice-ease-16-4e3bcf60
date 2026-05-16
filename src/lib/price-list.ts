import { supabase } from "@/integrations/supabase/client";

export type PriceListItem = {
  id: string;
  sku: string;
  name_en: string;
  name_ar: string | null;
  collection: "JOY" | "UP" | "ART" | "QUATRO";
  category: string;
  color: string | null;
  color_hex: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  qr_payload: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_email?: string | null;
};

export type PriceHistoryEntry = {
  id: string;
  item_id: string;
  old_price: number | null;
  new_price: number | null;
  changed_by_email: string | null;
  changed_at: string;
};

export async function listPriceItems(): Promise<PriceListItem[]> {
  const { data, error } = await supabase
    .from("price_list_items")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PriceListItem[];
}

export async function updatePriceItemPrice(id: string, newPrice: number, userEmail: string | null) {
  const { error } = await supabase
    .from("price_list_items")
    .update({ price: newPrice, updated_by_email: userEmail })
    .eq("id", id);
  if (error) throw error;
}

export async function updatePriceItemImage(id: string, imageUrl: string) {
  const { error } = await supabase
    .from("price_list_items")
    .update({ image_url: imageUrl })
    .eq("id", id);
  if (error) throw error;
}

export async function uploadPriceItemImage(sku: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${sku}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("price-list-images")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("price-list-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function getPriceHistory(itemId: string): Promise<PriceHistoryEntry[]> {
  const { data, error } = await supabase
    .from("price_list_price_history")
    .select("*")
    .eq("item_id", itemId)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as PriceHistoryEntry[];
}

export function formatPrice(n: number, currency = "LE") {
  return `${n.toLocaleString("en-US")} ${currency}`;
}

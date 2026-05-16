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

const CACHE_KEY = "price_list_items_cache_v1";

const readCache = (): PriceListItem[] | null => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PriceListItem[]) : null;
  } catch {
    return null;
  }
};

const writeCache = (items: PriceListItem[]) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CACHE_KEY, JSON.stringify(items));
  } catch {}
};

/** Cached list — returns localStorage instantly if available, then revalidates. */
export function getCachedPriceItems(): PriceListItem[] {
  return readCache() ?? [];
}

export async function listPriceItems(): Promise<PriceListItem[]> {
  try {
    const { data, error } = await supabase
      .from("price_list_items")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const items = (data ?? []) as PriceListItem[];
    writeCache(items);
    return items;
  } catch (err) {
    // Offline fallback — return cache so the page stays usable.
    const cached = readCache();
    if (cached && cached.length > 0) return cached;
    throw err;
  }
}

/** Look up a single price-list item by its QR payload (PL1:SKU) — cache first. */
export async function findPriceItemByPayload(payload: string): Promise<PriceListItem | null> {
  const cached = readCache();
  if (cached) {
    const hit = cached.find((i) => i.qr_payload === payload);
    if (hit) return hit;
  }
  const { data, error } = await supabase
    .from("price_list_items")
    .select("*")
    .eq("qr_payload", payload)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return null;
  return (data as PriceListItem) ?? null;
}

export async function createPriceItem(input: {
  sku: string;
  name_en: string;
  collection: string;
  category: string;
  color?: string | null;
  color_hex?: string | null;
  price: number;
  currency?: string;
  sort_order?: number;
}): Promise<PriceListItem> {
  const payload = `PL1:${input.sku}`;
  const { data, error } = await supabase
    .from("price_list_items")
    .insert({
      sku: input.sku,
      name_en: input.name_en,
      collection: input.collection,
      category: input.category,
      color: input.color ?? null,
      color_hex: input.color_hex ?? null,
      price: input.price,
      currency: input.currency ?? "LE",
      qr_payload: payload,
      sort_order: input.sort_order ?? 9999,
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PriceListItem;
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

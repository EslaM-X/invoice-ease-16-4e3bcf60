import { supabase } from "@/integrations/supabase/client";

export type ScanSession = {
  id: string;
  user_id: string;
  pair_code: string;
  mode: "new" | "edit";
  invoice_id: string | null;
  status: "waiting" | "paired" | "closed";
  paired_at: string | null;
  expires_at: string;
  created_at: string;
};

export type ScanEvent = {
  id: string;
  session_id: string;
  user_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  unit_price: number;
  quantity: number;
  status: "pending" | "applied" | "failed";
  error_message: string | null;
  created_at: string;
};

const gen6 = () => {
  // 6-digit code, zero-padded, never starts with 0 to avoid leading-zero loss
  const n = 100000 + Math.floor(Math.random() * 900000);
  return String(n);
};

export async function createScanSession(opts: {
  userId: string;
  mode: "new" | "edit";
  invoiceId?: string | null;
}): Promise<ScanSession> {
  // Try a few times in case of pair_code collision (very unlikely with active sessions)
  for (let i = 0; i < 5; i++) {
    const code = gen6();
    const { data, error } = await supabase
      .from("scan_sessions")
      .insert({
        user_id: opts.userId,
        pair_code: code,
        mode: opts.mode,
        invoice_id: opts.invoiceId ?? null,
      })
      .select("*")
      .single();
    if (!error && data) return data as ScanSession;
    if (error && !String(error.message).toLowerCase().includes("duplicate")) {
      throw error;
    }
  }
  throw new Error("Could not create scan session");
}

export async function closeScanSession(sessionId: string) {
  await supabase
    .from("scan_sessions")
    .update({ status: "closed" })
    .eq("id", sessionId);
}

export async function pairScanSessionByCode(pairCode: string): Promise<string> {
  const { data, error } = await supabase.rpc("pair_scan_session", {
    _pair_code: pairCode,
  } as any);
  if (error) throw error;
  return data as string;
}

export async function getSessionById(sessionId: string): Promise<ScanSession | null> {
  const { data } = await supabase
    .from("scan_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  return (data as ScanSession) ?? null;
}

export async function pushScanEvent(opts: {
  sessionId: string;
  userId: string;
  product: {
    id: string;
    name: string;
    price: number;
    serial_number?: string | null;
    color?: string | null;
  };
}) {
  const { error } = await supabase.from("scan_events").insert({
    session_id: opts.sessionId,
    user_id: opts.userId,
    product_id: opts.product.id,
    product_name: opts.product.name,
    serial_number: opts.product.serial_number ?? null,
    color: opts.product.color ?? null,
    unit_price: Number(opts.product.price ?? 0),
    quantity: 1,
  });
  if (error) throw error;
}

export async function markEventApplied(eventId: string) {
  await supabase.from("scan_events").update({ status: "applied" }).eq("id", eventId);
}

export async function markEventFailed(eventId: string, message: string) {
  await supabase
    .from("scan_events")
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("id", eventId);
}

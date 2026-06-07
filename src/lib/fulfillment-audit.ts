import { supabase } from "@/integrations/supabase/client";
import type { Suggestion, DeliveryMode } from "./fulfillment-engine";

export type FulfillmentAuditAction = "closed" | "partial_close" | "snapshot";

export async function logFulfillmentAction(
  userId: string,
  s: Suggestion,
  mode: DeliveryMode,
  action: FulfillmentAuditAction,
  note?: string | null,
) {
  const row = {
    user_id: userId,
    invoice_id: s.invoice.id,
    invoice_number: s.invoice.invoice_number,
    action,
    tier: s.tier,
    mode,
    confidence: s.confidence,
    total_needed: s.totalNeeded,
    total_from_stock: s.totalFromStock,
    total_from_incoming: s.totalFromIncoming,
    total_shortfall: s.totalShortfall,
    manual_count: s.manualCount,
    reasons: s.reasons as any,
    needs: s.needs as any,
    note: note ?? null,
  };
  const { error } = await supabase.from("fulfillment_audit_log" as any).insert(row as any);
  if (error) throw error;
}

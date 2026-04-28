import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, X, QrCode, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  closeScanSession,
  createScanSession,
  markEventApplied,
  markEventFailed,
  type ScanEvent,
  type ScanSession,
} from "@/lib/scan-link";
import { toast } from "sonner";

type Props = {
  mode: "new" | "edit";
  invoiceId?: string | null;
  /**
   * Called when a scan event arrives. Should add the product to the invoice.
   * Return true if applied successfully, false (or throw) if rejected.
   */
  onScanEvent: (ev: ScanEvent) => Promise<boolean> | boolean;
};

export function DesktopPairWidget({ mode, invoiceId, onScanEvent }: Props) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [session, setSession] = useState<ScanSession | null>(null);
  const [showQr, setShowQr] = useState(true);
  const [creating, setCreating] = useState(false);
  const sessionRef = useRef<ScanSession | null>(null);
  const handlerRef = useRef(onScanEvent);
  handlerRef.current = onScanEvent;
  const seen = useRef<Set<string>>(new Set());

  // Build a payload encoded in QR. Mobile reads { kind: "scanlink", code, sessionId }.
  const qrPayload = session
    ? JSON.stringify({ kind: "scanlink", code: session.pair_code, sessionId: session.id })
    : "";

  const start = async () => {
    if (!user || creating) return;
    setCreating(true);
    try {
      const s = await createScanSession({
        userId: user.id,
        mode,
        invoiceId: invoiceId ?? null,
      });
      setSession(s);
      sessionRef.current = s;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start pairing");
    } finally {
      setCreating(false);
    }
  };

  const stop = async () => {
    const s = sessionRef.current;
    if (s) await closeScanSession(s.id).catch(() => {});
    setSession(null);
    sessionRef.current = null;
    seen.current.clear();
  };

  // Auto-start on mount
  useEffect(() => {
    start();
    return () => {
      // close session when widget unmounts
      const s = sessionRef.current;
      if (s) closeScanSession(s.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Realtime subscriptions: session status + incoming scan events
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`scanlink-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scan_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload: any) => {
          const next = payload.new as ScanSession;
          setSession((prev) => (prev ? { ...prev, ...next } : next));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scan_events",
          filter: `session_id=eq.${session.id}`,
        },
        async (payload: any) => {
          const ev = payload.new as ScanEvent;
          if (seen.current.has(ev.id)) return;
          seen.current.add(ev.id);
          try {
            const ok = await handlerRef.current(ev);
            if (ok) {
              await markEventApplied(ev.id);
              toast.success(`+ ${ev.product_name}`, { duration: 1500 });
            } else {
              await markEventFailed(ev.id, "rejected");
            }
          } catch (e: any) {
            await markEventFailed(ev.id, e?.message ?? "error");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.id]);

  if (!user) return null;

  const paired = session?.status === "paired";

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-sm font-semibold">{t("mobile_scanner")}</div>
            <div className="text-xs text-muted-foreground">{t("mobile_scanner_hint")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session && (
            <Button variant="ghost" size="sm" onClick={() => setShowQr((v) => !v)} className="gap-1.5">
              <QrCode className="h-3.5 w-3.5" />
              {showQr ? t("hide_qr") : t("show_qr")}
            </Button>
          )}
          {session && (
            <Button variant="ghost" size="icon" onClick={stop} title={t("stop_pairing")}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {session && (
        <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-stretch">
          {showQr && (
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <QRCodeSVG value={qrPayload} size={132} level="M" includeMargin={false} />
            </div>
          )}
          <div className="flex flex-1 flex-col justify-center gap-2 text-center sm:text-start">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("pair_code")}
              </div>
              <div
                className="mt-0.5 font-mono text-3xl font-bold tracking-[0.3em] text-primary"
                dir="ltr"
              >
                {session.pair_code}
              </div>
            </div>
            <div className="text-sm">
              {paired ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-semibold text-success">
                  <Check className="h-3.5 w-3.5" />
                  {t("mobile_paired")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-warning">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-warning" />
                  {t("waiting_for_mobile")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

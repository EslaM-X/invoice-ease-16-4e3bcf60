import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanner } from "@/components/qr-scanner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  closeScanSession,
  getSessionById,
  pairScanSessionByCode,
  pushScanEvent,
  type ScanSession,
} from "@/lib/scan-link";
import { enqueueScan, flushQueue, queueLength } from "@/lib/scan-buffer";
import { toast } from "sonner";
import { Smartphone, ScanLine, Unlink, Check, WifiOff, CloudUpload } from "lucide-react";

export const Route = createFileRoute("/scan-and-sell")({
  component: () => (
    <AppShell>
      <ScanAndSellPage />
    </AppShell>
  ),
});

function ScanAndSellPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [session, setSession] = useState<ScanSession | null>(null);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const beepCtx = useRef<AudioContext | null>(null);
  const recentScans = useRef<Map<string, number>>(new Map());

  // Watch session status (auto-unpair if desktop closes session)
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`scanlink-mobile-${session.id}`)
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
          if (next.status === "closed") {
            setSession(null);
            setScanning(false);
            toast.info(lang === "ar" ? "تم إنهاء الجلسة من الكمبيوتر" : "Session ended on desktop");
          } else {
            setSession((prev) => (prev ? { ...prev, ...next } : next));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.id, lang]);

  const beep = () => {
    try {
      if (!beepCtx.current)
        beepCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = beepCtx.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } catch {}
  };

  const tryPair = async (rawCode: string) => {
    if (!user || pairing) return;
    const cleaned = String(rawCode).replace(/\D/g, "").slice(0, 6);
    if (cleaned.length !== 6) {
      toast.error(t("pair_failed"));
      return;
    }
    setPairing(true);
    try {
      const sessionId = await pairScanSessionByCode(cleaned);
      const s = await getSessionById(sessionId);
      if (!s) throw new Error(t("pair_failed"));
      setSession(s);
      setCode("");
      setScanning(true);
      toast.success(t("paired_successfully"));
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      toast.error(
        msg.includes("INVALID_OR_EXPIRED_CODE") || msg.includes("22023")
          ? t("pair_failed")
          : msg || t("pair_failed")
      );
    } finally {
      setPairing(false);
    }
  };

  const unpair = async () => {
    if (session) await closeScanSession(session.id).catch(() => {});
    setSession(null);
    setScanning(false);
  };

  const handleScan = async (text: string) => {
    if (!user || !session) return;
    const raw = (text ?? "").trim();

    // Check if this is a pair-link QR (legacy: ignore if already paired)
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.kind === "scanlink") {
        // Already paired — ignore pair QRs while scanning
        return;
      }
    } catch {}

    // Debounce duplicate scans within 1.5s
    const now = Date.now();
    const last = recentScans.current.get(raw) ?? 0;
    if (now - last < 1500) return;
    recentScans.current.set(raw, now);

    let productId: string | null = null;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(raw)) {
      productId = raw;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.product_id === "string" && uuidRe.test(parsed.product_id)) {
          productId = parsed.product_id;
        }
      } catch {}
    }
    if (!productId) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    const { data: p, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .maybeSingle();
    if (error || !p) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    try {
      await pushScanEvent({
        sessionId: session.id,
        userId: user.id,
        product: {
          id: p.id,
          name: p.name,
          price: Number(p.price ?? 0),
          serial_number: p.serial_number,
          color: p.color,
        },
      });
      beep();
      setLastAdded(p.name);
      toast.success(`✓ ${p.name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    }
    if (!continuous) setScanning(false);
  };

  // Camera-based pair-code QR scan (when not yet paired)
  const handlePairScan = async (text: string) => {
    const raw = (text ?? "").trim();
    let pairCode: string | null = null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.kind === "scanlink" && typeof parsed.code === "string") {
        pairCode = parsed.code;
      }
    } catch {}
    if (!pairCode && /^\d{6}$/.test(raw)) pairCode = raw;
    if (!pairCode) {
      toast.error(t("pair_failed"));
      return;
    }
    setScanning(false);
    await tryPair(pairCode);
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("scan_and_sell")}</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
          ←
        </Button>
      </div>

      {!session ? (
        <div className="space-y-4 rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">{t("scan_link_invoice")}</div>
              <div className="text-xs text-muted-foreground">{t("scan_or_enter_code")}</div>
            </div>
          </div>

          {scanning ? (
            <>
              <QrScanner onScan={handlePairScan} onClose={() => setScanning(false)} />
            </>
          ) : (
            <Button onClick={() => setScanning(true)} className="w-full gap-2" size="lg">
              <ScanLine className="h-4 w-4" />
              {t("scan_qr")}
            </Button>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">— {lang === "ar" ? "أو" : "or"} —</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("enter_pair_code")}</label>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") tryPair(code);
                }}
                placeholder="123456"
                dir="ltr"
                className="text-center font-mono text-2xl tracking-[0.3em]"
              />
              <Button onClick={() => tryPair(code)} disabled={pairing || code.length !== 6}>
                {t("pair")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-success/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/15 text-success">
                  <Check className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{t("mobile_paired")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("scan_to_invoice")} • {session.mode === "edit" ? t("edit_invoice") : t("new_invoice")}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={unpair} className="gap-1.5 text-destructive">
                <Unlink className="h-3.5 w-3.5" />
                {t("unpair")}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={continuous}
                  onChange={(e) => setContinuous(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                {t("continuous_scan")}
              </label>
              {!scanning && (
                <Button size="sm" onClick={() => setScanning(true)} className="gap-1.5">
                  <ScanLine className="h-3.5 w-3.5" />
                  {t("scan")}
                </Button>
              )}
            </div>

            {scanning ? (
              <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />
            ) : (
              <div className="rounded-xl border-2 border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                {lang === "ar" ? "اضغط مسح لبدء قراءة المنتجات" : "Press scan to start reading products"}
              </div>
            )}

            {lastAdded && (
              <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                ✓ {t("product_added_to_invoice")}: <span className="font-semibold">{lastAdded}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

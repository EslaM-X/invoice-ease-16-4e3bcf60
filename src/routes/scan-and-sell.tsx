import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanner } from "@/components/qr-scanner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchProductCached } from "@/lib/product-cache";
import { decodeProductQR } from "@/lib/qr-codec";
import {
  closeScanSession,
  getSessionById,
  pairScanSessionByCode,
  pushScanEvent,
  type ScanSession,
} from "@/lib/scan-link";
import { enqueueScan, flushQueue, queueLength } from "@/lib/scan-buffer";
import { toast } from "sonner";
import { z } from "zod";
import { Smartphone, ScanLine, Unlink, Check, WifiOff, CloudUpload, History, RefreshCw, X, AlertTriangle } from "lucide-react";

const ProductIdSchema = z.string().trim().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "INVALID_UUID",
);

type ScanLogEntry = {
  id: string;
  at: number;
  raw: string;
  productId: string | null;
  productName: string | null;
  status: "ok" | "queued" | "not_found" | "invalid" | "checksum";
  message: string;
};

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
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState<number>(0);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [history, setHistory] = useState<ScanLogEntry[]>([]);
  const beepCtx = useRef<AudioContext | null>(null);
  const recentScans = useRef<Map<string, number>>(new Map());

  const pushHistory = (entry: Omit<ScanLogEntry, "id" | "at">) => {
    setHistory((prev) => [
      { ...entry, id: Math.random().toString(36).slice(2), at: Date.now() },
      ...prev,
    ].slice(0, 20));
  };

  // Refresh pending count from localStorage
  const refreshPending = () => {
    if (!user) return;
    setPending(queueLength(user.id));
  };

  // Try to flush queued scans to Supabase
  const tryFlush = async (silent = false) => {
    if (!user) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      refreshPending();
      return;
    }
    const before = queueLength(user.id);
    if (before === 0) {
      refreshPending();
      return;
    }
    const flushed = await flushQueue(user.id);
    refreshPending();
    if (flushed > 0 && !silent) {
      toast.success(t("offline_flushed").replace("{n}", String(flushed)));
    }
  };

  // Online / offline listeners + periodic flush safety net
  useEffect(() => {
    if (!user) return;
    refreshPending();
    const goOnline = () => {
      setOnline(true);
      tryFlush(false);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = window.setInterval(() => tryFlush(true), 8000);
    // Initial flush attempt on mount
    tryFlush(true);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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

  /** Push an already-resolved product to the paired session (used by scan + history re-add). */
  const pushProductToSession = async (p: {
    id: string; name: string; price?: number | null;
    serial_number?: string | null; color?: string | null;
  }) => {
    if (!user || !session) return false;
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const queueIt = () => {
      enqueueScan({
        session_id: session.id,
        user_id: user.id,
        product_id: p.id,
        product_name: p.name,
        serial_number: p.serial_number ?? null,
        color: p.color ?? null,
        unit_price: Number(p.price ?? 0),
        quantity: 1,
      });
      refreshPending();
      beep();
      setLastAdded(p.name);
      toast.warning(`✓ ${p.name} — ${t("offline_queued")}`);
    };
    if (isOffline) { queueIt(); return true; }
    try {
      await pushScanEvent({
        sessionId: session.id,
        userId: user.id,
        product: {
          id: p.id, name: p.name, price: Number(p.price ?? 0),
          serial_number: p.serial_number, color: p.color,
        },
      });
      beep();
      setLastAdded(p.name);
      toast.success(`✓ ${p.name}`);
      if (queueLength(user.id) > 0) tryFlush(true);
      return true;
    } catch {
      queueIt();
      return true;
    }
  };

  const reAddFromHistory = async (entry: ScanLogEntry) => {
    if (!entry.productId) return;
    const { product } = await fetchProductCached(entry.productId);
    if (!product) {
      toast.error(lang === "ar" ? "تعذّر إعادة إضافة المنتج" : "Could not re-add product");
      return;
    }
    await pushProductToSession(product as any);
    pushHistory({
      raw: entry.raw,
      productId: product.id,
      productName: product.name,
      status: typeof navigator !== "undefined" && !navigator.onLine ? "queued" : "ok",
      message: lang === "ar" ? "أُعيدت الإضافة" : "Re-added",
    });
  };

  const handleScan = async (text: string) => {
    if (!user || !session) return;
    const raw = (text ?? "").trim();

    const decoded = decodeProductQR(raw);
    if (!decoded.ok) {
      if (decoded.reason === "scanlink") return; // ignore pair QR
      const now = Date.now();
      const last = recentScans.current.get(raw) ?? 0;
      if (now - last < 1500) return;
      recentScans.current.set(raw, now);
      const isChecksum = decoded.reason === "checksum";
      const msg = isChecksum
        ? (lang === "ar" ? "رمز QR تالف (فحص فشل)" : "Corrupted QR (checksum failed)")
        : (lang === "ar" ? "رمز QR غير صالح أو غير متوافق" : "Invalid or unsupported QR");
      toast.error(msg, {
        description: raw.length > 0
          ? (lang === "ar" ? `المحتوى: ${raw.slice(0, 32)}${raw.length > 32 ? "…" : ""}` : `Payload: ${raw.slice(0, 32)}${raw.length > 32 ? "…" : ""}`)
          : undefined,
      });
      pushHistory({
        raw, productId: null, productName: null,
        status: isChecksum ? "checksum" : "invalid", message: msg,
      });
      return;
    }

    // Defense in depth: validate decoded productId shape with zod before any DB call.
    const parsed = ProductIdSchema.safeParse(decoded.productId);
    if (!parsed.success) {
      const msg = lang === "ar" ? "معرّف المنتج غير صالح" : "Invalid product ID format";
      toast.error(msg);
      pushHistory({ raw, productId: decoded.productId, productName: null, status: "invalid", message: msg });
      return;
    }
    const productId = parsed.data.toLowerCase();

    // Debounce duplicate valid scans
    const now = Date.now();
    const last = recentScans.current.get(productId) ?? 0;
    if (now - last < 1500) return;
    recentScans.current.set(productId, now);

    const t0 = performance.now();
    const { product: p, error } = await fetchProductCached(productId);
    setLastFetchMs(Math.round(performance.now() - t0));
    if (error || !p) {
      const msg = lang === "ar" ? "لم يتم العثور على المنتج" : "Product not found";
      toast.error(msg, {
        description: lang === "ar" ? `المعرّف: ${productId.slice(0, 8)}…` : `ID: ${productId.slice(0, 8)}…`,
        action: {
          label: lang === "ar" ? "إعادة المحاولة" : "Retry",
          onClick: async () => {
            const r = await fetchProductCached(productId);
            if (r.product) {
              await pushProductToSession(r.product as any);
              pushHistory({ raw, productId, productName: r.product.name, status: "ok", message: lang === "ar" ? "نجح بعد الإعادة" : "Succeeded on retry" });
            } else {
              toast.error(lang === "ar" ? "فشل مجددًا" : "Failed again");
            }
          },
        },
        duration: 6000,
      });
      pushHistory({ raw, productId, productName: null, status: "not_found", message: msg });
      return;
    }

    const ok = await pushProductToSession(p as any);
    pushHistory({
      raw, productId, productName: p.name,
      status: typeof navigator !== "undefined" && !navigator.onLine ? "queued" : "ok",
      message: ok ? `✓ ${p.name}` : (lang === "ar" ? "فشل" : "Failed"),
    });
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

          {(!online || pending > 0) && (
            <div
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                !online ? "border-warning/40 bg-warning/10 text-warning" : "border-primary/30 bg-primary/5 text-primary"
              }`}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {!online ? <WifiOff className="h-3.5 w-3.5" /> : <CloudUpload className="h-3.5 w-3.5" />}
                {!online
                  ? lang === "ar"
                    ? "لا يوجد اتصال — المسح يُحفظ محلياً"
                    : "Offline — scans saved locally"
                  : t("pending_scans").replace("{n}", String(pending))}
              </div>
              {pending > 0 && online && (
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" onClick={() => tryFlush(false)}>
                  {lang === "ar" ? "إرسال الآن" : "Sync now"}
                </Button>
              )}
            </div>
          )}

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
              <QrScanner onScan={handleScan} onClose={() => setScanning(false)} lastFetchMs={lastFetchMs} />
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

          {history.length > 0 && (
            <div className="rounded-2xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <History className="h-4 w-4 text-primary" />
                  {lang === "ar" ? "آخر محاولات المسح" : "Recent scans"}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {history.length}
                  </span>
                </div>
                <button
                  onClick={() => setHistory([])}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                  {lang === "ar" ? "مسح" : "Clear"}
                </button>
              </div>
              <ul className="space-y-1.5">
                {history.map((h) => {
                  const okStatus = h.status === "ok" || h.status === "queued";
                  const tone =
                    h.status === "ok" ? "border-emerald-500/30 bg-emerald-500/5" :
                    h.status === "queued" ? "border-amber-500/30 bg-amber-500/5" :
                    "border-destructive/30 bg-destructive/5";
                  return (
                    <li key={h.id} className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${tone}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {okStatus
                            ? <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                            : <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}
                          <span className="truncate font-medium">
                            {h.productName ?? (lang === "ar" ? "—" : "—")}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground" dir="ltr">
                            {new Date(h.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span dir="ltr" className="truncate">
                            {h.productId ? `${h.productId.slice(0, 8)}…` : (h.raw.slice(0, 24) || "—")}
                          </span>
                          <span>·</span>
                          <span className="truncate">{h.message}</span>
                        </div>
                      </div>
                      {okStatus && h.productId && (
                        <button
                          onClick={() => reAddFromHistory(h)}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                          title={lang === "ar" ? "إعادة الإضافة للفاتورة" : "Re-add to invoice"}
                        >
                          <RefreshCw className="h-3 w-3" />
                          {lang === "ar" ? "إضافة" : "Add"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

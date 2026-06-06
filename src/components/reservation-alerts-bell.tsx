import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertCircle, AlertTriangle, Package, ShoppingBag, Truck, Zap } from "lucide-react";
import { toast } from "sonner";

type Product = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  stock_quantity: number;
};

type Alert = {
  product: Product;
  reserved: number;
  inStock: number;
  inTransit: number;
  shortBy: number;
  severity: "critical" | "shortfall" | "covered";
};

const IN_TRANSIT_STATUSES = ["ordered", "shipped", "in_warehouse"];
const LS_KEY = "rsv-alerts:last-notified";
const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

function getStored(): { ids: string[]; at: number } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ids: [], at: 0 };
    return JSON.parse(raw);
  } catch {
    return { ids: [], at: 0 };
  }
}
function setStored(ids: string[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ids, at: Date.now() })); } catch {}
}

function fireSystemNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    // Prefer SW registration so notifications survive when tab is closed (installed PWA)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && "showNotification" in reg) {
          reg.showNotification(title, {
            body,
            tag,
            icon: "/favicon.png",
            badge: "/favicon.png",
            requireInteraction: true,
            data: { url: "/in-transit" },
          } as any);
        } else {
          new Notification(title, { body, tag, icon: "/favicon.png" });
        }
      }).catch(() => {
        try { new Notification(title, { body, tag, icon: "/favicon.png" }); } catch {}
      });
    } else {
      new Notification(title, { body, tag, icon: "/favicon.png" });
    }
  } catch {}
}

export function ReservationAlertsBell() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const initRef = useRef(false);

  const load = async () => {
    const [{ data: reservedRpc }, { data: prods }, { data: posRows }] = await Promise.all([
      supabase.rpc("get_reserved_qty_by_product" as any),
      supabase.from("products").select("id,name,serial_number,color,image_url,stock_quantity").limit(2000),
      supabase.from("purchase_orders").select("id,status").in("status", IN_TRANSIT_STATUSES as any).limit(500),
    ]);
    const reservedMap = new Map<string, number>();
    ((reservedRpc as any) ?? []).forEach((r: any) => reservedMap.set(r.product_id, Number(r.reserved_qty || 0)));
    if (reservedMap.size === 0) { setAlerts([]); return; }

    const activePoIds = (posRows ?? []).map((p: any) => p.id);
    const inTransitMap = new Map<string, number>();
    if (activePoIds.length > 0) {
      const { data: poItems } = await supabase
        .from("purchase_order_items")
        .select("po_id,product_id,quantity")
        .in("po_id", activePoIds)
        .in("product_id", Array.from(reservedMap.keys()));
      (poItems ?? []).forEach((it: any) => {
        inTransitMap.set(it.product_id, (inTransitMap.get(it.product_id) ?? 0) + (it.quantity || 0));
      });
    }

    const prodMap = new Map<string, Product>();
    (prods ?? []).forEach((p: any) => prodMap.set(p.id, p));

    const out: Alert[] = [];
    reservedMap.forEach((reserved, pid) => {
      const p = prodMap.get(pid);
      if (!p) return;
      const inStock = p.stock_quantity ?? 0;
      if (reserved <= inStock) return;
      const inTransit = inTransitMap.get(pid) ?? 0;
      const coverage = inStock + inTransit;
      const shortBy = Math.max(0, reserved - coverage);
      let severity: Alert["severity"];
      if (inStock === 0 && inTransit === 0) severity = "critical";
      else if (reserved > coverage) severity = "shortfall";
      else severity = "covered";
      out.push({ product: p, reserved, inStock, inTransit, shortBy, severity });
    });
    const rank = { critical: 0, shortfall: 1, covered: 2 } as const;
    out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.shortBy - a.shortBy || b.reserved - a.reserved);
    setAlerts(out);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useRealtimeTable("invoice_items" as any, () => { if (user) load(); });
  useRealtimeTable("invoices" as any, () => { if (user) load(); });
  useRealtimeTable("invoice_po_reservations" as any, () => { if (user) load(); });
  useRealtimeTable("delivery_receipts" as any, () => { if (user) load(); });
  useRealtimeTable("delivery_receipt_items" as any, () => { if (user) load(); });
  useRealtimeTable("products", () => { if (user) load(); });
  useRealtimeTable("purchase_orders", () => { if (user) load(); });
  useRealtimeTable("purchase_order_items", () => { if (user) load(); });

  const critical = useMemo(() => alerts.filter((a) => a.severity === "critical"), [alerts]);
  const shortfall = useMemo(() => alerts.filter((a) => a.severity === "shortfall"), [alerts]);
  const covered = useMemo(() => alerts.filter((a) => a.severity === "covered"), [alerts]);

  // Notify on new criticals + on app open if any critical exists (cooldown)
  useEffect(() => {
    if (alerts.length === 0 && critical.length === 0) return;
    const criticalIds = critical.map((a) => a.product.id).sort();
    const stored = getStored();
    const storedSet = new Set(stored.ids);
    const fresh = criticalIds.filter((id) => !storedSet.has(id));

    const isFirstLoadThisSession = !initRef.current;
    initRef.current = true;
    const cooldownPassed = Date.now() - (stored.at || 0) > NOTIFY_COOLDOWN_MS;
    const shouldNotifyOnOpen = isFirstLoadThisSession && criticalIds.length > 0 && (cooldownPassed || criticalIds.join(",") !== stored.ids.join(","));

    if (fresh.length > 0 || shouldNotifyOnOpen) {
      const items = fresh.length > 0
        ? critical.filter((a) => fresh.includes(a.product.id))
        : critical.slice(0, 3);

      // In-app toast
      items.slice(0, 3).forEach((a) => {
        toast(isAr ? "⚠️ منتج محجوز وغير متوفر" : "⚠️ Reserved product unavailable", {
          duration: 12000,
          description: (
            <div className="space-y-0.5 text-xs">
              <div className="font-semibold text-foreground">{a.product.name}</div>
              {a.product.serial_number && <div className="font-mono text-muted-foreground">S/N: {a.product.serial_number}</div>}
              <div className="font-semibold text-destructive">
                {isAr ? `محجوز ${a.reserved} · بالمخزن 0 · قادم 0` : `Reserved ${a.reserved} · stock 0 · incoming 0`}
              </div>
            </div>
          ),
        });
      });

      // System notification (works in installed PWA, app icon click → /in-transit)
      const title = isAr ? "تنبيه حجوزات حرج" : "Critical reservation alert";
      const body = items.length === 1
        ? (isAr
            ? `${items[0].product.name} — محجوز ${items[0].reserved} ولا يوجد في المخزن`
            : `${items[0].product.name} — reserved ${items[0].reserved}, none in stock`)
        : (isAr
            ? `${items.length} منتجات محجوزة وغير متوفرة في المخزن`
            : `${items.length} reserved products are unavailable in stock`);
      fireSystemNotification(title, body, "reservation-critical");

      setStored(criticalIds);
    } else if (criticalIds.join(",") !== stored.ids.join(",")) {
      // Sync stored set even if we don't notify (e.g. some resolved)
      setStored(criticalIds);
    }
  }, [alerts, critical, isAr]);

  // Ask permission on first open of popover
  const requestPerm = () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      try { Notification.requestPermission(); } catch {}
    }
  };

  const totalCount = alerts.length;
  const isCritical = critical.length > 0;
  const isShortfall = !isCritical && shortfall.length > 0;

  return (
    <Popover onOpenChange={(o) => o && requestPerm()}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative rounded-full tap-scale ${isCritical ? "ring-2 ring-destructive/60 ring-offset-1 ring-offset-background animate-pulse" : ""}`}
          aria-label="reservation alerts"
          title={isAr ? "تنبيهات الحجوزات" : "Reservation alerts"}
        >
          <Zap className={`h-4 w-4 ${isCritical ? "text-destructive" : isShortfall ? "text-amber-600" : totalCount > 0 ? "text-blue-600" : ""}`} />
          {totalCount > 0 && (
            <span
              className={`absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow ${
                isCritical ? "bg-destructive" : isShortfall ? "bg-amber-500" : "bg-blue-500"
              }`}
            >
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
          {isCritical && (
            <span className="absolute inset-0 -z-10 rounded-full bg-destructive/20 blur-md" aria-hidden />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0" sideOffset={8}>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Zap className={`h-4 w-4 ${isCritical ? "text-destructive" : "text-primary"}`} />
            {isAr ? "تنبيهات الحجوزات" : "Reservation Alerts"}
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            {critical.length > 0 && <span className="rounded-full bg-destructive px-1.5 py-0.5 font-bold text-destructive-foreground">{critical.length} {isAr ? "حرج" : "crit"}</span>}
            {shortfall.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 font-bold text-white">{shortfall.length} {isAr ? "نقص" : "short"}</span>}
            {covered.length > 0 && <span className="rounded-full bg-blue-500 px-1.5 py-0.5 font-bold text-white">{covered.length}</span>}
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto">
          {totalCount === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              {isAr ? "كل الحجوزات مغطاة ✅" : "All reservations covered ✅"}
            </div>
          ) : (
            <ul className="divide-y">
              {alerts.map((a) => {
                const tone =
                  a.severity === "critical" ? { icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/10", label: isAr ? "اطلبه فورًا" : "Order now" }
                  : a.severity === "shortfall" ? { icon: AlertTriangle, color: "text-amber-700", bg: "bg-amber-500/10", label: isAr ? "نقص" : "Shortfall" }
                  : { icon: Truck, color: "text-blue-700", bg: "bg-blue-500/10", label: isAr ? "بانتظار وصول" : "Awaiting arrival" };
                const Icon = tone.icon;
                return (
                  <li key={a.product.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border bg-muted">
                        {a.product.image_url
                          ? <img src={a.product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                          : <Package className="h-full w-full p-2 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-xs font-semibold">{a.product.name}</div>
                        {a.product.serial_number && (
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{a.product.serial_number}</div>
                        )}
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          <span className="rounded bg-amber-500/15 px-1 py-0.5 font-bold text-amber-700">
                            {isAr ? "محجوز" : "Resv"}: {a.reserved}
                          </span>
                          <span className={`rounded px-1 py-0.5 font-bold ${a.inStock > 0 ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                            {isAr ? "مخزن" : "Stk"}: {a.inStock}
                          </span>
                          <span className={`rounded px-1 py-0.5 font-bold ${a.inTransit > 0 ? "bg-violet-500/15 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                            {isAr ? "قادم" : "Inc"}: {a.inTransit}
                          </span>
                          {a.shortBy > 0 && (
                            <span className="rounded bg-destructive/15 px-1 py-0.5 font-bold text-destructive">
                              {isAr ? "ناقص" : "Short"}: {a.shortBy}
                            </span>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tone.bg} ${tone.color}`}>
                          <Icon className="h-3 w-3" /> {tone.label}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Link
            to="/in-transit"
            className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-primary hover:bg-accent"
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            {isAr ? "افتح متتبع المخزون" : "Open inventory tracker"}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import {
  CheckCircle2, AlertTriangle, Clock, Truck, Sparkles, Search,
  Package, ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";
import { ColorSwatch } from "@/components/color-swatch";

export const Route = createFileRoute("/fulfillment")({
  component: () => (
    <AppShell>
      <FulfillmentPage />
    </AppShell>
  ),
});

type Invoice = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  created_at: string;
  delivery_status: string | null;
};
type InvItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  unit_price: number;
};
type DRItem = { invoice_item_id: string; quantity: number };
type ProductRow = {
  id: string;
  name: string;
  stock_quantity: number;
  serial_number: string | null;
  color: string | null;
};
type POItemRow = { po_id: string; product_id: string; quantity: number; received_qty: number | null };
type PORow = {
  id: string;
  po_number: string;
  status: string;
  expected_arrival_at: string | null;
};

type Need = {
  product_id: string;
  product_name: string;
  serial: string | null;
  color: string | null;
  needed: number;
  fromStock: number;
  fromIncoming: number;
  shortfall: number;
  incomingPOs: { po_number: string; qty: number; eta: string | null }[];
  isManual?: boolean;
};

type Tier = "now_full" | "now_partial" | "incoming_full" | "incoming_partial" | "blocked";

type Suggestion = {
  invoice: Invoice;
  needs: Need[];
  totalNeeded: number;
  totalCovered: number;
  totalFromStock: number;
  totalFromIncoming: number;
  totalShortfall: number;
  tier: Tier;
  earliestEta: string | null;
  invoiceValue: number;
};

// Incoming PO statuses we trust as "really arriving" (not received yet)
const INCOMING_PO_STATUSES = new Set(["ordered", "shipped", "in_warehouse"]);

function FulfillmentPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [deliveredMap, setDeliveredMap] = useState<Map<string, number>>(new Map());
  const [products, setProducts] = useState<Map<string, ProductRow>>(new Map());
  const [poItems, setPoItems] = useState<POItemRow[]>([]);
  const [pos, setPos] = useState<Map<string, PORow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [onlyCloseable, setOnlyCloseable] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);

    // 1) Open invoices (completed, not yet fully delivered)
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number, customer_name, customer_phone, total, created_at, delivery_status, status")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .or("delivery_status.is.null,delivery_status.neq.delivered")
      .order("created_at", { ascending: true })
      .limit(50000);
    const invList = (invs ?? []) as Invoice[];
    setInvoices(invList);

    const invIds = invList.map((i) => i.id);
    if (invIds.length === 0) {
      setItems([]);
      setDeliveredMap(new Map());
    } else {
      // 2) Items
      const { data: its } = await supabase
        .from("invoice_items")
        .select("id, invoice_id, product_id, product_name, serial_number, color, quantity, unit_price")
        .in("invoice_id", invIds);
      const itemList = (its ?? []) as InvItem[];
      setItems(itemList);

      // 3) Delivered per item
      const itemIds = itemList.map((i) => i.id);
      const dMap = new Map<string, number>();
      if (itemIds.length) {
        const { data: drs } = await supabase
          .from("delivery_receipt_items")
          .select("invoice_item_id, quantity")
          .in("invoice_item_id", itemIds);
        for (const r of (drs ?? []) as DRItem[]) {
          dMap.set(r.invoice_item_id, (dMap.get(r.invoice_item_id) || 0) + (r.quantity || 0));
        }
      }
      setDeliveredMap(dMap);
    }

    // 4) Products (stock)
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, stock_quantity, serial_number, color")
      .eq("user_id", user.id)
      .limit(20000);
    const pMap = new Map<string, ProductRow>();
    for (const p of (prods ?? []) as ProductRow[]) pMap.set(p.id, p);
    setProducts(pMap);

    // 5) Incoming POs
    const { data: poList } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, expected_arrival_at")
      .eq("user_id", user.id)
      .in("status", Array.from(INCOMING_PO_STATUSES))
      .limit(2000);
    const poMap = new Map<string, PORow>();
    for (const p of (poList ?? []) as PORow[]) poMap.set(p.id, p);
    setPos(poMap);
    const poIds = Array.from(poMap.keys());
    if (poIds.length) {
      const { data: poIs } = await supabase
        .from("purchase_order_items")
        .select("po_id, product_id, quantity, received_qty")
        .in("po_id", poIds);
      setPoItems((poIs ?? []) as POItemRow[]);
    } else {
      setPoItems([]);
    }

    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);
  useRealtimeTable("invoices", load, [user?.id]);
  useRealtimeTable("invoice_items", load, [user?.id]);
  useRealtimeTable("delivery_receipt_items", load, [user?.id]);
  useRealtimeTable("products", load, [user?.id]);
  useRealtimeTable("purchase_orders", load, [user?.id]);
  useRealtimeTable("purchase_order_items", load, [user?.id]);

  // ============ SMART ALLOCATION ENGINE ============
  const suggestions = useMemo<Suggestion[]>(() => {
    // 1. Build per-invoice "remaining needs" map
    const itemsByInv = new Map<string, InvItem[]>();
    for (const it of items) {
      const arr = itemsByInv.get(it.invoice_id) ?? [];
      arr.push(it);
      itemsByInv.set(it.invoice_id, arr);
    }

    // 2. Mutable stock pool (clone)
    const stockPool = new Map<string, number>();
    for (const [pid, p] of products) {
      stockPool.set(pid, Math.max(0, p.stock_quantity || 0));
    }

    // 3. Mutable incoming pool (clone), with PO breakdown
    const incomingPool = new Map<string, number>();
    const incomingByProduct = new Map<string, { po_id: string; qty: number }[]>();
    for (const pi of poItems) {
      if (!pi.product_id) continue;
      // Only count units NOT yet received (received units are already in products.stock_quantity)
      const remainingQty = Math.max(0, (pi.quantity || 0) - (pi.received_qty || 0));
      if (remainingQty <= 0) continue;
      const cur = incomingPool.get(pi.product_id) ?? 0;
      incomingPool.set(pi.product_id, cur + remainingQty);
      const list = incomingByProduct.get(pi.product_id) ?? [];
      list.push({ po_id: pi.po_id, qty: remainingQty });
      incomingByProduct.set(pi.product_id, list);
    }
    // Sort each product's incoming by earliest ETA so we consume earliest first
    for (const list of incomingByProduct.values()) {
      list.sort((a, b) => {
        const ea = pos.get(a.po_id)?.expected_arrival_at ?? "9999-12-31";
        const eb = pos.get(b.po_id)?.expected_arrival_at ?? "9999-12-31";
        return ea.localeCompare(eb);
      });
    }

    // 4. Build raw need per invoice (remaining qty per product)
    type RawNeed = {
      invoice: Invoice;
      perProduct: Map<string, { product_name: string; serial: string | null; color: string | null; needed: number; isManual: boolean }>;
      totalNeeded: number;
    };
    const raws: RawNeed[] = [];
    for (const inv of invoices) {
      const its = itemsByInv.get(inv.id) ?? [];
      const perProduct = new Map<string, { product_name: string; serial: string | null; color: string | null; needed: number; isManual: boolean }>();
      let total = 0;
      for (const it of its) {
        const delivered = deliveredMap.get(it.id) ?? 0;
        const remaining = Math.max(0, (it.quantity || 0) - delivered);
        if (remaining <= 0) continue;
        // Manual lines (no product_id) have no inventory binding — treat as auto-satisfied so they never block closure.
        const isManual = !it.product_id;
        const key = it.product_id ?? `manual:${it.id}`;
        const cur = perProduct.get(key);
        if (cur) {
          cur.needed += remaining;
        } else {
          perProduct.set(key, {
            product_name: it.product_name,
            serial: it.serial_number,
            color: it.color,
            needed: remaining,
            isManual,
          });
        }
        total += remaining;
      }
      if (total > 0) raws.push({ invoice: inv, perProduct, totalNeeded: total });
    }

    // 5. PASS A — fully coverable from CURRENT stock, oldest first
    const committed = new Set<string>();
    const out: Suggestion[] = [];

    function canCoverFromStock(raw: RawNeed): boolean {
      const tmp = new Map<string, number>();
      for (const [pid, n] of raw.perProduct) {
        if (n.isManual) continue; // manual lines have no stock requirement
        const avail = (stockPool.get(pid) ?? 0) - (tmp.get(pid) ?? 0);
        if (avail < n.needed) return false;
        tmp.set(pid, (tmp.get(pid) ?? 0) + n.needed);
      }
      return true;
    }

    function commit(raw: RawNeed, tier: Tier, useIncoming: boolean): Suggestion {
      const needs: Need[] = [];
      let totalStock = 0, totalIncoming = 0, totalShortfall = 0;
      let earliest: string | null = null;
      for (const [pid, n] of raw.perProduct) {
        if (n.isManual) {
          // Manual line: count as fully covered (no inventory tracking)
          totalStock += n.needed;
          needs.push({
            product_id: pid,
            product_name: n.product_name,
            serial: n.serial,
            color: n.color,
            needed: n.needed,
            fromStock: n.needed,
            fromIncoming: 0,
            shortfall: 0,
            incomingPOs: [],
            isManual: true,
          });
          continue;
        }
        const stockAvail = stockPool.get(pid) ?? 0;
        const fromStock = Math.min(stockAvail, n.needed);
        stockPool.set(pid, stockAvail - fromStock);
        let remaining = n.needed - fromStock;
        let fromIncoming = 0;
        const incomingPOs: Need["incomingPOs"] = [];
        if (useIncoming && remaining > 0) {
          const list = incomingByProduct.get(pid) ?? [];
          for (const slot of list) {
            if (remaining <= 0) break;
            if (slot.qty <= 0) continue;
            const take = Math.min(slot.qty, remaining);
            slot.qty -= take;
            remaining -= take;
            fromIncoming += take;
            const po = pos.get(slot.po_id);
            if (po) {
              incomingPOs.push({ po_number: po.po_number, qty: take, eta: po.expected_arrival_at });
              if (po.expected_arrival_at) {
                if (!earliest || po.expected_arrival_at < earliest) earliest = po.expected_arrival_at;
              }
            }
          }
          incomingPool.set(pid, (incomingPool.get(pid) ?? 0) - fromIncoming);
        }
        const shortfall = n.needed - fromStock - fromIncoming;
        totalStock += fromStock;
        totalIncoming += fromIncoming;
        totalShortfall += shortfall;
        needs.push({
          product_id: pid,
          product_name: n.product_name,
          serial: n.serial,
          color: n.color,
          needed: n.needed,
          fromStock, fromIncoming, shortfall,
          incomingPOs,
        });
      }
      return {
        invoice: raw.invoice,
        needs,
        totalNeeded: raw.totalNeeded,
        totalCovered: totalStock + totalIncoming,
        totalFromStock: totalStock,
        totalFromIncoming: totalIncoming,
        totalShortfall,
        tier,
        earliestEta: earliest,
        invoiceValue: Number(raw.invoice.total) || 0,
      };
    }

    // Pass A: full from stock now
    for (const raw of raws) {
      if (canCoverFromStock(raw)) {
        out.push(commit(raw, "now_full", false));
        committed.add(raw.invoice.id);
      }
    }
    // Pass B: full from stock + incoming
    for (const raw of raws) {
      if (committed.has(raw.invoice.id)) continue;
      // simulate
      const tmpStock = new Map<string, number>();
      const tmpInc = new Map<string, number>();
      let ok = true;
      for (const [pid, n] of raw.perProduct) {
        if (n.isManual) continue;
        const s = (stockPool.get(pid) ?? 0) - (tmpStock.get(pid) ?? 0);
        const fromS = Math.min(s, n.needed);
        const need2 = n.needed - fromS;
        const i = (incomingPool.get(pid) ?? 0) - (tmpInc.get(pid) ?? 0);
        if (i < need2) { ok = false; break; }
        tmpStock.set(pid, (tmpStock.get(pid) ?? 0) + fromS);
        tmpInc.set(pid, (tmpInc.get(pid) ?? 0) + need2);
      }
      if (ok) {
        out.push(commit(raw, "incoming_full", true));
        committed.add(raw.invoice.id);
      }
    }
    // Pass C: partial — allocate whatever we can (stock first, then incoming)
    for (const raw of raws) {
      if (committed.has(raw.invoice.id)) continue;
      const s = commit(raw, "blocked", true);
      if (s.totalFromStock > 0 && s.totalShortfall === 0) {
        // shouldn't happen here (would be Pass A/B), but defensive
        s.tier = "incoming_full";
      } else if (s.totalFromStock > 0 && s.totalFromIncoming === 0) {
        s.tier = "now_partial";
      } else if (s.totalFromStock > 0 || s.totalFromIncoming > 0) {
        s.tier = "incoming_partial";
      } else {
        s.tier = "blocked";
      }
      out.push(s);
    }

    // Sort within tier: by invoice value desc (high-value first), then oldest
    const tierOrder: Record<Tier, number> = {
      now_full: 0, now_partial: 1, incoming_full: 2, incoming_partial: 3, blocked: 4,
    };
    out.sort((a, b) => {
      const t = tierOrder[a.tier] - tierOrder[b.tier];
      if (t !== 0) return t;
      const v = b.invoiceValue - a.invoiceValue;
      if (v !== 0) return v;
      return a.invoice.created_at.localeCompare(b.invoice.created_at);
    });
    return out;
  }, [invoices, items, deliveredMap, products, poItems, pos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) =>
      s.invoice.invoice_number.toLowerCase().includes(q) ||
      (s.invoice.customer_name || "").toLowerCase().includes(q) ||
      s.needs.some((n) => n.product_name.toLowerCase().includes(q))
    );
  }, [suggestions, search]);

  const byTier = useMemo(() => {
    const g: Record<Tier, Suggestion[]> = {
      now_full: [], now_partial: [], incoming_full: [], incoming_partial: [], blocked: [],
    };
    const src = onlyCloseable ? filtered.filter((s) => s.tier === "now_full") : filtered;
    for (const s of src) g[s.tier].push(s);
    return g;
  }, [filtered, onlyCloseable]);

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            {isAr ? "اقتراحات الإقفال الذكية" : "Smart Fulfillment Suggestions"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "ترتيب ذكي للفواتير حسب إمكانية الإقفال — الفواتير القابلة للإقفال الكامل من المخزون الحالي أولاً، ثم باستخدام الشحنات القادمة."
              : "Smart ranking — invoices fully closeable from current stock first, then those needing incoming POs."}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            type="button"
            variant={onlyCloseable ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyCloseable((v) => !v)}
            className="gap-2"
            title={isAr ? "اعرض فقط الفواتير القابلة للإقفال 100% الآن" : "Show only invoices closeable 100% now"}
          >
            <CheckCircle2 className="h-4 w-4" />
            {isAr ? "قابلة للإقفال 100% الآن" : "Closeable 100% now"}
            {onlyCloseable && (
              <Badge variant="secondary" className="ms-1">
                {byTier.now_full.length}
              </Badge>
            )}
          </Button>
          <div className="relative w-full sm:w-72">
            <Search className={`absolute top-1/2 -translate-y-1/2 ${isAr ? "right-3" : "left-3"} h-4 w-4 text-muted-foreground`} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "ابحث برقم الفاتورة أو العميل أو المنتج…" : "Search invoice / customer / product…"}
              className={isAr ? "pr-9" : "pl-9"}
            />
          </div>
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryChip
          label={isAr ? "جاهزة للإقفال الآن" : "Close now (full)"}
          count={byTier.now_full.length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="emerald"
        />
        <SummaryChip
          label={isAr ? "جزئي من المخزون" : "Partial from stock"}
          count={byTier.now_partial.length}
          icon={<Package className="h-4 w-4" />}
          color="sky"
        />
        <SummaryChip
          label={isAr ? "إقفال كامل بعد الوصول" : "Full after arrival"}
          count={byTier.incoming_full.length}
          icon={<Truck className="h-4 w-4" />}
          color="violet"
        />
        <SummaryChip
          label={isAr ? "جزئي بعد الوصول" : "Partial after arrival"}
          count={byTier.incoming_partial.length}
          icon={<Clock className="h-4 w-4" />}
          color="amber"
        />
        <SummaryChip
          label={isAr ? "محجوبة" : "Blocked"}
          count={byTier.blocked.length}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="rose"
        />
      </div>

      {loading && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "جارٍ التحليل…" : "Analyzing…"}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
          {isAr ? "لا توجد فواتير مفتوحة لاقتراحها." : "No open invoices to suggest."}
        </div>
      )}

      {(["now_full", "now_partial", "incoming_full", "incoming_partial", "blocked"] as Tier[]).map((tier) =>
        byTier[tier].length === 0 ? null : (
          <section key={tier} className="space-y-2">
            <TierHeader tier={tier} count={byTier[tier].length} isAr={isAr} />
            <div className="grid gap-3">
              {byTier[tier].map((s) => (
                <SuggestionCard
                  key={s.invoice.id}
                  s={s}
                  isAr={isAr}
                  open={openCard === s.invoice.id}
                  onToggle={() => setOpenCard(openCard === s.invoice.id ? null : s.invoice.id)}
                />
              ))}
            </div>
          </section>
        )
      )}
    </div>
  );
}

function SummaryChip({
  label, count, icon, color,
}: {
  label: string; count: number; icon: React.ReactNode;
  color: "emerald" | "sky" | "violet" | "amber" | "rose";
}) {
  const map: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  };
  return (
    <Card className={`flex items-center gap-3 border p-3 ${map[color]}`}>
      <div className="rounded-md bg-background/40 p-2">{icon}</div>
      <div>
        <div className="text-xs opacity-80">{label}</div>
        <div className="text-xl font-bold">{count}</div>
      </div>
    </Card>
  );
}

function TierHeader({ tier, count, isAr }: { tier: Tier; count: number; isAr: boolean }) {
  const titles: Record<Tier, { ar: string; en: string; icon: React.ReactNode; cls: string }> = {
    now_full: {
      ar: "🟢 جاهزة للإقفال بالكامل الآن", en: "🟢 Ready to close fully NOW",
      icon: <CheckCircle2 className="h-4 w-4" />, cls: "text-emerald-700 dark:text-emerald-400",
    },
    now_partial: {
      ar: "🔵 إقفال جزئي من المخزون الحالي", en: "🔵 Partial close from current stock",
      icon: <Package className="h-4 w-4" />, cls: "text-sky-700 dark:text-sky-400",
    },
    incoming_full: {
      ar: "🟣 إقفال كامل بعد وصول الشحنات", en: "🟣 Full close after incoming POs arrive",
      icon: <Truck className="h-4 w-4" />, cls: "text-violet-700 dark:text-violet-400",
    },
    incoming_partial: {
      ar: "🟡 إقفال جزئي بعد الشحنات القادمة", en: "🟡 Partial close after incoming POs",
      icon: <Clock className="h-4 w-4" />, cls: "text-amber-700 dark:text-amber-400",
    },
    blocked: {
      ar: "🔴 محجوبة — لا يوجد مخزون ولا شحنات قادمة", en: "🔴 Blocked — no stock and no incoming POs",
      icon: <AlertTriangle className="h-4 w-4" />, cls: "text-rose-700 dark:text-rose-400",
    },
  };
  const t = titles[tier];
  return (
    <div className={`flex items-center gap-2 text-sm font-semibold ${t.cls}`}>
      {t.icon}
      <span>{isAr ? t.ar : t.en}</span>
      <Badge variant="outline" className="text-xs">{count}</Badge>
    </div>
  );
}

function SuggestionCard({
  s, isAr, open, onToggle,
}: {
  s: Suggestion; isAr: boolean; open: boolean; onToggle: () => void;
}) {
  const pct = s.totalNeeded > 0 ? Math.round((s.totalCovered / s.totalNeeded) * 100) : 0;
  const canCreateDR = s.totalFromStock > 0; // can deliver now if any stock available
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 p-4 text-start hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{s.invoice.invoice_number}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="truncate text-sm">{s.invoice.customer_name || (isAr ? "بدون اسم" : "Unnamed")}</span>
            <Badge variant="outline" className="text-[10px]">
              {fmtMoney(s.invoiceValue, "EGP", isAr ? "ar" : "en")}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isAr ? "تاريخ" : "Date"}: {fmtDateTime(s.invoice.created_at, isAr ? "ar" : "en")}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-0.5">
              {isAr ? "مطلوب" : "Needed"}: <b>{s.totalNeeded}</b>
            </span>
            {s.totalFromStock > 0 && (
              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                {isAr ? "من المخزون" : "From stock"}: <b>{s.totalFromStock}</b>
              </span>
            )}
            {s.totalFromIncoming > 0 && (
              <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-violet-700 dark:text-violet-400">
                {isAr ? "من الشحنات" : "From incoming"}: <b>{s.totalFromIncoming}</b>
              </span>
            )}
            {s.totalShortfall > 0 && (
              <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-400">
                {isAr ? "ناقص" : "Short"}: <b>{s.totalShortfall}</b>
              </span>
            )}
            <span className="rounded-md bg-muted px-2 py-0.5">{pct}%</span>
          </div>
        </div>
        <div className="shrink-0">
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="space-y-2">
            {s.needs.map((n) => (
              <div key={n.product_id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.product_name}</span>
                  {n.serial && <span className="font-mono text-xs text-muted-foreground">#{n.serial}</span>}
                  {n.color && <ColorSwatch value={n.color} size="sm" />}
                  <span className="ms-auto text-xs text-muted-foreground">
                    {isAr ? "مطلوب" : "Need"}: <b>{n.needed}</b>
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {n.fromStock > 0 && (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                      {isAr ? "متاح من المخزون" : "From stock"}: {n.fromStock}
                    </Badge>
                  )}
                  {n.fromIncoming > 0 && (
                    <Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-400">
                      {isAr ? "من الشحنات" : "From incoming"}: {n.fromIncoming}
                    </Badge>
                  )}
                  {n.shortfall > 0 && (
                    <Badge variant="outline" className="border-rose-500/40 text-rose-700 dark:text-rose-400">
                      {isAr ? "ناقص" : "Short"}: {n.shortfall}
                    </Badge>
                  )}
                </div>
                {n.incomingPOs.length > 0 && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {n.incomingPOs.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Truck className="h-3 w-3" />
                        <span className="font-mono">{p.po_number}</span>
                        <span>×{p.qty}</span>
                        {p.eta && <span>· {isAr ? "وصول متوقع" : "ETA"}: {fmtDateTime(p.eta, isAr ? "ar" : "en")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {s.earliestEta
                ? (isAr ? `أقرب موعد وصول للشحنات: ${fmtDateTime(s.earliestEta, "ar")}` : `Earliest incoming ETA: ${fmtDateTime(s.earliestEta, "en")}`)
                : (isAr ? "كل المطلوب متاح في المخزون" : "All required units are in stock")}
            </div>
            <div className="flex gap-2">
              <Link to="/invoices/$id" params={{ id: s.invoice.id }}>
                <Button variant="outline" size="sm">
                  {isAr ? "فتح الفاتورة" : "Open invoice"}
                </Button>
              </Link>
              {canCreateDR && (
                <Link to="/delivery-receipts/new" search={{ invoiceId: s.invoice.id }}>
                  <Button size="sm" className="gap-1">
                    {isAr ? "إنشاء إذن تسليم" : "Create delivery receipt"}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

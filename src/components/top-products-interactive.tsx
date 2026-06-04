import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Crown, Hash, DollarSign, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney } from "@/lib/utils-money";
import { ColorSwatch } from "@/components/color-swatch";

type Row = {
  key: string;
  product_id: string | null;
  name: string;
  serial: string | null;
  color: string | null;
  qty: number;
  total: number;
  invoiceCount: number;
  lastSoldAt: string | null;
};
type SortKey = "qty" | "value";

export function TopProductsInteractive({ rangeDays = 30, limit = 8 }: { rangeDays?: number; limit?: number }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [rows, setRows] = useState<Row[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    let q = supabase
      .from("invoice_items")
      .select("product_id, product_name, serial_number, color, quantity, line_total, invoices!inner(status, created_at)")
      .not("invoices.status", "in", "(voided,draft,cancelled)");
    if (!showAll) {
      const from = new Date();
      from.setDate(from.getDate() - rangeDays);
      q = q.gte("invoices.created_at", from.toISOString());
    }
    const { data: items } = await q;
    const map = new Map<string, Row>();
    ((items as any) ?? []).forEach((it: any) => {
      const key = `${it.product_id ?? it.product_name}|${it.serial_number ?? ""}|${it.color ?? ""}`;
      const prev = map.get(key) ?? {
        key,
        product_id: it.product_id ?? null,
        name: it.product_name,
        serial: it.serial_number ?? null,
        color: it.color ?? null,
        qty: 0,
        total: 0,
        invoiceCount: 0,
        lastSoldAt: null,
      };
      prev.qty += Number(it.quantity || 0);
      prev.total += Number(it.line_total || 0);
      prev.invoiceCount += 1;
      const created = it.invoices?.created_at ?? null;
      if (created && (!prev.lastSoldAt || created > prev.lastSoldAt)) prev.lastSoldAt = created;
      map.set(key, prev);
    });
    setRows([...map.values()]);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, rangeDays, showAll]);
  useRealtimeTable("invoice_items", () => { if (user) load(); });
  useRealtimeTable("invoices", () => { if (user) load(); });

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => (sortBy === "qty" ? b.qty - a.qty : b.total - a.total));
    return arr.slice(0, limit);
  }, [rows, sortBy, limit]);

  const maxValue = Math.max(1, ...sorted.map((r) => (sortBy === "qty" ? r.qty : r.total)));

  return (
    <div className="ios-card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-500" />
          <h3 className="eyebrow">{isAr ? "المنتجات الأكثر مبيعًا" : "Top products"}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {isAr ? `آخر ${rangeDays} يوم` : `Last ${rangeDays}d`}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-background/60 p-1">
          <button
            onClick={() => setSortBy("value")}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              sortBy === "value" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <DollarSign className="h-3 w-3" /> {isAr ? "بالقيمة" : "Value"}
          </button>
          <button
            onClick={() => setSortBy("qty")}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              sortBy === "qty" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Hash className="h-3 w-3" /> {isAr ? "بالكمية" : "Qty"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{isAr ? "لا توجد بيانات" : "No data"}</div>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((r, idx) => {
            const metric = sortBy === "qty" ? r.qty : r.total;
            const pct = (metric / maxValue) * 100;
            const isOpen = expanded === r.key;
            return (
              <li key={r.key} className="py-2">
                <button
                  onClick={() => setExpanded(isOpen ? null : r.key)}
                  className="group flex w-full items-center gap-3 rounded-lg p-2 text-start transition hover:bg-muted/40"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" : idx === 1 ? "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300" : idx === 2 ? "bg-orange-500/20 text-orange-700 dark:text-orange-400" : "bg-muted text-muted-foreground"}`}>
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums">
                        {sortBy === "qty" ? `× ${r.qty}` : fmtMoney(r.total, "EGP", lang)}
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                          className="h-full bg-gradient-to-r from-primary to-primary/60"
                        />
                      </div>
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mx-2 mt-1 grid gap-2 rounded-xl border bg-muted/30 p-3 text-xs sm:grid-cols-2">
                        <Stat label={isAr ? "الكمية المباعة" : "Units sold"} value={`× ${r.qty}`} />
                        <Stat label={isAr ? "إجمالي القيمة" : "Total value"} value={fmtMoney(r.total, "EGP", lang)} />
                        <Stat label={isAr ? "عدد الفواتير" : "Invoices"} value={String(r.invoiceCount)} />
                        <Stat label={isAr ? "متوسط سعر البيع" : "Avg sell price"} value={fmtMoney(r.qty > 0 ? r.total / r.qty : 0, "EGP", lang)} />
                        {r.serial && <Stat label={isAr ? "الرقم التسلسلي" : "Serial"} value={r.serial} mono />}
                        {r.color && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{isAr ? "اللون" : "Color"}:</span>
                            <ColorSwatch value={r.color} size="sm" />
                            <span className="font-medium">{r.color}</span>
                          </div>
                        )}
                      </div>
                      {r.product_id && (
                        <Link
                          to="/products"
                          className="mx-2 mt-2 inline-flex items-center gap-1 px-1 text-[11px] font-semibold text-primary hover:underline"
                        >
                          {isAr ? "فتح المنتج" : "Open product"}
                          <ArrowRight className={`h-3 w-3 ${isAr ? "rotate-180" : ""}`} />
                        </Link>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-semibold ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

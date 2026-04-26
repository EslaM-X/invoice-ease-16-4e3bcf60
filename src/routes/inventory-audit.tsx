import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime } from "@/lib/utils-money";
import { Boxes, TrendingUp, TrendingDown, Wrench } from "lucide-react";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/inventory-audit")({
  component: () => (
    <AppShell>
      <InventoryAudit />
    </AppShell>
  ),
});

type LogRow = {
  id: string;
  product_id: string;
  change: number;
  reason: string | null;
  invoice_id: string | null;
  created_at: string;
};

type ProductRow = {
  id: string;
  name: string;
  serial_number: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
};

function classifyReason(reason: string | null, change: number): "sale" | "void" | "edit" | "manual" | "other" {
  const r = (reason || "").toLowerCase();
  if (r.startsWith("sale")) return "sale";
  if (r.startsWith("void") || r.startsWith("delete")) return "void";
  if (r.startsWith("edit")) return "edit";
  if (r.startsWith("manual")) return "manual";
  return change > 0 ? "other" : "other";
}

function InventoryAudit() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [productId, setProductId] = useState<string>("all");
  const [direction, setDirection] = useState<"all" | "in" | "out" | "manual">("all");
  const [opType, setOpType] = useState<"all" | "sale" | "void" | "edit" | "manual">("all");

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      let q = supabase.from("inventory_logs").select("*").order("created_at", { ascending: false });
      if (from) q = q.gte("created_at", from);
      if (to) q = q.lte("created_at", to + "T23:59:59");
      const [lg, pr] = await Promise.all([
        q,
        supabase.from("products").select("id, name, serial_number, stock_quantity, low_stock_threshold").order("name"),
      ]);
      setLogs((lg.data ?? []) as LogRow[]);
      setProducts((pr.data ?? []) as ProductRow[]);
      setLoading(false);
    })();
  }, [user, from, to]);

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (productId !== "all" && l.product_id !== productId) return false;
      if (direction === "in" && l.change <= 0) return false;
      if (direction === "out" && l.change >= 0) return false;
      const cls = classifyReason(l.reason, l.change);
      if (direction === "manual" && cls !== "manual") return false;
      if (opType !== "all" && cls !== opType) return false;
      return true;
    });
  }, [logs, productId, direction, opType]);

  const totals = useMemo(() => {
    let inQty = 0, outQty = 0;
    filtered.forEach((l) => { if (l.change > 0) inQty += l.change; else outQty += -l.change; });
    return { inQty, outQty, net: inQty - outQty, count: filtered.length };
  }, [filtered]);

  const stockSummary = useMemo(() => {
    const total = products.reduce((s, p) => s + p.stock_quantity, 0);
    const low = products.filter((p) => p.stock_quantity <= p.low_stock_threshold).length;
    return { total, low, items: products.length };
  }, [products]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("inventory_audit")}</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={<Boxes className="h-4 w-4" />} label={t("current_stock")} value={String(stockSummary.total)} />
        <SummaryCard icon={<TrendingUp className="h-4 w-4 text-success" />} label={t("total_in")} value={`+${totals.inQty}`} />
        <SummaryCard icon={<TrendingDown className="h-4 w-4 text-destructive" />} label={t("total_out")} value={`-${totals.outQty}`} />
        <SummaryCard icon={<Wrench className="h-4 w-4" />} label={t("net_change")} value={`${totals.net >= 0 ? "+" : ""}${totals.net}`} />
      </div>

      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label className="text-xs">{t("from")}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">{t("to")}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">{t("product")}</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}{p.serial_number ? ` · ${p.serial_number}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("direction")}</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              <SelectItem value="in">{t("increase")}</SelectItem>
              <SelectItem value="out">{t("decrease")}</SelectItem>
              <SelectItem value="manual">{t("manual_adjust")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("op_type")}</Label>
          <Select value={opType} onValueChange={(v) => setOpType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              <SelectItem value="sale">{t("op_sale")}</SelectItem>
              <SelectItem value="void">{t("op_void")}</SelectItem>
              <SelectItem value="edit">{t("op_edit")}</SelectItem>
              <SelectItem value="manual">{t("op_manual")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_data")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("date")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("product")}</th>
                  <th className="px-4 py-3 text-end font-medium">{t("change")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("reason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((l) => {
                  const p = productMap.get(l.product_id);
                  const positive = l.change > 0;
                  return (
                    <tr key={l.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{fmtDateTime(l.created_at, lang)}</td>
                      <td className="px-4 py-3 font-medium">{p?.name ?? l.product_id.slice(0, 8)}</td>
                      <td className={`px-4 py-3 text-end font-semibold tabular-nums ${positive ? "text-success" : "text-destructive"}`}>
                        {positive ? "+" : ""}{l.change}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{l.reason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("current_stock_by_product")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("product")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("serial_number")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("stock")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("low_stock_threshold")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => {
                const low = p.stock_quantity <= p.low_stock_threshold;
                return (
                  <tr key={p.id} className={low ? "bg-destructive/5" : ""}>
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.serial_number || "—"}</td>
                    <td className={`px-4 py-2 text-end font-semibold tabular-nums ${low ? "text-destructive" : ""}`}>{p.stock_quantity}</td>
                    <td className="px-4 py-2 text-end tabular-nums text-muted-foreground">{p.low_stock_threshold}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

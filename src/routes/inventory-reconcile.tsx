import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, ShieldCheck, Save, RefreshCw, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/data";

export const Route = createFileRoute("/inventory-reconcile")({
  component: () => (
    <AppShell>
      <Reconcile />
    </AppShell>
  ),
});

function Reconcile() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const role = useRole();
  const isAr = lang === "ar";
  const isAdmin = role.isAdmin;
  const [list, setList] = useState<Product[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const all: Product[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from("products")
        .select("*")
        .order("name", { ascending: true })
        .range(from, from + PAGE - 1);
      const rows = (data ?? []) as Product[];
      all.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    setList(all);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [user?.id]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.serial_number ?? "").toLowerCase().includes(s) ||
        (p.color ?? "").toLowerCase().includes(s) ||
        (p.collection ?? "").toLowerCase().includes(s),
    );
  }, [list, q]);

  const reconcile = async (p: Product) => {
    const v = edits[p.id];
    if (v === undefined || v === "") {
      return toast.error(isAr ? "أدخل الكمية الصحيحة" : "Enter correct qty");
    }
    const newQty = parseInt(v, 10);
    if (!Number.isFinite(newQty) || newQty < 0) {
      return toast.error(isAr ? "كمية غير صالحة" : "Invalid qty");
    }
    const reason = (reasons[p.id] ?? "").trim();
    if (reason.length < 3) {
      return toast.error(
        isAr ? "السبب مطلوب (3 أحرف على الأقل)" : "Reason required (min 3)",
      );
    }
    setSavingId(p.id);
    const { error } = await supabase.rpc("manual_reconcile_stock", {
      _product_id: p.id,
      _new_qty: newQty,
      _reason: reason,
    });
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success(
      `${p.name}: ${p.stock_quantity} → ${newQty}`,
    );
    setList((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, stock_quantity: newQty } : x)),
    );
    setEdits((prev) => {
      const { [p.id]: _, ...rest } = prev;
      return rest;
    });
    setReasons((prev) => {
      const { [p.id]: _, ...rest } = prev;
      return rest;
    });
  };

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        {isAr
          ? "هذه الصفحة متاحة للأدمن فقط (لتسوية الأرصدة من الورق)."
          : "Admin-only page (manual stock reconciliation)."}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            {isAr ? "تسوية المخزون من الورق" : "Stock reconciliation"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "اضبط الرصيد الفعلي لكل منتج حسب الجرد الورقي. كل تغيير يُسجَّل باسمك في سجلات المخزون."
              : "Set the real on-hand quantity per product from paper count. Every change is logged."}
          </p>
        </div>
      </div>

      <ReconciliationReport isAr={isAr} onChanged={load} />

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isAr ? "بحث: اسم / كود / لون / كولكشن" : "Search…"}
          className="ps-9"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {filtered.length} / {list.length}
        </div>
        <div className="divide-y">
          {loading && (
            <div className="p-8 text-center text-sm text-muted-foreground">…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد منتجات" : "No products"}
            </div>
          )}
          {filtered.slice(0, 300).map((p) => {
            const draft = edits[p.id];
            const newQty = draft === undefined || draft === "" ? null : parseInt(draft, 10);
            const diff = newQty == null ? null : newQty - p.stock_quantity;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 p-3 hover:bg-accent/40"
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.serial_number || "—"} · {p.color || "—"} ·{" "}
                    {p.collection || "—"}
                  </div>
                </div>
                <div className="text-end">
                  <div className="text-[10px] text-muted-foreground">
                    {isAr ? "الحالي" : "Current"}
                  </div>
                  <div className="font-bold tabular-nums">{p.stock_quantity}</div>
                </div>
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  placeholder={isAr ? "الصحيح" : "Correct"}
                  value={edits[p.id] ?? ""}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                />
                {diff != null && diff !== 0 && (
                  <span
                    className={`text-xs font-semibold tabular-nums ${diff > 0 ? "text-emerald-600" : "text-destructive"}`}
                  >
                    {diff > 0 ? "+" : ""}
                    {diff}
                  </span>
                )}
                <Input
                  className="w-44"
                  placeholder={isAr ? "السبب (مثال: جرد ورقي)" : "Reason"}
                  value={reasons[p.id] ?? ""}
                  onChange={(e) =>
                    setReasons((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                />
                <Button
                  size="sm"
                  disabled={savingId === p.id || draft === undefined || draft === ""}
                  onClick={() => reconcile(p)}
                  className="gap-1"
                >
                  <Save className="h-3.5 w-3.5" />
                  {isAr ? "حفظ" : "Save"}
                </Button>
              </div>
            );
          })}
        </div>
        {filtered.length > 300 && (
          <div className="p-3 text-center text-xs text-muted-foreground">
            {isAr
              ? `يظهر أول 300 من ${filtered.length} — استخدم البحث للتصفية`
              : `Showing first 300 of ${filtered.length} — use search`}
          </div>
        )}
      </Card>
    </div>
  );
}

type ReconRow = {
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  current_stock: number;
  logs_sum: number;
  diff: number;
};

function ReconciliationReport({ isAr, onChanged }: { isAr: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("stock_reconciliation_report");
    if (error) toast.error(error.message);
    else setRows((data as ReconRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const mismatched = rows.filter((r) => r.diff !== 0);
  const view = onlyMismatch ? mismatched : rows;

  const rebuildAll = async () => {
    if (!confirm(isAr
      ? `إعادة بناء المخزون لكل ${mismatched.length} منتج من سجل الحركات؟ الفروقات هتتصحح تلقائياً.`
      : `Rebuild stock for ${mismatched.length} mismatched products from inventory logs? Differences will be auto-corrected.`)) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("rebuild_product_stock", { p_product_id: null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم إعادة البناء" : "Rebuilt");
    await load();
    onChanged();
  };

  const rebuildOne = async (productId: string) => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("rebuild_product_stock", { p_product_id: productId });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم" : "Done");
    await load();
    onChanged();
  };

  const downloadCsv = () => {
    const headers = ["product_id", "product_name", "serial", "color", "current_stock", "logs_sum", "diff"];
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(",")].concat(
      rows.map((r) => [r.product_id, r.product_name, r.serial_number, r.color, r.current_stock, r.logs_sum, r.diff].map(esc).join(",")),
    ).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4 space-y-3 border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <div>
            <h2 className="text-base font-bold">
              {isAr ? "تقرير تسوية المخزون" : "Stock reconciliation report"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isAr
                ? "مقارنة المخزون الحالي بمجموع كل حركات السجل. لو في فرق = خطأ في البيانات."
                : "Compares current stock vs sum of all inventory logs. A diff = data error."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1 h-8">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {isAr ? "تحديث" : "Refresh"}
          </Button>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0} className="gap-1 h-8">
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            size="sm" disabled={busy || mismatched.length === 0}
            onClick={rebuildAll}
            className="gap-1 h-8 bg-amber-600 hover:bg-amber-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {isAr ? `إعادة بناء (${mismatched.length})` : `Rebuild (${mismatched.length})`}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
          <CheckCircle2 className="h-3 w-3 me-1" />
          {rows.length - mismatched.length} {isAr ? "متطابق" : "ok"}
        </Badge>
        <Badge variant="outline" className="bg-rose-500/10 text-rose-700 border-rose-500/30">
          <AlertTriangle className="h-3 w-3 me-1" />
          {mismatched.length} {isAr ? "فرق" : "mismatched"}
        </Badge>
        <label className="ms-auto inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyMismatch}
            onChange={(e) => setOnlyMismatch(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {isAr ? "إظهار الفروقات فقط" : "Show mismatches only"}
        </label>
      </div>

      {view.length > 0 && (
        <div className="rounded border bg-background overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 z-10">
              <tr>
                <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                <th className="p-2 text-center">{isAr ? "حالي" : "Current"}</th>
                <th className="p-2 text-center">{isAr ? "من السجل" : "Logs sum"}</th>
                <th className="p-2 text-center">{isAr ? "الفرق" : "Diff"}</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.slice(0, 100).map((r) => (
                <tr key={r.product_id} className={r.diff !== 0 ? "bg-rose-500/5" : ""}>
                  <td className="p-2">
                    <div className="font-medium">{r.product_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.serial_number || "—"} · {r.color || "—"}
                    </div>
                  </td>
                  <td className="p-2 text-center tabular-nums font-semibold">{r.current_stock}</td>
                  <td className="p-2 text-center tabular-nums text-muted-foreground">{r.logs_sum}</td>
                  <td className={`p-2 text-center tabular-nums font-bold ${r.diff === 0 ? "text-emerald-600" : "text-rose-700"}`}>
                    {r.diff > 0 ? "+" : ""}{r.diff}
                  </td>
                  <td className="p-2">
                    {r.diff !== 0 && (
                      <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={busy}
                        onClick={() => rebuildOne(r.product_id)}>
                        {isAr ? "إصلاح" : "Fix"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.length > 100 && (
            <div className="p-2 text-center text-[11px] text-muted-foreground">
              {isAr ? `أول 100 من ${view.length}` : `First 100 of ${view.length}`}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

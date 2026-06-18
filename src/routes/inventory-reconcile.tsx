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

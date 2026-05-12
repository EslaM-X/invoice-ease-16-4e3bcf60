import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtDate, fmtMoney } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Warehouse,
  Plus,
  Trash2,
  PackagePlus,
  Truck,
  Receipt,
  Search,
  TrendingUp,
  Boxes,
  History,
} from "lucide-react";

type Product = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  stock_quantity: number;
  cost_price: number;
  image_url: string | null;
};

type Row = {
  product_id: string;
  quantity: number;
  unit_cost: number;
};

type Intake = {
  id: string;
  intake_number: string;
  supplier_name: string | null;
  invoice_reference: string | null;
  pricing_mode: string;
  bulk_total: number | null;
  notes: string | null;
  total_cost: number;
  total_qty: number;
  created_at: string;
  created_by_email: string | null;
  stock_intake_items: Array<{
    id: string;
    product_name: string;
    serial_number: string | null;
    color: string | null;
    quantity: number;
    unit_cost: number;
    previous_cost: number | null;
    new_avg_cost: number | null;
    line_total: number;
  }>;
};

export const Route = createFileRoute("/stock-intake")({
  component: () => (
    <AppShell>
      <StockIntake />
    </AppShell>
  ),
});

function StockIntake() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [supplier, setSupplier] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [pricingMode, setPricingMode] = useState<"per_unit" | "bulk">("per_unit");
  const [bulkTotal, setBulkTotal] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: i }] = await Promise.all([
      supabase
        .from("products")
        .select("id,name,serial_number,color,stock_quantity,cost_price,image_url")
        .order("name"),
      supabase
        .from("stock_intakes")
        .select("*, stock_intake_items(*)")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setProducts((p ?? []) as Product[]);
    setIntakes((i ?? []) as Intake[]);
  };
  useEffect(() => {
    if (user) load();
  }, [user]);
  useRealtimeTable("stock_intakes", () => user && load());
  useRealtimeTable("products", () => user && load());

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.serial_number ?? "").toLowerCase().includes(q),
    );
  }, [products, search]);

  const addRow = (product_id: string) => {
    if (rows.find((r) => r.product_id === product_id)) {
      toast.info(lang === "ar" ? "المنتج مضاف بالفعل" : "Already added");
      return;
    }
    const p = products.find((x) => x.id === product_id);
    setRows((r) => [
      ...r,
      { product_id, quantity: 1, unit_cost: Number(p?.cost_price ?? 0) },
    ]);
  };
  const removeRow = (id: string) =>
    setRows((r) => r.filter((x) => x.product_id !== id));
  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((r) => r.map((x) => (x.product_id === id ? { ...x, ...patch } : x)));

  const totalUnits = rows.reduce((s, r) => s + (r.quantity || 0), 0);
  const totalCost =
    pricingMode === "bulk"
      ? Number(bulkTotal || 0)
      : rows.reduce((s, r) => s + (r.quantity || 0) * (r.unit_cost || 0), 0);
  const bulkUnitCost =
    pricingMode === "bulk" && totalUnits > 0 ? Number(bulkTotal || 0) / totalUnits : 0;

  const submit = async () => {
    if (rows.length === 0) {
      toast.error(lang === "ar" ? "أضف منتج على الأقل" : "Add at least one product");
      return;
    }
    if (rows.some((r) => !r.quantity || r.quantity <= 0)) {
      toast.error(lang === "ar" ? "كميات غير صالحة" : "Invalid quantities");
      return;
    }
    if (pricingMode === "bulk" && (!bulkTotal || bulkTotal < 0)) {
      toast.error(lang === "ar" ? "أدخل إجمالي الشحنة" : "Enter bulk total");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("record_stock_intake", {
      _supplier_name: supplier || "",
      _invoice_reference: invoiceRef || "",
      _pricing_mode: pricingMode,
      _bulk_total: pricingMode === "bulk" ? bulkTotal : 0,
      _notes: notes || "",
      _items: rows.map((r) => ({
        product_id: r.product_id,
        quantity: r.quantity,
        unit_cost: r.unit_cost,
      })) as any,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("intake_saved"));
    setRows([]);
    setSupplier("");
    setInvoiceRef("");
    setBulkTotal(0);
    setNotes("");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gradient-gold">
          <Warehouse className="h-6 w-6" />
          {t("stock_intake")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("stock_intake_desc")}</p>
      </div>

      {/* Form */}
      <div className="card-premium space-y-5 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <PackagePlus className="h-4 w-4 text-primary" />
          {t("new_intake")}
        </div>

        {/* Header fields */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Truck className="h-3.5 w-3.5" />
              {t("supplier")}
            </Label>
            <Input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder={lang === "ar" ? "اسم المورد" : "Supplier name"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs">
              <Receipt className="h-3.5 w-3.5" />
              {t("invoice_reference")}
            </Label>
            <Input
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              placeholder="INV-..."
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">{lang === "ar" ? "طريقة التسعير" : "Pricing mode"}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={pricingMode === "per_unit" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setPricingMode("per_unit")}
              >
                {t("pricing_mode_per_unit")}
              </Button>
              <Button
                type="button"
                variant={pricingMode === "bulk" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setPricingMode("bulk")}
              >
                {t("pricing_mode_bulk")}
              </Button>
            </div>
          </div>
        </div>

        {pricingMode === "bulk" && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Label className="text-xs">{t("bulk_total_label")} (EGP)</Label>
            <Input
              type="number"
              step="any"
              value={bulkTotal || ""}
              onChange={(e) => setBulkTotal(Number(e.target.value))}
              className="mt-1"
            />
            {totalUnits > 0 && bulkTotal > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                {lang === "ar" ? "تكلفة موزّعة لكل وحدة:" : "Spread per unit:"}{" "}
                <span className="font-bold text-primary tabular-nums">
                  {fmtMoney(bulkUnitCost, "EGP", lang)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Add product */}
        <div className="space-y-2">
          <Label className="text-xs">{t("search_product")}</Label>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search_product")}
              className="ps-9"
            />
          </div>
          {search.trim() && (
            <div className="max-h-48 overflow-y-auto rounded-lg border bg-background/50">
              {filteredProducts.slice(0, 12).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    addRow(p.id);
                    setSearch("");
                  }}
                  className="flex w-full items-center gap-3 border-b px-3 py-2 text-start text-sm last:border-b-0 hover:bg-accent"
                >
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-8 w-8 rounded border object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded border bg-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.serial_number || "—"} · {lang === "ar" ? "المخزون:" : "Stock:"}{" "}
                      {p.stock_quantity}
                    </div>
                  </div>
                  <Plus className="h-4 w-4 text-primary" />
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("no_data")}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rows */}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t("product")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("quantity")}</th>
                  {pricingMode === "per_unit" && (
                    <th className="px-3 py-2 text-start font-medium">{t("unit_cost")}</th>
                  )}
                  <th className="px-3 py-2 text-start font-medium">{t("previous_avg")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("new_avg_cost")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("line_total")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const p = products.find((x) => x.id === r.product_id);
                  if (!p) return null;
                  const uc = pricingMode === "bulk" ? bulkUnitCost : r.unit_cost;
                  const prevValue = (p.cost_price || 0) * Math.max(p.stock_quantity, 0);
                  const newQty = Math.max(p.stock_quantity, 0) + (r.quantity || 0);
                  const newAvg =
                    newQty > 0 ? (prevValue + uc * (r.quantity || 0)) / newQty : uc;
                  const line = uc * (r.quantity || 0);
                  return (
                    <tr key={r.product_id}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {p.image_url ? (
                            <img src={p.image_url} alt="" className="h-7 w-7 rounded border object-cover" />
                          ) : (
                            <div className="h-7 w-7 rounded border bg-muted" />
                          )}
                          <div>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {p.serial_number || "—"}
                              {p.color && ` · ${p.color}`}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="1"
                          value={r.quantity || ""}
                          onChange={(e) =>
                            updateRow(r.product_id, { quantity: Number(e.target.value) })
                          }
                          className="h-8 w-20"
                        />
                      </td>
                      {pricingMode === "per_unit" && (
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={r.unit_cost || ""}
                            onChange={(e) =>
                              updateRow(r.product_id, { unit_cost: Number(e.target.value) })
                            }
                            className="h-8 w-28"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                        {fmtMoney(p.cost_price || 0, "EGP", lang)}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-primary tabular-nums">
                        {fmtMoney(newAvg, "EGP", lang)}
                      </td>
                      <td className="px-3 py-2 font-semibold tabular-nums">
                        {fmtMoney(line, "EGP", lang)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removeRow(r.product_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-muted/30 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-2">
                    {t("total_units")}: <span className="tabular-nums">{totalUnits}</span>
                  </td>
                  <td colSpan={pricingMode === "per_unit" ? 4 : 3}></td>
                  <td className="px-3 py-2 tabular-nums text-primary">
                    {fmtMoney(totalCost, "EGP", lang)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">{t("notes")}</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={lang === "ar" ? "ملاحظات اختيارية..." : "Optional notes..."}
          />
        </div>

        <Button
          onClick={submit}
          disabled={submitting || rows.length === 0}
          className="w-full sm:w-auto"
        >
          <PackagePlus className="me-2 h-4 w-4" />
          {submitting ? t("loading") : t("intake_saved").replace(/^تم |Recorded.*/, "") || t("save")}
          {" "}
          {!submitting && `· ${totalUnits} ${lang === "ar" ? "قطعة" : "units"} · ${fmtMoney(totalCost, "EGP", lang)}`}
        </Button>
      </div>

      {/* History */}
      <div className="card-premium rounded-2xl border bg-card p-5">
        <div className="mb-4 flex items-center gap-2 font-semibold">
          <History className="h-4 w-4 text-primary" />
          {t("intake_history")}
        </div>
        {intakes.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("no_intakes")}</div>
        ) : (
          <div className="space-y-3">
            {intakes.map((it) => (
              <div key={it.id} className="rounded-lg border bg-background/50 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-mono font-bold text-primary">{it.intake_number}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(it.created_at, lang)}
                  </span>
                  {it.supplier_name && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Truck className="h-3 w-3" /> {it.supplier_name}
                    </span>
                  )}
                  {it.invoice_reference && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Receipt className="h-3 w-3" /> {it.invoice_reference}
                    </span>
                  )}
                  <span className="ms-auto inline-flex items-center gap-1 text-xs">
                    <Boxes className="h-3 w-3" />
                    <span className="font-semibold tabular-nums">{it.total_qty}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-primary">
                    <TrendingUp className="h-3 w-3" />
                    {fmtMoney(it.total_cost, "EGP", lang)}
                  </span>
                </div>
                {it.stock_intake_items?.length > 0 && (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    {it.stock_intake_items.map((li) => (
                      <div
                        key={li.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
                      >
                        <span className="font-medium">{li.product_name}</span>
                        {li.serial_number && (
                          <span className="font-mono text-muted-foreground">{li.serial_number}</span>
                        )}
                        <span className="tabular-nums">
                          ×{li.quantity} @ {fmtMoney(li.unit_cost, "EGP", lang)}
                        </span>
                        {li.previous_cost !== null && li.new_avg_cost !== null && (
                          <span className="text-muted-foreground">
                            ({fmtMoney(li.previous_cost, "EGP", lang)} →{" "}
                            <span className="font-semibold text-primary">
                              {fmtMoney(li.new_avg_cost, "EGP", lang)}
                            </span>
                            )
                          </span>
                        )}
                        <span className="ms-auto font-semibold tabular-nums">
                          {fmtMoney(li.line_total, "EGP", lang)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {it.notes && (
                  <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                    {it.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";
import { fmtMoney } from "@/lib/utils-money";
import { Copy, Printer, ShoppingCart, Sparkles } from "lucide-react";
import { toast } from "sonner";

export type RestockProduct = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  cost_price?: number | null;
  price?: number | null;
  image_url?: string | null;
};

type Row = {
  selected: boolean;
  qty: number;
  unitCost: number;
};

type PricingMode = "individual" | "bulk";

export function RestockOrderDialog({
  open,
  onOpenChange,
  products,
  initialProductId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: RestockProduct[];
  initialProductId?: string | null;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [mode, setMode] = useState<PricingMode>("individual");
  const [bulkTotal, setBulkTotal] = useState<number>(0);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");

  // Smart suggested qty: bring stock back to 2x threshold (or +threshold if zero)
  const suggestQty = (p: RestockProduct) => {
    const target = Math.max(p.low_stock_threshold * 2, p.low_stock_threshold + 5);
    return Math.max(target - p.stock_quantity, p.low_stock_threshold || 1);
  };

  useEffect(() => {
    if (!open) return;
    const next: Record<string, Row> = {};
    products.forEach((p) => {
      const preselect = initialProductId ? p.id === initialProductId : true;
      next[p.id] = {
        selected: preselect,
        qty: suggestQty(p),
        unitCost: Number(p.cost_price ?? 0),
      };
    });
    setRows(next);
    setBulkTotal(0);
    setSupplier("");
    setNotes("");
    setMode("individual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProductId, products.length]);

  const selectedItems = useMemo(
    () => products.filter((p) => rows[p.id]?.selected && (rows[p.id]?.qty ?? 0) > 0),
    [products, rows]
  );

  const totalUnits = selectedItems.reduce((s, p) => s + (rows[p.id]?.qty ?? 0), 0);
  const totalIndividual = selectedItems.reduce(
    (s, p) => s + (rows[p.id]?.qty ?? 0) * (rows[p.id]?.unitCost ?? 0),
    0
  );
  const grandTotal = mode === "bulk" ? bulkTotal : totalIndividual;

  const buildText = () => {
    const lines: string[] = [];
    lines.push(isAr ? "═══ طلب شراء / إعادة تخزين ═══" : "═══ Purchase / Restock Order ═══");
    lines.push(new Date().toLocaleString(isAr ? "ar-EG" : "en-US"));
    if (supplier) lines.push((isAr ? "المورد: " : "Supplier: ") + supplier);
    lines.push("");
    lines.push(isAr ? "── المنتجات ──" : "── Items ──");
    selectedItems.forEach((p, i) => {
      const r = rows[p.id]!;
      const sn = p.serial_number ? ` [${p.serial_number}]` : "";
      const col = p.color ? ` (${p.color})` : "";
      const priceLine =
        mode === "individual"
          ? `  ${fmtMoney(r.unitCost, "EGP", lang)} × ${r.qty} = ${fmtMoney(r.qty * r.unitCost, "EGP", lang)}`
          : `  ${isAr ? "الكمية" : "Qty"}: ${r.qty}`;
      lines.push(`${i + 1}. ${p.name}${sn}${col}`);
      lines.push(priceLine);
    });
    lines.push("");
    lines.push((isAr ? "إجمالي القطع: " : "Total units: ") + totalUnits);
    lines.push((isAr ? "الإجمالي: " : "Grand total: ") + fmtMoney(grandTotal, "EGP", lang));
    if (notes) {
      lines.push("");
      lines.push((isAr ? "ملاحظات: " : "Notes: ") + notes);
    }
    return lines.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      toast.success(isAr ? "تم النسخ" : "Copied");
    } catch {
      toast.error(isAr ? "فشل النسخ" : "Copy failed");
    }
  };

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const text = buildText();
    w.document.write(`<!doctype html><html dir="${isAr ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${
      isAr ? "طلب شراء" : "Purchase Order"
    }</title><style>body{font-family:system-ui,Arial;padding:24px;white-space:pre-wrap;line-height:1.6}</style></head><body>${text.replace(
      /</g,
      "&lt;"
    )}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 250);
  };

  const applySuggestedAll = () => {
    setRows((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        next[p.id] = { ...next[p.id], qty: suggestQty(p), selected: true };
      });
      return next;
    });
    toast.success(isAr ? "تم تطبيق الكمية الذكية" : "Smart quantities applied");
  };

  const selectAll = (v: boolean) => {
    setRows((prev) => {
      const next = { ...prev };
      products.forEach((p) => (next[p.id] = { ...next[p.id], selected: v }));
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {isAr ? "إنشاء طلب شراء / إعادة تخزين" : "Create Restock / Purchase Order"}
          </DialogTitle>
        </DialogHeader>

        {/* Smart prompt */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            {isAr ? "اختر طريقة الطلب" : "Choose order mode"}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("individual")}
              className={`rounded-md border p-3 text-start text-xs transition ${
                mode === "individual" ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              }`}
            >
              <div className="font-semibold">
                {isAr ? "سعر منفصل لكل منتج" : "Individual price per product"}
              </div>
              <div className="text-muted-foreground">
                {isAr
                  ? "أدخل سعر التكلفة لكل صنف على حدة"
                  : "Enter cost per item separately"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("bulk")}
              className={`rounded-md border p-3 text-start text-xs transition ${
                mode === "bulk" ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              }`}
            >
              <div className="font-semibold">
                {isAr ? "سعر مجمّع للشحنة كلها" : "Single bulk price for whole shipment"}
              </div>
              <div className="text-muted-foreground">
                {isAr ? "إجمالي واحد للشحنة من المورد" : "One total for the supplier shipment"}
              </div>
            </button>
          </div>
        </div>

        {/* Supplier */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{isAr ? "المورد" : "Supplier"}</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={isAr ? "اسم المورد" : "Supplier name"} />
          </div>
          {mode === "bulk" && (
            <div>
              <Label className="text-xs">{isAr ? "إجمالي الشحنة (EGP)" : "Bulk total (EGP)"}</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={bulkTotal || ""}
                onChange={(e) => setBulkTotal(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={applySuggestedAll}>
            <Sparkles className="me-1 h-3.5 w-3.5" />
            {isAr ? "اقتراح ذكي للكميات" : "Smart suggest qty"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => selectAll(true)}>
            {isAr ? "تحديد الكل" : "Select all"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => selectAll(false)}>
            {isAr ? "إلغاء التحديد" : "Clear"}
          </Button>
          <span className="ms-auto text-xs text-muted-foreground">
            {isAr ? "المحدد: " : "Selected: "}
            <span className="font-bold text-foreground">{selectedItems.length}</span>
          </span>
        </div>

        {/* Items */}
        <div className="max-h-[40vh] overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th className="p-2 text-start"> </th>
                <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                <th className="p-2 text-start">{isAr ? "المخزون" : "Stock"}</th>
                <th className="p-2 text-start">{isAr ? "الكمية" : "Qty"}</th>
                {mode === "individual" && (
                  <th className="p-2 text-start">{isAr ? "تكلفة الوحدة (قابلة للتعديل)" : "Unit cost (editable)"}</th>
                )}
                {mode === "individual" && (
                  <th className="p-2 text-start">{isAr ? "متوسط جديد" : "New avg"}</th>
                )}
                {mode === "individual" && (
                  <th className="p-2 text-end">{isAr ? "إجمالي" : "Total"}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((p) => {
                const r = rows[p.id];
                if (!r) return null;
                return (
                  <tr key={p.id} className={r.selected ? "" : "opacity-50"}>
                    <td className="p-2 align-top">
                      <Checkbox
                        checked={r.selected}
                        onCheckedChange={(v) =>
                          setRows((prev) => ({ ...prev, [p.id]: { ...prev[p.id], selected: !!v } }))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        {p.serial_number && <span className="font-mono">{p.serial_number}</span>}
                        {p.color && (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="inline-block h-2 w-2 rounded-full border"
                              style={{ background: p.color }}
                            />
                            {p.color}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 tabular-nums">
                      <span className={p.stock_quantity <= 0 ? "font-bold text-destructive" : "text-warning-foreground"}>
                        {p.stock_quantity}
                      </span>
                      <span className="text-muted-foreground">/{p.low_stock_threshold}</span>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={0}
                        className="h-7 w-20"
                        value={r.qty || ""}
                        onChange={(e) =>
                          setRows((prev) => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], qty: Math.max(0, Number(e.target.value) || 0) },
                          }))
                        }
                      />
                    </td>
                    {mode === "individual" && (
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-7 w-24"
                          value={r.unitCost || ""}
                          onChange={(e) =>
                            setRows((prev) => ({
                              ...prev,
                              [p.id]: { ...prev[p.id], unitCost: Math.max(0, Number(e.target.value) || 0) },
                            }))
                          }
                        />
                      </td>
                    )}
                    {mode === "individual" && (
                      <td className="p-2 text-end font-semibold tabular-nums">
                        {fmtMoney(r.qty * r.unitCost, "EGP", lang)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Notes + totals */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{isAr ? "ملاحظات" : "Notes"}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{isAr ? "إجمالي القطع" : "Total units"}</span>
              <span className="font-bold tabular-nums">{totalUnits}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">{isAr ? "الإجمالي" : "Grand total"}</span>
              <span className="font-bold tabular-nums text-primary">{fmtMoney(grandTotal, "EGP", lang)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? "إغلاق" : "Close"}
          </Button>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={selectedItems.length === 0}>
            <Copy className="me-1 h-4 w-4" />
            {isAr ? "نسخ الطلب" : "Copy order"}
          </Button>
          <Button type="button" onClick={handlePrint} disabled={selectedItems.length === 0}>
            <Printer className="me-1 h-4 w-4" />
            {isAr ? "طباعة / حفظ PDF" : "Print / Save PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Plus, Trash2, PackagePlus } from "lucide-react";

type Product = {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
};

type Row = {
  key: string;
  product: Product | null;
  quantity: number;
  unit_price: number;
  discount: number;
  freeText: string;
};

const newRow = (): Row => ({
  key: crypto.randomUUID(),
  product: null,
  quantity: 1,
  unit_price: 0,
  discount: 0,
  freeText: "",
});

export function AddItemsToInvoiceDialog({
  invoiceId,
  invoiceNumber,
  onAdded,
}: {
  invoiceId: string;
  invoiceNumber: string;
  onAdded?: () => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,price,stock_quantity,serial_number,color,image_url")
        .order("name", { ascending: true })
        .limit(2000);
      setProducts((data ?? []) as any);
    })();
  }, [open, user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.serial_number?.toLowerCase().includes(q) ||
          p.color?.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [products, search]);

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pickProduct = (key: string, p: Product) =>
    setRow(key, { product: p, unit_price: Number(p.price ?? 0), freeText: "" });

  const removeRow = (key: string) =>
    setRows((rs) => (rs.length === 1 ? [newRow()] : rs.filter((r) => r.key !== key)));

  const total = rows.reduce((s, r) => s + Math.max(0, r.quantity * r.unit_price - r.discount), 0);

  const save = async () => {
    const items = rows
      .filter((r) => r.product || r.freeText.trim())
      .map((r) => ({
        product_id: r.product?.id ?? null,
        product_name: r.product?.name ?? r.freeText.trim(),
        serial_number: r.product?.serial_number ?? null,
        color: r.product?.color ?? null,
        quantity: Math.max(1, Math.floor(r.quantity)),
        unit_price: Math.max(0, r.unit_price),
        discount: Math.max(0, r.discount),
      }));
    if (items.length === 0) {
      toast.error(isAr ? "أضف بندًا واحدًا على الأقل" : "Add at least one item");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("add_invoice_items" as any, {
        _invoice_id: invoiceId,
        _items: items as any,
      } as any);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        isAr
          ? `تمت إضافة ${items.length} بند إلى ${invoiceNumber}`
          : `Added ${items.length} item(s) to ${invoiceNumber}`,
      );
      setRows([newRow()]);
      setOpen(false);
      onAdded?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 rounded-full border-amber-500/50 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30">
          <PackagePlus className="h-4 w-4" />
          {isAr ? "إضافة منتج للفاتورة" : "Add items"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-amber-600" />
            {isAr
              ? `إضافة منتجات إلى الفاتورة ${invoiceNumber}`
              : `Add items to invoice ${invoiceNumber}`}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          {isAr
            ? "المنتجات المُضافة تُحجَز من المخزون تلقائيًا، ويمكنك بعدها إصدار محضر استلام جديد لها. البنود والمحاضر السابقة لن تتأثر إطلاقًا."
            : "New items are auto-reserved from stock. You can then issue a new delivery receipt for them. Existing items and receipts stay untouched."}
        </div>

        <div className="space-y-3">
          {rows.map((r, idx) => (
            <div key={r.key} className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground">
                  {isAr ? `بند ${idx + 1}` : `Item ${idx + 1}`}
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeRow(r.key)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {r.product ? (
                <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
                  {r.product.image_url && (
                    <img src={r.product.image_url} alt="" className="h-12 w-12 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate font-semibold">{r.product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {isAr ? "المخزون" : "Stock"}: {r.product.stock_quantity}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setRow(r.key, { product: null })}>
                    {isAr ? "تغيير" : "Change"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder={isAr ? "ابحث عن منتج بالاسم أو السيريال..." : "Search product by name or serial..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProduct(r.key, p)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <div className="min-w-0 flex-1 truncate">{p.name}</div>
                        <span className="text-xs text-muted-foreground">
                          {isAr ? "مخزون" : "stk"}: {p.stock_quantity}
                        </span>
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <div className="p-3 text-center text-xs text-muted-foreground">
                        {isAr ? "لا توجد نتائج" : "No matches"}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {isAr ? "أو أضف بند نصي حر:" : "Or add a free-text line:"}
                  </div>
                  <Input
                    placeholder={isAr ? "وصف البند" : "Item description"}
                    value={r.freeText}
                    onChange={(e) => setRow(r.key, { freeText: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">{isAr ? "الكمية" : "Quantity"}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={r.quantity}
                    onChange={(e) => setRow(r.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">{isAr ? "سعر الوحدة" : "Unit price"}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.unit_price}
                    onChange={(e) => setRow(r.key, { unit_price: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">{isAr ? "خصم" : "Discount"}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.discount}
                    onChange={(e) => setRow(r.key, { discount: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => setRows((rs) => [...rs, newRow()])}
            className="w-full gap-2"
          >
            <Plus className="h-4 w-4" />
            {isAr ? "إضافة بند آخر" : "Add another line"}
          </Button>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-sm">
            <span className="text-muted-foreground">{isAr ? "إجمالي الإضافة:" : "Added total:"} </span>
            <span className="font-bold ltr-nums">{total.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={save} disabled={saving} className="gap-2 shadow-glow">
              <PackagePlus className="h-4 w-4" />
              {saving ? (isAr ? "جارٍ الحفظ..." : "Saving...") : (isAr ? "إضافة وحجز" : "Add & reserve")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Layers, Plus, Trash2, Search, Sliders } from "lucide-react";

type Override = {
  id?: string;
  distributor_id: string;
  product_id: string | null;
  visible_qty: number | null;
  visible_pct: number | null;
  notes: string | null;
};

type Product = { id: string; name: string; serial_number: string | null; color: string | null; stock_quantity: number; safety_margin: number | null };

export function StockOverridesButton({ distributorId, distributorName }: { distributorId: string; distributorName: string }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Sliders className="me-1 h-3 w-3" /> {isAr ? "حد الكميات" : "Stock visibility"}
      </Button>
      {open && (
        <StockOverridesDialog
          distributorId={distributorId}
          distributorName={distributorName}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function StockOverridesDialog({ distributorId, distributorName, open, onClose }: { distributorId: string; distributorName: string; open: boolean; onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [globalQty, setGlobalQty] = useState<string>("");
  const [globalPct, setGlobalPct] = useState<string>("");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: prods }, { data: ovs }] = await Promise.all([
      supabase.from("products").select("id,name,serial_number,color,stock_quantity,safety_margin").order("name"),
      (supabase.from as any)("distributor_stock_overrides").select("*").eq("distributor_id", distributorId),
    ]);
    setProducts((prods as Product[]) ?? []);
    const list = (ovs as Override[]) ?? [];
    setOverrides(list);
    const g = list.find((o) => o.product_id === null);
    setGlobalQty(g?.visible_qty != null ? String(g.visible_qty) : "");
    setGlobalPct(g?.visible_pct != null ? String(g.visible_pct) : "");
    setLoading(false);
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open]);

  const overrideByProduct = useMemo(() => {
    const m = new Map<string, Override>();
    for (const o of overrides) if (o.product_id) m.set(o.product_id, o);
    return m;
  }, [overrides]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    return products.filter((p) => [p.name, p.serial_number, p.color].some((x) => (x || "").toLowerCase().includes(s)));
  }, [products, q]);

  const saveGlobal = async () => {
    setSaving(true);
    const payload = {
      distributor_id: distributorId,
      product_id: null,
      visible_qty: globalQty.trim() === "" ? null : Number(globalQty),
      visible_pct: globalPct.trim() === "" ? null : Number(globalPct),
    };
    const existing = overrides.find((o) => o.product_id === null);
    try {
      if (existing) {
        const { error } = await (supabase.from as any)("distributor_stock_overrides").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else if (payload.visible_qty != null || payload.visible_pct != null) {
        const { error } = await (supabase.from as any)("distributor_stock_overrides").insert(payload);
        if (error) throw error;
      }
      toast.success(isAr ? "تم حفظ القاعدة العامة" : "Global rule saved");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const clearGlobal = async () => {
    const existing = overrides.find((o) => o.product_id === null);
    if (!existing?.id) { setGlobalQty(""); setGlobalPct(""); return; }
    const { error } = await (supabase.from as any)("distributor_stock_overrides").delete().eq("id", existing.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Cleared");
    load();
  };

  const upsertProduct = async (productId: string, qty: string, pct: string) => {
    const payload = {
      distributor_id: distributorId,
      product_id: productId,
      visible_qty: qty.trim() === "" ? null : Number(qty),
      visible_pct: pct.trim() === "" ? null : Number(pct),
    };
    const existing = overrideByProduct.get(productId);
    try {
      if (existing) {
        if (payload.visible_qty == null && payload.visible_pct == null) {
          const { error } = await (supabase.from as any)("distributor_stock_overrides").delete().eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await (supabase.from as any)("distributor_stock_overrides").update(payload).eq("id", existing.id);
          if (error) throw error;
        }
      } else if (payload.visible_qty != null || payload.visible_pct != null) {
        const { error } = await (supabase.from as any)("distributor_stock_overrides").insert(payload);
        if (error) throw error;
      }
      toast.success(isAr ? "تم الحفظ" : "Saved");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-amber-500" />
            {isAr ? "حد الكميات الظاهرة للموزّع" : "Visible stock limits"} — {distributorName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="flex-1 overflow-auto space-y-4 pe-1">
            {/* Global rule */}
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="outline" className="border-amber-400/40 text-amber-600">{isAr ? "قاعدة عامة لكل المنتجات" : "Global rule"}</Badge>
                <span className="text-[11px] text-muted-foreground">{isAr ? "تُطبَّق إذا لم يوجد حد لمنتج معيّن" : "Applies when no per-product rule exists"}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">{isAr ? "حد كمية ثابت" : "Fixed qty cap"}</label>
                  <Input type="number" min="0" value={globalQty} onChange={(e) => setGlobalQty(e.target.value)} placeholder={isAr ? "بدون حد" : "no limit"} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">{isAr ? "نسبة من المخزون %" : "% of real stock"}</label>
                  <Input type="number" min="0" max="100" value={globalPct} onChange={(e) => setGlobalPct(e.target.value)} placeholder={isAr ? "بدون حد" : "no limit"} />
                </div>
                <div className="flex items-end gap-2">
                  <Button size="sm" onClick={saveGlobal} disabled={saving}>{isAr ? "حفظ" : "Save"}</Button>
                  <Button size="sm" variant="ghost" onClick={clearGlobal}>{isAr ? "حذف" : "Clear"}</Button>
                </div>
              </div>
            </div>

            {/* Per-product */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> {isAr ? "حدود لكل منتج" : "Per-product limits"}</div>
                <div className="relative w-56">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? "ابحث..." : "Search..."} className="h-8 ps-7 text-xs" />
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                      <th className="p-2 text-center">{isAr ? "المخزون" : "Stock"}</th>
                      <th className="p-2 text-center">{isAr ? "حد ثابت" : "Qty cap"}</th>
                      <th className="p-2 text-center">%</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 200).map((p) => {
                      const ov = overrideByProduct.get(p.id);
                      return <ProductRow key={p.id} p={p} ov={ov} onSave={upsertProduct} isAr={isAr} />;
                    })}
                  </tbody>
                </table>
                {filtered.length > 200 && <div className="p-2 text-center text-[10px] text-muted-foreground">{isAr ? "اكتب اسم منتج للبحث" : "Type to search…"}</div>}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>{isAr ? "إغلاق" : "Close"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductRow({ p, ov, onSave, isAr }: { p: Product; ov?: Override; onSave: (id: string, qty: string, pct: string) => void; isAr: boolean }) {
  const [qty, setQty] = useState(ov?.visible_qty != null ? String(ov.visible_qty) : "");
  const [pct, setPct] = useState(ov?.visible_pct != null ? String(ov.visible_pct) : "");
  const real = Math.max(0, (p.stock_quantity || 0) - (p.safety_margin || 0));
  return (
    <tr className="border-t">
      <td className="p-2">
        <div className="font-medium">{p.name}</div>
        <div className="text-[10px] text-muted-foreground">{[p.serial_number, p.color].filter(Boolean).join(" • ")}</div>
      </td>
      <td className="p-2 text-center tabular-nums">{real}</td>
      <td className="p-2 text-center"><Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="h-7 w-20 text-center text-xs" /></td>
      <td className="p-2 text-center"><Input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} className="h-7 w-16 text-center text-xs" /></td>
      <td className="p-2 text-end">
        <Button size="sm" variant="ghost" onClick={() => onSave(p.id, qty, pct)}>{isAr ? "حفظ" : "Save"}</Button>
        {ov && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setQty(""); setPct(""); onSave(p.id, "", ""); }}><Trash2 className="h-3 w-3" /></Button>}
      </td>
    </tr>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { useRealtimeTable } from "@/lib/realtime";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Plus, ShoppingCart, Search, DollarSign, Calculator, FileText, Trash2, Minus, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/purchase-orders")({
  component: PurchaseOrdersPage,
});

type Product = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  cost_price_usd: number;
  price: number;
};

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  total_usd: number;
  total_qty: number;
  total_egp: number | null;
  usd_rate: number | null;
  notes: string | null;
  created_at: string;
  created_by_email: string | null;
  cfo_priced_at: string | null;
  cfo_priced_by_email?: string | null;
};

type POItem = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  image_url: string | null;
  quantity: number;
  unit_cost_usd: number;
  line_total_usd: number;
};

type Mode = "percent" | "fixed";

function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { isAdmin, isPurchasing, isCFO, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const isAr = lang === "ar";

  const [pos, setPos] = useState<PO[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Access guard
  useEffect(() => {
    if (!roleLoading && !isAdmin && !isPurchasing && !isCFO) {
      toast.error(isAr ? "غير مصرح" : "Not authorized");
      navigate({ to: "/dashboard" });
    }
  }, [roleLoading, isAdmin, isPurchasing, isCFO, navigate, isAr]);

  const loadPOs = async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setPos((data as any) ?? []);
  };

  useEffect(() => { loadPOs(); }, []);
  useRealtimeTable("purchase_orders", loadPOs, []);

  const statusBadge = (s: string) => {
    if (s === "pending_cfo") return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">{isAr ? "بانتظار التسعير" : "Awaiting pricing"}</Badge>;
    if (s === "priced") return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">{isAr ? "تم التسعير" : "Priced"}</Badge>;
    if (s === "received") return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30">{isAr ? "تم الاستلام" : "Received"}</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">{isAr ? "ملغى" : "Cancelled"}</Badge>;
    return <Badge>{s}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
        <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary shadow-sm">
                <ShoppingCart className="h-5 w-5" />
              </span>
              {isAr ? "أوامر الشراء" : "Purchase Orders"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isAr
                ? "أنشئ أوامر شراء بالدولار، والمدير المالي يضيف سعر الصرف والجمارك والشحن لاحتساب التكلفة بالجنيه."
                : "Create USD purchase orders. The CFO adds FX rate, customs, shipping & taxes to compute the EGP landed cost."}
            </p>
          </div>
          {(isAdmin || isPurchasing) && (
            <Button onClick={() => setCreateOpen(true)} size="lg" className="gap-2 shadow-md">
              <Plus className="h-4 w-4" /> {isAr ? "أمر شراء جديد" : "New Purchase Order"}
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isAr ? "الكل" : "All"} ({pos.length})
        </div>
        <div className="divide-y">
          {pos.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {isAr ? "لا توجد أوامر شراء بعد." : "No purchase orders yet."}
            </div>
          )}
          {pos.map((p) => (
            <button
              key={p.id}
              onClick={() => setDetailId(p.id)}
              className="flex w-full flex-wrap items-center gap-3 p-4 text-start transition hover:bg-accent/40"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="font-mono text-sm font-bold">{p.po_number}</div>
                <div className="text-xs text-muted-foreground">
                  {p.supplier_name || (isAr ? "بدون مورد" : "No supplier")} · {fmtDateTime(p.created_at, lang)}
                </div>
                {p.created_by_email && (
                  <div className="text-[10px] text-muted-foreground">{p.created_by_email}</div>
                )}
              </div>
              <div className="text-end">
                <div className="text-xs text-muted-foreground">{isAr ? "إجمالي USD" : "Total USD"}</div>
                <div className="font-bold tabular-nums">${(Number(p.total_usd) || 0).toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">{p.total_qty} {isAr ? "قطعة" : "units"}</div>
              </div>
              {p.total_egp != null && (
                <div className="text-end">
                  <div className="text-xs text-muted-foreground">{isAr ? "إجمالي EGP" : "Total EGP"}</div>
                  <div className="font-bold tabular-nums text-primary">{fmtMoney(Number(p.total_egp), "EGP", lang)}</div>
                </div>
              )}
              <div>{statusBadge(p.status)}</div>
            </button>
          ))}
        </div>
      </Card>

      {createOpen && (
        <CreatePODialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          userId={user?.id || ""}
          userEmail={user?.email || ""}
          onCreated={(id) => { loadPOs(); setDetailId(id); }}
        />
      )}

      {detailId && (
        <PODetailDialog
          poId={detailId}
          open={!!detailId}
          onOpenChange={(v) => { if (!v) setDetailId(null); }}
          isCFO={isCFO}
          isAdmin={isAdmin}
          isPurchasing={isPurchasing}
          userEmail={user?.email || ""}
          userId={user?.id || ""}
        />
      )}
    </div>
  );
}

/* ─────────────────────── Create PO Dialog ─────────────────────── */

type Row = { selected: boolean; qty: number; unitUsd: number };

function CreatePODialog({
  open, onOpenChange, userId, userEmail, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  userEmail: string;
  onCreated: (id: string) => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [showOnlyLow, setShowOnlyLow] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("products")
      .select("id,name,serial_number,color,image_url,stock_quantity,low_stock_threshold,cost_price_usd,price")
      .order("name", { ascending: true })
      .limit(1000)
      .then(({ data }) => {
        const list = (data as any as Product[]) ?? [];
        setProducts(list);
        const initial: Record<string, Row> = {};
        list.forEach((p) => {
          initial[p.id] = { selected: false, qty: Math.max(0, p.low_stock_threshold * 2 - p.stock_quantity), unitUsd: Number(p.cost_price_usd) || 0 };
        });
        setRows(initial);
      });
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (showOnlyLow && p.stock_quantity > p.low_stock_threshold) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.serial_number ?? "").toLowerCase().includes(q) ||
        (p.color ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search, showOnlyLow]);

  const selected = products.filter((p) => rows[p.id]?.selected && (rows[p.id]?.qty ?? 0) > 0);
  const totalQty = selected.reduce((s, p) => s + rows[p.id].qty, 0);
  const totalUsd = selected.reduce((s, p) => s + rows[p.id].qty * rows[p.id].unitUsd, 0);

  const submit = async () => {
    if (selected.length === 0) return toast.error(isAr ? "اختر منتج واحد على الأقل" : "Select at least one product");
    setSaving(true);
    try {
      // Generate PO number
      const { count } = await supabase.from("purchase_orders").select("*", { count: "exact", head: true });
      const yr = new Date().getFullYear();
      const poNumber = `PO-${yr}-${String((count ?? 0) + 1).padStart(4, "0")}`;

      const { data: po, error: e1 } = await supabase
        .from("purchase_orders")
        .insert({
          user_id: userId,
          po_number: poNumber,
          supplier_name: supplier || null,
          notes: notes || null,
          status: "pending_cfo",
          total_usd: totalUsd,
          total_qty: totalQty,
          created_by: userId,
          created_by_email: userEmail,
        } as any)
        .select("id")
        .single();
      if (e1) throw e1;

      const itemsPayload = selected.map((p) => {
        const r = rows[p.id];
        return {
          po_id: po.id,
          product_id: p.id,
          product_name: p.name,
          serial_number: p.serial_number,
          color: p.color,
          image_url: p.image_url,
          quantity: r.qty,
          unit_cost_usd: r.unitUsd,
          line_total_usd: r.qty * r.unitUsd,
        };
      });
      const { error: e2 } = await supabase.from("purchase_order_items").insert(itemsPayload as any);
      if (e2) throw e2;

      // Notify CFO role
      await supabase.from("notifications").insert({
        recipient_role: "cfo",
        type: "purchase_order",
        title: isAr ? "أمر شراء جديد بحاجة إلى تسعير" : "New PO needs pricing",
        body: `${poNumber} · $${totalUsd.toFixed(2)} · ${totalQty} ${isAr ? "قطعة" : "units"}${supplier ? ` · ${supplier}` : ""}`,
        link: "/purchase-orders",
        meta: { po_id: po.id, po_number: poNumber },
      } as any);

      toast.success(isAr ? "تم إنشاء أمر الشراء وإرسال إشعار للمدير المالي" : "PO created — CFO notified");
      onOpenChange(false);
      onCreated(po.id);
    } catch (err: any) {
      toast.error(err.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {isAr ? "أمر شراء جديد (USD)" : "New Purchase Order (USD)"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{isAr ? "المورد" : "Supplier"}</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={isAr ? "اسم المورد" : "Supplier name"} />
          </div>
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-8" placeholder={isAr ? "ابحث بالاسم أو السيريال أو اللون…" : "Search name / serial / color…"} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
              <Checkbox checked={showOnlyLow} onCheckedChange={(v) => setShowOnlyLow(!!v)} />
              {isAr ? "الناقص فقط" : "Low only"}
            </label>
          </div>
        </div>

        <BulkAdjustBar
          isAr={isAr}
          filteredIds={filtered.map((p) => p.id)}
          rows={rows}
          setRows={setRows}
        />

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr>
                <th className="p-2 text-start"> </th>
                <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                <th className="p-2 text-start">{isAr ? "المخزون" : "Stock"}</th>
                <th className="p-2 text-start">{isAr ? "الكمية" : "Qty"}</th>
                <th className="p-2 text-start">{isAr ? "سعر الوحدة (USD)" : "Unit USD"}</th>
                <th className="p-2 text-end">{isAr ? "إجمالي USD" : "Total USD"}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => {
                const r = rows[p.id];
                if (!r) return null;
                const low = p.stock_quantity <= p.low_stock_threshold;
                return (
                  <tr key={p.id} className={r.selected ? "bg-primary/5" : ""}>
                    <td className="p-2 align-top">
                      <Checkbox
                        checked={r.selected}
                        onCheckedChange={(v) => setRows((prev) => ({ ...prev, [p.id]: { ...prev[p.id], selected: !!v } }))}
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded border object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded border bg-muted" />
                        )}
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                            {p.serial_number && <span className="font-mono">{p.serial_number}</span>}
                            {p.color && (
                              <span className="inline-flex items-center gap-1">
                                <span className="inline-block h-2 w-2 rounded-full border" style={{ background: p.color }} />
                                {p.color}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2 tabular-nums">
                      <span className={low ? "font-bold text-destructive" : ""}>{p.stock_quantity}</span>
                      <span className="text-muted-foreground">/{p.low_stock_threshold}</span>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number" min={0} className="h-7 w-20"
                        value={r.qty || ""}
                        onChange={(e) => setRows((prev) => ({ ...prev, [p.id]: { ...prev[p.id], qty: Math.max(0, Number(e.target.value) || 0), selected: true } }))}
                      />
                    </td>
                    <td className="p-2">
                      <div className="relative">
                        <DollarSign className="absolute start-1 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="number" min={0} step="any" className="h-7 w-24 ps-5"
                          value={Number.isFinite(r.unitUsd) ? String(r.unitUsd) : ""}
                          onChange={(e) => setRows((prev) => ({ ...prev, [p.id]: { ...prev[p.id], unitUsd: Math.max(0, Number(e.target.value) || 0), selected: true } }))}
                        />
                      </div>
                    </td>
                    <td className="p-2 text-end font-semibold tabular-nums">${(r.qty * r.unitUsd).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{isAr ? "ملاحظات" : "Notes"}</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{isAr ? "عدد القطع" : "Total units"}</span>
              <span className="font-bold tabular-nums">{totalQty}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">{isAr ? "إجمالي USD" : "Total USD"}</span>
              <span className="font-bold tabular-nums text-primary">${totalUsd.toFixed(2)}</span>
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground">
              {isAr ? "سيتم إرسال إشعار تلقائي للمدير المالي لإدخال سعر الصرف والجمارك." : "CFO will be notified automatically to add FX rate and customs."}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={saving || selected.length === 0}>
            {saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "إنشاء وإرسال للمالي" : "Create & notify CFO")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────── PO Detail / CFO Pricing ─────────────────────── */

function PODetailDialog({
  poId, open, onOpenChange, isCFO, isAdmin, isPurchasing, userEmail, userId,
}: {
  poId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isCFO: boolean;
  isAdmin: boolean;
  isPurchasing: boolean;
  userEmail: string;
  userId: string;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const canEditPricing = isCFO || isAdmin;

  const [po, setPo] = useState<PO | null>(null);
  const [items, setItems] = useState<POItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Pricing form
  const [usdRate, setUsdRate] = useState<string>("");
  const [customsMode, setCustomsMode] = useState<Mode>("percent");
  const [customsValue, setCustomsValue] = useState<string>("");
  const [taxesMode, setTaxesMode] = useState<Mode>("percent");
  const [taxesValue, setTaxesValue] = useState<string>("");
  const [shippingMode, setShippingMode] = useState<Mode>("fixed");
  const [shippingValue, setShippingValue] = useState<string>("");
  const [otherMode, setOtherMode] = useState<Mode>("percent");
  const [otherValue, setOtherValue] = useState<string>("");
  const [cfoNotes, setCfoNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: poData }, { data: itemsData }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", poId).maybeSingle(),
      supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
    ]);
    if (poData) {
      const p = poData as any as PO & any;
      setPo(p);
      setUsdRate(p.usd_rate != null ? String(p.usd_rate) : "");
      setCustomsMode((p.customs_mode as Mode) || "percent");
      setCustomsValue(p.customs_value != null ? String(p.customs_value) : "");
      setTaxesMode((p.taxes_mode as Mode) || "percent");
      setTaxesValue(p.taxes_value != null ? String(p.taxes_value) : "");
      setShippingMode((p.shipping_mode as Mode) || "fixed");
      setShippingValue(p.shipping_value != null ? String(p.shipping_value) : "");
      setOtherMode((p.other_mode as Mode) || "percent");
      setOtherValue(p.other_value != null ? String(p.other_value) : "");
      setCfoNotes(p.cfo_notes ?? "");
    }
    setItems((itemsData as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, poId]);

  const totalUsd = po?.total_usd ?? 0;
  const rate = Number(usdRate) || 0;
  const baseEgp = totalUsd * rate;

  const calc = (mode: Mode, val: string) => {
    const v = Number(val) || 0;
    return mode === "percent" ? (baseEgp * v) / 100 : v;
  };
  const customsEgp = calc(customsMode, customsValue);
  const taxesEgp = calc(taxesMode, taxesValue);
  const shippingEgp = calc(shippingMode, shippingValue);
  const otherEgp = calc(otherMode, otherValue);
  const totalEgp = baseEgp + customsEgp + taxesEgp + shippingEgp + otherEgp;

  const savePricing = async () => {
    if (!rate) return toast.error(isAr ? "أدخل سعر الصرف أولاً" : "Enter the FX rate first");
    setSaving(true);
    try {
      const { error } = await supabase
        .from("purchase_orders")
        .update({
          usd_rate: rate,
          customs_mode: customsMode, customs_value: Number(customsValue) || 0,
          taxes_mode: taxesMode, taxes_value: Number(taxesValue) || 0,
          shipping_mode: shippingMode, shipping_value: Number(shippingValue) || 0,
          other_mode: otherMode, other_value: Number(otherValue) || 0,
          total_egp: totalEgp,
          cfo_notes: cfoNotes || null,
          status: "priced",
          cfo_priced_at: new Date().toISOString(),
          cfo_priced_by: userId,
          cfo_priced_by_email: userEmail,
        } as any)
        .eq("id", poId);
      if (error) throw error;

      // Notify purchasing role
      await supabase.from("notifications").insert({
        recipient_role: "purchasing",
        type: "purchase_order_priced",
        title: isAr ? "تم تسعير أمر الشراء" : "PO has been priced",
        body: `${po?.po_number} · ${fmtMoney(totalEgp, "EGP", lang)}`,
        link: "/purchase-orders",
        meta: { po_id: poId },
      } as any);

      toast.success(isAr ? "تم حفظ التسعير" : "Pricing saved");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  const deletePO = async () => {
    if (!confirm(isAr ? "حذف أمر الشراء نهائيًا؟" : "Delete this PO permanently?")) return;
    const { error } = await supabase.from("purchase_orders").delete().eq("id", poId);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {po?.po_number || (isAr ? "أمر شراء" : "Purchase Order")}
            </span>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={deletePO} className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading || !po ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</div>
        ) : (
          <>
            {/* Header info */}
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{isAr ? "المورد" : "Supplier"}</div>
                <div className="font-semibold">{po.supplier_name || "—"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{isAr ? "إجمالي USD" : "Total USD"}</div>
                <div className="font-bold text-primary tabular-nums">${(Number(po.total_usd) || 0).toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">{po.total_qty} {isAr ? "قطعة" : "units"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{isAr ? "أُنشئ بواسطة" : "Created by"}</div>
                <div className="text-xs">{po.created_by_email || "—"}</div>
                <div className="text-[10px] text-muted-foreground">{fmtDateTime(po.created_at, lang)}</div>
              </div>
            </div>

            {/* Items */}
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                {isAr ? "البنود" : "Items"}
              </div>
              <div className="divide-y">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 p-3 text-sm">
                    {it.image_url ? (
                      <img src={it.image_url} alt={it.product_name} className="h-12 w-12 rounded border object-cover" />
                    ) : (
                      <div className="h-12 w-12 rounded border bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{it.product_name}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                        {it.serial_number && <span className="font-mono">{it.serial_number}</span>}
                        {it.color && (
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-full border" style={{ background: it.color }} />
                            {it.color}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-end text-xs">
                      <div>${Number(it.unit_cost_usd).toFixed(2)} × {it.quantity}</div>
                      <div className="font-bold tabular-nums">${Number(it.line_total_usd).toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CFO pricing */}
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Calculator className="h-4 w-4 text-primary" />
                {isAr ? "تسعير المدير المالي" : "CFO Pricing"}
                {po.cfo_priced_at && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                    {isAr ? "تم بواسطة" : "Done by"} {po.cfo_priced_by_email}
                  </Badge>
                )}
              </div>

              {!canEditPricing && (
                <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                  {isAr ? "هذه البيانات يُدخلها المدير المالي فقط." : "Only the CFO can edit pricing."}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">{isAr ? "سعر صرف الدولار (EGP لكل $1)" : "USD → EGP rate"}</Label>
                  <Input type="number" step="any" min={0} value={usdRate} onChange={(e) => setUsdRate(e.target.value)} disabled={!canEditPricing} />
                </div>
                <div className="rounded border bg-background p-2 text-xs">
                  <div className="text-muted-foreground">{isAr ? "أساس بالجنيه (USD × سعر الصرف)" : "Base EGP (USD × rate)"}</div>
                  <div className="font-bold tabular-nums">{fmtMoney(baseEgp, "EGP", lang)}</div>
                </div>

                <PricingRow label={isAr ? "الجمارك" : "Customs"} mode={customsMode} setMode={setCustomsMode} value={customsValue} setValue={setCustomsValue} computedEgp={customsEgp} disabled={!canEditPricing} lang={lang} />
                <PricingRow label={isAr ? "الضرائب" : "Taxes"} mode={taxesMode} setMode={setTaxesMode} value={taxesValue} setValue={setTaxesValue} computedEgp={taxesEgp} disabled={!canEditPricing} lang={lang} />
                <PricingRow label={isAr ? "الشحن" : "Shipping"} mode={shippingMode} setMode={setShippingMode} value={shippingValue} setValue={setShippingValue} computedEgp={shippingEgp} disabled={!canEditPricing} lang={lang} />
                <PricingRow label={isAr ? "تكلفة إضافية" : "Other"} mode={otherMode} setMode={setOtherMode} value={otherValue} setValue={setOtherValue} computedEgp={otherEgp} disabled={!canEditPricing} lang={lang} />

                <div className="sm:col-span-2">
                  <Label className="text-xs">{isAr ? "ملاحظات المالي" : "CFO notes"}</Label>
                  <Textarea rows={2} value={cfoNotes} onChange={(e) => setCfoNotes(e.target.value)} disabled={!canEditPricing} />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-background border p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{isAr ? "إجمالي التكلفة بالجنيه" : "Total landed cost (EGP)"}</span>
                  <span className="font-bold text-lg tabular-nums text-primary">{fmtMoney(totalEgp, "EGP", lang)}</span>
                </div>
                {po.total_qty > 0 && (
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>{isAr ? "متوسط تكلفة القطعة" : "Avg cost / unit"}</span>
                    <span className="font-semibold tabular-nums">{fmtMoney(totalEgp / po.total_qty, "EGP", lang)}</span>
                  </div>
                )}
              </div>

              {canEditPricing && (
                <div className="mt-3 flex justify-end">
                  <Button onClick={savePricing} disabled={saving}>
                    {saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ التسعير وإشعار المشتريات" : "Save pricing & notify Purchasing")}
                  </Button>
                </div>
              )}
            </div>

            {po.notes && (
              <div className="rounded-lg border p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-1">{isAr ? "ملاحظات المشتريات" : "Purchasing notes"}</div>
                <div className="whitespace-pre-wrap">{po.notes}</div>
              </div>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAr ? "إغلاق" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PricingRow({
  label, mode, setMode, value, setValue, computedEgp, disabled, lang,
}: {
  label: string; mode: Mode; setMode: (m: Mode) => void;
  value: string; setValue: (v: string) => void;
  computedEgp: number; disabled: boolean; lang: "ar" | "en";
}) {
  const isAr = lang === "ar";
  return (
    <div className="rounded border bg-background p-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold">{label}</span>
        <div className="flex gap-1">
          <button type="button" disabled={disabled} onClick={() => setMode("percent")}
            className={`rounded px-2 py-0.5 text-[10px] ${mode === "percent" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>%</button>
          <button type="button" disabled={disabled} onClick={() => setMode("fixed")}
            className={`rounded px-2 py-0.5 text-[10px] ${mode === "fixed" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>EGP</button>
        </div>
      </div>
      <Input type="number" step="any" min={0} className="mt-1 h-7"
        value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled}
        placeholder={mode === "percent" ? "0.00 %" : "0.00 EGP"} />
      <div className="mt-1 text-[10px] text-muted-foreground">
        ≈ {fmtMoney(computedEgp, "EGP", lang)} {mode === "percent" ? (isAr ? "(محسوبة من الأساس)" : "(of base)") : ""}
      </div>
    </div>
  );
}

/* ─────────────────────── Bulk Qty Adjust Bar ─────────────────────── */

function BulkAdjustBar({
  isAr, filteredIds, rows, setRows,
}: {
  isAr: boolean;
  filteredIds: string[];
  rows: Record<string, Row>;
  setRows: React.Dispatch<React.SetStateAction<Record<string, Row>>>;
}) {
  const [delta, setDelta] = useState<string>("5");
  const [scope, setScope] = useState<"selected" | "visible">("selected");

  const selectedIds = filteredIds.filter((id) => rows[id]?.selected);
  const targetIds = scope === "selected" ? selectedIds : filteredIds;
  const n = Math.max(0, Number(delta) || 0);

  const apply = (sign: 1 | -1) => {
    if (!n || targetIds.length === 0) return;
    setRows((prev) => {
      const next = { ...prev };
      targetIds.forEach((id) => {
        const r = next[id]; if (!r) return;
        const newQty = Math.max(0, (r.qty || 0) + sign * n);
        next[id] = { ...r, qty: newQty, selected: scope === "visible" ? newQty > 0 : r.selected };
      });
      return next;
    });
  };

  const setAll = (val: number) => {
    if (targetIds.length === 0) return;
    setRows((prev) => {
      const next = { ...prev };
      targetIds.forEach((id) => {
        const r = next[id]; if (!r) return;
        next[id] = { ...r, qty: Math.max(0, val), selected: scope === "visible" ? val > 0 : r.selected };
      });
      return next;
    });
  };

  const selectAllVisible = (on: boolean) => {
    setRows((prev) => {
      const next = { ...prev };
      filteredIds.forEach((id) => {
        const r = next[id]; if (!r) return;
        next[id] = { ...r, selected: on };
      });
      return next;
    });
  };

  return (
    <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-transparent p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold text-muted-foreground">
          {isAr ? "تعديل جماعي للكمية" : "Bulk qty adjust"}
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
          <button type="button" onClick={() => setScope("selected")}
            className={`rounded px-2 py-0.5 text-[11px] ${scope === "selected" ? "bg-primary text-primary-foreground" : ""}`}>
            {isAr ? `المختار (${selectedIds.length})` : `Selected (${selectedIds.length})`}
          </button>
          <button type="button" onClick={() => setScope("visible")}
            className={`rounded px-2 py-0.5 text-[11px] ${scope === "visible" ? "bg-primary text-primary-foreground" : ""}`}>
            {isAr ? `الظاهر (${filteredIds.length})` : `Visible (${filteredIds.length})`}
          </button>
        </div>
        <Input type="number" min={0} value={delta} onChange={(e) => setDelta(e.target.value)}
          className="h-8 w-20" />
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => apply(1)}>
          <Plus className="h-3 w-3" /> {isAr ? "زيادة" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => apply(-1)}>
          <Minus className="h-3 w-3" /> {isAr ? "نقصان" : "Subtract"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setAll(n)}>
          {isAr ? "ضبط على" : "Set to"} {n}
        </Button>
        <div className="ms-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1" onClick={() => selectAllVisible(true)}>
            <CheckSquare className="h-3 w-3" /> {isAr ? "تحديد الكل" : "Select all"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1" onClick={() => selectAllVisible(false)}>
            <Square className="h-3 w-3" /> {isAr ? "إلغاء" : "Clear"}
          </Button>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {isAr
          ? "اضبط الكمية بسرعة لكل المنتجات المختارة أو الظاهرة دفعة واحدة، وبعدها تقدر تعدل أي صف يدوي."
          : "Quickly bump qty across selected or visible rows, then fine-tune individually."}
      </div>
    </div>
  );
}

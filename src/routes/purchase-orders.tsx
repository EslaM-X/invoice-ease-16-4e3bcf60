import { swatchStyle } from "@/lib/color-swatch";
import { ColorSwatch } from "@/components/color-swatch";
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
import { Plus, ShoppingCart, Search, DollarSign, Calculator, FileText, Trash2, Minus, CheckSquare, Square, Activity } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { POTrackerDialog, statusBadge as trackerStatusBadge } from "@/components/po-tracker-dialog";
import { SHIPMENT_TYPES, shipmentMeta, type ShipmentType } from "@/lib/shipment-types";

import { ExecutiveGate } from "@/components/executive-gate";

export const Route = createFileRoute("/purchase-orders")({
  component: () => (
    <AppShell>
      <ExecutiveGate>
        <PurchaseOrdersPage />
      </ExecutiveGate>
    </AppShell>
  ),
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
  shipment_type: ShipmentType;
  shipment_code: string | null;
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
  const [trackId, setTrackId] = useState<string | null>(null);

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

  const statusBadge = (s: string) => trackerStatusBadge(s, isAr);

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
          {pos.map((p) => {
            const sm = shipmentMeta(p.shipment_type);
            const ShipIcon = sm.icon;
            return (
            <div key={p.id} className={`flex w-full flex-wrap items-center gap-3 p-4 transition hover:bg-accent/40 border-s-4 ${sm.surfaceClass.split(" ")[0]} border-s-current ${sm.accentTextClass}`}>
              <button
                onClick={() => setDetailId(p.id)}
                className="flex flex-1 min-w-[200px] flex-col gap-1 text-start"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-extrabold border ${sm.chipClass}`}>
                    <ShipIcon className="h-3.5 w-3.5" />
                    {p.shipment_code || p.po_number}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{sm.shortLabel(isAr)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p.po_number}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.supplier_name || (isAr ? "بدون مورد" : "No supplier")} · {fmtDateTime(p.created_at, lang)}
                </div>
                {p.created_by_email && (
                  <div className="text-[10px] text-muted-foreground">{p.created_by_email}</div>
                )}
              </button>
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
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); setTrackId(p.id); }}
                className="gap-1"
              >
                <Activity className="h-3.5 w-3.5" />
                {isAr ? "تتبع" : "Track"}
              </Button>
            </div>
            );
          })}
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
          onOpenTracker={(id) => setTrackId(id)}
        />
      )}

      {trackId && (
        <POTrackerDialog
          poId={trackId}
          open={!!trackId}
          onOpenChange={(v) => { if (!v) setTrackId(null); }}
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
  const [shipmentType, setShipmentType] = useState<ShipmentType>("grounded");
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
          shipment_type: shipmentType,
          supplier_name: supplier || null,
          notes: notes || null,
          status: "pending_cfo",
          total_usd: totalUsd,
          total_qty: totalQty,
          created_by: userId,
          created_by_email: userEmail,
        } as any)
        .select("id,shipment_code")
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
        body: `${(po as any).shipment_code || poNumber} · $${totalUsd.toFixed(2)} · ${totalQty} ${isAr ? "قطعة" : "units"}${supplier ? ` · ${supplier}` : ""}`,
        link: "/purchase-orders",
        meta: { po_id: po.id, po_number: poNumber, shipment_code: (po as any).shipment_code, shipment_type: shipmentType },
      } as any);

      toast.success(
        isAr
          ? `تم إنشاء أمر الشراء ${(po as any).shipment_code || poNumber} وإرسال إشعار للمدير المالي`
          : `PO ${(po as any).shipment_code || poNumber} created — CFO notified`,
      );
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

        <div>
          <Label className="mb-1.5 block text-xs font-semibold">
            {isAr ? "نوع الشحنة" : "Shipment type"}
          </Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {SHIPMENT_TYPES.map((t) => {
              const m = shipmentMeta(t);
              const Icon = m.icon;
              const active = shipmentType === t;
              return (
                <button
                  type="button"
                  key={t}
                  onClick={() => setShipmentType(t)}
                  className={`group relative overflow-hidden rounded-xl border-2 p-3 text-start transition active:scale-[0.98] ${
                    active
                      ? `${m.surfaceClass} ${m.ringSelectedClass} ring-2`
                      : "border-border bg-card hover:bg-accent/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`grid h-9 w-9 place-items-center rounded-lg ${m.chipClass}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="flex-1">
                      <div className={`text-sm font-bold ${active ? m.accentTextClass : ""}`}>
                        {m.label(isAr)}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {m.prefix}1, {m.prefix}2, …
                      </div>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {m.description(isAr)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

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
                                <ColorSwatch value={p.color} size="sm" />
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
  poId, open, onOpenChange, isCFO, isAdmin, isPurchasing, userEmail, userId, onOpenTracker,
}: {
  poId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isCFO: boolean;
  isAdmin: boolean;
  isPurchasing: boolean;
  userEmail: string;
  userId: string;
  onOpenTracker?: (id: string) => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const canEditPricing = isCFO || isAdmin;
  const canEditItems = isAdmin || isPurchasing;
  const canDeleteItems = isAdmin;
  const canDeletePO = isAdmin;

  const [po, setPo] = useState<PO | null>(null);
  const [items, setItems] = useState<POItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Header edit
  const [supplierEdit, setSupplierEdit] = useState("");
  const [notesEdit, setNotesEdit] = useState("");

  // Item edits (local buffer keyed by item id) — { qty, unit }
  const [itemEdits, setItemEdits] = useState<Record<string, { qty: number; unit: number }>>({});

  // Add-product picker
  const [pickerOpen, setPickerOpen] = useState(false);

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
  const [savingItems, setSavingItems] = useState(false);

  /**
   * load(opts):
   *  - initial=true (default on first open): shows loading skeleton, resets all edit buffers.
   *  - initial=false (silent refresh after our own write or realtime): keeps the dialog
   *    mounted (no scroll-to-top, no focus loss) and preserves any in-flight user edits
   *    (qty/unit changes, supplier/notes typing) that haven't been saved yet.
   */
  const load = async (opts: { initial?: boolean } = {}) => {
    const initial = opts.initial ?? false;
    if (initial) setLoading(true);
    const [{ data: poData }, { data: itemsData }] = await Promise.all([
      supabase.from("purchase_orders").select("*").eq("id", poId).maybeSingle(),
      supabase.from("purchase_order_items").select("*").eq("po_id", poId).order("created_at"),
    ]);
    if (poData) {
      const p = poData as any as PO & any;
      setPo((prev) => {
        // On silent refresh, keep header edits the user is mid-typing
        if (!initial && prev) return p;
        return p;
      });
      if (initial) {
        setSupplierEdit(p.supplier_name ?? "");
        setNotesEdit(p.notes ?? "");
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
    }
    const list = (itemsData as any as POItem[]) ?? [];
    setItems(list);
    setItemEdits((prev) => {
      const next: Record<string, { qty: number; unit: number }> = {};
      list.forEach((it) => {
        const existing = prev[it.id];
        const serverEdit = { qty: it.quantity, unit: Number(it.unit_cost_usd) };
        // Preserve a user's in-flight edit (silent refresh only) if still dirty
        if (!initial && existing && (existing.qty !== it.quantity || Number(existing.unit) !== Number(it.unit_cost_usd))) {
          next[it.id] = existing;
        } else {
          next[it.id] = serverEdit;
        }
      });
      return next;
    });
    if (initial) setLoading(false);
  };

  useEffect(() => { if (open) load({ initial: true }); /* eslint-disable-next-line */ }, [open, poId]);
  // Realtime: skip refresh while the user has unsaved edits to avoid clobbering input.
  useRealtimeTable(
    "purchase_order_items",
    () => {
      if (!open) return;
      // Defer to next tick so local optimistic state has settled
      setTimeout(() => { void load({ initial: false }); }, 0);
    },
    [open, poId],
  );

  // Live totals from current edit buffer
  const liveTotalUsd = items.reduce((s, it) => {
    const e = itemEdits[it.id] ?? { qty: it.quantity, unit: Number(it.unit_cost_usd) };
    return s + e.qty * e.unit;
  }, 0);
  const liveTotalQty = items.reduce((s, it) => {
    const e = itemEdits[it.id] ?? { qty: it.quantity, unit: Number(it.unit_cost_usd) };
    return s + e.qty;
  }, 0);

  const itemsDirty = items.some((it) => {
    const e = itemEdits[it.id]; if (!e) return false;
    return e.qty !== it.quantity || Number(e.unit) !== Number(it.unit_cost_usd);
  });
  const headerDirty = (po?.supplier_name ?? "") !== supplierEdit || (po?.notes ?? "") !== notesEdit;

  const rate = Number(usdRate) || 0;
  const baseEgp = liveTotalUsd * rate;
  const calc = (mode: Mode, val: string) => {
    const v = Number(val) || 0;
    return mode === "percent" ? (baseEgp * v) / 100 : v;
  };
  const customsEgp = calc(customsMode, customsValue);
  const taxesEgp = calc(taxesMode, taxesValue);
  const shippingEgp = calc(shippingMode, shippingValue);
  const otherEgp = calc(otherMode, otherValue);
  const totalEgp = baseEgp + customsEgp + taxesEgp + shippingEgp + otherEgp;

  const audit = async (action: string, details: any) => {
    try {
      await supabase.from("audit_log").insert({
        entity_type: "purchase_order",
        entity_id: poId,
        action,
        actor_id: userId,
        actor_email: userEmail,
        details,
      } as any);
    } catch {}
  };

  const recomputePOTotals = async (nextItemsTotals?: { qty: number; usd: number }) => {
    const usd = nextItemsTotals?.usd ?? liveTotalUsd;
    const qty = nextItemsTotals?.qty ?? liveTotalQty;
    await supabase
      .from("purchase_orders")
      .update({ total_usd: usd, total_qty: qty } as any)
      .eq("id", poId);
  };

  const saveItemChanges = async () => {
    if (!itemsDirty && !headerDirty) return;
    setSavingItems(true);
    try {
      const changes: any[] = [];
      // Update changed items
      for (const it of items) {
        const e = itemEdits[it.id]; if (!e) continue;
        if (e.qty === it.quantity && Number(e.unit) === Number(it.unit_cost_usd)) continue;
        const lineTotal = e.qty * e.unit;
        const { error } = await supabase
          .from("purchase_order_items")
          .update({ quantity: e.qty, unit_cost_usd: e.unit, line_total_usd: lineTotal } as any)
          .eq("id", it.id);
        if (error) throw error;
        changes.push({ item_id: it.id, name: it.product_name, before: { qty: it.quantity, unit: Number(it.unit_cost_usd) }, after: { qty: e.qty, unit: e.unit } });
      }
      // Header edits
      const headerPatch: any = {};
      if (headerDirty) {
        headerPatch.supplier_name = supplierEdit || null;
        headerPatch.notes = notesEdit || null;
      }
      // Recompute totals
      headerPatch.total_usd = liveTotalUsd;
      headerPatch.total_qty = liveTotalQty;
      const { error: e2 } = await supabase
        .from("purchase_orders")
        .update(headerPatch)
        .eq("id", poId);
      if (e2) throw e2;
      if (changes.length) await audit("po_items_updated", { changes });
      if (headerDirty) await audit("po_header_updated", { supplier: supplierEdit, notes: notesEdit });
      toast.success(isAr ? "تم حفظ التعديلات" : "Changes saved");
      load();
    } catch (err: any) {
      toast.error(err.message || "Error");
    } finally {
      setSavingItems(false);
    }
  };

  const removeItem = async (it: POItem) => {
    if (!confirm(isAr ? `حذف "${it.product_name}" من الأمر؟` : `Remove "${it.product_name}" from PO?`)) return;
    try {
      const { error } = await supabase.from("purchase_order_items").delete().eq("id", it.id);
      if (error) throw error;
      await audit("po_item_removed", { item_id: it.id, name: it.product_name, qty: it.quantity, unit_cost_usd: Number(it.unit_cost_usd) });
      // Recompute totals after deletion
      const remaining = items.filter((x) => x.id !== it.id);
      const usd = remaining.reduce((s, x) => {
        const e = itemEdits[x.id] ?? { qty: x.quantity, unit: Number(x.unit_cost_usd) };
        return s + e.qty * e.unit;
      }, 0);
      const qty = remaining.reduce((s, x) => {
        const e = itemEdits[x.id] ?? { qty: x.quantity, unit: Number(x.unit_cost_usd) };
        return s + e.qty;
      }, 0);
      await recomputePOTotals({ qty, usd });
      toast.success(isAr ? "تم الحذف" : "Removed");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error");
    }
  };

  const addProductToPO = async (p: Product, qty: number, unitUsd: number) => {
    try {
      const { error } = await supabase.from("purchase_order_items").insert({
        po_id: poId,
        product_id: p.id,
        product_name: p.name,
        serial_number: p.serial_number,
        color: p.color,
        image_url: p.image_url,
        quantity: qty,
        unit_cost_usd: unitUsd,
        line_total_usd: qty * unitUsd,
      } as any);
      if (error) throw error;
      await audit("po_item_added", { product_id: p.id, name: p.name, qty, unit_cost_usd: unitUsd });
      // Recompute totals
      const newUsd = liveTotalUsd + qty * unitUsd;
      const newQty = liveTotalQty + qty;
      await recomputePOTotals({ qty: newQty, usd: newUsd });
      toast.success(isAr ? "تمت الإضافة" : "Added");
      setPickerOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || "Error");
    }
  };

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
      await audit("po_priced", { total_egp: totalEgp, usd_rate: rate });

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
    await audit("po_deleted", { po_number: po?.po_number });
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
            <span className="flex items-center gap-2">
              {onOpenTracker && (
                <Button variant="outline" size="sm" onClick={() => onOpenTracker(poId)} className="gap-1">
                  <Activity className="h-3.5 w-3.5" />
                  {isAr ? "تتبع" : "Track"}
                </Button>
              )}
              {canDeletePO && (
                <Button variant="ghost" size="sm" onClick={deletePO} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading || !po ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل…" : "Loading…"}</div>
        ) : (
          <>
            {/* Header info — supplier editable */}
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground mb-1">{isAr ? "المورد" : "Supplier"}</div>
                {canEditItems ? (
                  <Input className="h-8" value={supplierEdit} onChange={(e) => setSupplierEdit(e.target.value)} placeholder={isAr ? "اسم المورد" : "Supplier name"} />
                ) : (
                  <div className="font-semibold">{po.supplier_name || "—"}</div>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{isAr ? "إجمالي USD" : "Total USD"}</div>
                <div className="font-bold text-primary tabular-nums">${liveTotalUsd.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">{liveTotalQty} {isAr ? "قطعة" : "units"}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{isAr ? "أُنشئ بواسطة" : "Created by"}</div>
                <div className="text-xs">{po.created_by_email || "—"}</div>
                <div className="text-[10px] text-muted-foreground">{fmtDateTime(po.created_at, lang)}</div>
              </div>
            </div>

            {/* Items — editable */}
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                <span>{isAr ? "البنود" : "Items"} ({items.length})</span>
                {canEditItems && (
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setPickerOpen(true)}>
                    <Plus className="h-3 w-3" />{isAr ? "إضافة منتج" : "Add product"}
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                      <th className="p-2 text-start whitespace-nowrap">{isAr ? "الكمية" : "Qty"}</th>
                      <th className="p-2 text-start whitespace-nowrap">{isAr ? "سعر الوحدة USD" : "Unit USD"}</th>
                      <th className="p-2 text-end whitespace-nowrap">{isAr ? "إجمالي USD" : "Line USD"}</th>
                      {canDeleteItems && <th className="p-2"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it) => {
                      const e = itemEdits[it.id] ?? { qty: it.quantity, unit: Number(it.unit_cost_usd) };
                      const dirty = e.qty !== it.quantity || Number(e.unit) !== Number(it.unit_cost_usd);
                      return (
                        <tr key={it.id} className={dirty ? "bg-amber-500/5" : ""}>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              {it.image_url ? (
                                <img src={it.image_url} alt={it.product_name} className="h-10 w-10 rounded border object-cover" />
                              ) : (
                                <div className="h-10 w-10 rounded border bg-muted" />
                              )}
                              <div className="min-w-0">
                                <div className="font-medium truncate">{it.product_name}</div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                                  {it.serial_number && <span className="font-mono">{it.serial_number}</span>}
                                  {it.color && (
                                    <span className="inline-flex items-center gap-1">
                                      <ColorSwatch value={it.color} size="sm" />
                                      {it.color}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number" min={0} className="h-7 w-20"
                              disabled={!canEditItems}
                              value={e.qty || ""}
                              onChange={(ev) => setItemEdits((prev) => ({ ...prev, [it.id]: { ...e, qty: Math.max(0, Number(ev.target.value) || 0) } }))}
                            />
                          </td>
                          <td className="p-2">
                            <div className="relative">
                              <DollarSign className="absolute start-1 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                type="number" min={0} step="any" className="h-7 w-24 ps-5"
                                disabled={!canEditItems}
                                value={Number.isFinite(e.unit) ? String(e.unit) : ""}
                                onChange={(ev) => setItemEdits((prev) => ({ ...prev, [it.id]: { ...e, unit: Math.max(0, Number(ev.target.value) || 0) } }))}
                              />
                            </div>
                          </td>
                          <td className="p-2 text-end font-semibold tabular-nums whitespace-nowrap">${(e.qty * e.unit).toFixed(2)}</td>
                          {canDeleteItems && (
                            <td className="p-2">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeItem(it)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={canDeleteItems ? 5 : 4} className="p-6 text-center text-muted-foreground">{isAr ? "لا توجد بنود" : "No items"}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {canEditItems && (itemsDirty || headerDirty) && (
                <div className="flex items-center justify-between gap-3 border-t bg-amber-500/5 px-3 py-2">
                  <span className="text-[11px] text-amber-700">
                    {isAr ? "لديك تعديلات غير محفوظة" : "You have unsaved changes"}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => load({ initial: true })} disabled={savingItems}>
                      {isAr ? "تجاهل" : "Discard"}
                    </Button>
                    <Button size="sm" onClick={saveItemChanges} disabled={savingItems}>
                      {savingItems ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ التعديلات" : "Save changes")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Purchasing notes — editable */}
            <div className="rounded-lg border p-3 text-xs">
              <div className="font-semibold text-muted-foreground mb-1">{isAr ? "ملاحظات المشتريات" : "Purchasing notes"}</div>
              {canEditItems ? (
                <Textarea rows={2} value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} />
              ) : (
                <div className="whitespace-pre-wrap">{po.notes || "—"}</div>
              )}
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

              <div className="mt-4 space-y-2">
                <div className="rounded-lg bg-background border p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isAr ? "إجمالي التكلفة التقريبية (EGP)" : "Approx. landed cost (EGP)"}</span>
                    <span className="font-bold text-base tabular-nums">{fmtMoney(totalEgp, "EGP", lang)}</span>
                  </div>
                  {liveTotalQty > 0 && (
                    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>{isAr ? "متوسط تقريبي للقطعة" : "Approx. avg / unit"}</span>
                      <span className="font-semibold tabular-nums">{fmtMoney(totalEgp / liveTotalQty, "EGP", lang)}</span>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  {isAr
                    ? "لحساب صافي الربح وتجربة خصم نهائي على فاتورة المورد، افتح صفحة \"حاسبة الربح\" من القائمة الجانبية."
                    : "To compute net profit and try a final supplier-invoice discount, open the \"Profit Calculator\" page from the sidebar."}
                </div>
              </div>

              {canEditPricing && (
                <div className="mt-3 flex justify-end">
                  <Button onClick={savePricing} disabled={saving}>
                    {saving ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ التسعير وإشعار المشتريات" : "Save pricing & notify Purchasing")}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAr ? "إغلاق" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>

      {pickerOpen && (
        <AddItemPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          existingProductIds={items.map((i) => i.product_id)}
          onAdd={addProductToPO}
        />
      )}
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
  setRows: Dispatch<SetStateAction<Record<string, Row>>>;
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

/* ─────────────────────── Add Item Picker (for existing PO) ─────────────────────── */

function AddItemPicker({
  open, onOpenChange, existingProductIds, onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingProductIds: string[];
  onAdd: (p: Product, qty: number, unitUsd: number) => Promise<void> | void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [qty, setQty] = useState<string>("1");
  const [unit, setUnit] = useState<string>("0");

  useEffect(() => {
    if (!open) return;
    supabase
      .from("products")
      .select("id,name,serial_number,color,image_url,stock_quantity,low_stock_threshold,cost_price_usd,price")
      .order("name")
      .limit(1000)
      .then(({ data }) => setProducts((data as any) ?? []));
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (existingProductIds.includes(p.id)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.serial_number ?? "").toLowerCase().includes(q) ||
        (p.color ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, search, existingProductIds]);

  const choose = (p: Product) => {
    setPicked(p);
    setQty("1");
    setUnit(String(Number(p.cost_price_usd) || 0));
  };

  const submit = async () => {
    if (!picked) return;
    const q = Math.max(0, Number(qty) || 0);
    const u = Math.max(0, Number(unit) || 0);
    if (q <= 0) { toast.error(isAr ? "أدخل كمية" : "Enter quantity"); return; }
    await onAdd(picked, q, u);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isAr ? "إضافة منتج لأمر الشراء" : "Add product to PO"}</DialogTitle>
        </DialogHeader>

        {!picked ? (
          <>
            <div className="relative">
              <Search className="absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-8" placeholder={isAr ? "ابحث…" : "Search…"} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border divide-y">
              {filtered.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">{isAr ? "لا توجد نتائج" : "No results"}</div>
              )}
              {filtered.map((p) => (
                <button key={p.id} onClick={() => choose(p)} className="flex w-full items-center gap-3 p-2 text-start hover:bg-accent/40">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="h-10 w-10 rounded border object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded border bg-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {p.serial_number || "—"} {p.color ? `· ${p.color}` : ""} · ${Number(p.cost_price_usd).toFixed(2)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {picked.image_url ? (
                <img src={picked.image_url} alt={picked.name} className="h-12 w-12 rounded border object-cover" />
              ) : (
                <div className="h-12 w-12 rounded border bg-muted" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{picked.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {picked.serial_number || "—"} {picked.color ? `· ${picked.color}` : ""}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>{isAr ? "تغيير" : "Change"}</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{isAr ? "الكمية" : "Quantity"}</Label>
                <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{isAr ? "سعر الوحدة USD" : "Unit USD"}</Label>
                <Input type="number" min={0} step="any" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">{isAr ? "إجمالي السطر" : "Line total"}</span>
              <span className="font-bold tabular-nums">${((Number(qty) || 0) * (Number(unit) || 0)).toFixed(2)}</span>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
          {picked && <Button onClick={submit}>{isAr ? "إضافة" : "Add"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

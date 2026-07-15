import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Save, FileCheck2, Truck } from "lucide-react";
import {
  createDeliveryReceipt,
  updateDeliveryReceipt,
  fetchInvoiceItemsWithDelivered,
  type InvoiceItemWithDelivered,
} from "@/lib/delivery-receipts";
import { autoLogClosureForInvoice } from "@/lib/fulfillment-audit";
import { useAuth } from "@/lib/auth";
import {
  isMultiPartProduct,
  partLabel,
  parsePartFromNote,
  buildNoteWithPart,
  type PartKey,
} from "@/lib/product-parts";
// (remainingPartsLabel removed — replaced by inline per-part breakdown)
import { DEFAULT_DELIVERY_MODE, buildEffectiveDelivered, type FDeliveredRow, type FInvItem } from "@/lib/fulfillment-engine";
import { SignaturePad } from "@/components/signature-pad";
import { SparePartBadge } from "@/components/spare-part-badge";

type Mode = "new" | "edit";

type ExistingReceipt = {
  id: string;
  invoice_id: string;
  delivered_to_name: string | null;
  delivered_to_phone: string | null;
  delivered_to_id_number: string | null;
  notes: string | null;
  manager_name: string | null;
  accountant_name: string | null;
  signature_customer: string | null;
  signature_manager: string | null;
  signature_accountant: string | null;
  status: string;
  shipping_fees: number | null;
  items: Array<{
    invoice_item_id: string | null;
    quantity: number;
    note: string | null;
    product_name: string;
  }>;
};

type PartsQty = { full: number; mixer: number; trim: number };

type Row = {
  invoice_item_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  invoice_qty: number;
  delivered_other: number; // delivered in OTHER receipts (as units — see product-parts weights)
  qty: number; // current input (single-part)
  note: string;
  selected: boolean;
  isMultiPart: boolean;
  part: PartKey; // single-part legacy (unused for multi)
  partsQty: PartsQty; // per-part split for this receipt (multi-part only)
  // Aggregates from OTHER receipts for multi-part tracking:
  otherFull: number;
  otherMixer: number;
  otherTrim: number;
  priorNotes: string[];
  is_spare_part: boolean;
  parent_product_name: string | null;
};

export function DeliveryReceiptForm({
  mode,
  invoiceId,
  receiptId,
  existing,
}: {
  mode: Mode;
  invoiceId: string;
  receiptId?: string;
  existing?: ExistingReceipt;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const { user } = useAuth();

  const [invoice, setInvoice] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // header fields
  const [deliveredName, setDeliveredName] = useState(existing?.delivered_to_name ?? "");
  const [deliveredPhone, setDeliveredPhone] = useState(existing?.delivered_to_phone ?? "");
  const [deliveredId, setDeliveredId] = useState(existing?.delivered_to_id_number ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [managerName, setManagerName] = useState(existing?.manager_name ?? "");
  const [accountantName, setAccountantName] = useState(existing?.accountant_name ?? "تامر عبد العليم");
  const [sigCustomer, setSigCustomer] = useState<string | null>(existing?.signature_customer ?? null);
  const [sigManager, setSigManager] = useState<string | null>(existing?.signature_manager ?? null);
  const [sigAccountant, setSigAccountant] = useState<string | null>(existing?.signature_accountant ?? null);
  const [shippingEnabled, setShippingEnabled] = useState<boolean>(
    existing?.shipping_fees != null && existing.shipping_fees > 0,
  );
  const [shippingFees, setShippingFees] = useState<string>(
    existing?.shipping_fees != null ? String(existing.shipping_fees) : "",
  );
  const [taxEnabled, setTaxEnabled] = useState<boolean>(
    (existing as any)?.tax_enabled === true,
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", invoiceId)
        .single();
      setInvoice(inv);
      if (mode === "new") {
        if (!deliveredName && inv?.customer_name) setDeliveredName(inv.customer_name);
        if (!deliveredPhone && inv?.customer_phone) setDeliveredPhone(inv.customer_phone);
        if ((inv as any)?.tax_enabled === true) setTaxEnabled(true);
      }

      const items: InvoiceItemWithDelivered[] = await fetchInvoiceItemsWithDelivered(
        invoiceId,
        receiptId,
      );

      // Fetch prior delivery notes (from OTHER receipts) for multi-part tracking
      const itemIds = items.map((i) => i.id);
      const priorNotesMap = new Map<string, string[]>();
      const deliveredStrictMap = new Map<string, number>();
      if (itemIds.length > 0) {
        const q = supabase
          .from("delivery_receipt_items" as any)
          .select("invoice_item_id, note, quantity, receipt_id")
          .in("invoice_item_id", itemIds);
        const { data: dris } = await q;
        const strictDelivered = buildEffectiveDelivered(
          items.map((i) => ({
            id: i.id,
            invoice_id: invoiceId,
            product_id: (i as any).product_id ?? null,
            product_name: i.product_name,
            serial_number: i.serial_number,
            color: i.color,
            quantity: i.quantity,
            unit_price: 0,
          })) as FInvItem[],
          ((dris ?? []).filter((r: any) => !(receiptId && r.receipt_id === receiptId)).map((r: any) => ({
            invoice_item_id: r.invoice_item_id,
            quantity: r.quantity,
            note: r.note,
          }))) as FDeliveredRow[],
          DEFAULT_DELIVERY_MODE,
        );
        for (const [k, v] of strictDelivered) deliveredStrictMap.set(k, v);
        for (const r of (dris ?? []) as any[]) {
          if (receiptId && r.receipt_id === receiptId) continue;
          const arr = priorNotesMap.get(r.invoice_item_id) ?? [];
          for (let k = 0; k < (r.quantity || 0); k++) arr.push(r.note ?? "");
          priorNotesMap.set(r.invoice_item_id, arr);
        }
      }

      // map existing receipt selections
      // For multi-part items the SAME invoice_item_id may appear multiple times
      // (once per PartKey). Group them so edit-mode can seed partsQty.
      const existingMap = new Map<string, { qty: number; note: string; partsQty: PartsQty }>();
      if (existing) {
        for (const it of existing.items) {
          if (!it.invoice_item_id) continue;
          const parsed = parsePartFromNote(it.note ?? "");
          const cur = existingMap.get(it.invoice_item_id) ?? {
            qty: 0,
            note: "",
            partsQty: { full: 0, mixer: 0, trim: 0 },
          };
          cur.qty += it.quantity;
          cur.partsQty[parsed.part] += it.quantity;
          if (!cur.note && parsed.cleanNote) cur.note = parsed.cleanNote;
          existingMap.set(it.invoice_item_id, cur);
        }
      }
      const productIds = Array.from(new Set(items.map((i) => i.product_id).filter(Boolean) as string[]));
      const sparePartInfo = new Map<string, { is_spare_part: boolean; parent_product_id: string | null }>();
      const productNamesById = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, name, is_spare_part, parent_product_id")
          .in("id", productIds);
        for (const p of (prods ?? []) as any[]) {
          sparePartInfo.set(p.id, { is_spare_part: !!p.is_spare_part, parent_product_id: p.parent_product_id ?? null });
          productNamesById.set(p.id, p.name);
        }
        const parentIds = Array.from(new Set(
          ((prods ?? []) as any[])
            .map((p) => p.parent_product_id)
            .filter((id): id is string => !!id && !productNamesById.has(id)),
        ));
        if (parentIds.length > 0) {
          const { data: parents } = await supabase.from("products").select("id, name").in("id", parentIds);
          for (const p of (parents ?? []) as any[]) productNamesById.set(p.id, p.name);
        }
      }

      // Aggregate parts delivered in OTHER receipts (for multi-part tracking)
      const otherPartsMap = new Map<string, PartsQty>();
      for (const notesArr of priorNotesMap.entries()) {
        const [iid, arr] = notesArr;
        const agg: PartsQty = { full: 0, mixer: 0, trim: 0 };
        for (const n of arr) {
          const { part } = parsePartFromNote(n);
          agg[part] += 1;
        }
        otherPartsMap.set(iid, agg);
      }

      const next: Row[] = items.map((it) => {
        const ex = existingMap.get(it.id);
        const strictDelivered = deliveredStrictMap.get(it.id) ?? 0;
        const remainingForThisReceipt = Math.max(0, it.quantity - strictDelivered) + (ex?.qty || 0);
        const multi = isMultiPartProduct(it.product_name);
        const parsed = parsePartFromNote(ex?.note ?? "");
        const sp = it.product_id ? sparePartInfo.get(it.product_id) : undefined;
        // New-mode default: pre-select EVERY row so all invoice lines appear on the
        // printed receipt. Rows with 0 remaining stay visible but their qty is 0.
        const preselectAll = mode === "new";
        const otherParts = otherPartsMap.get(it.id) ?? { full: 0, mixer: 0, trim: 0 };
        return {
          invoice_item_id: it.id,
          product_id: it.product_id ?? null,
          product_name: it.product_name,
          serial_number: it.serial_number,
          color: it.color,
          invoice_qty: it.quantity,
          delivered_other: multi ? strictDelivered : it.delivered_qty,
          qty: ex ? ex.qty : (multi ? 0 : remainingForThisReceipt),
          note: ex ? ex.note : "",
          selected: ex ? true : (preselectAll ? true : remainingForThisReceipt > 0),
          isMultiPart: multi,
          part: ex ? parsed.part : "full",
          partsQty: ex ? ex.partsQty : { full: 0, mixer: 0, trim: 0 },
          otherFull: otherParts.full,
          otherMixer: otherParts.mixer,
          otherTrim: otherParts.trim,
          priorNotes: priorNotesMap.get(it.id) ?? [],
          is_spare_part: !!sp?.is_spare_part,
          parent_product_name: sp?.parent_product_id ? (productNamesById.get(sp.parent_product_id) ?? null) : null,
        };
      });
      setRows(next);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, receiptId]);

  // Effective delivered qty for a row (multi-part = sum of parts, single = qty)
  const effQty = (r: Row) =>
    r.isMultiPart ? r.partsQty.full + r.partsQty.mixer + r.partsQty.trim : (r.qty || 0);

  const totalQty = useMemo(
    () => rows.filter((r) => r.selected).reduce((s, r) => s + effQty(r), 0),
    [rows],
  );

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const submit = async (status: "draft" | "signed" | "out_for_delivery", andPrint = false) => {
    // Expand multi-part rows into one item per non-zero part
    const items: Array<{ invoice_item_id: string; quantity: number; note: string | null }> = [];
    for (const r of rows) {
      if (!r.selected) continue;
      if (r.isMultiPart) {
        (["full", "mixer", "trim"] as PartKey[]).forEach((p) => {
          const q = r.partsQty[p] || 0;
          if (q > 0) {
            items.push({
              invoice_item_id: r.invoice_item_id,
              quantity: q,
              note: buildNoteWithPart(p, r.note),
            });
          }
        });
      } else if (r.qty > 0) {
        items.push({
          invoice_item_id: r.invoice_item_id,
          quantity: r.qty,
          note: r.note || null,
        });
      }
    }
    if (items.length === 0) {
      toast.error(isAr ? "أدخل كمية لبند واحد على الأقل" : "Enter a quantity on at least one item");
      return;
    }
    // client-side validation against remaining
    for (const r of rows.filter((x) => x.selected && effQty(x) > 0)) {
      if (r.isMultiPart) {
        // Cap: mixers delivered (this + other full/mixer) <= invoice_qty
        const mixersAfter = r.otherFull + r.otherMixer + r.partsQty.full + r.partsQty.mixer;
        const trimsAfter = r.otherFull + r.otherTrim + r.partsQty.full + r.partsQty.trim;
        if (mixersAfter > r.invoice_qty || trimsAfter > r.invoice_qty) {
          toast.error(
            (isAr ? "الأجزاء أكبر من كمية الفاتورة في: " : "Parts exceed invoice qty: ") + r.product_name,
          );
          return;
        }
      } else {
        const maxAllowed = r.invoice_qty - r.delivered_other;
        if (r.qty > maxAllowed) {
          toast.error(
            (isAr ? "كمية أكبر من المتبقي: " : "Quantity exceeds remaining: ") + r.product_name,
          );
          return;
        }
      }
    }
    setSaving(true);
    try {
      const payload = {
        delivered_to_name: deliveredName,
        delivered_to_phone: deliveredPhone,
        delivered_to_id_number: deliveredId,
        notes,
        manager_name: managerName,
        accountant_name: accountantName,
        signature_customer: sigCustomer,
        signature_manager: sigManager,
        signature_accountant: sigAccountant,
        status,
        shipping_fees: shippingEnabled ? Number(shippingFees) || 0 : null,
        tax_enabled: taxEnabled,
        items,
      };
      let id = receiptId;
      if (mode === "new") {
        id = await createDeliveryReceipt(invoiceId, payload);
      } else if (receiptId) {
        await updateDeliveryReceipt(receiptId, payload);
      }
      toast.success(isAr ? "تم الحفظ" : "Saved");
      // Fire-and-forget: capture an audit snapshot of the closure for this invoice.
      if (user?.id) {
        autoLogClosureForInvoice(user.id, invoiceId, DEFAULT_DELIVERY_MODE, "auto_closed",
          isAr ? `إذن تسليم — ${status}` : `Delivery receipt — ${status}`)
          .catch(() => { /* silent */ });
      }
      if (id) {
        if (andPrint) {
          navigate({ to: "/delivery-receipts/$id", params: { id }, search: { print: true } as any });
        } else {
          navigate({ to: "/delivery-receipts/$id", params: { id } });
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("QUANTITY_EXCEEDED")) {
        toast.error(
          (isAr ? "كمية أكبر من المتبقي: " : "Quantity exceeds remaining: ") +
            msg.split("QUANTITY_EXCEEDED:")[1],
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !invoice) {
    return <div className="text-muted-foreground">{isAr ? "جاري التحميل…" : "Loading…"}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/delivery-receipts">
          <Button variant="ghost" className="gap-2 rounded-full">
            <ArrowLeft className="h-4 w-4" /> {isAr ? "محاضر الاستلام" : "Delivery Receipts"}
          </Button>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={saving} onClick={() => submit("draft")} className="gap-2">
            <Save className="h-4 w-4" /> {isAr ? "حفظ كمسودة" : "Save draft"}
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => submit("out_for_delivery")} className="gap-2 border-sky-500/40 text-sky-700 hover:bg-sky-500/10 dark:text-sky-400">
            <Truck className="h-4 w-4" /> {isAr ? "في الطريق" : "Out for delivery"}
          </Button>
          <Button disabled={saving} onClick={() => submit("signed")} className="gap-2 shadow-glow">
            <FileCheck2 className="h-4 w-4" /> {isAr ? "حفظ وإنهاء" : "Save & finalize"}
          </Button>
          <Button variant="secondary" disabled={saving} onClick={() => submit("signed", true)} className="gap-2">
            {isAr ? "حفظ وطباعة" : "Save & print"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {isAr ? "محضر استلام للفاتورة" : "Delivery Receipt for Invoice"}{" "}
            <span className="font-mono text-primary">{invoice.invoice_number}</span>
          </h2>
          <Link to="/invoices/$id" params={{ id: invoiceId }} className="text-xs text-muted-foreground hover:underline">
            {isAr ? "عرض الفاتورة" : "View invoice"}
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "اسم المستلم (اختياري)" : "Recipient name (optional)"}</label>
            <Input value={deliveredName} onChange={(e) => setDeliveredName(e.target.value)} placeholder={isAr ? "اتركه فارغاً ليوقّع المستلم فقط" : "Leave empty to use signature only"} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "هاتف المستلم" : "Recipient phone"}</label>
            <Input value={deliveredPhone} onChange={(e) => setDeliveredPhone(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "رقم البطاقة (اختياري)" : "ID number (optional)"}</label>
            <Input value={deliveredId} onChange={(e) => setDeliveredId(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
          <h3 className="text-sm font-semibold">{isAr ? "بنود التسليم" : "Items to deliver"}</h3>
          <div className="flex items-center gap-2">
            {mode === "new" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setRows((prev) =>
                      prev.map((r) => {
                        if (r.isMultiPart) {
                          // Fill only what's remaining as FULL products
                          const remainFull = Math.max(
                            0,
                            Math.min(
                              r.invoice_qty - r.otherFull - r.otherMixer,
                              r.invoice_qty - r.otherFull - r.otherTrim,
                            ),
                          );
                          return {
                            ...r,
                            selected: true,
                            partsQty: { full: remainFull, mixer: 0, trim: 0 },
                          };
                        }
                        return {
                          ...r,
                          selected: true,
                          qty: Math.max(0, r.invoice_qty - r.delivered_other),
                        };
                      }),
                    )
                  }
                >
                  {isAr ? "املأ كل المتبقي" : "Fill all remaining"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setRows((prev) =>
                      prev.map((r) => ({
                        ...r,
                        qty: 0,
                        partsQty: { full: 0, mixer: 0, trim: 0 },
                      })),
                    )
                  }
                >
                  {isAr ? "صفّر الكل" : "Clear all"}
                </Button>
              </>
            )}
            <div className="text-xs text-muted-foreground">
              {isAr ? "الإجمالي:" : "Total:"}{" "}
              <span className="font-semibold text-foreground">{totalQty}</span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="px-3 py-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                <th className="px-3 py-2 text-center">{isAr ? "كمية الفاتورة" : "Invoice qty"}</th>
                <th className="px-3 py-2 text-center">{isAr ? "مسلَّم سابقاً" : "Already delivered"}</th>
                <th className="px-3 py-2 text-center">{isAr ? "المتبقي" : "Remaining"}</th>
                <th className="px-3 py-2 text-center">{isAr ? "كمية التسليم الآن" : "Deliver now"}</th>
                <th className="px-3 py-2 text-start">{isAr ? "ملاحظة على البند" : "Item note"}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, idx) => {
                const remaining = r.invoice_qty - r.delivered_other;
                const fullyDelivered = remaining <= 0 && r.delivered_other > 0;
                return (
                  <tr key={r.invoice_item_id} className={fullyDelivered ? "bg-emerald-500/5" : ""}>
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={r.selected}
                        disabled={fullyDelivered}
                        onCheckedChange={(v) => setRow(idx, { selected: !!v })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium flex items-center gap-1.5 flex-wrap">
                        <span>{r.product_name}</span>
                        {r.is_spare_part && (
                          <SparePartBadge
                            product={{ is_spare_part: true, parent_product_id: null }}
                            parentName={r.parent_product_name}
                            isAr={isAr}
                            size="xs"
                          />
                        )}
                        {fullyDelivered && (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            {isAr ? "مسلَّمة مسبقًا" : "Previously delivered"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {r.serial_number && <span className="me-2">SN: {r.serial_number}</span>}
                        {r.color && <span>{isAr ? "اللون" : "Color"}: {r.color}</span>}
                      </div>
                      {r.isMultiPart && !fullyDelivered && (() => {
                        const thisSum = r.partsQty.full + r.partsQty.mixer + r.partsQty.trim;
                        const mixersAfter = r.otherFull + r.otherMixer + r.partsQty.full + r.partsQty.mixer;
                        const trimsAfter = r.otherFull + r.otherTrim + r.partsQty.full + r.partsQty.trim;
                        const missingMixers = Math.max(0, r.invoice_qty - mixersAfter);
                        const missingTrims = Math.max(0, r.invoice_qty - trimsAfter);
                        const over = mixersAfter > r.invoice_qty || trimsAfter > r.invoice_qty;
                        const parts: { key: PartKey; label: string; prev: number; max: number }[] = [
                          {
                            key: "full",
                            label: partLabel("full", isAr),
                            prev: r.otherFull,
                            max: Math.min(
                              r.invoice_qty - r.otherFull - r.otherMixer - r.partsQty.mixer,
                              r.invoice_qty - r.otherFull - r.otherTrim - r.partsQty.trim,
                            ),
                          },
                          {
                            key: "mixer",
                            label: partLabel("mixer", isAr),
                            prev: r.otherMixer,
                            max: r.invoice_qty - r.otherFull - r.otherMixer - r.partsQty.full,
                          },
                          {
                            key: "trim",
                            label: partLabel("trim", isAr),
                            prev: r.otherTrim,
                            max: r.invoice_qty - r.otherFull - r.otherTrim - r.partsQty.full,
                          },
                        ];
                        return (
                          <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[10.5px] font-bold text-primary">
                                {isAr ? "توزيع الأجزاء في هذا المحضر" : "Split parts in this receipt"}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={!r.selected}
                                  onClick={() => {
                                    // Auto-distribute to reach total "remaining" using only what's available per part.
                                    // Priority: pair up missing Mixer + missing Trim into FULL units first,
                                    // then fill the remaining single-side gap with MIXER or TRIM.
                                    const invQ = r.invoice_qty;
                                    const missMix = Math.max(0, invQ - r.otherFull - r.otherMixer);
                                    const missTrim = Math.max(0, invQ - r.otherFull - r.otherTrim);
                                    const pairFull = Math.min(missMix, missTrim);
                                    const restMix = missMix - pairFull;
                                    const restTrim = missTrim - pairFull;
                                    setRow(idx, {
                                      selected: true,
                                      partsQty: { full: pairFull, mixer: restMix, trim: restTrim },
                                    });
                                  }}
                                  className="rounded-full border border-primary/50 bg-primary px-2 py-[2px] text-[9.5px] font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40"
                                >
                                  {isAr ? "توزيع تلقائي" : "Auto-distribute"}
                                </button>
                                <button
                                  type="button"
                                  disabled={!r.selected}
                                  onClick={() => setRow(idx, { partsQty: { full: 0, mixer: 0, trim: 0 } })}
                                  className="rounded-full border border-border bg-background px-2 py-[2px] text-[9.5px] font-medium text-muted-foreground transition hover:bg-muted/50 disabled:opacity-40"
                                >
                                  {isAr ? "مسح" : "Clear"}
                                </button>
                                <span className={`ltr-nums rounded-full border px-2 py-[1px] text-[10px] font-semibold ${
                                  over ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400"
                                       : "border-primary/40 bg-background text-primary"
                                }`}>
                                  {isAr ? "الإجمالي: " : "Total: "}{thisSum}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                              {parts.map((p) => (
                                <div key={p.key} className="rounded-md border border-border bg-background px-2 py-1.5">
                                  <div className="mb-1 flex items-center justify-between gap-1">
                                    <span className="truncate text-[10px] font-semibold">{p.label}</span>
                                    <span className="ltr-nums text-[9.5px] text-muted-foreground" title={isAr ? "مسلَّم في محاضر أخرى" : "Delivered in other receipts"}>
                                      {isAr ? "سابقًا:" : "prior:"} {p.prev}
                                    </span>
                                  </div>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={Math.max(0, p.max)}
                                    value={r.partsQty[p.key]}
                                    disabled={!r.selected}
                                    onChange={(e) => {
                                      const raw = parseInt(e.target.value || "0", 10);
                                      const capped = Math.max(0, Math.min(Math.max(0, p.max), isNaN(raw) ? 0 : raw));
                                      setRow(idx, { partsQty: { ...r.partsQty, [p.key]: capped } });
                                    }}
                                    className="h-8 text-center tabular-nums"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9.5px]">
                              <span className="text-muted-foreground">
                                {isAr ? "إجمالي المكسر بعد الحفظ:" : "Mixers after save:"}{" "}
                                <b className={mixersAfter > r.invoice_qty ? "text-red-600" : "text-foreground"}>{mixersAfter}/{r.invoice_qty}</b>
                              </span>
                              <span className="text-muted-foreground">
                                {isAr ? "إجمالي الظاهر بعد الحفظ:" : "Trims after save:"}{" "}
                                <b className={trimsAfter > r.invoice_qty ? "text-red-600" : "text-foreground"}>{trimsAfter}/{r.invoice_qty}</b>
                              </span>
                              {(missingMixers > 0 || missingTrims > 0) && !over && (
                                <span className="text-amber-700 dark:text-amber-400">
                                  {isAr ? "لسه ناقص:" : "Still missing:"}{" "}
                                  {missingMixers > 0 && <span>MIXER {missingMixers}</span>}
                                  {missingMixers > 0 && missingTrims > 0 && " • "}
                                  {missingTrims > 0 && <span>{isAr ? "ظاهر" : "Trim"} {missingTrims}</span>}
                                </span>
                              )}
                              {over && (
                                <span className="font-semibold text-red-600">
                                  {isAr ? "⚠ تخطّى كمية الفاتورة" : "⚠ Exceeds invoice qty"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.invoice_qty}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.delivered_other}</td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{remaining}</td>
                    <td className="px-3 py-2 text-center">
                      {r.isMultiPart ? (
                        <div className="mx-auto inline-flex flex-col items-center gap-0.5">
                          <span className="ltr-nums text-lg font-bold text-primary">
                            {r.partsQty.full + r.partsQty.mixer + r.partsQty.trim}
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            {isAr ? "من الأجزاء أعلاه" : "from parts above"}
                          </span>
                        </div>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          value={r.qty}
                          disabled={!r.selected || fullyDelivered}
                          onChange={(e) =>
                            setRow(idx, { qty: Math.max(0, Math.min(remaining, parseInt(e.target.value || "0", 10))) })
                          }
                          className="mx-auto h-8 w-20 text-center tabular-nums"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={r.note}
                        disabled={!r.selected || fullyDelivered}
                        onChange={(e) => setRow(idx, { note: e.target.value })}
                        placeholder={isAr ? "مثال: نصف الكمية…" : "e.g. half quantity…"}
                        className="h-8"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-5">
          <label className="mb-2 block text-sm font-semibold">{isAr ? "ملاحظات عامة" : "General notes"}</label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{isAr ? "اسم مدير الحسابات" : "Accountant name"}</label>
            <Input value={accountantName} onChange={(e) => setAccountantName(e.target.value)} />
          </div>
          <div className="rounded-lg border border-dashed border-border/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={shippingEnabled} onCheckedChange={(v) => setShippingEnabled(!!v)} />
                {isAr ? "إضافة رسوم شحن" : "Add shipping fees"}
              </label>
              {shippingEnabled && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShippingEnabled(false); setShippingFees(""); }} className="h-7 text-xs text-destructive">
                  {isAr ? "حذف" : "Remove"}
                </Button>
              )}
            </div>
            {shippingEnabled && (
              <Input
                type="number"
                min={0}
                step="0.01"
                value={shippingFees}
                onChange={(e) => setShippingFees(e.target.value)}
                placeholder={isAr ? "قيمة رسوم الشحن" : "Shipping amount"}
                className="ltr-nums"
              />
            )}
          </div>
          <div className="rounded-lg border border-dashed border-amber-500/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={taxEnabled} onCheckedChange={(v) => setTaxEnabled(!!v)} />
                {isAr ? "تطبيق ضريبة القيمة المضافة 14%" : "Apply 14% VAT"}
              </label>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {isAr ? "اختياري" : "Optional"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {isAr
                ? "لو مفعّلة تظهر في المحضر و PDF كملخّص مالي (الفرعي / الضريبة / الإجمالي). لو مطفية لا يظهر أي شيء عن الضريبة."
                : "If enabled, a subtotal / VAT / total block appears on the receipt and PDF. If off, nothing tax-related is shown."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <SignaturePad
            label={isAr ? "توقيع المستلم" : "Recipient signature"}
            value={sigCustomer}
            onChange={setSigCustomer}
          />
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <SignaturePad
            label={isAr ? "توقيع مدير الحسابات" : "Accountant signature"}
            value={sigAccountant}
            onChange={setSigAccountant}
          />
        </div>
      </div>
    </div>
  );
}

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
  remainingPartsLabel,
  type PartKey,
} from "@/lib/product-parts";
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

type Row = {
  invoice_item_id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  invoice_qty: number;
  delivered_other: number; // delivered in OTHER receipts
  qty: number; // current input
  note: string;
  selected: boolean;
  isMultiPart: boolean;
  part: PartKey;
  priorNotes: string[]; // notes from OTHER receipts (for multi-part tracking)
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
      const existingMap = new Map<string, { qty: number; note: string }>();
      if (existing) {
        for (const it of existing.items) {
          if (it.invoice_item_id)
            existingMap.set(it.invoice_item_id, { qty: it.quantity, note: it.note ?? "" });
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

      const next: Row[] = items.map((it) => {
        const ex = existingMap.get(it.id);
        const strictDelivered = deliveredStrictMap.get(it.id) ?? 0;
        const remainingForThisReceipt = Math.max(0, it.quantity - strictDelivered) + (ex?.qty || 0);
        const multi = isMultiPartProduct(it.product_name);
        const parsed = parsePartFromNote(ex?.note ?? "");
        const sp = it.product_id ? sparePartInfo.get(it.product_id) : undefined;
        return {
          invoice_item_id: it.id,
          product_id: it.product_id ?? null,
          product_name: it.product_name,
          serial_number: it.serial_number,
          color: it.color,
          invoice_qty: it.quantity,
          delivered_other: multi ? strictDelivered : it.delivered_qty,
          qty: ex ? ex.qty : remainingForThisReceipt,
          note: ex ? parsed.cleanNote : "",
          selected: ex ? true : remainingForThisReceipt > 0,
          isMultiPart: multi,
          part: ex ? parsed.part : "full",
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

  const totalQty = useMemo(
    () => rows.filter((r) => r.selected).reduce((s, r) => s + (r.qty || 0), 0),
    [rows],
  );

  const setRow = (idx: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const submit = async (status: "draft" | "signed" | "out_for_delivery", andPrint = false) => {
    const items = rows
      .filter((r) => r.selected && r.qty > 0)
      .map((r) => ({
        invoice_item_id: r.invoice_item_id,
        quantity: r.qty,
        note: r.isMultiPart ? buildNoteWithPart(r.part, r.note) : (r.note || null),
      }));
    if (items.length === 0) {
      toast.error(isAr ? "اختر بنداً واحداً على الأقل" : "Select at least one item");
      return;
    }
    // client-side validation against remaining
    for (const r of rows.filter((x) => x.selected)) {
      const maxAllowed = r.invoice_qty - r.delivered_other;
      if (r.qty > maxAllowed) {
        toast.error(
          (isAr ? "كمية أكبر من المتبقي: " : "Quantity exceeds remaining: ") + r.product_name,
        );
        return;
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
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="text-sm font-semibold">{isAr ? "بنود التسليم" : "Items to deliver"}</h3>
          <div className="text-xs text-muted-foreground">
            {isAr ? "إجمالي الكميات المسلَّمة الآن:" : "Total qty being delivered:"}{" "}
            <span className="font-semibold text-foreground">{totalQty}</span>
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
                return (
                  <tr key={r.invoice_item_id} className={remaining <= 0 && !r.selected ? "opacity-50" : ""}>
                    <td className="px-3 py-2">
                      <Checkbox checked={r.selected} onCheckedChange={(v) => setRow(idx, { selected: !!v })} />
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
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {r.serial_number && <span className="me-2">SN: {r.serial_number}</span>}
                        {r.color && <span>{isAr ? "اللون" : "Color"}: {r.color}</span>}
                      </div>
                      {r.isMultiPart && (() => {
                        const pendingParts = remainingPartsLabel(r.invoice_qty, r.priorNotes, isAr);
                        return (
                          <div className="mt-2 flex flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-semibold text-muted-foreground">
                                {isAr ? "الجزء المُسلَّم:" : "Part delivered:"}
                              </span>
                              {(["full", "mixer", "trim"] as PartKey[]).map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  disabled={!r.selected}
                                  onClick={() => setRow(idx, { part: p })}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                                    r.part === p
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                                  } ${!r.selected ? "opacity-50" : ""}`}
                                >
                                  {partLabel(p, isAr)}
                                </button>
                              ))}
                            </div>
                            {pendingParts && (
                              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                {isAr ? "⚠ متبقي من السابق: " : "⚠ Still pending: "}{pendingParts}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.invoice_qty}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.delivered_other}</td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{remaining}</td>
                    <td className="px-3 py-2 text-center">
                      <Input
                        type="number"
                        min={0}
                        max={remaining}
                        value={r.qty}
                        disabled={!r.selected}
                        onChange={(e) =>
                          setRow(idx, { qty: Math.max(0, Math.min(remaining, parseInt(e.target.value || "0", 10))) })
                        }
                        className="mx-auto h-8 w-20 text-center tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={r.note}
                        disabled={!r.selected}
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

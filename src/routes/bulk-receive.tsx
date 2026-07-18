import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { ExecutiveGate } from "@/components/executive-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Loader2, PackageCheck, Plus, Minus, RotateCcw, ArrowLeft,
  AlertTriangle, Eye, Undo2, ShieldAlert, History,
} from "lucide-react";
import { fmtMoney } from "@/lib/utils-money";
import { TableSkeleton } from "@/components/skeletons";

export const Route = createFileRoute("/bulk-receive")({
  component: () => (
    <AppShell>
      <ExecutiveGate>
        <BulkReceivePage />
      </ExecutiveGate>
    </AppShell>
  ),
});

const INVENTORY_ADMIN_EMAILS = new Set([
  "k.elsharbatly@steinheim-eg.com",
  "e.hesham@steinheim-eg.com",
]);

type POItem = {
  id: string; po_id: string; product_id: string; product_name: string;
  serial_number: string | null; color: string | null;
  quantity: number; received_qty: number;
};
type PO = {
  id: string; po_number: string; supplier_name: string | null;
  status: string; total_usd: number; total_qty: number;
  shipment_code: string | null; items?: POItem[];
};
type Batch = { items: Record<string, number> };
type Selection = { enabled: boolean; batches: Batch[] };
type BulkOp = {
  id: string; actor_email: string | null; po_count: number; batch_count: number;
  total_qty: number; created_at: string; reverted_at: string | null;
  receipt_ids: string[]; back_deducted_dri_ids: string[];
};

function BulkReceivePage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
  const email = (user?.email ?? "").toLowerCase();
  const isInventoryAdmin = INVENTORY_ADMIN_EMAILS.has(email);

  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<string, Selection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetPreview, setResetPreview] = useState<any | null>(null);
  const [resetStage, setResetStage] = useState<0 | 1 | 2>(0);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [recentOps, setRecentOps] = useState<BulkOp[]>([]);
  const [undoTarget, setUndoTarget] = useState<BulkOp | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [undoing, setUndoing] = useState(false);

  async function load() {
    setLoading(true);
    const { data: poRows } = await supabase
      .from("purchase_orders")
      .select("id, po_number, supplier_name, status, total_usd, total_qty, shipment_code")
      .order("created_at", { ascending: false });
    const ids = (poRows ?? []).map((p: any) => p.id);
    let items: POItem[] = [];
    if (ids.length) {
      const { data: itemRows } = await supabase
        .from("purchase_order_items")
        .select("id, po_id, product_id, product_name, serial_number, color, quantity, received_qty")
        .in("po_id", ids);
      items = (itemRows ?? []) as POItem[];
    }
    const byPo: Record<string, POItem[]> = {};
    for (const it of items) (byPo[it.po_id] ||= []).push(it);
    setPos((poRows ?? []).map((p: any) => ({ ...p, items: byPo[p.id] ?? [] })));
    setLoading(false);
  }

  async function loadRecentOps() {
    if (!isInventoryAdmin) return;
    const { data } = await supabase
      .from("bulk_receipt_ops" as any)
      .select("id, actor_email, po_count, batch_count, total_qty, created_at, reverted_at, receipt_ids, back_deducted_dri_ids")
      .order("created_at", { ascending: false })
      .limit(5);
    setRecentOps((data ?? []) as any);
  }

  useEffect(() => { load(); loadRecentOps(); /* eslint-disable-next-line */ }, [isInventoryAdmin]);

  function toggle(poId: string) {
    setSel((s) => {
      const cur = s[poId];
      if (cur?.enabled) return { ...s, [poId]: { ...cur, enabled: false } };
      const po = pos.find((p) => p.id === poId);
      const items: Record<string, number> = {};
      for (const it of po?.items ?? []) items[it.id] = Math.max(0, it.quantity - it.received_qty);
      return { ...s, [poId]: { enabled: true, batches: [{ items }] } };
    });
  }
  function setQty(poId: string, batchIdx: number, itemId: string, qty: number) {
    setSel((s) => {
      const cur = s[poId]; if (!cur) return s;
      const po = pos.find((p) => p.id === poId);
      const it = po?.items?.find((x) => x.id === itemId);
      const maxRemain = it ? it.quantity - it.received_qty : Infinity;
      // qty across other batches for same item
      const otherAlloc = cur.batches.reduce((a, b, i) => i === batchIdx ? a : a + (b.items[itemId] || 0), 0);
      const cap = Math.max(0, maxRemain - otherAlloc);
      const next = Math.min(Math.max(0, qty || 0), cap);
      if (qty > cap) toast.warning(isAr ? `الحد الأقصى المتاح لهذا البند: ${cap}` : `Max available for this line: ${cap}`);
      const batches = cur.batches.map((b, i) => i === batchIdx ? { items: { ...b.items, [itemId]: next } } : b);
      return { ...s, [poId]: { ...cur, batches } };
    });
  }
  function addBatch(poId: string) {
    setSel((s) => {
      const cur = s[poId]; if (!cur) return s;
      const po = pos.find((p) => p.id === poId);
      const items: Record<string, number> = {};
      for (const it of po?.items ?? []) items[it.id] = 0;
      return { ...s, [poId]: { ...cur, batches: [...cur.batches, { items }] } };
    });
  }
  function removeBatch(poId: string, idx: number) {
    setSel((s) => {
      const cur = s[poId]; if (!cur || cur.batches.length <= 1) return s;
      return { ...s, [poId]: { ...cur, batches: cur.batches.filter((_, i) => i !== idx) } };
    });
  }
  function fillBatchRemaining(poId: string, idx: number) {
    setSel((s) => {
      const cur = s[poId]; if (!cur) return s;
      const po = pos.find((p) => p.id === poId);
      const allocated: Record<string, number> = {};
      cur.batches.forEach((b, i) => { if (i === idx) return; for (const [k, v] of Object.entries(b.items)) allocated[k] = (allocated[k] || 0) + (v || 0); });
      const items: Record<string, number> = {};
      for (const it of po?.items ?? []) items[it.id] = Math.max(0, it.quantity - it.received_qty - (allocated[it.id] || 0));
      return { ...s, [poId]: { ...cur, batches: cur.batches.map((b, i) => i === idx ? { items } : b) } };
    });
  }

  function buildPayload() {
    const payload: any[] = [];
    for (const po of pos) {
      const s = sel[po.id];
      if (!s?.enabled) continue;
      const batches = s.batches.map((b) => {
        const items = (po.items ?? []).filter((it) => (b.items[it.id] || 0) > 0).map((it) => ({
          po_item_id: it.id, product_id: it.product_id, quantity: b.items[it.id],
          serial_number: it.serial_number, color: it.color,
        }));
        return items.length ? { items } : null;
      }).filter(Boolean);
      if (batches.length) payload.push({ po_id: po.id, batches });
    }
    return payload;
  }

  async function runPreview() {
    const payload = buildPayload();
    if (!payload.length) { toast.error(isAr ? "اختر أمر شراء واحد على الأقل" : "Select at least one PO"); return; }
    setPreviewLoading(true);
    const { data, error } = await supabase.rpc("preview_bulk_apply_po_receipts" as any, { p_payload: payload as any });
    setPreviewLoading(false);
    if (error) { toast.error(error.message); return; }
    setPreview(data);
    setPreviewOpen(true);
  }

  async function submit() {
    const payload = buildPayload();
    if (!payload.length) { toast.error(isAr ? "اختر أمر شراء واحد على الأقل" : "Select at least one PO"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("bulk_apply_po_receipts" as any, {
      p_payload: payload as any, p_actor_email: user?.email ?? null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    toast.success(isAr
      ? `تم استلام ${d?.pos ?? 0} أمر شراء (${d?.batches ?? 0} دفعة) — تم خصم محاضر الاستلام تلقائياً`
      : `Received ${d?.pos ?? 0} POs (${d?.batches ?? 0} batches) — DRs auto-deducted`);
    setSel({}); setPreviewOpen(false); setPreview(null);
    load(); loadRecentOps();
  }

  async function openResetDialog() {
    setResetConfirmText(""); setResetStage(1);
    const { data, error } = await supabase.rpc("preview_inventory_reset" as any);
    if (error) { toast.error(error.message); setResetStage(0); return; }
    setResetPreview(data);
  }

  async function doReset() {
    setResetting(true);
    const { data, error } = await supabase.rpc("reset_all_inventory" as any, { p_actor_email: user?.email ?? null });
    setResetting(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    toast.success(isAr
      ? `تم: ${d?.products_zeroed} منتج، ${d?.receipts_deleted} دفعة استلام، ${d?.dris_reset} بند DR — الفواتير وأوامر الشراء ومحاضر الاستلام محفوظة`
      : `Done: ${d?.products_zeroed} products, ${d?.receipts_deleted} receipts, ${d?.dris_reset} DR items — invoices, POs, and delivery receipts preserved`);
    setResetStage(0); setResetPreview(null);
    load(); loadRecentOps();
  }

  async function doUndo() {
    if (!undoTarget) return;
    if (undoReason.trim().length < 3) { toast.error(isAr ? "اذكر سبب الإلغاء (3 أحرف على الأقل)" : "Reason required (≥3 chars)"); return; }
    setUndoing(true);
    const { error } = await supabase.rpc("undo_bulk_receipt_op" as any, {
      p_op_id: undoTarget.id, p_actor_email: user?.email ?? null, p_reason: undoReason.trim(),
    });
    setUndoing(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم إلغاء عملية الاستلام الجماعي" : "Bulk receive undone");
    setUndoTarget(null); setUndoReason("");
    load(); loadRecentOps();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((p) =>
      p.po_number.toLowerCase().includes(q) ||
      (p.supplier_name ?? "").toLowerCase().includes(q) ||
      (p.shipment_code ?? "").toLowerCase().includes(q)
    );
  }, [pos, search]);

  const selectedCount = Object.values(sel).filter((s) => s.enabled).length;
  const totalBatches = Object.values(sel).filter((s) => s.enabled).reduce((a, s) => a + s.batches.length, 0);
  const previewHasErrors = preview && (preview.errors?.length ?? 0) > 0;

  return (
    <div className="container mx-auto max-w-6xl px-3 sm:px-6 py-6 space-y-5" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/purchase-orders">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="w-4 h-4" />
              {isAr ? "أوامر الشراء" : "Purchase Orders"}
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <PackageCheck className="w-7 h-7 text-primary" />
              {isAr ? "الاستلام الجماعي للمخزون" : "Bulk PO Receive"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              {isAr
                ? "اختر أوامر شراء، حدد عدد الدفعات لكل واحد، عاين قبل التنفيذ، ثم نفّذ. لن تُحذف الفواتير ولا محاضر الاستلام ولا أوامر الشراء — فقط حركات المخزون."
                : "Select POs, define batches, preview, then run. Invoices, delivery receipts, and POs are never deleted — only stock movements."}
            </p>
          </div>
        </div>

        {isInventoryAdmin && (
          <Button variant="destructive" size="sm" className="gap-1.5" onClick={openResetDialog} disabled={resetting}>
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            {isAr ? "تصفير المخزون" : "Reset inventory"}
          </Button>
        )}
      </div>

      {!isInventoryAdmin && (
        <Card className="p-3 border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm">
            {isAr
              ? "تنبيه: تنفيذ الاستلام الجماعي وتصفير المخزون متاح فقط لحسابي الإدارة (k.elsharbatly / e.hesham). يمكنك تجهيز التحديد لكن التنفيذ يحتاج صلاحية إدارية."
              : "Heads-up: bulk receive and inventory reset are restricted to the two admin accounts (k.elsharbatly / e.hesham)."}
          </div>
        </Card>
      )}

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder={isAr ? "بحث: رقم PO، المورد، كود الشحنة…" : "Search PO / supplier / shipment…"}
          value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm"
        />
        <div className="text-sm text-muted-foreground">
          {isAr ? "محدّد:" : "Selected:"} <b>{selectedCount}</b> · {isAr ? "دفعات:" : "Batches:"} <b>{totalBatches}</b>
        </div>
        <div className="ms-auto flex gap-2">
          <Button variant="outline" onClick={runPreview} disabled={previewLoading || selectedCount === 0} className="gap-1.5">
            {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {isAr ? "معاينة" : "Preview"}
          </Button>
          <Button onClick={submit} disabled={submitting || selectedCount === 0 || !isInventoryAdmin} className="gap-1.5">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {isAr ? "تنفيذ الاستلام" : "Run bulk receive"}
          </Button>
        </div>
      </Card>

      {isInventoryAdmin && recentOps.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">{isAr ? "آخر عمليات الاستلام الجماعي" : "Recent bulk receive operations"}</h3>
          </div>
          <div className="space-y-1.5">
            {recentOps.map((op) => (
              <div key={op.id} className="flex flex-wrap items-center gap-2 text-xs sm:text-sm border rounded px-2 py-1.5">
                <Badge variant={op.reverted_at ? "outline" : "secondary"}>
                  {op.reverted_at ? (isAr ? "ملغاة" : "Reverted") : (isAr ? "نشطة" : "Active")}
                </Badge>
                <span className="font-mono text-[11px] text-muted-foreground">{op.id.slice(0, 8)}</span>
                <span>{op.actor_email}</span>
                <span className="text-muted-foreground">
                  · {op.po_count} PO · {op.batch_count} {isAr ? "دفعة" : "batches"} · {op.total_qty} {isAr ? "قطعة" : "qty"}
                </span>
                <span className="text-muted-foreground ms-auto">{new Date(op.created_at).toLocaleString(isAr ? "ar-EG" : "en-GB")}</span>
                {!op.reverted_at && (
                  <Button size="sm" variant="ghost" onClick={() => { setUndoTarget(op); setUndoReason(""); }} className="gap-1.5">
                    <Undo2 className="w-3.5 h-3.5" /> {isAr ? "تراجع" : "Undo"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {filtered.map((po) => {
            const s = sel[po.id];
            const totalRemaining = (po.items ?? []).reduce((a, it) => a + Math.max(0, it.quantity - it.received_qty), 0);
            return (
              <Card key={po.id} className={`p-3 sm:p-4 transition-colors ${s?.enabled ? "border-primary/60 bg-primary/5" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <Checkbox checked={!!s?.enabled} onCheckedChange={() => toggle(po.id)} disabled={totalRemaining === 0} />
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base">{po.po_number}</span>
                      {po.shipment_code && <Badge variant="outline">{po.shipment_code}</Badge>}
                      <Badge variant="secondary" className="text-xs">{po.status}</Badge>
                      <span className="text-xs text-muted-foreground">· {po.supplier_name ?? "—"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmtMoney(Number(po.total_usd) || 0, "USD")} · {isAr ? "المتبقي:" : "Remaining:"}{" "}
                      <b className={totalRemaining > 0 ? "text-amber-600" : "text-emerald-600"}>{totalRemaining}</b> / {po.total_qty}
                    </div>
                  </div>
                </div>

                {s?.enabled && (
                  <div className="mt-4 space-y-3">
                    {s.batches.map((b, idx) => {
                      const batchTotal = Object.values(b.items).reduce((a, v) => a + (v || 0), 0);
                      return (
                        <div key={idx} className="rounded-lg border bg-background p-3">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2">
                              <Badge>{isAr ? "دفعة" : "Batch"} #{idx + 1}</Badge>
                              <span className="text-xs text-muted-foreground">{isAr ? "إجمالي:" : "Total:"} <b>{batchTotal}</b></span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="outline" onClick={() => fillBatchRemaining(po.id, idx)}>
                                {isAr ? "ملء المتبقي" : "Fill remaining"}
                              </Button>
                              {s.batches.length > 1 && (
                                <Button size="sm" variant="ghost" onClick={() => removeBatch(po.id, idx)}>
                                  <Minus className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {(po.items ?? []).map((it) => {
                              const rem = Math.max(0, it.quantity - it.received_qty);
                              const otherAlloc = s.batches.reduce((a, bb, i) => i === idx ? a : a + (bb.items[it.id] || 0), 0);
                              const cap = Math.max(0, rem - otherAlloc);
                              return (
                                <div key={it.id} className="flex items-center gap-2 text-sm">
                                  <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{it.product_name}</div>
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {it.serial_number ?? "—"}{it.color ? ` · ${it.color}` : ""} · {isAr ? "متاح:" : "available:"} {cap}/{it.quantity}
                                    </div>
                                  </div>
                                  <Input
                                    type="number" min={0} max={cap} value={b.items[it.id] ?? 0}
                                    onChange={(e) => setQty(po.id, idx, it.id, parseInt(e.target.value || "0", 10))}
                                    className="w-20 h-8 text-center"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <Button size="sm" variant="outline" onClick={() => addBatch(po.id)} className="gap-1.5">
                      <Plus className="w-4 h-4" /> {isAr ? "إضافة دفعة أخرى" : "Add another batch"}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" /> {isAr ? "معاينة قبل التنفيذ" : "Pre-execution preview"}
            </DialogTitle>
            <DialogDescription>
              {isAr ? "لا يتم تنفيذ أي تعديل قبل ضغطك على «تنفيذ»." : "Nothing is applied until you click Run."}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">{isAr ? "POs" : "POs"}</div><div className="text-lg font-bold">{preview.pos}</div></div>
                <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">{isAr ? "دفعات" : "Batches"}</div><div className="text-lg font-bold">{preview.batches}</div></div>
                <div className="rounded border p-2"><div className="text-[11px] text-muted-foreground">{isAr ? "إجمالي قطع" : "Total qty"}</div><div className="text-lg font-bold">{preview.total_qty}</div></div>
              </div>

              {previewHasErrors && (
                <div className="rounded border border-destructive/50 bg-destructive/5 p-3 text-destructive">
                  <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {isAr ? "أخطاء يجب تصحيحها" : "Errors to fix"}</div>
                  <ul className="mt-1 list-disc ms-5 text-xs">
                    {preview.errors.map((e: any, i: number) => (
                      <li key={i}>{e.po_number} · {e.product_name}: {isAr ? "طلبت" : "requested"} {e.requested}, {isAr ? "متبقي" : "remaining"} {e.remaining}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="font-semibold mb-1">{isAr ? "التأثير على المخزون" : "Stock impact"}</div>
                <div className="rounded border max-h-56 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr>
                      <th className="text-start p-1.5">{isAr ? "المنتج" : "Product"}</th>
                      <th className="text-end p-1.5">{isAr ? "الحالي" : "Current"}</th>
                      <th className="text-end p-1.5">+ {isAr ? "إضافة" : "Add"}</th>
                      <th className="text-end p-1.5">{isAr ? "بعد" : "After"}</th>
                    </tr></thead>
                    <tbody>
                      {Object.values(preview.per_product ?? {}).map((r: any) => (
                        <tr key={r.product_id} className="border-t">
                          <td className="p-1.5 truncate">{r.product_name}</td>
                          <td className="p-1.5 text-end">{r.current_stock}</td>
                          <td className="p-1.5 text-end text-emerald-600">+{r.requested_in}</td>
                          <td className="p-1.5 text-end font-semibold">{r.projected_stock_after_add}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="font-semibold mb-1">
                  {isAr ? "محاضر استلام (DRs) ستُخصم تلقائياً" : "Delivery receipts (DRs) that will auto-deduct"}{" "}
                  <Badge variant="outline">{preview.pending_back_deductions?.length ?? 0}</Badge>
                </div>
                {(preview.pending_back_deductions?.length ?? 0) === 0 ? (
                  <div className="text-xs text-muted-foreground">{isAr ? "لا توجد." : "None."}</div>
                ) : (
                  <div className="rounded border max-h-40 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50"><tr>
                        <th className="text-start p-1.5">{isAr ? "الفاتورة" : "Invoice"}</th>
                        <th className="text-start p-1.5">{isAr ? "المنتج" : "Product"}</th>
                        <th className="text-end p-1.5">{isAr ? "الكمية" : "Qty"}</th>
                      </tr></thead>
                      <tbody>
                        {preview.pending_back_deductions.map((d: any) => (
                          <tr key={d.dri_id} className="border-t">
                            <td className="p-1.5">{d.invoice_number ?? "—"}</td>
                            <td className="p-1.5 truncate">{d.product_name ?? "—"}</td>
                            <td className="p-1.5 text-end text-rose-600">-{d.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>{isAr ? "إغلاق" : "Close"}</Button>
            <Button onClick={submit} disabled={submitting || previewHasErrors || !isInventoryAdmin} className="gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              {isAr ? "تنفيذ الآن" : "Run now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset dialog — two-stage */}
      <Dialog open={resetStage > 0} onOpenChange={(o) => { if (!o) { setResetStage(0); setResetPreview(null); setResetConfirmText(""); } }}>
        <DialogContent dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> {isAr ? "تصفير المخزون" : "Reset inventory"}
            </DialogTitle>
            <DialogDescription>
              {isAr
                ? "هذا الإجراء يُصفّر حركات المخزون فقط. لن يحذف أي فاتورة، ولا أي محضر استلام، ولا أي أمر شراء."
                : "This only resets inventory movements. No invoice, delivery receipt, or PO will be deleted."}
            </DialogDescription>
          </DialogHeader>

          {resetPreview ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Stat label={isAr ? "منتجات سيتم تصفيرها" : "Products to zero"} value={resetPreview.products_to_zero} tone="warn" />
                <Stat label={isAr ? "سجلات مخزون سيتم حذفها" : "Inventory logs to delete"} value={resetPreview.logs_to_delete} tone="warn" />
                <Stat label={isAr ? "دفعات استلام PO" : "PO receipt batches"} value={resetPreview.receipts_to_delete} tone="warn" />
                <Stat label={isAr ? "بنود DR ستُعاد للحالة المعلّقة" : "DR items reset to pending"} value={resetPreview.dris_to_reset} tone="warn" />
              </div>
              <div className="rounded border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-2 text-xs">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">{isAr ? "محفوظة بالكامل (لن تُمس):" : "Fully preserved (untouched):"}</div>
                <div className="grid grid-cols-3 gap-1 text-emerald-700 dark:text-emerald-300">
                  <div>{isAr ? "فواتير" : "Invoices"}: <b>{resetPreview.invoices_kept}</b></div>
                  <div>{isAr ? "محاضر استلام" : "Delivery receipts"}: <b>{resetPreview.delivery_receipts_kept}</b></div>
                  <div>{isAr ? "أوامر شراء" : "Purchase orders"}: <b>{resetPreview.purchase_orders_kept}</b></div>
                </div>
              </div>

              {resetStage === 2 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">
                    {isAr ? 'للتأكيد، اكتب "RESET" بالأحرف الإنجليزية الكبيرة:' : 'To confirm, type "RESET" in capitals:'}
                  </div>
                  <Input value={resetConfirmText} onChange={(e) => setResetConfirmText(e.target.value)} placeholder="RESET" autoFocus />
                </div>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetStage(0); setResetPreview(null); setResetConfirmText(""); }}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            {resetStage === 1 && (
              <Button variant="destructive" disabled={!resetPreview} onClick={() => setResetStage(2)}>
                {isAr ? "متابعة" : "Continue"}
              </Button>
            )}
            {resetStage === 2 && (
              <Button variant="destructive" disabled={resetting || resetConfirmText !== "RESET"} onClick={doReset} className="gap-1.5">
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {isAr ? "نعم، صفّر الآن" : "Yes, reset now"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo dialog */}
      <AlertDialog open={!!undoTarget} onOpenChange={(o) => { if (!o) { setUndoTarget(null); setUndoReason(""); } }}>
        <AlertDialogContent dir={isAr ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Undo2 className="w-5 h-5" /> {isAr ? "إلغاء عملية الاستلام الجماعي" : "Undo bulk receive"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isAr
                ? "سيتم التراجع عن خصومات محاضر الاستلام أولاً، ثم حذف دفعات استلام أوامر الشراء التي أنشأتها هذه العملية. لن تُمس الفواتير أو محاضر الاستلام أو أوامر الشراء نفسها."
                : "Back-deductions will be reverted first, then the PO receipt batches created by this operation will be removed. Invoices, DRs and POs themselves are untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {undoTarget && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>{isAr ? "العملية:" : "Operation:"} <span className="font-mono">{undoTarget.id}</span></div>
              <div>{undoTarget.po_count} PO · {undoTarget.batch_count} {isAr ? "دفعة" : "batches"} · {undoTarget.total_qty} {isAr ? "قطعة" : "qty"}</div>
            </div>
          )}
          <Input value={undoReason} onChange={(e) => setUndoReason(e.target.value)} placeholder={isAr ? "سبب الإلغاء…" : "Reason…"} />
          <AlertDialogFooter>
            <AlertDialogCancel>{isAr ? "إغلاق" : "Close"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doUndo(); }} disabled={undoing || undoReason.trim().length < 3} className="gap-1.5">
              {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              {isAr ? "تأكيد الإلغاء" : "Confirm undo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded border p-2 ${tone === "warn" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : ""}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

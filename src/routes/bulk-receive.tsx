import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/lib/use-role";
import { AppShell } from "@/components/app-shell";
import { ExecutiveGate } from "@/components/executive-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, PackageCheck, Plus, Minus, RotateCcw, ArrowLeft, AlertTriangle } from "lucide-react";
import { fmtMoney } from "@/lib/utils-money";

export const Route = createFileRoute("/bulk-receive")({
  component: () => (
    <AppShell>
      <ExecutiveGate>
        <BulkReceivePage />
      </ExecutiveGate>
    </AppShell>
  ),
});

type POItem = {
  id: string;
  po_id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  received_qty: number;
};

type PO = {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  total_usd: number;
  total_qty: number;
  shipment_code: string | null;
  items?: POItem[];
};

type Batch = { items: Record<string, number> }; // po_item_id -> qty

type Selection = {
  enabled: boolean;
  batches: Batch[];
};

function BulkReceivePage() {
  const { t, isAr } = useI18n();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Record<string, Selection>>({});
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [search, setSearch] = useState("");

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

  useEffect(() => { load(); }, []);

  function toggle(poId: string) {
    setSel((s) => {
      const cur = s[poId];
      if (cur?.enabled) return { ...s, [poId]: { ...cur, enabled: false } };
      const po = pos.find((p) => p.id === poId);
      const items: Record<string, number> = {};
      for (const it of po?.items ?? []) {
        items[it.id] = Math.max(0, it.quantity - it.received_qty);
      }
      return { ...s, [poId]: { enabled: true, batches: [{ items }] } };
    });
  }

  function setQty(poId: string, batchIdx: number, itemId: string, qty: number) {
    setSel((s) => {
      const cur = s[poId];
      if (!cur) return s;
      const batches = cur.batches.map((b, i) =>
        i === batchIdx ? { items: { ...b.items, [itemId]: Math.max(0, qty || 0) } } : b
      );
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
      // remaining = original remaining - what's already allocated in OTHER batches of this PO
      const allocated: Record<string, number> = {};
      cur.batches.forEach((b, i) => {
        if (i === idx) return;
        for (const [k, v] of Object.entries(b.items)) allocated[k] = (allocated[k] || 0) + (v || 0);
      });
      const items: Record<string, number> = {};
      for (const it of po?.items ?? []) {
        const rem = Math.max(0, it.quantity - it.received_qty - (allocated[it.id] || 0));
        items[it.id] = rem;
      }
      const batches = cur.batches.map((b, i) => (i === idx ? { items } : b));
      return { ...s, [poId]: { ...cur, batches } };
    });
  }

  async function submit() {
    const payload: any[] = [];
    for (const po of pos) {
      const s = sel[po.id];
      if (!s?.enabled) continue;
      const batches = s.batches
        .map((b) => {
          const items = (po.items ?? [])
            .filter((it) => (b.items[it.id] || 0) > 0)
            .map((it) => ({
              po_item_id: it.id,
              product_id: it.product_id,
              quantity: b.items[it.id],
              serial_number: it.serial_number,
              color: it.color,
            }));
          return items.length ? { items } : null;
        })
        .filter(Boolean);
      if (batches.length) payload.push({ po_id: po.id, batches });
    }
    if (!payload.length) { toast.error(isAr ? "اختر أمر شراء واحد على الأقل بكميات > 0" : "Select at least one PO with quantities"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("bulk_apply_po_receipts" as any, {
      p_payload: payload as any,
      p_actor_email: user?.email ?? null,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    toast.success(isAr
      ? `تم استلام ${d?.pos ?? 0} أمر شراء (${d?.batches ?? 0} دفعة) — تم خصم محاضر الاستلام المرتبطة تلقائياً`
      : `Received ${d?.pos ?? 0} POs (${d?.batches ?? 0} batches) — auto-deducted matching delivery receipts`);
    setSel({});
    load();
  }

  async function resetAll() {
    setResetting(true);
    const { data, error } = await supabase.rpc("reset_all_inventory" as any, {
      p_actor_email: user?.email ?? null,
    });
    setResetting(false);
    if (error) { toast.error(error.message); return; }
    const d: any = data;
    toast.success(isAr
      ? `تم التصفير: ${d?.products_zeroed ?? 0} منتج، ${d?.receipts_deleted ?? 0} دفعة، ${d?.dris_reset ?? 0} بند DR`
      : `Reset: ${d?.products_zeroed ?? 0} products, ${d?.receipts_deleted ?? 0} batches, ${d?.dris_reset ?? 0} DR items`);
    load();
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
            <p className="text-sm text-muted-foreground mt-1">
              {isAr
                ? "اختر أوامر شراء، حدد عدد دفعات كل واحد، وأكد. النظام يضيف للمخزون ويخصم تلقائياً محاضر الاستلام (DR) الموقعة."
                : "Select POs, define batches per PO, confirm. Stock is added and signed delivery receipts are auto-deducted."}
            </p>
          </div>
        </div>

        {isAdmin && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1.5" disabled={resetting}>
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {isAr ? "تصفير المخزون بالكامل" : "Reset entire inventory"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir={isAr ? "rtl" : "ltr"}>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  {isAr ? "هل أنت متأكد؟" : "Are you sure?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isAr
                    ? "سيتم تصفير كل المنتجات، حذف كل سجلات المخزون، حذف كل دفعات استلام أوامر الشراء، وإعادة تعيين روابط الخصم في محاضر الاستلام. هذا الإجراء لا يمكن التراجع عنه."
                    : "All product stock will be zeroed, all inventory logs deleted, all PO receipt batches removed, and delivery-receipt back-deduction marks cleared. This cannot be undone."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={resetAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {isAr ? "نعم، صفّر كل شيء" : "Yes, reset everything"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <Input
          placeholder={isAr ? "بحث: رقم PO، المورد، كود الشحنة…" : "Search PO / supplier / shipment…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="text-sm text-muted-foreground">
          {isAr ? "محدّد:" : "Selected:"} <b>{selectedCount}</b> · {isAr ? "دفعات:" : "Batches:"} <b>{totalBatches}</b>
        </div>
        <div className="ms-auto">
          <Button onClick={submit} disabled={submitting || selectedCount === 0} className="gap-1.5">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
            {isAr ? "تنفيذ الاستلام الجماعي" : "Run bulk receive"}
          </Button>
        </div>
      </Card>

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
                      {fmtMoney(Number(po.total_usd) || 0, "USD")} ·{" "}
                      {isAr ? "المتبقي:" : "Remaining:"} <b className={totalRemaining > 0 ? "text-amber-600" : "text-emerald-600"}>{totalRemaining}</b> / {po.total_qty}
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
                              <span className="text-xs text-muted-foreground">
                                {isAr ? "إجمالي:" : "Total:"} <b>{batchTotal}</b>
                              </span>
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
                              return (
                                <div key={it.id} className="flex items-center gap-2 text-sm">
                                  <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">{it.product_name}</div>
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {it.serial_number ?? "—"}{it.color ? ` · ${it.color}` : ""} · {isAr ? "متبقي:" : "rem:"} {rem}/{it.quantity}
                                    </div>
                                  </div>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={b.items[it.id] ?? 0}
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
    </div>
  );
}

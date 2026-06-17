import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ColorSwatch } from "@/components/color-swatch";
import { fmtDateTime } from "@/lib/utils-money";
import { Search, History, Undo2, ShieldCheck, ArrowLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/back-deduction-report")({
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

type ReportRow = {
  dri_id: string;
  applied_at: string;
  applied_by_email: string | null;
  po_id: string | null;
  po_number: string | null;
  shipment_code: string | null;
  shipment_date: string | null;
  receipt_id: string;
  receipt_delivered_at: string;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_name: string | null;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  current_stock: number;
};

function Page() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [poFilter, setPoFilter] = useState<string>("all");
  const [undoFor, setUndoFor] = useState<ReportRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("back_deduction_report");
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ReportRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const poOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => {
      if (r.po_id && r.po_number) m.set(r.po_id, r.po_number);
    });
    return Array.from(m.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (poFilter !== "all" && r.po_id !== poFilter) return false;
      if (!q) return true;
      return (
        (r.product_name ?? "").toLowerCase().includes(q) ||
        (r.serial_number ?? "").toLowerCase().includes(q) ||
        (r.invoice_number ?? "").toLowerCase().includes(q) ||
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        (r.po_number ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, poFilter]);

  // group by PO for the summary
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        po_id: string | null;
        po_number: string | null;
        shipment_code: string | null;
        items: ReportRow[];
        totalQty: number;
      }
    >();
    filtered.forEach((r) => {
      const key = r.po_id ?? "_";
      const g =
        map.get(key) ??
        {
          po_id: r.po_id,
          po_number: r.po_number,
          shipment_code: r.shipment_code,
          items: [],
          totalQty: 0,
        };
      g.items.push(r);
      g.totalQty += r.quantity || 0;
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) =>
      (b.po_number ?? "").localeCompare(a.po_number ?? ""),
    );
  }, [filtered]);

  const totals = useMemo(
    () => ({
      receipts: filtered.length,
      qty: filtered.reduce((s, r) => s + (r.quantity || 0), 0),
      pos: new Set(filtered.map((r) => r.po_id)).size,
    }),
    [filtered],
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/po-tracking">
            <Button variant="outline" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              {isAr ? "تتبع الأوامر" : "PO Tracking"}
            </Button>
          </Link>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            {isAr ? "تقرير تسوية محاضر الاستلام التاريخية" : "Back-deduction reconciliation report"}
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="h-4 w-4" />
          {isAr ? "تحديث" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">{isAr ? "أوامر شراء" : "POs"}</div>
          <div className="text-2xl font-bold tabular-nums">{totals.pos}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">{isAr ? "محاضر استلام مخصومة" : "Back-deducted receipts"}</div>
          <div className="text-2xl font-bold tabular-nums">{totals.receipts}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">{isAr ? "إجمالي القطع المخصومة" : "Total deducted units"}</div>
          <div className="text-2xl font-bold tabular-nums">{totals.qty}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "ابحث (منتج / سيريال / عميل / فاتورة / PO)" : "Search (product / serial / customer / invoice / PO)"}
            className="ps-8"
          />
        </div>
        <select
          value={poFilter}
          onChange={(e) => setPoFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">{isAr ? "كل أوامر الشراء" : "All POs"}</option>
          {poOptions.map(([id, num]) => (
            <option key={id} value={id}>
              {num}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{isAr ? "جارٍ التحميل..." : "Loading..."}</div>
      ) : groups.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {isAr ? "لا توجد عمليات خصم تاريخية حتى الآن." : "No back-deductions recorded yet."}
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.po_id ?? "none"} className="overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-2 p-3 border-b bg-muted/30">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-mono font-bold">{g.po_number ?? "—"}</span>
                {g.shipment_code && (
                  <Badge variant="outline" className="font-mono">
                    {g.shipment_code}
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  · {g.items.length} {isAr ? "محضر" : "receipts"} · {isAr ? "إجمالي" : "Total"}:{" "}
                  <b className="text-foreground tabular-nums">{g.totalQty}</b>
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setUndoFor(g.items)}
              >
                <Undo2 className="h-4 w-4" />
                {isAr ? "تراجع عن خصم كل المحاضر" : "Undo all"}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-2 text-start">{isAr ? "تاريخ الخصم" : "Deducted at"}</th>
                    <th className="p-2 text-start">{isAr ? "بواسطة" : "By"}</th>
                    <th className="p-2 text-start">{isAr ? "المنتج" : "Product"}</th>
                    <th className="p-2 text-start">{isAr ? "سيريال" : "Serial"}</th>
                    <th className="p-2 text-start">{isAr ? "اللون" : "Color"}</th>
                    <th className="p-2 text-end">{isAr ? "الكمية" : "Qty"}</th>
                    <th className="p-2 text-end">{isAr ? "المخزون الحالي" : "Current stock"}</th>
                    <th className="p-2 text-start">{isAr ? "محضر" : "Receipt"}</th>
                    <th className="p-2 text-start">{isAr ? "العميل / الفاتورة" : "Customer / Invoice"}</th>
                    <th className="p-2 text-end">{isAr ? "إجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((r) => {
                    const negative = r.current_stock < 0;
                    return (
                      <tr key={r.dri_id} className="border-t hover:bg-muted/20">
                        <td className="p-2 whitespace-nowrap">{fmtDateTime(r.applied_at, lang)}</td>
                        <td className="p-2 truncate max-w-[160px]">{r.applied_by_email ?? "—"}</td>
                        <td className="p-2">{r.product_name ?? "—"}</td>
                        <td className="p-2 font-mono">{r.serial_number ?? "—"}</td>
                        <td className="p-2">
                          {r.color ? (
                            <span className="inline-flex items-center gap-1">
                              <ColorSwatch value={r.color} size="sm" />
                              {r.color}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2 text-end tabular-nums font-bold">{r.quantity}</td>
                        <td className={`p-2 text-end tabular-nums ${negative ? "text-destructive font-bold" : ""}`}>
                          {r.current_stock}
                        </td>
                        <td className="p-2 whitespace-nowrap">{fmtDateTime(r.receipt_delivered_at, lang)}</td>
                        <td className="p-2">
                          <div className="truncate max-w-[160px]">{r.customer_name ?? "—"}</div>
                          {r.invoice_number && (
                            <div className="font-mono text-muted-foreground">{r.invoice_number}</div>
                          )}
                        </td>
                        <td className="p-2 text-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 h-7"
                            onClick={() => setUndoFor([r])}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            {isAr ? "تراجع" : "Undo"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-1 pt-2 border-t">
        <ShieldCheck className="h-3.5 w-3.5" />
        {isAr
          ? "كل عمليات الخصم والتراجع مسجلة في سجل التدقيق الدائم ولا يمكن تعديلها أو حذفها."
          : "Every deduction and undo is recorded in the immutable audit log — cannot be edited or deleted."}
      </div>

      <UndoDialog
        rows={undoFor}
        onClose={(refresh) => {
          setUndoFor(null);
          if (refresh) load();
        }}
        userEmail={user?.email ?? ""}
      />
    </div>
  );
}

function UndoDialog({
  rows,
  onClose,
  userEmail,
}: {
  rows: ReportRow[] | null;
  onClose: (refresh: boolean) => void;
  userEmail: string;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rows) setReason("");
  }, [rows]);

  const open = !!rows && rows.length > 0;
  const totalQty = rows?.reduce((s, r) => s + (r.quantity || 0), 0) ?? 0;

  const submit = async () => {
    if (!rows) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error(isAr ? "السبب مطلوب (3 أحرف على الأقل)" : "Reason required (at least 3 characters)");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("revert_back_deductions", {
        p_dri_ids: rows.map((r) => r.dri_id),
        p_actor_email: userEmail,
        p_reason: trimmed,
      });
      if (error) throw error;
      const items = (data as any)?.items ?? 0;
      const qty = (data as any)?.total_qty ?? 0;
      toast.success(
        isAr
          ? `تم التراجع عن ${qty} قطعة من ${items} محضر`
          : `Reverted ${qty} units across ${items} receipts`,
      );
      onClose(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            {isAr ? "تراجع عن خصم محاضر استلام" : "Undo back-deduction"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div>
              <b>{rows?.length ?? 0}</b> {isAr ? "محضر" : "receipts"} · {isAr ? "إجمالي" : "Total"}:{" "}
              <b className="tabular-nums">{totalQty}</b> {isAr ? "قطعة" : "units"}
            </div>
            <div className="text-muted-foreground">
              {isAr
                ? "سيُعاد إضافة الكميات للمخزون ويُسجَّل التراجع في سجل التدقيق الدائم باسم المستخدم والوقت والسبب."
                : "Quantities will be added back to stock; the undo is recorded in the immutable audit log with user, time, and reason."}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">
              {isAr ? "سبب التراجع (إجباري)" : "Undo reason (required)"} *
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isAr
                  ? "مثال: تم الخصم بالخطأ، المحضر يتبع شحنة أخرى..."
                  : "e.g. wrongly deducted, receipt belongs to another shipment..."
              }
              rows={3}
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={busy || reason.trim().length < 3}>
            {busy ? (isAr ? "..." : "...") : isAr ? "تأكيد التراجع" : "Confirm undo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

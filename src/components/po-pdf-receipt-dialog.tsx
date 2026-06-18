import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Trash2,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { parseDOReceiptPdfs, type ParsedDO } from "@/lib/pdf-do-receipt";

type POItem = {
  id: string;
  product_id: string | null;
  product_name: string;
  serial_number: string | null;
  quantity: number;
  received_qty?: number | null;
};

type Mode = "single" | "perFile";

type FileMatch = {
  file: ParsedDO;
  matched: { sku: string; qty: number; itemId: string; remaining: number }[];
  excess: { sku: string; qty: number; itemId: string; remaining: number }[];
  missing: { sku: string; qty: number }[];
};

export function POPdfReceiptDialog({
  open,
  onOpenChange,
  poId,
  poNumber,
  items,
  onDone,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  poId: string;
  poNumber: string;
  items: POItem[];
  onDone: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [parsed, setParsed] = useState<ParsedDO[]>([]);
  const [mode, setMode] = useState<Mode>("perFile");
  const [busy, setBusy] = useState(false);

  // Remaining map per PO item id
  const remainingByItem = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      m[it.id] = Math.max(0, it.quantity - (it.received_qty || 0));
    }
    return m;
  }, [items]);

  // SKU → array of {itemId, remaining}
  const skuIndex = useMemo(() => {
    const m = new Map<string, { itemId: string; remaining: number }[]>();
    for (const it of items) {
      const sku = (it.serial_number || "").toUpperCase().trim();
      if (!sku) continue;
      const remaining = remainingByItem[it.id];
      if (remaining <= 0) continue;
      const arr = m.get(sku) ?? [];
      arr.push({ itemId: it.id, remaining });
      m.set(sku, arr);
    }
    return m;
  }, [items, remainingByItem]);

  const matches: FileMatch[] = useMemo(() => {
    return parsed.map((file) => {
      const matched: FileMatch["matched"] = [];
      const excess: FileMatch["excess"] = [];
      const missing: FileMatch["missing"] = [];
      for (const line of file.lines) {
        const candidates = skuIndex.get(line.sku);
        if (!candidates || candidates.length === 0) {
          missing.push({ sku: line.sku, qty: line.quantity });
          continue;
        }
        const c = candidates[0];
        if (line.quantity > c.remaining) {
          excess.push({
            sku: line.sku,
            qty: line.quantity,
            itemId: c.itemId,
            remaining: c.remaining,
          });
        } else {
          matched.push({
            sku: line.sku,
            qty: line.quantity,
            itemId: c.itemId,
            remaining: c.remaining,
          });
        }
      }
      return { file, matched, excess, missing };
    });
  }, [parsed, skuIndex]);

  const totals = useMemo(() => {
    let ok = 0,
      warn = 0,
      miss = 0;
    for (const m of matches) {
      ok += m.matched.length;
      warn += m.excess.length;
      miss += m.missing.length;
    }
    return { ok, warn, miss };
  }, [matches]);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setParsed([]);
      setProgress({ done: 0, total: 0 });
    }
  }, [open]);

  const onPick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const arr = Array.from(list).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    setFiles((prev) => [...prev, ...arr]);
  };

  const runParse = async () => {
    if (files.length === 0) return;
    setParsing(true);
    setProgress({ done: 0, total: files.length });
    try {
      const res = await parseDOReceiptPdfs(files, (d, t) =>
        setProgress({ done: d, total: t }),
      );
      setParsed(res);
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!user) return;
    if (matches.length === 0) {
      toast.error(isAr ? "حلّل الملفات أولاً" : "Parse files first");
      return;
    }
    setBusy(true);
    try {
      let totalBatches = 0;
      let totalDeducted = 0;

      if (mode === "single") {
        // Aggregate all matched + clamped excess into one batch
        const agg = new Map<string, number>();
        for (const fm of matches) {
          for (const m of fm.matched) {
            agg.set(m.itemId, (agg.get(m.itemId) ?? 0) + m.qty);
          }
          for (const m of fm.excess) {
            agg.set(m.itemId, (agg.get(m.itemId) ?? 0) + m.remaining);
          }
        }
        // Clamp each itemId to its remaining
        const payload = Array.from(agg.entries())
          .map(([itemId, qty]) => ({
            item_id: itemId,
            received_qty: Math.min(qty, remainingByItem[itemId] ?? 0),
          }))
          .filter((x) => x.received_qty > 0);
        if (payload.length === 0) {
          toast.error(isAr ? "لا توجد بنود قابلة للاستلام" : "No items to receive");
          setBusy(false);
          return;
        }
        const fileNames = matches.map((m) => m.file.fileName).join(", ");
        const { data, error } = await (supabase as any).rpc(
          "apply_po_receipt_with_back_deduct",
          {
            p_po_id: poId,
            items_in: payload,
            p_notes: `استلام من PDF: ${fileNames}`.slice(0, 500),
            p_actor_email: user.email ?? "",
          },
        );
        if (error) throw error;
        totalBatches = 1;
        totalDeducted = data?.back_deduct?.items ?? 0;
      } else {
        // One batch per file (skip files that produced 0 matched+excess)
        for (const fm of matches) {
          const agg = new Map<string, number>();
          for (const m of fm.matched) {
            agg.set(m.itemId, (agg.get(m.itemId) ?? 0) + m.qty);
          }
          for (const m of fm.excess) {
            agg.set(m.itemId, (agg.get(m.itemId) ?? 0) + m.remaining);
          }
          const payload = Array.from(agg.entries())
            .map(([itemId, qty]) => ({
              item_id: itemId,
              received_qty: Math.min(qty, remainingByItem[itemId] ?? 0),
            }))
            .filter((x) => x.received_qty > 0);
          if (payload.length === 0) continue;
          const { data, error } = await (supabase as any).rpc(
            "apply_po_receipt_with_back_deduct",
            {
              p_po_id: poId,
              items_in: payload,
              p_notes: `PDF: ${fm.file.fileName}`,
              p_actor_email: user.email ?? "",
            },
          );
          if (error) throw error;
          totalBatches += 1;
          totalDeducted += data?.back_deduct?.items ?? 0;
        }
      }
      toast.success(
        isAr
          ? `تم إنشاء ${totalBatches} دفعة استلام · خُصم ${totalDeducted} محضر تاريخي`
          : `Created ${totalBatches} receipt batches · ${totalDeducted} historical deductions`,
      );
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <FileText className="h-5 w-5 text-indigo-600" />
            {isAr ? "استلام من PDF" : "Receive from PDF"}
            <span className="font-mono text-sm text-muted-foreground">
              {poNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Upload */}
        <div className="rounded-lg border-2 border-dashed bg-muted/20 p-4">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">
                {isAr
                  ? "ارفع محاضر استلام D.O. (PDF) — ملف واحد أو حتى 1000"
                  : "Upload D.O. receipts (PDF) — one file or up to 1000"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isAr
                  ? "نستخرج كل SKU (STM-XX-XXXX-XXX) — لو مكتوب جنبه NPCS تكون الكمية N، غير كده 1."
                  : "We extract every STM-XX-XXXX-XXX SKU. Qty = N if followed by NPCS, else 1."}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {isAr ? "اختر ملفات" : "Choose files"}
              </Button>
              <Button
                type="button"
                onClick={runParse}
                disabled={files.length === 0 || parsing}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                {parsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {isAr ? `حلّل ${files.length} ملف` : `Parse ${files.length} files`}
              </Button>
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto rounded border bg-background p-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 py-1 text-xs"
                >
                  <span className="truncate font-mono">{f.name}</span>
                  <button
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="text-destructive hover:opacity-70"
                    aria-label="remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {parsing && (
            <div className="mt-2 text-xs text-muted-foreground">
              {isAr
                ? `جاري تحليل ${progress.done}/${progress.total}…`
                : `Parsing ${progress.done}/${progress.total}…`}
            </div>
          )}
        </div>

        {/* Results */}
        {matches.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-600 text-white gap-1">
                <CheckCircle2 className="h-3 w-3" /> {totals.ok}{" "}
                {isAr ? "مطابق" : "matched"}
              </Badge>
              {totals.warn > 0 && (
                <Badge className="bg-amber-500 text-white gap-1">
                  <AlertTriangle className="h-3 w-3" /> {totals.warn}{" "}
                  {isAr ? "زيادة" : "excess"}
                </Badge>
              )}
              {totals.miss > 0 && (
                <Badge className="bg-rose-600 text-white gap-1">
                  <XCircle className="h-3 w-3" /> {totals.miss}{" "}
                  {isAr ? "مفقود" : "missing"}
                </Badge>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const rows: string[] = ["file,sku,status,pdf_qty,po_remaining,note"];
                  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
                  for (const fm of matches) {
                    for (const m of fm.matched) rows.push(`${esc(fm.file.fileName)},${esc(m.sku)},matched,${m.qty},${m.remaining},`);
                    for (const m of fm.excess) rows.push(`${esc(fm.file.fileName)},${esc(m.sku)},excess,${m.qty},${m.remaining},${esc("clamped to remaining")}`);
                    for (const m of fm.missing) rows.push(`${esc(fm.file.fileName)},${esc(m.sku)},missing,${m.qty},0,${esc("not in PO")}`);
                  }
                  const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `PDF-match-${poNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="gap-1 h-7 text-[11px]"
              >
                <Download className="h-3 w-3" />
                {isAr ? "تنزيل تقرير CSV" : "Download CSV"}
              </Button>
              <div className="ms-auto flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === "perFile"}
                    onChange={() => setMode("perFile")}
                  />
                  {isAr ? "دفعة منفصلة لكل ملف" : "Separate batch per file"}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                  />
                  {isAr ? "دفعة واحدة" : "Single batch"}
                </label>
              </div>
            </div>

            <div className="space-y-2">
              {matches.map((fm, i) => {
                const totalLines =
                  fm.matched.length + fm.excess.length + fm.missing.length;
                return (
                  <details
                    key={i}
                    open={fm.missing.length > 0 || fm.excess.length > 0}
                    className="rounded-md border bg-background"
                  >
                    <summary className="cursor-pointer p-3 flex flex-wrap items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-indigo-600" />
                      <span className="font-mono truncate flex-1">
                        {fm.file.fileName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {totalLines} {isAr ? "بند" : "lines"}
                      </span>
                      <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-500/30">
                        {fm.matched.length}✓
                      </Badge>
                      {fm.excess.length > 0 && (
                        <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">
                          {fm.excess.length}⚠
                        </Badge>
                      )}
                      {fm.missing.length > 0 && (
                        <Badge className="bg-rose-600/15 text-rose-700 border-rose-500/30">
                          {fm.missing.length}✗
                        </Badge>
                      )}
                    </summary>
                    {fm.file.error ? (
                      <div className="px-3 pb-3 text-xs text-rose-600">
                        {fm.file.error}
                      </div>
                    ) : (
                      <div className="px-3 pb-3 space-y-2">
                        {fm.matched.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold uppercase text-emerald-700 mb-1">
                              {isAr ? "مطابقات" : "Matches"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {fm.matched.map((m, j) => (
                                <span
                                  key={j}
                                  className="font-mono text-[10px] rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700"
                                >
                                  {m.sku} ×{m.qty}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {fm.excess.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold uppercase text-amber-700 mb-1">
                              {isAr
                                ? `زيادة (سيُخصم على المتبقي فقط)`
                                : `Excess (clamped to remaining)`}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {fm.excess.map((m, j) => (
                                <span
                                  key={j}
                                  className="font-mono text-[10px] rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700"
                                >
                                  {m.sku} ×{m.qty} → {m.remaining}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {fm.missing.length > 0 && (
                          <div>
                            <div className="text-[10px] font-bold uppercase text-rose-700 mb-1">
                              {isAr ? "غير موجود في PO" : "Not in PO"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {fm.missing.map((m, j) => (
                                <span
                                  key={j}
                                  className="font-mono text-[10px] rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-rose-700"
                                >
                                  {m.sku} ×{m.qty}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            onClick={submit}
            disabled={busy || matches.length === 0 || totals.ok + totals.warn === 0}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isAr
              ? `تأكيد وإنشاء ${mode === "single" ? "دفعة واحدة" : matches.length + " دفعة"}`
              : `Confirm & create ${mode === "single" ? "1 batch" : matches.length + " batches"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, FileText, Wrench, User as UserIcon, Truck, CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export type PickedInvoice = {
  id: string;
  invoice_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string | null;
  total: number | null;
};

export type DeliveryReceiptOption = {
  id: string;
  receipt_number: string | null;
  delivered_at: string | null;
  status: string | null;
};

/**
 * Smart invoice + delivery-receipt attach control for tasks.
 *
 * Managers assign tasks about a specific invoice; this control lets them
 * search invoices (number / customer / phone), pick one, and optionally
 * attach any of that invoice's delivery receipts.
 */
export function TaskInvoicePicker({
  invoiceId,
  drIds,
  onChange,
  isAr,
}: {
  invoiceId: string | null;
  drIds: string[];
  onChange: (next: { invoiceId: string | null; drIds: string[] }) => void;
  isAr: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedInvoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PickedInvoice | null>(null);
  const [drs, setDrs] = useState<DeliveryReceiptOption[]>([]);
  const [drsLoading, setDrsLoading] = useState(false);

  // Debounced search
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!query.trim() || picked) { setResults([]); return; }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      const q = query.trim();
      const or = `invoice_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`;
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, customer_phone, status, total")
        .or(or)
        .order("created_at", { ascending: false })
        .limit(20);
      setResults(((data as PickedInvoice[]) ?? []));
      setSearching(false);
    }, 220);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [query, picked]);

  // Hydrate picked invoice from prop
  useEffect(() => {
    if (!invoiceId) { setPicked(null); return; }
    if (picked?.id === invoiceId) return;
    supabase.from("invoices")
      .select("id, invoice_number, customer_name, customer_phone, status, total")
      .eq("id", invoiceId).maybeSingle()
      .then(({ data }) => { if (data) setPicked(data as PickedInvoice); });
  }, [invoiceId]);

  // Load delivery receipts for the picked invoice
  useEffect(() => {
    if (!picked) { setDrs([]); return; }
    setDrsLoading(true);
    supabase.from("delivery_receipts")
      .select("id, receipt_number, delivered_at, status")
      .eq("invoice_id", picked.id)
      .order("delivered_at", { ascending: false })
      .then(({ data }) => {
        setDrs((data as DeliveryReceiptOption[]) ?? []);
        setDrsLoading(false);
      });
  }, [picked?.id]);

  const closed = picked?.status === "completed";

  const pick = (inv: PickedInvoice) => {
    setPicked(inv);
    setQuery("");
    setResults([]);
    onChange({ invoiceId: inv.id, drIds: [] });
  };
  const clear = () => {
    setPicked(null);
    setQuery("");
    setResults([]);
    onChange({ invoiceId: null, drIds: [] });
  };
  const toggleDr = (id: string) => {
    const next = drIds.includes(id) ? drIds.filter((x) => x !== id) : [...drIds, id];
    onChange({ invoiceId: picked?.id ?? null, drIds: next });
  };
  const toggleAllDrs = () => {
    const allIds = drs.map((d) => d.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => drIds.includes(id));
    onChange({ invoiceId: picked?.id ?? null, drIds: allSelected ? [] : allIds });
  };

  const allSelected = useMemo(
    () => drs.length > 0 && drs.every((d) => drIds.includes(d.id)),
    [drs, drIds],
  );

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {isAr ? "ربط بفاتورة (اختياري)" : "Link an invoice (optional)"}
        </div>
        {picked && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            {isAr ? "إزالة الربط" : "Clear"}
          </button>
        )}
      </div>

      {!picked ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isAr ? "ابحث برقم الفاتورة أو اسم/تليفون العميل" : "Search by invoice #, customer name or phone"}
              className="ps-9 h-9"
            />
          </div>
          {query.trim() && (
            <div className="rounded-md border bg-card max-h-64 overflow-y-auto">
              {searching ? (
                <div className="p-3 text-xs text-muted-foreground text-center">{isAr ? "جاري البحث..." : "Searching..."}</div>
              ) : results.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">{isAr ? "لا نتائج" : "No results"}</div>
              ) : (
                <ul className="divide-y">
                  {results.map((r) => {
                    const rClosed = r.status === "completed";
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => pick(r)}
                          className="w-full flex items-center gap-2 px-2.5 py-2 text-start hover:bg-muted/60 transition-colors"
                        >
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-xs font-semibold tabular-nums text-primary">
                            {r.invoice_number || r.id.slice(0, 6)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {r.customer_name || "—"}
                            {r.customer_phone && (
                              <span className="text-muted-foreground"> · {r.customer_phone}</span>
                            )}
                          </span>
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ring-1 ${
                              rClosed
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
                                : "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
                            }`}
                          >
                            {rClosed ? <Wrench className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                            {isAr ? (rClosed ? "خدمة ما بعد البيع" : "عميل") : (rClosed ? "After-sales" : "Customer")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Picked invoice header */}
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-card border p-2">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-bold tabular-nums text-primary">
              {picked.invoice_number || picked.id.slice(0, 6)}
            </span>
            <span className="text-sm text-foreground/80 truncate min-w-0 flex-1">
              {picked.customer_name || "—"}
              {picked.customer_phone && <span className="text-muted-foreground"> · {picked.customer_phone}</span>}
            </span>
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                closed
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
                  : "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
              }`}
            >
              {closed ? <Wrench className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
              {isAr ? (closed ? "خدمة ما بعد البيع" : "عميل") : (closed ? "After-sales" : "Customer")}
            </span>
          </div>

          {/* Delivery receipts */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" />
                {isAr ? "محاضر الاستلام" : "Delivery receipts"}
                {drs.length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px]">{drIds.length}/{drs.length}</span>
                )}
              </div>
              {drs.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllDrs}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  {allSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                  {allSelected ? (isAr ? "إلغاء الكل" : "Clear all") : (isAr ? "تحديد الكل" : "Select all")}
                </button>
              )}
            </div>
            {drsLoading ? (
              <div className="rounded-md border p-3 text-xs text-muted-foreground text-center">{isAr ? "..." : "..."}</div>
            ) : drs.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground text-center">
                {isAr ? "لا توجد محاضر استلام لهذه الفاتورة بعد" : "No delivery receipts for this invoice yet"}
              </div>
            ) : (
              <ul className="max-h-40 overflow-y-auto rounded-md border bg-card divide-y">
                {drs.map((d) => {
                  const on = drIds.includes(d.id);
                  const dt = d.delivered_at ? new Date(d.delivered_at).toLocaleDateString(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
                  return (
                    <li key={d.id}>
                      <label className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/60 transition-colors ${on ? "bg-primary/5" : ""}`}>
                        <Checkbox checked={on} onCheckedChange={() => toggleDr(d.id)} />
                        <span className="text-xs font-semibold tabular-nums">{d.receipt_number || d.id.slice(0, 6)}</span>
                        <span className="text-[11px] text-muted-foreground ms-auto">{dt}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

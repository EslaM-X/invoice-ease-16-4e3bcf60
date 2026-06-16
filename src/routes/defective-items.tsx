import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorSwatch } from "@/components/color-swatch";
import { fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertTriangle, Plus, RotateCcw, Search, ChevronsUpDown, Check, PackageX, ArchiveRestore } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/defective-items")({
  component: () => (
    <AppShell>
      <DefectivePage />
    </AppShell>
  ),
});

type DefectiveRow = {
  id: string;
  product_id: string;
  product_name: string;
  serial_number: string | null;
  color: string | null;
  quantity: number;
  returned_quantity: number;
  reason: string;
  status: "out" | "returned_partial" | "returned_full";
  notes: string | null;
  registered_by_email: string | null;
  created_at: string;
};

type ProductOpt = { id: string; name: string; serial_number: string | null; color: string | null; stock_quantity: number };

const REASONS_AR = ["كسر/تلف", "عيب مصنع", "اختبار/عينة", "إرجاع عميل", "أخرى"];
const REASONS_EN = ["Broken/Damaged", "Factory defect", "Sample/Test", "Customer return", "Other"];

function statusBadge(s: string, isAr: boolean) {
  if (s === "returned_full") {
    return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700">{isAr ? "رجعت بالكامل" : "Fully returned"}</Badge>;
  }
  if (s === "returned_partial") {
    return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">{isAr ? "رجعت جزئياً" : "Partially returned"}</Badge>;
  }
  return <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">{isAr ? "خارج المخزون" : "Out of stock"}</Badge>;
}

function DefectivePage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<DefectiveRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "returned_partial" | "returned_full">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<DefectiveRow | null>(null);

  const load = async () => {
    const [{ data: d }, { data: p }] = await Promise.all([
      supabase.from("defective_items" as any).select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("products").select("id,name,serial_number,color,stock_quantity").order("name"),
    ]);
    setRows((d as any) ?? []);
    setProducts((p as any) ?? []);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useRealtimeTable("defective_items" as any, load);
  useRealtimeTable("products", load);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!s) return true;
      return (
        r.product_name.toLowerCase().includes(s) ||
        (r.serial_number ?? "").toLowerCase().includes(s) ||
        (r.color ?? "").toLowerCase().includes(s) ||
        (r.reason ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const out = rows.filter((r) => r.status === "out").reduce((s, r) => s + (r.quantity - r.returned_quantity), 0);
    const returned = rows.reduce((s, r) => s + r.returned_quantity, 0);
    return { out, returned, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-destructive/10 p-2.5">
            <PackageX className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? "العيانات (مرتجعات/تالف)" : "Defective Items"}</h1>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? `${totals.count} سجل · خارج المخزون: ${totals.out} · رجع للمخزون: ${totals.returned}`
                : `${totals.count} records · Out: ${totals.out} · Returned: ${totals.returned}`}
            </p>
          </div>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />{isAr ? "تسجيل عيان جديد" : "Register defective"}</Button>
          </DialogTrigger>
          {addOpen && <AddDefectiveDialog products={products} onDone={() => { setAddOpen(false); load(); }} isAr={isAr} />}
        </Dialog>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isAr ? "ابحث بالاسم / السيريال / السبب…" : "Search name / serial / reason…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الحالات" : "All statuses"}</SelectItem>
            <SelectItem value="out">{isAr ? "خارج المخزون" : "Out"}</SelectItem>
            <SelectItem value="returned_partial">{isAr ? "رجع جزئياً" : "Partial"}</SelectItem>
            <SelectItem value="returned_full">{isAr ? "رجع بالكامل" : "Fully returned"}</SelectItem>
          </SelectContent>
        </Select>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <AlertTriangle className="mx-auto h-10 w-10 mb-3 opacity-50" />
          {isAr ? "لا توجد سجلات." : "No records."}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const remaining = r.quantity - r.returned_quantity;
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.product_name}</span>
                      {r.color && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <ColorSwatch value={r.color} size="sm" />{r.color}
                        </span>
                      )}
                      {r.serial_number && <span className="text-xs font-mono text-muted-foreground">S/N: {r.serial_number}</span>}
                      {statusBadge(r.status, isAr)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {isAr ? "السبب: " : "Reason: "}<span className="font-medium text-foreground">{r.reason}</span>
                      {" · "}{fmtDateTime(r.created_at, lang)}
                      {r.registered_by_email && ` · ${r.registered_by_email}`}
                    </div>
                    {r.notes && <div className="mt-1 text-xs italic text-muted-foreground">{r.notes}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">{isAr ? "الكمية" : "Qty"}</div>
                      <div className="text-lg font-bold tabular-nums">{r.quantity}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">{isAr ? "رجع" : "Returned"}</div>
                      <div className="text-lg font-bold tabular-nums text-emerald-700">{r.returned_quantity}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">{isAr ? "متبقي" : "Remaining"}</div>
                      <div className="text-lg font-bold tabular-nums text-amber-700">{remaining}</div>
                    </div>
                    {remaining > 0 && (
                      <Button size="sm" variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10" onClick={() => setReturnFor(r)}>
                        <ArchiveRestore className="h-4 w-4" />{isAr ? "إرجاع للمخزون" : "Return to stock"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {returnFor && (
        <ReturnDialog row={returnFor} onClose={() => setReturnFor(null)} onDone={() => { setReturnFor(null); load(); }} isAr={isAr} />
      )}
    </div>
  );
}

function AddDefectiveDialog({ products, onDone, isAr }: { products: ProductOpt[]; onDone: () => void; isAr: boolean }) {
  const [productId, setProductId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [reason, setReason] = useState<string>(isAr ? REASONS_AR[0] : REASONS_EN[0]);
  const [serial, setSerial] = useState("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = products.find((p) => p.id === productId);
  const REASONS = isAr ? REASONS_AR : REASONS_EN;

  const submit = async () => {
    if (!productId) return toast.error(isAr ? "اختر منتج" : "Select a product");
    if (qty <= 0) return toast.error(isAr ? "كمية غير صحيحة" : "Invalid quantity");
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("register_defective_item", {
        _product_id: productId,
        _quantity: qty,
        _reason: reason,
        _serial_number: serial.trim() || null,
        _color: color.trim() || null,
        _notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success(isAr ? "تم التسجيل وخصم من المخزون" : "Registered and deducted from stock");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{isAr ? "تسجيل عيان جديد" : "Register defective item"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">{isAr ? "المنتج" : "Product"}</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between">
                {selected ? selected.name : (isAr ? "اختر منتج…" : "Select product…")}
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder={isAr ? "ابحث…" : "Search…"} value={search} onValueChange={setSearch} />
                <CommandList>
                  <CommandEmpty>{isAr ? "لا توجد نتائج" : "No results"}</CommandEmpty>
                  <CommandGroup>
                    {products.map((p) => (
                      <CommandItem key={p.id} value={`${p.name} ${p.serial_number ?? ""}`} onSelect={() => { setProductId(p.id); setColor(p.color ?? ""); setOpen(false); }}>
                        <Check className={cn("me-2 h-4 w-4", productId === p.id ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{p.stock_quantity}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selected && <div className="mt-1 text-xs text-muted-foreground">{isAr ? "المخزون الحالي:" : "Stock:"} <span className="font-bold tabular-nums">{selected.stock_quantity}</span></div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">{isAr ? "الكمية" : "Quantity"}</Label>
            <Input type="number" min={1} max={selected?.stock_quantity ?? undefined} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div>
            <Label className="text-xs">{isAr ? "السبب" : "Reason"}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">{isAr ? "السيريال (اختياري)" : "Serial (optional)"}</Label><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
          <div><Label className="text-xs">{isAr ? "اللون" : "Color"}</Label><Input value={color} onChange={(e) => setColor(e.target.value)} /></div>
        </div>
        <div>
          <Label className="text-xs">{isAr ? "ملاحظات" : "Notes"}</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !productId} className="gap-2">
          <PackageX className="h-4 w-4" />{isAr ? "تسجيل وخصم من المخزون" : "Register & deduct"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ReturnDialog({ row, onClose, onDone, isAr }: { row: DefectiveRow; onClose: () => void; onDone: () => void; isAr: boolean }) {
  const remaining = row.quantity - row.returned_quantity;
  const [qty, setQty] = useState<number>(remaining);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (qty <= 0 || qty > remaining) return toast.error(isAr ? "كمية غير صحيحة" : "Invalid quantity");
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("return_defective_item", {
        _defective_id: row.id,
        _quantity: qty,
        _notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success(isAr ? "تم إرجاع الكمية للمخزون" : "Returned to stock");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ArchiveRestore className="h-5 w-5 text-emerald-600" />{isAr ? "إرجاع للمخزون" : "Return to stock"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">{row.product_name}</div>
            <div className="text-xs text-muted-foreground">{isAr ? `متبقي للإرجاع: ${remaining} من ${row.quantity}` : `${remaining} of ${row.quantity} can be returned`}</div>
          </div>
          <div>
            <Label className="text-xs">{isAr ? "الكمية المراد إرجاعها" : "Quantity to return"}</Label>
            <Input type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(remaining, parseInt(e.target.value) || 1)))} />
            <div className="mt-1 flex gap-2">
              <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setQty(remaining)}>{isAr ? "كل المتبقي" : "All remaining"}</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setQty(1)}>1</Button>
            </div>
          </div>
          <div>
            <Label className="text-xs">{isAr ? "ملاحظات الإرجاع" : "Return notes"}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isAr ? "مثلاً: تم الإصلاح، حالة المنتج…" : "e.g. Repaired, condition…"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <RotateCcw className="h-4 w-4" />{isAr ? "تأكيد الإرجاع" : "Confirm return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

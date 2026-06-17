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
import { ColorSwatch } from "@/components/color-swatch";
import { fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertTriangle, Plus, RotateCcw, Search, PackageX, ArchiveRestore, Sparkles, Eye, HandCoins, ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/defective-items")({
  component: () => (
    <AppShell>
      <DefectivePage />
    </AppShell>
  ),
});

type ItemType = "defective" | "sample" | "display" | "loan";

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
  item_type: ItemType;
  notes: string | null;
  registered_by_email: string | null;
  created_at: string;
};

type ProductOpt = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  stock_quantity: number;
  collection: string | null;
  image_url: string | null;
  price: number | null;
};

const REASONS_AR = ["كسر/تلف", "عيب مصنع", "اختبار/عينة", "إرجاع عميل", "إعارة لعميل", "عرض ڤاترين", "أخرى"];
const REASONS_EN = ["Broken/Damaged", "Factory defect", "Sample/Test", "Customer return", "Loaned to customer", "Showroom display", "Other"];

const TYPE_META: Record<ItemType, { ar: string; en: string; icon: any; cls: string }> = {
  defective: { ar: "تالف", en: "Defective", icon: AlertTriangle, cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  sample:    { ar: "عينة", en: "Sample",    icon: Sparkles,      cls: "border-violet-500/40 bg-violet-500/10 text-violet-700" },
  display:   { ar: "عرض ڤاترين", en: "Display", icon: Eye,        cls: "border-sky-500/40 bg-sky-500/10 text-sky-700" },
  loan:      { ar: "إعارة", en: "Loan",     icon: HandCoins,     cls: "border-amber-500/40 bg-amber-500/10 text-amber-700" },
};

function typeBadge(t: ItemType, isAr: boolean) {
  const m = TYPE_META[t] ?? TYPE_META.defective;
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", m.cls)}>
      <Icon className="h-3 w-3" />
      {isAr ? m.ar : m.en}
    </Badge>
  );
}

function statusBadge(s: string, isAr: boolean) {
  if (s === "returned_full") return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700">{isAr ? "رجعت بالكامل" : "Fully returned"}</Badge>;
  if (s === "returned_partial") return <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700">{isAr ? "رجعت جزئياً" : "Partially returned"}</Badge>;
  return <Badge variant="outline" className="border-muted-foreground/30 bg-muted/40 text-foreground/80">{isAr ? "خارج المخزون" : "Out of stock"}</Badge>;
}

function DefectivePage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<DefectiveRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "returned_partial" | "returned_full">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<DefectiveRow | null>(null);

  const load = async () => {
    const [{ data: d }, { data: p }] = await Promise.all([
      supabase.from("defective_items" as any).select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("products").select("id,name,serial_number,color,stock_quantity,collection,image_url,price").order("name"),
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
      if (typeFilter !== "all" && (r.item_type ?? "defective") !== typeFilter) return false;
      if (!s) return true;
      return (
        r.product_name.toLowerCase().includes(s) ||
        (r.serial_number ?? "").toLowerCase().includes(s) ||
        (r.color ?? "").toLowerCase().includes(s) ||
        (r.reason ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, search, statusFilter, typeFilter]);

  // Per-type running totals (only counting items still "out")
  const totals = useMemo(() => {
    const t = { defective: 0, sample: 0, display: 0, loan: 0 } as Record<ItemType, number>;
    let returned = 0;
    for (const r of rows) {
      const rem = r.quantity - r.returned_quantity;
      if (rem > 0) t[(r.item_type ?? "defective") as ItemType] += rem;
      returned += r.returned_quantity;
    }
    return { ...t, returned, count: rows.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-destructive/10 p-2.5">
            <PackageX className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isAr ? "العيانات / العرض / العينات" : "Defective / Display / Samples"}</h1>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? `${totals.count} سجل · رجع للمخزون: ${totals.returned}`
                : `${totals.count} records · Returned: ${totals.returned}`}
            </p>
          </div>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" />{isAr ? "تسجيل جديد" : "Register"}</Button>
          </DialogTrigger>
          {addOpen && <AddDialog products={products} onDone={() => { setAddOpen(false); load(); }} isAr={isAr} />}
        </Dialog>
      </div>

      {/* Type totals strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["defective", "sample", "display", "loan"] as ItemType[]).map((t) => {
          const m = TYPE_META[t];
          const Icon = m.icon;
          return (
            <Card key={t} className={cn("p-3 cursor-pointer transition-all", typeFilter === t && "ring-2 ring-primary")}
              onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={cn("rounded-md p-1.5", m.cls)}><Icon className="h-4 w-4" /></div>
                  <div className="text-xs text-muted-foreground">{isAr ? m.ar : m.en}</div>
                </div>
                <div className="text-xl font-bold tabular-nums">{totals[t]}</div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={isAr ? "ابحث بالاسم / السيريال / اللون / السبب…" : "Search name / serial / color / reason…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isAr ? "كل الأنواع" : "All types"}</SelectItem>
            <SelectItem value="defective">{isAr ? "تالف" : "Defective"}</SelectItem>
            <SelectItem value="sample">{isAr ? "عينة" : "Sample"}</SelectItem>
            <SelectItem value="display">{isAr ? "عرض ڤاترين" : "Display"}</SelectItem>
            <SelectItem value="loan">{isAr ? "إعارة" : "Loan"}</SelectItem>
          </SelectContent>
        </Select>
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
            const product = products.find((p) => p.id === r.product_id);
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                      {product?.image_url ? (
                        <img src={product.image_url} alt={r.product_name} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.product_name}</span>
                        {typeBadge((r.item_type ?? "defective") as ItemType, isAr)}
                        {statusBadge(r.status, isAr)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {r.color && (
                          <span className="inline-flex items-center gap-1">
                            <ColorSwatch value={r.color} size="sm" />{r.color}
                          </span>
                        )}
                        {r.serial_number && <span className="font-mono">S/N: {r.serial_number}</span>}
                        {product?.collection && <span>· {product.collection}</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {isAr ? "السبب: " : "Reason: "}<span className="font-medium text-foreground">{r.reason}</span>
                        {" · "}{fmtDateTime(r.created_at, lang)}
                        {r.registered_by_email && ` · ${r.registered_by_email}`}
                      </div>
                      {r.notes && <div className="mt-1 text-xs italic text-muted-foreground">{r.notes}</div>}
                    </div>
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

function AddDialog({ products, onDone, isAr }: { products: ProductOpt[]; onDone: () => void; isAr: boolean }) {
  const [productId, setProductId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [itemType, setItemType] = useState<ItemType>("defective");
  const [qty, setQty] = useState<number>(1);
  const [reason, setReason] = useState<string>(isAr ? REASONS_AR[0] : REASONS_EN[0]);
  const [serial, setSerial] = useState("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = products.find((p) => p.id === productId);
  const REASONS = isAr ? REASONS_AR : REASONS_EN;

  const collections = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.collection) set.add(p.collection);
    return Array.from(set).sort();
  }, [products]);

  const colors = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.color) set.add(p.color);
    return Array.from(set).sort();
  }, [products]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products
      .filter((p) => (onlyInStock ? p.stock_quantity > 0 : true))
      .filter((p) => (collectionFilter === "all" ? true : p.collection === collectionFilter))
      .filter((p) => (colorFilter === "all" ? true : p.color === colorFilter))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.serial_number ?? "").toLowerCase().includes(s) || (p.color ?? "").toLowerCase().includes(s));
  }, [products, search, collectionFilter, colorFilter, onlyInStock]);

  const submit = async () => {
    if (!productId) return toast.error(isAr ? "اختر منتج" : "Select a product");
    if (qty <= 0) return toast.error(isAr ? "كمية غير صحيحة" : "Invalid quantity");
    if (!reason.trim()) return toast.error(isAr ? "السبب مطلوب" : "Reason required");
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("register_defective_item", {
        _product_id: productId,
        _quantity: qty,
        _reason: reason,
        _serial_number: serial.trim() || null,
        _color: color.trim() || null,
        _notes: notes.trim() || null,
        _item_type: itemType,
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
    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{isAr ? "تسجيل جديد (تالف / عينة / عرض / إعارة)" : "New record (Defective / Sample / Display / Loan)"}</DialogTitle></DialogHeader>

      <div className="space-y-4">
        {/* Type selector */}
        <div>
          <Label className="text-xs">{isAr ? "نوع الإخراج من المخزون" : "Removal type"}</Label>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["defective", "sample", "display", "loan"] as ItemType[]).map((t) => {
              const m = TYPE_META[t];
              const Icon = m.icon;
              const active = itemType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setItemType(t)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2 text-sm transition-all",
                    active ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted/50"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{isAr ? m.ar : m.en}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Product picker — rich grid with image + filters */}
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">{isAr ? "اختر المنتج" : "Choose product"}</Label>
            {selected && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setProductId("")} className="h-7 gap-1 text-xs">
                <X className="h-3 w-3" />{isAr ? "إلغاء الاختيار" : "Clear"}
              </Button>
            )}
          </div>

          {selected ? (
            <div className="flex items-center gap-3 rounded-md border bg-primary/5 p-2">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                {selected.image_url ? <img src={selected.image_url} className="h-full w-full object-cover" alt={selected.name} /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{selected.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {selected.serial_number && <span className="font-mono">S/N: {selected.serial_number}</span>}
                  {selected.color && <span className="inline-flex items-center gap-1"><ColorSwatch value={selected.color} size="sm" />{selected.color}</span>}
                  {selected.collection && <span>· {selected.collection}</span>}
                  <span>· {isAr ? "المخزون:" : "Stock:"} <b className="text-foreground tabular-nums">{selected.stock_quantity}</b></span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder={isAr ? "ابحث بالاسم/السيريال/اللون…" : "Search name/serial/color…"} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 h-9" />
                </div>
                <Select value={collectionFilter} onValueChange={setCollectionFilter}>
                  <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={isAr ? "الكولكشن" : "Collection"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isAr ? "كل الكولكشن" : "All collections"}</SelectItem>
                    {collections.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={colorFilter} onValueChange={setColorFilter}>
                  <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={isAr ? "اللون" : "Color"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{isAr ? "كل الألوان" : "All colors"}</SelectItem>
                    {colors.map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="inline-flex items-center gap-2"><ColorSwatch value={c} size="sm" />{c}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant={onlyInStock ? "default" : "outline"} size="sm" className="h-9" onClick={() => setOnlyInStock((v) => !v)}>
                  {isAr ? "متاح فقط" : "In-stock only"}
                </Button>
              </div>

              <div className="max-h-[360px] overflow-y-auto">
                {visible.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">{isAr ? "لا توجد منتجات مطابقة" : "No matching products"}</div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {visible.slice(0, 200).map((p) => {
                      const out = p.stock_quantity <= 0;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={out}
                          onClick={() => { setProductId(p.id); setColor(p.color ?? ""); }}
                          className={cn(
                            "flex items-center gap-2 rounded-md border p-2 text-start transition-all",
                            out ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50 hover:border-primary/50"
                          )}
                        >
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                            {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{p.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              {p.color && <span className="inline-flex items-center gap-1"><ColorSwatch value={p.color} size="sm" />{p.color}</span>}
                              {p.collection && <span>· {p.collection}</span>}
                              {p.serial_number && <span className="font-mono">· {p.serial_number}</span>}
                            </div>
                          </div>
                          <div className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums", out ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700")}>
                            {p.stock_quantity}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {visible.length > 200 && (
                  <div className="mt-2 text-center text-[11px] text-muted-foreground">{isAr ? `يعرض 200 من ${visible.length}. ضيق البحث.` : `Showing 200 of ${visible.length}. Narrow your search.`}</div>
                )}
              </div>
            </>
          )}
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
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isAr ? "مثلاً: اسم العميل، مكان العرض…" : "e.g. customer name, display location…"} />
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
            <div className="flex items-center gap-2">
              <span className="font-semibold">{row.product_name}</span>
              {typeBadge((row.item_type ?? "defective") as ItemType, isAr)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{isAr ? `متبقي للإرجاع: ${remaining} من ${row.quantity}` : `${remaining} of ${row.quantity} can be returned`}</div>
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

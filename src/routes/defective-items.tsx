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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ColorSwatch } from "@/components/color-swatch";
import { fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import { AlertTriangle, Plus, RotateCcw, Search, PackageX, ArchiveRestore, Sparkles, Eye, HandCoins, ImageIcon, X, Users, FileCheck2, Trash2 } from "lucide-react";
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
  registered_by: string | null;
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

type ProfileLite = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
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

function initials(s: string | null | undefined) {
  if (!s) return "?";
  const parts = s.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || s[0]?.toUpperCase() || "?";
}

function CreatorChip({ profile, email, isAr }: { profile?: ProfileLite; email: string | null; isAr: boolean }) {
  const name = profile?.display_name || email || (isAr ? "غير معروف" : "Unknown");
  const mail = profile?.email || email || "";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/60 py-0.5 ps-0.5 pe-2 text-[11px]">
      <Avatar className="h-5 w-5">
        {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={name} />}
        <AvatarFallback className="text-[9px]">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="font-medium">{name}</span>
      {mail && mail !== name && <span className="text-muted-foreground">· {mail}</span>}
    </span>
  );
}

function DefectivePage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<DefectiveRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileLite>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "returned_partial" | "returned_full">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [returnReceiptOpen, setReturnReceiptOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<DefectiveRow | null>(null);

  const load = async () => {
    const [{ data: d }, { data: p }, { data: profs }] = await Promise.all([
      supabase.from("defective_items" as any).select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("products").select("id,name,serial_number,color,stock_quantity,collection,image_url,price").order("name"),
      supabase.from("profiles").select("user_id,display_name,email,avatar_url").limit(500),
    ]);
    setRows((d as any) ?? []);
    setProducts((p as any) ?? []);
    const pmap: Record<string, ProfileLite> = {};
    ((profs as any) ?? []).forEach((pr: ProfileLite) => { if (pr.user_id) pmap[pr.user_id] = pr; });
    setProfilesById(pmap);
  };

  useEffect(() => { if (user) load(); }, [user]);
  useRealtimeTable("defective_items" as any, load);
  useRealtimeTable("defective_item_returns" as any, load);
  useRealtimeTable("sample_returns" as any, load);
  useRealtimeTable("sample_return_items" as any, load);
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
        (r.reason ?? "").toLowerCase().includes(s) ||
        (r.registered_by_email ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, search, statusFilter, typeFilter]);

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

  const outstandingRows = useMemo(() => rows.filter((r) => r.quantity - r.returned_quantity > 0), [rows]);

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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setReturnReceiptOpen(true)}>
            <FileCheck2 className="h-4 w-4" />{isAr ? "محضر استرجاع" : "Return receipt"}
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />{isAr ? "تسجيل جديد" : "Register"}</Button>
            </DialogTrigger>
            {addOpen && <AddDialog products={products} onDone={() => { setAddOpen(false); load(); }} isAr={isAr} />}
          </Dialog>
        </div>
      </div>

      {/* Public-access notice */}
      <Card className="border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent p-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="rounded-md bg-emerald-500/15 p-1.5"><Users className="h-4 w-4 text-emerald-700" /></div>
          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
            {isAr ? "أي مستخدم في الفريق يقدر يسجل ويعمل محضر استرجاع." : "Any team member can register and create a return receipt."}
          </span>
          <span className="text-xs text-muted-foreground">
            {isAr ? "كل العمليات لحظية ومشتركة بين الكل." : "All actions sync live across everyone."}
          </span>
        </div>
      </Card>

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
            placeholder={isAr ? "ابحث بالاسم / السيريال / اللون / السبب / المستخدم…" : "Search name / serial / color / reason / user…"}
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
            const profile = r.registered_by ? profilesById[r.registered_by] : undefined;
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
                      </div>
                      <div className="mt-1.5">
                        <CreatorChip profile={profile} email={r.registered_by_email} isAr={isAr} />
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
      {returnReceiptOpen && (
        <ReturnReceiptDialog
          outstanding={outstandingRows}
          products={products}
          onClose={() => setReturnReceiptOpen(false)}
          onDone={() => { setReturnReceiptOpen(false); load(); }}
          isAr={isAr}
        />
      )}
    </div>
  );
}

// ============================================================
// AddDialog — supports MULTIPLE products in a single batch.
// ============================================================
type DraftLine = {
  key: string;
  product: ProductOpt;
  itemType: ItemType;
  qty: number;
  reason: string;
  serial: string;
  color: string;
  notes: string;
};

function AddDialog({ products, onDone, isAr }: { products: ProductOpt[]; onDone: () => void; isAr: boolean }) {
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [colorFilter, setColorFilter] = useState<string>("all");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [busy, setBusy] = useState(false);
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

  const selectedIds = new Set(lines.map((l) => l.product.id));

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return products
      .filter((p) => (onlyInStock ? p.stock_quantity > 0 : true))
      .filter((p) => (collectionFilter === "all" ? true : p.collection === collectionFilter))
      .filter((p) => (colorFilter === "all" ? true : p.color === colorFilter))
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.serial_number ?? "").toLowerCase().includes(s) || (p.color ?? "").toLowerCase().includes(s));
  }, [products, search, collectionFilter, colorFilter, onlyInStock]);

  const addProduct = (p: ProductOpt) => {
    if (selectedIds.has(p.id)) return;
    setLines((ls) => [...ls, {
      key: p.id + ":" + Math.random().toString(36).slice(2, 6),
      product: p,
      itemType: "defective",
      qty: 1,
      reason: REASONS[0],
      serial: p.serial_number ?? "",
      color: p.color ?? "",
      notes: "",
    }]);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const submit = async () => {
    if (lines.length === 0) return toast.error(isAr ? "اختر منتج واحد على الأقل" : "Pick at least one product");
    for (const l of lines) {
      if (l.qty <= 0) return toast.error(isAr ? `كمية غير صحيحة لـ ${l.product.name}` : `Invalid qty for ${l.product.name}`);
      if (l.qty > l.product.stock_quantity) return toast.error(isAr ? `الكمية تتجاوز المخزون لـ ${l.product.name}` : `Qty exceeds stock for ${l.product.name}`);
      if (!l.reason.trim()) return toast.error(isAr ? "السبب مطلوب" : "Reason required");
    }
    setBusy(true);
    try {
      let ok = 0;
      for (const l of lines) {
        const { error } = await (supabase as any).rpc("register_defective_item", {
          _product_id: l.product.id,
          _quantity: l.qty,
          _reason: l.reason,
          _serial_number: l.serial.trim() || null,
          _color: l.color.trim() || null,
          _notes: l.notes.trim() || null,
          _item_type: l.itemType,
        });
        if (error) { toast.error(`${l.product.name}: ${error.message}`); continue; }
        ok++;
      }
      if (ok > 0) toast.success(isAr ? `تم تسجيل ${ok} منتج` : `Registered ${ok} item(s)`);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isAr ? "تسجيل جديد — أكثر من منتج" : "New record — multiple products"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Product picker */}
        <div className="rounded-lg border p-3 space-y-2">
          <Label className="text-sm font-semibold">{isAr ? "اختر المنتجات (انقر للإضافة)" : "Pick products (click to add)"}</Label>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder={isAr ? "ابحث…" : "Search…"} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 h-9" />
            </div>
            <Select value={collectionFilter} onValueChange={setCollectionFilter}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder={isAr ? "الكولكشن" : "Collection"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الكولكشن" : "All"}</SelectItem>
                {collections.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={colorFilter} onValueChange={setColorFilter}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder={isAr ? "اللون" : "Color"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isAr ? "كل الألوان" : "All"}</SelectItem>
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
          <div className="max-h-[260px] overflow-y-auto">
            {visible.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{isAr ? "لا توجد منتجات" : "No products"}</div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {visible.slice(0, 200).map((p) => {
                  const picked = selectedIds.has(p.id);
                  const out = p.stock_quantity <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={out || picked}
                      onClick={() => addProduct(p)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border p-2 text-start transition-all",
                        out ? "opacity-50 cursor-not-allowed" : picked ? "bg-primary/10 border-primary/40" : "hover:bg-muted/50 hover:border-primary/50"
                      )}
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          {p.color && <span className="inline-flex items-center gap-1"><ColorSwatch value={p.color} size="sm" />{p.color}</span>}
                          {p.collection && <span>· {p.collection}</span>}
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
          </div>
        </div>

        {/* Selected lines */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              {isAr ? `المنتجات المختارة (${lines.length})` : `Selected (${lines.length})`}
            </Label>
            {lines.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive" onClick={() => setLines([])}>
                <X className="h-3 w-3" />{isAr ? "مسح الكل" : "Clear all"}
              </Button>
            )}
          </div>
          {lines.length === 0 ? (
            <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              {isAr ? "اختر منتج من القائمة فوق" : "Pick a product above"}
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <Card key={l.key} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                      {l.product.image_url ? <img src={l.product.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-sm truncate">{l.product.name}</div>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeLine(l.key)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div>
                          <Label className="text-[10px]">{isAr ? "النوع" : "Type"}</Label>
                          <Select value={l.itemType} onValueChange={(v: any) => updateLine(l.key, { itemType: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="defective">{isAr ? "تالف" : "Defective"}</SelectItem>
                              <SelectItem value="sample">{isAr ? "عينة" : "Sample"}</SelectItem>
                              <SelectItem value="display">{isAr ? "عرض" : "Display"}</SelectItem>
                              <SelectItem value="loan">{isAr ? "إعارة" : "Loan"}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">{isAr ? "الكمية" : "Qty"}</Label>
                          <Input type="number" min={1} max={l.product.stock_quantity} value={l.qty}
                            onChange={(e) => updateLine(l.key, { qty: Math.max(1, Math.min(l.product.stock_quantity, parseInt(e.target.value) || 1)) })}
                            className="h-8" />
                          <div className="mt-0.5 text-[10px] text-muted-foreground">/ {l.product.stock_quantity}</div>
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[10px]">{isAr ? "السبب" : "Reason"}</Label>
                          <Select value={l.reason} onValueChange={(v) => updateLine(l.key, { reason: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[10px]">{isAr ? "السيريال" : "Serial"}</Label>
                          <Input value={l.serial} onChange={(e) => updateLine(l.key, { serial: e.target.value })} className="h-8" />
                        </div>
                        <div>
                          <Label className="text-[10px]">{isAr ? "اللون" : "Color"}</Label>
                          <Input value={l.color} onChange={(e) => updateLine(l.key, { color: e.target.value })} className="h-8" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-[10px]">{isAr ? "ملاحظات" : "Notes"}</Label>
                          <Input value={l.notes} onChange={(e) => updateLine(l.key, { notes: e.target.value })} className="h-8"
                            placeholder={isAr ? "اختياري…" : "Optional…"} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button onClick={submit} disabled={busy || lines.length === 0} className="gap-2">
          <PackageX className="h-4 w-4" />
          {isAr ? `تسجيل ${lines.length} منتج وخصم من المخزون` : `Register ${lines.length} item(s) & deduct`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ============================================================
// ReturnDialog — single-line back-compat (used by inline button)
// ============================================================
function ReturnDialog({ row, onClose, onDone, isAr }: { row: DefectiveRow; onClose: () => void; onDone: () => void; isAr: boolean }) {
  const remaining = row.quantity - row.returned_quantity;
  const RETURN_REASONS = isAr
    ? ["تم الإصلاح", "العميل أعاد المنتج", "انتهت فترة العرض/المعرض", "رجوع من العينة", "خطأ في التسجيل", "أخرى"]
    : ["Repaired", "Customer returned it", "Display/showroom period ended", "Sample returned", "Logged by mistake", "Other"];
  const [qty, setQty] = useState<number>(remaining);
  const [reasonPreset, setReasonPreset] = useState<string>(RETURN_REASONS[0]);
  const [reasonOther, setReasonOther] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const isOther = reasonPreset === RETURN_REASONS[RETURN_REASONS.length - 1];
  const finalReason = (isOther ? reasonOther : reasonPreset).trim();

  const submit = async () => {
    if (qty <= 0 || qty > remaining) return toast.error(isAr ? "كمية غير صحيحة" : "Invalid quantity");
    if (!finalReason) return toast.error(isAr ? "سبب الإرجاع مطلوب" : "Return reason is required");
    setBusy(true);
    try {
      const combined = notes.trim() ? `${finalReason} — ${notes.trim()}` : finalReason;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // Use the new sample_returns batch (single-item batch) so audit + trigger run consistently
      const { data: header, error: hErr } = await supabase
        .from("sample_returns" as any)
        .insert({ notes: combined, registered_by: user.id, registered_by_email: user.email ?? null })
        .select("id")
        .single();
      if (hErr) throw hErr;
      const { error: iErr } = await supabase
        .from("sample_return_items" as any)
        .insert({ return_id: (header as any).id, defective_item_id: row.id, quantity: qty });
      if (iErr) throw iErr;
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
            <div className="mt-1 text-xs text-muted-foreground">
              {isAr ? `متبقي للإرجاع: ${remaining} من ${row.quantity}` : `${remaining} of ${row.quantity} can be returned`}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {isAr ? "سبب الخصم الأصلي: " : "Original deduction reason: "}
              <span className="font-medium text-foreground">{row.reason}</span>
            </div>
          </div>
          <div>
            <Label className="text-xs">{isAr ? "الكمية المراد إرجاعها" : "Quantity to return"}</Label>
            <Input type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(remaining, parseInt(e.target.value) || 1)))} />
          </div>
          <div>
            <Label className="text-xs">{isAr ? "سبب الإرجاع " : "Return reason "}<span className="text-rose-600">*</span></Label>
            <Select value={reasonPreset} onValueChange={setReasonPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RETURN_REASONS.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
              </SelectContent>
            </Select>
            {isOther && (
              <Input className="mt-2" value={reasonOther} onChange={(e) => setReasonOther(e.target.value)}
                placeholder={isAr ? "اكتب السبب…" : "Type a reason…"} />
            )}
          </div>
          <div>
            <Label className="text-xs">{isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy || !finalReason} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <RotateCcw className="h-4 w-4" />{isAr ? "تأكيد الإرجاع" : "Confirm return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// ReturnReceiptDialog — multi-product return ("محضر استرجاع")
// ============================================================
type ReturnLine = { defective_item_id: string; qty: number; max: number; label: string; row: DefectiveRow };

function ReturnReceiptDialog({
  outstanding, products, onClose, onDone, isAr,
}: {
  outstanding: DefectiveRow[];
  products: ProductOpt[];
  onClose: () => void;
  onDone: () => void;
  isAr: boolean;
}) {
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return outstanding.filter((r) =>
      !s || r.product_name.toLowerCase().includes(s) || (r.serial_number ?? "").toLowerCase().includes(s) || (r.reason ?? "").toLowerCase().includes(s));
  }, [outstanding, search]);

  const selectedIds = new Set(lines.map((l) => l.defective_item_id));

  const addLine = (r: DefectiveRow) => {
    if (selectedIds.has(r.id)) return;
    const max = r.quantity - r.returned_quantity;
    setLines((ls) => [...ls, {
      defective_item_id: r.id,
      qty: max,
      max,
      label: `${r.product_name}${r.serial_number ? " · " + r.serial_number : ""}`,
      row: r,
    }]);
  };
  const updateQty = (id: string, q: number) =>
    setLines((ls) => ls.map((l) => l.defective_item_id === id ? { ...l, qty: Math.max(1, Math.min(l.max, q || 1)) } : l));
  const removeLine = (id: string) =>
    setLines((ls) => ls.filter((l) => l.defective_item_id !== id));

  const submit = async () => {
    if (lines.length === 0) return toast.error(isAr ? "اختر سجل واحد على الأقل" : "Pick at least one record");
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: header, error: hErr } = await supabase
        .from("sample_returns" as any)
        .insert({
          notes: notes.trim() || null,
          registered_by: user.id,
          registered_by_email: user.email ?? null,
        })
        .select("id")
        .single();
      if (hErr) throw hErr;
      const headerId = (header as any).id as string;
      const payload = lines.map((l) => ({ return_id: headerId, defective_item_id: l.defective_item_id, quantity: l.qty }));
      const { error: iErr } = await supabase.from("sample_return_items" as any).insert(payload);
      if (iErr) throw iErr;
      toast.success(isAr ? `تم إنشاء محضر استرجاع لـ ${lines.length} سجل` : `Return receipt created for ${lines.length} item(s)`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-emerald-600" />
            {isAr ? "محضر استرجاع — أكثر من منتج" : "Return receipt — multiple items"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-emerald-700" />
              <span>{isAr ? "أي مستخدم في الفريق يقدر يفتح محضر استرجاع. كل القرارات لحظية." : "Any team member can open a return receipt. All updates are live."}</span>
            </div>
          </Card>

          <div className="rounded-lg border p-3 space-y-2">
            <Label className="text-sm font-semibold">{isAr ? "اختر السجلات (يظهر فقط ما لم يرجع بالكامل)" : "Pick records (only items still out)"}</Label>
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9 h-9"
                placeholder={isAr ? "ابحث بالاسم/السيريال/السبب…" : "Search…"} />
            </div>
            <div className="max-h-[260px] overflow-y-auto space-y-1.5">
              {visible.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{isAr ? "لا توجد سجلات قابلة للإرجاع" : "No outstanding records"}</div>
              ) : visible.map((r) => {
                const picked = selectedIds.has(r.id);
                const max = r.quantity - r.returned_quantity;
                const product = products.find((p) => p.id === r.product_id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addLine(r)}
                    disabled={picked}
                    className={cn("w-full flex items-center gap-2 rounded-md border p-2 text-start transition",
                      picked ? "bg-primary/10 border-primary/40 cursor-default" : "hover:bg-muted/50")}>
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted/30 flex items-center justify-center">
                      {product?.image_url ? <img src={product.image_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.product_name}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {typeBadge((r.item_type ?? "defective") as ItemType, isAr)}
                        {r.serial_number && <span className="font-mono">{r.serial_number}</span>}
                        <span>· {isAr ? "السبب:" : "Reason:"} {r.reason}</span>
                      </div>
                    </div>
                    <div className="shrink-0 rounded bg-amber-500/10 px-2 py-1 text-xs font-bold tabular-nums text-amber-700">
                      {max}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">
              {isAr ? `سجلات المحضر (${lines.length})` : `Receipt lines (${lines.length})`}
            </Label>
            {lines.length === 0 ? (
              <div className="mt-1 rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                {isAr ? "اختر سجل من القائمة فوق" : "Pick records above"}
              </div>
            ) : (
              <div className="mt-1 space-y-1.5">
                {lines.map((l) => (
                  <div key={l.defective_item_id} className="flex items-center gap-2 rounded-md border p-2">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium truncate">{l.label}</div>
                      <div className="text-[11px] text-muted-foreground">{isAr ? "المتاح للإرجاع:" : "Available:"} {l.max}</div>
                    </div>
                    <Input type="number" min={1} max={l.max} value={l.qty}
                      onChange={(e) => updateQty(l.defective_item_id, parseInt(e.target.value))}
                      className="h-8 w-20 tabular-nums" />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLine(l.defective_item_id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">{isAr ? "ملاحظات المحضر (اختياري)" : "Receipt notes (optional)"}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={isAr ? "سبب الاسترجاع، اسم العميل، …" : "Reason, customer name, …"} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy || lines.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <FileCheck2 className="h-4 w-4" />
            {isAr ? `إنشاء المحضر (${lines.length})` : `Create receipt (${lines.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { QRCodeCanvas } from "qrcode.react";
import { motion } from "framer-motion";
import { Search, ArrowLeft, Download, Copy, Pencil, ImagePlus, Loader2, Sparkles, History, Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  listPriceItems, getCachedPriceItems, createPriceItem,
  updatePriceItemPrice, uploadPriceItemImage, updatePriceItemImage,
  getPriceHistory, formatPrice, type PriceListItem, type PriceHistoryEntry,
} from "@/lib/price-list";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/lib/use-role";
import brandLogo from "@/assets/steinheim-logo-white.png";

export const Route = createFileRoute("/qr-price-list")({
  component: PriceListPage,
  head: () => ({
    meta: [
      { title: "QR Price List 2026 — Steinheim" },
      { name: "description", content: "Steinheim official 2026 price list — Joy, Up, Art, Quatro mixers, showers, and accessories. Scan QR to add to invoice." },
    ],
  }),
});

const COLLECTIONS = ["ALL", "JOY", "UP", "ART", "QUATRO"] as const;
type CollectionFilter = (typeof COLLECTIONS)[number];

function PriceListPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  // Seed from cache so the page renders instantly even offline.
  const [items, setItems] = useState<PriceListItem[]>(() => getCachedPriceItems());
  const [loading, setLoading] = useState(() => getCachedPriceItems().length === 0);
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState<CollectionFilter>("ALL");
  const [category, setCategory] = useState<string>("ALL");
  const [colorFilter, setColorFilter] = useState<string>("ALL");
  const [editItem, setEditItem] = useState<PriceListItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const onOff = () => setOffline(!navigator.onLine);
    onOff();
    window.addEventListener("online", onOff);
    window.addEventListener("offline", onOff);

    listPriceItems()
      .then((rows) => { if (mounted) setItems(rows); })
      .catch((e) => {
        // If cache exists we already rendered — don't block the UI.
        if (getCachedPriceItems().length === 0) {
          toast.error(e?.message ?? "Failed to load");
        }
      })
      .finally(() => { if (mounted) setLoading(false); });

    const channel = supabase
      .channel("price_list_items_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "price_list_items" },
        () => { listPriceItems().then(setItems).catch(() => {}); },
      )
      .subscribe();

    return () => {
      mounted = false;
      window.removeEventListener("online", onOff);
      window.removeEventListener("offline", onOff);
      supabase.removeChannel(channel);
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category));
    return ["ALL", ...Array.from(set).sort()];
  }, [items]);

  // Distinct colors across the active dataset, with their hex for the swatch.
  const colors = useMemo(() => {
    const map = new Map<string, string | null>();
    items.forEach((i) => {
      if (i.color) {
        if (!map.has(i.color)) map.set(i.color, i.color_hex ?? null);
      }
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (collection !== "ALL" && i.collection !== collection) return false;
      if (category !== "ALL" && i.category !== category) return false;
      if (colorFilter !== "ALL" && (i.color ?? "") !== colorFilter) return false;
      if (!q) return true;
      return (
        i.sku.toLowerCase().includes(q) ||
        i.name_en.toLowerCase().includes(q) ||
        (i.name_ar ?? "").toLowerCase().includes(q) ||
        (i.color ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, collection, category, colorFilter]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[oklch(0.08_0.005_60)] text-[oklch(0.97_0.008_82)]">
      {/* Decorative gradient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[oklch(0.78_0.11_82_/_0.15)] blur-3xl" />
        <div className="absolute top-1/2 -left-32 h-96 w-96 rounded-full bg-[oklch(0.4_0.05_240_/_0.2)] blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[oklch(0.1_0.004_60_/_0.6)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            to={user ? "/dashboard" : "/auth"}
            className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-[oklch(0.78_0.11_82)]"
          >
            <ArrowLeft className="h-4 w-4" />
            {user ? "Dashboard" : "Back to Sign In"}
          </Link>
          <img src={brandLogo} alt="Steinheim" className="h-10 w-auto" />
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pt-12 pb-8 text-center sm:px-6 sm:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.11_82_/_0.3)] bg-[oklch(0.78_0.11_82_/_0.08)] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.3em] text-[oklch(0.78_0.11_82)]">
            <Sparkles className="h-3 w-3" />
            Steinheim · 2026
          </div>
          <h1 className="mt-6 text-4xl font-light tracking-tight sm:text-6xl">
            <span className="bg-gradient-to-r from-[oklch(0.95_0.04_82)] via-[oklch(0.78_0.11_82)] to-[oklch(0.65_0.12_82)] bg-clip-text text-transparent">
              QR Price List
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/60 sm:text-base">
            Defined Precision · Designed for Modern Spaces · امسح الـ QR لتُضاف للفاتورة فوراً
          </p>
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-white/40">
            <span>{items.length} منتج</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>4 كولكشن</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>{filtered.length} يطابق البحث</span>
          </div>
        </motion.div>
      </section>

      {/* Filters */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-8 sm:px-6">
        <div className="rounded-2xl border border-white/10 bg-[oklch(0.12_0.005_60_/_0.6)] p-4 backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالكود أو الاسم أو اللون..."
                className="border-white/10 bg-white/5 pl-10 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
              />
            </div>
            <Tabs value={collection} onValueChange={(v) => setCollection(v as CollectionFilter)}>
              <TabsList className="flex w-full flex-wrap gap-1 bg-white/5">
                {COLLECTIONS.map((c) => (
                  <TabsTrigger
                    key={c}
                    value={c}
                    className="flex-1 data-[state=active]:bg-[oklch(0.78_0.11_82)] data-[state=active]:text-[oklch(0.1_0.004_60)]"
                  >
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    category === c
                      ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)]"
                      : "border border-white/15 bg-white/5 text-white/70 hover:border-[oklch(0.78_0.11_82_/_0.5)] hover:text-white"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {/* Color filter pills */}
            {colors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-widest text-white/40">اللون</span>
                <button
                  onClick={() => setColorFilter("ALL")}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    colorFilter === "ALL"
                      ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)]"
                      : "border border-white/15 bg-white/5 text-white/70 hover:text-white"
                  }`}
                >
                  الكل
                </button>
                {colors.map(([name, hex]) => (
                  <button
                    key={name}
                    onClick={() => setColorFilter(name)}
                    title={name}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      colorFilter === name
                        ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)]"
                        : "border border-white/15 bg-white/5 text-white/70 hover:text-white"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-white/30"
                      style={{ backgroundColor: hex ?? "#888" }}
                    />
                    {name}
                  </button>
                ))}
              </div>
            )}
            {isAdmin && (
              <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
                {offline ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-300/80">
                    <WifiOff className="h-3 w-3" /> offline · يعمل من الكاش
                  </span>
                ) : <span />}
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]"
                >
                  <Plus className="mr-1 h-3 w-3" /> إضافة منتج
                </Button>
              </div>
            )}
            {!isAdmin && offline && (
              <div className="border-t border-white/5 pt-3 text-xs text-amber-300/80">
                <WifiOff className="mr-1 inline h-3 w-3" /> offline — معروض من الكاش
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.78_0.11_82)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/50">
            لا توجد منتجات مطابقة
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item, idx) => (
              <ProductCard
                key={item.id}
                item={item}
                index={idx}
                canEdit={isAdmin}
                onEdit={() => setEditItem(item)}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="relative z-10 border-t border-white/5 bg-[oklch(0.06_0.003_60)] py-6 text-center text-xs text-white/40">
        © Steinheim · A Brand by El-Sharbatly International Group
      </footer>

      {editItem && (
        <EditDialog
          item={editItem}
          userEmail={user?.email ?? null}
          onClose={() => setEditItem(null)}
        />
      )}
      {addOpen && (
        <AddDialog
          onClose={() => setAddOpen(false)}
          onCreated={(it) => { setItems((prev) => [...prev, it]); setAddOpen(false); }}
        />
      )}
    </div>
  );
}

function AddDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (i: PriceListItem) => void }) {
  const [form, setForm] = useState({
    sku: "", name_en: "", collection: "JOY", category: "",
    color: "", color_hex: "#c8c8c8", price: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.sku.trim() || !form.name_en.trim() || !form.category.trim() || !form.price) {
      toast.error("SKU، الاسم، الفئة، والسعر مطلوبين");
      return;
    }
    setSaving(true);
    try {
      const created = await createPriceItem({
        sku: form.sku.trim(),
        name_en: form.name_en.trim(),
        collection: form.collection,
        category: form.category.trim(),
        color: form.color.trim() || null,
        color_hex: form.color_hex || null,
        price: Number(form.price),
      });
      toast.success("تمت إضافة المنتج");
      onCreated(created);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الإضافة");
    } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-[oklch(0.12_0.005_60)] text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.08_82)]">منتج جديد</DialogTitle>
          <DialogDescription className="text-white/60">سيُولَّد QR تلقائياً بصيغة PL1:SKU</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-white/80 text-xs">SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="mt-1 border-white/15 bg-white/5 text-white" /></div>
            <div><Label className="text-white/80 text-xs">Collection</Label>
              <select value={form.collection} onChange={(e) => setForm({ ...form, collection: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-white/15 bg-white/5 px-2 text-sm text-white">
                {["JOY","UP","ART","QUATRO"].map((c) => <option key={c} value={c} className="bg-[oklch(0.12_0.005_60)]">{c}</option>)}
              </select></div>
          </div>
          <div><Label className="text-white/80 text-xs">الاسم (EN)</Label>
            <Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="mt-1 border-white/15 bg-white/5 text-white" /></div>
          <div><Label className="text-white/80 text-xs">الفئة</Label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="JOY BASIN MIXERS" className="mt-1 border-white/15 bg-white/5 text-white" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><Label className="text-white/80 text-xs">اللون</Label>
              <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="CHROME PLATED" className="mt-1 border-white/15 bg-white/5 text-white" /></div>
            <div><Label className="text-white/80 text-xs">Hex</Label>
              <Input type="color" value={form.color_hex} onChange={(e) => setForm({ ...form, color_hex: e.target.value })} className="mt-1 h-9 border-white/15 bg-white/5" /></div>
          </div>
          <div><Label className="text-white/80 text-xs">السعر (LE)</Label>
            <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1 border-white/15 bg-white/5 text-white" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-white/5 text-white">إلغاء</Button>
          <Button disabled={saving} onClick={submit} className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({
  item, index, canEdit, onEdit,
}: { item: PriceListItem; index: number; canEdit: boolean; onEdit: () => void }) {
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const downloadQR = () => {
    const canvas = qrRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.sku}-qr.png`;
    a.click();
  };

  const copyQR = async () => {
    try {
      await navigator.clipboard.writeText(item.qr_payload);
      toast.success("تم نسخ الـ QR payload");
    } catch {
      toast.error("فشل النسخ");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.02, 0.6) }}
      whileHover={{ y: -4 }}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[oklch(0.13_0.005_60_/_0.9)] to-[oklch(0.1_0.004_60_/_0.95)] backdrop-blur-xl transition-shadow hover:border-[oklch(0.78_0.11_82_/_0.4)] hover:shadow-[0_20px_60px_-20px_oklch(0.78_0.11_82_/_0.3)]"
      style={{ animationDelay: `${index * 20}ms` }}
    >
      {/* Collection ribbon */}
      <div className="absolute right-0 top-0 z-10 rounded-bl-xl bg-[oklch(0.78_0.11_82)] px-3 py-1 text-[10px] font-bold tracking-widest text-[oklch(0.1_0.004_60)]">
        {item.collection}
      </div>

      {/* Image area */}
      <div className="relative flex h-48 items-center justify-center overflow-hidden bg-[oklch(0.06_0.003_60)]">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name_en}
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center text-white/20">
            <ImagePlus className="h-12 w-12" />
            <span className="mt-2 text-xs">لا توجد صورة</span>
          </div>
        )}
        {item.color_hex && (
          <div
            className="absolute bottom-3 left-3 h-6 w-6 rounded-full border-2 border-white/30 shadow-lg"
            style={{ backgroundColor: item.color_hex }}
            title={item.color ?? ""}
          />
        )}
      </div>

      {/* Body */}
      <div className="space-y-3 p-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-[oklch(0.78_0.11_82)]">
            {item.category}
          </div>
          <h3 className="mt-1 line-clamp-2 text-sm font-medium text-white">
            {item.name_en}
          </h3>
          <div className="mt-1 font-mono text-[11px] text-white/40">{item.sku}</div>
          {item.color && (
            <div className="mt-1 text-[11px] text-white/60">{item.color}</div>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Price</div>
            <div className="text-2xl font-light text-[oklch(0.92_0.08_82)]">
              {formatPrice(item.price, item.currency)}
            </div>
          </div>
          <div className="rounded-lg bg-white p-1.5">
            <QRCodeCanvas
              ref={qrRef}
              value={item.qr_payload}
              size={56}
              level="M"
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
            onClick={copyQR}
          >
            <Copy className="mr-1 h-3 w-3" /> نسخ
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
            onClick={downloadQR}
          >
            <Download className="mr-1 h-3 w-3" /> QR
          </Button>
          {canEdit && (
            <Button
              size="sm"
              className="bg-[oklch(0.78_0.11_82)] text-xs text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]"
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function EditDialog({
  item, userEmail, onClose,
}: { item: PriceListItem; userEmail: string | null; onClose: () => void }) {
  const [price, setPrice] = useState(String(item.price));
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [history, setHistory] = useState<PriceHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    getPriceHistory(item.id).then(setHistory).catch(() => {});
  }, [item.id]);

  const handleSave = async () => {
    const next = Number(price);
    if (!Number.isFinite(next) || next < 0) {
      toast.error("سعر غير صحيح");
      return;
    }
    setSaving(true);
    try {
      if (imageFile) {
        const url = await uploadPriceItemImage(item.sku, imageFile);
        await updatePriceItemImage(item.id, url);
      }
      if (next !== item.price) {
        await updatePriceItemPrice(item.id, next, userEmail);
      }
      toast.success("تم الحفظ");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-[oklch(0.12_0.005_60)] text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.08_82)]">
            تعديل: {item.sku}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {item.name_en} · {item.color}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-white/80">السعر ({item.currency})</Label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
          <div>
            <Label className="text-white/80">صورة المنتج (اختياري)</Label>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              className="mt-1 border-white/15 bg-white/5 text-white file:text-white/70"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:text-white"
          >
            <span className="inline-flex items-center gap-2"><History className="h-3 w-3" /> سجل الأسعار ({history.length})</span>
            <span>{showHistory ? "إخفاء" : "عرض"}</span>
          </button>
          {showHistory && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 text-xs">
              {history.length === 0 ? (
                <div className="py-3 text-center text-white/40">لا توجد تغييرات</div>
              ) : history.map((h) => (
                <div key={h.id} className="flex items-center justify-between border-b border-white/5 py-1 last:border-0">
                  <span className="text-white/60">
                    {Number(h.old_price ?? 0).toLocaleString()} → {Number(h.new_price ?? 0).toLocaleString()}
                  </span>
                  <span className="text-white/40">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-transparent text-white">إلغاء</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

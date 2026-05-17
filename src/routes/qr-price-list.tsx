import { useEffect, useMemo, useState, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { QRCodeCanvas } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ArrowLeft, Download, Copy, Pencil, ImagePlus, Loader2,
  Sparkles, History, Plus, WifiOff, LogIn, ShoppingCart, Trash2, FileText, X, Minus, Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRole } from "@/lib/use-role";
import { useI18n } from "@/lib/i18n";
import { encodeProductQR } from "@/lib/qr-codec";
import { swatchStyle } from "@/lib/color-swatch";
import { ProductImageUpload } from "@/components/product-image-upload";
import type { Product } from "@/lib/data";
import { COLLECTIONS as APP_COLLECTIONS } from "@/lib/data";
import { fmtMoney } from "@/lib/utils-money";
import brandLogo from "@/assets/steinheim-logo-white.png";

export const Route = createFileRoute("/qr-price-list")({
  component: PriceListPage,
  head: () => ({
    meta: [
      { title: "QR Price List 2026 — Steinheim" },
      { name: "description", content: "Steinheim official 2026 catalog — scan QR to add any product to the current invoice." },
    ],
  }),
});

const COLLECTION_TABS = ["ALL", ...APP_COLLECTIONS] as const;
type CollectionFilter = (typeof COLLECTION_TABS)[number];

const CACHE_KEY = "qr_price_list_products_v1";

const readCache = (): Product[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Product[]) : [];
  } catch { return []; }
};
const writeCache = (items: Product[]) => {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
};

function PriceListPage() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const navigate = useNavigate();
  const { lang, setLang, dir } = useI18n();
  const isAr = lang === "ar";
  const tt = (ar: string, en: string) => (isAr ? ar : en);

  // CRITICAL: SSR-safe — start empty, hydrate cache after mount to avoid hydration mismatch.
  const [items, setItems] = useState<Product[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState<CollectionFilter>("ALL");
  const [colorFilter, setColorFilter] = useState<string>("ALL");
  const [editItem, setEditItem] = useState<Product | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);

  // Public page — no auth redirect. Anyone can browse; only admins can edit.

  // Hydrate from cache on mount (avoids SSR/CSR text mismatch on the counter).
  useEffect(() => {
    const cached = readCache();
    if (cached.length) setItems(cached);
    setHydrated(true);
  }, []);

  // Live load + realtime + online state — works for anon and authenticated users.
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const { data, error } = await supabase.rpc("get_public_price_list");
        if (error) throw error;
        if (!mounted) return;
        const rows = (data ?? []) as Product[];
        setItems(rows);
        writeCache(rows);
      } catch (e: any) {
        if (readCache().length === 0) toast.error(e?.message ?? "Failed to load");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    const onOff = () => setOffline(!navigator.onLine);
    onOff();
    window.addEventListener("online", onOff);
    window.addEventListener("offline", onOff);

    const channel = supabase
      .channel("qr_price_list_products")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => load())
      .subscribe();

    return () => {
      mounted = false;
      window.removeEventListener("online", onOff);
      window.removeEventListener("offline", onOff);
      supabase.removeChannel(channel);
    };
  }, []);

  // Distinct colors for the color-filter pills.
  const colors = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.color) set.add(i.color); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (collection !== "ALL" && (i.collection ?? "") !== collection) return false;
      if (colorFilter !== "ALL" && (i.color ?? "") !== colorFilter) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.serial_number ?? "").toLowerCase().includes(q) ||
        (i.color ?? "").toLowerCase().includes(q) ||
        (i.collection ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, collection, colorFilter]);

  // Only show counts AFTER hydration to avoid mismatch with empty SSR markup.
  const count = hydrated ? items.length : 0;
  const matchCount = hydrated ? filtered.length : 0;

  return (
    <div dir={dir} className="relative min-h-screen overflow-hidden bg-[oklch(0.08_0.005_60)] text-[oklch(0.97_0.008_82)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[oklch(0.78_0.11_82_/_0.15)] blur-3xl" />
        <div className="absolute top-1/2 -left-32 h-96 w-96 rounded-full bg-[oklch(0.4_0.05_240_/_0.2)] blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/5 bg-[oklch(0.1_0.004_60_/_0.6)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-5 sm:px-6 sm:py-6" dir="ltr">
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-[oklch(0.78_0.11_82)]"
              >
                <ArrowLeft className="h-4 w-4" />
                {tt("لوحة التحكم", "Dashboard")}
              </Link>
            ) : (
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.11_82_/_0.4)] bg-[oklch(0.78_0.11_82_/_0.1)] px-4 py-2 text-sm font-medium text-[oklch(0.92_0.08_82)] transition hover:bg-[oklch(0.78_0.11_82_/_0.2)]"
              >
                <LogIn className="h-4 w-4" />
                {tt("تسجيل الدخول", "Sign In")}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setLang(isAr ? "en" : "ar")}
              title={tt("English", "العربية")}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
              aria-label="toggle language"
            >
              <Languages className="h-3.5 w-3.5 text-[oklch(0.78_0.11_82)]" />
              <span>{isAr ? "EN" : "ع"}</span>
            </button>
          </div>
          <img src={brandLogo} alt="Steinheim" className="h-16 w-auto sm:h-20" />
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-4 pt-12 pb-8 text-center sm:px-6 sm:pt-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.11_82_/_0.3)] bg-[oklch(0.78_0.11_82_/_0.08)] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.3em] text-[oklch(0.78_0.11_82)]">
            <Sparkles className="h-3 w-3" />
            Steinheim · 2026
          </div>
          <h1 className="mt-6 text-4xl font-light tracking-tight sm:text-6xl">
            <span className="bg-gradient-to-r from-[oklch(0.95_0.04_82)] via-[oklch(0.78_0.11_82)] to-[oklch(0.65_0.12_82)] bg-clip-text text-transparent">
              {tt("قائمة الأسعار", "QR Price List")}
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/60 sm:text-base">
            {tt(
              "امسح الـ QR لأى منتج ليُضاف للفاتورة الحالية فوراً",
              "Scan any product's QR to instantly add it to the current invoice",
            )}
          </p>
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-white/40">
            <span>{count} {tt("منتج", "products")}</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>4 {tt("كولكشن", "collections")}</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <span>{matchCount} {tt("يطابق البحث", "matches")}</span>
          </div>
        </motion.div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-8 sm:px-6">
        <div className="rounded-2xl border border-white/10 bg-[oklch(0.12_0.005_60_/_0.6)] p-4 backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tt("ابحث بالاسم أو السيريال أو اللون...", "Search by name, serial, or color...")}
                className="border-white/10 bg-white/5 pl-10 text-white placeholder:text-white/40 focus-visible:ring-[oklch(0.78_0.11_82)]"
              />
            </div>
            <Tabs value={collection} onValueChange={(v) => setCollection(v as CollectionFilter)}>
              <TabsList className="flex w-full flex-wrap gap-1 bg-white/5">
                {COLLECTION_TABS.map((c) => (
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

            {colors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-widest text-white/40">{tt("اللون", "Color")}</span>
                <button
                  onClick={() => setColorFilter("ALL")}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    colorFilter === "ALL"
                      ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)]"
                      : "border border-white/15 bg-white/5 text-white/70 hover:text-white"
                  }`}
                >
                  {tt("الكل", "All")}
                </button>
                {colors.map((name) => (
                  <button
                    key={name}
                    onClick={() => setColorFilter(name)}
                    title={name}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      colorFilter === name
                        ? "bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)]"
                        : "border border-white/15 bg-white/5 text-white/70 hover:text-white"
                    }`}
                  >
                    <span
                      className="h-5 w-5 rounded-md ring-1 ring-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(0,0,0,0.25)]"
                      style={swatchStyle(name)}
                    />
                    <span dir="auto">{name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
              {offline ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-300/80">
                  <WifiOff className="h-3 w-3" /> {tt("غير متصل · يعمل من الكاش", "Offline · using cache")}
                </span>
              ) : <span />}
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]"
                >
                  <Plus className="mr-1 h-3 w-3" /> {tt("إضافة منتج", "Add product")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[oklch(0.78_0.11_82)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/50">
            {tt("لا توجد منتجات مطابقة", "No matching products")}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((item, idx) => (
              <ProductCard
                key={item.id}
                item={item}
                index={idx}
                canEdit={isAdmin}
                eager={idx < 8}
                canAddToInvoice={!!user}
                inCart={cart[item.id] ?? 0}
                lang={lang}
                onEdit={() => setEditItem(item)}
                onAdd={() => setCart((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1 }))}
              />
            ))}
          </div>
        )}
      </section>

      {/* Floating cart bar — appears for signed-in users with items */}
      <AnimatePresence>
        {user && Object.keys(cart).length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2"
          >
            <button
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-3 rounded-full bg-[oklch(0.78_0.11_82)] px-5 py-3 text-sm font-semibold text-[oklch(0.1_0.004_60)] shadow-[0_20px_60px_-10px_oklch(0.78_0.11_82_/_0.6)] transition hover:bg-[oklch(0.84_0.1_82)]"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>{tt("السلة", "Cart")} ({Object.values(cart).reduce((a, b) => a + b, 0)})</span>
              <span className="rounded-full bg-black/15 px-2 py-0.5 text-xs">{tt("إنشاء فاتورة", "Create invoice")}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
      {addOpen && user && (
        <AddDialog
          userId={user.id}
          userEmail={user.email ?? null}
          onClose={() => setAddOpen(false)}
        />
      )}
      {cartOpen && user && (
        <CartDialog
          items={items}
          cart={cart}
          onClose={() => setCartOpen(false)}
          onChange={setCart}
          onCheckout={() => {
            // Build draft for the invoice builder and navigate.
            const draftItems = Object.entries(cart)
              .map(([pid, qty]) => {
                const p = items.find((x) => x.id === pid);
                if (!p || qty <= 0) return null;
                return {
                  product_id: p.id,
                  product_name: p.name,
                  serial_number: p.serial_number ?? "",
                  color: p.color ?? "",
                  quantity: qty,
                  unit_price: Number(p.price) || 0,
                  discount: 0,
                  discount_mode: "percent",
                  discount_percent: 0,
                };
              })
              .filter(Boolean);
            try {
              localStorage.setItem(
                "invoice_draft_v1",
                JSON.stringify({
                  customerId: "",
                  items: draftItems,
                  discount: 0,
                  notes: "",
                  savedAt: new Date().toISOString(),
                }),
              );
            } catch {}
            setCart({});
            setCartOpen(false);
            navigate({ to: "/invoices/new", search: { draft: true } as any });
          }}
        />
      )}
    </div>
  );
}

function ProductCard({
  item, index, canEdit, eager, canAddToInvoice, inCart, onEdit, onAdd,
}: {
  item: Product;
  index: number;
  canEdit: boolean;
  eager?: boolean;
  canAddToInvoice?: boolean;
  inCart?: number;
  onEdit: () => void;
  onAdd?: () => void;
}) {
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const qrValue = useMemo(() => encodeProductQR(item.qr_code || item.id), [item.qr_code, item.id]);

  const downloadQR = () => {
    const canvas = qrRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(item.serial_number || item.name).replace(/[^\w-]+/g, "_")}-qr.png`;
    a.click();
  };

  const copyQR = async () => {
    try {
      await navigator.clipboard.writeText(qrValue);
      toast.success("تم نسخ الـ QR");
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
    >
      {item.collection && (
        <div className="absolute right-0 top-0 z-10 rounded-bl-xl bg-[oklch(0.78_0.11_82)] px-3 py-1 text-[10px] font-bold tracking-widest text-[oklch(0.1_0.004_60)]">
          {item.collection}
        </div>
      )}

      <div className="relative flex h-48 items-center justify-center overflow-hidden bg-gradient-to-br from-white/[0.04] to-white/[0.02]">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            // @ts-expect-error: standard browser attr not yet typed
            fetchpriority={eager ? "high" : "auto"}
          />
        ) : (
          <div className="flex flex-col items-center text-white/20">
            <ImagePlus className="h-12 w-12" />
            <span className="mt-2 text-xs">لا توجد صورة</span>
          </div>
        )}
        {item.color && (
          <div
            className="absolute bottom-3 left-3 h-7 w-7 rounded-full border-2 border-white/30 shadow-lg"
            style={swatchStyle(item.color)}
            title={item.color}
          />
        )}
      </div>

      <div className="space-y-3 p-4" dir="rtl">
        <div>
          <h3 className="line-clamp-2 text-sm font-medium text-white" dir="auto">{item.name}</h3>
          {item.serial_number && (
            <div className="mt-1 font-mono text-[11px] text-white/40" dir="ltr">{item.serial_number}</div>
          )}
          {item.color && (
            <div className="mt-1 text-[11px] text-white/60" dir="auto">{item.color}</div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40" dir="ltr">Price</div>
          <div className="text-2xl font-light text-[oklch(0.92_0.08_82)]">
            {fmtMoney(Number(item.price) || 0, "EGP", "ar")}
          </div>
        </div>
        <div className="flex justify-center">
          <div className="rounded-xl bg-white p-3 shadow-lg">
            <QRCodeCanvas
              ref={qrRef}
              value={qrValue}
              size={140}
              level="M"
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
          </div>
        </div>

        {canAddToInvoice && onAdd && (
          <Button
            size="sm"
            onClick={onAdd}
            className="w-full bg-[oklch(0.78_0.11_82)] text-xs font-semibold text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]"
          >
            <Plus className="ml-1 h-3 w-3" />
            {inCart && inCart > 0 ? `في السلة (${inCart}) · أضف` : "أضف للفاتورة"}
          </Button>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm" variant="outline"
            className="flex-1 border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
            onClick={copyQR}
          >
            <Copy className="ml-1 h-3 w-3" /> نسخ
          </Button>
          <Button
            size="sm" variant="outline"
            className="flex-1 border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
            onClick={downloadQR}
          >
            <Download className="ml-1 h-3 w-3" /> QR
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

// --- Cart dialog for signed-in users -------------------------------------
function CartDialog({
  items, cart, onClose, onChange, onCheckout,
}: {
  items: Product[];
  cart: Record<string, number>;
  onClose: () => void;
  onChange: (next: Record<string, number>) => void;
  onCheckout: () => void;
}) {
  const rows = Object.entries(cart)
    .map(([pid, qty]) => ({ p: items.find((x) => x.id === pid), qty }))
    .filter((r) => r.p && r.qty > 0) as { p: Product; qty: number }[];
  const total = rows.reduce((s, r) => s + Number(r.p.price ?? 0) * r.qty, 0);

  const setQty = (pid: string, qty: number) => {
    const next = { ...cart };
    if (qty <= 0) delete next[pid]; else next[pid] = qty;
    onChange(next);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-lg bg-[oklch(0.12_0.005_60)] text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.08_82)]">السلة ({rows.length})</DialogTitle>
          <DialogDescription className="text-white/60">
            راجع المنتجات ثم اضغط "إنشاء فاتورة" لإكمالها في حسابك.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-white/40">السلة فارغة</div>
          ) : rows.map(({ p, qty }) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-2.5">
              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-white/5">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-full w-full object-contain" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20"><ImagePlus className="h-5 w-5" /></div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm" dir="auto">{p.name}</div>
                <div className="text-[11px] text-white/50" dir="ltr">{p.serial_number ?? ""}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7 border-white/10 bg-white/5" onClick={() => setQty(p.id, qty - 1)}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center text-sm">{qty}</span>
                <Button size="icon" variant="outline" className="h-7 w-7 border-white/10 bg-white/5" onClick={() => setQty(p.id, qty + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-300 hover:bg-rose-500/10" onClick={() => setQty(p.id, 0)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="w-20 text-end text-sm text-[oklch(0.92_0.08_82)]">
                {fmtMoney(Number(p.price ?? 0) * qty, "EGP", "ar")}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-sm">
          <span className="text-white/60">الإجمالي</span>
          <span className="text-lg font-semibold text-[oklch(0.92_0.08_82)]">{fmtMoney(total, "EGP", "ar")}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-transparent text-white">
            <X className="ml-1 h-3 w-3" /> إغلاق
          </Button>
          <Button disabled={rows.length === 0} onClick={onCheckout}
            className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]">
            <FileText className="ml-1 h-4 w-4" /> إنشاء فاتورة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit dialog (price + image) ------------------------------------------
function EditDialog({
  item, userEmail, onClose,
}: { item: Product; userEmail: string | null; onClose: () => void }) {
  const [price, setPrice] = useState(String(item.price));
  const [imageUrl, setImageUrl] = useState<string | null>(item.image_url ?? null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Array<{ id: string; old_value: number | null; new_value: number | null; changed_at: string; changed_by_email: string | null }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    supabase
      .from("product_price_history")
      .select("id,old_value,new_value,changed_at,changed_by_email")
      .eq("product_id", item.id).eq("field", "price")
      .order("changed_at", { ascending: false }).limit(50)
      .then(({ data }) => setHistory((data ?? []) as any));
  }, [item.id]);

  const save = async () => {
    const next = Number(price);
    if (!Number.isFinite(next) || next < 0) {
      toast.error("سعر غير صحيح");
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, any> = {};
      if (next !== Number(item.price)) patch.price = next;
      if (imageUrl !== (item.image_url ?? null)) patch.image_url = imageUrl;
      if (Object.keys(patch).length === 0) { onClose(); return; }
      patch.updated_by_email = userEmail;
      const { error } = await supabase.from("products").update(patch as any).eq("id", item.id);
      if (error) throw error;
      toast.success("تم الحفظ");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الحفظ");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-[oklch(0.12_0.005_60)] text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.08_82)]">{item.name}</DialogTitle>
          <DialogDescription className="text-white/60">
            {[item.serial_number, item.color, item.collection].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-white/80">السعر (EGP)</Label>
            <Input
              type="number" value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 border-white/15 bg-white/5 text-white"
            />
          </div>
          <div>
            <Label className="text-white/80">صورة المنتج</Label>
            <div className="mt-2"><ProductImageUpload value={imageUrl} onChange={setImageUrl} /></div>
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
                    {Number(h.old_value ?? 0).toLocaleString()} → {Number(h.new_value ?? 0).toLocaleString()}
                  </span>
                  <span className="text-white/40">{new Date(h.changed_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-transparent text-white">إلغاء</Button>
          <Button onClick={save} disabled={saving}
            className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Add product dialog ---------------------------------------------------
function AddDialog({
  userId, userEmail, onClose,
}: { userId: string; userEmail: string | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: "", serial_number: "", color: "",
    collection: "JOY" as string,
    price: "", stock_quantity: "0",
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.price) {
      toast.error("الاسم والسعر مطلوبين");
      return;
    }
    setSaving(true);
    try {
      const insertRow = {
        user_id: userId,
        name: form.name.trim(),
        serial_number: form.serial_number.trim() || null,
        color: form.color.trim() || null,
        collection: form.collection || null,
        price: Number(form.price),
        stock_quantity: Number(form.stock_quantity) || 0,
        image_url: imageUrl,
        created_by_email: userEmail,
        updated_by_email: userEmail,
      };
      const { data, error } = await supabase
        .from("products").insert(insertRow as any).select("id").single();
      if (error) throw error;
      // Mirror the products page: set qr_code = id for stable QR.
      await supabase.from("products").update({ qr_code: data.id }).eq("id", data.id);
      toast.success("تمت إضافة المنتج");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الإضافة");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md bg-[oklch(0.12_0.005_60)] text-white border-white/10">
        <DialogHeader>
          <DialogTitle className="text-[oklch(0.92_0.08_82)]">منتج جديد</DialogTitle>
          <DialogDescription className="text-white/60">
            سيظهر فوراً في الكتالوج وصفحة المنتجات (مزامنة لحظية).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-white/80 text-xs">الاسم</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 border-white/15 bg-white/5 text-white" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-white/80 text-xs">السيريال</Label>
              <Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                className="mt-1 border-white/15 bg-white/5 text-white" />
            </div>
            <div>
              <Label className="text-white/80 text-xs">Collection</Label>
              <select value={form.collection} onChange={(e) => setForm({ ...form, collection: e.target.value })}
                className="mt-1 h-9 w-full rounded-md border border-white/15 bg-white/5 px-2 text-sm text-white">
                {APP_COLLECTIONS.map((c) => (
                  <option key={c} value={c} className="bg-[oklch(0.12_0.005_60)]">{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-white/80 text-xs">اللون</Label>
              <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                placeholder="CHROME PLATED" className="mt-1 border-white/15 bg-white/5 text-white" />
            </div>
            <div>
              <Label className="text-white/80 text-xs">السعر (EGP)</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="mt-1 border-white/15 bg-white/5 text-white" />
            </div>
          </div>
          <div>
            <Label className="text-white/80 text-xs">المخزون</Label>
            <Input type="number" value={form.stock_quantity}
              onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
              className="mt-1 border-white/15 bg-white/5 text-white" />
          </div>
          <div>
            <Label className="text-white/80 text-xs">صورة المنتج</Label>
            <div className="mt-2"><ProductImageUpload value={imageUrl} onChange={setImageUrl} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/15 bg-white/5 text-white">إلغاء</Button>
          <Button disabled={saving} onClick={submit}
            className="bg-[oklch(0.78_0.11_82)] text-[oklch(0.1_0.004_60)] hover:bg-[oklch(0.84_0.1_82)]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useDistributor } from "@/lib/use-distributor";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ColorSwatch } from "@/components/color-swatch";
import { fmtMoney, fmtDate } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  ShoppingBag, Plus, Minus, Trash2, Search, Send, Clock, CheckCircle2,
  XCircle, FileText, LogOut, Languages, Loader2, Package, Store, MapPin,
} from "lucide-react";
import brandLogo from "@/assets/steinheim-logo-white.png";

export const Route = createFileRoute("/distributor")({ component: DistributorPortal });

type Product = {
  id: string; name: string; serial_number: string | null; color: string | null;
  price: number; image_url: string | null; collection: string | null;
  available_stock: number;
};
type CartLine = { product: Product; qty: number };
type DistInvoice = {
  id: string; invoice_number: string; created_at: string; subtotal: number;
  discount: number; total: number; status: string; approval_status: string;
  approval_discount_pct: number; approval_notes: string | null;
  customer_name: string | null;
};

function DistributorPortal() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { lang, setLang } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();
  const { distributor, loading: distLoading } = useDistributor();
  const [tab, setTab] = useState<"catalog" | "cart" | "history">("catalog");

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [authLoading, user, navigate]);

  if (authLoading || distLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c]"><Loader2 className="h-6 w-6 animate-spin text-white/60" /></div>;
  }
  if (!distributor?.is_active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0c] p-4 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <Store className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <h2 className="mb-2 text-lg font-semibold">{isAr ? "حسابك ليس موزّعاً" : "Not a distributor account"}</h2>
          <p className="mb-4 text-sm text-white/60">{isAr ? "تواصل مع إدارة الشركة لتفعيل حسابك كموزّع." : "Contact the company admin to activate your distributor account."}</p>
          <Button variant="outline" onClick={async () => { await signOut(); navigate({ to: "/auth" }); }} className="w-full border-white/20 bg-white/5 text-white">
            <LogOut className="me-2 h-4 w-4" /> {isAr ? "تسجيل خروج" : "Sign out"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0c] to-[#101015] text-white" dir={isAr ? "rtl" : "ltr"}>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0a0c]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={brandLogo} alt="Steinheim" className="h-8 w-auto" />
            <div className="hidden border-s border-white/10 ps-3 sm:block">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-amber-400/80">
                <Store className="h-3 w-3" /> {isAr ? "بوابة الموزّعين" : "Distributor portal"}
              </div>
              <div className="text-sm font-semibold">{distributor.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setLang(isAr ? "en" : "ar")}>
              <Languages className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-white/70 hover:bg-white/10 hover:text-white" onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-3">
          <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {([
              { k: "catalog", icon: Package, ar: "المنتجات", en: "Catalog" },
              { k: "cart", icon: ShoppingBag, ar: "فاتورة جديدة", en: "New invoice" },
              { k: "history", icon: FileText, ar: "فواتيري", en: "My invoices" },
            ] as const).map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === t.k ? "bg-white text-[#0a0a0c]" : "text-white/70 hover:bg-white/10"}`}>
                <t.icon className="h-4 w-4" /> {isAr ? t.ar : t.en}
                {t.k === "cart" && <CartCountBadge active={tab === t.k} />}
              </button>
            ))}
          </div>
        </div>

      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "catalog" && <CatalogTab onAddToCart={(p) => { addCart(p); toast.success(isAr ? `أُضيف ${p.name}` : `Added ${p.name}`); }} />}
        {tab === "cart" && <CartTab distributor={distributor} onSubmitted={() => setTab("history")} />}
        {tab === "history" && <HistoryTab />}
      </main>
    </div>
  );
}

// ---------------- Cart store (localStorage) ----------------
const CART_KEY = "dist.cart.v1";
function readCart(): CartLine[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { return []; }
}
function writeCart(c: CartLine[]) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {}
  window.dispatchEvent(new Event("dist-cart-updated"));
}
function addCart(p: Product) {
  const c = readCart();
  const i = c.findIndex((l) => l.product.id === p.id);
  if (i >= 0) c[i].qty = Math.min(c[i].qty + 1, p.available_stock);
  else c.push({ product: p, qty: 1 });
  writeCart(c);
}
function useCart() {
  const [cart, setCart] = useState<CartLine[]>(readCart);
  useEffect(() => {
    const on = () => setCart(readCart());
    window.addEventListener("dist-cart-updated", on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener("dist-cart-updated", on); window.removeEventListener("storage", on); };
  }, []);
  return { cart, setCart: (c: CartLine[]) => { writeCart(c); setCart(c); } };
}

// ---------------- Catalog ----------------
function CatalogTab({ onAddToCart }: { onAddToCart: (p: Product) => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [collection, setCollection] = useState<string>("all");

  const load = async () => {
    const { data } = await (supabase as any).rpc("list_distributor_products");
    const rows = ((data as Product[]) ?? []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setProducts(rows);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTable("products", () => load());

  const collections = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => { if (p.collection) s.add(p.collection); });
    return Array.from(s).sort();
  }, [products]);

  const colors = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => { if (p.color) s.add(p.color); });
    return Array.from(s).sort();
  }, [products]);

  const [color, setColor] = useState<string>("all");

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return products.filter((p) => {
      if (collection !== "all" && (p.collection || "") !== collection) return false;
      if (color !== "all" && (p.color || "") !== color) return false;
      if (!qq) return true;
      return (p.name + " " + (p.serial_number || "") + " " + (p.color || "")).toLowerCase().includes(qq);
    });
  }, [products, q, collection, color]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "ابحث باسم المنتج أو السيريال" : "Search products"}
            className="border-white/15 bg-white/5 ps-10 text-white placeholder:text-white/40" />
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setCollection("all")} className={`rounded-full px-3 py-1 text-xs font-medium ${collection === "all" ? "bg-white text-[#0a0a0c]" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>
            {isAr ? "الكل" : "All"}
          </button>
          {collections.map((c) => (
            <button key={c} onClick={() => setCollection(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${collection === c ? "bg-white text-[#0a0a0c]" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {colors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-white/40 me-1">{isAr ? "اللون:" : "Color:"}</span>
          <button onClick={() => setColor("all")} className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${color === "all" ? "bg-white text-[#0a0a0c]" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>
            {isAr ? "الكل" : "All"}
          </button>
          {colors.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${color === c ? "bg-white text-[#0a0a0c]" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>
              <ColorSwatch value={c} size="xs" />
              <span>{c}</span>
            </button>
          ))}
        </div>
      )}
      <CartPreview />


      {loading ? (
        <div className="py-16 text-center text-white/50"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-16 text-center text-white/50">{isAr ? "لا توجد منتجات" : "No products"}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} p={p} onAdd={() => onAddToCart(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, onAdd }: { p: Product; onAdd: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const out = p.available_stock <= 0;
  return (
    <div className="group overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent transition hover:border-white/25 hover:shadow-[0_8px_30px_rgba(255,255,255,0.06)]">
      <div className="aspect-square w-full overflow-hidden bg-white/5">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-white/30"><Package className="h-8 w-8" /></div>
        )}
      </div>
      <div className="p-3">
        <div className="mb-1 truncate text-sm font-semibold">{p.name}</div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-white/50">
          {p.serial_number && <span className="font-mono">{p.serial_number}</span>}
          {p.color && (<><span>•</span><ColorSwatch value={p.color} size="sm" /><span>{p.color}</span></>)}
        </div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-base font-bold tabular-nums">{fmtMoney(p.price, "EGP", lang)}</div>
          <Badge variant="outline" className={`tabular-nums ${out ? "border-red-400/40 text-red-300" : "border-emerald-400/40 text-emerald-300"}`}>
            {out ? (isAr ? "نفد" : "Out") : `${p.available_stock}`}
          </Badge>
        </div>
        <Button disabled={out} onClick={onAdd} size="sm" className="w-full bg-white text-[#0a0a0c] hover:bg-white/90 disabled:opacity-40">
          <Plus className="me-1 h-4 w-4" /> {isAr ? "أضف للفاتورة" : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ---------------- Cart ----------------
function CartTab({ distributor, onSubmitted }: { distributor: any; onSubmitted: () => void }) {
  const { lang } = useI18n();
  const { user } = useAuth();
  const isAr = lang === "ar";
  const { cart, setCart } = useCart();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.product.price * l.qty, 0), [cart]);

  const updateQty = (id: string, delta: number) => {
    const c = cart.map((l) => l.product.id === id
      ? { ...l, qty: Math.max(1, Math.min(l.product.available_stock, l.qty + delta)) }
      : l).filter((l) => l.qty > 0);
    setCart(c);
  };
  const removeLine = (id: string) => setCart(cart.filter((l) => l.product.id !== id));

  const submit = async () => {
    if (!user || cart.length === 0) return;
    if (!customerName.trim()) { toast.error(isAr ? "اكتب اسم العميل" : "Customer name required"); return; }
    setSubmitting(true);
    try {
      const invoiceNumber = `D-${Date.now().toString().slice(-8)}`;
      const { data: inv, error } = await (supabase.from as any)("invoices").insert({
        user_id: user.id,
        invoice_number: invoiceNumber,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_address: shippingAddress.trim() || null,
        shipping_address: shippingAddress.trim() || null,
        subtotal, discount: 0, total: subtotal,
        notes: notes.trim() || null,
        status: "draft",
        source: "distributor",
        distributor_id: distributor.id,
        approval_status: "pending",
        language: lang,

      }).select().single();
      if (error) throw error;
      const items = cart.map((l) => ({
        invoice_id: inv.id,
        product_id: l.product.id,
        product_name: l.product.name,
        serial_number: l.product.serial_number,
        color: l.product.color,
        quantity: l.qty,
        unit_price: l.product.price,
        discount: 0,
        line_total: l.product.price * l.qty,
      }));
      const { error: itemsErr } = await (supabase.from as any)("invoice_items").insert(items);
      if (itemsErr) throw itemsErr;
      setCart([]);
      setCustomerName(""); setCustomerPhone(""); setShippingAddress(""); setNotes("");
      toast.success(isAr ? "تم إرسال الفاتورة للمراجعة" : "Invoice sent for approval");
      onSubmitted();
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally { setSubmitting(false); }
  };

  if (cart.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center">
        <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-white/30" />
        <p className="text-white/60">{isAr ? "الفاتورة فاضية — أضف منتجات من الكتالوج" : "Empty cart — add from catalog"}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-2">
        {cart.map((l) => (
          <div key={l.product.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
              {l.product.image_url
                ? <img src={l.product.image_url} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center text-white/30"><Package className="h-5 w-5" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{l.product.name}</div>
              <div className="text-xs text-white/50">{fmtMoney(l.product.price, "EGP", lang)} × {l.qty}</div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-white/10" onClick={() => updateQty(l.product.id, -1)}><Minus className="h-3 w-3" /></Button>
              <span className="w-7 text-center text-sm font-bold tabular-nums">{l.qty}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-white hover:bg-white/10" onClick={() => updateQty(l.product.id, +1)}><Plus className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="ms-1 h-7 w-7 text-red-300 hover:bg-red-500/10" onClick={() => removeLine(l.product.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
            <div className="w-24 text-end text-sm font-bold tabular-nums">{fmtMoney(l.product.price * l.qty, "EGP", lang)}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold">{isAr ? "بيانات الفاتورة" : "Invoice details"}</h3>
        <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
          placeholder={isAr ? "اسم العميل *" : "Customer name *"} className="border-white/15 bg-white/5 text-white placeholder:text-white/40" />
        <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder={isAr ? "رقم التليفون" : "Phone"} className="border-white/15 bg-white/5 text-white placeholder:text-white/40" />
        <Textarea value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)}
          placeholder={isAr ? "عنوان الشحن (المحافظة، المدينة، العنوان بالتفصيل)" : "Shipping address"} className="border-white/15 bg-white/5 text-white placeholder:text-white/40" rows={2} />
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={isAr ? "ملاحظات (اختياري)" : "Notes (optional)"} className="border-white/15 bg-white/5 text-white placeholder:text-white/40" rows={2} />
        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-sm text-white/60">{isAr ? "الإجمالي" : "Total"}</span>
          <span className="text-xl font-bold tabular-nums">{fmtMoney(subtotal, "EGP", lang)}</span>
        </div>
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          {isAr ? "الفاتورة هتدخل بانتظار موافقة الشركة. ممكن تطبق خصم قبل الموافقة." : "Invoice goes pending; company may apply a discount before approval."}
        </p>
        <Button disabled={submitting} onClick={submit} className="w-full bg-white text-[#0a0a0c] hover:bg-white/90">
          {submitting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Send className="me-2 h-4 w-4" />}
          {isAr ? "إرسال للمراجعة" : "Send for approval"}
        </Button>
      </div>
    </div>
  );
}

// ---------------- History ----------------
function HistoryTab() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [invoices, setInvoices] = useState<DistInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    if (!user) return;
    const { data } = await (supabase.from as any)("invoices")
      .select("id,invoice_number,created_at,subtotal,discount,total,status,approval_status,approval_discount_pct,approval_notes,customer_name,distributor_commission_amount,distributor_id")
      .eq("user_id", user.id).eq("source", "distributor")
      .order("created_at", { ascending: false }).limit(200);
    setInvoices((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [user?.id]);
  useRealtimeTable("invoices", () => load());

  // Pull live balance (commissions earned, paid out, owed)
  const [balance, setBalance] = useState<any>(null);
  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      const { data: dist } = await (supabase.from as any)("distributors").select("id").eq("user_id", user.id).maybeSingle();
      if (!dist?.id) return;
      const { data } = await (supabase.from as any)("distributor_balances").select("*").eq("distributor_id", dist.id).maybeSingle();
      if (!cancel) setBalance(data);
    })();
    return () => { cancel = true; };
  }, [user?.id, invoices.length]);

  if (loading) return <div className="py-16 text-center text-white/50"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {balance && (
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-3">
          <div>
            <div className="text-[10px] uppercase text-white/40">{isAr ? "إجمالي العمولات" : "Earned"}</div>
            <div className="text-base font-bold text-emerald-300 tabular-nums">{fmtMoney(balance.commission_earned, "EGP", lang)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-white/40">{isAr ? "تم استلامه" : "Paid out"}</div>
            <div className="text-base font-bold text-white/80 tabular-nums">{fmtMoney(balance.payouts_total, "EGP", lang)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-white/40">{isAr ? "مستحق لك" : "Owed to you"}</div>
            <div className="text-base font-bold text-amber-300 tabular-nums">{fmtMoney(balance.balance_owed, "EGP", lang)}</div>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 py-16 text-center text-white/50">{isAr ? "لا توجد فواتير بعد" : "No invoices yet"}</div>
      ) : invoices.map((inv: any) => {
        const st = inv.approval_status;
        const map: any = {
          pending: { ar: "بانتظار الموافقة", en: "Pending", c: "bg-amber-500/15 text-amber-300 border-amber-400/40", I: Clock },
          approved: { ar: "تمت الموافقة", en: "Approved", c: "bg-emerald-500/15 text-emerald-300 border-emerald-400/40", I: CheckCircle2 },
          rejected: { ar: "مرفوضة", en: "Rejected", c: "bg-red-500/15 text-red-300 border-red-400/40", I: XCircle },
        };
        const s = map[st] || map.pending; const I = s.I;
        const commission = Number(inv.distributor_commission_amount || 0);
        return (
          <div key={inv.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${s.c}`}><I className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 truncate text-sm font-semibold">
                {inv.invoice_number} <span className="text-white/40">•</span> <span className="text-white/60 font-normal truncate">{inv.customer_name}</span>
              </div>
              <div className="text-[11px] text-white/40">{fmtDate(inv.created_at, lang)}</div>
              {st === "approved" && commission > 0 && (
                <div className="mt-1 text-[11px] text-emerald-300">
                  {isAr ? `عمولتك: ${fmtMoney(commission, "EGP", lang)} (${inv.approval_discount_pct}%)` : `Your commission: ${fmtMoney(commission, "EGP", lang)} (${inv.approval_discount_pct}%)`}
                </div>
              )}
              {st === "rejected" && inv.approval_notes && <div className="mt-1 text-[11px] text-red-300">{inv.approval_notes}</div>}
            </div>
            <div className="text-end">
              <div className="text-sm font-bold tabular-nums">{fmtMoney(inv.total, "EGP", lang)}</div>
              <Badge variant="outline" className={`mt-1 text-[10px] ${s.c}`}>{isAr ? s.ar : s.en}</Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

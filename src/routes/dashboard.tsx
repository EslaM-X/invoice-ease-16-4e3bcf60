import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtMoneyAdaptive, fmtDate } from "@/lib/utils-money";
import { Users, FileText, TrendingUp, AlertTriangle, Plus, ScanLine, Eye, EyeOff, CheckCircle2, Truck, Clock, Package, Sparkles, Coins } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBatchedRealtimeTables } from "@/lib/realtime";
import { ActivityFeed } from "@/components/activity-feed";
import { useHideNumbers } from "@/lib/use-hide-numbers";
import { useCurrentAvatar } from "@/lib/use-avatar";
import { useUiPrefs } from "@/lib/use-ui-prefs";
import { useEffectiveUser } from "@/lib/use-effective-user";
import { IncomingShipmentsStrip } from "@/components/incoming-shipments-strip";
import { CloseableInvoicesCard } from "@/components/closeable-invoices-card";
import { LeadershipTasksCard } from "@/components/leadership-tasks-card";
import { NoirKpiCard, type NoirTone } from "@/components/noir-kpi-card";
import { DistributorApprovalsCard } from "@/components/distributor-approvals-card";
import { PendingAccountsCard } from "@/components/pending-accounts-card";
import { PoShipmentsTracker } from "@/components/po-shipments-tracker";
import { SalesOverview } from "@/components/sales-overview";
import { TopProductsInteractive } from "@/components/top-products-interactive";
import { cachedListFetch } from "@/lib/list-cache";
import { LazyMount } from "@/components/lazy-mount";
import { toast } from "sonner";

const DASH_CACHE_KEY = "dashboard:stats:v1";

export const Route = createFileRoute("/dashboard")({ component: DashboardPage });

function DashboardPage() {
  return <AppShell><Dashboard /></AppShell>;
}

function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { hidden, toggle } = useHideNumbers();
  const [stats, setStats] = useState({ sales: 0, invoices: 0, closed: 0, partial: 0, open: 0, customers: 0, products: 0, lowStock: 0, inventoryStock: 0, sampleStock: 0, costValueEgp: 0, salesValueEgp: 0, latestUsdRate: 50 });
  const [loaded, setLoaded] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [fxInput, setFxInput] = useState("50.5");
  const [savingFx, setSavingFx] = useState(false);
  const avatar = useCurrentAvatar();
  const ui = useUiPrefs();
  const effectiveUser = useEffectiveUser();
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const navigate = useNavigate();
  const [avatarImgLoaded, setAvatarImgLoaded] = useState(false);

  // Hydrate instantly from session cache so numbers don't flash 0.
  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try {
      const raw = sessionStorage.getItem(`${DASH_CACHE_KEY}:${user.id}`);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.stats) { setStats(cached.stats); setLoaded(true); }
        if (cached?.recent) setRecent(cached.recent);
        if (cached?.stats?.latestUsdRate) setFxInput(String(cached.stats.latestUsdRate));
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  const load = async (forceRefresh = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
    const [{ data: invs }, { count: cust }, productsResult, { data: sampleRows }, { data: settingsRow }, { data: latestRateRows }] = await Promise.all([
      supabase.from("invoices")
        .select("id, total, paid_amount, delivery_status, customer_name, created_at, invoice_number, status")
        .not("status", "in", "(voided,draft)")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("customers").select("*", { count: "exact", head: true }),
      cachedListFetch(
        "dashboard:product-stock-v2",
        async () => {
          const { data } = await supabase.from("products").select("stock_quantity, low_stock_threshold, cost_price_usd, price");
          return (data as any[]) ?? [];
        },
        { ttl: 60_000, forceRefresh },
      ),
      (supabase as any)
        .from("defective_items")
        .select("quantity, returned_quantity, item_type, status, reason")
        .neq("status", "returned_full"),
      user
        ? (supabase as any).from("settings").select("dashboard_usd_rate").eq("user_id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("purchase_orders")
        .select("usd_rate")
        .not("usd_rate", "is", null)
        .order("cfo_priced_at", { ascending: false, nullsFirst: false })
        .limit(1),
    ]);
    const prods = productsResult.data;

    const sales = (invs ?? []).reduce((s: number, i: any) => s + Number(i.total ?? 0), 0);
    const lowStock = (prods ?? []).filter((p: any) => p.stock_quantity <= p.low_stock_threshold).length;
    const latestUsdRate = Number((settingsRow as any)?.dashboard_usd_rate) || Number((latestRateRows as any[])?.[0]?.usd_rate) || 50.5;
    const inventoryStock = (prods ?? []).reduce((s: number, p: any) => s + Math.max(0, Number(p.stock_quantity) || 0), 0);
    const costValueEgp = (prods ?? []).reduce((s: number, p: any) => s + Math.max(0, Number(p.stock_quantity) || 0) * (Number(p.cost_price_usd) || 0) * latestUsdRate, 0);
    const salesValueEgp = (prods ?? []).reduce((s: number, p: any) => s + Math.max(0, Number(p.stock_quantity) || 0) * (Number(p.price) || 0), 0);
    const sampleStock = ((sampleRows as any[]) ?? [])
      .filter((r: any) => {
        const t = String(r.item_type || "").toLowerCase();
        const reason = String(r.reason || "").toLowerCase();
        if (["sample", "loan", "showroom"].includes(t)) return true;
        return /sample|عين|إعار|اعار|عرض|showroom|loan|test/.test(reason);
      })
      .reduce((s: number, r: any) => s + Math.max(0, (Number(r.quantity) || 0) - (Number(r.returned_quantity) || 0)), 0);

    // Trust the persisted `delivery_status` (maintained by tg_recalc_delivery_status).
    // Earlier we recomputed from delivery_receipt_items.invoice_item_id, but ~76%
    // of legacy DR rows had invoice_item_id NULL which under-counted deliveries
    // and over-counted "closed" / under-counted "partial". The DB trigger already
    // handles partial/delivered accurately.
    let closed = 0, partial = 0, open = 0;
    (invs ?? []).forEach((i: any) => {
      const total = Number(i.total ?? 0);
      const paid = Number(i.paid_amount ?? 0);
      const fullyPaid = total > 0 && paid >= total - 0.001;
      const isFullyDelivered = i.delivery_status === "delivered";
      const isPartial = i.delivery_status === "partial";
      if (fullyPaid && isFullyDelivered) closed++;
      else if (isPartial) partial++;
      else open++;
    });

    const nextStats = {
      sales,
      invoices: invs?.length ?? 0,
      closed,
      partial,
      open,
      customers: cust ?? 0,
      products: prods?.length ?? 0,
      lowStock,
      inventoryStock,
      sampleStock,
      costValueEgp,
      salesValueEgp,
      latestUsdRate,
    };
    setStats(nextStats);
    setFxInput(String(latestUsdRate));
    const nextRecent = (invs ?? []).slice(0, 5);
    setRecent(nextRecent);
    // Persist for instant next paint
    try {
      if (typeof window !== "undefined" && user) {
        sessionStorage.setItem(
          `${DASH_CACHE_KEY}:${user.id}`,
          JSON.stringify({ stats: nextStats, recent: nextRecent, ts: Date.now() }),
        );
      }
    } catch { /* ignore */ }
    } finally {
      inFlightRef.current = false;
      setLoaded(true);
    }
  };

  const saveFxRate = async () => {
    if (!user) return;
    const rate = Number(fxInput);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error(lang === "ar" ? "أدخل سعر دولار صحيح" : "Enter a valid USD rate");
      return;
    }
    setSavingFx(true);
    const { error } = await (supabase as any)
      .from("settings")
      .upsert({ user_id: user.id, dashboard_usd_rate: rate, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSavingFx(false);
    if (error) return toast.error(error.message);
    setStats((s) => ({
      ...s,
      latestUsdRate: rate,
      costValueEgp: s.latestUsdRate > 0 ? (s.costValueEgp / s.latestUsdRate) * rate : s.costValueEgp,
    }));
    toast.success(lang === "ar" ? "تم تحديث سعر الدولار" : "USD rate updated");
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);
  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const scheduleRealtimeRefresh = () => {
    if (!user) return;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      void load(true);
    }, 300);
  };

  useBatchedRealtimeTables(
    ["invoices", "products", "customers", "defective_items", "purchase_orders"],
    scheduleRealtimeRefresh,
    [user?.id],
    { debounceMs: 800, maxWaitMs: 2500 },
  );

  const salesAdaptive = fmtMoneyAdaptive(stats.sales, "EGP", lang);
  const costAdaptive = fmtMoneyAdaptive(stats.costValueEgp, "EGP", lang);
  const salesValueAdaptive = fmtMoneyAdaptive(stats.salesValueEgp, "EGP", lang);

  const cards: Array<{ key: string; label: string; value: any; fullValue?: string; subValue?: string; Icon: any; tone: NoirTone; sensitive?: boolean }> = [
    { key: "kpi_total_sales", label: t("total_sales"),               value: salesAdaptive.short, fullValue: salesAdaptive.full, subValue: salesAdaptive.compact ? `≈ ${salesAdaptive.full}` : undefined, Icon: TrendingUp,   tone: "gold",    sensitive: true },
    { key: "kpi_total_invoices", label: t("total_invoices"),            value: stats.invoices,                     Icon: FileText,     tone: "neutral" },
    { key: "kpi_closed_invoices", label: t("closed_invoices"),           value: stats.closed,                       Icon: CheckCircle2, tone: "emerald" },
    { key: "kpi_partial_invoices", label: t("partial_delivery_invoices"), value: stats.partial,                      Icon: Truck,        tone: "amber" },
    { key: "kpi_open_invoices", label: t("open_invoices"),             value: stats.open,                         Icon: Clock,        tone: "blue" },
    { key: "kpi_customers", label: t("total_customers"),           value: stats.customers,                    Icon: Users,        tone: "violet" },
  ];
  const uiReady = ui.loaded || ui.bypass;
  const visibleCards = uiReady
    ? ui.sortByOrder(cards.filter((card) => !ui.isCardHidden(card.key)), ui.prefs.cards_order)
    : [];

  const now = new Date();
  const hour = now.getHours();
  const greeting = lang === "ar"
    ? (hour < 5 ? "مساء الخير" : hour < 12 ? "صباح الخير" : hour < 18 ? "طاب يومك" : "مساء الخير")
    : (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  const displayName = effectiveUser.displayName
    || effectiveUser.email?.split("@")[0]
    || "";
  const dateStr = now.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const orderedSections = useMemo(() => {
    const sections: Array<{ key: string; node: ReactNode }> = [
      { key: "section_leadership_tasks", node: <LeadershipTasksCard /> },
      { key: "section_closeable_invoices", node: <CloseableInvoicesCard /> },
      { key: "section_pending_accounts", node: <PendingAccountsCard /> },
      { key: "section_distributor_approvals", node: <DistributorApprovalsCard /> },
      { key: "section_incoming_shipments", node: <IncomingShipmentsStrip /> },
      { key: "section_po_shipments_tracker", node: <LazyMount rootMargin="800px" minHeight={220}><PoShipmentsTracker /></LazyMount> },
      {
        key: "section_inventory_values",
        node: (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InventoryValueCard
              label={lang === "ar" ? "منتجات في المخزن" : "Products in stock"}
              value={loaded ? stats.inventoryStock : ""}
              loading={!loaded}
              sub={lang === "ar" ? `${stats.products} صنف نشط` : `${stats.products} active SKUs`}
              Icon={Package}
            />
            <InventoryValueCard
              label={lang === "ar" ? "منتجات في العيانات" : "Samples out"}
              value={loaded ? stats.sampleStock : ""}
              loading={!loaded}
              sub={lang === "ar" ? "عينات خارج المخزون" : "Sample units outside stock"}
              Icon={Sparkles}
            />
            <InventoryValueCard
              label={lang === "ar" ? "قيمة المخزون بسعر التكلفة" : "Inventory at cost"}
              value={hidden ? "•••••" : costAdaptive.short}
              fullValue={costAdaptive.full}
              subValue={costAdaptive.compact && !hidden ? `≈ ${costAdaptive.full}` : undefined}
              loading={!loaded}
              sub={lang === "ar" ? `سعر الدولار المستخدم: ${stats.latestUsdRate}` : `USD rate used: ${stats.latestUsdRate}`}
              Icon={Coins}
              sensitive
              footer={
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={fxInput}
                    onChange={(e) => setFxInput(e.target.value)}
                    className="h-8 min-w-0 border-[#c9a84c]/30 bg-black/60 text-xs tabular-nums text-[#f5e7b8] placeholder:text-white/40 focus-visible:ring-[#c9a84c]/60"
                    aria-label={lang === "ar" ? "سعر الدولار" : "USD rate"}
                  />
                  <Button size="sm" variant="outline" className="h-8 shrink-0 border-[#c9a84c]/40 bg-[#c9a84c]/10 px-3 text-xs font-bold text-[#f5e7b8] hover:bg-[#c9a84c]/20 hover:text-[#f5e7b8]" disabled={savingFx} onClick={saveFxRate}>
                    {lang === "ar" ? "تطبيق" : "Apply"}
                  </Button>
                </div>
              }
            />
            <InventoryValueCard
              label={lang === "ar" ? "قيمة المخزون بسعر البيع" : "Inventory at sale price"}
              value={hidden ? "•••••" : salesValueAdaptive.short}
              fullValue={salesValueAdaptive.full}
              subValue={salesValueAdaptive.compact && !hidden ? `≈ ${salesValueAdaptive.full}` : undefined}
              loading={!loaded}
              sub={lang === "ar" ? "إجمالي سعر البيع للكمية المتاحة" : "Total sale value of available stock"}
              Icon={TrendingUp}
              sensitive
            />
          </section>
        ),
      },
      { key: "section_sales_overview", node: <LazyMount rootMargin="800px" minHeight={280}><SalesOverview /></LazyMount> },
      {
        key: "section_recent_invoices",
        node: (
          <LazyMount rootMargin="800px" minHeight={320}>
            <div className={ui.isCardHidden("section_top_products") ? "grid gap-3" : "grid gap-3 lg:grid-cols-2"}>
              <RecentInvoicesPanel recent={recent} lang={lang} title={t("recent_invoices")} emptyLabel={t("no_data")} />
              {!ui.isCardHidden("section_top_products") && <TopProductsInteractive rangeDays={30} limit={8} />}
            </div>
          </LazyMount>
        ),
      },
      {
        key: "section_top_products",
        node: ui.isCardHidden("section_recent_invoices") ? (
          <LazyMount rootMargin="800px" minHeight={320}><TopProductsInteractive rangeDays={30} limit={8} /></LazyMount>
        ) : null,
      },
      { key: "section_activity_feed", node: <LazyMount rootMargin="600px" minHeight={240}><ActivityFeed limit={10} /></LazyMount> },
    ];
    if (!uiReady) return [];
    return ui.sortByOrder(sections.filter((section) => section.node && !ui.isCardHidden(section.key)), ui.prefs.cards_order);
  }, [costAdaptive, fxInput, hidden, lang, loaded, recent, salesValueAdaptive, savingFx, stats, t, ui, uiReady]);

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* === Luxury Hero Header === */}
      <header className="noir-surface relative overflow-hidden rounded-3xl border border-[#c9a84c]/25 p-5 shadow-2xl shadow-black/40 sm:p-7">
        <div className="gold-hairline-live absolute inset-x-0 top-0" />
        <div className="gradient-mesh pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute -top-24 end-[-60px] h-64 w-64 rounded-full bg-[#c9a84c]/10 blur-3xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#c9a84c]/85">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="truncate">{greeting}{displayName ? (lang === "ar" ? "، " : ", ") + displayName : ""}</span>
            </div>
            <h1 className="display-xl text-foreground">
              {lang === "ar" ? (<>لوحة <span className="text-gradient-gold">التحكم</span></>) : (<>Control <span className="text-gradient-gold">Center</span></>)}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-600 dark:text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {lang === "ar" ? "مباشر" : "Live"}
              </span>
              <span className="opacity-60">·</span>
              <span className="truncate">{dateStr}</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            {/* Luxury avatar */}
            <Link
              to="/settings"
              aria-label={lang === "ar" ? "الملف الشخصي" : "Profile"}
              className="noir-press focus-gold group relative mx-auto sm:mx-0 inline-flex h-20 w-20 shrink-0 items-center justify-center"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-[-7px] rounded-full bg-[conic-gradient(from_0deg,transparent,#c9a84c66,transparent_60%)] opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100 motion-reduce:hidden" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-[-3px] rounded-full bg-[#c9a84c]/25 blur-md" />
              <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-full border-2 border-[#c9a84c]/70 bg-[#0a0a0a] shadow-[0_8px_24px_-6px_rgba(201,168,76,0.55)] ring-2 ring-black/60 ring-offset-0">
                {/* Initial fallback / placeholder always underneath so there's no flash */}
                <span className="absolute inset-0 grid place-items-center text-xl font-bold tracking-wide text-[#f5e7b8] bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a]">
                  {avatar.initial || (displayName || (user as any)?.email || "U").toString().trim().charAt(0).toUpperCase()}
                </span>
                {/* Shimmer skeleton while resolving */}
                {avatar.loading && !avatar.url && (
                  <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-gradient-to-r from-[#161616] via-[#2a2416] to-[#161616] motion-reduce:animate-none" />
                )}
                {avatar.url && (
                  <img
                    src={avatar.url}
                    alt={avatar.name ?? displayName ?? "avatar"}
                    width={80}
                    height={80}
                    loading="eager"
                    decoding="async"
                    onLoad={() => setAvatarImgLoaded(true)}
                    onError={() => setAvatarImgLoaded(true)}
                    className={`relative h-full w-full object-cover transition-[opacity,filter] duration-500 ${avatarImgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-md"}`}
                  />
                )}
              </span>
              <span aria-hidden="true" className="absolute -bottom-0.5 -end-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-[#0a0a0a] bg-emerald-500 shadow">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-300 motion-reduce:hidden" />
              </span>
            </Link>

            <div aria-hidden="true" className="mx-auto h-px w-16 bg-gradient-to-r from-transparent via-[#c9a84c]/40 to-transparent sm:mx-0 sm:w-24 sm:self-end" />
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
            <button
              type="button"
              onClick={toggle}
              title={hidden ? (lang === "ar" ? "إظهار الأرقام" : "Show numbers") : (lang === "ar" ? "إخفاء الأرقام" : "Hide numbers")}
              className="noir-press noir-ripple focus-gold grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#c9a84c]/30 bg-[#161616]/70 text-[#f5e7b8] backdrop-blur hover:border-[#c9a84c]/60 hover:bg-[#161616]"
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                const isPhone = typeof window !== "undefined" && window.innerWidth < 768;
                if (isPhone) navigate({ to: "/scan-and-sell" });
                else navigate({ to: "/invoices/new", search: { scan: true } });
              }}
              className="noir-press noir-ripple focus-gold group inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#c9a84c]/35 bg-[#161616]/70 px-5 py-2.5 text-sm font-semibold text-[#f5e7b8] backdrop-blur hover:border-[#c9a84c]/70 sm:flex-none"
            >
              <ScanLine className="h-4 w-4 transition-transform duration-500 group-hover:scale-110 motion-reduce:transition-none" />
              <span className="truncate">{t("scan_and_sell")}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/invoices/new" })}
              className="noir-press noir-ripple focus-gold group relative inline-flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-full px-5 py-2.5 text-sm font-bold text-[#0a0a0a] shadow-lg shadow-[#c9a84c]/30 sm:flex-none"
              style={{ background: "var(--gradient-gold)" }}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0a0a0a]/15">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="truncate">{t("new_invoice")}</span>
              <span className="pointer-events-none absolute inset-0 bg-white/15 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none" />
            </button>
          </div>
          </div>
        </div>
      </header>

      {/* === Low stock luxury alert === */}
      {stats.lowStock > 0 && (
        <Link
          to="/inventory"
          role="alert"
          aria-label={`${t("stock_low_alert")}: ${stats.lowStock} ${lang === "ar" ? "منتج بحاجة لإعادة تخزين" : "products need restocking"}`}
          className="noir-press noir-ripple focus-gold group relative flex flex-col items-stretch gap-4 overflow-hidden rounded-2xl border border-amber-500/35 bg-gradient-to-br from-[#1a1408] to-[#0d0a05] p-4 shadow-xl shadow-amber-950/40 hover:border-amber-500/60 sm:flex-row sm:items-center sm:gap-5 sm:p-5"
        >
          <div aria-hidden="true" className="pointer-events-none absolute -left-16 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-amber-500/15 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />

          <div className="relative flex items-center gap-4 flex-1 min-w-0">
            <div aria-hidden="true" className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-500/40 bg-amber-500/15 text-amber-400">
              <span className="absolute inset-0 rounded-2xl bg-amber-400/20 animate-ping motion-reduce:hidden" style={{ animationDuration: "2.5s" }} />
              <AlertTriangle className="relative h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500/90">
                {t("stock_low_alert")}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="ltr-nums font-display text-3xl font-bold text-amber-300 sm:text-4xl">{stats.lowStock}</span>
                <span className="text-xs text-white/60">{lang === "ar" ? "منتج بحاجة لإعادة تخزين" : "products need restocking"}</span>
              </div>
            </div>
          </div>

          <div aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center gap-2 self-stretch rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-300 transition-colors group-hover:bg-amber-500/20 sm:self-auto">
            {t("view")}
            <span className="transition-transform duration-300 group-hover:translate-x-[-2px] rtl:rotate-180 motion-reduce:transition-none">→</span>
          </div>
        </Link>
      )}



      <div className="stagger grid gap-3 grid-cols-2 lg:grid-cols-3" data-first-paint={loaded && uiReady ? "done" : "loading"}>
        {!uiReady
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-noir h-[120px] rounded-2xl sm:h-[140px]" aria-hidden="true" />
            ))
          : visibleCards.map(({ key, label, value, fullValue, subValue, Icon, tone, sensitive }) => (
              <NoirKpiCard
                key={key}
                label={label}
                value={value}
                fullValue={fullValue}
                subValue={subValue}
                Icon={Icon}
                tone={tone}
                hidden={!!sensitive && hidden}
                loading={!loaded}
              />
            ))}
      </div>


      {orderedSections.map((section) => <div key={section.key}>{section.node}</div>)}
    </div>
  );
}

function RecentInvoicesPanel({ recent, lang, title, emptyLabel }: { recent: any[]; lang: "ar" | "en"; title: string; emptyLabel: string }) {
  return (
    <div className="ios-card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        <div className="h-px flex-1 mx-4 bg-border" />
      </div>
      {recent.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-border">
          {recent.map((r) => (
            <Link
              key={r.id}
              to="/invoices/$id"
              params={{ id: r.id }}
              aria-label={`${r.invoice_number} · ${r.customer_name || "—"} · ${fmtMoney(Number(r.total), "EGP", lang)}`}
              className="focus-gold flex items-center justify-between rounded-lg py-3 px-2 -mx-2 transition hover:bg-muted/40 hover:opacity-90"
            >
              <div>
                <div className="text-sm font-medium">{r.invoice_number}</div>
                <div className="text-xs text-muted-foreground">{r.customer_name || "—"} · {fmtDate(r.created_at, lang)}</div>
              </div>
              <div className="text-sm font-semibold tabular-nums">{fmtMoney(Number(r.total), "EGP", lang)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryValueCard({
  label,
  value,
  fullValue,
  subValue,
  sub,
  Icon,
  footer,
  loading,
}: {
  label: string;
  value: number | string;
  fullValue?: string;
  subValue?: string;
  sub: string;
  Icon: typeof Package;
  sensitive?: boolean;
  footer?: ReactNode;
  loading?: boolean;
}) {
  const ariaValue = fullValue ?? (typeof value === "string" || typeof value === "number" ? String(value) : "");
  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={ariaValue ? `${label}: ${ariaValue}. ${sub}` : label}
      title={fullValue}
      className="noir-kpi noir-glow noir-press noir-ripple focus-gold group relative overflow-hidden rounded-2xl border border-[#c9a84c]/20 bg-gradient-to-br from-[#161616] to-[#0d0d0d] p-4 shadow-xl shadow-black/40 hover:-translate-y-0.5 hover:border-[#c9a84c]/40 sm:p-5"
    >
      <div aria-hidden="true" className="gold-hairline-live absolute inset-x-0 top-0" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-14 left-1/2 h-24 w-40 -translate-x-1/2 rounded-full bg-[#c9a84c]/10 blur-3xl opacity-40 transition-all duration-500 group-hover:opacity-80 group-hover:w-56 motion-reduce:transition-none" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45 truncate sm:text-[11px]">{label}</div>
          {loading ? (
            <div aria-hidden="true" className="skeleton-noir mt-3 h-8 w-24 rounded-md sm:h-10 sm:w-32" />
          ) : (
            <>
              <div
                className="ltr-nums mt-3 font-display font-bold tracking-tight tabular-nums leading-tight break-words text-[#f5e7b8]"
                style={{ fontSize: "clamp(1.35rem, 4.6vw, 1.875rem)" }}
              >
                {value}
              </div>
              {subValue && (
                <div className="ltr-nums mt-1.5 text-sm font-medium tabular-nums text-[#c9a84c]/75 truncate sm:text-[15px]">
                  {subValue}
                </div>
              )}
            </>
          )}
        </div>
        <div aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#c9a84c]/30 bg-[#c9a84c]/12 text-[#c9a84c] transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="relative mt-3 text-xs text-white/55">{sub}</div>
      {footer && <div className="relative">{footer}</div>}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-0 h-px origin-left scale-x-0 bg-gradient-to-r from-transparent via-[#c9a84c]/70 to-transparent transition-transform duration-500 group-hover:scale-x-100" />
    </div>
  );
}


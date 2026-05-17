import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Package, Boxes, FileText, BarChart3, Settings,
  Plus, Languages, Moon, Sun, LogOut, Menu, X, ClipboardList, ShieldCheck, ShoppingCart,
  Phone, Truck, TrendingUp, StickyNote, ClipboardCheck, ChevronDown, Warehouse, Calculator,
  CloudUpload, Activity, PackageOpen, MessageSquare, MessagesSquare,
} from "lucide-react";
import { useState } from "react";
import { PageTransition } from "@/components/page-transition";
import brandLogo from "@/assets/steinheim-logo-white.png";
import { LowStockAlerts } from "@/components/low-stock-alerts";
import { useRole } from "@/lib/use-role";
import { useIsExecutive } from "@/lib/use-executive";
import { NotificationsBell } from "@/components/notifications-bell";
import { LangStatusPill } from "@/components/lang-status-pill";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { XAssistant } from "@/components/x-assistant";
import { useReminderPoller } from "@/hooks/use-reminder-poller";
import { useChatNotifications } from "@/hooks/use-chat-notifications";

type NavItem = { to: string; icon: any; key: any };
type NavGroup = { group: true; key: any; icon: any; children: NavItem[] };
type NavEntry = NavItem | NavGroup;

const items: NavEntry[] = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" as const },
  {
    group: true,
    key: "inventory_group" as const,
    icon: Warehouse,
    children: [
      { to: "/products", icon: Package, key: "products" as const },
      { to: "/in-transit", icon: PackageOpen, key: "in_transit" as const },
      { to: "/stock-intake", icon: Warehouse, key: "stock_intake" as const },
      { to: "/inventory", icon: Boxes, key: "inventory" as const },
      { to: "/inventory-audit", icon: ClipboardList, key: "inventory_audit" as const },
      { to: "/qr-price-list", icon: FileText, key: "qr_price_list" as const },
    ],
  },
  {
    group: true,
    key: "documents_group" as const,
    icon: FileText,
    children: [
      { to: "/invoices", icon: FileText, key: "invoices" as const },
      { to: "/invoices/drafts", icon: FileText, key: "invoice_drafts" as const },
      { to: "/delivery-receipts", icon: ClipboardCheck, key: "delivery_receipts" as const },
      { to: "/invoices-system-notes", icon: StickyNote, key: "invoices_with_system_notes" as const },
      { to: "/customers", icon: Users, key: "customers" as const },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { isAdmin, isCallCenter, isPurchasing, isCFO } = useRole();
  const isExecutive = useIsExecutive();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useReminderPoller();
  const { unreadTotal: chatUnread } = useChatNotifications();

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate({ to: "/auth" });
  };

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">{t("loading")}</div>;
  }

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-7">
        <img
          src={brandLogo}
          alt="Steinheim"
          className="h-16 w-auto select-none object-contain"
          draggable={false}
        />
        <div className="font-latin text-[9px] font-medium uppercase tracking-[0.42em] text-sidebar-foreground/55">
          Steinheim · Suite
        </div>
      </div>
      <div className="mx-5 mb-3 h-px bg-sidebar-border" />
      <nav className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-width:thin]">
        <Link to="/invoices/new" onClick={() => setOpen(false)}
          className="mb-4 flex items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-sidebar-primary-foreground transition hover:opacity-90 active:scale-[0.98]">
          <Plus className="h-4 w-4" /> {t("new_invoice")}
        </Link>
        {items.map((it) => {
          if ("group" in it) {
            const GroupIcon = it.icon;
            const anyActive = it.children.some(
              (c) => location.pathname === c.to || location.pathname.startsWith(c.to + "/"),
            );
            return (
              <GroupNav
                key={it.key}
                label={t(it.key)}
                icon={GroupIcon}
                defaultOpen={anyActive}
              >
                {it.children.filter((c) => isExecutive || c.to !== "/stock-intake").map((c) => {
                  const active = location.pathname === c.to || location.pathname.startsWith(c.to + "/");
                  const Icon = c.icon;
                  return (
                    <Link
                      key={c.to}
                      to={c.to}
                      onClick={() => setOpen(false)}
                      className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      }`}
                    >
                      {active && (
                        <span className="absolute inset-y-2 start-0 w-[2px] rounded-full bg-sidebar-primary" />
                      )}
                      <Icon className="h-4 w-4" /> {t(c.key)}
                    </Link>
                  );
                })}
              </GroupNav>
            );
          }
          const active = location.pathname === it.to || location.pathname.startsWith(it.to + "/");
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              {active && (
                <span className="absolute inset-y-2 start-0 w-[2px] rounded-full bg-sidebar-primary" />
              )}
              <Icon className="h-4 w-4" /> {t(it.key)}
            </Link>
          );
        })}
        {isExecutive && (isPurchasing || isCFO) && (
          <GroupNav
            label={lang === "ar" ? "المشتريات والربح" : "Procurement & Profit"}
            icon={ShoppingCart}
            defaultOpen={
              location.pathname.startsWith("/purchase-orders") ||
              location.pathname.startsWith("/po-tracking") ||
              location.pathname.startsWith("/profit-calculator") ||
              location.pathname.startsWith("/profit-scenarios")
            }
          >
            <Link
              to="/purchase-orders"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 ps-9 text-sm font-medium transition ${
                location.pathname.startsWith("/purchase-orders")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <ShoppingCart className="h-4 w-4" /> {lang === "ar" ? "أوامر الشراء" : "Purchase Orders"}
            </Link>
            <Link
              to="/po-tracking"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 ps-9 text-sm font-medium transition ${
                location.pathname.startsWith("/po-tracking")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Activity className="h-4 w-4" /> {lang === "ar" ? "تتبع أوامر الشراء" : "PO Tracking"}
            </Link>
            {isCFO && (
              <>
                <Link
                  to="/profit-calculator"
                  onClick={() => setOpen(false)}
                  className={`group relative flex items-center gap-3 rounded-md px-3 py-2 ps-9 text-sm font-medium transition ${
                    location.pathname.startsWith("/profit-calculator")
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  }`}
                >
                  <Calculator className="h-4 w-4" /> {lang === "ar" ? "حاسبة الربح" : "Profit Calculator"}
                </Link>
                <Link
                  to="/profit-scenarios"
                  onClick={() => setOpen(false)}
                  className={`group relative flex items-center gap-3 rounded-md px-3 py-2 ps-9 text-sm font-medium transition ${
                    location.pathname.startsWith("/profit-scenarios")
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  }`}
                >
                  <ClipboardList className="h-4 w-4" /> {lang === "ar" ? "السيناريوهات المحفوظة" : "Saved Scenarios"}
                </Link>
              </>
            )}
          </GroupNav>
        )}
        <GroupNav
          label={t("reports")}
          icon={BarChart3}
          defaultOpen={
            location.pathname.startsWith("/sales-range") ||
            location.pathname.startsWith("/shipping-order") ||
            location.pathname.startsWith("/profits")
          }
        >
          <Link
            to="/sales-range"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/sales-range")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <BarChart3 className="h-4 w-4" /> {t("sales_range")}
          </Link>
          <Link
            to="/shipping-order"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/shipping-order")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <Truck className="h-4 w-4" /> {t("shipping_order")}
          </Link>
          {isExecutive && (
          <Link
            to="/profits"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/profits")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <TrendingUp className="h-4 w-4" /> {t("profits")}
          </Link>
          )}
        </GroupNav>
        {isCallCenter && (
          <GroupNav
            label={t("call_center_group")}
            icon={Phone}
            defaultOpen={
              location.pathname.startsWith("/call-center") ||
              location.pathname.startsWith("/call-center-reports")
            }
          >
            <Link
              to="/call-center"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
                location.pathname === "/call-center"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Phone className="h-4 w-4" /> {t("call_center")}
            </Link>
            <Link
              to="/call-center-reports"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
                location.pathname === "/call-center-reports"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <BarChart3 className="h-4 w-4" /> {t("call_center_reports")}
            </Link>
          </GroupNav>
        )}
        <GroupNav
          label={t("communication_group")}
          icon={MessagesSquare}
          defaultOpen={
            location.pathname.startsWith("/team-chat") ||
            location.pathname.startsWith("/whatsapp")
          }
        >
          <Link
            to="/team-chat"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/team-chat")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            <span className="flex-1">{t("team_chat")}</span>
            {chatUnread > 0 && (
              <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold text-sidebar-primary-foreground">
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </Link>
          <Link
            to="/whatsapp"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/whatsapp")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <Phone className="h-4 w-4" /> {t("whatsapp_inbox")}
          </Link>
        </GroupNav>
        <GroupNav
          label={t("settings")}
          icon={Settings}
          defaultOpen={
            location.pathname.startsWith("/settings") ||
            location.pathname.startsWith("/audit-log") ||
            location.pathname.startsWith("/pending-operations") ||
            location.pathname.startsWith("/admin")
          }
        >
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname === "/settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <Settings className="h-4 w-4" /> {t("settings")}
          </Link>
          {isExecutive && (
          <Link
            to="/audit-log"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/audit-log")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <ShieldCheck className="h-4 w-4" /> {t("audit_log")}
          </Link>
          )}
          <Link
            to="/pending-operations"
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
              location.pathname.startsWith("/pending-operations")
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            <CloudUpload className="h-4 w-4" /> {t("pending_operations")}
          </Link>
          {isAdmin && isExecutive && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md ps-9 pe-3 py-2 text-sm font-medium transition ${
                location.pathname.startsWith("/admin")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <ShieldCheck className="h-4 w-4" /> {t("admin_panel")}
            </Link>
          )}
        </GroupNav>
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 truncate px-2 text-[11px] tracking-wide text-sidebar-foreground/55">{user.email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="me-2 h-4 w-4" /> {t("logout")}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block no-print">{Sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden no-print">
          <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 z-10">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/40 ios-material px-4 pt-safe no-print">
          <Button variant="ghost" size="icon" className="lg:hidden press-spring ios-tap" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
            <span className="rounded-xl bg-[oklch(0.11_0.004_60)] px-2 py-1">
              <img src={brandLogo} alt="Steinheim" className="h-6 w-auto object-contain" />
            </span>
          </Link>
          <div className="flex-1" />
          <LangStatusPill />
          <NotificationsBell />
          <LowStockAlerts />
          <Button variant="ghost" size="icon" className="rounded-full press-spring ios-tap" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label="lang">
            <Languages className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full press-spring ios-tap" onClick={toggle} aria-label="theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 overflow-x-visible px-3 py-6 pb-tabbar sm:px-6 sm:py-8 lg:px-8 lg:pb-safe">
          <PageTransition>{children}</PageTransition>
        </main>
        <MobileTabBar onMore={() => setOpen(true)} />
        <XAssistant />
      </div>
    </div>
  );
}

function GroupNav({
  label,
  icon: Icon,
  defaultOpen,
  children,
}: {
  label: string;
  icon: any;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-start">{label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

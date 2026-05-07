import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Package, Boxes, FileText, BarChart3, Settings,
  Plus, Languages, Moon, Sun, LogOut, Menu, X, ClipboardList, ShieldCheck, ShoppingCart,
  Phone, Truck,
} from "lucide-react";
import { useState } from "react";
import { PageTransition } from "@/components/page-transition";
import brandLogo from "@/assets/steinheim-logo-white.png";
import { LowStockAlerts } from "@/components/low-stock-alerts";
import { useRole } from "@/lib/use-role";
import { NotificationsBell } from "@/components/notifications-bell";
import { LangStatusPill } from "@/components/lang-status-pill";

const items = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" as const },
  { to: "/customers", icon: Users, key: "customers" as const },
  { to: "/products", icon: Package, key: "products" as const },
  { to: "/inventory", icon: Boxes, key: "inventory" as const },
  { to: "/inventory-audit", icon: ClipboardList, key: "inventory_audit" as const },
  { to: "/sales-today", icon: ShoppingCart, key: "sales_today" as const },
  { to: "/sales-range", icon: BarChart3, key: "sales_range" as const },
  { to: "/shipping-order", icon: Truck, key: "shipping_order" as const },
  { to: "/invoices", icon: FileText, key: "invoices" as const },
  { to: "/reports", icon: BarChart3, key: "reports" as const },
  { to: "/audit-log", icon: ShieldCheck, key: "audit_log" as const },
  { to: "/settings", icon: Settings, key: "settings" as const },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { isAdmin, isCallCenter } = useRole();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

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
        {isCallCenter && (
          <>
            <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-sidebar-foreground/40">Call Center</div>
            <Link
              to="/call-center"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                location.pathname === "/call-center"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Phone className="h-4 w-4" /> مركز الاتصال
            </Link>
            <Link
              to="/call-center-reports"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                location.pathname === "/call-center-reports"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <BarChart3 className="h-4 w-4" /> تقارير الاتصال
            </Link>
          </>
        )}
        {isAdmin && (
          <>
            <div className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-sidebar-foreground/40">Admin</div>
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                location.pathname.startsWith("/admin")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <ShieldCheck className="h-4 w-4" /> لوحة الأدمن
            </Link>
          </>
        )}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 truncate px-2 text-[11px] tracking-wide text-sidebar-foreground/55">{user.email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => signOut()}
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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/40 glass px-4 pt-safe no-print">
          <Button variant="ghost" size="icon" className="lg:hidden tap-scale" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <Link to="/dashboard" className="flex items-center gap-2 lg:hidden">
            <span className="rounded-md bg-[oklch(0.11_0.004_60)] px-2 py-1">
              <img src={brandLogo} alt="Steinheim" className="h-6 w-auto object-contain" />
            </span>
          </Link>
          <div className="flex-1" />
          <LangStatusPill />
          <NotificationsBell />
          <LowStockAlerts />
          <Button variant="ghost" size="icon" className="rounded-full tap-scale" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label="lang">
            <Languages className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full tap-scale" onClick={toggle} aria-label="theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 overflow-x-hidden px-4 py-8 pb-safe sm:px-6 lg:px-8">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

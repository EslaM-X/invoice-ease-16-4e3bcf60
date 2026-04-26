import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Package, Boxes, FileText, BarChart3, Settings,
  Plus, Languages, Moon, Sun, LogOut, Menu, X, ClipboardList, ShieldCheck
} from "lucide-react";
import { useState } from "react";
import { PageTransition } from "@/components/page-transition";
import brandLogo from "@/assets/steinheim-logo.png";

const items = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" as const },
  { to: "/customers", icon: Users, key: "customers" as const },
  { to: "/products", icon: Package, key: "products" as const },
  { to: "/inventory", icon: Boxes, key: "inventory" as const },
  { to: "/inventory-audit", icon: ClipboardList, key: "inventory_audit" as const },
  { to: "/invoices", icon: FileText, key: "invoices" as const },
  { to: "/reports", icon: BarChart3, key: "reports" as const },
  { to: "/audit-log", icon: ShieldCheck, key: "audit_log" as const },
  { to: "/settings", icon: Settings, key: "settings" as const },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
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
      <div className="flex flex-col items-center gap-2 px-5 pb-4 pt-6">
        <img
          src={brandLogo}
          alt="Steinheim"
          className="h-14 w-auto select-none object-contain"
          draggable={false}
        />
        <div className="text-[10px] font-medium uppercase tracking-[0.32em] text-sidebar-primary">
          Invoice Suite
        </div>
      </div>
      <div className="mx-5 my-3 h-px bg-gradient-to-r from-transparent via-sidebar-primary/40 to-transparent" />
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        <Link to="/invoices/new" onClick={() => setOpen(false)}
          className="mb-3 flex items-center justify-center gap-2 rounded-lg gradient-gold px-3 py-2.5 text-sm font-semibold text-[oklch(0.12_0.005_60)] shadow-glow transition active:scale-[0.98]">
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
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              {active && (
                <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-sidebar-primary" />
              )}
              <Icon className={`h-4 w-4 ${active ? "text-sidebar-primary" : ""}`} /> {t(it.key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 truncate px-2 text-xs text-sidebar-foreground/60">{user.email}</div>
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
      <div className="hidden lg:block">{Sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 start-0 z-10">{Sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/40 glass px-4 pt-safe no-print">
          <Button variant="ghost" size="icon" className="lg:hidden tap-scale" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex-1" />
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

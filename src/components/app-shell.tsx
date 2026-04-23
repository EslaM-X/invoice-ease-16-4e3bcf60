import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Users, Package, Boxes, FileText, BarChart3, Settings,
  Plus, Languages, Moon, Sun, LogOut, Menu, X
} from "lucide-react";
import { useState } from "react";

const items = [
  { to: "/dashboard", icon: LayoutDashboard, key: "dashboard" as const },
  { to: "/customers", icon: Users, key: "customers" as const },
  { to: "/products", icon: Package, key: "products" as const },
  { to: "/inventory", icon: Boxes, key: "inventory" as const },
  { to: "/invoices", icon: FileText, key: "invoices" as const },
  { to: "/reports", icon: BarChart3, key: "reports" as const },
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
    <aside className="flex h-full w-60 flex-col border-e border-border/60 bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-primary shadow-glow">
          <FileText className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">{t("app_name")}</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        <Link to="/invoices/new" onClick={() => setOpen(false)}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl gradient-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition active:scale-[0.98]">
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
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {t(it.key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border/60 p-3">
        <div className="mb-2 truncate px-2 text-xs text-muted-foreground">{user.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => signOut()}>
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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/40 glass px-4 no-print">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label="lang">
            <Languages className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={toggle} aria-label="theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 overflow-x-hidden px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

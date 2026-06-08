import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Package, Users, MoreHorizontal } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type TabItem = {
  to: string;
  icon: typeof LayoutDashboard;
  labelAr: string;
  labelEn: string;
  match: (path: string) => boolean;
};

const tabs: TabItem[] = [
  {
    to: "/dashboard",
    icon: LayoutDashboard,
    labelAr: "الرئيسية",
    labelEn: "Home",
    match: (p) => p === "/dashboard" || p === "/",
  },
  {
    to: "/invoices",
    icon: FileText,
    labelAr: "الفواتير",
    labelEn: "Invoices",
    match: (p) => p.startsWith("/invoices"),
  },
  {
    to: "/products",
    icon: Package,
    labelAr: "المنتجات",
    labelEn: "Products",
    match: (p) => p.startsWith("/products") || p.startsWith("/inventory"),
  },
  {
    to: "/customers",
    icon: Users,
    labelAr: "العملاء",
    labelEn: "Customers",
    match: (p) => p.startsWith("/customers"),
  },
];

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const location = useLocation();
  const { lang } = useI18n();

  return (
    <nav
      className="ios-tabbar fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around px-2 pb-safe pt-1.5 lg:hidden no-print"
      aria-label="Bottom navigation"
    >
      {tabs.map((tab) => {
        const active = tab.match(location.pathname);
        const Icon = tab.icon;
        const label = lang === "ar" ? tab.labelAr : tab.labelEn;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            data-active={active}
            className={`tabbar-pill press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-medium transition-colors ${
              active ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon className={`h-[22px] w-[22px] transition-transform ease-ios ${active ? "scale-110" : ""}`} strokeWidth={active ? 2.4 : 1.8} />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors"
      >
        <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.8} />
        <span className="truncate">{lang === "ar" ? "المزيد" : "More"}</span>
      </button>
    </nav>
  );
}

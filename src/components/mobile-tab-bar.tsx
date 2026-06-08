import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, FileText, Package, Users, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

type TabItem = {
  to: string;
  icon: typeof LayoutDashboard;
  labelAr: string;
  labelEn: string;
  match: (path: string) => boolean;
};

const tabs: TabItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, labelAr: "الرئيسية", labelEn: "Home", match: (p) => p === "/dashboard" || p === "/" },
  { to: "/invoices", icon: FileText, labelAr: "الفواتير", labelEn: "Invoices", match: (p) => p.startsWith("/invoices") },
  { to: "/products", icon: Package, labelAr: "المنتجات", labelEn: "Products", match: (p) => p.startsWith("/products") || p.startsWith("/inventory") },
  { to: "/customers", icon: Users, labelAr: "العملاء", labelEn: "Customers", match: (p) => p.startsWith("/customers") },
];

const ITEMS = tabs.length + 1; // +1 for "More"

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const location = useLocation();
  const { lang } = useI18n();
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number; visible: boolean }>({ left: 0, width: 0, visible: false });
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  const activeIndex = (() => {
    const i = tabs.findIndex((t) => t.match(location.pathname));
    return i;
  })();

  // Position the sliding indicator under the active tab
  useLayoutEffect(() => {
    const update = () => {
      if (activeIndex < 0) {
        setIndicator((s) => ({ ...s, visible: false }));
        return;
      }
      const nav = navRef.current;
      const el = itemRefs.current[activeIndex];
      if (!nav || !el) return;
      const navRect = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setIndicator({ left: r.left - navRect.left, width: r.width, visible: true });
    };
    update();
    const ro = new ResizeObserver(update);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, [activeIndex, lang]);

  // Smart hide on scroll-down, reveal on scroll-up
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastScrollY.current;
        if (Math.abs(dy) > 8) {
          if (dy > 0 && y > 120) setHidden(true);
          else setHidden(false);
          lastScrollY.current = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const triggerHaptic = () => {
    try { (navigator as any)?.vibrate?.(8); } catch { /* noop */ }
  };

  return (
    <nav
      ref={navRef}
      data-hidden={hidden}
      className="ios-tabbar tabbar-smart fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around px-2 pb-safe pt-1.5 lg:hidden no-print"
      aria-label="Bottom navigation"
      style={{ ['--tab-count' as any]: ITEMS }}
    >
      <span
        aria-hidden
        className="tabbar-indicator"
        data-visible={indicator.visible}
        style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
      />
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        const Icon = tab.icon;
        const label = lang === "ar" ? tab.labelAr : tab.labelEn;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            ref={(el) => { itemRefs.current[i] = el as unknown as HTMLElement; }}
            data-active={active}
            onClick={triggerHaptic}
            preload="intent"
            className={`tabbar-item press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-[10px] font-medium transition-colors ${
              active ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon className={`tabbar-icon h-[22px] w-[22px] transition-transform ease-ios ${active ? "scale-110" : ""}`} strokeWidth={active ? 2.4 : 1.8} />
            <span className="truncate max-w-full">{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => { triggerHaptic(); onMore(); }}
        ref={(el) => { itemRefs.current[tabs.length] = el; }}
        className="tabbar-item press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors"
      >
        <MoreHorizontal className="tabbar-icon h-[22px] w-[22px]" strokeWidth={1.8} />
        <span className="truncate max-w-full">{lang === "ar" ? "المزيد" : "More"}</span>
      </button>
    </nav>
  );
}

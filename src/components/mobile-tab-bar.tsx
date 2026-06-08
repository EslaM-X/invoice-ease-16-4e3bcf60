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

// Detect user preference for reduced motion (also disables haptics for comfort)
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const location = useLocation();
  const { lang } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
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

  // Smart hide on scroll-down, reveal on scroll-up — disabled when reduced motion is on
  useEffect(() => {
    if (reducedMotion) {
      setHidden(false);
      return;
    }
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
  }, [reducedMotion]);

  const triggerHaptic = () => {
    if (reducedMotion) return;
    try { (navigator as any)?.vibrate?.(8); } catch { /* noop */ }
  };

  const moreLabel = lang === "ar" ? "المزيد" : "More";
  const navLabel = lang === "ar" ? "شريط التنقل السفلي" : "Bottom navigation";

  return (
    <nav
      ref={navRef}
      data-hidden={hidden}
      className="ios-tabbar tabbar-smart fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around px-2 pb-safe pt-1.5 lg:hidden no-print"
      aria-label={navLabel}
      role="navigation"
      style={{ ['--tab-count' as any]: ITEMS }}
    >
      <ul role="tablist" className="contents">
        <span
          aria-hidden="true"
          className="tabbar-indicator"
          data-visible={indicator.visible}
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
        {tabs.map((tab, i) => {
          const active = i === activeIndex;
          const Icon = tab.icon;
          const label = lang === "ar" ? tab.labelAr : tab.labelEn;
          return (
            <li key={tab.to} role="presentation" className="flex flex-1">
              <Link
                to={tab.to}
                ref={(el) => { itemRefs.current[i] = el as unknown as HTMLElement; }}
                data-active={active}
                onClick={triggerHaptic}
                preload="intent"
                role="tab"
                aria-current={active ? "page" : undefined}
                aria-selected={active}
                aria-label={label}
                className={`tabbar-item press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 min-h-11 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon aria-hidden="true" className={`tabbar-icon h-[22px] w-[22px] transition-transform ease-ios ${active ? "scale-110" : ""}`} strokeWidth={active ? 2.4 : 1.8} />
                <span className="truncate max-w-full">{label}</span>
              </Link>
            </li>
          );
        })}
        <li role="presentation" className="flex flex-1">
          <button
            type="button"
            onClick={() => { triggerHaptic(); onMore(); }}
            ref={(el) => { itemRefs.current[tabs.length] = el; }}
            aria-label={moreLabel}
            aria-haspopup="menu"
            className="tabbar-item press-spring ios-tap flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1 min-h-11 text-[10px] font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <MoreHorizontal aria-hidden="true" className="tabbar-icon h-[22px] w-[22px]" strokeWidth={1.8} />
            <span className="truncate max-w-full">{moreLabel}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mount `children` only when the wrapper scrolls near the viewport.
 * SSR-safe: if IntersectionObserver is missing, mounts immediately.
 * Once mounted, stays mounted (no unmount on scroll away).
 *
 * Use to defer heavy below-the-fold cards so the top of the page paints
 * instantly instead of every child fetching + rendering on first paint.
 */
export function LazyMount({
  children,
  rootMargin = "600px",
  minHeight = 160,
  className,
}: {
  children: ReactNode;
  rootMargin?: string;
  /** Reserve vertical space so lazy mounts don't cause layout jump. */
  minHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") { setVisible(true); return; }
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref} className={className} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  );
}

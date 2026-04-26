import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wraps page content with a smooth fade/slide transition on route change.
 * Auto-disabled when the user prefers reduced motion (weak devices,
 * accessibility) — the content still renders, just without animation.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [content, setContent] = useState(children);
  const [key, setKey] = useState(location.pathname);
  const reduceMotion = useReducedMotion();
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (location.pathname !== prevPath.current) {
      prevPath.current = location.pathname;
      setKey(location.pathname);
    }
    setContent(children);
  }, [children, location.pathname]);

  return (
    <div
      key={key}
      className={reduceMotion ? "" : "page-transition"}
      style={{ willChange: reduceMotion ? undefined : "opacity, transform" }}
    >
      {content}
    </div>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

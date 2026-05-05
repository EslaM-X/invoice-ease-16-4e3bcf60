import { useEffect, useState } from "react";

const KEY = "hide_numbers_v1";

/** Toggle to hide sensitive numbers (revenue, sales) on dashboard. Persists locally. */
export function useHideNumbers() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHidden(localStorage.getItem(KEY) === "1");
  }, []);

  const toggle = () => {
    setHidden((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  };

  const mask = (val: string | number) => (hidden ? "•••••" : String(val));

  return { hidden, toggle, mask };
}

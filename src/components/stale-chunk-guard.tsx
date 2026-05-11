// After a new deploy, the browser may still reference old JS chunk file
// names. When dynamic import fails (chunk 404 / network error), reload once
// to pick up the fresh asset manifest. Reload is throttled per session to
// avoid loops on real network failures.
import { useEffect } from "react";

const RELOAD_KEY = "stein.staleChunkReloadAt";
const COOLDOWN_MS = 30_000;

function shouldReload(): boolean {
  try {
    const last = sessionStorage.getItem(RELOAD_KEY);
    if (last && Date.now() - Number(last) < COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

function isChunkLoadError(reason: unknown): boolean {
  if (!reason) return false;
  const msg =
    typeof reason === "string"
      ? reason
      : (reason as any)?.message ?? String((reason as any) ?? "");
  return (
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    (typeof (reason as any)?.name === "string" && (reason as any).name === "ChunkLoadError")
  );
}

export function StaleChunkGuard() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error ?? event.message) && shouldReload()) {
        window.location.reload();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason) && shouldReload()) {
        window.location.reload();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

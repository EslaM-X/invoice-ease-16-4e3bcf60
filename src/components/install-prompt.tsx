import { useEffect, useState } from "react";
import { Download, Share2, X, Apple, Smartphone } from "lucide-react";

/**
 * Universal install prompt:
 *  - Android/Chromium → uses native beforeinstallprompt event
 *  - iOS Safari → shows manual "Add to Home Screen" instructions
 *  - macOS Safari → shows "File → Add to Dock" instructions
 * Dismissed preference persisted in localStorage for 14 days.
 */

type Deferred = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "install_prompt_dismissed_at";
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function platformOf(): "ios" | "macos-safari" | "android" | "desktop" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  if (isIOS) return "ios";
  const isMac = /Macintosh/.test(ua);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  if (isMac && isSafari) return "macos-safari";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function dismissed() {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() - Number(v) < DISMISS_MS;
  } catch { return false; }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<Deferred | null>(null);
  const [open, setOpen] = useState(false);
  const [platform] = useState(platformOf());

  useEffect(() => {
    if (isStandalone() || dismissed()) return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as Deferred);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onBip as any);

    // Show iOS / macOS Safari instructions after short delay (no native event)
    if (platform === "ios" || platform === "macos-safari") {
      const t = setTimeout(() => setOpen(true), 4000);
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onBip as any); };
    }
    return () => window.removeEventListener("beforeinstallprompt", onBip as any);
  }, [platform]);

  const close = (persist = true) => {
    setOpen(false);
    if (persist) try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  const installNative = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {}
    close();
  };

  if (!open) return null;

  const isApple = platform === "ios" || platform === "macos-safari";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[55] flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),12px)] no-print">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/15 text-primary">
            {isApple ? <Apple className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold">ثبّت Steinheim Suite كتطبيق</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              للوصول السريع وعمل أفضل بدون شريط المتصفح.
            </p>

            {platform === "ios" && (
              <ol className="mt-3 space-y-1 text-xs text-foreground/90">
                <li className="flex items-center gap-1.5">
                  <span className="text-primary">١.</span> اضغط زر المشاركة
                  <Share2 className="inline h-3.5 w-3.5 text-primary" /> في Safari
                </li>
                <li><span className="text-primary">٢.</span> اختر <b>Add to Home Screen</b></li>
                <li><span className="text-primary">٣.</span> اضغط <b>Add</b></li>
              </ol>
            )}

            {platform === "macos-safari" && (
              <ol className="mt-3 space-y-1 text-xs text-foreground/90">
                <li><span className="text-primary">١.</span> من القائمة اختر <b>File</b></li>
                <li><span className="text-primary">٢.</span> اختر <b>Add to Dock…</b></li>
                <li><span className="text-primary">٣.</span> اضغط <b>Add</b></li>
              </ol>
            )}

            {!isApple && deferred && (
              <button
                onClick={installNative}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" /> تثبيت الآن
              </button>
            )}

            {!isApple && !deferred && (
              <p className="mt-3 text-xs text-muted-foreground">
                من قائمة المتصفح اختر <b>Install app</b> أو أيقونة التثبيت ⊕ في شريط العنوان.
              </p>
            )}
          </div>
          <button
            onClick={() => close(true)}
            aria-label="dismiss"
            className="flex-none rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

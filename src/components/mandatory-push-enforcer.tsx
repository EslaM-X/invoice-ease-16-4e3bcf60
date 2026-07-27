import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, Loader2, Share, Plus, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { readLocalPush, clearLocalPush } from "@/lib/device-id";

/**
 * Platform-aware mandatory push enforcement.
 *
 * Guarantees that every user on every device/browser is prompted to enable
 * notifications so incoming calls and alerts always ring:
 *
 * - Chrome / Edge / Firefox / Opera / Brave (any OS): shows a one-tap
 *   "تفعيل الآن" button that triggers the standard permission prompt.
 * - macOS Safari 16.4+: same one-tap button.
 * - iOS/iPadOS Safari: Push works ONLY after adding to Home Screen. Shows
 *   a dedicated PWA install banner with step-by-step instructions.
 * - Denied state on any platform: shows platform-specific settings
 *   instructions plus a reload button.
 * - Once granted on a device, the banner never shows again on that device.
 */

type PlatformInfo = {
  os: "ios" | "android" | "macos" | "windows" | "linux" | "other";
  browser: "safari" | "chrome" | "firefox" | "edge" | "opera" | "brave" | "other";
  isStandalone: boolean;
  needsPwaInstall: boolean; // true = must install to Home Screen before push works
};

function detectPlatform(): PlatformInfo {
  if (typeof navigator === "undefined") {
    return { os: "other", browser: "other", isStandalone: false, needsPwaInstall: false };
  }
  const ua = navigator.userAgent || "";
  const uaData: any = (navigator as any).userAgentData;

  // OS
  let os: PlatformInfo["os"] = "other";
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && (navigator as any).maxTouchPoints > 1)) os = "ios";
  else if (/Android/.test(ua)) os = "android";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macos";
  else if (/Windows/.test(ua)) os = "windows";
  else if (/Linux/.test(ua)) os = "linux";

  // Browser
  let browser: PlatformInfo["browser"] = "other";
  if (/Edg\//.test(ua)) browser = "edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "opera";
  else if ((navigator as any).brave?.isBrave) browser = "brave";
  else if (/Firefox/.test(ua)) browser = "firefox";
  else if (/Chrome\//.test(ua) && !/Edg\/|OPR\//.test(ua)) browser = "chrome";
  else if (/Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua)) browser = "safari";
  // iOS: Chrome/Firefox/Edge on iOS are all Safari underneath
  if (os === "ios") {
    if (/CriOS/.test(ua)) browser = "chrome";
    else if (/FxiOS/.test(ua)) browser = "firefox";
    else if (/EdgiOS/.test(ua)) browser = "edge";
    else browser = "safari";
  }

  const isStandalone =
    (typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true)) ||
    false;

  // iOS requires PWA install for Push API. Everyone else works in-browser.
  const needsPwaInstall = os === "ios" && !isStandalone;

  return { os, browser, isStandalone, needsPwaInstall };
}

export function MandatoryPushEnforcer() {
  const { user } = useAuth();
  const { supported, permission, subscribed, enablePush, loading } =
    usePushNotifications();
  const forcedRef = useRef(false);
  const attemptedRef = useRef(false);

  const platform = useMemo(() => detectPlatform(), []);
  const localRecord = useMemo(() => readLocalPush(), []);
  const [locallyEnabled, setLocallyEnabled] = useState<boolean>(!!localRecord);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("mandatory_push_dismissed_v1") === "1"; } catch { return false; }
  });
  const handleDismiss = () => {
    try { sessionStorage.setItem("mandatory_push_dismissed_v1", "1"); } catch {}
    setDismissed(true);
  };

  const markBrowserReturnedFromSettings = () => {
    try { sessionStorage.setItem("mandatory_push_returned_from_settings_v1", "1"); } catch {}
  };
  const canRetryAfterSettings = () => {
    try { return sessionStorage.getItem("mandatory_push_returned_from_settings_v1") === "1"; } catch { return false; }
  };

  // 1) Force push_enabled=true in DB — idempotent per session.
  useEffect(() => {
    if (!user || forcedRef.current) return;
    forcedRef.current = true;
    void supabase
      .from("user_notification_preferences")
      .upsert({ user_id: user.id, push_enabled: true }, { onConflict: "user_id" });
  }, [user]);

  // 2) Realtime "known devices" keep-alive.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`push-subs-${user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "push_subscriptions", filter: `user_id=eq.${user.id}` },
        () => {})
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // 3) Silent re-attach when previously enabled here.
  useEffect(() => {
    if (!user || !supported || permission !== "granted") return;
    if (!locallyEnabled || subscribed || attemptedRef.current) return;
    attemptedRef.current = true;
    void enablePush().catch(() => {});
  }, [user, supported, permission, subscribed, locallyEnabled, enablePush]);

  // Retry after settings change.
  useEffect(() => {
    if (!user || !supported || permission !== "granted") return;
    if (subscribed || attemptedRef.current) return;
    if (!locallyEnabled && !canRetryAfterSettings()) return;
    attemptedRef.current = true;
    void enablePush().then((ok) => { if (ok) setLocallyEnabled(true); }).catch(() => {});
  }, [user, supported, permission, subscribed, locallyEnabled, enablePush]);

  // 4) Forget local flag on revoke.
  useEffect(() => {
    if (permission === "denied" || permission === "default") {
      if (locallyEnabled) { clearLocalPush(); setLocallyEnabled(false); }
    }
  }, [permission, locallyEnabled]);

  const handleEnable = async () => {
    const ok = await enablePush();
    if (ok) setLocallyEnabled(true);
  };

  const handleReloadAfterSettings = async () => {
    markBrowserReturnedFromSettings();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const ok = await enablePush();
      if (ok) { setLocallyEnabled(true); return; }
    }
    window.location.reload();
  };

  // ---- Visibility rules --------------------------------------------------
  if (!user) return null;
  if (dismissed) return null;

  // iOS Safari not-installed → PWA install banner (Push requires PWA on iOS).
  if (platform.needsPwaInstall) {
    return (
      <IosInstallBanner browser={platform.browser} />
    );
  }

  if (!supported) return null;

  // Silent state: already granted (subscribed or will re-attach).
  if (permission === "granted" && (subscribed || locallyEnabled)) return null;

  const denied = permission === "denied";

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[9999] border-b border-amber-500/40 bg-gradient-to-b from-amber-500/95 to-amber-600/95 px-4 py-3 text-black shadow-2xl backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {denied ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <Bell className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <div className="text-sm leading-relaxed">
            <strong className="font-semibold">
              الإشعارات مطلوبة على هذا الجهاز/المتصفح.
            </strong>{" "}
            {denied ? (
              <span>
                تم حجب الإشعارات. {settingsHintFor(platform)} ثم أعد تحميل الصفحة.
              </span>
            ) : (
              <span>
                من فضلك اضغط "تفعيل الآن" واقبل طلب الإذن — التفعيل يتم لمرة
                واحدة فقط لكل جهاز أو متصفح جديد.
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 self-end sm:self-auto">
          {denied ? (
            <Button size="sm" variant="secondary"
              className="bg-black text-amber-100 hover:bg-black/80"
              onClick={() => void handleReloadAfterSettings()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              أعدت التفعيل — إعادة تحميل
            </Button>
          ) : (
            <Button size="sm"
              className="bg-black text-amber-100 hover:bg-black/80"
              onClick={() => void handleEnable()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
              تفعيل الآن
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-black hover:bg-black/10"
            onClick={handleDismiss}>
            إخفاء
          </Button>
              onClick={() => void handleEnable()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
              تفعيل الآن
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function settingsHintFor(p: PlatformInfo): string {
  if (p.os === "macos" && p.browser === "safari")
    return "افتح Safari → Settings → Websites → Notifications واسمح لهذا الموقع";
  if (p.os === "ios")
    return "افتح Settings → Notifications → اسم التطبيق وفعّل Allow Notifications";
  if (p.os === "android")
    return "افتح إعدادات المتصفح → إعدادات الموقع → الإشعارات وفعّلها";
  if (p.browser === "chrome" || p.browser === "edge" || p.browser === "brave" || p.browser === "opera")
    return "اضغط على أيقونة القفل بجانب العنوان → Site settings → Notifications → Allow";
  if (p.browser === "firefox")
    return "اضغط على أيقونة القفل بجانب العنوان → Connection Secure → المزيد من المعلومات → Permissions → Notifications → Allow";
  return "افتح إعدادات الموقع في متصفحك واسمح بالإشعارات";
}

function IosInstallBanner({ browser }: { browser: PlatformInfo["browser"] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  // On iOS, only Safari can install PWAs. Chrome/Firefox/Edge on iOS must
  // open the site in Safari first.
  const inSafari = browser === "safari";

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[9999] border-b border-amber-500/40 bg-gradient-to-b from-amber-500/95 to-amber-600/95 px-4 py-3 text-black shadow-2xl backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm leading-relaxed">
            <strong className="font-semibold">
              فعّل الإشعارات على iPhone/iPad — إضافة إلى الشاشة الرئيسية مطلوبة
            </strong>
            {inSafari ? (
              <ol className="mt-1 list-decimal space-y-0.5 ps-5">
                <li>اضغط زر المشاركة <Share className="inline h-4 w-4" /> بأسفل Safari.</li>
                <li>اختر "أضف إلى الشاشة الرئيسية" <Plus className="inline h-4 w-4" />.</li>
                <li>اضغط "إضافة"، ثم افتح التطبيق من أيقونته الجديدة.</li>
                <li>سيظهر لك زر "تفعيل الإشعارات" — اقبل الطلب.</li>
              </ol>
            ) : (
              <div className="mt-1">
                افتح هذا الموقع في متصفح <strong>Safari</strong> على iPhone/iPad أولاً،
                ثم اضغط "أضف إلى الشاشة الرئيسية" لتفعيل الإشعارات والمكالمات.
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="text-black hover:bg-black/10"
            onClick={() => setDismissed(true)}>
            فهمت
          </Button>
        </div>
      </div>
    </div>
  );
}

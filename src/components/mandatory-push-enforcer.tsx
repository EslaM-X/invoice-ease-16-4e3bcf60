import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { readLocalPush, clearLocalPush } from "@/lib/device-id";

/**
 * Mandatory push enforcement — per-device memory:
 *
 * - After the user grants permission ONCE on a device/browser, we remember
 *   it in localStorage AND record the subscription (device_label + endpoint)
 *   in `push_subscriptions`. The banner never appears again on that device.
 * - Only re-prompts when the device is truly new, the browser subscription
 *   was lost, or the user revoked permission at the OS/browser level.
 * - Realtime channel keeps subscription state fresh across sessions without
 *   noisy focus/visibility retries.
 */
export function MandatoryPushEnforcer() {
  const { user } = useAuth();
  const { supported, permission, subscribed, enablePush, loading } =
    usePushNotifications();
  const forcedRef = useRef(false);
  const attemptedRef = useRef(false);

  // Read the per-browser "already enabled here" flag exactly once.
  const localRecord = useMemo(() => readLocalPush(), []);
  // Also track a live copy so we can hide the banner immediately after
  // the user enables push in this same session.
  const [locallyEnabled, setLocallyEnabled] = useState<boolean>(!!localRecord);

  const markBrowserReturnedFromSettings = () => {
    try {
      sessionStorage.setItem("mandatory_push_returned_from_settings_v1", "1");
    } catch { /* ignore */ }
  };

  const canRetryAfterSettings = () => {
    try {
      return sessionStorage.getItem("mandatory_push_returned_from_settings_v1") === "1";
    } catch {
      return false;
    }
  };

  // 1) Force push_enabled=true in DB — idempotent, once per session per user.
  useEffect(() => {
    if (!user || forcedRef.current) return;
    forcedRef.current = true;
    void supabase
      .from("user_notification_preferences")
      .upsert(
        { user_id: user.id, push_enabled: true },
        { onConflict: "user_id" },
      );
  }, [user]);

  // 2) Realtime: refresh our "known devices" view when push_subscriptions changes.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`push-subs-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "push_subscriptions", filter: `user_id=eq.${user.id}` },
        () => { /* purely informational for now */ },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // 3) If the user already enabled on THIS device previously and permission
  //    is still granted, silently re-attach the subscription if the browser
  //    dropped it (rare, e.g. cleared site data). No prompts, no banner.
  useEffect(() => {
    if (!user || !supported) return;
    if (permission !== "granted") return;
    if (!locallyEnabled) return;
    if (subscribed) return;
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    void enablePush().catch(() => { /* silent */ });
  }, [user, supported, permission, subscribed, locallyEnabled, enablePush]);

  // If the user changed site settings and came back, retry once after reload.
  // This covers browsers where `Notification.permission` updates to granted,
  // but the Push subscription has not been recreated yet.
  useEffect(() => {
    if (!user || !supported) return;
    if (permission !== "granted") return;
    if (subscribed || attemptedRef.current) return;
    if (!locallyEnabled && !canRetryAfterSettings()) return;
    attemptedRef.current = true;
    void enablePush().then((ok) => {
      if (ok) setLocallyEnabled(true);
    }).catch(() => { /* silent */ });
  }, [user, supported, permission, subscribed, locallyEnabled, enablePush]);

  // 4) If permission was revoked or reset, forget the local flag so the
  //    next attempt reprompts explicitly.
  useEffect(() => {
    if (permission === "denied" || permission === "default") {
      if (locallyEnabled) {
        clearLocalPush();
        setLocallyEnabled(false);
      }
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
      if (ok) {
        setLocallyEnabled(true);
        return;
      }
    }
    window.location.reload();
  };

  // ---- Visibility rules --------------------------------------------------
  if (!user || !supported) return null;
  // Silent state: already granted (and either subscribed or will re-attach silently).
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
                تم حجب الإشعارات من إعدادات المتصفح/النظام. افتح إعدادات الموقع
                واسمح بالإشعارات ثم أعد تحميل الصفحة. بعد التفعيل مرة واحدة
                على هذا الجهاز لن يظهر هذا التنبيه مجدداً.
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
            <Button
              size="sm"
              variant="secondary"
              className="bg-black text-amber-100 hover:bg-black/80"
              onClick={() => void handleReloadAfterSettings()}
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              أعدت التفعيل — إعادة تحميل
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-black text-amber-100 hover:bg-black/80"
              onClick={() => void handleEnable()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Bell className="mr-2 h-4 w-4" />
              )}
              تفعيل الآن
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

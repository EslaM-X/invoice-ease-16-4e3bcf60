import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mandatory push enforcement:
 * - Force `push_enabled = true` in DB for every user (cannot be disabled).
 * - Auto-request browser permission on load / after user interaction.
 * - Auto-subscribe once permission is granted.
 * - Re-subscribe on visibility/focus/online if subscription vanished.
 * - Show a blocking banner if the user has denied notifications, telling
 *   them how to re-enable at the browser/OS level (only place a manual
 *   step is possible since browsers don't allow silent overrides).
 */
export function MandatoryPushEnforcer() {
  const { user } = useAuth();
  const { supported, permission, subscribed, enablePush, loading } =
    usePushNotifications();
  const forcedRef = useRef(false);
  const [attempts, setAttempts] = useState(0);

  // 1) Force push_enabled=true in DB (idempotent, once per session per user)
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

  // 2) Auto-request + auto-subscribe
  useEffect(() => {
    if (!user || !supported) return;
    if (permission === "granted" && subscribed) return;
    if (permission === "denied") return;

    let cancelled = false;
    const tryEnable = async () => {
      if (cancelled) return;
      try {
        await enablePush();
      } catch {
        /* retry on next trigger */
      }
    };

    // Immediate attempt (may be blocked by browsers requiring a gesture)
    void tryEnable();

    // Retry on any user interaction (satisfies gesture requirement)
    const onInteract = () => void tryEnable();
    window.addEventListener("pointerdown", onInteract, { once: true });
    window.addEventListener("keydown", onInteract, { once: true });

    // Retry on focus / visibility / network changes
    const onWake = () => {
      setAttempts((a) => a + 1);
      void tryEnable();
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [user, supported, permission, subscribed, enablePush, attempts]);

  if (!user || !supported) return null;
  if (permission === "granted") return null;

  // Blocking banner — only path when browser blocks silent enable
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
              الإشعارات مطلوبة لهذا الحساب.
            </strong>{" "}
            {denied ? (
              <span>
                تم حجب الإشعارات من إعدادات المتصفح/النظام. افتح إعدادات الموقع
                واسمح بالإشعارات ثم أعد تحميل الصفحة — لا يمكن الاستمرار في
                استقبال المكالمات والتنبيهات بدون تفعيلها.
              </span>
            ) : (
              <span>
                من فضلك اضغط "تفعيل الآن" واقبل طلب الإذن — التفعيل إلزامي.
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
              onClick={() => window.location.reload()}
            >
              أعدت التفعيل — إعادة تحميل
            </Button>
          ) : (
            <Button
              size="sm"
              className="bg-black text-amber-100 hover:bg-black/80"
              onClick={() => void enablePush()}
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

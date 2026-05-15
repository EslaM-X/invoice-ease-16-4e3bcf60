import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  VAPID_PUBLIC_KEY,
  urlBase64ToUint8Array,
  playSoundPreset,
  type SoundPreset,
  type VibrationPreset,
} from "@/lib/push";

export type NotifPrefs = {
  push_enabled: boolean;
  sound: SoundPreset;
  vibration: VibrationPreset;
};

const DEFAULTS: NotifPrefs = { push_enabled: true, sound: "default", vibration: "default" };

export function usePushNotifications() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULTS);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // Load prefs + current sub state
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_notification_preferences")
        .select("push_enabled, sound, vibration")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setPrefs(data as NotifPrefs);

      if (supported) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setSubscribed(!!sub);
      }
    })();
  }, [user, supported]);

  // SW -> client messages: play sound on push
  useEffect(() => {
    if (!supported) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === "PUSH_SOUND") playSoundPreset((d.sound as SoundPreset) || prefs.sound);
      if (d?.type === "NAVIGATE" && d.url) window.location.href = d.url;
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [prefs.sound, supported]);

  const savePrefs = useCallback(
    async (next: Partial<NotifPrefs>) => {
      if (!user) return;
      const merged = { ...prefs, ...next };
      setPrefs(merged);
      await supabase
        .from("user_notification_preferences")
        .upsert({ user_id: user.id, ...merged }, { onConflict: "user_id" });
    },
    [user, prefs],
  );

  const enablePush = useCallback(async () => {
    if (!user || !supported) return false;
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return false;

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const json: any = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      await savePrefs({ push_enabled: true });
      setSubscribed(true);
      return true;
    } finally {
      setLoading(false);
    }
  }, [user, supported, savePrefs]);

  const disablePush = useCallback(async () => {
    if (!user || !supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      await savePrefs({ push_enabled: false });
      setSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, [user, supported, savePrefs]);

  const testNotification = useCallback(
    (title = "إشعار تجريبي", body = "هذا اختبار للنغمة والاهتزاز الذي اخترته") => {
      // Local preview — does not require server push
      if (navigator.vibrate) {
        const pattern: Record<VibrationPreset, number[]> = {
          default: [200, 100, 200],
          short: [80],
          long: [600],
          pulse: [120, 80, 120, 80, 120, 80, 400],
          off: [],
        };
        navigator.vibrate(pattern[prefs.vibration] ?? []);
      }
      playSoundPreset(prefs.sound);
      if (permission === "granted") {
        navigator.serviceWorker.getRegistration().then((reg) => {
          reg?.showNotification(title, { body, icon: "/icon-192.png" });
        });
      }
    },
    [prefs, permission],
  );

  return {
    supported,
    permission,
    subscribed,
    prefs,
    loading,
    savePrefs,
    enablePush,
    disablePush,
    testNotification,
  };
}

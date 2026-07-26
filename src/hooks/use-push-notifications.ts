import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { shouldDisablePwaFeatures } from "@/lib/pwa-runtime";
import {
  VAPID_PUBLIC_KEY,
  urlBase64ToUint8Array,
  playSoundPreset,
  type SoundPreset,
  type VibrationPreset,
} from "@/lib/push";
import { getDeviceId, getDeviceLabel, writeLocalPush, clearLocalPush } from "@/lib/device-id";

export type NotifPrefs = {
  push_enabled: boolean;
  sound: SoundPreset;
  vibration: VibrationPreset;
  custom_sound_url: string | null;
  custom_sound_name: string | null;
};

const DEFAULTS: NotifPrefs = {
  push_enabled: true,
  sound: "default",
  vibration: "default",
  custom_sound_url: null,
  custom_sound_name: null,
};

export function usePushNotifications() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULTS);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const readPermission = useCallback((): NotificationPermission => {
    return typeof Notification !== "undefined" ? Notification.permission : "default";
  }, []);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !shouldDisablePwaFeatures();

  const refreshSubscription = useCallback(async () => {
    setPermission(readPermission());
    if (!supported) {
      setSubscribed(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    } catch {
      setSubscribed(false);
    }
  }, [readPermission, supported]);

  // Load prefs + current sub state
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_notification_preferences")
        .select("push_enabled, sound, vibration, custom_sound_url, custom_sound_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setPrefs({ ...DEFAULTS, ...(data as Partial<NotifPrefs>) });

      await refreshSubscription();
    })();
  }, [user, refreshSubscription]);

  // Keep permission state fresh when the user changes browser/site settings
  // then returns to the app. Without this, the mandatory banner can continue
  // showing the old "denied" state until a full hard reload.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    let permissionStatus: PermissionStatus | null = null;
    let disposed = false;
    const refresh = () => { void refreshSubscription(); };

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);

    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "notifications" as PermissionName })
        .then((status) => {
          if (disposed) return;
          permissionStatus = status;
          status.onchange = refresh;
        })
        .catch(() => { /* browser does not expose notification permission status */ });
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, [refreshSubscription]);

  // SW -> client messages: play sound on push
  useEffect(() => {
    if (!supported) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === "PUSH_SOUND") playSoundPreset((d.sound as SoundPreset) || prefs.sound, d.customUrl ?? prefs.custom_sound_url);
      if (d?.type === "NAVIGATE" && d.url) window.location.href = d.url;
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [prefs.sound, supported]);

  const savePrefs = useCallback(
    async (next: Partial<NotifPrefs>) => {
      if (!user) return;
      // Push notifications are mandatory — force-enable regardless of caller input.
      const merged = { ...prefs, ...next, push_enabled: true };
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
      const currentPermission = readPermission();
      const perm = currentPermission === "default"
        ? await Notification.requestPermission()
        : currentPermission;
      setPermission(perm);
      if (perm !== "granted") {
        clearLocalPush();
        return false;
      }

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      }
      reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
        });
      }
      const json: any = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        return false;
      }
      const deviceId = getDeviceId();
      const deviceLabel = getDeviceLabel();
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          device_label: deviceLabel,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      writeLocalPush({
        enabled_at: new Date().toISOString(),
        endpoint: json.endpoint,
        device_id: deviceId,
      });
      await savePrefs({ push_enabled: true });
      setSubscribed(true);
      return true;
    } catch {
      await refreshSubscription();
      return false;
    } finally {
      setLoading(false);
    }
  }, [user, supported, readPermission, savePrefs, refreshSubscription]);

  const disablePush = useCallback(async () => {
    // Disabled by policy — push notifications are mandatory for all users.
    return;
  }, []);

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
      playSoundPreset(prefs.sound, prefs.custom_sound_url);
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
    refreshSubscription,
  };
}

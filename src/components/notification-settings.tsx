import { Bell, BellOff, Loader2, Volume2, Vibrate, Sparkles, Upload, Trash2, Play } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { SOUND_PRESETS, VIBRATION_PRESETS, type SoundPreset, type VibrationPreset, playSoundPreset, playCustomSound } from "@/lib/push";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export function NotificationSettings() {
  const {
    supported, permission, subscribed, prefs, loading,
    enablePush, disablePush, savePrefs, testNotification,
  } = usePushNotifications();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("الحد الأقصى لحجم الملف 5 ميجا");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
      const path = `${user.id}/ringtone-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("notification-sounds")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("notification-sounds").getPublicUrl(path);
      await savePrefs({ sound: "custom", custom_sound_url: pub.publicUrl, custom_sound_name: file.name });
      toast.success("تم رفع النغمة");
      void playCustomSound(pub.publicUrl);
    } catch (e: any) {
      toast.error(e?.message || "فشل رفع الملف");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeCustom = async () => {
    if (!prefs.custom_sound_url) return;
    try {
      const url = new URL(prefs.custom_sound_url);
      const idx = url.pathname.indexOf("/notification-sounds/");
      if (idx >= 0) {
        const path = url.pathname.slice(idx + "/notification-sounds/".length);
        await supabase.storage.from("notification-sounds").remove([path]);
      }
    } catch { /* ignore */ }
    await savePrefs({
      custom_sound_url: null,
      custom_sound_name: null,
      sound: prefs.sound === "custom" ? "default" : prefs.sound,
    });
    toast.success("تم حذف النغمة المخصصة");
  };

  if (!supported) {
    return (
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-2 font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> الإشعارات</h3>
        <p className="text-sm text-muted-foreground">المتصفح الحالي لا يدعم الإشعارات الفورية. جرب من Chrome / Edge / Safari محدث.</p>
      </div>
    );
  }

  const onSound = async (v: SoundPreset) => {
    if (v === "custom" && !prefs.custom_sound_url) {
      fileRef.current?.click();
      return;
    }
    await savePrefs({ sound: v });
    playSoundPreset(v, prefs.custom_sound_url);
  };
  const onVib = async (v: VibrationPreset) => {
    await savePrefs({ vibration: v });
    if (navigator.vibrate) {
      const p: Record<VibrationPreset, number[]> = {
        default: [200, 100, 200], short: [80], long: [600],
        pulse: [120, 80, 120, 80, 120, 80, 400], off: [],
      };
      navigator.vibrate(p[v]);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> الإشعارات الفورية</h3>
          <p className="text-sm text-muted-foreground mt-1">
            استقبل تحديثات الشحنات، المخزون والفواتير على هاتفك حتى لو التطبيق مغلق.
          </p>
        </div>
        {subscribed && permission === "granted" ? (
          <Button variant="outline" size="sm" onClick={disablePush} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
            إيقاف
          </Button>
        ) : (
          <Button size="sm" onClick={async () => {
            const ok = await enablePush();
            if (ok) toast.success("تم تفعيل الإشعارات على هذا الجهاز");
            else toast.error("لم يتم منح الإذن");
          }} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            تفعيل
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3">
        <div>
          <Label className="text-sm">تشغيل الإشعارات</Label>
          <p className="text-xs text-muted-foreground">إيقاف مؤقت دون إلغاء الاشتراك</p>
        </div>
        <Switch
          checked={prefs.push_enabled}
          onCheckedChange={(v) => savePrefs({ push_enabled: v })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm"><Volume2 className="h-4 w-4" /> نغمة الإشعار</Label>
          <Select value={prefs.sound} onValueChange={(v) => onSound(v as SoundPreset)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOUND_PRESETS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">يتم تشغيل النغمة تلقائياً للمعاينة.</p>

          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/x-m4a,audio/mp4,audio/webm"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }}
          />

          {prefs.custom_sound_url ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <span className="flex-1 truncate text-xs" title={prefs.custom_sound_name || ""}>
                🎵 {prefs.custom_sound_name || "نغمة مخصصة"}
              </span>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => playCustomSound(prefs.custom_sound_url!)} title="تشغيل">
                <Play className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => fileRef.current?.click()} disabled={uploading} title="استبدال">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                onClick={removeCustom} title="حذف">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="w-full gap-2"
              onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              رفع نغمة من جهازي (MP3/WAV حتى 5MB)
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm"><Vibrate className="h-4 w-4" /> نمط الاهتزاز</Label>
          <Select value={prefs.vibration} onValueChange={(v) => onVib(v as VibrationPreset)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {VIBRATION_PRESETS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">يعمل فقط على الأجهزة التي تدعم الاهتزاز.</p>
        </div>
      </div>

      <Button variant="secondary" onClick={() => testNotification()} className="w-full gap-2">
        <Sparkles className="h-4 w-4" /> تجربة إشعار الآن
      </Button>
    </div>
  );
}

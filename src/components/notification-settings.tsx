import { Bell, BellOff, Loader2, Volume2, Vibrate, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { SOUND_PRESETS, VIBRATION_PRESETS, type SoundPreset, type VibrationPreset, playSoundPreset } from "@/lib/push";
import { toast } from "sonner";

export function NotificationSettings() {
  const {
    supported, permission, subscribed, prefs, loading,
    enablePush, disablePush, savePrefs, testNotification,
  } = usePushNotifications();

  if (!supported) {
    return (
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-2 font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> الإشعارات</h3>
        <p className="text-sm text-muted-foreground">المتصفح الحالي لا يدعم الإشعارات الفورية. جرب من Chrome / Edge / Safari محدث.</p>
      </div>
    );
  }

  const onSound = async (v: SoundPreset) => {
    await savePrefs({ sound: v });
    playSoundPreset(v);
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

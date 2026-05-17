import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { getMyChatProfile, updateChatProfile } from "@/lib/chat.functions";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#10b981",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#64748b",
];

export function ChatProfileSettings() {
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const getProfile = useServerFn(getMyChatProfile);
  const saveProfile = useServerFn(updateChatProfile);

  const [jobTitle, setJobTitle] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[5]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const p = await getProfile();
        setJobTitle(p.job_title ?? "");
        if (p.job_title_color) setColor(p.job_title_color);
      } catch {}
    })();
  }, [getProfile]);

  const save = async () => {
    setBusy(true);
    try {
      await saveProfile({
        data: {
          job_title: jobTitle.trim() || null,
          job_title_color: color,
        },
      });
      toast.success(rtl ? "تم الحفظ" : "Saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <h3 className="mb-1 font-semibold">{rtl ? "ملفك في الشات الداخلي" : "Team Chat Profile"}</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        {rtl
          ? "اكتب مسماك الوظيفي واختار لونه — هيظهر جنب اسمك في الشات الداخلي."
          : "Set your job title and color — shown next to your name in team chat."}
      </p>
      <div className="space-y-3">
        <div>
          <Label>{rtl ? "المسمى الوظيفي" : "Job title"}</Label>
          <Input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder={rtl ? "مثال: مدير المبيعات" : "e.g. Sales Manager"}
            maxLength={60}
          />
        </div>
        <div>
          <Label>{rtl ? "اللون" : "Color"}</Label>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-10 rounded cursor-pointer border"
            />
          </div>
        </div>
        {jobTitle && (
          <div className="text-xs text-muted-foreground">
            {rtl ? "معاينة:" : "Preview:"}{" "}
            <span
              className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: color + "22", color }}
            >
              {jobTitle}
            </span>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy} size="sm">
            {busy ? (rtl ? "جاري الحفظ..." : "Saving...") : (rtl ? "حفظ" : "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

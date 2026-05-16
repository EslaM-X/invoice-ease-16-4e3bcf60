import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/lib/use-role";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Smartphone, Apple, Monitor, Laptop, Globe, Download, Plus,
  Loader2, Trash2, AlertTriangle, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/download")({
  component: DownloadPage,
});

type Platform = "android" | "ios" | "windows" | "macos" | "web";

type AppUpdate = {
  id: string;
  version: string;
  platform: Platform;
  download_url: string;
  release_notes: string | null;
  is_mandatory: boolean;
  released_at: string;
  created_by_email: string | null;
};

const PLATFORM_META: Record<Platform, { ar: string; en: string; icon: any; ext: string }> = {
  android: { ar: "أندرويد", en: "Android", icon: Smartphone, ext: ".apk" },
  ios:     { ar: "آيفون / آيباد", en: "iOS",   icon: Apple,      ext: ".ipa" },
  windows: { ar: "ويندوز", en: "Windows", icon: Monitor,     ext: ".exe / .zip" },
  macos:   { ar: "ماك",   en: "macOS",   icon: Laptop,       ext: ".dmg / .zip" },
  web:     { ar: "ويب",   en: "Web",     icon: Globe,         ext: "URL" },
};

function DownloadPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { isAdmin } = useRole();
  const [updates, setUpdates] = useState<AppUpdate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_updates")
      .select("*")
      .order("released_at", { ascending: false });
    if (error) {
      toast.error(ar ? "تعذّر تحميل النسخ" : "Failed to load releases");
    } else {
      setUpdates((data ?? []) as AppUpdate[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Latest per platform
  const latestByPlatform: Partial<Record<Platform, AppUpdate>> = {};
  for (const u of updates) {
    if (!latestByPlatform[u.platform]) latestByPlatform[u.platform] = u;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">
            {ar ? "تحميل التطبيق" : "Download App"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ar
              ? "نزّل نسخة التطبيق المناسبة لجهازك. لما يبقى في تحديث جديد هيجيلك إشعار تلقائي."
              : "Download the app for your device. You'll get a notification whenever a new version is released."}
          </p>
        </div>

        {/* Latest builds grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PLATFORM_META) as Platform[]).map((p) => {
            const meta = PLATFORM_META[p];
            const latest = latestByPlatform[p];
            const Icon = meta.icon;
            return (
              <Card key={p} className="p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center">
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{ar ? meta.ar : meta.en}</div>
                    <div className="text-xs text-muted-foreground">{meta.ext}</div>
                  </div>
                </div>

                {latest ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary">v{latest.version}</Badge>
                      {latest.is_mandatory && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="size-3" />
                          {ar ? "إجباري" : "Mandatory"}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(latest.released_at).toLocaleDateString(ar ? "ar-EG" : "en-US")}
                      </span>
                    </div>
                    {latest.release_notes && (
                      <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                        {latest.release_notes}
                      </p>
                    )}
                    <Button asChild className="mt-auto gap-2">
                      <a href={latest.download_url} target="_blank" rel="noreferrer">
                        <Download className="size-4" />
                        {ar ? "تنزيل" : "Download"}
                      </a>
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-auto">
                    {ar ? "لسه مفيش نسخة منشورة" : "No release yet"}
                  </p>
                )}
              </Card>
            );
          })}
        </div>

        {/* Install instructions */}
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <CheckCircle2 className="size-4 text-primary" />
            {ar ? "خطوات التثبيت" : "Install instructions"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground mb-1">📱 {ar ? "أندرويد" : "Android"}</div>
              {ar
                ? "نزّل ملف APK، افتحه، ولو طلب منك فعّل «تثبيت من مصادر غير معروفة». بعد التحديث الأول هيجيك أوتوماتيك."
                : "Download the APK, open it, and allow “Install from unknown sources” if asked. Future updates arrive automatically."}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">🍎 {ar ? "آيفون" : "iOS"}</div>
              {ar
                ? "افتح الرابط من Safari واتبع تعليمات AltStore / Sideloadly، أو استخدم TestFlight لو متاح."
                : "Open the link in Safari and follow AltStore / Sideloadly, or use TestFlight if available."}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">🪟 {ar ? "ويندوز" : "Windows"}</div>
              {ar
                ? "نزّل ملف .exe ودبل كليك للتثبيت. لو ظهر تحذير SmartScreen اضغط More info → Run anyway."
                : "Download the .exe and double-click to install. If SmartScreen warns, click More info → Run anyway."}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">💻 {ar ? "ماك" : "macOS"}</div>
              {ar
                ? "افتح ملف .dmg واسحب التطبيق إلى Applications. أول مرة اعمل right-click → Open."
                : "Open the .dmg, drag the app to Applications. First launch: right-click → Open."}
            </div>
          </div>
        </Card>

        {isAdmin && <AdminUploadCard onCreated={load} />}

        {/* Full history */}
        <Card className="p-5">
          <h2 className="font-semibold mb-3">{ar ? "سجل النسخ" : "Release history"}</h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : updates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ar ? "لسه مفيش نسخ" : "No releases yet"}</p>
          ) : (
            <div className="space-y-2">
              {updates.map((u) => {
                const Icon = PLATFORM_META[u.platform].icon;
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card/50"
                  >
                    <Icon className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {ar ? PLATFORM_META[u.platform].ar : PLATFORM_META[u.platform].en}
                        </span>
                        <Badge variant="secondary">v{u.version}</Badge>
                        {u.is_mandatory && (
                          <Badge variant="destructive" className="text-[10px]">
                            {ar ? "إجباري" : "Mandatory"}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(u.released_at).toLocaleString(ar ? "ar-EG" : "en-US")}
                        {u.created_by_email ? ` · ${u.created_by_email}` : ""}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline" className="gap-1">
                      <a href={u.download_url} target="_blank" rel="noreferrer">
                        <Download className="size-3" />
                        {ar ? "تنزيل" : "Get"}
                      </a>
                    </Button>
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(ar ? "حذف النسخة دي؟" : "Delete this release?")) return;
                          const { error } = await supabase.from("app_updates").delete().eq("id", u.id);
                          if (error) toast.error(error.message);
                          else { toast.success(ar ? "تم الحذف" : "Deleted"); load(); }
                        }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function AdminUploadCard({ onCreated }: { onCreated: () => void }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState<Platform>("android");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!version.trim() || !url.trim()) {
      toast.error(ar ? "اكتب رقم النسخة والرابط" : "Enter version and download URL");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("app_updates").insert({
      version: version.trim(),
      platform,
      download_url: url.trim(),
      release_notes: notes.trim() || null,
      is_mandatory: mandatory,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(ar ? "تم نشر النسخة وإرسال الإشعارات" : "Release published & notifications sent");
    setVersion(""); setUrl(""); setNotes(""); setMandatory(false);
    onCreated();
  };

  return (
    <Card className="p-5 space-y-4 border-primary/30">
      <h2 className="font-semibold flex items-center gap-2">
        <Plus className="size-4 text-primary" />
        {ar ? "نشر نسخة جديدة (Admin)" : "Publish new release (Admin)"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{ar ? "المنصة" : "Platform"}</Label>
          <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PLATFORM_META) as Platform[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {ar ? PLATFORM_META[p].ar : PLATFORM_META[p].en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{ar ? "رقم النسخة" : "Version"}</Label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.3" />
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label>{ar ? "رابط التحميل" : "Download URL"}</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." dir="ltr" />
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label>{ar ? "ملاحظات الإصدار" : "Release notes"}</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={ar ? "أهم التغييرات والإصلاحات…" : "Highlights and fixes…"}
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <Switch checked={mandatory} onCheckedChange={setMandatory} />
          <Label className="cursor-pointer" onClick={() => setMandatory(!mandatory)}>
            {ar ? "تحديث إجباري" : "Mandatory update"}
          </Label>
        </div>
      </div>
      <Button onClick={submit} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {ar ? "نشر النسخة" : "Publish release"}
      </Button>
    </Card>
  );
}

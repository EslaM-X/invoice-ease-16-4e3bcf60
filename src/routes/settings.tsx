import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, ImageIcon, Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { getSettings, upsertSettings } from "@/lib/data";

import { exportFullBackupExcel, exportFullBackupCSV } from "@/lib/backup-export";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AvatarUpload } from "@/components/avatar-upload";
import { AppearanceSettings } from "@/components/appearance-settings";
import { NotificationSettings } from "@/components/notification-settings";

export const Route = createFileRoute("/settings")({ component: () => <AppShell><SettingsPage /></AppShell> });

function SettingsPage() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    company_name: "", company_address: "", company_phone: "", company_email: "",
    payment_terms: "", delivery_terms: "",
    social_facebook: "", social_instagram: "", social_twitter: "", social_website: "",
    currency: "EGP", default_language: "ar",
  });
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettings(user.id);
      if (s) {
        setForm({
          company_name: s.company_name ?? "", company_address: s.company_address ?? "",
          company_phone: s.company_phone ?? "", company_email: s.company_email ?? "",
          payment_terms: s.payment_terms ?? "", delivery_terms: s.delivery_terms ?? "",
          social_facebook: s.social_facebook ?? "", social_instagram: s.social_instagram ?? "",
          social_twitter: s.social_twitter ?? "", social_website: s.social_website ?? "",
          currency: s.currency ?? "EGP", default_language: s.default_language ?? "ar",
        });
        if (s.logo_url) {
          setLogoPath(s.logo_url);
          const { data: signed } = await supabase.storage.from("logos").createSignedUrl(s.logo_url, 3600);
          if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
        }
      }
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    try {
      await upsertSettings(user.id, { ...form, logo_url: logoPath });
      toast.success(t("settings_saved"));
    } catch (e: any) {
      toast.error(e?.message ?? t("error_occurred"));
    }
  };

  const uploadLogo = async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    setLogoPath(path);
    const { data: signed } = await supabase.storage.from("logos").createSignedUrl(path, 3600);
    if (signed?.signedUrl) setLogoUrl(signed.signedUrl);
    toast.success(t("saved"));
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{t("settings")}</h1>

      <AppearanceSettings />

      <NotificationSettings />

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("profile_photo")}</h3>
        <AvatarUpload />
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("logo")}</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border bg-muted">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2"><Upload className="h-4 w-4" />{t("upload_logo")}</Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("company_info")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{t("company_name")}</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
          <div><Label>{t("phone")}</Label><Input value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>{t("address")}</Label><Input value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} /></div>
          <div><Label>{t("email")}</Label><Input type="email" value={form.company_email} onChange={(e) => setForm({ ...form, company_email: e.target.value })} /></div>
          <div><Label>{t("currency")}</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("payment_terms")} / {t("delivery_terms")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{t("payment_terms")}</Label><Textarea rows={3} value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} /></div>
          <div><Label>{t("delivery_terms")}</Label><Textarea rows={3} value={form.delivery_terms} onChange={(e) => setForm({ ...form, delivery_terms: e.target.value })} /></div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 font-semibold">{t("social_links")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{t("website")}</Label><Input value={form.social_website} onChange={(e) => setForm({ ...form, social_website: e.target.value })} /></div>
          <div><Label>{t("facebook")}</Label><Input value={form.social_facebook} onChange={(e) => setForm({ ...form, social_facebook: e.target.value })} /></div>
          <div><Label>{t("instagram")}</Label><Input value={form.social_instagram} onChange={(e) => setForm({ ...form, social_instagram: e.target.value })} /></div>
          <div><Label>{t("twitter")}</Label><Input value={form.social_twitter} onChange={(e) => setForm({ ...form, social_twitter: e.target.value })} /></div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-1 font-semibold">{t("backup_full")}</h3>
        <p className="mb-4 text-xs text-muted-foreground">{t("backup_full_desc")}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy} className="gap-2 rounded-full">
              <Download className="h-4 w-4" />{busy ? t("exporting") : t("download_backup")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem className="gap-2" onClick={async () => {
              if (!user) return;
              setBusy(true);
              try { await exportFullBackupExcel(user.id, lang); toast.success(t("exported")); }
              catch (e: any) { toast.error(e?.message || "Export failed"); }
              finally { setBusy(false); }
            }}><FileSpreadsheet className="h-4 w-4" />{t("export_excel")} (.xlsx)</DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={async () => {
              if (!user) return;
              setBusy(true);
              try { await exportFullBackupCSV(user.id, lang); toast.success(t("exported")); }
              catch (e: any) { toast.error(e?.message || "Export failed"); }
              finally { setBusy(false); }
            }}><FileText className="h-4 w-4" />{t("export_csv")} (multiple)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} className="shadow-glow">{t("save")}</Button>
      </div>
    </div>
  );
}

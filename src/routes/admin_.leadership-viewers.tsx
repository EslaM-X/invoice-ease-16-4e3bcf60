import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SuperAdminGate } from "@/components/super-admin-gate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Trash2, Loader2, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLeadershipViewers } from "@/lib/use-leadership-viewers";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/admin_/leadership-viewers")({
  component: () => (
    <SuperAdminGate>
      <AppShell><LeadershipViewersPage /></AppShell>
    </SuperAdminGate>
  ),
});

function LeadershipViewersPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { rows, loaded, reload } = useLeadershipViewers();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const add = async () => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^\S+@\S+\.\S+$/.test(clean)) {
      toast.error(isAr ? "بريد إلكتروني غير صالح" : "Invalid email");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("leadership_card_viewers")
      .insert({ email: clean, note: note.trim() || null });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isAr ? "تمت الإضافة" : "Added");
    setEmail(""); setNote("");
    reload();
  };

  const remove = async (id: string, e: string) => {
    if (!confirm(isAr ? `حذف ${e} من قائمة المشاهدين؟` : `Remove ${e} from viewers?`)) return;
    setDeletingId(id);
    const { error } = await supabase.from("leadership_card_viewers").delete().eq("id", id);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم الحذف" : "Removed");
    reload();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="rounded-xl bg-amber-500/10 p-2.5 ring-1 ring-amber-500/30">
          <ShieldCheck className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            {isAr ? "مشاهدو كارت مهام القيادة" : "Leadership Tasks Card Viewers"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "أدر بريد الحسابات المسموح لها برؤية كارت مهام CEO/COO في لوحة التحكم — التغييرات تطبق فورًا بدون تعديل الكود."
              : "Manage the emails allowed to see the CEO/COO tasks card on the dashboard — changes apply instantly, no code edits."}
          </p>
        </div>
      </header>

      <Card className="p-4 md:p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4" />
          {isAr ? "إضافة مشاهد جديد" : "Add a new viewer"}
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            type="email"
            placeholder="name@steinheim-eg.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
          />
          <Input
            placeholder={isAr ? "ملاحظة (اختياري)" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button onClick={add} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (isAr ? "إضافة" : "Add")}
          </Button>
        </div>
      </Card>

      <Card className="p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            {isAr ? "القائمة الحالية" : "Current list"}
            <Badge variant="secondary" className="ms-1">{rows.length}</Badge>
          </div>
        </div>
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {isAr ? "جارٍ التحميل…" : "Loading…"}
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {isAr ? "لا يوجد أي مشاهد بعد." : "No viewers yet."}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium" dir="ltr">{r.email}</div>
                  {r.note && <div className="truncate text-xs text-muted-foreground">{r.note}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(r.id, r.email)}
                  disabled={deletingId === r.id}
                  className="text-red-500 hover:text-red-600"
                >
                  {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

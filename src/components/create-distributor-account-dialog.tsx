import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, KeyRound, UserPlus, ShieldCheck } from "lucide-react";
import {
  adminCreateDistributorAccount,
  adminResetDistributorPassword,
} from "@/lib/admin-distributor.functions";

const ALLOWED = new Set([
  "e.hesham@steinheim-eg.com",
  "k.elsharbatly@steinheim-eg.com",
]);

export function CreateDistributorAccountButton() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const email = (user?.email ?? "").toLowerCase();
  if (!ALLOWED.has(email)) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-1 border-amber-400/40 text-amber-600 dark:text-amber-400">
        <UserPlus className="h-4 w-4" /> {isAr ? "إنشاء حساب موزّع" : "Create distributor account"}
      </Button>
      <CreateDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const create = useServerFn(adminCreateDistributorAccount);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    email: "", password: "", name: "", showroom_name: "", location: "", city: "",
    address: "", phone: "", branches_count: "1", notes: "", is_active: true,
  });

  useEffect(() => {
    if (open) setF({ email: "", password: "", name: "", showroom_name: "", location: "", city: "", address: "", phone: "", branches_count: "1", notes: "", is_active: true });
  }, [open]);

  const submit = async () => {
    if (!f.email || !f.password || !f.name) {
      toast.error(isAr ? "الإيميل والباسورد والاسم مطلوبين" : "Email, password and name required");
      return;
    }
    setBusy(true);
    try {
      await create({ data: {
        email: f.email, password: f.password, name: f.name,
        showroom_name: f.showroom_name || null, location: f.location || null,
        city: f.city || null, address: f.address || null, phone: f.phone || null,
        branches_count: Number(f.branches_count) || 1, notes: f.notes || null,
        is_active: f.is_active,
      }});
      toast.success(isAr ? "تم إنشاء الحساب — جاهز للدخول فوراً" : "Account created — ready to sign in");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-500" />
            {isAr ? "إنشاء حساب موزّع جديد" : "Create distributor account"}
          </DialogTitle>
        </DialogHeader>
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          {isAr ? "هينشأ الحساب مفعّل فوراً بإيميل وباسورد بدون أي رسالة تأكيد. الموزّع يقدر يدخل على طول." : "Account created instantly with email + password. No confirmation email sent."}
        </p>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <F label={isAr ? "الإيميل *" : "Email *"} v={f.email} on={(v) => setF({ ...f, email: v })} type="email" />
            <F label={isAr ? "الباسورد * (8 حروف على الأقل)" : "Password * (min 8)"} v={f.password} on={(v) => setF({ ...f, password: v })} type="password" />
            <F label={isAr ? "الاسم *" : "Name *"} v={f.name} on={(v) => setF({ ...f, name: v })} />
            <F label={isAr ? "اسم المعرض" : "Showroom"} v={f.showroom_name} on={(v) => setF({ ...f, showroom_name: v })} />
            <F label={isAr ? "المنطقة" : "Location"} v={f.location} on={(v) => setF({ ...f, location: v })} />
            <F label={isAr ? "المدينة" : "City"} v={f.city} on={(v) => setF({ ...f, city: v })} />
            <F label={isAr ? "الهاتف" : "Phone"} v={f.phone} on={(v) => setF({ ...f, phone: v })} />
            <F label={isAr ? "عدد الفروع" : "Branches"} v={f.branches_count} on={(v) => setF({ ...f, branches_count: v })} type="number" />
          </div>
          <F label={isAr ? "العنوان" : "Address"} v={f.address} on={(v) => setF({ ...f, address: v })} />
          <div>
            <label className="mb-1 block text-xs font-medium">{isAr ? "ملاحظات" : "Notes"}</label>
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-2 text-sm">
            <span>{isAr ? "تفعيل الحساب فوراً" : "Activate immediately"}</span>
            <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isAr ? "إنشاء وتفعيل" : "Create & activate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, v, on, type = "text" }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} dir={type === "email" || type === "password" ? "ltr" : undefined} />
    </div>
  );
}

export function ResetDistributorPasswordButton({ userId, email }: { userId: string; email: string | null }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = useServerFn(adminResetDistributorPassword);
  const callerEmail = (user?.email ?? "").toLowerCase();
  if (!ALLOWED.has(callerEmail)) return null;

  const submit = async () => {
    if (pw.length < 8) { toast.error(isAr ? "8 حروف على الأقل" : "Min 8 chars"); return; }
    setBusy(true);
    try {
      await reset({ data: { user_id: userId, password: pw } });
      toast.success(isAr ? "تم تغيير الباسورد" : "Password changed");
      setOpen(false); setPw("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setOpen(true)}>
        <KeyRound className="h-3 w-3" /> {isAr ? "تغيير الباسورد" : "Reset password"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isAr ? "تغيير باسورد" : "Reset password"}{email ? ` — ${email}` : ""}</DialogTitle>
          </DialogHeader>
          <Input type="password" placeholder={isAr ? "باسورد جديد (8 حروف)" : "New password (min 8)"} value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isAr ? "حفظ" : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

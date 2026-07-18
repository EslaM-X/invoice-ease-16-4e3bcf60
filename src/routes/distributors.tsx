import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Store, MapPin, Phone, Mail, Building2, Loader2, Search, ToggleRight, Pencil } from "lucide-react";
import { DistributorApprovalsCard } from "@/components/distributor-approvals-card";
import { PendingAccountsCard } from "@/components/pending-accounts-card";
import { DistributorBalancesCard } from "@/components/distributor-balances-card";
import { CreateDistributorAccountButton, ResetDistributorPasswordButton } from "@/components/create-distributor-account-dialog";
import { StockOverridesButton } from "@/components/distributor-stock-overrides-dialog";

export const Route = createFileRoute("/distributors")({ component: DistributorsPage });

type Row = {
  id: string; user_id: string; name: string; showroom_name: string | null;
  location: string | null; city: string | null; address: string | null;
  phone: string | null; email: string | null; branches_count: number;
  notes: string | null; is_active: boolean; created_at: string;
};

function DistributorsPage() {
  return <AppShell><DistributorsInner /></AppShell>;
}

function DistributorsInner() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = async () => {
    const { data } = await (supabase.from as any)("distributors").select("*").order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTable("distributors", () => load());

  const filtered = rows.filter((r) => {
    const qq = q.trim().toLowerCase();
    if (!qq) return true;
    return (r.name + " " + (r.showroom_name || "") + " " + (r.location || "") + " " + (r.city || "") + " " + (r.phone || "") + " " + (r.email || "")).toLowerCase().includes(qq);
  });

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Store className="h-6 w-6 text-amber-500" /> {isAr ? "الموزّعين" : "Distributors"}
          </h1>
          <p className="text-sm text-muted-foreground">{isAr ? "إدارة شبكة الموزّعين والمعارض والفروع" : "Manage distributor network"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreateDistributorAccountButton />
          <Button onClick={() => { setEditing(null); setOpenForm(true); }} className="gap-1">
            <Plus className="h-4 w-4" /> {isAr ? "ربط موزّع موجود" : "Link existing"}
          </Button>
        </div>
      </div>

      <PendingAccountsCard />
      <DistributorApprovalsCard />
      <DistributorBalancesCard />

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? "ابحث بالاسم، المعرض، المدينة..." : "Search..."} className="ps-10" />
      </div>

      {loading ? (
        <CardGridSkeleton count={6} cols="sm:grid-cols-2 lg:grid-cols-3" />
      ) : filtered.length === 0 ? (
        <div className="ios-card py-16 text-center text-sm text-muted-foreground">{isAr ? "لا يوجد موزّعين" : "No distributors yet"}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <div key={r.id} className="ios-card group flex flex-col gap-3 p-4 transition hover:shadow-elegant">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400"><Store className="h-4 w-4" /></div>
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      {r.showroom_name && <div className="text-[11px] text-muted-foreground">{r.showroom_name}</div>}
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className={r.is_active ? "border-emerald-400/40 text-emerald-600 dark:text-emerald-400" : "border-zinc-400/40 text-muted-foreground"}>
                  {r.is_active ? (isAr ? "نشط" : "Active") : (isAr ? "متوقف" : "Inactive")}
                </Badge>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                {r.location && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {r.location}{r.city ? ` — ${r.city}` : ""}</div>}
                {r.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {r.phone}</div>}
                {r.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {r.email}</div>}
                <div className="flex items-center gap-1.5"><Building2 className="h-3 w-3" /> {r.branches_count} {isAr ? "فرع" : "branches"}</div>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 border-t pt-3">
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpenForm(true); }}>
                    <Pencil className="me-1 h-3 w-3" /> {isAr ? "تعديل" : "Edit"}
                  </Button>
                  <StockOverridesButton distributorId={r.id} distributorName={r.name} />
                  <ResetDistributorPasswordButton userId={r.user_id} email={r.email} />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{isAr ? "تفعيل" : "Active"}</span>
                  <Switch checked={r.is_active} onCheckedChange={async (v) => {
                    const { error } = await (supabase.from as any)("distributors").update({ is_active: v }).eq("id", r.id);
                    if (error) toast.error(error.message); else toast.success(isAr ? "تم التحديث" : "Updated");
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DistributorFormDialog
        open={openForm}
        editing={editing}
        onOpenChange={setOpenForm}
        onSaved={() => { setOpenForm(false); load(); }}
        creatorId={user?.id ?? null}
      />
    </div>
  );
}

function DistributorFormDialog({
  open, onOpenChange, editing, onSaved, creatorId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Row | null;
  onSaved: () => void; creatorId: string | null;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [form, setForm] = useState({
    email: "", name: "", showroom_name: "", location: "", city: "",
    address: "", phone: "", branches_count: 1, notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({
        email: editing.email || "",
        name: editing.name || "",
        showroom_name: editing.showroom_name || "",
        location: editing.location || "",
        city: editing.city || "",
        address: editing.address || "",
        phone: editing.phone || "",
        branches_count: editing.branches_count || 1,
        notes: editing.notes || "",
      });
    } else {
      setForm({ email: "", name: "", showroom_name: "", location: "", city: "", address: "", phone: "", branches_count: 1, notes: "" });
    }
  }, [editing, open]);

  const submit = async () => {
    if (!form.name.trim()) { toast.error(isAr ? "اسم الموزّع مطلوب" : "Name required"); return; }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await (supabase.from as any)("distributors").update({
          name: form.name.trim(),
          showroom_name: form.showroom_name.trim() || null,
          location: form.location.trim() || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          branches_count: Number(form.branches_count) || 1,
          notes: form.notes.trim() || null,
        }).eq("id", editing.id);
        if (error) throw error;
      } else {
        if (!form.email.trim()) { toast.error(isAr ? "إيميل المستخدم مطلوب" : "User email required"); setSaving(false); return; }
        // Resolve user_id from profiles by email
        const { data: prof } = await (supabase.from as any)("profiles").select("user_id").eq("email", form.email.trim().toLowerCase()).maybeSingle();
        if (!prof?.user_id) {
          toast.error(isAr ? "المستخدم لازم يكون عنده حساب وموافق عليه أولاً" : "User must sign up & be approved first");
          setSaving(false); return;
        }
        const { error } = await (supabase.from as any)("distributors").insert({
          user_id: prof.user_id,
          name: form.name.trim(),
          showroom_name: form.showroom_name.trim() || null,
          location: form.location.trim() || null,
          city: form.city.trim() || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim().toLowerCase(),
          branches_count: Number(form.branches_count) || 1,
          notes: form.notes.trim() || null,
          created_by: creatorId,
        });
        if (error) throw error;
      }
      toast.success(isAr ? "تم الحفظ" : "Saved");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? (isAr ? "تعديل موزّع" : "Edit distributor") : (isAr ? "إضافة موزّع جديد" : "New distributor")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {!editing && (
            <div>
              <label className="mb-1 block text-xs font-medium">{isAr ? "إيميل المستخدم *" : "User email *"}</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
              <p className="mt-1 text-[10px] text-muted-foreground">{isAr ? "لازم يكون عنده حساب ومتوافق عليه" : "Must have an approved account"}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={isAr ? "اسم الموزّع *" : "Name *"} v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <Field label={isAr ? "اسم المعرض" : "Showroom"} v={form.showroom_name} on={(v) => setForm({ ...form, showroom_name: v })} />
            <Field label={isAr ? "المكان / المنطقة" : "Location"} v={form.location} on={(v) => setForm({ ...form, location: v })} />
            <Field label={isAr ? "المدينة" : "City"} v={form.city} on={(v) => setForm({ ...form, city: v })} />
            <Field label={isAr ? "الهاتف" : "Phone"} v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
            <Field label={isAr ? "عدد الفروع" : "Branches"} v={String(form.branches_count)} on={(v) => setForm({ ...form, branches_count: Number(v) || 1 })} type="number" />
          </div>
          <Field label={isAr ? "العنوان" : "Address"} v={form.address} on={(v) => setForm({ ...form, address: v })} />
          <div>
            <label className="mb-1 block text-xs font-medium">{isAr ? "ملاحظات" : "Notes"}</label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{isAr ? "حفظ" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, v, on, type = "text" }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <Input type={type} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

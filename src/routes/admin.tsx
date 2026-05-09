import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useRole, type AppRole } from "@/lib/use-role";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, Trash2, Loader2, Database, Check, X, Briefcase, Store } from "lucide-react";
import { BackupButton } from "@/components/backup-button";
import { useRealtimeTable } from "@/lib/realtime";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
};

const ROLE_OPTIONS: AppRole[] = ["admin", "manager", "cashier", "call_center", "user"];
const ROLE_COLORS: Record<AppRole, string> = {
  admin: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  manager: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  cashier: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  call_center: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  user: "bg-muted text-muted-foreground border-border",
};

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading: roleLoading } = useRole();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingRole, setAddingRole] = useState<{ userId: string; role: AppRole }>({
    userId: "",
    role: "cashier",
  });

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      toast.error("غير مصرح — صفحة الأدمن فقط");
      navigate({ to: "/dashboard" });
    }
  }, [isAdmin, roleLoading, navigate]);

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: rolesData }] = await Promise.all([
      supabase.from("profiles").select("user_id, email, display_name"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const map = new Map<string, Member>();
    (profiles ?? []).forEach((p: any) => {
      map.set(p.user_id, { ...p, roles: [] });
    });
    (rolesData ?? []).forEach((r: any) => {
      const m = map.get(r.user_id);
      if (m) m.roles.push(r.role);
      else map.set(r.user_id, { user_id: r.user_id, email: null, display_name: null, roles: [r.role] });
    });
    setMembers(Array.from(map.values()).sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")));
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  // Realtime — refresh on any team member / role change
  useRealtimeTable("user_roles", () => { if (isAdmin) load(); });
  useRealtimeTable("profiles", () => { if (isAdmin) load(); });
  useRealtimeTable("backups_log", () => { if (isAdmin) load(); });

  const addRole = async (userId: string, role: AppRole) => {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error && !error.message.includes("duplicate")) {
      toast.error("فشل: " + error.message);
      return;
    }
    toast.success("تمت إضافة الدور");
    load();
  };

  const removeRole = async (userId: string, role: AppRole) => {
    if (!confirm(`حذف دور ${role}؟`)) return;
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) {
      toast.error("فشل: " + error.message);
      return;
    }
    toast.success("تم الحذف");
    load();
  };

  if (roleLoading || !isAdmin) {
    return (
      <AppShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/10 p-2.5">
            <ShieldCheck className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">لوحة الأدمن</h1>
            <p className="text-sm text-muted-foreground">إدارة المستخدمين والأدوار</p>
          </div>
        </div>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">أعضاء الفريق ({members.length})</h2>
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "تحديث"}
            </Button>
          </div>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((m) => (
                <div
                  key={m.user_id}
                  className="flex flex-col gap-3 rounded-lg border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{m.display_name || m.email}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.roles.length === 0 && (
                        <span className="text-xs text-muted-foreground">— بدون أدوار —</span>
                      )}
                      {m.roles.map((r) => (
                        <Badge
                          key={r}
                          variant="outline"
                          className={`${ROLE_COLORS[r]} group cursor-pointer gap-1 text-xs`}
                          onClick={() => removeRole(m.user_id, r)}
                          title="اضغط لحذف الدور"
                        >
                          {r}
                          <Trash2 className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={
                        addingRole.userId === m.user_id ? addingRole.role : "cashier"
                      }
                      onValueChange={(v) =>
                        setAddingRole({ userId: m.user_id, role: v as AppRole })
                      }
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={r} disabled={m.roles.includes(r)}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() =>
                        addRole(
                          m.user_id,
                          addingRole.userId === m.user_id ? addingRole.role : "cashier"
                        )
                      }
                    >
                      <UserPlus className="me-1 h-4 w-4" /> إضافة
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">شرح الأدوار</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <RoleInfo name="admin" desc="صلاحيات كاملة + إدارة الأدوار + كل الإعدادات" />
            <RoleInfo name="manager" desc="تقارير + موافقات + مراجعة الفواتير والمخزون" />
            <RoleInfo name="cashier" desc="إنشاء فواتير + المبيعات اليومية + المخزون" />
            <RoleInfo name="call_center" desc="بيانات العملاء + المكالمات + التقييمات" />
          </div>
        </Card>

        <PendingApprovalsSection />

        <BackupsSection />
      </div>
    </AppShell>
  );
}

function BackupsSection() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("backups_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(15);
    setLogs(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-semibold">النسخ الاحتياطية</h2>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load}>تحديث</Button>
          <BackupButton />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        يتم تشغيل النسخ تلقائياً كل يوم 03:00 صباحاً وتُحفظ في مساحة آمنة منفصلة (bucket "backups").
      </p>
      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">لا توجد نسخ بعد — اضغط "نسخة احتياطية الآن"</div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={l.status === "success" ? "text-emerald-500" : "text-destructive"}>
                  {l.status === "success" ? "✅" : "❌"}
                </span>
                <span className="font-mono text-xs">{new Date(l.created_at).toLocaleString("ar-EG")}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <span>{l.tables_count} جدول</span>
                <span>{l.rows_count} سجل</span>
                <span>{(l.size_bytes / 1024).toFixed(1)} KB</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{l.triggered_by}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RoleInfo({ name, desc }: { name: AppRole; desc: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <Badge variant="outline" className={`${ROLE_COLORS[name]} mb-2`}>
        {name}
      </Badge>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

type PendingProfile = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  account_type: "employee" | "distributor" | null;
  approval_status: string;
  created_at: string;
};

function PendingApprovalsSection() {
  const [items, setItems] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("user_id, email, display_name, account_type, approval_status, created_at")
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false });
    setItems((data ?? []) as PendingProfile[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("profiles", load);

  const decide = async (p: PendingProfile, status: "approved" | "rejected") => {
    if (status === "approved" && !p.account_type) {
      toast.error("اختر نوع الحساب أولاً");
      return;
    }
    setBusyId(p.user_id);
    const { error } = await supabase
      .from("profiles")
      .update({
        approval_status: status,
        approved_at: new Date().toISOString(),
      })
      .eq("user_id", p.user_id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "approved" ? "تمت الموافقة" : "تم الرفض");
    load();
  };

  const setType = async (p: PendingProfile, t: "employee" | "distributor") => {
    const { error } = await supabase
      .from("profiles")
      .update({ account_type: t })
      .eq("user_id", p.user_id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-semibold">طلبات الانضمام ({items.length})</h2>
        </div>
        <Button size="sm" variant="ghost" onClick={load}>تحديث</Button>
      </div>

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">لا توجد طلبات معلقة</div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <div key={p.user_id} className="flex flex-col gap-3 rounded-lg border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.display_name || p.email}</div>
                <div className="truncate text-xs text-muted-foreground">{p.email}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setType(p, "employee")}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${p.account_type === "employee" ? "border-blue-500/60 bg-blue-500/15 text-blue-600" : "border-border/60 hover:bg-muted"}`}
                  >
                    <Briefcase className="h-3 w-3" /> موظف
                  </button>
                  <button
                    type="button"
                    onClick={() => setType(p, "distributor")}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${p.account_type === "distributor" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-600" : "border-border/60 hover:bg-muted"}`}
                  >
                    <Store className="h-3 w-3" /> موزّع
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("ar-EG")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => decide(p, "approved")}
                  disabled={busyId === p.user_id || !p.account_type}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Check className="me-1 h-4 w-4" /> موافقة
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => decide(p, "rejected")}
                  disabled={busyId === p.user_id}
                  className="border-red-500/40 text-red-600 hover:bg-red-500/10"
                >
                  <X className="me-1 h-4 w-4" /> رفض
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

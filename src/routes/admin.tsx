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
import { ShieldCheck, UserPlus, Trash2, Loader2 } from "lucide-react";

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
      </div>
    </AppShell>
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

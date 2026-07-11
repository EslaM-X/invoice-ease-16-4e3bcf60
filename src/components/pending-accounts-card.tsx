import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Loader2, Clock, UserPlus, Store, Briefcase,
  Phone, MapPin, Building2, BadgeCheck,
} from "lucide-react";

type Pending = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  account_type: "employee" | "distributor" | null;
  created_at: string;
};

type DistInfo = {
  user_id: string; showroom_name: string | null; location: string | null;
  city: string | null; phone: string | null; branches_count: number | null;
};

export function PendingAccountsCard() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<Pending[]>([]);
  const [dists, setDists] = useState<Record<string, DistInfo>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Pending | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("user_id,email,display_name,account_type,created_at")
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false });
    const list = (data as Pending[]) ?? [];
    setRows(list);
    if (list.length > 0) {
      const distIds = list.filter((r) => r.account_type === "distributor").map((r) => r.user_id);
      if (distIds.length > 0) {
        const { data: dd } = await (supabase.from as any)("distributors")
          .select("user_id,showroom_name,location,city,phone,branches_count")
          .in("user_id", distIds);
        const map: Record<string, DistInfo> = {};
        (dd as DistInfo[] ?? []).forEach((d) => { map[d.user_id] = d; });
        setDists(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("profiles", () => load());
  useRealtimeTable("distributors", () => load());

  if (loading) return null;
  if (rows.length === 0) {
    return (
      <div className="relative group">
        <div className="pointer-events-none absolute -inset-0.5 rounded-2xl bg-[color:var(--brand-gold)]/10 opacity-25 blur transition-opacity duration-500 group-hover:opacity-50" />
        <div className="noir-surface relative flex items-center justify-between overflow-hidden rounded-xl border border-[color:var(--brand-gold)]/20 p-5 shadow-2xl transition-colors duration-500 group-hover:border-[color:var(--brand-gold)]/40">
          <div className="pointer-events-none absolute inset-y-0 end-0 w-32 bg-gradient-to-l from-[color:var(--brand-gold)]/[0.06] to-transparent" />
          <div className="relative flex min-w-0 items-center gap-4 sm:gap-5">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-[color:var(--brand-gold)]/20 blur-lg" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--brand-gold)]/40 bg-background/60 shadow-[inset_0_0_12px_rgba(201,168,76,0.12)]">
                <BadgeCheck className="h-6 w-6 text-gold" strokeWidth={1.5} />
              </div>
            </div>
            <div className="min-w-0 space-y-1.5">
              <h3 className="truncate text-base font-medium leading-tight tracking-wide text-foreground sm:text-lg">
                {isAr ? "لا توجد طلبات حسابات بانتظار الموافقة" : "No pending account requests"}
              </h3>
              <p className="flex items-center gap-2 text-xs font-light text-muted-foreground sm:text-sm">
                <span className="inline-block h-1 w-1 shrink-0 animate-pulse rounded-full bg-[color:var(--brand-gold)]/70" />
                <span className="truncate">{isAr ? "أي طلب جديد هيظهر هنا فوراً" : "New requests appear here in realtime"}</span>
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 rounded-full border border-[color:var(--brand-gold)]/20 bg-[color:var(--brand-gold)]/[0.06] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-gold/80 md:inline-block">
            {isAr ? "مزامنة فورية" : "Realtime Sync"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ios-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">{isAr ? "طلبات حسابات بانتظار الموافقة" : "Account requests — pending"}</h3>
          <Badge variant="outline" className="border-amber-400/40 text-amber-600 dark:text-amber-400">{rows.length}</Badge>
        </div>
        <div className="space-y-2">
          {rows.map((r) => {
            const isDist = r.account_type === "distributor";
            const d = dists[r.user_id];
            const Icon = isDist ? Store : Briefcase;
            return (
              <button key={r.user_id} onClick={() => setOpen(r)}
                className="flex w-full items-start gap-3 rounded-xl border bg-card/40 p-3 text-start transition hover:bg-muted/50">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isDist ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate text-sm font-semibold">
                    {r.display_name || r.email}
                    <Badge variant="outline" className="text-[10px]">
                      {isDist ? (isAr ? "موزّع" : "Distributor") : (isAr ? "موظف" : "Employee")}
                    </Badge>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground" dir="ltr">{r.email}</div>
                  {isDist && d && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {d.showroom_name && <span className="inline-flex items-center gap-1"><Store className="h-3 w-3" />{d.showroom_name}</span>}
                      {(d.location || d.city) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{[d.location, d.city].filter(Boolean).join(" — ")}</span>}
                      {d.phone && <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" />{d.phone}</span>}
                      {d.branches_count && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{d.branches_count}</span>}
                    </div>
                  )}
                </div>
                <UserPlus className="mt-1 h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>
      <ReviewDialog row={open} dist={open ? dists[open.user_id] : undefined} onClose={() => setOpen(null)} onDone={load} />
    </>
  );
}

function ReviewDialog({ row, dist, onClose, onDone }: {
  row: Pending | null; dist?: DistInfo;
  onClose: () => void; onDone: () => void;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [notes, setNotes] = useState("");
  const [working, setWorking] = useState<"approve" | "reject" | null>(null);

  useEffect(() => { setNotes(""); }, [row?.user_id]);
  if (!row) return null;

  const approve = async () => {
    setWorking("approve");
    const { error } = await (supabase.rpc as any)("approve_user_account", { _user_id: row.user_id, _notes: notes || null });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تمت الموافقة وتفعيل الحساب" : "Account approved & activated");
    onDone(); onClose();
  };
  const reject = async () => {
    setWorking("reject");
    const { error } = await (supabase.rpc as any)("reject_user_account", { _user_id: row.user_id, _notes: notes || null });
    setWorking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم رفض الحساب" : "Account rejected");
    onDone(); onClose();
  };

  const isDist = row.account_type === "distributor";

  return (
    <Dialog open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isAr ? "مراجعة طلب حساب" : "Review account request"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">{row.display_name || row.email}</div>
            <div className="text-xs text-muted-foreground" dir="ltr">{row.email}</div>
            <Badge variant="outline" className="mt-2">{isDist ? (isAr ? "موزّع" : "Distributor") : (isAr ? "موظف" : "Employee")}</Badge>
          </div>
          {isDist && dist && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/20 p-3 text-xs">
              <Info label={isAr ? "المعرض" : "Showroom"} v={dist.showroom_name} />
              <Info label={isAr ? "المنطقة" : "Area"} v={dist.location} />
              <Info label={isAr ? "المدينة" : "City"} v={dist.city} />
              <Info label={isAr ? "تليفون" : "Phone"} v={dist.phone} />
              <Info label={isAr ? "عدد الفروع" : "Branches"} v={dist.branches_count?.toString() ?? "—"} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium">{isAr ? "ملاحظة (اختياري)" : "Note (optional)"}</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder={isAr ? "سبب الرفض أو ملاحظة للموزّع..." : "Reason or note..."} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reject} disabled={!!working} className="border-red-400/40 text-red-600 hover:bg-red-500/10">
              {working === "reject" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <XCircle className="me-2 h-4 w-4" />}
              {isAr ? "رفض" : "Reject"}
            </Button>
            <Button onClick={approve} disabled={!!working} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {working === "approve" ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="me-2 h-4 w-4" />}
              {isAr ? "موافقة وتفعيل" : "Approve & activate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, v }: { label: string; v: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{v || "—"}</div>
    </div>
  );
}

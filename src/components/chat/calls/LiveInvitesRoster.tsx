import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCallInvitesLive } from "@/lib/calls.functions";
import { supabase } from "@/integrations/supabase/client";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { cn } from "@/lib/utils";
import {
  BellRing, Check, PhoneOff, PhoneMissed, LogOut, Crown, Loader2,
} from "lucide-react";

type Props = { callId: string; rtl: boolean };

const STATUS: Record<
  string,
  { ar: string; en: string; tone: string; Icon: any }
> = {
  invited:  { ar: "يرن…",     en: "Ringing…", tone: "text-amber-300 bg-amber-500/10 border-amber-400/30", Icon: BellRing },
  joined:   { ar: "انضم",     en: "Joined",   tone: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30", Icon: Check },
  declined: { ar: "رفض",      en: "Declined", tone: "text-rose-300 bg-rose-500/10 border-rose-400/30", Icon: PhoneOff },
  missed:   { ar: "لم يرد",   en: "Missed",   tone: "text-neutral-300 bg-neutral-500/10 border-neutral-400/30", Icon: PhoneMissed },
  left:     { ar: "غادر",     en: "Left",     tone: "text-sky-300 bg-sky-500/10 border-sky-400/30", Icon: LogOut },
};

function fmtRelative(iso: string | null | undefined, rtl: boolean) {
  if (!iso) return rtl ? "—" : "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 5) return rtl ? "الآن" : "just now";
  if (s < 60) return rtl ? `${s} ث` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return rtl ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return rtl ? `${h} س` : `${h}h`;
  return new Date(iso).toLocaleString();
}

export function LiveInvitesRoster({ callId, rtl }: Props) {
  const fetch = useServerFn(getCallInvitesLive);
  const q = useQuery({
    queryKey: ["call-invites-live", callId],
    queryFn: () => fetch({ data: { call_id: callId } }),
    refetchInterval: 4000,
  });

  // Realtime refetch on participant changes
  useEffect(() => {
    if (!callId) return;
    const ch = supabase
      .channel(`invites-${callId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_call_participants", filter: `call_id=eq.${callId}` },
        () => q.refetch(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [callId, q]);

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-white/60 text-sm py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        {rtl ? "جارٍ تحميل حالة الدعوات…" : "Loading invite status…"}
      </div>
    );
  }
  const rows = q.data?.participants ?? [];
  if (!rows.length) return null;

  const counts = rows.reduce<Record<string, number>>((acc, r: any) => {
    acc[r.join_status] = (acc[r.join_status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-200">
          {rtl ? "حالة الدعوات" : "Invite status"}
        </h3>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {(["invited", "joined", "declined", "missed", "left"] as const).map((s) => {
            const n = counts[s] ?? 0;
            if (!n) return null;
            const cfg = STATUS[s];
            return (
              <span key={s} className={cn("rounded-full border px-2 py-0.5", cfg.tone)}>
                {rtl ? cfg.ar : cfg.en} · {n}
              </span>
            );
          })}
        </div>
      </header>
      <ul className="space-y-1.5" role="list">
        {rows.map((p: any) => {
          const cfg = STATUS[p.join_status] ?? STATUS.invited;
          const name = p.profile?.display_name || p.profile?.email || (rtl ? "بدون اسم" : "Unnamed");
          const stamp =
            p.join_status === "joined" ? p.joined_at :
            p.join_status === "left" ? p.left_at :
            p.updated_at ?? p.created_at;
          const isOnline = p.presence?.status === "online";
          return (
            <li
              key={p.user_id}
              className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/20 p-2"
            >
              <div className="relative shrink-0">
                <LuxuryAvatar
                  src={p.profile?.avatar_url ?? null}
                  name={name}
                  size={40}
                />
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-neutral-950",
                    isOnline ? "bg-emerald-400" : "bg-neutral-500",
                  )}
                  aria-label={isOnline ? (rtl ? "متصل" : "online") : (rtl ? "غير متصل" : "offline")}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                  <span className="truncate">{name}</span>
                  {p.is_initiator && (
                    <Crown className="h-3 w-3 text-amber-300" aria-label={rtl ? "المتصل" : "initiator"} />
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-white/50">
                  {p.profile?.job_title ? `${p.profile.job_title} · ` : ""}
                  {rtl ? "آخر تحديث" : "updated"} {fmtRelative(stamp, rtl)}
                </div>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  cfg.tone,
                  p.join_status === "invited" && "animate-pulse",
                )}
              >
                <cfg.Icon className="h-3 w-3" aria-hidden="true" />
                {rtl ? cfg.ar : cfg.en}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

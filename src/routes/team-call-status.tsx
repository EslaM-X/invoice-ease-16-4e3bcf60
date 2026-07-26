import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTeamCallReachability } from "@/lib/calls.functions";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Loader2, BellRing, Check, PhoneOff, PhoneMissed, LogOut, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/team-call-status")({
  head: () => ({
    meta: [
      { title: "Team Call Reachability · Steinheim" },
      { name: "description", content: "Live team reachability, presence, and call invite state for every member." },
      { property: "og:title", content: "Team Call Reachability · Steinheim" },
      { property: "og:description", content: "Live team reachability, presence, and call invite state for every member." },
    ],
  }),
  component: TeamCallStatusPage,
});

const STATUS: Record<string, { ar: string; en: string; tone: string; Icon: any }> = {
  invited:  { ar: "يرن…",   en: "Ringing…", tone: "text-amber-600 bg-amber-500/10 border-amber-500/30", Icon: BellRing },
  joined:   { ar: "انضم",   en: "Joined",   tone: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", Icon: Check },
  declined: { ar: "رفض",    en: "Declined", tone: "text-rose-600 bg-rose-500/10 border-rose-500/30", Icon: PhoneOff },
  missed:   { ar: "لم يرد", en: "Missed",   tone: "text-muted-foreground bg-muted border-border", Icon: PhoneMissed },
  left:     { ar: "غادر",   en: "Left",     tone: "text-sky-600 bg-sky-500/10 border-sky-500/30", Icon: LogOut },
};

function rel(iso: string | null | undefined, rtl: boolean) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return rtl ? "الآن" : "just now";
  if (s < 60) return rtl ? `${s} ث` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return rtl ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return rtl ? `${h} س` : `${h}h`;
  const d = Math.floor(h / 24);
  return rtl ? `${d} ي` : `${d}d`;
}

function TeamCallStatusPage() {
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const fetch = useServerFn(getTeamCallReachability);
  const q = useQuery({
    queryKey: ["team-call-reachability"],
    queryFn: () => fetch({}),
    refetchInterval: 10_000,
  });

  const rows = q.data?.members ?? [];
  const online = rows.filter((r: any) => r.presence?.status === "online").length;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4" dir={rtl ? "rtl" : "ltr"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {rtl ? "حالة استقبال المكالمات للفريق" : "Team Call Reachability"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {rtl
                ? `${online} متصل الآن من إجمالي ${rows.length} — حالة الدعوة الأخيرة لكل عضو`
                : `${online} online of ${rows.length} — latest call-invite state per member`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn("h-4 w-4", rtl ? "ml-1" : "mr-1", q.isFetching && "animate-spin")} />
              {rtl ? "تحديث" : "Refresh"}
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link to="/call-history">{rtl ? "سجل المكالمات" : "Call history"}</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rtl ? "الأعضاء" : "Members"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                {rtl ? "جارٍ التحميل…" : "Loading…"}
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">
                {rtl ? "لا يوجد أعضاء" : "No members found"}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((m: any) => {
                  const name = m.profile?.display_name || m.profile?.email || (rtl ? "بدون اسم" : "Unnamed");
                  const isOnline = m.presence?.status === "online";
                  const inv = m.last_invite;
                  const cfg = inv ? (STATUS[inv.join_status] ?? STATUS.invited) : null;
                  return (
                    <li key={m.user_id} className="flex items-center gap-3 py-3">
                      <div className="relative shrink-0">
                        <LuxuryAvatar url={m.profile?.avatar_url ?? null} name={name} size={44} />
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                            isOnline ? "bg-emerald-500" : "bg-muted-foreground/50",
                          )}
                          aria-label={isOnline ? (rtl ? "متصل" : "online") : (rtl ? "غير متصل" : "offline")}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.profile?.job_title ? `${m.profile.job_title} · ` : ""}
                          {isOnline
                            ? (rtl ? "متصل الآن" : "online now")
                            : (rtl
                                ? `آخر ظهور ${rel(m.presence?.last_seen_at, rtl)}`
                                : `last seen ${rel(m.presence?.last_seen_at, rtl)}`)}
                          {m.last_message_at
                            ? ` · ${rtl ? "آخر تفاعل" : "last read"} ${rel(m.last_message_at, rtl)}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {cfg ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              cfg.tone,
                              inv.join_status === "invited" && "animate-pulse",
                            )}
                            title={rel(inv.joined_at ?? inv.left_at ?? inv.created_at, rtl)}
                          >
                            <cfg.Icon className="h-3 w-3" aria-hidden="true" />
                            {rtl ? cfg.ar : cfg.en}
                            <span className="opacity-70">· {rel(inv.joined_at ?? inv.left_at ?? inv.created_at, rtl)}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {rtl ? "لا توجد دعوات" : "no invites"}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

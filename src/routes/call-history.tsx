import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyCallHistory } from "@/lib/calls.functions";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { useI18n } from "@/lib/i18n";
import {
  Phone, Video, PhoneMissed, PhoneOff, PhoneIncoming, PhoneOutgoing, Users, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/call-history")({
  head: () => ({
    meta: [
      { title: "Call History · Steinheim" },
      { name: "description", content: "Voice and video call logs across all your team chat rooms." },
      { property: "og:title", content: "Call History · Steinheim" },
      { property: "og:description", content: "Voice and video call logs across all your team chat rooms." },
    ],
  }),
  component: CallHistoryPage,
});

function formatDur(sec: number | null | undefined) {
  const s = sec ?? 0;
  if (s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function CallHistoryPage() {
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const { user } = useAuth();
  const fetchHistory = useServerFn(listMyCallHistory);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["call-history"],
    queryFn: () => fetchHistory({ data: { limit: 100 } }),
  });

  const calls = data?.calls ?? [];

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4" dir={rtl ? "rtl" : "ltr"}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {rtl ? "سجل المكالمات" : "Call History"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {rtl
                ? "كل مكالمات الصوت والفيديو في غرف الفريق التي تشارك فيها"
                : "All voice & video calls across chat rooms you belong to"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : rtl ? "تحديث" : "Refresh"}
            </Button>
            <Link to={"/team-chat" as any}>
              <Button size="sm" variant="ghost">{rtl ? "شات الفريق" : "Team chat"}</Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {rtl ? "جارٍ التحميل…" : "Loading…"}
          </div>
        ) : calls.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              {rtl ? "لا توجد مكالمات بعد" : "No calls yet"}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {calls.map((c: any) => {
              const isVideo = c.mode === "video";
              const isMe = c.initiator_id === user?.id;
              const joined = (c.participants ?? []).filter((p: any) => p.join_status === "joined");
              const statusMeta = getStatusMeta(c.status, isMe, c.me_participated, rtl);
              return (
                <Card
                  key={c.id}
                  className={cn(
                    "border-primary/10 hover:border-primary/30 transition-colors",
                    statusMeta.accent
                  )}
                >
                  <CardHeader className="pb-3 flex-row items-center gap-3 space-y-0">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
                        isVideo ? "bg-sky-500/15 text-sky-500" : "bg-emerald-500/15 text-emerald-500"
                      )}
                    >
                      {isVideo ? <Video className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        <span className="truncate">
                          {c.room?.name || (rtl ? "غرفة" : "Room")}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px]", statusMeta.badgeClass)}>
                          <span className="flex items-center gap-1">
                            {statusMeta.icon}
                            {statusMeta.label}
                          </span>
                        </Badge>
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>{new Date(c.started_at).toLocaleString(rtl ? "ar-EG" : "en-US")}</span>
                        <span className="tabular-nums">
                          {rtl ? "المدة" : "Duration"}: {formatDur(c.duration_seconds)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {joined.length}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-xs text-muted-foreground">
                        {rtl ? "بدأها" : "Started by"}:
                      </div>
                      <div className="flex items-center gap-1.5">
                        <LuxuryAvatar
                          url={c.initiator?.avatar_url}
                          name={c.initiator?.display_name || c.initiator?.email || "?"}
                          size={22}
                          ring="gold"
                          showSkeleton={false}
                        />
                        <span className="text-xs font-medium">
                          {c.initiator?.display_name || c.initiator?.email || "—"}
                        </span>
                      </div>
                      {joined.length > 0 && (
                        <>
                          <div className="text-xs text-muted-foreground ml-2">
                            {rtl ? "المشاركون" : "Participants"}:
                          </div>
                          <div className="flex -space-x-2 rtl:space-x-reverse">
                            {joined.slice(0, 6).map((p: any) => (
                              <div key={p.user_id} className="ring-2 ring-background rounded-full">
                                <LuxuryAvatar
                                  url={p.profile?.avatar_url}
                                  name={p.profile?.display_name || p.profile?.email || "?"}
                                  size={22}
                                  ring="none"
                                  showSkeleton={false}
                                />
                              </div>
                            ))}
                            {joined.length > 6 && (
                              <div className="h-[22px] w-[22px] rounded-full bg-muted text-[10px] flex items-center justify-center ring-2 ring-background">
                                +{joined.length - 6}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function getStatusMeta(status: string, isMe: boolean, participated: boolean, rtl: boolean) {
  switch (status) {
    case "ended":
      return {
        label: rtl ? "نجحت" : "Completed",
        icon: isMe ? <PhoneOutgoing className="h-3 w-3" /> : <PhoneIncoming className="h-3 w-3" />,
        badgeClass: "border-emerald-500/40 text-emerald-600 bg-emerald-500/10",
        accent: "",
      };
    case "missed":
      return {
        label: rtl ? "فائتة" : "Missed",
        icon: <PhoneMissed className="h-3 w-3" />,
        badgeClass: "border-red-500/40 text-red-600 bg-red-500/10",
        accent: participated ? "" : "ring-1 ring-red-500/20",
      };
    case "cancelled":
      return {
        label: rtl ? "ملغاة" : "Cancelled",
        icon: <PhoneOff className="h-3 w-3" />,
        badgeClass: "border-muted-foreground/30 text-muted-foreground bg-muted/50",
        accent: "",
      };
    case "ringing":
      return {
        label: rtl ? "جارية" : "Ringing",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        badgeClass: "border-amber-500/40 text-amber-600 bg-amber-500/10",
        accent: "ring-1 ring-amber-500/30",
      };
    case "active":
      return {
        label: rtl ? "نشطة" : "Active",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        badgeClass: "border-sky-500/40 text-sky-600 bg-sky-500/10",
        accent: "ring-1 ring-sky-500/30",
      };
    default:
      return {
        label: status,
        icon: <Phone className="h-3 w-3" />,
        badgeClass: "border-muted-foreground/30 text-muted-foreground",
        accent: "",
      };
  }
}

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCheck, Check, Clock, Circle } from "lucide-react";
import { getMessageInfo } from "@/lib/chat.functions";
import { cn } from "@/lib/utils";

export function MessageInfoDialog({
  open, onOpenChange, messageId, rtl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messageId: string | null;
  rtl: boolean;
}) {
  const fetchInfo = useServerFn(getMessageInfo);
  const q = useQuery({
    queryKey: ["chat-msg-info", messageId],
    queryFn: () => (messageId ? fetchInfo({ data: { message_id: messageId } }) : Promise.resolve(null)),
    enabled: !!messageId && open,
    refetchInterval: open ? 4000 : false,
    staleTime: 0,
  });

  const info = q.data as any;
  const seen = info?.seen ?? [];
  const delivered = info?.delivered ?? [];
  const pending = info?.pending ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={rtl ? "rtl" : "ltr"} className="max-w-md p-0 overflow-hidden bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white border-[color:var(--brand-gold,#d4af37)]/25">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-white flex items-center gap-2">
            <CheckCheck className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
            {rtl ? "معلومات الرسالة" : "Message info"}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {rtl ? "من شاف، من وصلته، ومين متصل دلوقتي." : "Who saw it, who received it, who's online now."}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pb-2 grid grid-cols-3 gap-2 text-center text-xs">
          <StatCard
            label={rtl ? "شاهدها" : "Seen"}
            value={seen.length}
            tone="gold"
            icon={<CheckCheck className="h-3.5 w-3.5" />}
            hint={
              info?.last_read_at
                ? (rtl ? "آخر مشاهدة " : "Last read ") +
                  new Date(info.last_read_at).toLocaleString(rtl ? "ar-EG" : undefined, {
                    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short",
                  })
                : undefined
            }
          />
          <StatCard label={rtl ? "وصلته" : "Delivered"} value={delivered.length} tone="white" icon={<Check className="h-3.5 w-3.5" />} />
          <StatCard label={rtl ? "متصل" : "Online"} value={info?.online_count ?? 0} tone="green" icon={<Circle className="h-2.5 w-2.5 fill-current" />} />
        </div>

        <ScrollArea className="max-h-[52vh]">
          <Section title={rtl ? "شاهدها" : "Seen by"} rows={seen} rtl={rtl} tone="gold" mode="seen" empty={rtl ? "مفيش حد شافها لسه" : "Nobody has seen it yet"} />
          <Section title={rtl ? "وصلته ومحدش فتحها" : "Delivered"} rows={delivered} rtl={rtl} tone="white" mode="delivered" empty={rtl ? "لا يوجد" : "None"} />
          <Section title={rtl ? "لسه ما وصلتش" : "Not delivered yet"} rows={pending} rtl={rtl} tone="muted" mode="pending" empty={rtl ? "كل الأعضاء استلموها" : "Everyone has received it"} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, tone, icon, hint }: { label: string; value: number; tone: "gold" | "white" | "green"; icon: React.ReactNode; hint?: string }) {
  const toneCls =
    tone === "gold" ? "text-[color:var(--brand-gold,#d4af37)] border-[color:var(--brand-gold,#d4af37)]/30 bg-[color:var(--brand-gold,#d4af37)]/10"
    : tone === "green" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
    : "text-white border-white/15 bg-white/5";
  return (
    <div className={cn("rounded-xl border p-2.5", toneCls)}>
      <div className="flex items-center justify-center gap-1 opacity-80">{icon}<span>{label}</span></div>
      <div className="text-2xl font-black tabular-nums mt-1">{value}</div>
      {hint && <div className="text-[10px] opacity-70 mt-1 leading-tight">{hint}</div>}
    </div>
  );
}

function Section({
  title, rows, rtl, tone, mode, empty,
}: {
  title: string;
  rows: Array<{ user_id: string; display_name: string; avatar_url: string | null; seen_at?: string | null; online_now?: boolean }>;
  rtl: boolean;
  tone: "gold" | "white" | "muted";
  mode: "seen" | "delivered" | "pending";
  empty: string;
}) {
  return (
    <div className="border-t border-white/10">
      <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white/50">{title} · {rows.length}</div>
      {rows.length === 0 ? (
        <div className="px-4 pb-3 text-xs text-white/40 italic">{empty}</div>
      ) : (
        <div className="divide-y divide-white/5">
          {rows.map((r) => (
            <div key={r.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="relative">
                <Avatar className="h-10 w-10 ring-1 ring-white/15">
                  {r.avatar_url && <AvatarImage src={r.avatar_url} />}
                  <AvatarFallback className="bg-white/10 text-white text-sm">
                    {r.display_name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {r.online_now && <span className="absolute bottom-0 end-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#141416]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.display_name}</div>
                {r.seen_at && (
                  <div className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {new Date(r.seen_at).toLocaleString(rtl ? "ar-EG" : undefined, {
                      hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short",
                    })}
                  </div>
                )}
              </div>
              {mode === "seen" && <CheckCheck className="h-4 w-4 text-[color:var(--brand-gold,#d4af37)]" />}
              {mode === "delivered" && <Check className="h-4 w-4 text-white/70" />}
              {mode === "pending" && <Circle className="h-3 w-3 text-white/30" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

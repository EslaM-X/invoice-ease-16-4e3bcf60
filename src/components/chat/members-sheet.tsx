import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Crown, Shield, UserMinus, Users } from "lucide-react";
import { listRoomMembers, setMemberRole, removeMember } from "@/lib/chat.functions";
import { useRoomPresence } from "@/lib/use-chat-presence";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { toast } from "sonner";

export function MembersSheet({
  open, onOpenChange, roomId, roomName, myUserId, iAmAdmin, rtl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roomId: string | null;
  roomName: string;
  myUserId: string;
  iAmAdmin: boolean;
  rtl: boolean;
}) {
  const qc = useQueryClient();
  const fetchMembers = useServerFn(listRoomMembers);
  const setRoleFn = useServerFn(setMemberRole);
  const removeFn = useServerFn(removeMember);

  const q = useQuery({
    queryKey: ["chat-room-members", roomId],
    queryFn: () => (roomId ? fetchMembers({ data: { room_id: roomId } }) : Promise.resolve({ members: [] })),
    enabled: !!roomId && open,
  });
  const members = (q.data?.members ?? []) as any[];
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const { isOnline } = useRoomPresence(memberIds, roomId, myUserId);

  const onlineCount = members.filter((m) => isOnline(m.user_id)).length;
  const admins = members.filter((m) => m.role === "admin");
  const others = members.filter((m) => m.role !== "admin");

  const doRole = async (uid: string, role: "admin" | "member") => {
    if (!roomId) return;
    try {
      await setRoleFn({ data: { room_id: roomId, target_user: uid, role } });
      qc.invalidateQueries({ queryKey: ["chat-room-members", roomId] });
      toast.success(rtl ? "تم التحديث" : "Updated");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };
  const doRemove = async (uid: string) => {
    if (!roomId) return;
    if (!confirm(rtl ? "إزالة العضو؟" : "Remove this member?")) return;
    try {
      await removeFn({ data: { room_id: roomId, target_user: uid } });
      qc.invalidateQueries({ queryKey: ["chat-room-members", roomId] });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      toast.success(rtl ? "تمت الإزالة" : "Removed");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const renderRow = (m: any) => {
    const online = isOnline(m.user_id);
    const canManage = iAmAdmin && m.user_id !== myUserId;
    return (
      <div key={m.user_id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
        <div className="relative shrink-0">
          <Avatar className="h-12 w-12 ring-2 ring-white/15">
            {m.avatar_url && <AvatarImage src={m.avatar_url} />}
            <AvatarFallback className="bg-gradient-to-br from-white/15 to-white/5 text-white text-base font-bold">
              {(m.display_name ?? "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {online && <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-[#141416]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm truncate">{m.display_name}</span>
            {m.is_me && <Badge className="text-[9px] h-4 px-1.5 bg-white/10 text-white/80">{rtl ? "أنت" : "You"}</Badge>}
            {m.role === "admin" && (
              <Badge className="text-[9px] h-4 px-1.5 bg-[color:var(--brand-gold,#d4af37)]/25 text-[color:var(--brand-gold,#d4af37)] border border-[color:var(--brand-gold,#d4af37)]/40">
                <Crown className="h-2.5 w-2.5 me-0.5" /> ADMIN
              </Badge>
            )}
            {m.job_title && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: (m.job_title_color ?? "#64748b") + "22", color: m.job_title_color ?? "#64748b" }}>
                {m.job_title}
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/50 truncate mt-0.5">
            {online ? (rtl ? "متصل الآن" : "online") : (rtl ? "غير متصل" : "offline")}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            {m.role === "admin" ? (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => doRole(m.user_id, "member")}>
                <Shield className="h-3.5 w-3.5 me-1" />{rtl ? "خفض" : "Demote"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-[color:var(--brand-gold,#d4af37)] hover:bg-[color:var(--brand-gold,#d4af37)]/15"
                onClick={() => doRole(m.user_id, "admin")}>
                <Crown className="h-3.5 w-3.5 me-1" />{rtl ? "أدمن" : "Admin"}
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              onClick={() => doRemove(m.user_id)} title={rtl ? "إزالة" : "Remove"}>
              <UserMinus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" dir={rtl ? "rtl" : "ltr"}
        className="p-0 w-full sm:max-w-md bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white border-[color:var(--brand-gold,#d4af37)]/25">
        <SheetHeader className="p-4 pb-2 border-b border-white/10 bg-gradient-to-b from-[color:var(--brand-gold,#d4af37)]/12 to-transparent">
          <SheetTitle className="text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
            {roomName}
          </SheetTitle>
          <SheetDescription className="text-white/60 text-xs">
            {members.length} {rtl ? "عضو" : "members"} · {onlineCount} {rtl ? "متصل" : "online"}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100dvh-6rem)]">
          {admins.length > 0 && (
            <>
              <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--brand-gold,#d4af37)]/90">
                {rtl ? "المشرفون" : "Admins"} · {admins.length}
              </div>
              <div className="divide-y divide-white/5">{admins.map(renderRow)}</div>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">
                {rtl ? "الأعضاء" : "Members"} · {others.length}
              </div>
              <div className="divide-y divide-white/5">{others.map(renderRow)}</div>
            </>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

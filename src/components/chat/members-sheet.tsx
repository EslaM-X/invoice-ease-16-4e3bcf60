import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Crown, Shield, UserMinus, Users, Star, UserPlus, Search, Check,
  Camera, Loader2, Pencil, Save,
} from "lucide-react";
import {
  listRoomMembers, setMemberRole, removeMember, listAddableUsers, addRoomMembers,
  updateRoomProfile,
} from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { useRoomPresence } from "@/lib/use-chat-presence";
import { toast } from "sonner";

type MemberRow = {
  user_id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  job_title: string | null;
  job_title_color: string | null;
  role: string;
  joined_at: string | null;
  is_me: boolean;
  is_creator: boolean;
};

export function MembersSheet({
  open, onOpenChange, roomId, roomName, roomType, roomAvatarUrl, myUserId, iAmAdmin, rtl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roomId: string | null;
  roomName: string;
  roomType?: "direct" | "group" | null;
  roomAvatarUrl?: string | null;
  myUserId: string;
  iAmAdmin: boolean;
  rtl: boolean;
}) {
  const qc = useQueryClient();
  const fetchMembers = useServerFn(listRoomMembers);
  const setRoleFn = useServerFn(setMemberRole);
  const removeFn = useServerFn(removeMember);
  const updateProfileFn = useServerFn(updateRoomProfile);
  const [addOpen, setAddOpen] = useState(false);
  const [editName, setEditName] = useState<string>("");
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const q = useQuery({
    queryKey: ["chat-room-members", roomId],
    queryFn: async () => {
      if (!roomId) return { created_by: null as string | null, room_type: null as string | null, members: [] as MemberRow[] };
      return await fetchMembers({ data: { room_id: roomId } });
    },
    enabled: !!roomId && open,
  });
  const members = (q.data?.members ?? []) as MemberRow[];
  const createdBy = q.data?.created_by ?? null;
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const { isOnline } = useRoomPresence(memberIds, roomId, myUserId);

  const onlineCount = members.filter((m) => isOnline(m.user_id)).length;
  const creatorRow = members.find((m) => m.is_creator);
  const admins = members.filter((m) => m.role === "admin" && !m.is_creator);
  const others = members.filter((m) => m.role !== "admin" && !m.is_creator);

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

  const saveName = async () => {
    if (!roomId) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === roomName) return;
    setSavingName(true);
    try {
      await updateProfileFn({ data: { room_id: roomId, name: trimmed } });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      qc.invalidateQueries({ queryKey: ["chat-room-members", roomId] });
      toast.success(rtl ? "تم تحديث اسم الشات" : "Chat renamed");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setSavingName(false); }
  };

  const pickAvatar = () => fileInputRef.current?.click();
  const onPickAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !roomId) return;
    if (!file.type.startsWith("image/")) {
      toast.error(rtl ? "برجاء اختيار صورة" : "Please pick an image");
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${roomId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-room-avatars")
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from("chat-room-avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("sign_failed");
      await updateProfileFn({ data: { room_id: roomId, avatar_url: signed.signedUrl } });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      toast.success(rtl ? "تم تحديث صورة الشات" : "Chat photo updated");
    } catch (err: any) {
      toast.error(err?.message ?? (rtl ? "فشل الرفع" : "Upload failed"));
    } finally {
      setUploadingAvatar(false);
    }
  };
  const clearAvatar = async () => {
    if (!roomId) return;
    if (!confirm(rtl ? "إزالة صورة الشات؟" : "Remove chat photo?")) return;
    try {
      await updateProfileFn({ data: { room_id: roomId, clear_avatar: true } });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      toast.success(rtl ? "تم" : "Done");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const renderRow = (m: MemberRow) => {
    const online = isOnline(m.user_id);
    const canManage = iAmAdmin && m.user_id !== myUserId && !m.is_creator;
    return (
      <div key={m.user_id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
        <div className="relative shrink-0">
          <LuxuryAvatar
            url={m.avatar_url}
            name={m.display_name}
            size={48}
            ring={m.is_creator ? "gold" : "soft"}
          />
          {online && <span className="absolute bottom-0 end-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-[#141416]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm truncate">{m.display_name}</span>
            {m.is_me && <Badge className="text-[9px] h-4 px-1.5 bg-white/10 text-white/80">{rtl ? "أنت" : "You"}</Badge>}
            {m.is_creator && (
              <Badge className="text-[9px] h-4 px-1.5 bg-[color:var(--brand-gold,#d4af37)]/90 text-black border-0">
                <Star className="h-2.5 w-2.5 me-0.5 fill-current" /> {rtl ? "المُنشئ" : "OWNER"}
              </Badge>
            )}
            {!m.is_creator && m.role === "admin" && (
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

  const canAdd = iAmAdmin || (createdBy != null && createdBy === myUserId);

  return (
    <>
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
            {canAdd && roomId && (
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-2 h-9 bg-[color:var(--brand-gold,#d4af37)] hover:bg-[color:var(--brand-gold,#d4af37)]/90 text-black font-semibold gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                {rtl ? "إضافة عضو للجروب" : "Add member to group"}
              </Button>
            )}
          </SheetHeader>
          <ScrollArea className="h-[calc(100dvh-9rem)]">
            {creatorRow && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--brand-gold,#d4af37)]">
                  {rtl ? "منشئ الشات" : "Chat creator"}
                </div>
                <div className="divide-y divide-white/5">{renderRow(creatorRow)}</div>
              </>
            )}
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

      {roomId && (
        <AddMembersDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          roomId={roomId}
          rtl={rtl}
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ["chat-room-members", roomId] });
            qc.invalidateQueries({ queryKey: ["chat-rooms"] });
          }}
        />
      )}
    </>
  );
}

function AddMembersDialog({
  open, onOpenChange, roomId, rtl, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roomId: string;
  rtl: boolean;
  onAdded: () => void;
}) {
  const fetchAddable = useServerFn(listAddableUsers);
  const addFn = useServerFn(addRoomMembers);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["chat-addable-users", roomId, open],
    queryFn: () => fetchAddable({ data: { room_id: roomId } }),
    enabled: open,
  });
  const users = (q.data?.users ?? []) as Array<{
    user_id: string; display_name: string; email: string | null; avatar_url: string | null;
    job_title: string | null; job_title_color: string | null;
  }>;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return users;
    return users.filter((u) =>
      (u.display_name ?? "").toLowerCase().includes(s) ||
      (u.email ?? "").toLowerCase().includes(s)
    );
  }, [users, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const doAdd = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await addFn({ data: { room_id: roomId, user_ids: Array.from(selected) } });
      toast.success(rtl ? `تمت إضافة ${selected.size} عضو` : `Added ${selected.size} member(s)`);
      setSelected(new Set());
      setSearch("");
      onAdded();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={rtl ? "rtl" : "ltr"} className="max-w-md p-0 overflow-hidden bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white border-[color:var(--brand-gold,#d4af37)]/25">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-white flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[color:var(--brand-gold,#d4af37)]" />
            {rtl ? "إضافة أعضاء" : "Add members"}
          </DialogTitle>
          <DialogDescription className="text-white/60">
            {rtl ? "اختر الأعضاء اللي عاوز تضيفهم للشات." : "Pick people to add to this chat."}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={rtl ? "ابحث بالاسم أو البريد..." : "Search by name or email…"}
              className="ps-9 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus-visible:ring-[color:var(--brand-gold,#d4af37)]"
            />
          </div>
        </div>
        <ScrollArea className="max-h-[48vh]">
          {q.isLoading ? (
            <div className="px-4 py-6 text-center text-sm text-white/50">{rtl ? "جاري التحميل..." : "Loading…"}</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-white/50">
              {rtl ? "مفيش أعضاء متاحين للإضافة." : "No one available to add."}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((u) => {
                const on = selected.has(u.user_id);
                return (
                  <button
                    key={u.user_id}
                    type="button"
                    onClick={() => toggle(u.user_id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-start transition ${on ? "bg-[color:var(--brand-gold,#d4af37)]/10" : "hover:bg-white/5"}`}
                  >
                    <LuxuryAvatar url={u.avatar_url} name={u.display_name} size={40} ring="soft" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{u.display_name}</span>
                        {u.job_title && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: (u.job_title_color ?? "#64748b") + "22", color: u.job_title_color ?? "#64748b" }}>
                            {u.job_title}
                          </span>
                        )}
                      </div>
                      {u.email && <div className="text-[11px] text-white/50 truncate">{u.email}</div>}
                    </div>
                    <div className={`h-6 w-6 rounded-full border flex items-center justify-center transition ${on ? "bg-[color:var(--brand-gold,#d4af37)] border-[color:var(--brand-gold,#d4af37)] text-black" : "border-white/25 text-transparent"}`}>
                      <Check className="h-4 w-4" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <DialogFooter className="p-4 pt-2 border-t border-white/10 gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-white/70 hover:text-white hover:bg-white/5">
            {rtl ? "إلغاء" : "Cancel"}
          </Button>
          <Button
            onClick={doAdd}
            disabled={selected.size === 0 || busy}
            className="bg-[color:var(--brand-gold,#d4af37)] hover:bg-[color:var(--brand-gold,#d4af37)]/90 text-black font-semibold"
          >
            {busy
              ? (rtl ? "جاري الإضافة..." : "Adding…")
              : (rtl ? `إضافة (${selected.size})` : `Add (${selected.size})`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

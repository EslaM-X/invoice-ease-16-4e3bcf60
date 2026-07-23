import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { MessageSquare, X, Minus, GripHorizontal, ExternalLink } from "lucide-react";
import { chatEvents, type IncomingChatMessage } from "@/lib/chat-events";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { getAvatarSrc, getAvatarSrcSet } from "@/lib/avatar-url";
import { cn } from "@/lib/utils";

type RoomMeta = {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  // For DM: the "other" user info
  other_user_id?: string | null;
  other_avatar_url?: string | null;
  other_name?: string | null;
};

type QueueItem = IncomingChatMessage & { seenAt: number };

const POS_KEY = "chat-popup-pos-v1";
const MIN_KEY = "chat-popup-min-v1";
const CLOSED_UNTIL_KEY = "chat-popup-closed-until-v1";

function initials(name?: string | null, email?: string | null) {
  const s = (name || email || "?").trim();
  if (!s) return "?";
  const parts = s.split(/[\s@._-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
}

export default function ChatPopupNotifier() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const location = useLocation();
  const navigate = useNavigate();
  const onChatPage = location.pathname.startsWith("/team-chat");

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [roomMetas, setRoomMetas] = useState<Record<string, RoomMeta>>({});
  const [minimized, setMinimized] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(MIN_KEY) === "1"; } catch { return false; }
  });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p?.x === "number" && typeof p?.y === "number") return p;
    } catch {}
    return null;
  });

  // Cache-bust token for avatar HD re-fetch on DPR changes
  const [bust, setBust] = useState<string>(() => String(Date.now()));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => setBust(String(Date.now()));
    try { mq.addEventListener("change", handler); } catch { mq.addListener(handler); }
    return () => {
      try { mq.removeEventListener("change", handler); } catch { mq.removeListener(handler); }
    };
  }, []);

  // Subscribe to global chat events
  useEffect(() => {
    if (!user) return;
    const off = chatEvents.on((m) => {
      // Respect a temporary "closed" state (until next message anyway -- so we still show it)
      setQueue((q) => {
        // Dedupe by id, keep last 5
        const next = [...q.filter((x) => x.id !== m.id), { ...m, seenAt: Date.now() }];
        return next.slice(-5);
      });
      // Clear "closed until" so a new message re-opens the popup
      try { localStorage.removeItem(CLOSED_UNTIL_KEY); } catch {}
    });
    return off;
  }, [user?.id]);

  // Fetch room metadata for any room we don't yet have
  useEffect(() => {
    const missing = Array.from(new Set(queue.map((q) => q.room_id))).filter((rid) => !roomMetas[rid]);
    if (missing.length === 0 || !user) return;
    let cancelled = false;
    (async () => {
      const { data: rooms } = await supabase
        .from("chat_rooms")
        .select("id,type,name,avatar_url")
        .in("id", missing);
      const metas: Record<string, RoomMeta> = {};
      for (const r of rooms ?? []) {
        metas[r.id] = { id: r.id, type: r.type, name: r.name, avatar_url: r.avatar_url };
      }
      // For DMs, look up the other member's profile
      const dmRoomIds = (rooms ?? []).filter((r: any) => r.type !== "group").map((r: any) => r.id);
      if (dmRoomIds.length) {
        const { data: mems } = await supabase
          .from("chat_room_members")
          .select("room_id,user_id")
          .in("room_id", dmRoomIds);
        const otherIds = new Set<string>();
        const otherByRoom: Record<string, string> = {};
        for (const m of mems ?? []) {
          if (m.user_id !== user.id) {
            otherByRoom[m.room_id] = m.user_id;
            otherIds.add(m.user_id);
          }
        }
        if (otherIds.size) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id,full_name,avatar_url,email")
            .in("id", Array.from(otherIds));
          const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
          for (const rid of dmRoomIds) {
            const uid = otherByRoom[rid];
            const p = uid ? pMap.get(uid) : null;
            if (metas[rid]) {
              metas[rid].other_user_id = uid ?? null;
              metas[rid].other_avatar_url = (p as any)?.avatar_url ?? null;
              metas[rid].other_name = (p as any)?.full_name ?? (p as any)?.email ?? null;
            }
          }
        }
      }
      if (!cancelled) setRoomMetas((prev) => ({ ...prev, ...metas }));
    })();
    return () => { cancelled = true; };
  }, [queue, user?.id, roomMetas]);

  // Group queue by room (latest wins) for compact list
  const byRoom = useMemo(() => {
    const map = new Map<string, { last: QueueItem; count: number }>();
    for (const m of queue) {
      const cur = map.get(m.room_id);
      map.set(m.room_id, { last: m, count: (cur?.count ?? 0) + 1 });
    }
    return Array.from(map.entries()).map(([room_id, v]) => ({ room_id, ...v }));
  }, [queue]);

  const total = queue.length;

  // Drag handling (pointer events, mouse + touch)
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false });

  const clampToViewport = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const el = cardRef.current;
    const w = el?.offsetWidth ?? 340;
    const h = el?.offsetHeight ?? 120;
    const maxX = Math.max(0, window.innerWidth - w - 8);
    const maxY = Math.max(0, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, active: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const next = clampToViewport(e.clientX - dragRef.current.dx, e.clientY - dragRef.current.dy);
    setPos(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    if (pos) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
    }
  };

  // Re-clamp on window resize
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampToViewport(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampToViewport]);

  const toggleMin = () => {
    setMinimized((v) => {
      const nv = !v;
      try { localStorage.setItem(MIN_KEY, nv ? "1" : "0"); } catch {}
      return nv;
    });
  };

  const closeAll = () => {
    setQueue([]);
    try { localStorage.setItem(CLOSED_UNTIL_KEY, String(Date.now())); } catch {}
  };

  const openRoom = (roomId: string) => {
    setQueue((q) => q.filter((x) => x.room_id !== roomId));
    navigate({ to: "/team-chat", search: { room: roomId } as any });
  };

  if (!user || onChatPage || total === 0) return null;

  // Default position: bottom-end
  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 80 }
    : { position: "fixed", bottom: 24, [ar ? "left" : "right"]: 24, zIndex: 80 } as React.CSSProperties;

  // ---- Minimized bubble (draggable) ----
  if (minimized) {
    const first = byRoom[0];
    const meta = first ? roomMetas[first.room_id] : undefined;
    const isGroup = meta?.type === "group";
    const avatarUrl = isGroup ? meta?.avatar_url : meta?.other_avatar_url ?? null;
    const label = isGroup ? meta?.name : meta?.other_name;
    return (
      <div
        ref={cardRef}
        style={style}
        className="select-none touch-none"
      >
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => setMinimized(false)}
          onClick={(e) => {
            // If a drag just happened, avoid opening. Simple heuristic: only open on click if we didn't move.
            e.stopPropagation();
            setMinimized(false);
          }}
          aria-label={ar ? "افتح إشعارات الشات" : "Open chat notifications"}
          className="relative grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)] ring-1 ring-[color:var(--brand-gold,#d4af37)]/50 hover:ring-[color:var(--brand-gold,#d4af37)]"
        >
          {avatarUrl ? (
            <img
              src={getAvatarSrc(avatarUrl, 56, bust)}
              srcSet={getAvatarSrcSet(avatarUrl, 56, bust)}
              alt={label ?? ""}
              className="h-12 w-12 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[color:var(--brand-gold,#d4af37)]/25 to-primary/25 text-sm font-bold">
              {initials(label, first?.last.sender_email)}
            </span>
          )}
          <span className="absolute -top-1 -end-1 min-w-[22px] h-[22px] px-1.5 grid place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black text-[11px] font-black shadow ring-2 ring-black/60">
            {total > 99 ? "99+" : total}
          </span>
          <span className="sr-only">{total} {ar ? "رسائل جديدة" : "new messages"}</span>
        </button>
      </div>
    );
  }

  // ---- Expanded card ----
  return (
    <div
      ref={cardRef}
      style={{ ...style, width: 340 }}
      dir={ar ? "rtl" : "ltr"}
      className="select-none"
    >
      <div className="rounded-2xl overflow-hidden bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] ring-1 ring-[color:var(--brand-gold,#d4af37)]/35 backdrop-blur-md">
        {/* Header — drag handle */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex items-center gap-2 px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripHorizontal className="h-4 w-4 text-white/50" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)]/20 ring-1 ring-[color:var(--brand-gold,#d4af37)]/40">
              <MessageSquare className="h-3.5 w-3.5 text-[color:var(--brand-gold,#d4af37)]" />
            </span>
            <span className="text-sm font-bold truncate">
              {ar ? "رسائل جديدة" : "New messages"}
            </span>
            <span className="min-w-[22px] h-[22px] px-1.5 grid place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black text-[11px] font-black">
              {total > 99 ? "99+" : total}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleMin}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/80"
            aria-label={ar ? "تصغير" : "Minimize"}
            title={ar ? "تصغير" : "Minimize"}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closeAll}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/80"
            aria-label={ar ? "إغلاق" : "Close"}
            title={ar ? "إغلاق" : "Close"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Items */}
        <ul className="max-h-[52vh] overflow-y-auto divide-y divide-white/5">
          {byRoom.slice().reverse().map((item) => {
            const meta = roomMetas[item.room_id];
            const isGroup = meta?.type === "group";
            const avatarUrl = isGroup ? meta?.avatar_url : meta?.other_avatar_url ?? null;
            const label = isGroup
              ? meta?.name ?? (ar ? "مجموعة" : "Group")
              : meta?.other_name ?? item.last.sender_email ?? (ar ? "زميل" : "Teammate");
            const time = item.last.created_at ? new Date(item.last.created_at) : new Date(item.last.seenAt);
            const timeStr = time.toLocaleTimeString(ar ? "ar-EG" : undefined, { hour: "2-digit", minute: "2-digit" });
            return (
              <li key={item.room_id}>
                <button
                  type="button"
                  onClick={() => openRoom(item.room_id)}
                  className="w-full text-start flex items-center gap-3 px-3 py-3 hover:bg-white/5 transition"
                >
                  <div className="relative shrink-0">
                    {avatarUrl ? (
                      <img
                        src={getAvatarSrc(avatarUrl, 48, bust)}
                        srcSet={getAvatarSrcSet(avatarUrl, 48, bust)}
                        alt={label ?? ""}
                        className="h-11 w-11 rounded-full object-cover ring-1 ring-[color:var(--brand-gold,#d4af37)]/40"
                        draggable={false}
                      />
                    ) : (
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[color:var(--brand-gold,#d4af37)]/25 to-primary/25 ring-1 ring-[color:var(--brand-gold,#d4af37)]/40 text-sm font-bold">
                        {initials(label, item.last.sender_email)}
                      </span>
                    )}
                    {item.count > 1 && (
                      <span className="absolute -top-1 -end-1 min-w-[20px] h-[20px] px-1 grid place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black text-[10px] font-black ring-2 ring-black/60">
                        {item.count > 99 ? "99+" : item.count}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{label}</p>
                      <span className="text-[10px] text-white/50 tabular-nums ms-auto shrink-0">{timeStr}</span>
                    </div>
                    <p className="text-xs text-white/70 truncate mt-0.5">
                      {!isGroup ? "" : (item.last.sender_email ? `${item.last.sender_email}: ` : "")}
                      {item.last.body || ""}
                    </p>
                  </div>
                  <ExternalLink className={cn("h-4 w-4 text-white/40 shrink-0", ar && "rotate-180")} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

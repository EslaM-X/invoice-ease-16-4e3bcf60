import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  MessageSquare, X, Minus, GripHorizontal, ExternalLink,
  BellOff, Bell, Layers, Maximize2,
} from "lucide-react";
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
  other_user_id?: string | null;
  other_avatar_url?: string | null;
  other_name?: string | null;
};

type QueueItem = IncomingChatMessage & { seenAt: number };
type Size = "sm" | "md" | "lg";
type ZMode = "below" | "above";

const SIZE_W: Record<Size, number> = { sm: 300, md: 340, lg: 420 };
const SIZE_LIST_MAX: Record<Size, string> = { sm: "40vh", md: "52vh", lg: "64vh" };
const SNAP_THRESHOLD = 48;
const CLOSED_UNTIL_KEY_BASE = "chat-popup-closed-until-v1";

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
  const onChatPage = location.pathname.startsWith("/team-chat");

  // Per-user preference keys
  const uid = user?.id ?? "anon";
  const posKey = `chat-popup:pos:${uid}`;
  const minKey = `chat-popup:min:${uid}`;
  const sizeKey = `chat-popup:size:${uid}`;
  const dndKey = `chat-popup:dnd:${uid}`;
  const zKey = `chat-popup:z:${uid}`;
  const closedKey = `${CLOSED_UNTIL_KEY_BASE}:${uid}`;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [roomMetas, setRoomMetas] = useState<Record<string, RoomMeta>>({});
  const [minimized, setMinimized] = useState<boolean>(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<Size>("md");
  const [dnd, setDnd] = useState<boolean>(false);
  const [zMode, setZMode] = useState<ZMode>("below");
  const [focused, setFocused] = useState<boolean>(false);
  const [conflict, setConflict] = useState<boolean>(false);

  // Load per-user prefs
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setMinimized(localStorage.getItem(minKey) === "1");
      const s = localStorage.getItem(sizeKey);
      if (s === "sm" || s === "md" || s === "lg") setSize(s);
      setDnd(localStorage.getItem(dndKey) === "1");
      const z = localStorage.getItem(zKey);
      if (z === "above" || z === "below") setZMode(z);
      const raw = localStorage.getItem(posKey);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") setPos(p);
      }
    } catch { /* ignore */ }
  }, [posKey, minKey, sizeKey, dndKey, zKey]);

  // Cache-bust token for avatar HD re-fetch on DPR changes
  const [bust, setBust] = useState<string>(() => String(Date.now()));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => setBust(String(Date.now()));
    try { mq.addEventListener("change", handler); } catch { mq.addListener(handler as any); }
    return () => {
      try { mq.removeEventListener("change", handler); } catch { mq.removeListener(handler as any); }
    };
  }, []);

  // Subscribe to global chat events
  useEffect(() => {
    if (!user) return;
    const off = chatEvents.on((m) => {
      setQueue((q) => {
        const next = [...q.filter((x) => x.id !== m.id), { ...m, seenAt: Date.now() }];
        return next.slice(-5);
      });
      try { localStorage.removeItem(closedKey); } catch { /* ignore */ }
    });
    return off;
  }, [user?.id, closedKey]);

  // Fetch room metadata
  useEffect(() => {
    const missing = Array.from(new Set(queue.map((q) => q.room_id))).filter((rid) => !roomMetas[rid]);
    if (missing.length === 0 || !user) return;
    let cancelled = false;
    (async () => {
      const { data: rooms } = await supabase
        .from("chat_rooms").select("id,type,name,avatar_url").in("id", missing);
      const metas: Record<string, RoomMeta> = {};
      for (const r of rooms ?? []) {
        metas[r.id] = { id: r.id, type: r.type, name: r.name, avatar_url: r.avatar_url };
      }
      const dmRoomIds = (rooms ?? []).filter((r: any) => r.type !== "group").map((r: any) => r.id);
      if (dmRoomIds.length) {
        const { data: mems } = await supabase
          .from("chat_room_members").select("room_id,user_id").in("room_id", dmRoomIds);
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
            .from("profiles").select("id,full_name,avatar_url,email").in("id", Array.from(otherIds));
          const pMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
          for (const rid of dmRoomIds) {
            const uid2 = otherByRoom[rid];
            const p = uid2 ? pMap.get(uid2) : null;
            if (metas[rid]) {
              metas[rid].other_user_id = uid2 ?? null;
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

  const byRoom = useMemo(() => {
    const map = new Map<string, { last: QueueItem; count: number }>();
    for (const m of queue) {
      const cur = map.get(m.room_id);
      map.set(m.room_id, { last: m, count: (cur?.count ?? 0) + 1 });
    }
    return Array.from(map.entries()).map(([room_id, v]) => ({ room_id, ...v }));
  }, [queue]);

  const total = queue.length;

  // ---- Drag + snap ----
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; active: boolean; moved: boolean }>({
    dx: 0, dy: 0, active: false, moved: false,
  });

  const clampToViewport = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const el = cardRef.current;
    const w = el?.offsetWidth ?? SIZE_W[size];
    const h = el?.offsetHeight ?? 120;
    const maxX = Math.max(0, window.innerWidth - w - 8);
    const maxY = Math.max(0, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
  }, [size]);

  const snapToEdges = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const el = cardRef.current;
    const w = el?.offsetWidth ?? SIZE_W[size];
    const h = el?.offsetHeight ?? 120;
    const rightGap = window.innerWidth - (x + w);
    const bottomGap = window.innerHeight - (y + h);
    let nx = x, ny = y;
    if (x < SNAP_THRESHOLD) nx = 12;
    else if (rightGap < SNAP_THRESHOLD) nx = window.innerWidth - w - 12;
    if (y < SNAP_THRESHOLD) ny = 12;
    else if (bottomGap < SNAP_THRESHOLD) ny = window.innerHeight - h - 12;
    return { x: nx, y: ny };
  }, [size]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, active: true, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.moved = true;
    const next = clampToViewport(e.clientX - dragRef.current.dx, e.clientY - dragRef.current.dy);
    setPos(next);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setPos((cur) => {
      if (!cur) return cur;
      const snapped = snapToEdges(cur.x, cur.y);
      try { localStorage.setItem(posKey, JSON.stringify(snapped)); } catch { /* ignore */ }
      return snapped;
    });
  };

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampToViewport(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampToViewport]);

  // ---- Do-Not-Disturb: detect conflicting open dialogs/menus ----
  useEffect(() => {
    if (!dnd || typeof document === "undefined") return;
    const check = () => {
      const overlays = document.querySelectorAll<HTMLElement>(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]'
      );
      if (!cardRef.current || overlays.length === 0) { setConflict(false); return; }
      const cr = cardRef.current.getBoundingClientRect();
      let overlap = false;
      overlays.forEach((o) => {
        const r = o.getBoundingClientRect();
        if (!(r.right < cr.left || r.left > cr.right || r.bottom < cr.top || r.top > cr.bottom)) {
          overlap = true;
        }
      });
      setConflict(overlap);
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "style"] });
    const iv = window.setInterval(check, 700);
    return () => { mo.disconnect(); window.clearInterval(iv); };
  }, [dnd, pos, size, minimized]);

  const toggleMin = () => {
    setMinimized((v) => {
      const nv = !v;
      try { localStorage.setItem(minKey, nv ? "1" : "0"); } catch { /* ignore */ }
      return nv;
    });
  };
  const applySize = (s: Size) => {
    setSize(s);
    try { localStorage.setItem(sizeKey, s); } catch { /* ignore */ }
  };
  const toggleDnd = () => {
    setDnd((v) => {
      const nv = !v;
      try { localStorage.setItem(dndKey, nv ? "1" : "0"); } catch { /* ignore */ }
      if (!nv) setConflict(false);
      return nv;
    });
  };
  const toggleZ = () => {
    setZMode((v) => {
      const nv: ZMode = v === "above" ? "below" : "above";
      try { localStorage.setItem(zKey, nv); } catch { /* ignore */ }
      return nv;
    });
  };
  const closeAll = () => {
    setQueue([]);
    try { localStorage.setItem(closedKey, String(Date.now())); } catch { /* ignore */ }
  };
  const openLatestRoom = useCallback(() => {
    const latest = queue[queue.length - 1];
    if (!latest) return;
    setQueue((q) => q.filter((x) => x.room_id !== latest.room_id));
    if (typeof window !== "undefined") {
      window.location.href = `/team-chat?room=${encodeURIComponent(latest.room_id)}`;
    }
  }, [queue]);
  const openRoom = (roomId: string) => {
    setQueue((q) => q.filter((x) => x.room_id !== roomId));
    if (typeof window !== "undefined") {
      window.location.href = `/team-chat?room=${encodeURIComponent(roomId)}`;
    }
  };

  // ---- Keyboard shortcuts ----
  // Alt+Shift+N: toggle minimize/expand
  // Alt+Shift+J: jump to latest room
  // Alt+Shift+D: toggle DND
  // Esc: close (when focused) or when minimized-hover state
  useEffect(() => {
    if (!user || onChatPage) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.altKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        toggleMin();
        // Focus card after toggle
        requestAnimationFrame(() => cardRef.current?.focus());
      } else if (e.altKey && e.shiftKey && (e.key === "J" || e.key === "j")) {
        e.preventDefault();
        openLatestRoom();
      } else if (e.altKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        toggleDnd();
      } else if (e.key === "Escape" && !inField && focused) {
        e.preventDefault();
        if (!minimized) toggleMin();
        else closeAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user?.id, onChatPage, focused, minimized, openLatestRoom]);

  if (!user || onChatPage || total === 0) return null;

  const zIndex = zMode === "above" ? 80 : 40;
  const dimmed = dnd && conflict;

  const style: React.CSSProperties = pos
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex }
    : ({ position: "fixed", bottom: 24, [ar ? "left" : "right"]: 24, zIndex } as React.CSSProperties);

  const cardShellClass = cn(
    "transition-[opacity,filter] duration-200 outline-none",
    dimmed ? "opacity-25 hover:opacity-100 pointer-events-none hover:pointer-events-auto" : "opacity-100",
    focused && "ring-2 ring-[color:var(--brand-gold,#d4af37)] ring-offset-2 ring-offset-black/40 rounded-2xl"
  );

  // ---- Minimized bubble ----
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
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label={ar ? "إشعارات الرسائل (Alt+Shift+N لفتح/إغلاق، Alt+Shift+J لأحدث رسالة)" : "Chat notifications (Alt+Shift+N toggle, Alt+Shift+J latest)"}
        className={cn("select-none touch-none", cardShellClass)}
      >
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => setMinimized(false)}
          onClick={(e) => {
            if (dragRef.current.moved) { dragRef.current.moved = false; return; }
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
          {dnd && (
            <span className="absolute -bottom-1 -start-1 h-5 w-5 grid place-items-center rounded-full bg-black/80 ring-1 ring-white/20">
              <BellOff className="h-3 w-3 text-white/80" />
            </span>
          )}
        </button>
      </div>
    );
  }

  // ---- Expanded card ----
  return (
    <div
      ref={cardRef}
      style={{ ...style, width: SIZE_W[size] }}
      dir={ar ? "rtl" : "ltr"}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={ar
        ? "إشعارات الرسائل — Alt+Shift+N للطي، Alt+Shift+J لأحدث محادثة، Alt+Shift+D لعدم الإزعاج، Esc للإغلاق"
        : "Chat notifications — Alt+Shift+N minimize, Alt+Shift+J latest, Alt+Shift+D DND, Esc close"}
      className={cn("select-none", cardShellClass)}
    >
      <div className="rounded-2xl overflow-hidden bg-[linear-gradient(180deg,rgba(20,20,22,0.98),rgba(15,15,17,0.98))] text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] ring-1 ring-[color:var(--brand-gold,#d4af37)]/35 backdrop-blur-md">
        {/* Header — drag handle */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex items-center gap-1 px-2.5 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripHorizontal className="h-4 w-4 text-white/50 shrink-0" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)]/20 ring-1 ring-[color:var(--brand-gold,#d4af37)]/40 shrink-0">
              <MessageSquare className="h-3.5 w-3.5 text-[color:var(--brand-gold,#d4af37)]" />
            </span>
            <span className="text-sm font-bold truncate">
              {ar ? "رسائل جديدة" : "New messages"}
            </span>
            <span className="min-w-[22px] h-[22px] px-1.5 grid place-items-center rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black text-[11px] font-black shrink-0">
              {total > 99 ? "99+" : total}
            </span>
          </div>

          {/* Size cycle */}
          <button
            type="button"
            onClick={() => applySize(size === "sm" ? "md" : size === "md" ? "lg" : "sm")}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/80"
            aria-label={ar ? "تغيير الحجم" : "Change size"}
            title={ar ? `الحجم: ${size === "sm" ? "صغير" : size === "md" ? "متوسط" : "كبير"}` : `Size: ${size}`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          {/* z-index toggle */}
          <button
            type="button"
            onClick={toggleZ}
            className={cn("p-1.5 rounded-md hover:bg-white/10", zMode === "above" ? "text-[color:var(--brand-gold,#d4af37)]" : "text-white/70")}
            aria-label={ar ? "طبقة العرض" : "Layer priority"}
            title={ar
              ? (zMode === "above" ? "فوق العناصر" : "تحت القوائم والنوافذ")
              : (zMode === "above" ? "Above overlays" : "Below overlays")}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>

          {/* DND toggle */}
          <button
            type="button"
            onClick={toggleDnd}
            className={cn("p-1.5 rounded-md hover:bg-white/10", dnd ? "text-[color:var(--brand-gold,#d4af37)]" : "text-white/70")}
            aria-label={ar ? "عدم الإزعاج" : "Do not disturb"}
            title={ar
              ? (dnd ? "عدم الإزعاج: مُفعّل (يتلاشى مع القوائم)" : "عدم الإزعاج: متوقف")
              : (dnd ? "DND on — dims on overlaps" : "DND off")}
          >
            {dnd ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={toggleMin}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/80"
            aria-label={ar ? "تصغير" : "Minimize"}
            title={ar ? "تصغير (Alt+Shift+N)" : "Minimize (Alt+Shift+N)"}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={closeAll}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/80"
            aria-label={ar ? "إغلاق" : "Close"}
            title={ar ? "إغلاق (Esc)" : "Close (Esc)"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Items */}
        <ul
          className="overflow-y-auto divide-y divide-white/5"
          style={{ maxHeight: SIZE_LIST_MAX[size] }}
        >
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
                  className="w-full text-start flex items-center gap-3 px-3 py-3 hover:bg-white/5 focus:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--brand-gold,#d4af37)]/60 transition"
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

        {/* Shortcut hint footer */}
        <div className="px-3 py-1.5 border-t border-white/10 text-[10px] text-white/50 flex items-center gap-2 flex-wrap">
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono">Alt+Shift+N</kbd>
          <span>{ar ? "طي" : "toggle"}</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono">Alt+Shift+J</kbd>
          <span>{ar ? "أحدث" : "latest"}</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono">Esc</kbd>
          <span>{ar ? "إغلاق" : "close"}</span>
        </div>
      </div>
    </div>
  );
}

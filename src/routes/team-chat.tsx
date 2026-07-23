import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Users, MessageSquare, ArrowLeft, ArrowRight, Search, ChevronDown,
  Bell, BellOff, X, ArrowUp, ArrowDown, Users2, Rows3, ArrowDownToLine, Loader2,
  Maximize2, Minimize2, PanelLeftOpen, StretchHorizontal,
} from "lucide-react";
import { MembersSheet } from "@/components/chat/members-sheet";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";
import { supabase } from "@/integrations/supabase/client";
import { uniqueRealtimeTopic } from "@/lib/realtime";
import {
  listChatRooms, listChatMessages, sendChatMessage, markRoomRead,
  listCompanyMembers, createChatRoom, deleteChatMessage,
  toggleReaction, setTypingState, updatePresence,
  markMessagesRead, getChatWallpaper, setChatWallpaper,
  getChatDensity, setChatDensity, getChatLayout, setChatLayout,
  getChatRoomScroll, setChatRoomScroll,
} from "@/lib/chat.functions";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useOverflowGuard } from "@/lib/use-overflow-guard";
import { Composer } from "@/components/chat/composer";
import { MessageBubble, type ChatMsg } from "@/components/chat/message-bubble";
import { DaySeparator } from "@/components/chat/day-separator";
import { TypingIndicator, type Typer } from "@/components/chat/typing-indicator";
import { chatDayKey, formatChatDayLabel } from "@/lib/format-chat-day";
import { record as perfRecord } from "@/lib/chat-perf";
import { useRoomPresence } from "@/lib/use-chat-presence";
import {
  WallpaperPicker, WALLPAPER_STYLES,
  type WallpaperPreset, type WallpaperValue,
} from "@/components/chat/wallpaper-picker";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/team-chat")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: TeamChatPageBoundary,
});

type WallpaperState = {
  default: WallpaperValue;
  rooms: Record<string, WallpaperValue>;
};

const DEFAULT_WP: WallpaperState = {
  default: { type: "preset", preset: "noir" },
  rooms: {},
};

function TeamChatPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const rtl = lang === "ar";
  const qc = useQueryClient();
  const fetchRooms = useServerFn(listChatRooms);
  const fetchMessages = useServerFn(listChatMessages);
  const sendMessage = useServerFn(sendChatMessage);
  const markRead = useServerFn(markRoomRead);
  const fetchMembers = useServerFn(listCompanyMembers);
  const createRoom = useServerFn(createChatRoom);
  const deleteMsg = useServerFn(deleteChatMessage);
  const reactFn = useServerFn(toggleReaction);
  const typingFn = useServerFn(setTypingState);
  const presenceFn = useServerFn(updatePresence);
  const markReadsFn = useServerFn(markMessagesRead);
  const getWallpaperFn = useServerFn(getChatWallpaper);
  const setWallpaperFn = useServerFn(setChatWallpaper);
  const getDensityFn = useServerFn(getChatDensity);
  const setDensityFn = useServerFn(setChatDensity);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rid = new URLSearchParams(window.location.search).get("room");
    if (rid) setActiveRoomId(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile browser back-button: while a room is open on a phone, register a
  // history entry so the hardware/gesture Back returns to the room list
  // instead of leaving the chat page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeRoomId) return;
    const isMobile = window.matchMedia?.("(max-width: 767px)")?.matches;
    if (!isMobile) return;
    const state = { teamChatRoom: activeRoomId };
    try { window.history.pushState(state, "", window.location.href); } catch {/* ignore */}
    const onPop = () => setActiveRoomId(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeRoomId]);
  const [newOpen, setNewOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMsg | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [wallpaperState, setWallpaperState] = useState<WallpaperState>(DEFAULT_WP);
  const [applyPerRoom, setApplyPerRoom] = useState(false);
  const [customWpUrls, setCustomWpUrls] = useState<Record<string, string>>({});
  const [pendingMessages, setPendingMessages] = useState<ChatMsg[]>([]);
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatQuery, setInChatQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const overflowToastShownRef = useRef(false);
  const { breached: overflowBreached, reset: resetOverflowGuard } = useOverflowGuard(rootRef, {
    label: "team-chat",
    onBreach: (info) => {
      if (overflowToastShownRef.current) return;
      overflowToastShownRef.current = true;
      try {
        toast.error(
          (document?.documentElement?.dir === "rtl"
            ? "تم اكتشاف تمرير أفقي غير مقصود — تم تفعيل وضع العرض المبسّط."
            : "Detected unintended horizontal scroll — switched to simple layout."),
          { duration: 5000 }
        );
      } catch {}
      // eslint-disable-next-line no-console
      console.warn("[team-chat] entering simple fallback layout", info);
    },
  });
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({});
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const lastNotifiedRef = useRef<string | null>(null);

  // Per-room scroll position — synced to Supabase (user_ui_preferences.chat_room_scroll)
  // with localStorage as a warm cache for instant restore on the same device.
  const pendingRestoreRef = useRef<number | null>(null);
  const didRestoreRef = useRef<Record<string, boolean>>({});
  const saveScrollTimerRef = useRef<number | null>(null);
  const remoteScrollRef = useRef<Record<string, { top: number; ts?: string }>>({});
  const remoteScrollLoadedRef = useRef(false);
  const [restoredPill, setRestoredPill] = useState(false);
  const scrollStorageKey = useCallback(
    (roomId: string) => `chat:scroll:v1:${user?.id ?? "anon"}:${roomId}`,
    [user?.id]
  );
  const scrollTsKey = useCallback(
    (roomId: string) => `chat:scroll:v1:ts:${user?.id ?? "anon"}:${roomId}`,
    [user?.id]
  );
  const prefersReducedMotion = useCallback(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    []
  );

  // Density (comfortable | cozy | compact)
  type Density = "comfortable" | "cozy" | "compact";
  const [density, setDensityState] = useState<Density>("cozy");
  useEffect(() => {
    getDensityFn().then((r: any) => {
      const d = r?.density;
      if (d === "comfortable" || d === "cozy" || d === "compact") setDensityState(d);
    }).catch(() => {});
  }, [getDensityFn]);
  const pendingRealignRef = useRef<{ bottom: number; atBottom: boolean } | null>(null);
  const captureRealign = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pendingRealignRef.current = {
      bottom: el.scrollHeight - el.scrollTop - el.clientHeight,
      atBottom: (el.scrollHeight - el.scrollTop - el.clientHeight) < 60,
    };
  }, []);
  const applyDensity = useCallback((d: Density) => {
    captureRealign();
    setDensityState(d);
    setDensityFn({ data: { density: d } }).catch(() => {});
  }, [setDensityFn, captureRealign]);
  const densityVars = useMemo<Record<string, string>>(() => {
    if (density === "compact")
      return {
        "--chat-avatar-slot": "44px",
        "--chat-bubble-pad": "4px 8px",
        "--chat-bubble-font": "12.5px",
      };
    if (density === "comfortable")
      return {
        "--chat-avatar-slot": "60px",
        "--chat-bubble-pad": "10px 14px",
        "--chat-bubble-font": "15px",
      };
    return {
      "--chat-avatar-slot": "56px",
      "--chat-bubble-pad": "8px 12px",
      "--chat-bubble-font": "14px",
    };
  }, [density]);

  // Auto-realign after density change: preserve distance-from-bottom (or stick to bottom).
  useLayoutEffect(() => {
    try {
      const el = scrollRef.current;
      const snap = pendingRealignRef.current;
      if (!el || !snap) return;
      pendingRealignRef.current = null;
      requestAnimationFrame(() => {
        const el2 = scrollRef.current;
        if (!el2) return;
        if (snap.atBottom) {
          el2.scrollTop = el2.scrollHeight;
        } else {
          el2.scrollTop = Math.max(0, el2.scrollHeight - el2.clientHeight - snap.bottom);
        }
      });
    } catch (err) {
      console.error("[team-chat] density realign failed", err);
      toast.error(lang === "ar" ? "تعذّرت إعادة محاذاة الرسائل بعد تغيير الكثافة" : "Failed to realign chat after density change");
    }
  }, [density, lang]);

  // Re-align when DPR changes (zoom / display switch) so bubbles don't jump.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    let mq: MediaQueryList | null = null;
    const attach = () => {
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const handler = () => {
        captureRealign();
        // Trigger the same layout-effect path by nudging density state to itself
        setDensityState((d) => d);
        // Detach and re-attach on new DPR
        if (mq) mq.removeEventListener?.("change", handler);
        attach();
      };
      mq.addEventListener?.("change", handler);
    };
    attach();
    return () => { if (mq) mq.onchange = null; };
  }, [captureRealign]);
  const densityPaddingClass =
    density === "compact"
      ? "p-2 sm:p-3"
      : density === "comfortable"
      ? "p-3 sm:p-5 md:p-7"
      : "p-3 sm:p-4 md:p-6 lg:px-10 xl:px-14";
  const densityGapPx = density === "compact" ? 2 : density === "comfortable" ? 12 : 8;

  // Chat layout preference (width + focus mode) — persisted per user via Supabase (localStorage as fast cache).
  type ChatWidth = "default" | "wide" | "full";
  const widthKey = user?.id ? `chat:width:${user.id}` : "chat:width:anon";
  const focusKey = user?.id ? `chat:focus:${user.id}` : "chat:focus:anon";
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [chatWidth, setChatWidth] = useState<ChatWidth>("wide");
  const getLayoutFn = useServerFn(getChatLayout);
  const setLayoutFn = useServerFn(setChatLayout);
  const getRoomScrollFn = useServerFn(getChatRoomScroll);
  const setRoomScrollFn = useServerFn(setChatRoomScroll);
  const layoutLoadedRef = useRef(false);

  // 1) Warm from localStorage instantly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const w = localStorage.getItem(widthKey);
      if (w === "default" || w === "wide" || w === "full") setChatWidth(w);
      const f = localStorage.getItem(focusKey);
      if (f === "1") setFocusMode(true);
    } catch { /* ignore */ }
  }, [widthKey, focusKey]);

  // 2) Sync from Supabase (authoritative across devices).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getLayoutFn().then((r: any) => {
      if (cancelled) return;
      const L = r?.layout ?? {};
      if (L.width === "default" || L.width === "wide" || L.width === "full") {
        setChatWidth(L.width);
        try { localStorage.setItem(widthKey, L.width); } catch { /* ignore */ }
      }
      if (typeof L.focus === "boolean") {
        setFocusMode(L.focus);
        try { localStorage.setItem(focusKey, L.focus ? "1" : "0"); } catch { /* ignore */ }
      }
      layoutLoadedRef.current = true;
    }).catch(() => { layoutLoadedRef.current = true; });
    return () => { cancelled = true; };
  }, [user?.id, getLayoutFn, widthKey, focusKey]);

  // Preserve scroll bottom-offset across layout mutations that resize the message viewport.
  const preserveScrollThroughLayoutChange = useCallback((run: () => void) => {
    const el = scrollRef.current;
    const bottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
    const atBottom = bottom < 60;
    run();
    if (!el) return;
    // Restore after the CSS width transition + a paint tick.
    let ticks = 0;
    const restore = () => {
      const cur = scrollRef.current;
      if (!cur) return;
      if (atBottom) {
        cur.scrollTop = cur.scrollHeight;
      } else {
        cur.scrollTop = Math.max(0, cur.scrollHeight - cur.clientHeight - bottom);
      }
      ticks += 1;
      if (ticks < 4) requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
  }, []);

  const applyChatWidth = useCallback((w: ChatWidth) => {
    preserveScrollThroughLayoutChange(() => setChatWidth(w));
    try { localStorage.setItem(widthKey, w); } catch { /* ignore */ }
    if (layoutLoadedRef.current) setLayoutFn({ data: { width: w } }).catch(() => {});
  }, [widthKey, setLayoutFn, preserveScrollThroughLayoutChange]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((v) => {
      const nv = !v;
      preserveScrollThroughLayoutChange(() => {});
      try { localStorage.setItem(focusKey, nv ? "1" : "0"); } catch { /* ignore */ }
      if (layoutLoadedRef.current) setLayoutFn({ data: { focus: nv } }).catch(() => {});
      return nv;
    });
  }, [focusKey, setLayoutFn, preserveScrollThroughLayoutChange]);

  const resetChatView = useCallback(() => {
    preserveScrollThroughLayoutChange(() => {
      setChatWidth("wide");
      setFocusMode(false);
    });
    try {
      localStorage.setItem(widthKey, "wide");
      localStorage.setItem(focusKey, "0");
    } catch { /* ignore */ }
    if (layoutLoadedRef.current) {
      setLayoutFn({ data: { width: "wide", focus: false } }).catch(() => {});
    }
  }, [widthKey, focusKey, setLayoutFn, preserveScrollThroughLayoutChange]);

  // Keyboard shortcuts: Alt+Shift+F focus mode, Alt+Shift+S toggle sidebar (same on desktop), Alt+Shift+0 reset.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "f" || k === "s") {
        e.preventDefault();
        toggleFocusMode();
      } else if (k === "0") {
        e.preventDefault();
        resetChatView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocusMode, resetChatView]);

  const widthMaxClass =
    chatWidth === "full" ? "max-w-none"
      : chatWidth === "wide" ? "max-w-[1600px]"
      : "max-w-[1100px]";

  // Older-history pagination + scroll anchor state
  const [olderPages, setOlderPages] = useState<ChatMsg[][]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const preserveScrollRef = useRef<{ prevHeight: number } | null>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when switching rooms
  useEffect(() => {
    setOlderPages([]);
    setHasMoreOlder(true);
    setLoadingOlder(false);
    setIsAtBottom(true);
    setUnseenCount(0);
    setFirstUnreadId(null);
  }, [activeRoomId]);

  // Load wallpaper preference once
  useEffect(() => {
    getWallpaperFn().then((r: any) => {
      const wp = r?.wallpaper;
      if (wp && wp.default) setWallpaperState(wp as WallpaperState);
    }).catch(() => {});
  }, [getWallpaperFn]);

  // Determine active wallpaper (per-room override or default)
  const activeWallpaper: WallpaperValue = useMemo(() => {
    if (activeRoomId && wallpaperState.rooms[activeRoomId]) return wallpaperState.rooms[activeRoomId];
    return wallpaperState.default;
  }, [wallpaperState, activeRoomId]);

  const hasRoomOverride = !!(activeRoomId && wallpaperState.rooms[activeRoomId]);

  useEffect(() => { setApplyPerRoom(hasRoomOverride); }, [activeRoomId, hasRoomOverride]);

  // Sign custom wallpaper URLs
  useEffect(() => {
    const paths = new Set<string>();
    if (wallpaperState.default.type === "custom") paths.add(wallpaperState.default.path);
    for (const v of Object.values(wallpaperState.rooms)) {
      if (v.type === "custom") paths.add(v.path);
    }
    const missing = Array.from(paths).filter((p) => p && !customWpUrls[p]);
    if (missing.length === 0) return;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missing.map(async (p) => {
          const { data } = await supabase.storage.from("chat-wallpapers").createSignedUrl(p, 86400);
          if (data?.signedUrl) updates[p] = data.signedUrl;
        })
      );
      if (Object.keys(updates).length) setCustomWpUrls((prev) => ({ ...prev, ...updates }));
    })();
  }, [wallpaperState, customWpUrls]);

  const activeCustomUrl = activeWallpaper.type === "custom" ? customWpUrls[activeWallpaper.path] : null;

  const applyPreset = useCallback(async (preset: WallpaperPreset) => {
    const scope = applyPerRoom && activeRoomId ? "room" : "default";
    try {
      const r: any = await setWallpaperFn({
        data: { scope, room_id: scope === "room" ? activeRoomId : undefined, action: "preset", preset },
      });
      if (r?.wallpaper) setWallpaperState(r.wallpaper);
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }, [applyPerRoom, activeRoomId, setWallpaperFn]);

  const applyCustom = useCallback(async (path: string) => {
    const scope = applyPerRoom && activeRoomId ? "room" : "default";
    try {
      const r: any = await setWallpaperFn({
        data: { scope, room_id: scope === "room" ? activeRoomId : undefined, action: "custom", path },
      });
      if (r?.wallpaper) setWallpaperState(r.wallpaper);
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }, [applyPerRoom, activeRoomId, setWallpaperFn]);

  const clearCustom = useCallback(async () => {
    const scope = applyPerRoom && activeRoomId ? "room" : "default";
    try {
      const r: any = await setWallpaperFn({
        data: { scope, room_id: scope === "room" ? activeRoomId : undefined, action: "preset", preset: "noir" },
      });
      if (r?.wallpaper) setWallpaperState(r.wallpaper);
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }, [applyPerRoom, activeRoomId, setWallpaperFn]);

  const resetRoomOverride = useCallback(async () => {
    if (!activeRoomId) return;
    try {
      const r: any = await setWallpaperFn({
        data: { scope: "room", room_id: activeRoomId, action: "clear" },
      });
      if (r?.wallpaper) setWallpaperState(r.wallpaper);
      setApplyPerRoom(false);
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }, [activeRoomId, setWallpaperFn]);

  const roomsQ = useQuery({
    queryKey: ["chat-rooms"],
    queryFn: () => fetchRooms(),
    refetchInterval: 20000,
  });

  const messagesQ = useQuery({
    queryKey: ["chat-messages", activeRoomId],
    queryFn: () =>
      activeRoomId ? fetchMessages({ data: { room_id: activeRoomId, limit: 50 } }) : Promise.resolve({ messages: [] }),
    enabled: !!activeRoomId,
  });

  const loadOlderMessages = useCallback(async () => {
    if (!activeRoomId || loadingOlder || !hasMoreOlder) return;
    const firstPageMsgs: ChatMsg[] = messagesQ.data?.messages ?? [];
    const oldestKnown = (olderPages[0]?.[0] ?? firstPageMsgs[0]);
    if (!oldestKnown?.created_at) return;
    setLoadingOlder(true);
    if (scrollRef.current) preserveScrollRef.current = { prevHeight: scrollRef.current.scrollHeight };
    try {
      const r: any = await fetchMessages({
        data: { room_id: activeRoomId, limit: 50, before_created_at: oldestKnown.created_at },
      });
      const page: ChatMsg[] = r?.messages ?? [];
      if (page.length === 0) { setHasMoreOlder(false); }
      else {
        setOlderPages((prev) => [page, ...prev]);
        if (page.length < 50) setHasMoreOlder(false);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load older");
    } finally {
      setLoadingOlder(false);
    }
  }, [activeRoomId, loadingOlder, hasMoreOlder, olderPages, messagesQ.data?.messages, fetchMessages]);

  const membersQ = useQuery({
    queryKey: ["company-members"],
    queryFn: () => fetchMembers(),
    enabled: newOpen,
  });

  const rooms = roomsQ.data?.rooms ?? [];
  const activeRoom = useMemo(() => rooms.find((r: any) => r.id === activeRoomId), [rooms, activeRoomId]);
  const filteredRooms = useMemo(() => {
    if (!searchTerm.trim()) return rooms;
    const s = searchTerm.trim().toLowerCase();
    return rooms.filter((r: any) => (r.display_name ?? "").toLowerCase().includes(s));
  }, [rooms, searchTerm]);

  // Presence for all room members
  const allMemberIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) for (const m of r.members ?? []) set.add(m.user_id);
    return Array.from(set);
  }, [rooms]);
  const { isOnline, lastSeen, typingUserIds } = useRoomPresence(allMemberIds, activeRoomId, user?.id);

  // Heartbeat presence
  useEffect(() => {
    if (!user?.id) return;
    const beat = (status: "online" | "away" | "offline") => {
      try {
        const p = presenceFn({ data: { status } }) as unknown as Promise<unknown> | undefined;
        if (p && typeof (p as Promise<unknown>).catch === "function") {
          (p as Promise<unknown>).catch(() => {/* ignore auth/network blips */});
        }
      } catch {/* ignore */}
    };
    beat("online");
    const interval = window.setInterval(() => beat("online"), 25000);
    const onVis = () => beat(document.hidden ? "away" : "online");
    const onUnload = () => beat("offline");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [user?.id, presenceFn]);

  // Notifications permission bootstrap — auto-request on first visit for every account
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setNotifyEnabled(Notification.permission === "granted");
    if (Notification.permission === "default") {
      // Fire once, silently; if the browser blocks it, the toolbar bell still lets the user retry.
      Notification.requestPermission().then((perm) => {
        setNotifyEnabled(perm === "granted");
      }).catch(() => {});
    }
  }, []);

  const enableNotifications = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error(rtl ? "المتصفح لا يدعم الإشعارات" : "Notifications not supported");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      const granted = perm === "granted";
      setNotifyEnabled(granted);
      if (granted) toast.success(rtl ? "تم تفعيل الإشعارات" : "Notifications enabled");
      else toast.error(rtl ? "تم رفض الإذن" : "Permission denied");
    } catch {}
  }, [rtl]);

  // Realtime per room
  useEffect(() => {
    if (!activeRoomId) return;
    const ch = supabase
      .channel(uniqueRealtimeTopic(`chat-room-${activeRoomId}`))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_messages", filter: `room_id=eq.${activeRoomId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
          qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_reactions" },
        () => qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] })
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message_reads", filter: `room_id=eq.${activeRoomId}` },
        () => qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] })
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeRoomId, qc]);

  // Global rooms + push notifications
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(uniqueRealtimeTopic("chat-rooms-global"))
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_room_members" }, () => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload: any) => {
        qc.invalidateQueries({ queryKey: ["chat-rooms"] });
        const msg = payload?.new;
        if (!msg || msg.sender_id === user.id) return;
        if (lastNotifiedRef.current === msg.id) return;
        lastNotifiedRef.current = msg.id;
        const isActive = msg.room_id === activeRoomId && !document.hidden;
        if (isActive) return;
        if (typeof window === "undefined" || !("Notification" in window)) return;
        if (Notification.permission !== "granted") return;
        // Only notify for rooms user is a member of
        const roomInfo = (roomsQ.data?.rooms ?? []).find((r: any) => r.id === msg.room_id);
        if (!roomInfo) return;
        const title = roomInfo.display_name ?? (rtl ? "رسالة جديدة" : "New message");
        const bodyText =
          msg.message_type === "voice"
            ? (rtl ? "🎤 رسالة صوتية" : "🎤 Voice message")
            : msg.message_type === "image"
              ? (rtl ? "📷 صورة" : "📷 Image")
              : (msg.body ?? "").slice(0, 140);
        try {
          const n = new Notification(title, {
            body: bodyText,
            tag: `chat-${msg.room_id}`,
            icon: roomInfo.avatar_url || "/favicon.ico",
            silent: false,
          });
          n.onclick = () => {
            window.focus();
            setActiveRoomId(msg.room_id);
            n.close();
          };
        } catch {}
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, user?.id, activeRoomId, rtl, roomsQ.data?.rooms]);

  useEffect(() => {
    if (activeRoomId) {
      markRead({ data: { room_id: activeRoomId } }).then(() =>
        qc.invalidateQueries({ queryKey: ["chat-rooms"] })
      );
    }
  }, [activeRoomId, markRead, qc]);

  // Load the remote scroll map once per session and merge remote > local when
  // the remote timestamp is newer (cross-device sync).
  useEffect(() => {
    if (!user?.id || remoteScrollLoadedRef.current) return;
    remoteScrollLoadedRef.current = true;
    (async () => {
      try {
        const r: any = await getRoomScrollFn();
        const remote = (r?.scroll ?? {}) as Record<string, { top: number; ts?: string }>;
        remoteScrollRef.current = remote;
        // Merge into localStorage where remote is newer.
        for (const [roomId, val] of Object.entries(remote)) {
          try {
            const localTs = localStorage.getItem(scrollTsKey(roomId));
            const localTsMs = localTs ? Date.parse(localTs) : 0;
            const remoteTsMs = val?.ts ? Date.parse(val.ts) : 0;
            if (remoteTsMs > localTsMs && Number.isFinite(val?.top) && val.top > 0) {
              localStorage.setItem(scrollStorageKey(roomId), String(Math.round(val.top)));
              if (val.ts) localStorage.setItem(scrollTsKey(roomId), val.ts);
            }
          } catch {}
        }
      } catch (err) {
        console.warn("[team-chat] failed to load remote scroll map", err);
      }
    })();
  }, [user?.id, getRoomScrollFn, scrollStorageKey, scrollTsKey]);

  // Plan a scroll restore whenever we switch rooms (once per room per session)
  useEffect(() => {
    if (!activeRoomId || !user?.id) { pendingRestoreRef.current = null; return; }
    if (didRestoreRef.current[activeRoomId]) { pendingRestoreRef.current = null; return; }
    let target: number | null = null;
    try {
      const raw = localStorage.getItem(scrollStorageKey(activeRoomId));
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) target = n;
    } catch {}
    // Fall back to remote map if we have no local value yet
    if (target == null) {
      const remote = remoteScrollRef.current?.[activeRoomId];
      if (remote && Number.isFinite(remote.top) && remote.top > 0) target = Math.round(remote.top);
    }
    pendingRestoreRef.current = target;
  }, [activeRoomId, user?.id, scrollStorageKey]);

  // Auto-scroll only when user is at the bottom; otherwise increment unseen counter
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    const list = messagesQ.data?.messages ?? [];
    const count = list.length;
    const delta = Math.max(0, count - prevMsgCountRef.current);
    prevMsgCountRef.current = count;
    if (!scrollRef.current) return;
    // Do NOT auto-scroll to bottom while a saved position is waiting to be restored.
    if (pendingRestoreRef.current != null) return;
    if (isAtBottom) {
      const reduce = prefersReducedMotion();
      // Use two frames so the virtualizer measures the new row before we scroll.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (!el) return;
          if (reduce) el.scrollTop = el.scrollHeight;
          else el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
        });
      });
      setUnseenCount(0);
      setFirstUnreadId(null);
    } else if (delta > 0) {
      setUnseenCount((c) => c + delta);
      // Mark the first new message so we can render a "New messages" divider
      setFirstUnreadId((prev) => {
        if (prev) return prev;
        const firstNew = list[count - delta];
        return firstNew?.id ?? null;
      });
    }
  }, [messagesQ.data?.messages?.length, typingUserIds.length, isAtBottom, prefersReducedMotion]);

  // Restore saved scroll position after messages first render for this room
  useLayoutEffect(() => {
    if (!activeRoomId) return;
    const target = pendingRestoreRef.current;
    if (target == null) return;
    const el = scrollRef.current;
    if (!el) return;
    // Wait until the list is tall enough for the saved offset to make sense.
    if (el.scrollHeight < target + el.clientHeight - 8) return;
    el.scrollTop = target;
    const distanceFromBottom = el.scrollHeight - target - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 60);
    didRestoreRef.current[activeRoomId] = true;
    pendingRestoreRef.current = null;
    setRestoredPill(true);
    window.setTimeout(() => setRestoredPill(false), 2500);
  }, [activeRoomId, messagesQ.data?.messages?.length, olderPages]);

  // Preserve scroll position after prepending older messages
  useLayoutEffect(() => {
    if (!scrollRef.current || !preserveScrollRef.current) return;
    const el = scrollRef.current;
    const diff = el.scrollHeight - preserveScrollRef.current.prevHeight;
    if (diff > 0) el.scrollTop += diff;
    preserveScrollRef.current = null;
  }, [olderPages]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? "smooth" : "auto";
    el.scrollTo({ top: el.scrollHeight, behavior });
    setUnseenCount(0);
    setFirstUnreadId(null);
  }, [prefersReducedMotion]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    try {
      const el = e.currentTarget;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom < 60;
      setIsAtBottom(atBottom);
      if (atBottom) { setUnseenCount(0); setFirstUnreadId(null); }
      if (el.scrollTop < 120 && hasMoreOlder && !loadingOlder) {
        loadOlderMessages();
      }
      // Persist scroll position per-room: instant to localStorage, debounced to Supabase.
      if (activeRoomId && user?.id) {
        if (saveScrollTimerRef.current) window.clearTimeout(saveScrollTimerRef.current);
        const roomId = activeRoomId;
        const top = Math.max(0, Math.round(el.scrollTop));
        const h = Math.max(0, Math.round(el.scrollHeight));
        const ts = new Date().toISOString();
        try {
          localStorage.setItem(scrollStorageKey(roomId), String(top));
          localStorage.setItem(scrollTsKey(roomId), ts);
        } catch {}
        remoteScrollRef.current[roomId] = { top, ts };
        saveScrollTimerRef.current = window.setTimeout(() => {
          setRoomScrollFn({ data: { room_id: roomId, top, h } }).catch((err: any) => {
            console.warn("[team-chat] failed to sync scroll to remote", err?.message ?? err);
          });
        }, 1200);
      }
    } catch (err) {
      console.error("[team-chat] scroll handler failed", err);
      toast.error(rtl ? "تعذّر متابعة موضع التمرير" : "Chat scroll tracking failed");
    }
  }, [hasMoreOlder, loadingOlder, loadOlderMessages, rtl, activeRoomId, user?.id, scrollStorageKey, scrollTsKey, setRoomScrollFn]);

  // Sign voice + attachment URLs
  useEffect(() => {
    const msgs = messagesQ.data?.messages ?? [];
    const missingVoice = msgs.filter((m: any) => m.voice_note_url && !voiceUrls[m.voice_note_url]);
    const missingAtt: string[] = [];
    for (const m of msgs) {
      for (const a of m.attachments ?? []) {
        if (a.url && !attachmentUrls[a.url]) missingAtt.push(a.url);
      }
    }
    if (missingVoice.length === 0 && missingAtt.length === 0) return;
    (async () => {
      const vUpdates: Record<string, string> = {};
      await Promise.all(
        missingVoice.map(async (m: any) => {
          const { data } = await supabase.storage.from("chat-voice-notes").createSignedUrl(m.voice_note_url, 3600);
          if (data?.signedUrl) vUpdates[m.voice_note_url] = data.signedUrl;
        })
      );
      const aUpdates: Record<string, string> = {};
      await Promise.all(
        missingAtt.map(async (path) => {
          const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 3600);
          if (data?.signedUrl) aUpdates[path] = data.signedUrl;
        })
      );
      if (Object.keys(vUpdates).length) setVoiceUrls((p) => ({ ...p, ...vUpdates }));
      if (Object.keys(aUpdates).length) setAttachmentUrls((p) => ({ ...p, ...aUpdates }));
    })();
  }, [messagesQ.data?.messages, voiceUrls, attachmentUrls]);

  const onSendText = useCallback(async (body: string, replyId: string | null) => {
    if (!activeRoomId || !user?.id) return;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMsg = {
      id: tempId,
      sender_id: user.id,
      body,
      message_type: "text",
      created_at: new Date().toISOString(),
      sender_display_name: (user.user_metadata as any)?.display_name ?? user.email ?? "You",
      sender_avatar_url: (user.user_metadata as any)?.avatar_url ?? null,
      __pending: true,
    };
    setPendingMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage({ data: { room_id: activeRoomId, body, message_type: "text", reply_to_id: replyId ?? undefined } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
      qc.invalidateQueries({ queryKey: ["chat-rooms"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }, [activeRoomId, sendMessage, qc, user]);

  const onSendVoice = useCallback(async (blob: Blob, durationSeconds: number) => {
    if (!activeRoomId) return;
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const path = `${activeRoomId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("chat-voice-notes")
      .upload(path, blob, { contentType: blob.type, upsert: false });
    if (upErr) throw new Error(upErr.message);
    await sendMessage({
      data: {
        room_id: activeRoomId,
        message_type: "voice",
        voice_note_url: path,
        voice_duration_seconds: Math.max(1, Math.round(durationSeconds)),
      },
    });
    qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    qc.invalidateQueries({ queryKey: ["chat-rooms"] });
  }, [activeRoomId, sendMessage, qc]);

  const onSendImage = useCallback(async (path: string, name: string, mime: string, size: number, replyId: string | null) => {
    if (!activeRoomId) return;
    await sendMessage({
      data: {
        room_id: activeRoomId,
        message_type: "image",
        attachments: [{ url: path, name, mime, size }],
        reply_to_id: replyId ?? undefined,
      },
    });
    qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    qc.invalidateQueries({ queryKey: ["chat-rooms"] });
  }, [activeRoomId, sendMessage, qc]);

  const onTypingChange = useCallback((typing: boolean) => {
    if (!activeRoomId) return;
    typingFn({ data: { room_id: typing ? activeRoomId : null } });
  }, [activeRoomId, typingFn]);

  const onToggleReaction = useCallback(async (m: ChatMsg, emoji: string) => {
    try {
      await reactFn({ data: { message_id: m.id, emoji } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }, [reactFn, qc, activeRoomId]);

  const onDelete = useCallback(async (m: ChatMsg) => {
    if (!confirm(rtl ? "حذف الرسالة؟" : "Delete this message?")) return;
    try {
      await deleteMsg({ data: { message_id: m.id } });
      qc.invalidateQueries({ queryKey: ["chat-messages", activeRoomId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }, [deleteMsg, qc, activeRoomId, rtl]);

  const serverMessages: ChatMsg[] = useMemo(() => {
    const first = messagesQ.data?.messages ?? [];
    if (olderPages.length === 0) return first;
    const flatOlder: ChatMsg[] = [];
    for (const p of olderPages) flatOlder.push(...p);
    return [...flatOlder, ...first];
  }, [messagesQ.data?.messages, olderPages]);
  const messages: ChatMsg[] = useMemo(() => {
    if (pendingMessages.length === 0) return serverMessages;
    const recentServerBodies = new Set(
      serverMessages.slice(-10)
        .filter((m) => m.sender_id === user?.id && m.message_type === "text")
        .map((m) => (m.body ?? "").trim())
    );
    const stillPending = pendingMessages.filter(
      (m) => !recentServerBodies.has((m.body ?? "").trim())
    );
    return [...serverMessages, ...stillPending];
  }, [serverMessages, pendingMessages, user?.id]);


  // Message index lookup (for virtualizer scrollToIndex)
  const messageIndexById = useMemo(() => {
    const m = new Map<string, number>();
    messages.forEach((msg, i) => m.set(msg.id, i));
    return m;
  }, [messages]);

  // Build a unified row list: interleave "day" separators before the first
  // message of each local-day. Message rows remain 1:1 with `messages`, so
  // `msgIndex` still maps 1:1 to the messages array for search/highlight.
  type Row =
    | { kind: "day"; key: string; dayKey: string; label: string; ts: string }
    | { kind: "msg"; key: string; dayKey: string; msgIndex: number };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let prevDay = "";
    const loc: "ar" | "en" = rtl ? "ar" : "en";
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const dk = chatDayKey(m.created_at);
      if (dk !== prevDay) {
        out.push({
          kind: "day",
          key: `day-${dk}`,
          dayKey: dk,
          label: formatChatDayLabel(m.created_at, loc),
          ts: m.created_at,
        });
        prevDay = dk;
      }
      out.push({ kind: "msg", key: m.id, dayKey: dk, msgIndex: i });
    }
    return out;
  }, [messages, rtl]);

  const rowIndexByMsgId = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => { if (r.kind === "msg") map.set(messages[r.msgIndex].id, i); });
    return map;
  }, [rows, messages]);

  // Virtualized message list
  // NOTE: rely on the virtualizer's built-in ResizeObserver-based measurement
  // to avoid subpixel jumps when bubbles grow (images/wallpaper loading).
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "day" ? 36 : 76),
    overscan: 12,
    getItemKey: (i) => rows[i]?.key ?? i,
    scrollMargin: 48, // space for top "Load older" sentinel
  });

  // Sticky day chip: reflect the day of the top-most visible message row.
  const [stickyDayLabel, setStickyDayLabel] = useState<string>("");
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const recompute = () => {
      const t0 = performance.now();
      try {
        const items = rowVirtualizer.getVirtualItems();
        if (!items.length) { setStickyDayLabel(""); return; }
        const scrollTop = el.scrollTop;
        const visible = items.find((it) => it.end >= scrollTop) ?? items[0];
        const r = rows[visible.index];
        if (!r) return;
        const label = r.kind === "day"
          ? r.label
          : formatChatDayLabel(messages[r.msgIndex].created_at, rtl ? "ar" : "en");
        setStickyDayLabel((prev) => (prev === label ? prev : label));
      } catch {/* ignore */}
      finally { perfRecord("stickyDay:recompute", performance.now() - t0); }
    };
    const onScrollRaf = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    recompute();
    el.addEventListener("scroll", onScrollRaf, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScrollRaf);
    };
  }, [rows, messages, rtl, rowVirtualizer, activeRoomId]);

  // In-chat search: rich results (id, index, snippet, ts)
  const searchResults = useMemo(() => {
    const q = inChatQuery.trim().toLowerCase();
    if (!q) return [] as { id: string; index: number; snippet: string; ts: string }[];
    const out: { id: string; index: number; snippet: string; ts: string }[] = [];
    messages.forEach((m, i) => {
      const body = m.body ?? "";
      const idx = body.toLowerCase().indexOf(q);
      if (idx === -1) return;
      const start = Math.max(0, idx - 24);
      const end = Math.min(body.length, idx + q.length + 40);
      const snippet = (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "");
      out.push({ id: m.id, index: i, snippet, ts: m.created_at });
    });
    return out;
  }, [messages, inChatQuery]);
  const searchMatches = useMemo(() => searchResults.map((r) => r.id), [searchResults]);

  useEffect(() => { setSearchIndex(0); }, [inChatQuery, activeRoomId]);

  const jumpToMessageId = useCallback((msgId: string) => {
    const rowIdx = rowIndexByMsgId.get(msgId);
    if (rowIdx == null) return;
    try {
      rowVirtualizer.scrollToIndex(rowIdx, { align: "center" });
    } catch (err) {
      console.error("[team-chat] scrollToIndex failed", err);
      toast.error(rtl ? "تعذّر الانتقال للرسالة المطلوبة" : "Failed to jump to message");
    }
  }, [rowIndexByMsgId, rowVirtualizer, rtl]);

  useEffect(() => {
    if (!inChatSearchOpen || searchResults.length === 0) return;
    const target = searchResults[searchIndex % searchResults.length];
    if (target) jumpToMessageId(target.id);
  }, [searchIndex, searchResults, inChatSearchOpen, jumpToMessageId]);

  // Global shortcut: Ctrl/⌘+F opens in-chat search when a room is active
  useEffect(() => {
    if (!activeRoomId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setInChatSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeRoomId]);

  const currentMatchId = searchMatches.length > 0 ? searchMatches[searchIndex % searchMatches.length] : null;


  // Mark visible messages as read (excluding own)
  useEffect(() => {
    if (!activeRoomId || !user?.id) return;
    const unreadIds = serverMessages
      .filter((m) =>
        m.sender_id !== user.id &&
        !(m.read_by_user_ids ?? []).includes(user.id) &&
        !m.__pending &&
        !m.id.startsWith("pending-")
      )
      .map((m) => m.id);
    if (unreadIds.length === 0) return;
    markReadsFn({ data: { room_id: activeRoomId, message_ids: unreadIds } }).catch(() => {});
  }, [serverMessages, activeRoomId, user?.id, markReadsFn]);

  const typers = useMemo<Typer[]>(() => {
    if (!activeRoom) return [];
    const memberById = new Map<string, any>();
    for (const m of activeRoom.members ?? []) memberById.set(m.user_id, m);
    return typingUserIds
      .filter((id: string) => id !== user?.id)
      .map((id: string): Typer => {
        const m = memberById.get(id);
        return {
          id,
          name: (m?.display_name ?? m?.email ?? "?"),
          avatarUrl: m?.avatar_url ?? null,
        };
      });
  }, [activeRoom, typingUserIds, user?.id]);

  const wallpaperClass = activeWallpaper.type === "preset"
    ? WALLPAPER_STYLES[activeWallpaper.preset as WallpaperPreset] ?? WALLPAPER_STYLES.noir
    : "";

  const wallpaperStyle: React.CSSProperties | undefined = activeWallpaper.type === "custom" && activeCustomUrl
    ? {
        backgroundImage: `linear-gradient(180deg,rgba(0,0,0,0.15),rgba(0,0,0,0.35)),url(${activeCustomUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }
    : undefined;

  return (
    <AppShell fullBleed>
      <div
        ref={rootRef}
        className={cn(
          "team-chat-root flex overflow-hidden bg-card border-t h-[calc(100dvh-3.5rem)] w-full",
          overflowBreached && "team-chat-simple"
        )}
        dir={rtl ? "rtl" : "ltr"}
      >
        {/* Sidebar */}
        <div
          className={cn(
            "w-full md:w-[340px] lg:w-[380px] xl:w-[420px] md:shrink-0 md:border-e flex-col bg-background transition-[width,opacity,transform] duration-300 ease-out motion-reduce:transition-none",
            activeRoomId ? "hidden md:flex" : "flex",
            focusMode && "md:!hidden"
          )}
        >
          <div className="p-3 border-b flex items-center justify-between bg-gradient-to-b from-card via-card to-muted/40 shadow-[0_2px_0_0_color-mix(in_oklab,var(--brand-gold,#d4af37)_18%,transparent)]">
            <h2 className="font-bold text-base flex items-center gap-2 text-foreground">
              <span className="h-8 w-8 rounded-full grid place-items-center bg-gradient-to-br from-[color:var(--brand-gold,#d4af37)]/25 to-primary/25 ring-1 ring-[color:var(--brand-gold,#d4af37)]/40">
                <MessageSquare className="h-4 w-4 text-[color:var(--brand-gold,#d4af37)]" />
              </span>
              <span className="tracking-tight">{rtl ? "الشات الداخلي" : "Team Chat"}</span>
            </h2>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full border border-transparent hover:border-[color:var(--brand-gold,#d4af37)]/30 hover:bg-[color:var(--brand-gold,#d4af37)]/10"
                onClick={enableNotifications}
                title={rtl ? "الإشعارات" : "Notifications"}
                aria-label="Notifications"
              >
                {notifyEnabled
                  ? <Bell className="h-4 w-4 text-[color:var(--brand-gold,#d4af37)]" />
                  : <BellOff className="h-4 w-4 text-muted-foreground" />}
              </Button>
              <NewChatDialog
                open={newOpen}
                onOpenChange={setNewOpen}
                members={membersQ.data?.members ?? []}
                currentUserId={user?.id ?? ""}
                onCreate={async (payload) => {
                  try {
                    const { room } = await createRoom({ data: payload });
                    setNewOpen(false);
                    setActiveRoomId(room.id);
                    qc.invalidateQueries({ queryKey: ["chat-rooms"] });
                  } catch (err: any) {
                    toast.error(err.message ?? "Failed");
                  }
                }}
                rtl={rtl}
              />
            </div>
          </div>
          <div className="p-2.5 border-b bg-card">
            <div className="relative">
              <Search className={cn("h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground", rtl ? "right-3" : "left-3")} />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={rtl ? "بحث في المحادثات..." : "Search conversations..."}
                className={cn("bg-muted/70 border border-border/70 rounded-full h-10 shadow-sm focus-visible:ring-2 focus-visible:ring-[color:var(--brand-gold,#d4af37)]/40", rtl ? "pr-9" : "pl-9")}
              />
            </div>
          </div>
          <ScrollArea className="flex-1 bg-background">
            {filteredRooms.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {searchTerm
                  ? (rtl ? "لا نتائج" : "No results")
                  : (rtl ? "مفيش محادثات لسه. اعمل واحدة جديدة." : "No conversations yet. Start one.")}
              </div>
            )}
            {filteredRooms.map((r: any) => {
              const label = r.display_name ?? (r.type === "direct" ? (rtl ? "محادثة" : "Direct") : (rtl ? "جروب" : "Group"));
              const otherMember = r.type === "direct" ? (r.members ?? []).find((m: any) => !m.is_me) : null;
              const online = otherMember ? isOnline(otherMember.user_id) : false;
              const roomTyping = typingUserIds.length > 0 && r.id === activeRoomId;
              const isActive = activeRoomId === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRoomId(r.id)}
                  className={cn(
                    "w-full text-start p-3 flex items-center gap-3 border-b border-border/60 transition-all",
                    "hover:bg-accent/60 active:bg-accent",
                    isActive && "bg-gradient-to-r from-[color:var(--brand-gold,#d4af37)]/12 via-accent/60 to-transparent border-s-2 border-s-[color:var(--brand-gold,#d4af37)]"
                  )}
                >
                  <div className="relative shrink-0">
                    <LuxuryAvatar url={r.avatar_url} name={label} size={74} ring="gold" showSkeleton={false} />
                    {online && (
                      <span className="absolute bottom-0 end-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-card" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate text-foreground">{label}</span>
                      {r.unread_count > 0 && (
                        <Badge className="h-5 min-w-5 px-1.5 text-[10px] rounded-full bg-[color:var(--brand-gold,#d4af37)] text-black font-bold shadow">
                          {r.unread_count}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5 chat-emoji">
                      {roomTyping
                        ? <span className="text-primary italic">{rtl ? "يكتب الآن..." : "typing..."}</span>
                        : (r.last_message_preview ?? (rtl ? "ابدأ المحادثة" : "Start chatting"))}
                    </div>
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </div>


        {/* Conversation */}
        <div className={cn("flex-1 flex-col min-w-0 mx-auto w-full transition-[max-width] duration-300 ease-out motion-reduce:transition-none", widthMaxClass, activeRoomId ? "flex" : "hidden md:flex")}>
          {activeRoom ? (
            <>
              <div className="p-3 border-b flex items-center gap-3 bg-gradient-to-b from-card to-card/70 backdrop-blur-xl">
                {focusMode && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="hidden md:inline-flex shrink-0 h-9 w-9 rounded-full border border-[color:var(--brand-gold,#d4af37)]/30 hover:bg-[color:var(--brand-gold,#d4af37)]/10"
                    onClick={toggleFocusMode}
                    title={rtl ? "إظهار قائمة المحادثات" : "Show conversations"}
                    aria-label="Show sidebar"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden shrink-0 h-9 w-9"
                  onClick={() => setActiveRoomId(null)}
                  aria-label="Back"
                >
                  {rtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                </Button>


                {/* Header quick-jump popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-3 min-w-0 flex-1 text-start hover:bg-accent/40 rounded-xl px-2 py-1.5 transition group">
                      <div className="relative shrink-0">
                        <LuxuryAvatar
                          url={activeRoom.avatar_url}
                          name={activeRoom.display_name ?? (rtl ? "جروب" : "Group")}
                          size={84}
                          ring="gold"
                          showSkeleton={false}
                        />
                        {activeRoom.type === "direct" && (() => {
                          const other = (activeRoom.members ?? []).find((m: any) => !m.is_me);
                          return other && isOnline(other.user_id) ? (
                            <span className="absolute bottom-0 end-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-card" />
                          ) : null;
                        })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate flex items-center gap-1">
                          {activeRoom.display_name ?? (activeRoom.type === "direct" ? (rtl ? "محادثة مباشرة" : "Direct") : (rtl ? "جروب" : "Group"))}
                          <ChevronDown className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition" />
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {typers.length > 0 ? (
                            <TypingIndicator typers={typers} rtl={rtl} variant="inline" />
                          ) : activeRoom.type === "group" ? (
                            `${(activeRoom.members ?? []).length} ${rtl ? "عضو" : "members"}`
                          ) : (() => {
                            const other = (activeRoom.members ?? []).find((m: any) => !m.is_me);
                            if (!other) return rtl ? "محادثة مباشرة" : "Direct chat";
                            if (isOnline(other.user_id)) return rtl ? "متصل الآن" : "online";
                            const ls = lastSeen(other.user_id);
                            if (ls) return `${rtl ? "آخر ظهور " : "last seen "}${new Date(ls).toLocaleString(rtl ? "ar-EG" : undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}`;
                            return rtl ? "غير متصل" : "offline";
                          })()}
                        </div>
                      </div>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-80 max-h-[70vh] overflow-hidden" align="start" dir={rtl ? "rtl" : "ltr"}>
                    <div className="p-3 border-b bg-gradient-to-b from-card to-muted/30">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {rtl ? "التنقل السريع" : "Quick jump"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {rtl ? "اختر محادثة للانتقال إليها فورًا" : "Pick a chat to jump into"}
                      </div>
                    </div>
                    <ScrollArea className="max-h-[52vh]">
                      {rooms.map((r: any) => {
                        const label = r.display_name ?? (rtl ? "محادثة" : "Chat");
                        return (
                          <button
                            key={r.id}
                            onClick={() => setActiveRoomId(r.id)}
                            className={cn(
                              "w-full text-start p-2.5 flex items-center gap-3 hover:bg-accent transition",
                              r.id === activeRoomId && "bg-accent/70"
                            )}
                          >
                            <LuxuryAvatar url={r.avatar_url} name={label} size={54} ring="gold" showSkeleton={false} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{label}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {r.last_message_preview ?? (rtl ? "لا رسائل بعد" : "No messages yet")}
                              </div>
                            </div>
                            {r.unread_count > 0 && (
                              <Badge className="bg-primary text-primary-foreground rounded-full h-5 min-w-5 px-1.5 text-[10px]">
                                {r.unread_count}
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </ScrollArea>
                  </PopoverContent>
                </Popover>

                <Button
                  size="icon" variant="ghost"
                  className="h-10 w-10 rounded-full shrink-0"
                  onClick={() => setMembersOpen(true)}
                  title={rtl ? "معلومات الشات والأعضاء" : "Chat info & members"}
                  aria-label="Chat info"
                >
                  <Users2 className="h-5 w-5" />
                </Button>

                <Button
                  size="icon" variant="ghost"
                  className="h-10 w-10 rounded-full shrink-0"
                  onClick={() => setInChatSearchOpen((v) => !v)}
                  title={rtl ? "بحث في المحادثة" : "Search in chat"}
                  aria-label="Search in chat"
                >
                  <Search className="h-5 w-5" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon" variant="ghost"
                      className="h-10 w-10 rounded-full shrink-0"
                      title={rtl ? "كثافة العرض" : "Message density"}
                      aria-label="Message density"
                    >
                      <Rows3 className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>{rtl ? "كثافة الرسائل" : "Message density"}</DropdownMenuLabel>
                    {(["comfortable", "cozy", "compact"] as const).map((d) => (
                      <DropdownMenuItem
                        key={d}
                        onClick={() => applyDensity(d)}
                        className={cn("flex items-center justify-between", density === d && "bg-accent")}
                      >
                        <span className="capitalize">
                          {d === "comfortable" ? (rtl ? "مريح" : "Comfortable")
                            : d === "cozy" ? (rtl ? "عادي" : "Cozy")
                            : (rtl ? "مضغوط" : "Compact")}
                        </span>
                        {density === d && <span className="text-primary">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Chat width preference */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon" variant="ghost"
                      className="h-10 w-10 rounded-full shrink-0 hidden md:inline-flex"
                      title={rtl ? "عرض منطقة الشات" : "Chat width"}
                      aria-label="Chat width"
                    >
                      <StretchHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>{rtl ? "عرض منطقة الشات" : "Chat area width"}</DropdownMenuLabel>
                    {(["default", "wide", "full"] as const).map((w) => (
                      <DropdownMenuItem
                        key={w}
                        onClick={() => applyChatWidth(w)}
                        className={cn("flex items-center justify-between", chatWidth === w && "bg-accent")}
                      >
                        <span>
                          {w === "default" ? (rtl ? "افتراضي" : "Default")
                            : w === "wide" ? (rtl ? "موسّع" : "Wide")
                            : (rtl ? "ملء الشاشة" : "Full")}
                        </span>
                        {chatWidth === w && <span className="text-primary">✓</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Focus mode toggle (desktop) */}
                <Button
                  size="icon" variant="ghost"
                  className="h-10 w-10 rounded-full shrink-0 hidden md:inline-flex"
                  onClick={toggleFocusMode}
                  title={(focusMode ? (rtl ? "الخروج من وضع التركيز" : "Exit focus mode") : (rtl ? "وضع التركيز" : "Focus mode")) + " (Alt+Shift+F)"}
                  aria-label="Toggle focus mode"
                >
                  {focusMode ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                </Button>


                <WallpaperPicker
                  value={activeWallpaper}
                  customUrl={activeCustomUrl}
                  onSelectPreset={applyPreset}
                  onUploadCustom={applyCustom}
                  onClearCustom={clearCustom}
                  applyPerRoom={applyPerRoom}
                  onTogglePerRoom={(v) => {
                    setApplyPerRoom(v);
                    if (!v && hasRoomOverride) resetRoomOverride();
                  }}
                  hasRoomOverride={hasRoomOverride}
                  onResetToDefault={resetRoomOverride}
                  rtl={rtl}
                  userId={user?.id ?? ""}
                />
              </div>

              {/* In-chat search bar */}
              {inChatSearchOpen && (
                <div className="border-b bg-gradient-to-r from-card to-muted/40">
                  <div className="px-3 py-2 flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      autoFocus
                      value={inChatQuery}
                      onChange={(e) => setInChatQuery(e.target.value)}
                      onKeyDown={(e) => {
                        const n = searchResults.length;
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setInChatSearchOpen(false);
                          setInChatQuery("");
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          if (n === 0) return;
                          if (e.shiftKey) setSearchIndex((i) => (i - 1 + n) % n);
                          else setSearchIndex((i) => (i + 1) % n);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          if (n > 0) setSearchIndex((i) => (i + 1) % n);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          if (n > 0) setSearchIndex((i) => (i - 1 + n) % n);
                        }
                      }}
                      placeholder={rtl ? "ابحث داخل هذه المحادثة... (Enter للتنقل، Esc للإغلاق)" : "Search in this conversation... (Enter to navigate, Esc to close)"}
                      className="h-8 bg-transparent border-0 focus-visible:ring-0 shadow-none flex-1"
                    />
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                      {searchResults.length > 0
                        ? `${(searchIndex % searchResults.length) + 1}/${searchResults.length}`
                        : (inChatQuery ? (rtl ? "لا نتائج" : "no results") : "")}
                    </span>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      disabled={searchResults.length === 0}
                      onClick={() => setSearchIndex((i) => (i - 1 + searchResults.length) % searchResults.length)}
                      aria-label="Previous match"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      disabled={searchResults.length === 0}
                      onClick={() => setSearchIndex((i) => (i + 1) % searchResults.length)}
                      aria-label="Next match"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setInChatSearchOpen(false); setInChatQuery(""); }}
                      aria-label="Close search"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="max-h-56 overflow-y-auto border-t bg-background/60 backdrop-blur-sm">
                      {searchResults.map((r, i) => {
                        const active = i === (searchIndex % searchResults.length);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            ref={(el) => {
                              if (active && el) el.scrollIntoView({ block: "nearest" });
                            }}
                            onClick={() => { setSearchIndex(i); jumpToMessageId(r.id); }}
                            className={cn(
                              "w-full text-start px-3 py-2 flex items-start gap-2 border-b border-border/40 hover:bg-accent/60 transition",
                              active && "bg-[color:var(--brand-gold,#d4af37)]/10 border-s-2 border-s-[color:var(--brand-gold,#d4af37)]"
                            )}
                          >
                            <span className="text-[10px] tabular-nums text-muted-foreground mt-0.5 shrink-0">
                              {new Date(r.ts).toLocaleTimeString(rtl ? "ar-EG" : undefined, { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="text-xs text-foreground line-clamp-2 flex-1">{r.snippet}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
              {stickyDayLabel && messages.length > 0 && (
                <div className="chat-sticky-day pointer-events-none absolute left-1/2 -translate-x-1/2 z-[5] max-w-[70vw] sm:max-w-none">
                  <DaySeparator label={stickyDayLabel} compact className="!py-0" />
                </div>
              )}
              <div
                ref={scrollRef}
                onScroll={onScroll}
                dir={rtl ? "rtl" : "ltr"}
                className={cn(
                  "team-chat-scroll absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain",
                  densityPaddingClass,
                  wallpaperClass
                )}
                style={{ ...wallpaperStyle, ...densityVars, contain: "layout paint" } as React.CSSProperties}
              >
                {/* Top sentinel: load older */}
                <div ref={topSentinelRef} className="flex justify-center pb-2" style={{ height: 48 }}>
                  {loadingOlder ? (
                    <span className="inline-flex items-center gap-2 text-[11px] text-white/80 bg-black/40 backdrop-blur rounded-full px-3 py-1 border border-white/10 h-fit">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {rtl ? "تحميل الرسائل الأقدم..." : "Loading older messages..."}
                    </span>
                  ) : hasMoreOlder && messages.length > 0 ? (
                    <button
                      type="button"
                      onClick={loadOlderMessages}
                      className="text-[11px] text-white/70 hover:text-white bg-black/30 hover:bg-black/50 backdrop-blur rounded-full px-3 py-1 border border-white/10 transition h-fit"
                    >
                      {rtl ? "تحميل الأقدم" : "Load older"}
                    </button>
                  ) : messages.length > 0 ? (
                    <span className="text-[10px] text-white/40 h-fit">
                      {rtl ? "— بداية المحادثة —" : "— start of conversation —"}
                    </span>
                  ) : null}
                </div>

                {/* Virtualized messages */}
                <div data-virtual-track style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
                  {(() => {
                    let virtualItems: ReturnType<typeof rowVirtualizer.getVirtualItems> = [];
                    try {
                      virtualItems = rowVirtualizer.getVirtualItems();
                    } catch (err) {
                      console.error("[team-chat] virtualizer.getVirtualItems failed", err, {
                        count: messages.length,
                        viewport: { w: window.innerWidth, h: window.innerHeight },
                      });
                      if (!overflowToastShownRef.current) {
                        overflowToastShownRef.current = true;
                        toast.error(rtl ? "تعذّر عرض قائمة الرسائل — تم تفعيل وضع مبسّط." : "Failed to render virtual list — simple mode enabled.");
                      }
                      return null;
                    }
                    return virtualItems.map((vi) => {
                    const row = rows[vi.index];
                    if (!row) return null;

                    // Day separator row
                    if (row.kind === "day") {
                      return (
                        <div
                          key={vi.key}
                          data-index={vi.index}
                          ref={rowVirtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            insetInlineStart: 0,
                            insetInlineEnd: 0,
                            transform: `translateY(${vi.start}px)`,
                            paddingBottom: densityGapPx,
                          }}
                        >
                          <DaySeparator label={row.label} />
                        </div>
                      );
                    }

                    // Message row
                    const i = row.msgIndex;
                    const m = messages[i];
                    if (!m) return null;
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    const mine = m.sender_id === user?.id;
                    const prevSameDay = prev ? chatDayKey(prev.created_at) === row.dayKey : false;
                    const nextSameDay = next ? chatDayKey(next.created_at) === row.dayKey : false;
                    const sameSenderAsPrev = !!prev && prev.sender_id === m.sender_id && prevSameDay;
                    const sameSenderAsNext = !!next && next.sender_id === m.sender_id && nextSameDay;
                    const showName = !sameSenderAsPrev;
                    const showAvatar = !sameSenderAsNext;
                    const isMatch = currentMatchId === m.id;
                    const isFirstUnread = firstUnreadId === m.id;
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={rowVirtualizer.measureElement}
                        id={`msg-${m.id}`}
                        style={{
                          position: "absolute",
                          top: 0,
                          insetInlineStart: 0,
                          insetInlineEnd: 0,
                          transform: `translateY(${vi.start}px)`,
                          paddingBottom: densityGapPx,
                        }}
                      >
                        {isFirstUnread && (
                          <div className="flex items-center gap-2 my-2 px-2 select-none" aria-label={rtl ? "رسائل جديدة" : "New messages"}>
                            <div className="flex-1 h-px bg-[color:var(--brand-gold,#d4af37)]/50" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-black bg-[color:var(--brand-gold,#d4af37)] rounded-full px-2 py-0.5 shadow">
                              {rtl ? "رسائل جديدة" : "New messages"}
                            </span>
                            <div className="flex-1 h-px bg-[color:var(--brand-gold,#d4af37)]/50" />
                          </div>
                        )}
                        <motion.div
                          animate={isMatch ? { boxShadow: ["0 0 0 0 rgba(212,175,55,0.0)", "0 0 0 6px rgba(212,175,55,0.35)", "0 0 0 4px rgba(212,175,55,0.15)"] } : { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
                          transition={{ duration: 0.9, ease: "easeOut" }}
                          className={cn("rounded-2xl", isMatch && "ring-2 ring-[color:var(--brand-gold,#d4af37)]/70")}
                        >
                        <MessageBubble
                          msg={m}
                          mine={mine}
                          showAvatar={showAvatar}
                          showName={showName}
                          rtl={rtl}
                          voiceUrl={m.voice_note_url ? voiceUrls[m.voice_note_url] : undefined}
                          attachmentUrls={attachmentUrls}
                          isGroup={activeRoom.type === "group"}
                          isRead={true}
                          highlightQuery={inChatSearchOpen ? inChatQuery.trim() : ""}
                          onReply={setReplyTo}
                          onDelete={onDelete}
                          onToggleReaction={onToggleReaction}
                        />
                        </motion.div>
                      </div>
                    );
                  });
                  })()}
                </div>



                {typers.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ps-3 pe-3 pb-1"
                  >
                    <TypingIndicator typers={typers} rtl={rtl} variant="line" />
                  </motion.div>
                )}

                {messages.length === 0 && (
                  <div className="flex justify-center py-12">
                    <div className="max-w-xs text-center px-5 py-4 rounded-2xl bg-black/55 backdrop-blur-md border border-[color:var(--brand-gold,#d4af37)]/35 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] text-white">
                      <div className="text-2xl mb-1">💬</div>
                      <div className="text-sm font-semibold">
                        {rtl ? "ابعت أول رسالة 👋" : "Send the first message 👋"}
                      </div>
                      <div className="text-[11px] text-white/70 mt-1">
                        {rtl ? "ابدأ المحادثة وخلي الفريق يشوفك." : "Start the conversation — your team will see it instantly."}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {restoredPill && (
                <div
                  role="status"
                  aria-live="polite"
                  className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/70 text-white border border-[color:var(--brand-gold,#d4af37)]/50 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] px-3 py-1.5 backdrop-blur-md text-[11px] font-semibold motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2"
                >
                  <ArrowUp className="h-3.5 w-3.5 text-[color:var(--brand-gold,#d4af37)]" />
                  {rtl ? "تم استرجاع مكان التمرير" : "Restored your scroll position"}
                </div>
              )}

              {overflowBreached && (
                <button
                  type="button"
                  onClick={() => {
                    overflowToastShownRef.current = false;
                    resetOverflowGuard();
                    try {
                      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    } catch (err) {
                      console.error("[team-chat] reset scroll failed", err);
                    }
                  }}
                  className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-amber-600 hover:bg-amber-500 text-white border border-amber-300/60 shadow-lg px-3 py-1.5 text-[11px] font-bold"
                  aria-label={rtl ? "إعادة تهيئة التخطيط" : "Reset layout"}
                >
                  {rtl ? "إعادة تهيئة التخطيط" : "Reset layout"}
                </button>
              )}

              {!isAtBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="absolute bottom-4 end-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/70 hover:bg-black text-white border border-[color:var(--brand-gold,#d4af37)]/40 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] px-3 py-2 backdrop-blur-md transition"
                  aria-label={rtl ? "الرجوع لأحدث رسالة" : "Jump to latest"}
                  title={rtl ? "الرجوع لأحدث رسالة" : "Jump to latest"}
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  {unseenCount > 0 && (
                    <>
                      <span className="text-[11px] font-semibold">
                        {rtl ? "رسائل جديدة" : "New messages"}
                      </span>
                      <span className="text-[11px] font-bold tabular-nums bg-[color:var(--brand-gold,#d4af37)] text-black rounded-full min-w-[18px] px-1 text-center">
                        {unseenCount > 99 ? "99+" : unseenCount}
                      </span>
                    </>
                  )}
                </button>
              )}
              </div>

              <Composer
                rtl={rtl}
                activeRoomId={activeRoom.id}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                onTypingChange={onTypingChange}
                onSendText={onSendText}
                onSendVoice={onSendVoice}
                onSendImage={onSendImage}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center gap-3">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <div className="font-semibold text-foreground">
                {rtl ? "اختر محادثة عشان تبدأ" : "Pick a conversation to start"}
              </div>
              <div className="text-xs max-w-xs">
                {rtl ? "أو ابدأ محادثة جديدة من زر +" : "Or start a new one from the + button"}
              </div>
            </div>
          )}
        </div>
      </div>

      <MembersSheet
        open={membersOpen}
        onOpenChange={setMembersOpen}
        roomId={activeRoomId}
        roomName={activeRoom?.display_name ?? (rtl ? "الشات" : "Chat")}
        roomType={activeRoom?.type ?? null}
        roomAvatarUrl={activeRoom?.avatar_url ?? null}
        myUserId={user?.id ?? ""}
        iAmAdmin={(activeRoom?.my_role === "admin" || activeRoom?.my_role === "owner")}
        rtl={rtl}
      />
    </AppShell>
  );
}

function NewChatDialog({
  open, onOpenChange, members, currentUserId, onCreate, rtl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: any[];
  currentUserId: string;
  onCreate: (p: { type: "direct" | "group"; name?: string; member_ids: string[] }) => Promise<void>;
  rtl: boolean;
}) {
  const [type, setType] = useState<"direct" | "group">("direct");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const eligible = members.filter((m) => m.user_id !== currentUserId);

  const toggle = (id: string) => {
    if (type === "direct") setSelected([id]);
    else setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    if (selected.length === 0) return;
    if (type === "group" && !groupName.trim()) return;
    await onCreate({
      type,
      name: type === "group" ? groupName.trim() : undefined,
      member_ids: selected,
    });
    setSelected([]); setGroupName(""); setType("direct");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="rounded-full"><Plus className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent dir={rtl ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{rtl ? "محادثة جديدة" : "New conversation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant={type === "direct" ? "default" : "outline"} onClick={() => { setType("direct"); setSelected([]); }}>
              <Users className="h-4 w-4 me-1" />{rtl ? "محادثة فردية" : "Direct"}
            </Button>
            <Button size="sm" variant={type === "group" ? "default" : "outline"} onClick={() => { setType("group"); setSelected([]); }}>
              {rtl ? "جروب" : "Group"}
            </Button>
          </div>
          {type === "group" && (
            <Input
              placeholder={rtl ? "اسم الجروب" : "Group name"}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}
          <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
            {eligible.map((m) => (
              <button
                key={m.user_id}
                onClick={() => toggle(m.user_id)}
                className={cn(
                  "w-full text-start p-2 flex items-center gap-3 hover:bg-accent/50",
                  selected.includes(m.user_id) && "bg-accent"
                )}
              >
                <LuxuryAvatar url={m.avatar_url} name={m.display_name ?? m.email ?? "?"} size={50} ring="soft" showSkeleton={false} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {m.display_name ?? m.email}
                    {m.job_title && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: (m.job_title_color ?? "#64748b") + "22",
                          color: m.job_title_color ?? "#64748b",
                        }}
                      >
                        {m.job_title}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                {selected.includes(m.user_id) && <Badge>✓</Badge>}
              </button>
            ))}
            {eligible.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {rtl ? "مفيش أعضاء آخرين" : "No other members"}
              </div>
            )}
          </div>
          <Button className="w-full" onClick={submit} disabled={selected.length === 0 || (type === "group" && !groupName.trim())}>
            {rtl ? "إنشاء" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

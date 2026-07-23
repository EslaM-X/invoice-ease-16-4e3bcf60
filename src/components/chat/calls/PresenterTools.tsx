/**
 * PresenterTools — professional annotation & pointer layer for LiveKit calls.
 *
 * Tools
 *  - Laser pointer (fading trail)
 *  - Pen, Highlighter, Arrow (freehand / drag)
 *  - Shapes: Rectangle, Ellipse (filled), Ring (stroked circle), Line
 *  - Text label + Sticky note (tap/click to place → inline prompt)
 *  - Eraser (own annotations), Undo (own last), Clear all
 *
 * Style controls
 *  - Color palette (7 colors incl. identity color)
 *  - Size: S / M / L (stroke width / text size)
 *  - Font: Sans / Serif / Mono (for text + stickies)
 *
 * Delivery
 *  - Broadcast over LiveKit data channel (topic "presenter") to every peer
 *  - Overlay renders on ALL participants' screens whenever anyone is sharing
 *  - Per-participant identity color when no explicit color chosen
 *  - Fully touch-enabled (pointer events + touchAction:none) — works on
 *    phone, tablet, and desktop; toolbar wraps on narrow viewports.
 *
 * Keyboard (desktop)
 *  A toggle toolbar · 1 laser · 2 pen · 3 highlighter · 4 arrow ·
 *  5 rectangle · 6 ellipse · 7 ring · 8 line · T text · N sticky ·
 *  E eraser · Z undo · X clear · Esc off
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoomContext, useTracks } from "@livekit/components-react";
import { Track, RoomEvent, type RemoteParticipant } from "livekit-client";
import {
  MousePointer2,
  MousePointerClick,
  Pencil,
  Highlighter,
  ArrowUpRight,
  Eraser,
  Undo2,
  Trash2,
  ChevronRight,
  ChevronLeft,
  PenTool,
  Square,
  Circle,
  CircleDot,
  Minus,
  Type as TypeIcon,
  StickyNote,
  Users,
  Lock,
  BringToFront,
  SendToBack,
  ArrowUp,
  ArrowDown,
  Edit3,
  X as XIcon,
  History as HistoryIcon,
  RotateCcw,
  Image as ImageIcon,
  Hand,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- */
/* Types                                                          */
/* -------------------------------------------------------------- */

type Tool =
  | "off" | "select" | "laser"
  | "pen" | "highlighter" | "arrow"
  | "rect" | "ellipse" | "ring" | "line"
  | "text" | "sticky"
  | "eraser";

type SizeKey = "s" | "m" | "l";
type FontKey = "sans" | "serif" | "mono";

const FONT_STACK: Record<FontKey, string> = {
  sans: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

// Stroke widths per size for pen/arrow/shapes
const STROKE_W: Record<SizeKey, number> = { s: 2, m: 4, l: 7 };
// Highlighter is thicker
const HIGHLIGHT_W: Record<SizeKey, number> = { s: 14, m: 22, l: 34 };
// Text pixel size
const TEXT_PX: Record<SizeKey, number> = { s: 16, m: 22, l: 30 };
// Sticky pixel size (slightly smaller than plain text at the same setting)
const STICKY_PX: Record<SizeKey, number> = { s: 14, m: 18, l: 24 };

const PALETTE = [
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#facc15", // yellow
  "#22c55e", // green
  "#38bdf8", // sky
  "#a855f7", // violet
  "#f8fafc", // near-white
];

type StrokeMsg = {
  t: "stroke";
  id: string;
  owner: string;
  tool: "pen" | "highlighter" | "arrow";
  color: string;
  w: number;
  pts: [number, number][]; // normalized 0..1
  done?: boolean;
};
type ShapeMsg = {
  t: "shape";
  id: string;
  owner: string;
  kind: "rect" | "ellipse" | "ring" | "line";
  color: string;
  w: number;         // stroke width for outlines
  x1: number; y1: number; x2: number; y2: number; // normalized
  done?: boolean;
};
type TextMsg = {
  t: "text";
  id: string;
  owner: string;
  kind: "text" | "sticky";
  color: string;
  font: FontKey;
  size: SizeKey;
  x: number; y: number;      // top-left (normalized)
  maxW: number;              // wrap width (normalized)
  content: string;
};
type LaserMsg = { t: "laser"; owner: string; x: number; y: number; color: string };
type UndoMsg = { t: "undo"; owner: string };
type ClearMsg = { t: "clear"; owner?: string /* undefined = clear all */ };
type PermMsg = { t: "perm"; mode: "presenter" | "all"; by: string };
type DeleteMsg = { t: "delete"; id: string; by: string };
type OrderMsg = { t: "order"; order: string[]; by: string };
type SnapshotMsg = {
  t: "snapshot";
  by: string;
  items: AnyItem[];
  order: string[];
};
type PtrKind = "mouse" | "touch" | "pen";
type PtrMsg = {
  t: "ptr";
  owner: string;
  color: string;
  x: number;
  y: number;
  kind: PtrKind;
  down: boolean;
};
type PtrGoneMsg = { t: "ptrgone"; owner: string };
type Msg =
  | StrokeMsg | ShapeMsg | TextMsg | LaserMsg | UndoMsg | ClearMsg | PermMsg
  | DeleteMsg | OrderMsg | SnapshotMsg | PtrMsg | PtrGoneMsg;


type Stroke = Omit<StrokeMsg, "t" | "done">;
// Rename inner "kind" to avoid clashing with the AnyItem discriminator.
type Shape = Omit<ShapeMsg, "t" | "done" | "kind"> & { kindShape: ShapeMsg["kind"] };
type TextAnn = Omit<TextMsg, "t" | "kind"> & { kindText: TextMsg["kind"] };

type AnyItem =
  | ({ kind: "stroke" } & Stroke)
  | ({ kind: "shape" } & Shape)
  | ({ kind: "text" } & TextAnn);


const TOPIC = "presenter";
const enc = new TextEncoder();
const dec = new TextDecoder();

function ownerColor(identity: string) {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 92% 58%)`;
}

const isDraggingShape = (t: Tool) => t === "rect" || t === "ellipse" || t === "ring" || t === "line";
const isFreeStroke = (t: Tool) => t === "pen" || t === "highlighter" || t === "arrow";
const isPlacement = (t: Tool) => t === "text" || t === "sticky";

/* -------------------------------------------------------------- */
/* Session persistence                                            */
/* -------------------------------------------------------------- */

const STORAGE_PREFIX = "lk-presenter:v1:";
const HISTORY_PREFIX = "lk-presenter-hist:v1:";
const MAX_HISTORY = 30;
const storageKey = (sharer: string) => STORAGE_PREFIX + sharer;
const historyKey = (sharer: string) => HISTORY_PREFIX + sharer;

type SessionSnap = { items: AnyItem[]; order: string[]; savedAt: number };
type HistoryEntry = {
  id: string;
  at: number;
  action: string;      // short action label
  actor?: string;      // who caused it
  snap: SessionSnap;   // full state after this action
};

function saveSession(sharer: string, items: AnyItem[], order: string[]) {
  try {
    localStorage.setItem(
      storageKey(sharer),
      JSON.stringify({ items, order, savedAt: Date.now() }),
    );
  } catch { /* quota / private mode */ }
}
function loadSession(sharer: string): SessionSnap | null {
  try {
    const raw = localStorage.getItem(storageKey(sharer));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SessionSnap>;
    if (!Array.isArray(p.items) || !Array.isArray(p.order)) return null;
    return { items: p.items, order: p.order, savedAt: p.savedAt ?? Date.now() };
  } catch { return null; }
}
function loadHistory(sharer: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(sharer));
    if (!raw) return [];
    const arr = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveHistory(sharer: string, entries: HistoryEntry[]) {
  try {
    localStorage.setItem(historyKey(sharer), JSON.stringify(entries.slice(-MAX_HISTORY)));
  } catch { /* ignore */ }
}
function itemToMsg(it: AnyItem): Msg | null {
  if (it.kind === "stroke") {
    return { t: "stroke", id: it.id, owner: it.owner, tool: it.tool, color: it.color, w: it.w, pts: it.pts, done: true };
  }
  if (it.kind === "shape") {
    return { t: "shape", id: it.id, owner: it.owner, kind: it.kindShape, color: it.color, w: it.w, x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, done: true };
  }
  if (it.kind === "text") {
    return { t: "text", id: it.id, owner: it.owner, kind: it.kindText, color: it.color, font: it.font, size: it.size, x: it.x, y: it.y, maxW: it.maxW, content: it.content };
  }
  return null;
}

/* -------------------------------------------------------------- */


export function PresenterTools({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const shares = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const isAnyoneSharing = shares.length > 0;
  const primarySharer = shares[0]?.participant?.identity;
  const isLocalSharing = shares.some((s) => s.participant?.identity === room.localParticipant.identity);

  // Drawing permission: "all" (default) or "presenter" (only sharers can draw).
  const [permMode, setPermMode] = useState<"all" | "presenter">("all");
  const canDraw = permMode === "all" || isLocalSharing;


  const [tool, setTool] = useState<Tool>("off");
  const [collapsed, setCollapsed] = useState(false);

  const localIdentity = room.localParticipant.identity;
  const myColor = useMemo(() => ownerColor(localIdentity), [localIdentity]);
  const [color, setColor] = useState<string>(myColor);
  const [size, setSize] = useState<SizeKey>("m");
  const [font, setFont] = useState<FontKey>("sans");

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Shared state: annotations by id + insertion order for undo/clear
  const itemsRef = useRef<Map<string, AnyItem>>(new Map());
  const orderRef = useRef<string[]>([]);
  const lasersRef = useRef<Map<string, { x: number; y: number; color: string; t: number }>>(new Map());
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activeShapeRef = useRef<Shape | null>(null);
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);

  // Selection state (for the "select" tool)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const bumpUI = useCallback(() => setRevision((r) => (r + 1) | 0), []);
  const selDragRef = useRef<
    | null
    | {
        mode: "move" | "resize";
        handle?: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
        startClient: { x: number; y: number };
        origBounds: { x1: number; y1: number; x2: number; y2: number };
        origItem: AnyItem;
        overlayW: number;
        overlayH: number;
      }
  >(null);

  // Remote presenter cursors (mouse pointer / finger) from anyone sharing
  const cursorsRef = useRef<
    Map<string, { x: number; y: number; color: string; kind: PtrKind; down: boolean; t: number }>
  >(new Map());

  // Pending restore prompt when opening a share that has saved drawings
  const [pendingRestore, setPendingRestore] = useState<
    | null
    | { sharer: string; snap: SessionSnap }
  >(null);

  // Session history (only sharer maintains it)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const lastRecordAtRef = useRef(0);

  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const box = overlayRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setOverlaySize({ w: box.clientWidth, h: box.clientHeight });
    });
    ro.observe(box);
    setOverlaySize({ w: box.clientWidth, h: box.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* --------------- broadcast helpers --------------- */
  const publish = useCallback(
    async (msg: Msg, reliable: boolean) => {
      try {
        await room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), {
          reliable, topic: TOPIC,
        });
      } catch { /* ignore */ }
    },
    [room],
  );

  const applyMessage = useCallback((m: Msg) => {
    if (m.t === "stroke") {
      itemsRef.current.set(m.id, {
        kind: "stroke", id: m.id, owner: m.owner, tool: m.tool,
        color: m.color, w: m.w, pts: m.pts,
      });
      if (!orderRef.current.includes(m.id)) orderRef.current.push(m.id);
    } else if (m.t === "shape") {
      itemsRef.current.set(m.id, {
        kind: "shape",
        id: m.id, owner: m.owner, color: m.color, w: m.w,
        x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2,
        kindShape: m.kind,
      });
      if (!orderRef.current.includes(m.id)) orderRef.current.push(m.id);
    } else if (m.t === "text") {
      itemsRef.current.set(m.id, {
        kind: "text", id: m.id, owner: m.owner, kindText: m.kind,
        color: m.color, font: m.font, size: m.size,
        x: m.x, y: m.y, maxW: m.maxW, content: m.content,
      });
      if (!orderRef.current.includes(m.id)) orderRef.current.push(m.id);

    } else if (m.t === "laser") {
      lasersRef.current.set(m.owner, { x: m.x, y: m.y, color: m.color, t: performance.now() });
    } else if (m.t === "undo") {
      for (let i = orderRef.current.length - 1; i >= 0; i--) {
        const id = orderRef.current[i];
        const it = itemsRef.current.get(id);
        if (it && it.owner === m.owner) {
          itemsRef.current.delete(id);
          orderRef.current.splice(i, 1);
          break;
        }
      }
    } else if (m.t === "clear") {
      if (m.owner) {
        for (let i = orderRef.current.length - 1; i >= 0; i--) {
          const id = orderRef.current[i];
          const it = itemsRef.current.get(id);
          if (it && it.owner === m.owner) {
            itemsRef.current.delete(id);
            orderRef.current.splice(i, 1);
          }
        }
      } else {
        itemsRef.current.clear();
        orderRef.current = [];
      }
    } else if (m.t === "perm") {
      setPermMode(m.mode);
    } else if (m.t === "delete") {
      itemsRef.current.delete(m.id);
      const i = orderRef.current.indexOf(m.id);
      if (i >= 0) orderRef.current.splice(i, 1);
    } else if (m.t === "order") {
      const existing = new Set(itemsRef.current.keys());
      const next = m.order.filter((id) => existing.has(id));
      for (const id of orderRef.current) if (!next.includes(id) && existing.has(id)) next.push(id);
      orderRef.current = next;
    } else if (m.t === "snapshot") {
      // Full-state overwrite (used by revert-to-version)
      itemsRef.current.clear();
      orderRef.current = [];
      const byId = new Map(m.items.map((it) => [it.id, it]));
      for (const id of m.order) {
        const it = byId.get(id);
        if (it) {
          itemsRef.current.set(id, it);
          orderRef.current.push(id);
        }
      }
    } else if (m.t === "ptr") {
      cursorsRef.current.set(m.owner, {
        x: m.x, y: m.y, color: m.color, kind: m.kind,
        down: m.down, t: performance.now(),
      });
    } else if (m.t === "ptrgone") {
      cursorsRef.current.delete(m.owner);
    }
  }, []);

  /* --------------- persistence (sharer-owned) --------------- */
  const saveTimerRef = useRef<number | null>(null);
  const historyRecordRef = useRef<((action: string, actor?: string) => void) | null>(null);
  const scheduleSave = useCallback(
    (action?: string, actor?: string) => {
      if (!primarySharer || primarySharer !== localIdentity) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        const items = Array.from(itemsRef.current.values());
        saveSession(primarySharer, items, [...orderRef.current]);
        if (action) historyRecordRef.current?.(action, actor);
      }, 400);
    },
    [primarySharer, localIdentity],
  );


  /* --------------- receive --------------- */
  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      _p: RemoteParticipant | undefined,
      _k: unknown,
      topic: string | undefined,
    ) => {
      if (topic !== TOPIC) return;
      try {
        const m = JSON.parse(dec.decode(payload)) as Msg;
        applyMessage(m);
        dirtyRef.current = true;
        if (m.t === "stroke" || m.t === "shape" || m.t === "text" || m.t === "undo" || m.t === "clear" || m.t === "delete" || m.t === "order") {
          scheduleSave(m.t, "owner" in m ? m.owner : undefined);
          bumpUI();
        }
      } catch { /* noop */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, applyMessage, scheduleSave, bumpUI]);

  /* --------- history helpers (sharer maintains) --------- */
  const currentSnap = useCallback((): SessionSnap => ({
    items: Array.from(itemsRef.current.values()).map((it) => ({ ...it }) as AnyItem),
    order: [...orderRef.current],
    savedAt: Date.now(),
  }), []);

  const recordHistory = useCallback(
    (action: string, actor?: string) => {
      if (!primarySharer || primarySharer !== localIdentity) return;
      const now = Date.now();
      // Coalesce very rapid edits into one entry (< 350ms apart, same action)
      if (now - lastRecordAtRef.current < 350 && history.length) {
        const last = history[history.length - 1];
        if (last.action === action) {
          const updated = [...history];
          updated[updated.length - 1] = { ...last, at: now, snap: currentSnap() };
          setHistory(updated);
          saveHistory(primarySharer, updated);
          lastRecordAtRef.current = now;
          return;
        }
      }
      const entry: HistoryEntry = {
        id: `${now.toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
        at: now, action, actor,
        snap: currentSnap(),
      };
      const next = [...history, entry].slice(-MAX_HISTORY);
      setHistory(next);
      saveHistory(primarySharer, next);
      lastRecordAtRef.current = now;
    },
    [primarySharer, localIdentity, history, currentSnap],
  );
  useEffect(() => { historyRecordRef.current = recordHistory; }, [recordHistory]);


  const applyRestore = useCallback(
    (snap: SessionSnap) => {
      itemsRef.current.clear();
      orderRef.current = [];
      const byId = new Map(snap.items.map((it) => [it.id, it]));
      for (const id of snap.order) {
        const it = byId.get(id);
        if (it) {
          itemsRef.current.set(id, it);
          orderRef.current.push(id);
        }
      }
      dirtyRef.current = true;
      bumpUI();
      // Broadcast a full snapshot to peers so they overwrite too.
      if (isLocalSharing) {
        void publish(
          { t: "snapshot", by: localIdentity, items: snap.items, order: snap.order },
          true,
        );
      }
      scheduleSave("edit", localIdentity);
    },
    [bumpUI, isLocalSharing, localIdentity, publish, scheduleSave],
  );

  /* --------- restore saved session on new share start --------- */
  const shareCount = shares.length;
  const prevShareCount = useRef(shareCount);
  useEffect(() => {
    if (prevShareCount.current === 0 && shareCount > 0) {
      itemsRef.current.clear();
      orderRef.current = [];
      lasersRef.current.clear();
      const sharer = primarySharer;
      if (sharer) {
        // Load history unconditionally (viewer sees empty; sharer sees theirs)
        if (sharer === localIdentity) {
          setHistory(loadHistory(sharer));
        } else {
          setHistory([]);
        }
        const saved = loadSession(sharer);
        if (saved && saved.items.length) {
          // Sharer decides: prompt them. Viewers can also see the prompt but
          // only the sharer's confirmation actually rebroadcasts to peers.
          setPendingRestore({ sharer, snap: saved });
        } else {
          setPendingRestore(null);
        }
      }
      dirtyRef.current = true;
    }
    prevShareCount.current = shareCount;
    if (shareCount === 0) {
      if (tool !== "off") setTool("off");
      setPendingRestore(null);
      setHistoryOpen(false);
      setPreviewOpen(false);
      cursorsRef.current.clear();
    }
  }, [shareCount, tool, primarySharer, localIdentity]);

  const confirmRestore = useCallback(() => {
    if (!pendingRestore) return;
    applyRestore(pendingRestore.snap);
    setPendingRestore(null);
    if (primarySharer === localIdentity) {
      recordHistory("restore-saved", localIdentity);
    }
  }, [pendingRestore, applyRestore, primarySharer, localIdentity, recordHistory]);

  const dismissRestore = useCallback(
    (deleteSaved: boolean) => {
      if (!pendingRestore) return;
      if (deleteSaved && primarySharer === localIdentity) {
        try {
          localStorage.removeItem(storageKey(pendingRestore.sharer));
          localStorage.removeItem(historyKey(pendingRestore.sharer));
        } catch { /* ignore */ }
        setHistory([]);
      }
      setPendingRestore(null);
    },
    [pendingRestore, primarySharer, localIdentity],
  );

  /* -------- late-joiner sync: rebroadcast state + perm -------- */
  useEffect(() => {
    const onJoin = () => {
      if (!isLocalSharing) return;
      void publish({ t: "perm", mode: permMode, by: localIdentity }, true);
      for (const id of orderRef.current) {
        const it = itemsRef.current.get(id);
        const msg = it ? itemToMsg(it) : null;
        if (msg) void publish(msg, true);
      }
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin); };
  }, [room, isLocalSharing, permMode, localIdentity, publish]);

  /* --------- broadcast perm on start of local share --------- */
  const prevLocalShare = useRef(isLocalSharing);
  useEffect(() => {
    if (!prevLocalShare.current && isLocalSharing) {
      void publish({ t: "perm", mode: permMode, by: localIdentity }, true);
    }
    prevLocalShare.current = isLocalSharing;
  }, [isLocalSharing, permMode, localIdentity, publish]);

  /* --------- force tool off when losing draw permission --------- */
  useEffect(() => {
    if (!canDraw && tool !== "off") setTool("off");
  }, [canDraw, tool]);

  /* --------- broadcast pointer / touch while sharing --------- */
  useEffect(() => {
    if (!isLocalSharing) return;
    let lastSend = 0;
    let lastX = -1, lastY = -1;
    const isCoarse = typeof matchMedia !== "undefined"
      && matchMedia("(pointer: coarse)").matches;
    const defaultKind: PtrKind = isCoarse ? "touch" : "mouse";

    const send = (clientX: number, clientY: number, kind: PtrKind, down: boolean) => {
      const vw = document.documentElement.clientWidth || 1;
      const vh = document.documentElement.clientHeight || 1;
      const nx = Math.max(0, Math.min(1, clientX / vw));
      const ny = Math.max(0, Math.min(1, clientY / vh));
      const now = performance.now();
      if (now - lastSend < 45 && Math.abs(nx - lastX) < 0.002 && Math.abs(ny - lastY) < 0.002) return;
      lastSend = now; lastX = nx; lastY = ny;
      void publish(
        { t: "ptr", owner: localIdentity, color: myColor, x: nx, y: ny, kind, down },
        false,
      );
    };
    const onMove = (e: PointerEvent) => {
      const k: PtrKind = e.pointerType === "touch" ? "touch"
        : e.pointerType === "pen" ? "pen" : "mouse";
      send(e.clientX, e.clientY, k, e.buttons > 0);
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      send(t.clientX, t.clientY, "touch", true);
    };
    const onLeave = () => {
      void publish({ t: "ptrgone", owner: localIdentity }, false);
    };
    // Fallback for browsers with only mousemove
    const onMouse = (e: MouseEvent) => send(e.clientX, e.clientY, defaultKind, e.buttons > 0);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("pointerup", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      window.removeEventListener("pointerup", onMove);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
      void publish({ t: "ptrgone", owner: localIdentity }, true);
    };
  }, [isLocalSharing, localIdentity, myColor, publish]);



  /* --------------- rAF render loop --------------- */
  useEffect(() => {
    if (!isAnyoneSharing) return;
    const draw = () => {
      const cvs = canvasRef.current;
      const box = overlayRef.current;
      if (cvs && box) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = box.clientWidth, h = box.clientHeight;
        if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
          cvs.width = w * dpr; cvs.height = h * dpr;
          cvs.style.width = w + "px"; cvs.style.height = h + "px";
          dirtyRef.current = true;
        }
        const now = performance.now();
        let laserAlive = false;
        for (const [id, l] of lasersRef.current) {
          if (now - l.t > 1200) lasersRef.current.delete(id);
          else laserAlive = true;
        }
        let cursorAlive = false;
        for (const [id, c] of cursorsRef.current) {
          if (now - c.t > 4000) cursorsRef.current.delete(id);
          else cursorAlive = true;
        }
        if (dirtyRef.current || laserAlive || cursorAlive || activeStrokeRef.current || activeShapeRef.current) {
          const ctx = cvs.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);

          for (const id of orderRef.current) {
            const it = itemsRef.current.get(id);
            if (!it) continue;
            if (it.kind === "stroke") drawStroke(ctx, it as unknown as Stroke, w, h);
            else if (it.kind === "shape") drawShape(ctx, it as any, w, h);
            else if (it.kind === "text") drawText(ctx, it as any, w, h);
          }
          if (activeStrokeRef.current) drawStroke(ctx, activeStrokeRef.current, w, h);
          if (activeShapeRef.current) drawShape(ctx, {
            ...activeShapeRef.current,
            kindShape: (activeShapeRef.current as any).kindShape,
          } as any, w, h);

          for (const [, l] of lasersRef.current) {
            const age = (now - l.t) / 1200;
            const alpha = Math.max(0, 1 - age);
            const r = 10 + age * 22;
            ctx.beginPath();
            ctx.arc(l.x * w, l.y * h, r, 0, Math.PI * 2);
            ctx.fillStyle = withAlpha(l.color, 0.18 * alpha);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(l.x * w, l.y * h, 6, 0, Math.PI * 2);
            ctx.fillStyle = withAlpha(l.color, 0.9 * Math.max(0.4, alpha));
            ctx.fill();
          }

          // Remote presenter cursors (mouse pointer or finger)
          for (const [owner, c] of cursorsRef.current) {
            if (owner === localIdentity) continue;
            if (now - c.t > 4000) { cursorsRef.current.delete(owner); continue; }
            const x = c.x * w, y = c.y * h;
            if (c.kind === "touch") {
              // Finger touch ring
              const rOuter = c.down ? 26 : 20;
              ctx.beginPath();
              ctx.arc(x, y, rOuter, 0, Math.PI * 2);
              ctx.fillStyle = withAlpha(c.color, c.down ? 0.28 : 0.18);
              ctx.fill();
              ctx.beginPath();
              ctx.arc(x, y, 8, 0, Math.PI * 2);
              ctx.fillStyle = withAlpha(c.color, 0.95);
              ctx.fill();
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2;
              ctx.stroke();
            } else {
              // Mouse arrow — small SVG-shaped polygon
              ctx.save();
              ctx.translate(x, y);
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(0, 18);
              ctx.lineTo(4.5, 13.5);
              ctx.lineTo(8, 20);
              ctx.lineTo(11, 18.7);
              ctx.lineTo(7.7, 12.4);
              ctx.lineTo(13, 12);
              ctx.closePath();
              ctx.fillStyle = c.color;
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 1.5;
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          }

          dirtyRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isAnyoneSharing]);

  /* --------------- pointer interaction --------------- */
  const laserThrottleRef = useRef(0);
  const strokeSendRef = useRef(0);

  const toNorm = (e: PointerEvent | React.PointerEvent) => {
    const box = overlayRef.current!;
    const r = box.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as [number, number];
  };

  const promptContent = (kind: "text" | "sticky") => {
    const label = rtl
      ? (kind === "sticky" ? "اكتب ملاحظتك اللاصقة" : "اكتب النص")
      : (kind === "sticky" ? "Sticky note" : "Text");
    // Native prompt: works on mobile & desktop, no extra UI required.
    // eslint-disable-next-line no-alert
    const v = window.prompt(label, "");
    return v?.trim() || null;
  };

  const placeText = (kind: "text" | "sticky", p: [number, number]) => {
    const content = promptContent(kind);
    if (!content) return;
    const id = `${localIdentity}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
    const msg: TextMsg = {
      t: "text", id, owner: localIdentity, kind, color, font, size,
      x: p[0], y: p[1], maxW: 0.32, content,
    };
    applyMessage(msg);
    void publish(msg, true);
    scheduleSave("edit", localIdentity);
    dirtyRef.current = true;
  };

  /* --------------- selection: helpers --------------- */

  const commitItem = useCallback(
    (it: AnyItem, alsoBroadcast = true) => {
      itemsRef.current.set(it.id, it);
      if (alsoBroadcast) {
        const msg = itemToMsg(it);
        if (msg) void publish(msg, true);
      }
      scheduleSave("edit", localIdentity);
      dirtyRef.current = true;
      bumpUI();
    },
    [publish, scheduleSave, bumpUI],
  );

  const deleteItem = useCallback(
    (id: string) => {
      itemsRef.current.delete(id);
      const i = orderRef.current.indexOf(id);
      if (i >= 0) orderRef.current.splice(i, 1);
      void publish({ t: "delete", id, by: localIdentity }, true);
      scheduleSave("edit", localIdentity);
      dirtyRef.current = true;
      setSelectedId((cur) => (cur === id ? null : cur));
      bumpUI();
    },
    [publish, scheduleSave, localIdentity, bumpUI],
  );

  const setOrder = useCallback(
    (nextOrder: string[]) => {
      orderRef.current = nextOrder;
      void publish({ t: "order", order: [...nextOrder], by: localIdentity }, true);
      scheduleSave("edit", localIdentity);
      dirtyRef.current = true;
      bumpUI();
    },
    [publish, scheduleSave, localIdentity, bumpUI],
  );

  const bringToFront = useCallback(
    (id: string) => {
      const o = orderRef.current.filter((x) => x !== id);
      o.push(id);
      setOrder(o);
    },
    [setOrder],
  );
  const sendToBack = useCallback(
    (id: string) => {
      const o = orderRef.current.filter((x) => x !== id);
      o.unshift(id);
      setOrder(o);
    },
    [setOrder],
  );
  const forwardOne = useCallback(
    (id: string) => {
      const o = [...orderRef.current];
      const i = o.indexOf(id);
      if (i >= 0 && i < o.length - 1) {
        [o[i], o[i + 1]] = [o[i + 1], o[i]];
        setOrder(o);
      }
    },
    [setOrder],
  );
  const backwardOne = useCallback(
    (id: string) => {
      const o = [...orderRef.current];
      const i = o.indexOf(id);
      if (i > 0) {
        [o[i], o[i - 1]] = [o[i - 1], o[i]];
        setOrder(o);
      }
    },
    [setOrder],
  );

  const editSelectedText = useCallback(() => {
    const id = selectedId;
    if (!id) return;
    const it = itemsRef.current.get(id);
    if (!it || it.kind !== "text") return;
    // eslint-disable-next-line no-alert
    const v = window.prompt(rtl ? "تعديل النص" : "Edit text", it.content);
    if (v == null) return;
    const trimmed = v.trim();
    if (!trimmed) return;
    commitItem({ ...it, content: trimmed });
  }, [selectedId, rtl, commitItem]);

  const hitTest = (nx: number, ny: number, w: number, h: number): string | null => {
    // Iterate top-most first (last in order)
    for (let i = orderRef.current.length - 1; i >= 0; i--) {
      const id = orderRef.current[i];
      const it = itemsRef.current.get(id);
      if (!it) continue;
      const b = itemPixelBounds(it, w, h);
      const pad = 8;
      const px = nx * w, py = ny * h;
      if (px >= b.x1 - pad && px <= b.x2 + pad && py >= b.y1 - pad && py <= b.y2 + pad) {
        return id;
      }
    }
    return null;
  };

  /* --------------- selection: window drag handlers --------------- */
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const d = selDragRef.current;
      if (!d) return;
      ev.preventDefault();
      const dxPx = ev.clientX - d.startClient.x;
      const dyPx = ev.clientY - d.startClient.y;
      const dx = dxPx / d.overlayW;
      const dy = dyPx / d.overlayH;

      if (d.mode === "move") {
        const it = translateItem(d.origItem, dx, dy);
        itemsRef.current.set(it.id, it);
        dirtyRef.current = true;
        bumpUI();
        return;
      }
      // resize
      const oldBpx = itemPixelBounds(d.origItem, d.overlayW, d.overlayH);
      const anchorStart = handleAnchorPx(d.handle!, oldBpx);
      const newHandlePt = { x: anchorStart.x + dxPx, y: anchorStart.y + dyPx };
      const keepAspect = !ev.shiftKey && d.origItem.kind !== "text";
      const newBpx = computeNewBoundsPx(oldBpx, d.handle!, newHandlePt, keepAspect);
      const newB = {
        x1: newBpx.x1 / d.overlayW, y1: newBpx.y1 / d.overlayH,
        x2: newBpx.x2 / d.overlayW, y2: newBpx.y2 / d.overlayH,
      };
      const oldBnorm = {
        x1: oldBpx.x1 / d.overlayW, y1: oldBpx.y1 / d.overlayH,
        x2: oldBpx.x2 / d.overlayW, y2: oldBpx.y2 / d.overlayH,
      };
      const it = transformItem(d.origItem, oldBnorm, newB);
      itemsRef.current.set(it.id, it);
      dirtyRef.current = true;
      bumpUI();
    };
    const onUp = () => {
      const d = selDragRef.current;
      if (!d) return;
      selDragRef.current = null;
      const cur = itemsRef.current.get(d.origItem.id);
      if (cur) {
        const msg = itemToMsg(cur);
        if (msg) void publish(msg, true);
        scheduleSave("edit", localIdentity);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [publish, scheduleSave, bumpUI]);

  const beginResize = (
    handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
    e: React.PointerEvent,
  ) => {
    if (!selectedId) return;
    const it = itemsRef.current.get(selectedId);
    if (!it) return;
    const box = overlayRef.current;
    if (!box) return;
    const w = box.clientWidth, h = box.clientHeight;
    selDragRef.current = {
      mode: "resize",
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      origBounds: {
        x1: 0, y1: 0, x2: 0, y2: 0, // unused; recomputed each move
      },
      origItem: it,
      overlayW: w,
      overlayH: h,
    };
    e.stopPropagation();
    e.preventDefault();
  };



  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "off") return;
    if (tool === "select") {
      if (!canDraw) return;
      const box = overlayRef.current;
      if (!box) return;
      const w = box.clientWidth, h = box.clientHeight;
      const p = toNorm(e);
      const id = hitTest(p[0], p[1], w, h);
      if (!id) { setSelectedId(null); return; }
      const it = itemsRef.current.get(id);
      if (!it) return;
      setSelectedId(id);
      selDragRef.current = {
        mode: "move",
        startClient: { x: e.clientX, y: e.clientY },
        origBounds: { x1: 0, y1: 0, x2: 0, y2: 0 },
        origItem: it,
        overlayW: w,
        overlayH: h,
      };
      e.preventDefault();
      return;
    }
    if (!canDraw) return;

    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);

    if (tool === "laser") {
      lasersRef.current.set(localIdentity, { x: p[0], y: p[1], color, t: performance.now() });
      void publish({ t: "laser", owner: localIdentity, x: p[0], y: p[1], color }, false);
      dirtyRef.current = true;
      return;
    }
    if (tool === "eraser") {
      void publish({ t: "clear", owner: localIdentity }, true);
      applyMessage({ t: "clear", owner: localIdentity });
      scheduleSave("edit", localIdentity);
      dirtyRef.current = true;
      return;
    }

    if (isPlacement(tool)) {
      placeText(tool as "text" | "sticky", p);
      return;
    }
    const id = `${localIdentity}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;

    if (isDraggingShape(tool)) {
      const shape: Shape & { kindShape: ShapeMsg["kind"] } = {
        id, owner: localIdentity, color, w: STROKE_W[size],
        x1: p[0], y1: p[1], x2: p[0], y2: p[1],
        kindShape: tool as ShapeMsg["kind"],
      } as any;
      activeShapeRef.current = shape as any;
      dirtyRef.current = true;
      return;
    }

    if (isFreeStroke(tool)) {
      const stroke: Stroke = {
        id, owner: localIdentity, tool: tool as Stroke["tool"], color,
        w: tool === "highlighter" ? HIGHLIGHT_W[size] : STROKE_W[size],
        pts: [p],
      };
      activeStrokeRef.current = stroke;
      dirtyRef.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === "off" || tool === "select") return;
    const p = toNorm(e);

    if (tool === "laser") {
      const now = performance.now();
      if (now - laserThrottleRef.current < 33) return;
      laserThrottleRef.current = now;
      lasersRef.current.set(localIdentity, { x: p[0], y: p[1], color, t: now });
      void publish({ t: "laser", owner: localIdentity, x: p[0], y: p[1], color }, false);
      dirtyRef.current = true;
      return;
    }

    const sh = activeShapeRef.current as (Shape & { kindShape: ShapeMsg["kind"] }) | null;
    if (sh) {
      sh.x2 = p[0]; sh.y2 = p[1];
      dirtyRef.current = true;
      const now = performance.now();
      if (now - strokeSendRef.current > 90) {
        strokeSendRef.current = now;
        void publish({
          t: "shape", id: sh.id, owner: sh.owner, kind: sh.kindShape,
          color: sh.color, w: sh.w, x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, done: false,
        }, true);
      }
      return;
    }

    const s = activeStrokeRef.current;
    if (!s) return;
    if (s.tool === "arrow") {
      s.pts = [s.pts[0], p];
    } else {
      const last = s.pts[s.pts.length - 1];
      const dx = p[0] - last[0], dy = p[1] - last[1];
      if (dx * dx + dy * dy < 1e-5) return;
      s.pts.push(p);
    }
    dirtyRef.current = true;
    const now = performance.now();
    if (now - strokeSendRef.current > 90) {
      strokeSendRef.current = now;
      void publish({
        t: "stroke", id: s.id, owner: s.owner, tool: s.tool, color: s.color, w: s.w,
        pts: s.pts, done: false,
      }, true);
    }
  };

  const onPointerUp = (_e: React.PointerEvent) => {
    if (tool === "off" || tool === "select") return;

    const sh = activeShapeRef.current as (Shape & { kindShape: ShapeMsg["kind"] }) | null;
    if (sh) {
      const finalItem: AnyItem = {
        kind: "shape",
        id: sh.id, owner: sh.owner, color: sh.color, w: sh.w,
        x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2,
        kindShape: sh.kindShape,

      };
      itemsRef.current.set(sh.id, finalItem);
      orderRef.current.push(sh.id);
      activeShapeRef.current = null;
      void publish({
        t: "shape", id: sh.id, owner: sh.owner, kind: sh.kindShape,
        color: sh.color, w: sh.w, x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2, done: true,
      }, true);
      scheduleSave("edit", localIdentity);
      dirtyRef.current = true;
      return;
    }

    const s = activeStrokeRef.current;
    if (s) {
      itemsRef.current.set(s.id, { kind: "stroke", ...s } as unknown as AnyItem);
      orderRef.current.push(s.id);
      activeStrokeRef.current = null;
      void publish({
        t: "stroke", id: s.id, owner: s.owner, tool: s.tool, color: s.color, w: s.w,
        pts: s.pts, done: true,
      }, true);
      scheduleSave("edit", localIdentity);
    }
    dirtyRef.current = true;
  };

  /* --------------- toolbar actions --------------- */

  const undo = useCallback(() => {
    void publish({ t: "undo", owner: localIdentity }, true);
    applyMessage({ t: "undo", owner: localIdentity });
    scheduleSave("edit", localIdentity);
    dirtyRef.current = true;
  }, [publish, applyMessage, localIdentity, scheduleSave]);

  const clearAll = useCallback(() => {
    void publish({ t: "clear" }, true);
    applyMessage({ t: "clear" });
    // Also drop the persisted snapshot for this share
    if (primarySharer && primarySharer === localIdentity) {
      try { localStorage.removeItem(storageKey(primarySharer)); } catch { /* ignore */ }
    }
    scheduleSave("edit", localIdentity);
    dirtyRef.current = true;
  }, [publish, applyMessage, primarySharer, localIdentity, scheduleSave]);

  const togglePerm = useCallback(() => {
    if (!isLocalSharing) return;
    const next: "all" | "presenter" = permMode === "all" ? "presenter" : "all";
    setPermMode(next);
    void publish({ t: "perm", mode: next, by: localIdentity }, true);
  }, [isLocalSharing, permMode, publish, localIdentity]);


  /* --------------- keyboard --------------- */
  useEffect(() => {
    if (!isAnyoneSharing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === "a") setCollapsed((v) => !v);
      else if (k === "v") { setTool("select"); }
      else if (k === "1") setTool("laser");
      else if (k === "2") setTool("pen");
      else if (k === "3") setTool("highlighter");
      else if (k === "4") setTool("arrow");
      else if (k === "5") setTool("rect");
      else if (k === "6") setTool("ellipse");
      else if (k === "7") setTool("ring");
      else if (k === "8") setTool("line");
      else if (k === "t") setTool("text");
      else if (k === "n") setTool("sticky");
      else if (k === "e") setTool("eraser");
      else if (k === "z") undo();
      else if (k === "x") clearAll();
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        deleteItem(selectedId);
      }
      else if (e.key === "Enter" && selectedId) {
        editSelectedText();
      }
      else if (e.key === "]" && selectedId) {
        if (e.shiftKey) bringToFront(selectedId); else forwardOne(selectedId);
      }
      else if (e.key === "[" && selectedId) {
        if (e.shiftKey) sendToBack(selectedId); else backwardOne(selectedId);
      }
      else if (e.key === "Escape") { setTool("off"); setSelectedId(null); }
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAnyoneSharing, undo, clearAll, selectedId, deleteItem, editSelectedText, bringToFront, forwardOne, sendToBack, backwardOne]);

  if (!isAnyoneSharing) return null;

  const interactive = tool !== "off";

  return (
    <>
      {/* Overlay canvas positioned over LiveKit stage (above tiles, below controls) */}
      <div
        ref={overlayRef}
        className={cn(
          "absolute left-0 right-0 top-0 z-30",
          "bottom-32",
          interactive
            ? (tool === "select"
                ? "cursor-default pointer-events-auto"
                : "cursor-crosshair pointer-events-auto")
            : "pointer-events-none",
        )}
        style={{ touchAction: interactive ? "none" : undefined, userSelect: interactive ? "none" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-hidden={!interactive}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {interactive ? (
          <div
            className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-amber-200 backdrop-blur-md border border-amber-400/30"
            role="status"
            aria-live="polite"
          >
            {rtl ? "وضع الشرح مفعّل — Esc للخروج" : "Presenter mode — press Esc to exit"}
          </div>
        ) : null}
        {!canDraw ? (
          <div
            className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white/85 backdrop-blur-md border border-white/15"
            role="status"
            aria-live="polite"
          >
            {rtl ? "الرسم متاح للمقدّم فقط" : "Drawing is restricted to the presenter"}
          </div>
        ) : null}

        <SelectionOverlay
          tool={tool}
          selectedId={selectedId}
          itemsRef={itemsRef}
          overlayW={overlaySize.w}
          overlayH={overlaySize.h}
          beginResize={beginResize}
        />
      </div>

      {/* Floating toolbar (wraps on small screens, stays inside stage) */}
      <div
        className={cn(
          "absolute z-40 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-2xl border border-amber-400/30 bg-black/70 p-1.5 backdrop-blur-xl shadow-2xl shadow-amber-500/10",
          rtl ? "left-2 sm:left-4" : "right-2 sm:right-4",
          "bottom-36 sm:bottom-40",
        )}
        role="toolbar"
        aria-label={rtl ? "أدوات المُقدِّم" : "Presenter tools"}
      >
        <ToolButton
          label={rtl ? "طي الأدوات (A)" : "Collapse (A)"}
          onClick={() => setCollapsed((v) => !v)}
          active={false}
        >
          {collapsed ? (rtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />)
                     : <PenTool className="size-4" />}
        </ToolButton>

        {!collapsed ? (
          <>
            <Sep />
            <ToolButton
              label={rtl ? "تحديد وتحرير (V)" : "Select & edit (V)"}
              active={tool === "select"}
              onClick={() => setTool(tool === "select" ? "off" : "select")}
            >
              <MousePointerClick className="size-4" />
            </ToolButton>
            <Sep />
            <ToolButton label={rtl ? "مؤشر ليزر (1)" : "Laser (1)"} active={tool === "laser"}
              onClick={() => setTool(tool === "laser" ? "off" : "laser")}>
              <MousePointer2 className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "قلم (2)" : "Pen (2)"} active={tool === "pen"}
              onClick={() => setTool(tool === "pen" ? "off" : "pen")}>
              <Pencil className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "تمييز (3)" : "Highlight (3)"} active={tool === "highlighter"}
              onClick={() => setTool(tool === "highlighter" ? "off" : "highlighter")}>
              <Highlighter className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "سهم (4)" : "Arrow (4)"} active={tool === "arrow"}
              onClick={() => setTool(tool === "arrow" ? "off" : "arrow")}>
              <ArrowUpRight className="size-4" />
            </ToolButton>

            <Sep />
            <ToolButton label={rtl ? "مربع (5)" : "Rectangle (5)"} active={tool === "rect"}
              onClick={() => setTool(tool === "rect" ? "off" : "rect")}>
              <Square className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "دائرة (6)" : "Ellipse (6)"} active={tool === "ellipse"}
              onClick={() => setTool(tool === "ellipse" ? "off" : "ellipse")}>
              <Circle className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "حلقة (7)" : "Ring (7)"} active={tool === "ring"}
              onClick={() => setTool(tool === "ring" ? "off" : "ring")}>
              <CircleDot className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "خط (8)" : "Line (8)"} active={tool === "line"}
              onClick={() => setTool(tool === "line" ? "off" : "line")}>
              <Minus className="size-4" />
            </ToolButton>

            <Sep />
            <ToolButton label={rtl ? "نص (T)" : "Text (T)"} active={tool === "text"}
              onClick={() => setTool(tool === "text" ? "off" : "text")}>
              <TypeIcon className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "ملاحظة لاصقة (N)" : "Sticky note (N)"} active={tool === "sticky"}
              onClick={() => setTool(tool === "sticky" ? "off" : "sticky")}>
              <StickyNote className="size-4" />
            </ToolButton>

            <Sep />
            <ToolButton label={rtl ? "مسح رسوماتي (E)" : "Erase mine (E)"} active={tool === "eraser"}
              onClick={() => setTool(tool === "eraser" ? "off" : "eraser")}>
              <Eraser className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "تراجع (Z)" : "Undo (Z)"} onClick={undo} active={false}>
              <Undo2 className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "مسح الكل (X)" : "Clear all (X)"} onClick={clearAll} active={false} danger>
              <Trash2 className="size-4" />
            </ToolButton>

            {isLocalSharing ? (
              <>
                <Sep />
                <ToolButton
                  label={
                    rtl
                      ? permMode === "presenter"
                        ? "الرسم للمقدّم فقط — اضغط للسماح للجميع"
                        : "الجميع يستطيع الرسم — اضغط لتقييده على المقدّم"
                      : permMode === "presenter"
                        ? "Presenter-only drawing — click to allow everyone"
                        : "Anyone can draw — click to restrict to presenter"
                  }
                  active={permMode === "presenter"}
                  onClick={togglePerm}
                >
                  {permMode === "presenter" ? <Lock className="size-4" /> : <Users className="size-4" />}
                </ToolButton>
                <ToolButton
                  label={rtl ? "سجل التعديلات (Y)" : "History timeline (Y)"}
                  active={historyOpen}
                  onClick={() => { setHistoryOpen((v) => !v); setPreviewOpen(false); }}
                >
                  <HistoryIcon className="size-4" />
                </ToolButton>
                <ToolButton
                  label={rtl ? "معاينة اللوحة المحفوظة" : "Preview saved board"}
                  active={previewOpen}
                  onClick={() => { setPreviewOpen((v) => !v); setHistoryOpen(false); }}
                >
                  <ImageIcon className="size-4" />
                </ToolButton>
              </>
            ) : null}



            <Sep />
            {/* Color palette */}
            <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label={rtl ? "اللون" : "Color"}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-6 rounded-full border transition",
                    color === c ? "border-white ring-2 ring-amber-300/70 scale-110" : "border-white/25 hover:border-white/60"
                  )}
                  style={{ background: c }}
                />
              ))}
              <button
                key="mine"
                type="button"
                role="radio"
                aria-checked={color === myColor}
                aria-label={rtl ? "لوني" : "My color"}
                title={rtl ? "لوني" : "My color"}
                onClick={() => setColor(myColor)}
                className={cn(
                  "size-6 rounded-full border transition",
                  color === myColor ? "border-white ring-2 ring-amber-300/70 scale-110" : "border-white/25 hover:border-white/60"
                )}
                style={{ background: myColor }}
              />
            </div>

            <Sep />
            {/* Size */}
            <div className="flex items-center overflow-hidden rounded-lg border border-white/10" role="radiogroup" aria-label={rtl ? "الحجم" : "Size"}>
              {(["s","m","l"] as SizeKey[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  role="radio"
                  aria-checked={size === sz}
                  onClick={() => setSize(sz)}
                  className={cn(
                    "px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80",
                    size === sz ? "bg-amber-400/20 text-amber-100" : "hover:bg-white/10"
                  )}
                >
                  {sz}
                </button>
              ))}
            </div>

            {/* Font (only meaningful for text/sticky) */}
            <div className="flex items-center overflow-hidden rounded-lg border border-white/10" role="radiogroup" aria-label={rtl ? "الخط" : "Font"}>
              {(["sans","serif","mono"] as FontKey[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={font === f}
                  onClick={() => setFont(f)}
                  className={cn(
                    "px-2 py-1 text-[11px] text-white/80",
                    size ? "" : "",
                    font === f ? "bg-amber-400/20 text-amber-100" : "hover:bg-white/10"
                  )}
                  style={{ fontFamily: FONT_STACK[f] }}
                  title={f}
                >
                  Aa
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Selection actions bar — appears when an item is selected */}
      {selectedId && tool === "select" ? (
        <div
          className={cn(
            "absolute z-40 flex items-center gap-1 rounded-2xl border border-amber-400/40 bg-black/80 p-1.5 backdrop-blur-xl shadow-2xl shadow-amber-500/10",
            rtl ? "left-2 sm:left-4" : "right-2 sm:right-4",
            "bottom-24 sm:bottom-28",
          )}
          role="toolbar"
          aria-label={rtl ? "إجراءات العنصر المحدَّد" : "Selection actions"}
        >
          {(() => {
            const it = itemsRef.current.get(selectedId);
            const isText = it?.kind === "text";
            return (
              <>
                {isText ? (
                  <ToolButton
                    label={rtl ? "تعديل النص (Enter)" : "Edit text (Enter)"}
                    onClick={editSelectedText}
                    active={false}
                  >
                    <Edit3 className="size-4" />
                  </ToolButton>
                ) : null}
                <ToolButton
                  label={rtl ? "إلى الأمام (])" : "Forward (])"}
                  onClick={() => forwardOne(selectedId)}
                  active={false}
                >
                  <ArrowUp className="size-4" />
                </ToolButton>
                <ToolButton
                  label={rtl ? "إلى الخلف ([)" : "Backward ([)"}
                  onClick={() => backwardOne(selectedId)}
                  active={false}
                >
                  <ArrowDown className="size-4" />
                </ToolButton>
                <ToolButton
                  label={rtl ? "إلى المقدمة (Shift+])" : "Bring to front (Shift+])"}
                  onClick={() => bringToFront(selectedId)}
                  active={false}
                >
                  <BringToFront className="size-4" />
                </ToolButton>
                <ToolButton
                  label={rtl ? "إلى الخلفية (Shift+[)" : "Send to back (Shift+[)"}
                  onClick={() => sendToBack(selectedId)}
                  active={false}
                >
                  <SendToBack className="size-4" />
                </ToolButton>
                <Sep />
                <ToolButton
                  label={rtl ? "حذف (Delete)" : "Delete"}
                  onClick={() => deleteItem(selectedId)}
                  active={false}
                  danger
                >
                  <Trash2 className="size-4" />
                </ToolButton>
                <ToolButton
                  label={rtl ? "إلغاء التحديد (Esc)" : "Deselect (Esc)"}
                  onClick={() => setSelectedId(null)}
                  active={false}
                >
                  <XIcon className="size-4" />
                </ToolButton>
              </>
            );
          })()}
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- */

function SelectionOverlay({
  tool,
  selectedId,
  itemsRef,
  overlayW,
  overlayH,
  beginResize,
}: {
  tool: Tool;
  selectedId: string | null;
  itemsRef: React.MutableRefObject<Map<string, AnyItem>>;
  overlayW: number;
  overlayH: number;
  beginResize: (h: HandleKey, e: React.PointerEvent) => void;
}) {
  if (tool !== "select" || !selectedId || overlayW === 0 || overlayH === 0) return null;
  const it = itemsRef.current.get(selectedId);
  if (!it) return null;
  const b = itemPixelBounds(it, overlayW, overlayH);
  const left = b.x1;
  const top = b.y1;
  const w = Math.max(1, b.x2 - b.x1);
  const h = Math.max(1, b.y2 - b.y1);

  // Text items: only expose W/E and corner handles that resize width.
  const isText = it.kind === "text";
  const handles: HandleKey[] = isText
    ? ["w", "e"]
    : ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  const handleStyle = (hk: HandleKey): React.CSSProperties => {
    const cx = (b.x1 + b.x2) / 2 - b.x1;
    const cy = (b.y1 + b.y2) / 2 - b.y1;
    const map: Record<HandleKey, [number, number]> = {
      nw: [0, 0], n: [cx, 0], ne: [w, 0],
      e: [w, cy], se: [w, h],
      s: [cx, h], sw: [0, h], w: [0, cy],
    };
    const [hx, hy] = map[hk];
    return { left: hx - 8, top: hy - 8 };
  };
  const cursorFor: Record<HandleKey, string> = {
    nw: "nwse-resize", ne: "nesw-resize", se: "nwse-resize", sw: "nesw-resize",
    n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  };
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left, top, width: w, height: h }}
      aria-hidden
    >
      <div
        className="absolute inset-0 rounded-[6px]"
        style={{
          border: "1.5px dashed rgba(251, 191, 36, 0.95)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5) inset, 0 0 12px rgba(251,191,36,0.35)",
        }}
      />
      {handles.map((hk) => (
        <div
          key={hk}
          role="button"
          aria-label={`resize-${hk}`}
          className="pointer-events-auto absolute size-4 rounded-[3px] border border-amber-300/90 bg-black shadow-md touch-none"
          style={{ ...handleStyle(hk), cursor: cursorFor[hk] }}
          onPointerDown={(e) => beginResize(hk, e)}
        />
      ))}
    </div>
  );
}

function Sep() {
  return <div className="mx-1 h-6 w-px bg-white/10" aria-hidden />;
}

function ToolButton({
  label, onClick, active, danger, children,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        // 40px hit area on mobile for reliable touch input
        "inline-flex size-10 sm:size-9 items-center justify-center rounded-xl text-white/85 transition-all",
        "hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300/50",
        active && "bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/50",
        danger && "hover:bg-red-500/20 hover:text-red-200",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- */
/* Drawing helpers                                                */
/* -------------------------------------------------------------- */

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (s.pts.length === 0) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "highlighter") {
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = withAlpha(s.color, 0.35);
    ctx.lineWidth = s.w;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.w;
  }
  if (s.tool === "arrow" && s.pts.length >= 2) {
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    const x1 = a[0] * w, y1 = a[1] * h, x2 = b[0] * w, y2 = b[1] * h;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.max(10, s.w * 4);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 6), y2 - len * Math.sin(ang - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 6), y2 - len * Math.sin(ang + Math.PI / 6));
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(s.pts[0][0] * w, s.pts[0][1] * h);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * w, s.pts[i][1] * h);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Shape & { kindShape: ShapeMsg["kind"] },
  w: number, h: number,
) {
  const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = s.w;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = withAlpha(s.color, 0.18);
  ctx.globalCompositeOperation = "source-over";
  const k = s.kindShape;
  if (k === "line") {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    return;
  }
  if (k === "rect") {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    const rad = Math.min(10, Math.min(rw, rh) * 0.15);
    roundRect(ctx, x, y, rw, rh, rad);
    ctx.fill(); ctx.stroke();
    return;
  }
  // ellipse & ring
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const rx = Math.max(1, Math.abs(x2 - x1) / 2);
  const ry = Math.max(1, Math.abs(y2 - y1) / 2);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (k === "ellipse") { ctx.fill(); ctx.stroke(); }
  else /* ring */ { ctx.stroke(); }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  t: TextAnn & { kindText: "text" | "sticky" },
  w: number, h: number,
) {
  const isSticky = t.kindText === "sticky";
  const px = isSticky ? STICKY_PX[t.size] : TEXT_PX[t.size];
  ctx.font = `${isSticky ? 600 : 500} ${px}px ${FONT_STACK[t.font]}`;
  ctx.textBaseline = "top";
  const maxW = Math.max(80, t.maxW * w);
  const lines = wrapText(ctx, t.content, maxW);
  const lineH = Math.round(px * 1.25);
  const padX = isSticky ? 12 : 6;
  const padY = isSticky ? 10 : 4;
  const x = t.x * w, y = t.y * h;
  const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2;
  const bh = lines.length * lineH + padY * 2;

  if (isSticky) {
    // sticky background — soft tint of chosen color
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = withAlpha(t.color, 0.92);
    roundRect(ctx, x, y, bw, bh, 8);
    ctx.fill();
    ctx.restore();
    // corner fold
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.moveTo(x + bw - 14, y);
    ctx.lineTo(x + bw, y);
    ctx.lineTo(x + bw, y + 14);
    ctx.closePath();
    ctx.fill();
    // text on sticky — readable ink
    ctx.fillStyle = readableInk(t.color);
  } else {
    // plain text: subtle dark chip behind for legibility over any content
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, x, y, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = t.color;
  }
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + padX, y + padY + i * lineH);
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const paragraphs = text.split(/\n/);
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    if (para === "") out.push("");
  }
  return out.length ? out : [""];
}

function readableInk(bg: string): string {
  // For sticky notes: pick dark ink for light backgrounds, light ink for dark.
  // Cheap heuristic on HSL / hex.
  const hsl = bg.match(/hsl\(\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  if (hsl) return Number(hsl[3]) > 60 ? "rgba(15,15,15,0.92)" : "rgba(255,255,255,0.95)";
  const hex = bg.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return l > 0.6 ? "rgba(15,15,15,0.92)" : "rgba(255,255,255,0.95)";
  }
  return "rgba(255,255,255,0.95)";
}

function withAlpha(c: string, a: number) {
  const hsl = c.match(/^hsl\(([^)]+)\)$/);
  if (hsl) return `hsla(${hsl[1]} / ${a})`;
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return c;
}

/* -------------------------------------------------------------- */
/* Selection geometry helpers                                     */
/* -------------------------------------------------------------- */

type Bounds = { x1: number; y1: number; x2: number; y2: number };
type HandleKey = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function strokeShapeBounds(it: AnyItem): Bounds {
  if (it.kind === "stroke") {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of it.pts) {
      if (x < x1) x1 = x;
      if (y < y1) y1 = y;
      if (x > x2) x2 = x;
      if (y > y2) y2 = y;
    }
    if (!isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
    return { x1, y1, x2, y2 };
  }
  if (it.kind === "shape") {
    return {
      x1: Math.min(it.x1, it.x2),
      y1: Math.min(it.y1, it.y2),
      x2: Math.max(it.x1, it.x2),
      y2: Math.max(it.y1, it.y2),
    };
  }
  return { x1: it.x, y1: it.y, x2: it.x + it.maxW, y2: it.y + 0.1 };
}

function itemPixelBounds(it: AnyItem, w: number, h: number): Bounds {
  if (it.kind === "text") {
    const isSticky = it.kindText === "sticky";
    const px = isSticky ? STICKY_PX[it.size] : TEXT_PX[it.size];
    const maxWpx = Math.max(80, it.maxW * w);
    const charsPerLine = Math.max(4, Math.floor(maxWpx / (px * 0.55)));
    const paragraphs = it.content.split(/\n/);
    let lines = 0;
    for (const p of paragraphs) lines += Math.max(1, Math.ceil((p.length || 1) / charsPerLine));
    const lineH = Math.round(px * 1.25);
    const padX = isSticky ? 12 : 6;
    const padY = isSticky ? 10 : 4;
    const bwPx = Math.min(maxWpx, maxWpx) + padX * 2;
    const bhPx = lines * lineH + padY * 2;
    return { x1: it.x * w, y1: it.y * h, x2: it.x * w + bwPx, y2: it.y * h + bhPx };
  }
  const b = strokeShapeBounds(it);
  return { x1: b.x1 * w, y1: b.y1 * h, x2: b.x2 * w, y2: b.y2 * h };
}

function translateItem(it: AnyItem, dx: number, dy: number): AnyItem {
  if (it.kind === "stroke") {
    return { ...it, pts: it.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
  if (it.kind === "shape") {
    return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
  }
  return { ...it, x: it.x + dx, y: it.y + dy };
}

function transformItem(orig: AnyItem, oldB: Bounds, newB: Bounds): AnyItem {
  const ow = oldB.x2 - oldB.x1 || 1e-6;
  const oh = oldB.y2 - oldB.y1 || 1e-6;
  const sx = (newB.x2 - newB.x1) / ow;
  const sy = (newB.y2 - newB.y1) / oh;
  const mapX = (x: number) => newB.x1 + (x - oldB.x1) * sx;
  const mapY = (y: number) => newB.y1 + (y - oldB.y1) * sy;
  if (orig.kind === "stroke") {
    return { ...orig, pts: orig.pts.map(([x, y]) => [mapX(x), mapY(y)] as [number, number]) };
  }
  if (orig.kind === "shape") {
    return { ...orig, x1: mapX(orig.x1), y1: mapY(orig.y1), x2: mapX(orig.x2), y2: mapY(orig.y2) };
  }
  return {
    ...orig,
    x: newB.x1,
    y: newB.y1,
    maxW: Math.max(0.04, newB.x2 - newB.x1),
  };
}

function handleAnchorPx(h: HandleKey, b: Bounds): { x: number; y: number } {
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  switch (h) {
    case "nw": return { x: b.x1, y: b.y1 };
    case "n":  return { x: cx,   y: b.y1 };
    case "ne": return { x: b.x2, y: b.y1 };
    case "e":  return { x: b.x2, y: cy   };
    case "se": return { x: b.x2, y: b.y2 };
    case "s":  return { x: cx,   y: b.y2 };
    case "sw": return { x: b.x1, y: b.y2 };
    case "w":  return { x: b.x1, y: cy   };
  }
}

function computeNewBoundsPx(
  oldB: Bounds,
  handle: HandleKey,
  pt: { x: number; y: number },
  keepAspect: boolean,
): Bounds {
  let { x1, y1, x2, y2 } = oldB;
  if (handle.includes("w")) x1 = pt.x;
  if (handle.includes("e")) x2 = pt.x;
  if (handle.includes("n")) y1 = pt.y;
  if (handle.includes("s")) y2 = pt.y;
  // Keep positive size (no auto-flip, clamp instead)
  const MIN = 8;
  if (x2 - x1 < MIN) {
    if (handle.includes("w")) x1 = x2 - MIN;
    else x2 = x1 + MIN;
  }
  if (y2 - y1 < MIN) {
    if (handle.includes("n")) y1 = y2 - MIN;
    else y2 = y1 + MIN;
  }
  if (keepAspect && handle.length === 2) {
    const aspect = (oldB.x2 - oldB.x1) / (oldB.y2 - oldB.y1 || 1e-6);
    const nw = x2 - x1;
    const nh = y2 - y1;
    let targetW = nw, targetH = nh;
    if (nw / nh > aspect) {
      // width dominates -> grow height to match
      targetH = nw / aspect;
    } else {
      targetW = nh * aspect;
    }
    if (handle === "nw") { x1 = x2 - targetW; y1 = y2 - targetH; }
    if (handle === "ne") { x2 = x1 + targetW; y1 = y2 - targetH; }
    if (handle === "se") { x2 = x1 + targetW; y2 = y1 + targetH; }
    if (handle === "sw") { x1 = x2 - targetW; y2 = y1 + targetH; }
  }
  return { x1, y1, x2, y2 };
}

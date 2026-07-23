/**
 * PresenterTools — professional annotation & pointer layer for LiveKit calls.
 *
 * Features
 *  - Laser pointer (fading trail), Pen, Highlighter, Arrow, Eraser (own strokes)
 *  - Undo (own last stroke), Clear all
 *  - Broadcast over LiveKit data channel (topic "presenter") to every peer
 *  - Overlay renders on ALL participants' screens whenever anyone is sharing
 *  - Per-participant identity color so it's clear who's drawing
 *  - Works in audio-only and video calls (screen share is a separate track)
 *  - Keyboard: A toggle toolbar, 1 laser, 2 pen, 3 highlighter, 4 arrow,
 *              5 eraser, Z undo, X clear, Esc off
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoomContext, useTracks } from "@livekit/components-react";
import { Track, RoomEvent, type RemoteParticipant } from "livekit-client";
import {
  MousePointer2,
  Pencil,
  Highlighter,
  ArrowUpRight,
  Eraser,
  Undo2,
  Trash2,
  ChevronRight,
  ChevronLeft,
  PenTool,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tool = "off" | "laser" | "pen" | "highlighter" | "arrow" | "eraser";

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
type LaserMsg = { t: "laser"; owner: string; x: number; y: number; color: string };
type UndoMsg = { t: "undo"; owner: string };
type ClearMsg = { t: "clear"; owner?: string /* undefined = clear all */ };
type Msg = StrokeMsg | LaserMsg | UndoMsg | ClearMsg;

type Stroke = Omit<StrokeMsg, "t" | "done">;

const TOPIC = "presenter";
const enc = new TextEncoder();
const dec = new TextDecoder();

function ownerColor(identity: string) {
  let h = 0;
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 92% 58%)`;
}

/* -------------------------------------------------------------- */

export function PresenterTools({ rtl }: { rtl: boolean }) {
  const room = useRoomContext();
  const shares = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const isAnyoneSharing = shares.length > 0;

  const [tool, setTool] = useState<Tool>("off");
  const [collapsed, setCollapsed] = useState(false);

  const localIdentity = room.localParticipant.identity;
  const myColor = useMemo(() => ownerColor(localIdentity), [localIdentity]);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Shared state: strokes by id, laser cursors by owner, order of strokes for undo
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  const orderRef = useRef<string[]>([]);
  const lasersRef = useRef<Map<string, { x: number; y: number; color: string; t: number }>>(new Map());
  const activeStrokeRef = useRef<Stroke | null>(null);
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);

  /* --------------- broadcast helpers --------------- */
  const publish = useCallback(
    async (msg: Msg, reliable: boolean) => {
      try {
        await room.localParticipant.publishData(enc.encode(JSON.stringify(msg)), {
          reliable,
          topic: TOPIC,
        });
      } catch {
        /* ignore */
      }
    },
    [room],
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
      } catch { /* noop */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  const applyMessage = useCallback((m: Msg) => {
    if (m.t === "stroke") {
      strokesRef.current.set(m.id, {
        id: m.id, owner: m.owner, tool: m.tool, color: m.color, w: m.w, pts: m.pts,
      });
      if (!orderRef.current.includes(m.id)) orderRef.current.push(m.id);
    } else if (m.t === "laser") {
      lasersRef.current.set(m.owner, { x: m.x, y: m.y, color: m.color, t: performance.now() });
    } else if (m.t === "undo") {
      // remove last stroke by owner
      for (let i = orderRef.current.length - 1; i >= 0; i--) {
        const id = orderRef.current[i];
        const s = strokesRef.current.get(id);
        if (s && s.owner === m.owner) {
          strokesRef.current.delete(id);
          orderRef.current.splice(i, 1);
          break;
        }
      }
    } else if (m.t === "clear") {
      if (m.owner) {
        for (let i = orderRef.current.length - 1; i >= 0; i--) {
          const id = orderRef.current[i];
          const s = strokesRef.current.get(id);
          if (s && s.owner === m.owner) {
            strokesRef.current.delete(id);
            orderRef.current.splice(i, 1);
          }
        }
      } else {
        strokesRef.current.clear();
        orderRef.current = [];
      }
    }
  }, []);

  /* --------------- clear on new share start --------------- */
  const shareCount = shares.length;
  const prevShareCount = useRef(shareCount);
  useEffect(() => {
    if (prevShareCount.current === 0 && shareCount > 0) {
      strokesRef.current.clear();
      orderRef.current = [];
      lasersRef.current.clear();
      dirtyRef.current = true;
    }
    prevShareCount.current = shareCount;
    if (shareCount === 0 && tool !== "off") setTool("off");
  }, [shareCount, tool]);

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
        // laser fade forces continuous redraw
        const now = performance.now();
        let laserAlive = false;
        for (const [id, l] of lasersRef.current) {
          if (now - l.t > 1200) lasersRef.current.delete(id);
          else laserAlive = true;
        }
        if (dirtyRef.current || laserAlive || activeStrokeRef.current) {
          const ctx = cvs.getContext("2d")!;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          // strokes
          for (const id of orderRef.current) {
            const s = strokesRef.current.get(id);
            if (s) drawStroke(ctx, s, w, h);
          }
          // active local stroke (in-progress)
          if (activeStrokeRef.current) drawStroke(ctx, activeStrokeRef.current, w, h);
          // lasers
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
          dirtyRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isAnyoneSharing]);

  /* --------------- pointer interaction --------------- */
  const laserThrottleRef = useRef(0);
  const strokeSendRef = useRef(0);

  const toNorm = (e: PointerEvent | React.PointerEvent) => {
    const box = overlayRef.current!;
    const r = box.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as [number, number];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "off") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    if (tool === "laser") {
      lasersRef.current.set(localIdentity, { x: p[0], y: p[1], color: myColor, t: performance.now() });
      void publish({ t: "laser", owner: localIdentity, x: p[0], y: p[1], color: myColor }, false);
      dirtyRef.current = true;
      return;
    }
    if (tool === "eraser") {
      // erase own strokes only
      void publish({ t: "clear", owner: localIdentity }, true);
      applyMessage({ t: "clear", owner: localIdentity });
      dirtyRef.current = true;
      return;
    }
    const id = `${localIdentity}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
    const stroke: Stroke = {
      id, owner: localIdentity, tool: tool as Stroke["tool"], color: myColor,
      w: tool === "highlighter" ? 22 : tool === "arrow" ? 4 : 3, pts: [p],
    };
    activeStrokeRef.current = stroke;
    dirtyRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === "off") return;
    const p = toNorm(e);
    if (tool === "laser") {
      const now = performance.now();
      if (now - laserThrottleRef.current < 33) return; // ~30fps
      laserThrottleRef.current = now;
      lasersRef.current.set(localIdentity, { x: p[0], y: p[1], color: myColor, t: now });
      void publish({ t: "laser", owner: localIdentity, x: p[0], y: p[1], color: myColor }, false);
      dirtyRef.current = true;
      return;
    }
    const s = activeStrokeRef.current;
    if (!s) return;
    if (s.tool === "arrow") {
      // arrow uses just start & current end point
      s.pts = [s.pts[0], p];
    } else {
      // simple distance filter to reduce points
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
    if (tool === "off") return;
    const s = activeStrokeRef.current;
    if (s) {
      // commit locally
      strokesRef.current.set(s.id, s);
      orderRef.current.push(s.id);
      activeStrokeRef.current = null;
      void publish({
        t: "stroke", id: s.id, owner: s.owner, tool: s.tool, color: s.color, w: s.w,
        pts: s.pts, done: true,
      }, true);
    }
    dirtyRef.current = true;
  };

  /* --------------- toolbar actions --------------- */
  const undo = useCallback(() => {
    void publish({ t: "undo", owner: localIdentity }, true);
    applyMessage({ t: "undo", owner: localIdentity });
    dirtyRef.current = true;
  }, [publish, applyMessage, localIdentity]);

  const clearAll = useCallback(() => {
    void publish({ t: "clear" }, true);
    applyMessage({ t: "clear" });
    dirtyRef.current = true;
  }, [publish, applyMessage]);

  /* --------------- keyboard --------------- */
  useEffect(() => {
    if (!isAnyoneSharing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a") { setCollapsed((v) => !v); }
      else if (k === "1") setTool("laser");
      else if (k === "2") setTool("pen");
      else if (k === "3") setTool("highlighter");
      else if (k === "4") setTool("arrow");
      else if (k === "5") setTool("eraser");
      else if (k === "z") undo();
      else if (k === "x") clearAll();
      else if (e.key === "Escape") setTool("off");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAnyoneSharing, undo, clearAll]);

  if (!isAnyoneSharing) return null;

  const interactive = tool !== "off";

  return (
    <>
      {/* Overlay canvas positioned over LiveKit stage (above tiles, below controls) */}
      <div
        ref={overlayRef}
        className={cn(
          "absolute left-0 right-0 top-0 z-30",
          "bottom-32", // leave room for control bar (matches h-[calc(100%-128px)] stage)
          interactive ? "cursor-crosshair pointer-events-auto" : "pointer-events-none",
        )}
        style={{ touchAction: interactive ? "none" : undefined }}
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
            {rtl ? "وضع الشرح مفعّل — اضغط Esc للخروج" : "Presenter mode — press Esc to exit"}
          </div>
        ) : null}
      </div>

      {/* Floating toolbar */}
      <div
        className={cn(
          "absolute z-40 flex items-center gap-1 rounded-2xl border border-amber-400/30 bg-black/70 p-1.5 backdrop-blur-xl shadow-2xl shadow-amber-500/10",
          rtl ? "left-4" : "right-4",
          "bottom-40",
        )}
        role="toolbar"
        aria-label={rtl ? "أدوات المُقدِّم" : "Presenter tools"}
      >
        <ToolButton
          label={rtl ? "طي الأدوات" : "Collapse"}
          onClick={() => setCollapsed((v) => !v)}
          active={false}
        >
          {collapsed ? (rtl ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />)
                     : <PenTool className="size-4" />}
        </ToolButton>

        {!collapsed ? (
          <>
            <div className="mx-1 h-6 w-px bg-white/10" aria-hidden />
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
            <ToolButton label={rtl ? "مسح رسوماتي (5)" : "Erase mine (5)"} active={tool === "eraser"}
              onClick={() => setTool(tool === "eraser" ? "off" : "eraser")}>
              <Eraser className="size-4" />
            </ToolButton>
            <div className="mx-1 h-6 w-px bg-white/10" aria-hidden />
            <ToolButton label={rtl ? "تراجع (Z)" : "Undo (Z)"} onClick={undo} active={false}>
              <Undo2 className="size-4" />
            </ToolButton>
            <ToolButton label={rtl ? "مسح الكل (X)" : "Clear all (X)"} onClick={clearAll} active={false} danger>
              <Trash2 className="size-4" />
            </ToolButton>
            <div
              className="mx-1 rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-white/70"
              title={rtl ? "لونك" : "Your color"}
            >
              <span className="inline-block size-2.5 rounded-full align-middle" style={{ background: myColor }} />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

/* -------------------------------------------------------------- */

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
        "inline-flex size-9 items-center justify-center rounded-xl text-white/85 transition-all",
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
    // arrow head
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

function withAlpha(hsl: string, a: number) {
  // convert "hsl(H S% L%)" to "hsla(H S% L% / a)"
  return hsl.replace(/^hsl\(([^)]+)\)$/, (_m, inner) => `hsla(${inner} / ${a})`);
}

/**
 * Portal-based shell for the call UI that supports two modes:
 *  - "full": takes the whole viewport (default when a call opens).
 *  - "mini": a draggable, resizable floating panel so the user can keep
 *    talking and screen-sharing while browsing the rest of the app.
 *
 * The LiveKit connection lives inside `children`; only the visual shell
 * swaps, so audio/video/screen-share never drop when switching modes.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Minimize2, Maximize2, GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type CallShellMode = "full" | "mini";

const LS_MINI = "call.shell.miniRect";
const MIN_W = 260;
const MIN_H = 180;
const MAX_W = 720;
const MAX_H = 480;
const DEFAULT_W = 340;
const DEFAULT_H = 230;
const SNAP = 24;

type Rect = { x: number; y: number; w: number; h: number };

function readRect(): Rect | null {
  try {
    const raw = localStorage.getItem(LS_MINI);
    if (!raw) return null;
    const r = JSON.parse(raw) as Rect;
    if (typeof r?.x !== "number") return null;
    return r;
  } catch { return null; }
}
function writeRect(r: Rect) {
  try { localStorage.setItem(LS_MINI, JSON.stringify(r)); } catch { /* ignore */ }
}

function clampRect(r: Rect): Rect {
  if (typeof window === "undefined") return r;
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_W), Math.min(MAX_W, vw - 16));
  const h = Math.min(Math.max(r.h, MIN_H), Math.min(MAX_H, vh - 16));
  const x = Math.min(Math.max(r.x, 8), vw - w - 8);
  const y = Math.min(Math.max(r.y, 8), vh - h - 8);
  return { x, y, w, h };
}

function snapRect(r: Rect): Rect {
  if (typeof window === "undefined") return r;
  const vw = window.innerWidth, vh = window.innerHeight;
  let { x, y, w, h } = r;
  if (x < SNAP) x = 8;
  else if (x + w > vw - SNAP) x = vw - w - 8;
  if (y < SNAP) y = 8;
  else if (y + h > vh - SNAP) y = vh - h - 8;
  return { x, y, w, h };
}

export function FloatingCallShell({
  open,
  mode,
  onModeChange,
  rtl,
  children,
}: {
  open: boolean;
  mode: CallShellMode;
  onModeChange: (m: CallShellMode) => void;
  rtl: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<Rect>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
    const saved = readRect();
    if (saved) return clampRect(saved);
    return {
      x: Math.max(8, window.innerWidth - DEFAULT_W - 24),
      y: Math.max(8, window.innerHeight - DEFAULT_H - 96),
      w: DEFAULT_W,
      h: DEFAULT_H,
    };
  });
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useEffect(() => { setMounted(true); }, []);

  // Body scroll lock only when full.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    if (mode === "full") document.body.style.overflow = "hidden";
    else document.body.style.overflow = prev;
    return () => { document.body.style.overflow = prev; };
  }, [open, mode]);

  // Keep mini rect inside the viewport when window resizes.
  useEffect(() => {
    if (mode !== "mini") return;
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [mode]);

  // Persist rect changes.
  useEffect(() => {
    if (mode === "mini") writeRect(rect);
  }, [rect, mode]);

  // Keyboard shortcut: Cmd/Ctrl+\ toggles mini.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        onModeChange(mode === "full" ? "mini" : "full");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, onModeChange]);

  // Drag handlers
  const dragStateRef = useRef<null | {
    kind: "drag" | "resize";
    startX: number; startY: number;
    orig: Rect;
    pointerId: number;
  }>(null);

  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (mode !== "mini") return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      kind: "drag",
      startX: e.clientX,
      startY: e.clientY,
      orig: rectRef.current,
      pointerId: e.pointerId,
    };
  }, [mode]);

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    if (mode !== "mini") return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      kind: "resize",
      startX: e.clientX,
      startY: e.clientY,
      orig: rectRef.current,
      pointerId: e.pointerId,
    };
  }, [mode]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (s.kind === "drag") {
      setRect(clampRect({ ...s.orig, x: s.orig.x + dx, y: s.orig.y + dy }));
    } else {
      setRect(clampRect({ ...s.orig, w: s.orig.w + dx, h: s.orig.h + dy }));
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    dragStateRef.current = null;
    if (s.kind === "drag") setRect((r) => snapRect(r));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    // Broadcast mode changes so children (control bar) can hide extra UI.
    document.documentElement.dataset.callMode = mode;
    return () => { delete document.documentElement.dataset.callMode; };
  }, [open, mode]);

  if (!mounted || !open) return null;

  const isMini = mode === "mini";

  const shellStyle: React.CSSProperties = isMini
    ? {
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: 60,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,168,76,0.35)",
        background: "#050505",
        color: "white",
      }
    : {
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "#000",
        color: "white",
      };

  return createPortal(
    <div
      role="dialog"
      aria-modal={isMini ? "false" : "true"}
      aria-label={rtl ? "نافذة المكالمة" : "Call window"}
      dir={rtl ? "rtl" : "ltr"}
      style={shellStyle}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-call-shell={mode}
    >
      {isMini && (
        <div
          onPointerDown={onDragPointerDown}
          className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 h-8 px-2 bg-gradient-to-b from-black/85 to-black/20 cursor-move select-none"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-100/90 truncate">
            <GripHorizontal className="h-3.5 w-3.5 text-amber-300/80" aria-hidden />
            <span className="truncate">{rtl ? "مكالمة نشطة" : "Live call"}</span>
          </div>
          <button
            type="button"
            data-no-drag
            onClick={() => onModeChange("full")}
            aria-label={rtl ? "تكبير المكالمة" : "Expand call"}
            title={rtl ? "تكبير" : "Expand"}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-white/10 hover:bg-white/20 text-white transition"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-0",
          isMini ? "pt-8" : "pt-0",
        )}
      >
        {children}
      </div>

      {isMini && (
        <div
          role="button"
          aria-label={rtl ? "تغيير حجم النافذة" : "Resize window"}
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 end-0 z-30 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 45%, rgba(201,168,76,0.85) 45%, rgba(201,168,76,0.85) 55%, transparent 55%, transparent 65%, rgba(201,168,76,0.6) 65%, rgba(201,168,76,0.6) 75%, transparent 75%)",
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/**
 * Small circular button used in the main toolbar to enter mini mode.
 */
export function MinimizeCallButton({
  rtl,
  onClick,
}: {
  rtl: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={rtl ? "تصغير المكالمة (Ctrl+\\)" : "Minimize call (Ctrl+\\)"}
      aria-label={rtl ? "تصغير المكالمة" : "Minimize call"}
      className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/15 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
    >
      <Minimize2 className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden md:inline">{rtl ? "تصغير" : "Minimize"}</span>
    </button>
  );
}

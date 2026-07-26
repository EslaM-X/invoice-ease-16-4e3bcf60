# Screen-share stability + floating mini-call window

Two goals, one release: make screen sharing rock-solid across browsers, and let anyone shrink the whole call into a draggable/resizable floating window so they can keep talking while browsing the app.

## 1. Screen-share stability

**Prevent duplicate publishes & UI stacking**
- Before starting a share, hard-stop any existing local screen track (guard against React double-invoke and rapid re-clicks).
- Debounce the share button (200ms) and disable it while a share request is pending.
- The `PresenterTools` overlay and the share-quality badge must render exactly once per remote screen track; today they can stack when the local sharer's tile is also in the grid. We already hide the sharer's own mirror tile — extend that guard so overlays key off `trackSid` and dedupe.

**Cross-browser compatibility**
Wrap `getDisplayMedia` in a browser-aware helper:
- Chromium (Chrome/Edge/Opera): full options — `displaySurface`, `preferCurrentTab: false`, `selfBrowserSurface: "exclude"` (blocks the "hall of mirrors" at the source), `surfaceSwitching: "include"`, `systemAudio: "include"` when the user opted in.
- Firefox: strip unsupported hints (`displaySurface`, `selfBrowserSurface`, `systemAudio`); fall back to plain `{ video: true, audio: userWantsAudio }`.
- Safari (desktop 17+): only `{ video: true }`; no audio share, no surface hints. Detect and disable the "system audio" toggle with a tooltip explaining why.
- iOS Safari: hide the share button entirely (unsupported); show a hint toast if tapped.

**Failure handling**
- Distinguish `NotAllowedError` (user cancelled — silent) from `NotReadableError` / `NotSupportedError` (toast with actionable text).
- On `ended` event (user hit browser's native "Stop sharing"), auto-clear state and dismiss the preview dialog.

## 2. Picture-in-Picture floating call

Every participant can toggle the call between three modes:

```text
 ┌─ FULLSCREEN ─┐    ┌─ DOCKED ──┐    ┌─ MINI ──┐
 │ full stage   │ ⇄  │ side rail │ ⇄  │ 320×220 │
 └──────────────┘    └───────────┘    └─────────┘
```

- **Fullscreen** — current behaviour.
- **Mini** — a `position: fixed` floating panel (default 320×220, min 260×180, max 720×480). Draggable by its header, resizable from the bottom-right corner, snaps to the four screen corners. Position + size persisted per user in `localStorage`.
- Content in mini mode: active-speaker or shared-screen tile as the main surface, a small self-view PIP in the corner, and a compact control strip (mic, cam, share, expand, leave). The participants sheet, presenter tools, and diagnostics stay hidden until expanded.
- The LiveKit `Room` instance is **preserved** across mode switches — we only swap the layout shell, so audio/video never drop.
- The floating window stays above app content (`z-50`) but never blocks scrolling or clicks outside its bounds.
- Keyboard: `Esc` from mini → fullscreen; a new shortcut `Ctrl/Cmd+\` toggles mini mode.
- Works on mobile too: mini mode becomes a bottom-anchored bar (draggable vertically only) to avoid conflicting with the mobile tab bar.

## Files touched

- `src/components/chat/calls/CallStage.tsx` — add mode state, floating shell, share helper, dedupe overlays.
- `src/components/chat/calls/FloatingCallWindow.tsx` *(new)* — drag/resize/snap logic + compact layout.
- `src/components/chat/calls/ShareDiagnostics.tsx` — browser-detection helper + safe `getDisplayMedia` options.
- `src/components/chat/calls/GlobalCallNotifier.tsx` — mount the floating shell so the mini window survives route navigation.
- `src/lib/use-ui-prefs.ts` — persist call window position/size/mode.

## Technical notes

- Drag uses pointer events with `pointer-capture`; resize uses a corner handle. Position clamped to viewport on every `resize`/`orientationchange`.
- Snap threshold 24px from any edge; snapped state stored so re-open lands in the same corner.
- Self-view in mini uses the existing local camera track ref — no extra publish.
- `selfBrowserSurface: "exclude"` removes the mirror problem at the browser level for Chromium; the existing local-share filter remains as a safety net for Firefox/Safari.
- No backend or DB changes.

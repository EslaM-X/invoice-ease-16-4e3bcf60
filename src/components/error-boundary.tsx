import React from "react";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
  /** Optional label shown in the fallback (e.g. "صافي الأرباح"). */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /**
   * Optional async retry hook. When provided, the fallback shows a retry
   * button that runs `onRetry` with exponential backoff (1s → 2s → 4s → 8s,
   * capped at 16s) before remounting the tree. Used for transient failures
   * like presence / realtime channel joins.
   */
  onRetry?: () => Promise<void> | void;
};

type State = { error: Error | null };

/**
 * Route-level Error Boundary — catches render/lifecycle throws and infinite
 * update-depth loops so a single page failure never freezes the whole app.
 * Reset re-mounts children with a fresh key.
 */
export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  private resetKey = 0;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.resetKey += 1;
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      const msg = this.state.error.message || "Unexpected error";
      const isLoop = /Maximum update depth|Too many re-renders/i.test(msg);
      return (
        <div className="min-h-[50vh] w-full flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border bg-card p-6 shadow-sm text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {this.props.label ? `تعذّر عرض ${this.props.label}` : "حدث خطأ غير متوقّع"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isLoop
                  ? "تم اكتشاف حلقة تحديث لا نهائية وإيقافها لحماية التطبيق."
                  : "حدث خطأ أثناء عرض هذه الصفحة. يمكنك إعادة المحاولة."}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-2 break-words font-mono">
                {msg.slice(0, 240)}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={() => window.history.back()}>رجوع</Button>
              <BackoffRetryButton onRetry={this.props.onRetry} reset={this.reset} />
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.resetKey}>{this.props.children}</React.Fragment>;
  }
}

/**
 * Retry button with exponential backoff.
 *
 * Behavior when `onRetry` is provided:
 *   - Click → try onRetry() immediately.
 *   - If it succeeds, remount the tree via `reset()`.
 *   - If it throws, schedule the next attempt after 1s, then 2s, 4s, 8s,
 *     capped at 16s. A visible countdown shows the next attempt.
 *   - Clicking again during the wait cancels the timer and retries now.
 *   - After 5 failed attempts, the button stops auto-retrying and waits
 *     for a manual click.
 *
 * When `onRetry` is absent it falls back to a plain reset button so the
 * boundary keeps working for routes that don't need presence recovery.
 */
function BackoffRetryButton({
  onRetry,
  reset,
}: {
  onRetry?: () => Promise<void> | void;
  reset: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [nextInMs, setNextInMs] = React.useState<number | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const tickRef = React.useRef<number | null>(null);

  const clearTimers = React.useCallback(() => {
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (tickRef.current != null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    setNextInMs(null);
  }, []);

  React.useEffect(() => () => clearTimers(), [clearTimers]);

  const runRetry = React.useCallback(async () => {
    if (!onRetry) { reset(); return; }
    clearTimers();
    setBusy(true);
    try {
      await onRetry();
      setBusy(false);
      setAttempt(0);
      reset();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RouteErrorBoundary] retry failed", err);
      setBusy(false);
      setAttempt((n) => {
        const next = n + 1;
        if (next >= 5) return next; // stop auto-retrying after 5 attempts
        const delay = Math.min(1000 * 2 ** (next - 1), 16_000);
        setNextInMs(delay);
        const startedAt = Date.now();
        tickRef.current = window.setInterval(() => {
          const remaining = Math.max(0, delay - (Date.now() - startedAt));
          setNextInMs(remaining);
        }, 250);
        timerRef.current = window.setTimeout(() => { void runRetry(); }, delay);
        return next;
      });
    }
  }, [onRetry, reset, clearTimers]);

  const scheduled = nextInMs != null && nextInMs > 0;
  const gaveUp = attempt >= 5 && !busy && !scheduled;

  return (
    <Button onClick={runRetry} disabled={busy} className="gap-2 min-w-[9rem]">
      {busy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          جارٍ إعادة المحاولة…
        </>
      ) : scheduled ? (
        <>
          <RefreshCw className="w-4 h-4" />
          إعادة خلال {(Math.ceil((nextInMs ?? 0) / 1000))}s
        </>
      ) : (
        <>
          <RefreshCw className="w-4 h-4" />
          {gaveUp ? "إعادة المحاولة يدويًا" : attempt > 0 ? `إعادة المحاولة (${attempt + 1})` : "إعادة المحاولة"}
        </>
      )}
    </Button>
  );
}

export default RouteErrorBoundary;

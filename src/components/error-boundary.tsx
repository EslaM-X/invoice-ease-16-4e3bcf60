import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  children: React.ReactNode;
  /** Optional label shown in the fallback (e.g. "صافي الأرباح"). */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
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
    // Log for observability. Never rethrow — that would re-freeze the tree.
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
              <Button onClick={this.reset} className="gap-2">
                <RefreshCw className="w-4 h-4" /> إعادة المحاولة
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.resetKey}>{this.props.children}</React.Fragment>;
  }
}

export default RouteErrorBoundary;

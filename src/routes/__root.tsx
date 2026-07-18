
import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startSyncEngine } from "@/lib/sync-engine";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { OfflineBanner } from "@/components/offline-banner";
import { InstallPrompt } from "@/components/install-prompt";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { SyncToaster } from "@/components/sync-toaster";
import { PwaVersionGuard } from "@/components/pwa-version-guard";
import { StaleChunkGuard } from "@/components/stale-chunk-guard";
import { ApprovalGate } from "@/components/approval-gate";
import { LuxurySplash } from "@/components/luxury-splash";
import { PWA_ASSET_VERSION } from "@/lib/pwa-version";
import appCss from "../styles.css?url";

const assetVersionQuery = `?v=${PWA_ASSET_VERSION}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5" },
      { title: "Steinheim Suite — نظام الإدارة المتكامل" },
      { name: "description", content: "Steinheim Suite — نظام إدارة شامل للفواتير، المخزون، العملاء، ومركز الاتصال." },
      { property: "og:title", content: "Steinheim Suite — نظام الإدارة المتكامل" },
      { name: "twitter:title", content: "Steinheim Suite — نظام الإدارة المتكامل" },
      { property: "og:description", content: "Steinheim Suite — نظام إدارة شامل للفواتير، المخزون، العملاء، ومركز الاتصال." },
      { name: "twitter:description", content: "Steinheim Suite — نظام إدارة شامل للفواتير، المخزون، العملاء، ومركز الاتصال." },
      { property: "og:image", content: "/og-image.png" },
      { name: "twitter:image", content: "/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#0b0b0c" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Steinheim Suite" },
      { name: "application-name", content: "Steinheim Suite" },
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: `/favicon.png${assetVersionQuery}` },
      { rel: "icon", type: "image/png", sizes: "512x512", href: `/icon-512.png${assetVersionQuery}` },
      { rel: "shortcut icon", href: `/favicon.ico${assetVersionQuery}` },
      { rel: "apple-touch-icon", sizes: "180x180", href: `/apple-touch-icon-180.png${assetVersionQuery}` },
      { rel: "apple-touch-icon", sizes: "1024x1024", href: `/apple-touch-icon.png${assetVersionQuery}` },
      { rel: "mask-icon", href: `/icon-512.png${assetVersionQuery}`, color: "#0b0b0c" },
      { rel: "manifest", href: `/manifest.webmanifest${assetVersionQuery}` },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <a href="/" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground">Home</a>
      </div>
    </div>
  );
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        retry: 1,
        // Keep prior data visible while refetching to eliminate flashes.
        placeholderData: (prev: unknown) => prev,
        // Reuse identical references when server payloads are structurally
        // equal — cuts unnecessary re-renders in memoized consumers.
        structuralSharing: true,
      },
    },
  }), []);

  useEffect(() => { startSyncEngine(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <PwaVersionGuard />
            <StaleChunkGuard />
            <LuxurySplash />
            <OfflineBanner />
            <ApprovalGate>
              <Outlet />
            </ApprovalGate>
            <InstallPrompt />
            <SyncStatusPill />
            <SyncToaster />
            <Toaster
              position="top-center"
              richColors
              closeButton
              theme="system"
              toastOptions={{
                classNames: {
                  toast:
                    "!rounded-2xl !border !border-[color-mix(in_oklab,var(--brand-gold)_30%,var(--border))] !bg-[color-mix(in_oklab,var(--card)_92%,transparent)] !text-foreground !shadow-[0_18px_50px_-18px_color-mix(in_oklab,var(--brand-ink)_45%,transparent)] backdrop-blur-xl",
                  title: "!font-semibold !tracking-tight",
                  description: "!text-muted-foreground",
                  actionButton: "!bg-primary !text-primary-foreground",
                  cancelButton: "!bg-muted",
                  success: "!border-emerald-500/30",
                  error: "!border-rose-500/40",
                  info: "!border-sky-500/30",
                  warning: "!border-amber-500/40",
                },
              }}
            />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

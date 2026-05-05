import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { OfflineBanner } from "@/components/offline-banner";
import { InstallPrompt } from "@/components/install-prompt";
import appCss from "../styles.css?url";

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
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
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
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <OfflineBanner />
          <Outlet />
          <InstallPrompt />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

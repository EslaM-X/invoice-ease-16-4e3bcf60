import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "نظام الفواتير | Invoice System" },
      { name: "description", content: "نظام احترافي لإدارة الفواتير والمخزون والعملاء — Professional invoicing, inventory, and customer management." },
      { property: "og:title", content: "نظام الفواتير | Invoice System" },
      { name: "twitter:title", content: "نظام الفواتير | Invoice System" },
      { property: "og:description", content: "نظام احترافي لإدارة الفواتير والمخزون والعملاء — Professional invoicing, inventory, and customer management." },
      { name: "twitter:description", content: "نظام احترافي لإدارة الفواتير والمخزون والعملاء — Professional invoicing, inventory, and customer management." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7d4e4979-efa9-4396-81bc-df7eec9e7efd/id-preview-21392ab1--b0b17c9d-b438-4cc8-ac75-28eb254ddc6e.lovable.app-1776950693510.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/7d4e4979-efa9-4396-81bc-df7eec9e7efd/id-preview-21392ab1--b0b17c9d-b438-4cc8-ac75-28eb254ddc6e.lovable.app-1776950693510.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
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
          <Outlet />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

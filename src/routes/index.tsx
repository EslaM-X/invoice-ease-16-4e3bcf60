import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  Languages, Moon, Sun, FileText, ScanLine, Boxes, BarChart3,
  ArrowLeft, ArrowRight, Users, PhoneCall, ShieldCheck, Fingerprint,
  Cloud, Truck, Receipt, TrendingUp, Sparkles, Lock, Wifi, Award,
} from "lucide-react";
import steinheimLogo from "@/assets/steinheim-logo.png";
import steinheimLogoWhite from "@/assets/steinheim-logo-white.png";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Steinheim Suite — Smart Invoicing, Inventory & CRM" },
      { name: "description", content: "Steinheim Suite is an all-in-one luxury business management platform: smart invoices, live inventory, customers CRM, call center, and reports — in Arabic & English." },
      { property: "og:title", content: "Steinheim Suite — Smart Invoicing, Inventory & CRM" },
      { property: "og:description", content: "All-in-one luxury business management platform: invoicing, inventory, CRM, call center, and reports for premium teams and distributors." },
      { property: "og:url", content: "https://invoice-ease-16.lovable.app/" },
      { property: "og:image", content: "https://invoice-ease-16.lovable.app/og-image.png" },
      { name: "twitter:image", content: "https://invoice-ease-16.lovable.app/og-image.png" },
      { name: "twitter:title", content: "Steinheim Suite — Smart Invoicing, Inventory & CRM" },
      { name: "twitter:description", content: "All-in-one luxury business management platform: invoicing, inventory, CRM, call center, and reports." },
    ],
    links: [{ rel: "canonical", href: "https://invoice-ease-16.lovable.app/" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Steinheim Suite",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android, Windows, macOS",
        url: "https://invoice-ease-16.lovable.app/",
        description: "All-in-one luxury business management platform for invoicing, inventory, CRM, call center, and reports.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      }),
    }],
  }),
});

function Landing() {
  const { user, loading } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard" });
  }, [loading, user, navigate]);

  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;
  const isAr = lang === "ar";

  const features = [
    { Icon: FileText, title: isAr ? "فواتير ذكية" : "Smart Invoices", desc: isAr ? "إنشاء وطباعة وإرسال بثوانٍ مع QR وأرقام تسلسلية." : "Create, print and send in seconds with QR & serials." },
    { Icon: Boxes, title: isAr ? "مخزون لحظي" : "Live Inventory", desc: isAr ? "تتبّع الكميات والتنبيه عند انخفاض المخزون فورًا." : "Track stock and get instant low-stock alerts." },
    { Icon: ScanLine, title: isAr ? "مسح QR وباركود" : "QR & Barcode", desc: isAr ? "بِع وامسح المنتجات بالكاميرا مباشرة." : "Scan products & sell straight from your camera." },
    { Icon: Users, title: isAr ? "إدارة العملاء" : "Customers CRM", desc: isAr ? "ملفات عملاء كاملة مع سجل المشتريات والديون." : "Full customer profiles, history & balances." },
    { Icon: PhoneCall, title: isAr ? "مركز الاتصال" : "Call Center", desc: isAr ? "تتبّع المكالمات والمواعيد وتقارير الفريق." : "Track calls, appointments and team reports." },
    { Icon: BarChart3, title: isAr ? "تقارير وأرباح" : "Reports & Profits", desc: isAr ? "لوحات تحليلية لحظية للمبيعات والأرباح." : "Live analytics for sales, profits and trends." },
    { Icon: Truck, title: isAr ? "أوامر الشحن" : "Shipping Orders", desc: isAr ? "إصدار بوالص الشحن وتتبّع التسليم." : "Issue shipping bills & track delivery." },
    { Icon: Receipt, title: isAr ? "تدقيق ومراجعة" : "Audit Trail", desc: isAr ? "سجل كامل للحركات لكل موظف وموزّع." : "Full action log for staff & distributors." },
    { Icon: Fingerprint, title: isAr ? "بصمة وFace ID" : "Biometric Login", desc: isAr ? "دخول آمن بالبصمة على الجوال وWindows Hello." : "Secure sign-in with fingerprint & Windows Hello." },
    { Icon: Cloud, title: isAr ? "نسخ احتياطية" : "Cloud Backups", desc: isAr ? "حفظ تلقائي يومي لكل بياناتك في السحابة." : "Automatic daily cloud backups of your data." },
    { Icon: Wifi, title: isAr ? "يعمل دون اتصال" : "Offline Ready", desc: isAr ? "PWA يعمل بدون إنترنت ويزامن عند العودة." : "Works offline as a PWA, syncs when back online." },
    { Icon: ShieldCheck, title: isAr ? "أدوار وصلاحيات" : "Roles & Permissions", desc: isAr ? "صلاحيات دقيقة للمدير والموظفين والموزعين." : "Granular admin, staff & distributor roles." },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient luxury background */}
      <div className="pointer-events-none absolute inset-0 gradient-hero-light opacity-90" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] gradient-silver opacity-60" />

      {/* Header */}
      <header className="sticky top-0 z-30 glass border-b border-border/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <img
              src={theme === "dark" ? steinheimLogoWhite : steinheimLogo}
              alt="Steinheim"
              className="h-9 w-auto max-w-[140px] object-contain"
            />
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Steinheim</span>
              <span className="text-xs font-semibold tracking-tight">{isAr ? "نظام الإدارة المتكامل" : "Suite Platform"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label={isAr ? "تغيير اللغة" : "Change language"}>
              <Languages className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={toggle} aria-label={isAr ? (theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن") : (theme === "dark" ? "Light mode" : "Dark mode")}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Link to="/auth"><Button size="sm" className="rounded-full px-5 shadow-glow">{t("login")}</Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-6 pt-16 pb-24 text-center sm:pt-24">
        {/* Big logo */}
        <div className="animate-hero-up mx-auto mb-10 flex justify-center" style={{ animationDelay: "0ms" }}>
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute inset-0 -m-8 rounded-full bg-gradient-to-br from-foreground/5 via-transparent to-foreground/10 blur-2xl" />
            <div className={`relative rounded-full p-1 ring-1 ${theme === "dark" ? "ring-white/15" : "ring-black/10"} shadow-glow`}>
              <div className={`rounded-full p-6 sm:p-8 ${theme === "dark" ? "bg-black" : "bg-black"}`}>
                <img src={steinheimLogoWhite} alt="Steinheim" className="h-20 w-auto sm:h-28 object-contain" />
              </div>
            </div>
          </div>
        </div>

        <div
          className="animate-hero-up mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-silver bg-card/60 px-4 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur"
          style={{ animationDelay: "120ms" }}
        >
          <Sparkles className="h-3 w-3" />
          {isAr ? "النظام الفاخر لإدارة الأعمال" : "The Luxury Business Platform"}
        </div>

        <h1 className="text-balance text-5xl leading-[1.05] tracking-tight sm:text-7xl md:text-8xl lg:text-[9rem]">
          <span
            className="animate-hero-title font-display font-latin inline-block text-platinum"
            style={{ animationDelay: "200ms" }}
          >
            Steinheim
          </span>
        </h1>

        <p
          className="animate-hero-up mx-auto mt-4 text-sm font-medium tracking-[0.4em] uppercase text-muted-foreground"
          style={{ animationDelay: "300ms" }}
        >
          {isAr ? "Suite — نظام إدارة شامل" : "Suite — All-in-One Management"}
        </p>

        <p
          className="animate-hero-up mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          style={{ animationDelay: "400ms" }}
        >
          {isAr
            ? "منصة فاخرة ومتكاملة لإدارة الفواتير، المخزون، العملاء، الشحن، ومركز الاتصال — مع تقارير لحظية، حماية ببصمة الإصبع، ونُسخ احتياطية سحابية. كل ما تحتاجه شركتك في مكان واحد."
            : "A premium all-in-one platform for invoices, inventory, customers, shipping & call-center — with live analytics, biometric security, and cloud backups. Everything your business needs, beautifully unified."}
        </p>

        <div
          className="animate-hero-up mt-10 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "500ms" }}
        >
          <Link to="/auth">
            <Button size="lg" className="gap-2 rounded-full px-8 shadow-glow text-base h-12">
              {t("signup")} <Arrow className="h-4 w-4" />
            </Button>
          </Link>
          <Link to="/auth">
            <Button size="lg" variant="outline" className="gap-2 rounded-full px-8 border-silver text-base h-12">
              <Lock className="h-4 w-4" /> {t("login")}
            </Button>
          </Link>
        </div>

        {/* Trust badges */}
        <div
          className="animate-hero-up mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground"
          style={{ animationDelay: "600ms" }}
        >
          <span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5" /> {isAr ? "تجربة احترافية" : "Pro experience"}</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> {isAr ? "حماية متقدّمة" : "Advanced security"}</span>
          <span className="inline-flex items-center gap-1.5"><Cloud className="h-3.5 w-3.5" /> {isAr ? "سحابة موثوقة" : "Reliable cloud"}</span>
          <span className="inline-flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5" /> {isAr ? "يعمل بدون إنترنت" : "Works offline"}</span>
        </div>
      </section>

      {/* Silver divider */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="h-px gradient-silver opacity-50" />
      </div>

      {/* Features grid */}
      <section className="mx-auto max-w-7xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center mb-14">
          <span className="eyebrow">{isAr ? "الإمكانيات" : "Capabilities"}</span>
          <h2 className="mt-3 text-3xl sm:text-5xl font-display tracking-tight text-platinum">
            {isAr ? "كل أدوات الإدارة في منصة واحدة" : "Every management tool in one place"}
          </h2>
          <p className="mt-4 text-muted-foreground">
            {isAr
              ? "مصمّمة بأناقة لتمنحك تحكمًا كاملاً وسرعة استثنائية في كل عملية يومية."
              : "Crafted with elegance to give you total control and exceptional speed in every daily operation."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ Icon, title, desc }, i) => (
            <div
              key={title}
              className="card-premium group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur transition"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="absolute inset-x-0 top-0 h-px gradient-silver opacity-0 group-hover:opacity-80 transition" />
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background shadow-md">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats / value strip */}
      <section className="relative mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl border border-silver bg-gradient-to-br from-card/80 via-card/60 to-card/80 p-8 sm:p-12 backdrop-blur shadow-glow relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px gradient-silver" />
          <div className="absolute inset-x-0 bottom-0 h-px gradient-silver" />
          <div className="grid gap-8 sm:grid-cols-3 text-center">
            <div>
              <div className="text-4xl font-display text-platinum">{isAr ? "‎+30" : "30+"}</div>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">{isAr ? "أداة احترافية" : "Pro tools"}</p>
            </div>
            <div>
              <div className="text-4xl font-display text-platinum">24/7</div>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">{isAr ? "متاح دائمًا" : "Always available"}</p>
            </div>
            <div>
              <div className="text-4xl font-display text-platinum">100%</div>
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">{isAr ? "بياناتك مؤمّنة" : "Your data secured"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
        <div className="rounded-3xl border border-silver bg-foreground text-background p-10 sm:p-14 relative overflow-hidden shadow-glow">
          <div className="absolute inset-0 shimmer-silver opacity-20 pointer-events-none" />
          <img src={steinheimLogoWhite} alt="Steinheim" className="mx-auto h-12 w-auto mb-6 opacity-90" />
          <h3 className="text-2xl sm:text-4xl font-display tracking-tight">
            {isAr ? "ابدأ رحلتك مع Steinheim اليوم" : "Begin your Steinheim journey today"}
          </h3>
          <p className="mt-3 text-sm sm:text-base opacity-80 max-w-xl mx-auto">
            {isAr
              ? "انضم إلى منظومة فاخرة تجمع كل أدوات إدارة شركتك في تجربة واحدة سلسة."
              : "Join a premium ecosystem unifying all your business management tools in one seamless experience."}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" variant="secondary" className="rounded-full px-8 h-12 gap-2">
                <TrendingUp className="h-4 w-4" />
                {isAr ? "إنشاء حساب" : "Create account"}
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="rounded-full px-8 h-12 gap-2 bg-transparent text-background border-background/30 hover:bg-background/10 hover:text-background">
                <Lock className="h-4 w-4" />
                {isAr ? "تسجيل الدخول" : "Sign in"}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 py-8">
        <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src={theme === "dark" ? steinheimLogoWhite : steinheimLogo} alt="Steinheim" className="h-5 w-auto" />
            <span>© {new Date().getFullYear()} Steinheim Suite</span>
          </div>
          <span className="tracking-[0.2em] uppercase">{isAr ? "صُنع بأناقة" : "Crafted with elegance"}</span>
        </div>
      </footer>
    </div>
  );
}

# دليل النشر (External Supabase + Vercel)

التطبيق حالياً شغّال على **Lovable Cloud** (Supabase داخلي) + **Cloudflare Workers**.
الملف ده بيشرح إزاي تنشره على **Supabase خارجي** و**Vercel** بدون أي فقدان للبيانات أو الميزات.

---

## 1) تجهيز Supabase خارجي

### أ. إنشاء المشروع
1. أنشئ مشروع جديد على https://supabase.com
2. احفظ المعلومات دي من Project Settings → API:
   - `Project URL` → `SUPABASE_URL`
   - `Publishable / anon key` → `SUPABASE_PUBLISHABLE_KEY`
   - `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (سري — server only)
   - `Project ref` (من الـ URL) → `SUPABASE_PROJECT_ID`

### ب. تشغيل المايجريشنز (كل البنية الحالية)
كل مخططات قاعدة البيانات (جداول، RPCs، RLS، triggers) موجودة في `supabase/migrations/`.

```bash
# ثبّت Supabase CLI
npm i -g supabase

# اربط مشروعك
supabase link --project-ref <YOUR_PROJECT_REF>

# طبّق كل المايجريشنز
supabase db push
```

### ج. نقل البيانات الموجودة (لو موجودة على Lovable Cloud)
لو عاوز تنقل البيانات الحالية:

```bash
# Export من Lovable Cloud (احصل على الـ connection string من فريق Lovable)
pg_dump --data-only --no-owner --schema=public \
  "postgresql://postgres:<PWD>@db.<OLD_REF>.supabase.co:5432/postgres" \
  > data.sql

# Import للمشروع الجديد
psql "postgresql://postgres:<PWD>@db.<NEW_REF>.supabase.co:5432/postgres" \
  < data.sql
```

> ⚠️ لازم نقل الـ `auth.users` كمان لو عايز نفس الحسابات تشتغل — استخدم
> `pg_dump --schema=auth` للمشروع المصدر، وتأكد من توافق إصدارات Supabase Auth.

### د. إعدادات Authentication
1. Authentication → URL Configuration:
   - Site URL: `https://your-domain.vercel.app`
   - Redirect URLs: ضيف نفس الـ URL + `https://your-domain.vercel.app/**`
2. Authentication → Providers → Google:
   - فعّله بـ Client ID/Secret من Google Cloud Console
   - أضف الـ Callback URL من Supabase لـ Google OAuth consent

### هـ. التحقق من سياسات RLS
كل المايجريشنز فيها GRANTs + RLS. شغّل linter للتأكد:
- Database → Advisors → Security Lints

---

## 2) النشر على Vercel

### أ. تثبيت adapter
`@tanstack/react-start` يدعم Vercel أصلاً. عدّل `vite.config.ts`:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: {
      entry: "server",
      preset: "vercel",  // ← أضف ده عند النشر على Vercel
    },
  },
});
```

> ملاحظة: اتركها بدون `preset` لو لسه شغّال على Lovable/Cloudflare.

### ب. ملف `vercel.json` (اختياري — للتحكم في الـ rewrites)
أنشئ في root المشروع:

```json
{
  "buildCommand": "bun run build",
  "framework": null,
  "outputDirectory": ".output/public",
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

### ج. متغيرات البيئة على Vercel
Project Settings → Environment Variables (لكل من Production/Preview/Development):

| Variable | القيمة |
|---|---|
| `VITE_SUPABASE_URL` | من Supabase الجديد |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon/publishable key |
| `VITE_SUPABASE_PROJECT_ID` | project ref |
| `SUPABASE_URL` | نفس الـ URL (server-side) |
| `SUPABASE_PUBLISHABLE_KEY` | نفس المفتاح |
| `SUPABASE_SERVICE_ROLE_KEY` | service role (سري — server only) |
| `SUPABASE_PROJECT_ID` | project ref |

أي مفاتيح إضافية مستخدمة (مثل WhatsApp, Resend, إلخ) ضيفها هنا برضه.

### د. الربط والنشر
```bash
# ربط المشروع
npx vercel link

# نشر أول مرة
npx vercel --prod
```

أو اربط الـ Git repo مباشرة من Vercel Dashboard → Import Project.

---

## 3) Cron Jobs (لو مستخدم)
الـ cron الموجود (`daily-backup`, `push-dispatch`) ممكن يشتغل عبر:
- **Supabase pg_cron** (الأسهل — موجود بالفعل في المايجريشنز)
- أو **Vercel Cron** عبر `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/public/hooks/daily-backup", "schedule": "0 2 * * *" }
  ]
}
```

---

## 4) Checklist قبل الإطلاق
- [ ] كل المايجريشنز اتطبقت (`supabase db push`)
- [ ] البيانات اتنقلت (لو لازم)
- [ ] متغيرات البيئة كلها موجودة في Vercel
- [ ] Google OAuth مظبوط (Site URL + Redirect URLs)
- [ ] RLS Advisor مفيهوش warnings
- [ ] Build على Vercel نجح (preview deployment)
- [ ] تسجيل دخول شغّال
- [ ] إنشاء فاتورة شغّال (اختبار end-to-end)
- [ ] الـ realtime شغّال (افتح صفحتين، عدّل في واحدة، شوف التحديث في التانية)

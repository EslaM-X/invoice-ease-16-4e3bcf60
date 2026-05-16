# خطة تنفيذ QR Price List

## نظرة عامة
صفحة كتالوج رسمية فخمة لعرض كل منتجات Steinheim 2026، متاحة عامة من /auth، الأدمن يعدل الأسعار، والموظف يمسح QR ليضيف للفاتورة.

## 1. قاعدة البيانات
**جدول جديد `price_list_items`:**
- `id` (uuid PK), `sku` (text unique), `name_en`, `name_ar`, `collection` (JOY/UP/ART/QUATRO), `category` (Basin Mixer / Shower / Bath / Accessories / Bidet / Angle Valve), `color`, `color_hex`, `price` (numeric), `currency` (LE), `image_url`, `qr_payload` (text, format S1:uuid:checksum), `sort_order`, `is_active`, `created_at`, `updated_at`, `updated_by`, `updated_by_email`

**RLS:**
- SELECT: عام (anon + authenticated) — `using (is_active = true)`
- INSERT/UPDATE/DELETE: admins only (`is_admin()`)

**جدول تاريخ التعديلات `price_list_price_history`:**
- يسجل كل تغيير سعر مع `changed_by_email` و `old_price`/`new_price` و `changed_at`
- Trigger تلقائي على UPDATE

**Storage bucket:** `price-list-images` (public read)

## 2. استخراج البيانات من PDF
- استخراج ~60 صورة منتج من الـPDF
- رفع الصور على bucket `price-list-images`
- توليد UUID + QR payload (`S1:uuid:checksum`) لكل منتج باستخدام نفس صيغة `qr-codec.ts` الحالية
- Seed البيانات (collections, SKUs, prices, colors, images) من خلال migration insert

## 3. الصفحة `/qr-price-list`
- **Public route** (مش محتاج auth)
- تصميم فخم: hero section بشعار Steinheim، عداد منتجات، خلفية ذهبية/كحلي
- Tabs/Filters: حسب Collection (الكل / JOY / UP / ART / QUATRO) + Category
- بحث بالاسم/SKU/اللون
- Grid عرض المنتج: صورة + اسم + SKU + لون (swatch) + سعر كبير + QR code مصغر
- زر "نسخ QR" / "تحميل QR PNG" لكل منتج
- لو الزائر admin مسجل: زر ✏️ يفتح dialog تعديل السعر (يكتب في DB + price history)
- لو الزائر موظف مسجل: زر "أضف للفاتورة الحالية" (يستخدم scan-buffer)
- realtime subscription على الجدول → أي تعديل يظهر فوراً لكل المستخدمين

## 4. تكامل مع Invoice Builder
- المسح بـQR للـ price list item → resolve عبر `qr_payload` → يضيف للفاتورة بنفس آلية `pushScanEvent` الحالية لكن من جدول `price_list_items`
- تحديث `qr-codec.ts` ليتعرف على QR codes الجديدة (نفس الصيغة S1: لكن lookup في الجدول الجديد)

## 5. صفحة /auth
- إضافة زر ثالث بجوار Sign In / Sign Up: **"QR Price List"** بأيقونة QrCode وتدرج ذهبي
- يوديك مباشرة لـ `/qr-price-list` بدون تسجيل

## 6. التصميم (فخم وعصري)
- Dark luxury: `oklch(0.1 0.004 60)` خلفية + ذهبي `oklch(0.78 0.11 82)` للأكسنت
- Typography: Cormorant Garamond للعناوين + Inter للجسم
- بطاقات منتج بزجاج (backdrop-blur) + shadow ذهبي ناعم
- Hover: ارتفاع + توهج ذهبي
- انتقالات framer-motion ناعمة

## الملفات
**جديد:**
- `supabase/migrations/...` — جدول + RLS + bucket + seed
- `src/routes/qr-price-list.tsx` — الصفحة العامة
- `src/components/price-list-card.tsx` — كارت المنتج
- `src/components/price-edit-dialog.tsx` — تعديل السعر (admin)
- `src/lib/price-list.ts` — DB helpers
- `public/price-list/*.jpg` — الصور (بديل: storage)

**تعديل:**
- `src/routes/auth.tsx` — زر ثالث
- `src/lib/qr-codec.ts` — دعم lookup للجدول الجديد
- `src/components/invoice-builder.tsx` — قبول scan من price_list_items

## تحذير: الحجم
استخراج 60 صورة من PDF ورفعها + كتابة seed لـ60 منتج + بناء الصفحة الفخمة + التكامل = شغل كبير. سأنفذ على مرحلتين:
- **المرحلة 1 (هذا الرد):** Migration + bucket + استخراج/رفع كل الصور + seed كامل + صفحة /qr-price-list أساسية مع كل المنتجات + زر /auth
- **المرحلة 2 (الرد التالي):** تعديل السعر للأدمن + تكامل المسح مع invoice builder + price history + realtime

موافق؟

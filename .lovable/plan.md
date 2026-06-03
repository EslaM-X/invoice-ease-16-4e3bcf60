## المشكلة الجذرية لـ «محجوز في فواتير = 0»

في `src/routes/in-transit.tsx` الاستعلام بيستخدم embed:
```ts
.from("invoice_po_reservations")
.select("...,invoices(invoice_number,customer_name,total)")
```
بس جدول `invoice_po_reservations` **مفيهوش Foreign Keys** (PK + CHECK بس). PostgREST بيفشل في الـ embed والاستعلام يرجع فاضي → الرقم يفضل صفر، رغم إن في DB فعلاً **2 حجز نشط بمجموع 3 قطع**.

---

## الخطة

### 1) Migration: إضافة Foreign Keys + Indexes
على `invoice_po_reservations`:
- `invoice_id` → `invoices(id) ON DELETE CASCADE`
- `invoice_item_id` → `invoice_items(id) ON DELETE CASCADE`
- `product_id` → `products(id)`
- `po_id` → `purchase_orders(id)`
- `po_item_id` → `purchase_order_items(id)`
- Indexes على `product_id`, `invoice_id`, `po_id`.

### 2) Migration: دالة `get_sold_qty_by_product()`
RPC ترجع `(product_id uuid, sold_qty bigint)` بجمع `invoice_items.quantity` للفواتير اللي حالتها مش `cancelled` للمستخدمين اللي عندهم صلاحية الوصول (`can_access_user_data`). SECURITY DEFINER.

### 3) تعديل `src/routes/in-transit.tsx`
- استدعاء `supabase.rpc("get_sold_qty_by_product")` مع التحميل وتخزين النتيجة في `soldByProduct`.
- إضافة **خانة رابعة** في كارد كل منتج جنب الـ 3 الحالية:
  ```
  في المخزن | قادم في الطريق | محجوز في فواتير | تم بيعه
  ```
  بلون مميز (`bg-blue-500/10 text-blue-700`).
- إضافة **كارد Summary رابع** أعلى الصفحة: «إجمالي المباع / Total Sold» بأيقونة `TrendingUp`.
- دعم عربي/إنجليزي.
- realtime: لما تتعدل `invoices` أو `invoice_items` يعاد تحميل soldByProduct.

### 4) التحقق
- "محجوز في فواتير" يطلع 3 (بدل 0).
- تاب «المحجوز للفواتير» يعرض رقم الفاتورة + اسم العميل (embed شغال).
- الخانة الرابعة بتعرض المباع الفعلي لكل منتج، وكارد الإجمالي صح.

---

### الملفات
- migration: FKs + indexes + RPC.
- `src/routes/in-transit.tsx`: state + UI + realtime.

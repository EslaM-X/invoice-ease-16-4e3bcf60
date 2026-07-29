# InvoiceFlow Pro

Create a full-stack responsive web application (mobile + tablet + desktop) using modern UI/UX best practices. The app must support both Arabic (RTL) and English (LTR) with a toggle switch.

Use Supabase as backend (database, authentication, storage).

========================

🔹 CORE FEATURES

========================

1. CUSTOMER MANAGEMENT

- Add/Edit/Delete customers

- Fields:

  - Name

  - Phone Number

  - Address

- Auto-fill customer data when selected

- Searchable customer list

2. PRODUCT & PRICE LIST SYSTEM

- Full product database (price list)

- Fields:

  - Product Name

  - Serial Number (editable per invoice)

  - Color

  - Price

  - QR Code (linked to product)

  - Stock Quantity

- Ability to import/export price list (CSV)

- Real-time stock tracking

3. QR CODE SYSTEM

- Scan QR code using device camera

- When scanned:

  - Auto-fetch product from database

  - Add directly to invoice

- QR linked to product ID in database

4. INVENTORY MANAGEMENT

- Track stock increase/decrease

- Auto update stock when invoice is created

- Alert when stock is low

- Inventory dashboard:

  - Available stock

  - Sold items

  - Low stock alerts

5. INVOICE BUILDER

- Create new invoice easily

- Add products dynamically

- Edit:

  - Quantity

  - Price

  - Discount per item or total

  - Serial Number

  - Color

- Remove any product

- Auto calculate:

  - Subtotal

  - Discount

  - Final Total

6. MULTI-LANGUAGE INVOICE

- Generate invoice in:

  - Arabic

  - English

- Toggle language before printing

7. PRINTABLE INVOICE

- Clean professional layout

- Include:

  - Logo (uploaded by user)

  - Company Name

  - Address

  - Social Media Links

  - Payment Terms

  - Delivery Terms

- Export options:

  - Print مباشرة

  - PDF download

8. ORDER MANAGEMENT

- Save invoices

- Create new order anytime

- Duplicate invoice

- Edit previous invoices

9. REPORTS & EXPORT

- Export ALL invoices:

  - PDF

  - Excel

- Filter:

  - By date

  - By customer

- Dashboard:

  - Total sales

  - Number of invoices

  - Top products

10. SETTINGS PANEL

- Upload logo

- Edit:

  - Company info

  - Payment terms

  - Delivery terms

  - Social media links

- Save globally (applies to all invoices)

========================

🔹 DATABASE (SUPABASE)

========================

Tables:

- customers

- products

- inventory_logs

- invoices

- invoice_items

- settings

Relations:

- invoice مرتبط بـ customer

- invoice_items مرتبطة بـ products

- inventory auto updates on invoice creation

========================

🔹 UI/UX REQUIREMENTS

========================

- Fully responsive (mobile-first)

- Clean modern dashboard

- Dark/Light mode

- Fast performance

- Arabic RTL support

- Smooth transitions

========================

🔹 TECHNICAL REQUIREMENTS

========================

- Use Supabase for:

  - Auth

  - Database

  - Storage (for logo)

- QR Scanner using device camera

- Real-time updates

- Error handling (no crashes)

- Validation for all inputs

========================

🔹 EXTRA FEATURES (IMPORTANT)

========================

- Auto-save invoice draft

- Offline support (cache last data)

- Toast notifications

- Confirmation before delete

- Role-based access (optional)

========================

🔹 FINAL OUTPUT

========================

The app must be:

- Fully working production-ready

- Bug-free

- Easy to use for non-technical users

- Fast invoice creation workflow (under 30 seconds)

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://invoice-ease-16.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b0b17c9d-b438-4cc8-ac75-28eb254ddc6e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

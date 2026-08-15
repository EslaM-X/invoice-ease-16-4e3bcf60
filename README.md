# Steinheim · Company Management System

Full-stack management platform for Steinheim Egypt: invoicing, customer and
distributor management, inventory and traceability, call center, delivery
receipts, finance and audit reports — built for desktop, mobile and web.

> Designed and developed by [EslaM-X](https://github.com/EslaM-X).

---

## Modules

| Module | What it covers |
| --- | --- |
| **Invoicing** | Customer, product and price lists, per-invoice serials, QR codes, bulk receive |
| **Inventory** | Tracking, reconcile, traceability, consistency and audit views |
| **Distribution** | Distributors, delivery receipts, in-transit, delivery audit and review |
| **Call center** | Call history, call center reports, livekit calls |
| **Finance** | Back-deduction reports, finance audit, fulfillment decisions |
| **Operations** | Admin studio, leadership viewers, audit log, diagnostics |

## Stack

| Layer | Tech |
| --- | --- |
| Framework | TanStack Start · React · TypeScript |
| Backend | Supabase (database · auth · storage) |
| Desktop | Electron (packaged build for Windows / macOS) |
| Mobile | Capacitor (web-to-native sync) |
| Email | Server-rendered templates |

## Quick start

```bash
npm install
npm run dev
```

## Test

```bash
npm test          # vitest
npm run lint      # eslint
```

## Packaging

```bash
npm run electron:build:win     # Windows desktop build
npm run electron:build:mac     # macOS universal build
npm run mobile:sync            # sync web build to Capacitor
```

## Project layout

```
src/
  routes/       TanStack Start file-based routes (pages + API)
  components/   UI + chat components
  integrations/ Supabase and Lovable integrations
  lib/          email templates, MCP tools, shared libs
```

## License

MIT. See `LICENSE`.

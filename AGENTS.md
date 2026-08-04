# AGENTS.md

Guidelines for working in this repository. Read this before making changes.

## Project

Steinheim is a production company-management system (customers, products & price
lists, invoices + items, purchase orders & receipts, delivery receipts, stock and
inventory, team chat, WhatsApp inbox, calls, tasks, distributor portal, reports).
It is a live, multi-user system running against a single cloud database. Treat it
like production: there is no staging data worth losing.

- **Frontend/backend**: TanStack Start (React 19, SSR) on Vite 7, TypeScript, Tailwind v4.
- **Database**: Supabase (Postgres) with Row-Level Security. Schema lives in
  `supabase/migrations/` (one SQL file per change, applied in order).
- **Realtime**: Supabase Realtime on ~55 tables, consumed via `src/lib/realtime.ts`.
- **Deploy**: Cloudflare Workers via nitro (`wrangler.jsonc`). Desktop/mobile
  wrappers (`electron/`, Capacitor) load the live site — there is no local DB.

## Commands

Bun is the package manager (`bun.lock`). On this machine bun is installed outside
`PATH`; use `$env:USERPROFILE\.bun\bin\bun.exe`.

- `bun run dev` — local dev server
- `bun run build:dev` — CI-style build (`--mode development`); use this for local verification
- `bun run build` — production build (heavy; heap flag already set in the script)
- `bun run test` — vitest unit tests
- `bun run lint` — eslint
- `bun run format` — prettier

Never commit `bun run format` output unless the PR is about formatting.

## Git workflow (PR-based)

- Branch naming: `<type>/<short-slug>`, e.g. `fix/stock-race-condition`,
  `feat/customer-intelligence`, `chore/eng-workflow`.
- Commit style: conventional (feat/fix/chore/refactor/test/docs) with a short
  imperative subject. One logical change per commit. Never push straight to `main`.
- Every change lands via a PR against `main`. The PR must pass the CI workflow
  (`e2e-mobile-chat.yml`) and be verified locally first (`bun run test` +
  `bun run build:dev` at minimum).
- PR body: use `.github/pull_request_template.md`. Be specific about what changed
  and how it was tested. For UI changes, include mobile + RTL checks where relevant.
- All commits are authored as `EslaM-X`.

## Data safety (non-negotiable)

The database holds real invoices, receipts, stock, and permissions. Rules:

1. No destructive SQL. A migration may only add objects or columns; it must not
   drop, truncate, or irreversibly alter existing data. If a data fix is truly
   needed, write a reversible migration and call out the blast radius in the PR.
2. `supabase/migrations/` is append-only. Never edit an already-applied migration.
3. Backfill logic must be idempotent and guarded (e.g. `WHERE ... IS NULL`).
4. Prefer additive `SELECT`/aggregation in the client over schema changes. Two
   recent features (customer intelligence, PO cost breakdown) are read-only by
   design — follow that pattern.
5. `types.ts` under `src/integrations/supabase/` is generated; if a migration adds
   columns, regenerate it rather than hand-editing.

## Windows build notes

- `@lovable.dev/mcp-js@0.20.0` is patched (see `package.json` →
  `patchedDependencies`) to fix a path-separator bug that broke Vite on Windows.
  Keep the patch updated if the package is bumped — re-verify `bun run build:dev`
  on Windows after any upgrade.
- The MCP plugin regenerates `src/routes/mcp.ts`, `src/routes/[.mcp]/`,
  `src/routes/[.well-known]/`, and `src/routeTree.gen.ts`. These are generated;
  do not hand-edit them. If a build leaves them modified with line-ending-only
  diffs, restore them with `git checkout --` before committing.
- The repo is LF-canonical (`.gitattributes`). On Windows, `git` may check files
  out as CRLF; `bun run lint` will then report thousands of `Delete ␍`
  prettier errors. That noise is environmental — normalize the checkout
  (`git add --renormalize . && git checkout -- .`) instead of committing
  prettier output.

## Layout

- `src/routes/` — TanStack file routes (one file per page/endpoint).
- `src/components/` — UI components; `src/components/ui/` are shadcn-style primitives.
- `src/lib/` — domain logic, shared functions, i18n, realtime, offline helpers.
- `src/integrations/` — Supabase client/types and Lovable cloud auth.
- `supabase/migrations/` — schema history. Do not touch applied files.
- `tests/` — unit + Playwright e2e specs.
- `.github/workflows/` — CI.

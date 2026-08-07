## Summary

<!-- What does this PR do, in one or two sentences? Lead with the outcome for the
     business, not the mechanism. -->

## Motivation

<!-- Why is this change needed? Reference the concrete problem, bug, or request
     it addresses. Link issues if applicable. -->

## Changes

<!-- Bullet list of the actual changes. Group by area (frontend, API, DB, infra).
     For DB work, say explicitly whether this is additive (new tables/columns/
     functions) or destructive, and why. -->

- [ ] Frontend
- [ ] API / server
- [ ] Database / migration
- [ ] Infra / CI / tooling
- [ ] Tests

## Data safety

<!-- This system runs on a live company database. Every DB change must state its
     blast radius here. If a migration drops, alters, or renames existing objects,
     explain the rollback path and what happens to existing rows. -->

- [ ] No existing data is modified, dropped, or migrated
- [ ] Migration is additive and reversible
- [ ] Requires manual data verification after deploy

## Testing

<!-- How was this verified? Include the exact commands you ran and their results
     (e.g. `bun run test` → 111 passed). Note anything verified manually. -->

- [ ] `bun run lint`
- [ ] `bun run test`
- [ ] `bun run build:dev` (local)
- [ ] CI checks pass on this PR
- [ ] Manual smoke test on the live app (if applicable)

## Screenshots

<!-- Optional: before/after for UI changes. -->

## Related

<!-- PRs, issues, or docs this depends on. -->

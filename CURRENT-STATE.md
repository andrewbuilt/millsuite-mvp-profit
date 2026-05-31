# CURRENT-STATE.md

**Last updated:** 2026-05-31

Single source of truth for "what's shipped / what's open / what's next." Update after every batch of merges.

## Shipped (recent, on main)

### Security & pricing audit (2026-05-31)

Full findings in `docs/audits/2026-05-31-code-audit.md`. Shipped as a series of focused PRs; migrations 052–054 cover the schema changes.

- **H1 — AI proxy routes locked down.** `/api/schedule-ai` and `/api/parse-invoice` were open, unauthenticated Claude proxies (anyone could drain the Anthropic key). Now require a signed-in caller + active subscription + feature gate. New shared `lib/api-auth.ts` (`resolveApiCaller` + 401/402/403 helpers).
- **M5 — project routes tenant-scoped.** `/api/projects/[id]/advance-phase` and `/rollup` now require auth + confirm the project belongs to the caller's org (was IDOR-able). Time pages send the token via `lib/phase-client.ts`.
- **M1/M2/L5 — per-bucket pricing.** Replaced the single project margin with three **true gross-margin** knobs — labor+install / material+hardware+options / consumables — each pinnable per project (NULL = inherit org default), shown transparently per group with a blended readout. Single source of truth: `computeBucketedPrice` + `resolveBucketMargins` in `lib/pricing.ts`. `project-totals.ts`, the project page, and the handoff page all route through it (no divergence). Dead/mislabeled `computeSubprojectPrice` removed. **Migration 052.** Backfill makes existing projects price identically until a knob is changed.
- **M3 — consumable default unified to 10%** everywhere (UI showed 15, code used 10) and seeded explicitly on signup.
- **M4/L4 — atomic signup.** Org + owner + settings + departments now created in one transaction via `create_org_with_owner()` (**migration 053**), so a partial failure can't orphan/duplicate orgs. `/api/auth/setup` derives identity from the verified session token, not the request body.
- **M6 — project actuals recompute again.** Time entries were POSTing to `/api/projects/[id]` (no such route → 404), so `actual_total` never refreshed. Now routes to `/rollup` with auth.
- **M7 — change orders use per-bucket margins.** CO price deltas (pre-production + subproject views) now price through `computeBucketedPrice`. Subproject CO view now includes margin (was cost-only).
- **L1/L2/L3 — webhook hardening.** Event idempotency via `stripe_events`; seat-downgrade gap surfaced via `orgs.pending_seat_downgrade` + a Settings → Billing banner; defensive `current_period_end` reads so a Stripe API-version bump can't 500 the webhook. **Migration 054.**
- **L6 — build now enforces type safety.** Fixed 4 latent type errors; `next.config.js` `ignoreBuildErrors` flipped to **false** (TS errors now block the build; ESLint stays non-blocking); `tsconfig` target bumped es5 → es2020. `seed-demo*.sql` flagged unverified in-file.

### Billing + tiers (live)

- Stripe subscription billing: checkout + webhook (source of truth for `plan_status`) + Customer Portal. Adjustable seat quantity at checkout.
- Tier rebrand: **Profit $49 / Pro $99 / Pro+ $119** per seat (display names). Internal plan keys stay `starter | pro | pro-ai` — no data migration. `PLAN_LABELS` is what users see.
- Hardening: reuse Stripe customer by email + reuse open checkout session (no more duplicate customers/subscriptions); signup slug-collision retry.
- Klaviyo welcome sequence fires on activation (tier-aware via `profile.plan`).

### Composer + estimating

- Two-LF split (`qty_carcass` + `qty_doors`) — PR #100.
- Door pricing v2 with cascading type → material → finish slots.
- Composer staleness banner with bulk "Update to latest rates" + per-unit storage.
- Solid Wood Top product: full walkthrough, BdFt-scaled material + labor, edge-profile multipliers — PR #105.

### Schedule + capacity

- Schedule auto-seeds `department_allocations` on stage flip to production; timeline header dots + sticky capacity row — PR #96.
- Capacity calendar: 12-month strip with drag-drop, `project_month_allocations` source-of-truth, holidays/PTO via `capacity_overrides`, per-day flag strip, dept-stacked bars, auto-allocate from schedule blocks (`source = 'auto' | 'manual'`) — PRs #97, #102–#108.

### Sales + ops + onboarding

- Kanban delete; default departments seeded on signup; Settings dept active toggle; dashboard receivables card.
- Invoices: schema + list + create-from-milestone + react-pdf + payments + QuickBooks watcher.
- Welcome overlay (shop rate + base cabinet walkthroughs) gates first-run; post-onboarding routes to `/sales` (or `/projects` for the entry tier) — PR #111.

## Open / closed without merging

- **PR #109 — pipeline overlay (probability-weighted)** — closed without merging. Per-card weighting didn't model reality. Branch preserved if revived with better math.

## Active state

- Two beta testers signed up; Stripe billing is live (real payments).
- **Migration 054 is the most recent.** Production Supabase is in sync (apply each migration against prod before merging the PR that depends on it).
- **The Vercel build now blocks on TypeScript errors.** Run `npx tsc --noEmit` before pushing — a type error will fail the deploy instead of shipping silently.

## What's next (queue, no commitments)

### From Andrew's re-entry list (2026-05-31) — not yet started

- **"Software update available" system** after git pushes.
- **Turn on free trials** — now a small change: `app/api/checkout/route.ts` has a TODO to add `subscription_data.trial_period_days`, and the webhook already maps Stripe's `trialing` status to active. Decide trial length + card-required.
- **Tier test users + QA** — create accounts on each tier (Profit/Pro/Pro+) and run through against live Stripe checkout.
- **Website revamp** — more personable (lighter theme), SEO, pictures, About, more FAQ, tutorials.
- **YouTube walkthrough strategy** — idea list + recording plan.
- **Unique per-tier app footers.**

### Pricing follow-ups (deferred from M7, low-stakes)

- Reports *outlook* + AI shop-report use a single representative margin (fine for projections; not customer quotes).
- Projects-list margin badge shows an approximate legacy number (list query lacks cost data to compute a true blended margin).
- `target_margin_pct` / `profit_margin_pct` are now legacy fallbacks; a future migration can drop them once all read paths are confirmed off them.

### Backburner (pre-existing)

- Capacity hire/fire signal on the page header (reuses `lib/reports/outlookCalculations.ts`).
- Auto-place pipeline projects from `target_production_month` if a UI is added.
- "i" info tooltips; LED walkthrough; drawing parser improvements; invoice email integration; overdue invoice reminders; port API routes from `shop_rate_settings` to `orgs.overhead_inputs` jsonb.

## Known issues / debt

- DNS for `www.millsuite.com` has a stray non-Vercel A record (`66.33.60.66`) alongside Vercel's IP. Functionally fine; clean up next time you're in DNS.
- `seed-demo.sql` / `seed-demo-enhanced.sql` in `docs/` are unverified (flagged in-file) — review against current schema before relying on either.
- ~234 `as any` / `: any` usages across `lib`/`app`/`components`. Chip away opportunistically, especially in pricing/Stripe modules.
- `lib/stripe.ts` apiVersion is pinned to `2024-12-18.acacia` and cast to satisfy the newer SDK types. Bumping to a 2025 version is a deliberate, separately-tested change (the webhook's `periodEndISO` already reads period-end defensively for that day).

## Migration ledger

Most recent: `054_webhook_hardening.sql`.

- 050 — Stripe subscription columns on orgs
- 051 — pending_checkout_session_id on orgs
- 052 — per-bucket margins (labor / material / consumables) on orgs + projects
- 053 — create_org_with_owner() atomic signup function
- 054 — webhook hardening: stripe_events + orgs.pending_seat_downgrade

Run new migrations against production Supabase before merging the PR that depends on them.

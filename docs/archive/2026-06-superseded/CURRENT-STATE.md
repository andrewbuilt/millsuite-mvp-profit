# CURRENT-STATE.md

**Last updated:** 2026-06-17

Single source of truth for "what's shipped / what's open / what's next." This file is rewritten at the end of every work session (see the end-of-session ritual in `WORKFLOW.md`). If a fact here contradicts the code, the code wins — fix this file.

**Current position:** through commit `f93ecf5` on `main`. Latest migration: `056_plan_status_allow_trialing.sql`. An open hotfix branch `fix/trial-plan-status-constraint` (commit `6657b4e`) may not yet be merged to `main` — confirm with `git log --oneline -5 main` before relying on the trial-constraint fix.

---

## Shipped (recent, on main)

### Billing + tiers (the big June arc)
- **Three-tier rebrand → Profit / Pro / Pro+.** Internal plan keys stay `starter | pro | pro-ai` (no DB or Stripe-metadata migration); display names come from `PLAN_LABELS` in `lib/feature-flags.ts`. Per-seat: **Profit $49 (min 1 seat), Pro $99 (min 3), Pro+ $119 (min 5).** Feature access is cumulative.
- **Stripe subscription billing, end to end:** subscription foundation, adjustable seat quantity at Checkout, duplicate-subscription prevention, webhook idempotency, seat-downgrade banner, Stripe API-version guard. Billing is real now — signup is no longer free-by-default.
- **30-day no-card free trial on the Profit tier.** Advertised on `/pricing`; `orgs.plan_status` carries `trialing`; hotfix `056` allows `trialing` in the orgs check constraint.
- **Atomic org creation** via SQL function + session-derived identity (fixes signup race / slug collisions).
- **AI proxy routes now require auth + an active subscription** (security hardening, H1).

### Pricing / estimating correctness
- Per-bucket (bucketed) margins + margin-consistency fixes: project applies markup once at the end; subprojects are cost-only.
- Consumables default consistently 10% of material; pricing defaults seeded on signup.
- Project actuals recompute via the `/rollup` route (dead route removed).

### Platform / build hygiene
- Build now **blocks on TypeScript errors** (4 pre-existing errors fixed, target bumped, demo seeds flagged).
- Automatic "update available" banner on new deploys.
- Klaviyo welcome sequence wired.

### Earlier foundation (BUILD-ORDER Phases 0–8, all shipped & well-tested)
Rate book with confidence levels → keyboard-first subproject editor (freeform lines first-class) → parser-first sales dashboard → project rollup with variable milestones → sold handoff → preproduction approvals (finish specs + drawings, hard scheduling gate) → manual change orders → schedule + native time tracking (actuals vs. estimated). Capacity calendar (12-month, PTO/holidays, auto-allocate) and invoices (schema + PDF + payments + QuickBooks watcher) are live. See `BUILD-ORDER.md` for per-task detail.

---

## Active state

- **Solo build.** No other contributors in this repo. Work happens directly on `main` with frequent commits (see `WORKFLOW.md`). No PR/merge ceremony.
- Two beta testers signed up earlier; feedback flows through Andrew.
- **Major initiative in flight:** migrating all live project data from **Built OS → MillSuite**, after which Built OS is archived. Built OS is now frozen (read-only). See `../built-os/docs/DATA-MIGRATION-INVENTORY.md` and the migration epic in `BACKLOG.md`.

---

## What's next

The working queue lives in **`BACKLOG.md`** now (not here). Current focus:

1. **Build MillSuite out further** — close gaps surfaced by dogfooding/beta. See BACKLOG → "MillSuite build-out."
2. **Built OS → MillSuite data transfer** — the epic. See BACKLOG → "Data migration."
3. **Archive Built OS** once the transfer is verified.

---

## Known issues / debt

- Open hotfix branch `fix/trial-plan-status-constraint` — confirm it's merged to `main`.
- DNS for `www.millsuite.com` has a stray non-Vercel A record (`66.33.60.66`) alongside Vercel's IP. Functionally fine; clean up next time you're in DNS.
- `seed-demo.sql` / `seed-demo-enhanced.sql` in `docs/` are unverified against current schema — audit before use (flagged L6).
- `target_production_month` on `projects` exists but is unused (no UI to set it).
- `subprojects.labor_hours` is a legacy field — never read it. Hours come from `estimate_lines` via `computeSubprojectRollup` / `lib/project-hours.ts`.

---

## Migration ledger

Most recent: `056_plan_status_allow_trialing.sql`.
Recent billing arc: `050_stripe_subscriptions` → `051_pending_checkout_session` → `052_per_bucket_margins` → `053_create_org_with_owner` → `054_webhook_hardening` → `055_free_trial` → `056_plan_status_allow_trialing`.

Run new migrations against production Supabase before deploying the code that depends on them.

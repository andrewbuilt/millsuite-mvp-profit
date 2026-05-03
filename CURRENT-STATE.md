# CURRENT-STATE.md

**Last updated:** 2026-04-28

Single source of truth for "what's shipped / what's open / what's next." Update after every batch of merges.

## Shipped (recent, on main)

Through PR #111 + manual close on #110.

### Composer + estimating
- Two-LF split (`qty_carcass` + `qty_doors`) for runs where doors don't span the full carcass — PR #100.
- Door pricing v2 with cascading type → material → finish slots.
- Composer staleness banner with bulk "Update to latest rates" — and per-unit storage so the refresh doesn't multiply by qty.
- Solid Wood Top product (formerly the locked Countertop tile): full walkthrough with 14 screens, BdFt-scaled material + labor, edge-profile multipliers (hand / CNC), tile-click auto-opens walkthrough when uncalibrated, dedicated breakdown panel — PR #105.
- Pricing architecture: single source of margin truth (project applies markup once at the end; subprojects are cost only).

### Schedule + capacity
- Schedule auto-seeds department_allocations on stage flip to production.
- Schedule timeline header dots + sticky capacity row (per-week utilization at a glance) — PR #96.
- Capacity calendar foundation: 12-month year strip with drag-drop, project_month_allocations source-of-truth, hours sourced from estimate_lines via `loadProjectDeptHours`, Outlook chart on Reports honors won + production work — PRs #97, #103, #104.
- Capacity calendar: holidays + PTO via `capacity_overrides` table, monthly capacity math respects overrides, badges on month cards — PR #102.
- Capacity calendar visual polish: per-day flag strip, dept-stacked bar inside cards, project side pane with split / merge / refresh hours, refresh-hours-from-estimate button — PR #106.
- Capacity calendar auto-allocate: production projects auto-populate the calendar from their schedule blocks, manual placements win, source column `'auto' | 'manual'` — PRs #107, #108.

### Sales + ops
- Kanban delete affordance.
- Default departments seeded on signup.
- Settings active toggle for departments.
- Dashboard receivables card.
- Invoices: schema + list + create-from-milestone + react-pdf + payments + QuickBooks watcher.
- Auto-advance to production seeds department_allocations.

### Onboarding + tiers
- Welcome overlay (shop rate + base cabinet walkthroughs) gates first-run.
- Post-onboarding routes user to `/sales` (or `/projects` for Starter) — PR #111.
- Three-tier pricing: Starter $40 / Pro $75 / Pro+AI $100. `/pricing` page restored with three Sign Up CTAs that route to `/signup?plan=<key>`. Auth setup persists the plan — PR #110.
- Marketing pricing strip removed from MVP — PR #99.

## Open / closed without merging

- **PR #109 — pipeline overlay (probability-weighted)** — closed without merging. Per-card weighting didn't model reality (a 50/50 project either closes 100% or 0%, not "60 weighted hours"). Branch preserved if revived with better math.

## Active state

- Two beta testers signed up. Andrew is fielding their feedback in fresh sessions.
- Migration 049 is the most recent. Production Supabase is in sync (Andrew has been applying each migration as PRs land).

## What's next (queue, no commitments)

### High-priority candidates
- **Capacity PR-C-3 — hire/fire signal on the page header.** Without pipeline overlay (which got pulled), this is just based on sold + production work. "Need +1.2 headcount in Aug" type signal. Math reuses `lib/reports/outlookCalculations.ts`.
- **Beta tester bug reports** — handle as they come in, fresh chat per report.

### Backburner (pending priority)
- Tier billing productionization — Stripe checkout, real billing, trial periods. Today: signup is free, plan is set on signup, no payment.
- Auto-place pipeline projects from `target_production_month` if a UI is added to set it.
- Welcome sequence copy + UX polish.
- Demo / seeded report data cleanup.
- "i" info tooltips throughout the site.
- LED walkthrough.
- Drawing parser improvements.
- Improve project list (dashboard view).
- Invoice email integration.
- Overdue invoice reminders + auto status flip.
- Port API routes from `shop_rate_settings` to `orgs.overhead_inputs` jsonb.
- Staleness banner copy: distinguish "needs initial slots" from "rates moved."

## Known issues / debt

- DNS for `www.millsuite.com` has a stray non-Vercel A record (`66.33.60.66`) alongside Vercel's IP. Functionally fine — both routes serve current Vercel content — but worth cleaning up next time you're in DNS settings.
- `seed-demo.sql` and `seed-demo-enhanced.sql` in `docs/` are unverified — may reference legacy schema. Audit before relying on either.

## Migration ledger

Most recent: `049_pma_unique_per_month.sql`.

Run new migrations against production Supabase before merging the PR that depends on them.

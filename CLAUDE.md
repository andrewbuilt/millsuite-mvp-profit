# CLAUDE.md — context for Claude Code sessions

You are working on **MillSuite**, a Next.js + Supabase MVP for cabinet shop estimating, scheduling, invoicing, and project management. Andrew (the owner) drives all merges; you open PRs and verify them before declaring done.

## Read before starting work

In order, until you have what you need:

1. **`CURRENT-STATE.md`** — what's shipped, what's open, what's next. Most recent.
2. **`WORKFLOW.md`** — how Andrew + Cowork + Code actually work together. Read once per session.
3. **`SYSTEM-MAP.md`** — architecture and mental model. Stable.
4. **`BUILD-ORDER.md`** — phased roadmap with checkboxes. Stable, occasionally updated.
5. **`db/migrations/`** — numbered SQL migrations. Highest-numbered file is the latest schema state.
6. **`specs/`** — design specs for big features (composer, walkthroughs).
7. **`docs/prompts/`** — reusable prompt templates. When writing a fresh prompt, start from one of these.
8. **`docs/archive/`** — historical handoffs and audits. Reference only; do not cite as current spec.

If those don't answer your question, `git log --oneline -20` shows recent shipped work.

## Workflow ground rules

These are non-negotiable. Andrew has burned cycles on each one:

- **One PR at a time.** Don't bundle scope. Don't pile onto an open PR with unrelated changes.
- **Andrew merges. You don't self-merge** under any condition. If a PR has been open >24h with no feedback, ping rather than merge it yourself.
- **Verify with greps before declaring done.** Every PR description ends with the grep commands the spec asked for, plus their output, plus `git log --oneline -5 main` after merge. Type-check passing isn't enough — type-check proves it compiles, grep proves the feature is wired.
- **Look at the code, not memory.** If you're about to assert something about the codebase, read the file. Names and patterns change.
- **Schema migrations: pair `CREATE TABLE IF NOT EXISTS` with explicit `ALTER TABLE ADD COLUMN IF NOT EXISTS` for every column**, and finish with `NOTIFY pgrst, 'reload schema'`. Half-baked previous runs have caused PGRST204 cache misses repeatedly.
- **After merging anything to main, paste `git log --oneline -5` so we both see the same state.** This single check has caught regressions multiple times.
- **Run new migrations against prod Supabase before merging the PR that depends on them.** Vercel deploys in seconds; don't ship a deploy that 500s for an hour while you go find the SQL editor.
- **Update `CURRENT-STATE.md`** when you ship something user-visible. Single most-skipped step; the one that keeps the next session sharp.

## Architecture quick-reference

- **Auth:** Supabase Auth → `public.users` row keyed by `auth_user_id`. Org membership via `users.org_id`.
- **Plans / tiers:** `orgs.plan` ∈ `{starter, pro, pro-ai}`. Gating via `hasAccess(plan, feature)` from `lib/feature-flags.ts`. Three-tier signup at `/pricing`.
- **Pricing model:** estimates live in `estimate_lines`. Composer lines store `product_key` + `product_slots` jsonb. Per-unit storage (`dept_hour_overrides`, `lump_cost_override`) — whole-line totals are derived live in `computeSubprojectRollup`.
- **Walkthroughs:** dedicated calibration flows for shop rate, base cabinet, doors, finish, solid wood top. Stored in dedicated tables or jsonb on orgs.
- **Schedule:** `department_allocations` with `scheduled_date` + `scheduled_days` per (subproject × dept). Auto-seeded on stage flip to production via `lib/schedule-seed.ts`.
- **Capacity calendar:** `project_month_allocations` aggregates schedule into months. Auto-derived from `department_allocations` via `lib/capacity-seed.ts`. Manual drag-drop wins (`source = 'manual'`).
- **PTO + holidays:** `capacity_overrides` table, surfaced on the capacity calendar with badges + per-day strip.
- **Invoices:** schema + PDF + payments + QuickBooks watcher. Milestone status mirrors invoice status when linked.

## Where things live

```
app/(marketing)/        Public pages: /, /pricing, /signup, /login
app/(app)/              Authed app: /dashboard, /sales, /projects, /schedule, /capacity, /invoices, /settings, /reports, /team, /rate-book
app/api/                Server routes
components/             Shared UI
components/composer/    Add-line composer
components/walkthroughs/ Calibration flows
lib/                    Pure logic — pricing math, rate book loaders, schedule engine
db/migrations/          Numbered SQL migrations (001 → ...)
specs/                  Design specs (composer, walkthroughs)
docs/prompts/           Reusable Code prompt templates
docs/archive/           Quarantined historical docs
```

## Common pitfalls

- The composer compute path `breakdown.hoursByDept` is the canonical flat shape. Other compute paths (countertop, future products) must populate it AND any namespaced shapes — don't fragment.
- `subprojects.labor_hours` is a legacy field. Never read it. Hours come from `estimate_lines` via `computeSubprojectRollup` or `lib/project-hours.ts`.
- `target_production_month` exists on `projects` but is currently unused. If you wire it up, also surface a UI to set it.
- Trial plan label (`'trial'`) used to exist; it's been removed. Default plan on signup is `'starter'`. Old trial rows fall through to starter via `normalizePlan`.

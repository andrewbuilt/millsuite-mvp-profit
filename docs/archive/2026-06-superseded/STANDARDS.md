# STANDARDS.md — building standards & best practices

How we build MillSuite. `WORKFLOW.md` is the loop (what to do when); this file is the bar (how the work itself must be done). Any agent or human writing code in this repo follows these. When a standard here conflicts with something in an older doc, this file wins.

---

## The non-negotiables

These have each cost real time at least once.

1. **Look at the code, not memory.** Before asserting anything about the codebase — a function name, a field, a compute path — open the file and read it. Names and patterns drift. A wrong assumption stated confidently is worse than a quick grep.
2. **Verify with greps, not just type-check.** Type-check proves it compiles. Grep proves the feature is actually wired. Every meaningful change ends with the grep/command output that demonstrates the thing exists and is connected.
3. **One change at a time.** Keep each commit a single coherent thing. Don't bundle an unrelated refactor into a feature commit. Small commits are the undo button (see `WORKFLOW.md`).
4. **Don't sell what's not built.** No feature flags, nav links, or pricing copy for things that don't have working UI behind them.
5. **Update `CURRENT-STATE.md` at the end of every session that shipped something user-visible.** This is the single most-skipped step and the one that keeps the next session sharp.

---

## Schema migrations (Supabase)

Migrations live in `db/migrations/`, numbered sequentially (`001 → ...`). The highest number is the current schema state.

- **Idempotent always.** Pair `CREATE TABLE IF NOT EXISTS` with explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for *every* column. Half-baked previous runs have repeatedly caused PGRST204 schema-cache misses.
- **End every migration with `NOTIFY pgrst, 'reload schema';`** so PostgREST picks up the change.
- **Run the migration against production Supabase _before_ deploying the code that depends on it.** Vercel deploys in seconds; a deploy that 500s because the column doesn't exist yet is self-inflicted.
- **One migration per schema change**, named for what it does (`054_webhook_hardening.sql`). Don't retro-edit a migration that's already been applied to prod — write a new one.
- **Record the new top migration number in `CURRENT-STATE.md`'s migration ledger.**

---

## Pricing / estimating correctness (the part that must never drift)

This is the core of the product. Get it wrong and every estimate is wrong.

- **Estimates live in `estimate_lines`.** Composer lines store `product_key` + `product_slots` jsonb. Per-unit storage (`dept_hour_overrides`, `lump_cost_override`, etc.) — whole-line totals are derived **live** in `computeSubprojectRollup`, never persisted as a multiplied total.
- **Margin is applied once, at the project level.** Subprojects are cost-only. There is a single source of margin truth — do not re-apply markup at the line or subproject level.
- **`breakdown.hoursByDept` is the canonical flat hours shape.** Any new compute path (countertop, future products) must populate it AND any namespaced shapes. Don't fragment the hours model.
- **Never read `subprojects.labor_hours`** — it's legacy. Hours come from `estimate_lines` via `computeSubprojectRollup` or `lib/project-hours.ts`.
- **Consumables default to 10% of material.** Keep it consistent across seed, compute, and display.

---

## Feature gating / tiers

- Plan keys are `starter | pro | pro-ai` (stable DB/Stripe identifiers). **Display names** (`Profit / Pro / Pro+`) come only from `PLAN_LABELS` in `lib/feature-flags.ts` — never hardcode a display name elsewhere.
- Gate every premium surface with `hasAccess(plan, feature)`. Features are cumulative up the tiers.
- Pricing/seat numbers live in `lib/feature-flags.ts` (`PLAN_SEAT_PRICE`, `PLAN_SEAT_MINIMUM`, `PLAN_LIMITS`). Change them there, not inline.

---

## Code conventions

- **TypeScript build blocks on errors.** Don't merge with TS errors; don't reintroduce `ignoreBuildErrors`.
- **`@/*` path alias** maps to the repo root — use it instead of long relative imports.
- **`lib/` is pure logic.** Pricing math, rate-book loaders, schedule/capacity engines, project hours. No React, no direct request handling. UI calls into `lib/`; `lib/` doesn't reach back up.
- **Server routes** live in `app/api/`. Marketing pages under `app/(marketing)/`, authed app under `app/(app)/`.
- **Read the SQL view, not a hand-rolled re-derivation.** Gates like `subproject_approval_status.ready_for_scheduling` are computed in SQL — surface them, don't recompute the logic in TS.

---

## Testing / verification rhythm

- **No automated test framework is configured.** Verification is grep + smoke test in dev.
- **Test at intervals, not at the end.** Run the app and exercise the touched surface after each meaningful chunk — not after a two-hour stretch.
- **Smoke-test anything user-facing** before considering it done: load the page, do the action, watch the network tab for 500s.
- **Commit before anything risky** (a refactor, a migration, the data transfer) so there's a clean revert point.

---

## Documentation discipline

- `CURRENT-STATE.md` — rewritten each session; the live status digest.
- `BACKLOG.md` — the running list of everything still to do; groomed as priorities shift.
- `BUILD-ORDER.md` — the phased roadmap; check boxes as phases close, otherwise stable.
- `SYSTEM-MAP.md` — architecture model; update when the architecture actually changes.
- **Archive, don't delete.** When a doc is fully implemented, superseded, or >30 days stale and unreferenced, move it to `docs/archive/`. The design trail is occasionally useful for "why did we decide X?" — but only when quarantined so nobody mistakes it for current spec.

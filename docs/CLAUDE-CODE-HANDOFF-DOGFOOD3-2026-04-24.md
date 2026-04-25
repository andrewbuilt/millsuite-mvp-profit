# Claude Code handoff — dogfood round 3 (April 2026)

**Date:** 2026-04-24
**Context:** Third pass dogfood surfaced four more issues (13–16). This handoff covers 13, 14, and 15. Issue 16 (Create invoice as standalone, no-QB feature) is deferred for a dedicated spec — Andrew wants the full flow, not a thin shim.
**Supersedes nothing.** Prior handoffs (`CLAUDE-CODE-HANDOFF-2026-04-24.md`, `-DOGFOOD-`, `-DOGFOOD2-`) remain authoritative.

---

## Execution order

1. **Issue 15** — delete the relic Selected-line side pane on the subproject page (smallest, highest signal — a stale UX surface that contradicts the new architecture)
2. **Issue 13a** — drop $75 shop-rate default + walkthrough completion copy (fast, dogfood-blocking confusion)
3. **Issue 17** — install-rate fallback inconsistency + Labor row mislabel (lands with 13a — same conceptual cleanup)
4. **Issue 13b** — rebuild Settings page on the new JSON model (bigger, makes the walkthrough's data persistent + editable)
5. **Issue 14** — change-order entry from a line in the subproject editor

Bundle 15 + 13a + 17 as PR `dogfood3-relic-cleanup-and-shop-rate-defaults`. 13b as its own PR `dogfood3-settings-rebuild`. 14 as its own PR `dogfood3-co-from-line`.

---

## Issue 15 — delete the relic Selected-line side pane

**File:** `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`

**What's wrong.** Clicking a line in the line table opens a side pane with editable inputs — HOURS BY DEPT, FINISH SPECS, INSTALL PRICING, NOTES, WHAT'S IN THIS LINE'S PRICE. This is from the old architecture that the new subproject pricing system + AddLineComposer replaced. It's a relic that didn't get cleaned up. Andrew confirmed: "it's not even relevant" — the project shown was in production and this pane offered to change hours / LF / add finish specs, which makes no sense at any stage in the new model.

**Fix.** Delete the side pane entirely.

1. Remove the `selectedLineId` state + `setSelectedLineId` setter.
2. Remove the line-row `onClick` that toggles selection (line ~680). Drop the `selected ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'` highlight state — leave just the hover.
3. Remove the entire side-pane JSX block (the column that renders SELECTED LINE / DESCRIPTION / UNIT / PRICE / UNIT / HOURS BY DEPT / FINISH SPECS / INSTALL PRICING / NOTES / WHAT'S IN THIS LINE'S PRICE).
4. Adjust the page's grid/flex layout so the line table + bottom subtotal bar take full width. Right column goes away on this page.
5. Delete any imports + helper functions that only the side pane used. Run a quick grep for orphaned references — `cursor-pointer transition-colors` on the row class can probably go too.

**Don't** add a replacement side pane in this PR. If Andrew later wants a read-only line-detail tooltip or an "edit line" button that opens AddLineComposer in edit mode, that's a separate feature. V1 = the line table is the surface; clicking a line does nothing.

**Don't** touch the AddLineComposer. It stays as the only line-edit surface.

**Verify.** On any subproject (any stage), click a line. Nothing happens beyond the hover style. Page renders single-column with the line table + subtotal bar; no right column. Linter / TS clean.

---

## Issue 13a — drop $75 shop-rate default + walkthrough completion copy

### 13a.1 — drop the $75 default

**Files:** `docs/migration.sql`, plus eleven app-side fallback sites (grep `|| 75` and `?? 75`).

**What's wrong.** `docs/migration.sql:12` declares `shop_rate DECIMAL DEFAULT 75`. Every new org boots with $75/hr. The walkthrough then asks the user to "override the current $75 rate," which is confusing because the user never set $75 — the schema did. App-side, there are eleven `org?.shop_rate || 75` and `org?.shop_rate ?? 75` fallbacks (in `app/(app)/dashboard/page.tsx`, `app/(app)/projects/[id]/page.tsx`, `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`, `app/(app)/projects/[id]/handoff/page.tsx`, `app/(app)/projects/[id]/pre-production/page.tsx`, `app/api/project-outcome/route.ts`, `app/api/shop-report/route.ts`, `app/api/weekly-snapshot/route.ts`, `lib/financial-engine.ts`, `lib/project-rollup.ts`). These mask the NULL state and silently produce $75-backed pricing for any org that hasn't completed the walkthrough.

**Fix.**

1. **Migration.** New file `db/migrations/028_drop_shop_rate_default.sql`:

```sql
BEGIN;

ALTER TABLE public.orgs
  ALTER COLUMN shop_rate DROP DEFAULT;

-- Reset existing orgs that still hold the legacy $75 default AND haven't
-- completed the walkthrough yet (no overhead_inputs filled in). Anyone who
-- intentionally set $75 will still have overhead_inputs from the walkthrough
-- and will be left alone.
UPDATE public.orgs
   SET shop_rate = NULL
 WHERE shop_rate = 75
   AND overhead_inputs IS NULL
   AND team_members    IS NULL
   AND billable_hours_inputs IS NULL;

COMMIT;

-- DOWN reference:
--   BEGIN;
--   ALTER TABLE public.orgs ALTER COLUMN shop_rate SET DEFAULT 75;
--   COMMIT;
```

2. **App-side fallbacks.** Replace every `org?.shop_rate || 75` and `org?.shop_rate ?? 75` with `org?.shop_rate ?? null`. Where the value is then used in math, branch on null:
   - In display contexts: render `—` or `Not configured · run setup` with a link to the walkthrough or the Settings page (post-13b).
   - In compute contexts (project rollup, line breakdown, install prefill, financial engine): treat as 0 and surface a "shop rate not yet set" banner on the page — don't silently produce numbers from a phantom rate.

3. **Walkthrough save screen.** Find the "override the current $X rate" prompt (in the shop-rate walkthrough's result/save screen). Replace with: "Save this as your shop rate." No reference to overriding, no current-value comparison. The walkthrough is the FIRST place a rate gets set on a fresh org.

### 13a.2 — completion copy on walkthrough

**File:** the shop-rate walkthrough's result screen component.

Add the following copy block on the result screen, below the derived rate, above the Save CTA:

> **This is your baseline rate.** You need to charge at least this much to keep the lights on. Profit margin is added at the project level, and a default margin can be saved in settings.

Keep the existing per-team-member / overhead breakdown that the result screen shows above the rate. Just add the explainer between the rate and the Save button. Light-text muted style, two short sentences, no bullets.

### Verify

Fresh org via `signup → marketing → app/dashboard`:
1. Dashboard / project pages render `Shop rate: —` or "not yet configured" CTA. No phantom $75.
2. Walkthrough opens. Result screen shows the derived rate, the new copy block, and a "Save this as your shop rate" button (no "override $75" language).
3. After save, `select shop_rate from orgs where id = '<org>'` returns the derived value. App pages use it everywhere.
4. Existing orgs that completed the walkthrough at $75: `shop_rate = 75` AND `overhead_inputs IS NOT NULL` — left alone by the migration.

---

## Issue 17 — install-rate fallback inconsistency + Labor row mislabel

Two stacked bugs Andrew surfaced from a dogfood pass after dogfood2 shipped. Both hinge on the same area as 13a — land them in the same PR.

### 17a — install rate fallback mismatch between subproject and project pages

**Files:**
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` (line 857)
- `app/(app)/projects/[id]/page.tsx` (line 219)

**What's wrong.** Two views read different fallbacks for `org.shop_rate` when the column is NULL:

```tsx
// subproject page line 857
installRatePerHour={org?.shop_rate || 0}

// project page line 219
const shopRate = org?.shop_rate || 75
```

So on a fresh org with `shop_rate IS NULL`:
- Subproject install prefill panel shows `Guys × days × $0.00/hr × ...` and `INSTALL COST: $0`
- Project rollup computes install at $75/hr (`10 × 10 × 8 × 75 = $60,000` cost), then markup-applies → BREAKDOWN says `Install: $92,308`

Same prefill values, two completely different numbers. Andrew's reaction: "no idea what is happening."

**Fix.** This is fully resolved by 13a (drop ALL `|| 75` and `|| 0` fallbacks → use `?? null`, branch on null in compute and display). Nothing extra here — just verify after 13a's edits both paths read from the same source and produce the same answer (NULL → "shop rate not configured" banner; non-null → consistent install $ on both pages). Audit checklist:

```bash
# After your 13a sweep, this should return zero hits:
grep -rn 'shop_rate \(||\|??\) \(0\|75\)' app/ lib/ components/
```

### 17b — Labor row hours include install but the $ doesn't

**Files:**
- `app/(app)/projects/[id]/page.tsx` (project rollup memo, ~lines 385-438)
- BREAKDOWN row JSX (Labor row + Install row)

**What's wrong.** From the dogfood2 wiring I asked you for, install prefill hours flow into BOTH `acc.hoursByDept.install` AND `acc.totalHours`. But install $ stays in `acc.installCost`, and the BREAKDOWN's Labor row reads `totalHours` for the hours figure and `laborCost` (line-driven only) for the $ figure. Result: `Labor: 800.0h est $0` — which reads as "you're working 800 hours for free."

That instruction in dogfood2 was wrong. Install hours belong on the Install row, not the Labor row.

**Fix.**

1. **Project rollup.** In the `proj: ProjectRollup` useMemo (~line 406+), revert the `acc.totalHours += installPrefillHours` line. Install hours land ONLY in `acc.hoursByDept.install`:

```ts
// keep:
acc.hoursByDept.install += rollup.hoursByDept.install + installPrefillHours

// REMOVE the install-hours contribution from totalHours:
// (was) acc.totalHours += rollup.totalHours + installPrefillHours
acc.totalHours    += rollup.totalHours
```

`totalHours` then reflects only line-driven labor hours. `hoursByDept.install` carries install hours separately.

2. **BREAKDOWN render.** Update the Install row to display both its hours AND its $:

```tsx
<BreakdownRow
  label="Install"
  hours={proj.hoursByDept.install}     // NEW — surface the install hours here
  value={money(proj.installCost)}
/>
```

If `BreakdownRow` doesn't currently take an `hours` prop (Material/Consumables/Specialty hardware/Options don't have hours), add one as optional. Render `${hours.toFixed(1)}h · ${value}` when present, just `value` when absent. Labor row continues to render `${totalHours.toFixed(1)}h est ${laborCost}` as today — but with the correct (line-only) hours number.

### Verify

Same scenario as Andrew's screenshot:
- Org with `shop_rate IS NULL`.
- Subproject with install prefill `guys=10, days=10, complexity=0%`, zero estimate lines.

Expected after 17a + 17b + 13a all applied:
- Subproject install prefill: shows a "Shop rate not configured" banner with a CTA, install cost displayed as "—" or "set rate to compute."
- Project BREAKDOWN: Labor row `0.0h est $0` (no lines, no labor). Install row `— h · —` (rate not set). Project total = $0 (or whatever margin × 0 produces).

After the user runs the walkthrough and `shop_rate = $100`:
- Subproject install prefill: `Guys × days × $100.00/hr × (1 + 0%)` → `INSTALL COST: $8,000` (10×10×8×100). Subproject HARDWARE/INSTALL row: `$8,000`.
- Project BREAKDOWN: Labor `0.0h est $0`. Install `800.0h · $12,308` (= $8,000 × 1.5385 markup). Project total $12,308.

Both views agree, hours are surfaced where the $ live, no mystery.

---

## Issue 13b — rebuild Settings page on new JSON model

**Files:** `app/(app)/settings/page.tsx`, plus a small one-time backfill helper.

**What's wrong.** The walkthrough writes `orgs.overhead_inputs` / `team_members` / `billable_hours_inputs` (jsonb columns added in migration 022). The existing Settings page (gear icon in nav) reads/writes the legacy `shop_rate_settings` table + `users` table for comp + billable. Two parallel data models for the same conceptual data. The walkthrough's data therefore "disappears after completion" because the Settings page can't see it.

Andrew's expectation: the walkthrough fills out the persistent edit surfaces (Settings + Team page), and the data stays there for ongoing maintenance.

**Fix — Settings page is the persistent surface for shop-rate inputs.**

The existing Settings page UI is roughly the right shape (overhead categories, team comp list, billable hours, derived rate). Rebuild it on top of the new JSON model so it reads/writes the same columns the walkthrough does.

### Storage migration

`shop_rate_settings` table goes away (eventually — drop in a follow-up migration after this PR ships and we've verified all reads moved). For this PR:

1. Stop reading from `shop_rate_settings`. All reads come from `orgs.overhead_inputs` / `team_members` / `billable_hours_inputs`.
2. Stop reading `users.hourly_cost` / `users.is_billable` for shop-rate purposes — those columns belong to the Team page's app-user / scheduling concerns, not shop-rate math. Settings page reads team comp + billable from `orgs.team_members` jsonb.
3. One-time backfill on Settings page first load: if `orgs.overhead_inputs IS NULL` AND a `shop_rate_settings` row exists, copy the legacy values into the new jsonb shape and write to orgs. Subsequent loads come straight from orgs.

### UI

Match the walkthrough's structure so the user recognizes it:

- **Overhead** — list of `{category, amount, period: 'monthly' | 'annual'}`. Add/remove/edit rows. Persists to `orgs.overhead_inputs`.
- **Team & comp** — list of `{id, name, annual_comp, billable}`. Add/remove/edit rows. The `billable` flag matches what the walkthrough writes; only billable rows count toward `total_team_comp`. Persists to `orgs.team_members`.
- **Billable hours** — three inputs `{hrs_per_week, weeks_per_year, utilization_pct}`. Persists to `orgs.billable_hours_inputs`.
- **Derived rate** — the live computed shop rate, recomputed every time any input changes. A "Save as my shop rate" button writes to `orgs.shop_rate`. (Save can also be debounced auto-save — operator preference.)
- **Default project margin** — single number input. Persists to `orgs.profit_margin_pct`. Used as the default for `projects.target_margin_pct` (see Issue 12).
- **Consumable markup** — keep the existing field. Persists to `orgs.consumable_markup_pct`.
- **Business info** — keep as-is.

Drop the "Owner billable" / "Owner salary" fields — those move into the Team list as a normal team member (Andrew's call from the prior round: admin headcount goes to Team with billable: false; admin pure-$ goes to Overhead).

### Walkthrough integration

The walkthrough already writes to the new jsonb columns. After this PR, the Settings page is where the user edits the same data afterward. No changes to the walkthrough save path — just verify `select * from orgs where id = '<org>'` shows non-null `overhead_inputs` / `team_members` / `billable_hours_inputs` after walkthrough completes, and the Settings page renders those values on next visit.

### Team page stays as-is

`app/(app)/team/page.tsx` is for departments + app users + dept assignment (scheduling concern, not shop-rate concern). Don't touch it in this PR. The data model split:

- `users` table → app users (auth, role, scheduling assignment)
- `departments` + `department_members` → time-tracking categorization
- `orgs.team_members` jsonb → comp + billable for shop-rate denominator math

These are conceptually different things even though they overlap in real life ("a person"). V1 keeps them separate. V2 may unify; not in scope.

### Verify

1. Fresh org runs walkthrough → completes. Visit `/settings`. Overhead categories, team comp, billable hours, derived rate all render with the values entered in the walkthrough.
2. Edit a team member's comp on the Settings page → save. Reload. Value persists. Derived rate updates accordingly.
3. Org that has a legacy `shop_rate_settings` row (existing orgs from before walkthrough): visit `/settings`. Backfill runs once, jsonb columns get populated from legacy data. Subsequent edits go to jsonb only.
4. `app/(app)/team/page.tsx` still renders departments + users; no change to Team page UX.

---

## Issue 14 — change-order entry from a line in the subproject editor

**Files:**
- `components/change-orders.tsx` (modal, prefill prop)
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` (line-row "Create CO" affordance)

**What's wrong.** Current flow: top-level "+ New CO" button opens a modal that requires Title + Subproject picker + manual entry of original Label / Material / LF / $/LF. Operator types blind — there's nowhere to reference what the line actually is. Title field feels redundant to the (label, original material → proposed material) summary.

Andrew picked Option B: CO process starts FROM a line in the subproject editor. Original side fully prefilled from the line; modal collapses to just the proposed-side delta.

### Subproject editor — "Create CO" affordance on each line

In the line table on the subproject page, add a new control on each row. Visually unobtrusive — small icon or "CO" link in a row-end cell next to the existing trash icon, or surfaced on row hover. On click:

```ts
function handleCreateCoFromLine(line: SubprojectLine) {
  setCoModalSeed({
    subprojectId,
    originalLabel:        line.description || rateBookItemFor(line.rate_book_item_id)?.name || '',
    originalMaterial:     line.material || rateBookItemFor(line.rate_book_item_id)?.material || '',
    originalLinearFeet:   Number(line.quantity) || 0,
    originalMatCostPerLf: line.material_cost_per_lf ?? null,
  })
  setCoModalOpen(true)
}
```

Pull the seed values from whatever the line table displays today — the same fields shown in the existing line summary. If a field isn't represented on the line (some lines won't have material_cost_per_lf), leave it null and let the operator fill the proposed side from scratch.

Whether you implement this as a row-hover action button, a row context menu, or a small "+" icon in the trash cell — pick the cleanest fit; this is UX glue.

### Modal — accept a seed prop

Update `CreateCoModal` (currently in `components/change-orders.tsx` line 608+) to accept a `seed` prop:

```ts
interface CreateCoModalSeed {
  subprojectId: string
  originalLabel: string
  originalMaterial: string
  originalLinearFeet: number
  originalMatCostPerLf: number | null
}

interface CreateCoModalProps {
  // ... existing props
  seed?: CreateCoModalSeed | null
}
```

When `seed` is non-null:

1. **Drop the Title field as required.** Use a derived title like `"${seed.originalLabel} — material change"` as a placeholder, but accept empty title — the (original-label, original-material → proposed-material) summary on the change-order detail card is enough context. Operators can fill in title for unusual COs but it shouldn't gate save.
2. **Move Subproject to the top.** When seeded, lock it to `seed.subprojectId` and render as a read-only label ("Subproject: Primary Closet") rather than a select. (When unseeded — i.e., the legacy "+ New CO" button still exists — render the picker as today.)
3. **Prefill original side.** `origLabel`, `origMaterial`, `origLF`, `origMatCostLF` initial state = seed values. Operator can still edit if the line was wrong.
4. **Focus on proposed side.** Autofocus the proposed material input so the operator's first action is "what are we changing it to."

### Top-level "+ New CO" button

Decision: keep it for the case where a CO doesn't map to a single line (project-level COs, scope additions, etc.) but de-emphasize it. The modal opened with `seed = null` reverts to current behavior — Title required, subproject picker, blank original/proposed. Document this as the fallback path; primary path is line-row → CO.

### Schema

No schema change needed. `change_orders` already stores `subproject_id`, `original_line_snapshot`, `proposed_line`, `title`. Title becomes optional in the UI but stays a column (legacy COs without a seeded line might still want a custom title).

### Verify

1. Subproject editor with 3 lines: each row shows a "Create CO" affordance. Click it on line 2.
2. Modal opens with subproject locked to the current subproject (no picker), original side filled with line 2's label/material/LF/$/LF, proposed material input autofocused.
3. Type a proposed material → "Create as draft." CO saves with `subproject_id = <current>`, `original_line_snapshot` = seeded values, `proposed_line` = proposed values.
4. Top-level "+ New CO" button still opens the legacy modal with picker + blank fields.

---

## Invariants that must still hold

Same as before, plus:

- **Settings page reads from JSON columns on `orgs`.** Not `shop_rate_settings`.
- **Selected-line side pane on subproject page is gone.** Don't reintroduce it.
- **Shop rate is NULL until the walkthrough completes.** No fallback to $75 OR $0 anywhere — every reader uses `?? null` and branches.
- **Install hours live in `hoursByDept.install` only.** Don't add them to `totalHours`. They surface on the Install BREAKDOWN row, not the Labor row.
- **CO from a line is the primary entry point.** Top-level "+ New CO" button is a fallback.

---

## When you're done

Update `BUILD-ORDER.md` Phase 12 close-out notes with PR refs. Don't cut the close-out commit — Andrew's. Issues 15 + 13a as one PR (small), 13b as its own (medium), 14 as its own (small-medium).

Issue 16 (Create invoice) is deferred for a dedicated spec — Andrew wants the full invoicing feature, not a thin shim. Don't start that one without a spec doc.

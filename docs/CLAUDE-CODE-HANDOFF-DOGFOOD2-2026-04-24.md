# Claude Code handoff — dogfood round 2 (April 2026)

**Date:** 2026-04-24
**Context:** Second pass through the composer surfaced four more issues (9–12). Landing order: after Issue 4 (BaseCab → Slab door_style seed) merges, then this handoff.
**Supersedes nothing.** `docs/CLAUDE-CODE-HANDOFF-2026-04-24.md` and `docs/CLAUDE-CODE-HANDOFF-DOGFOOD-2026-04-24.md` remain authoritative for their scopes.

---

## Execution order

1. **Issue 9** — right-card top alignment (subproject + composer)
2. **Issue 10** — move Install prefill below the line list
3. **Issue 11** — install prefill rollup into project total (hours + $)
4. **Issue 12** — project-level margin modifier (single knob, applied uniformly)

Issues 9 + 10 bundle as one PR (`dogfood2-layout`). Issues 11 + 12 bundle as one PR (`dogfood2-margin-rollup`) since they both touch the project rollup.

---

## Issue 9 — right-card top alignment

**Files:**
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` (subproject page)
- `components/composer/AddLineComposer.tsx` (composer view)

**What's wrong.** On both pages, left column content is bare (heading + metadata, no card) while right column is a bordered/padded card. Right card's outer border roughly aligns with the top of left heading, but the card's internal padding shifts its contents down visually. Andrew's call: leave the headers as they are (no matching card on the left) — just shift the right card up so its TOP EDGE aligns with the TOP of the left heading text.

**Fix.** Remove whatever top margin the right card is getting from flex/grid gap + card top padding, so the card's top border sits at exactly the heading's text baseline top. In practice this usually means:

- If the two columns are inside a `flex items-start` container: the right card needs `mt-0` and its outer wrapper can't have the column's gap padding on top.
- If they're in a grid with `gap-y-*`: the grid gap adds space above both columns; collapse it with a negative `mt-` on the right card equal to the gap, or move the gap into the inner content only.

Eyeball the subproject page first — "Kitchen cab" heading top should sit at the same Y as the right "LINE DETAIL" card's top border. Repeat for the composer's "Base cabinet run" heading vs "LINE BREAKDOWN" card.

**Don't** wrap the left headings in cards. Don't add backgrounds. The pages keep the asymmetric chrome — only the top Y coordinates need to match.

**Verify.** Pixel-check in a browser: draw a horizontal line at the top of the left heading; the right card's top border should land on that same line ±2px.

---

## Issue 10 — move Install prefill below the line list

**File:** `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`

**What's wrong.** Install prefill block sits above the shortcuts legend + line table. Scope (cabinet lines) should come first; install is a secondary concern tacked on after.

**Fix.** In the subproject page's JSX, move the Install prefill JSX block to sit BELOW the "+ Add line — type to search…" freeform input (currently near the bottom). Order should be:

1. Heading ("Kitchen cab", N lines, etc.)
2. Actions row ("Clone from past", "+ Compose line")
3. Shortcuts legend
4. Line table
5. "+ Add line — type to search…" input
6. **Install prefill block** ← new home
7. Subproject bottom subtotal bar (unchanged)

No logic changes. Pure JSX reorder + whatever vertical spacing tweaks are needed so the prefill breathes between the line input and the subtotal bar.

**Verify.** Fresh subproject with no lines: line input is the first interactive element below the heading; install prefill follows it; subtotal bar at the bottom.

---

## Issue 11 — install prefill rollup into project total

**Files:**
- `app/(app)/projects/[id]/page.tsx` (project rollup)
- `lib/install-prefill.ts` (already has `computeInstallHours` — reuse)

**What's wrong.** Symptom: a subproject with a $29,937 install prefill causes the project card to display $29,937 total and "+ $29,937 install," but the project BREAKDOWN panel shows `Labor 0.0h est $0` AND `Install (subproject) $0`. Neither the hours nor the $ from a regular-subproject install prefill flow into the project breakdown display.

**Two separate plumbing gaps:**

### 11a — install hours never summed

`page.tsx` lines 385–438 (the `proj: ProjectRollup` useMemo) sums `rollup.hoursByDept.install` from each subproject but never adds install-prefill hours. `lib/install-prefill.ts` already exports `computeInstallHours` (lines 57–62) — it's just not called anywhere in the project rollup.

**Fix.** In `page.tsx`, alongside the existing `installPrefillCost` computation (around line 297), compute the hours:

```ts
import { computeInstallCost, computeInstallHours } from '@/lib/install-prefill'

// ...where installPrefillCost is computed per sub:
const installPrefill = {
  guys: sub.install_guys,
  days: sub.install_days,
  complexityPct: sub.install_complexity_pct,
}
const installPrefillCost = computeInstallCost(installPrefill, installRatePerHour)
const installPrefillHours = computeInstallHours(installPrefill)
```

Pass both on the card object; in the rollup reducer (around line 406), add:

```ts
acc.hoursByDept.install += rollup.hoursByDept.install + installPrefillHours
acc.totalHours        += rollup.totalHours        + installPrefillHours
```

Leave `rollup.hoursByDept.install` addition in place for subprojects that accumulate install hours via their own lines — prefill hours are additive on top.

### 11b — breakdown display shows $0 "Install (subproject)" despite a real install prefill

`page.tsx` line 860:

```tsx
label="Install (subproject)"
value={money(proj.installSubprojectTotal)}
```

`proj.installSubprojectTotal` (line 422) only accumulates `isInstallSub(sub)` subprojects — dedicated install-type subs, not install prefills on cabinet subs. But `proj.installCost` (line 418) already sums `rollup.installCost + installPrefillCost` across all subs — that's the right number to display.

**Fix.** Change line 859–860 to display `proj.installCost` under a simpler "Install" label:

```tsx
label="Install"
value={money(proj.installCost)}
```

Drop the "(subproject)" qualifier — it was confusing (suggested a specific subproject type). `proj.installSubprojectTotal` can stay in the ProjectRollup interface for now — something downstream might read it, or we delete it in a follow-up.

### Complexity markup semantics — leave alone

Current install formula: `guys × days × 8 × rate × (1 + complexity%)` — complexity% multiplies $, not hours. Arguably complexity SHOULD scale hours (elevator access = real time added), but don't touch that here. Flag it as a follow-up: `computeInstallHours` currently returns `guys × days × 8` without complexity, so reported hours underestimate true on-site time if complexity is non-zero. Worth a separate ticket; not in this PR's scope.

### Shop-rate display rounding

The install prefill block shows `"Guys × days × $203.375/hr × (1 + complexity%)"`. Three decimal places — not rounded for display. While you're in this code, round to 2 decimals in the formula copy:

```tsx
// wherever the formula string is built:
`$${(installRatePerHour).toFixed(2)}/hr`
```

Or round to nearest dollar if Andrew prefers — match whatever the rest of the app does for shop-rate display.

### Verify

Fresh project, one cabinet subproject with install prefill `guys=4, days=5, complexity=30%`. Expected:

- Subproject card: shows the install prefill $ + a labor-hours summary (4 × 5 × 8 = 160 hr in install).
- Project BREAKDOWN: `Labor: X hr est $Y` where X includes the 160 install hours, and `Install: $Z` where Z is the full install prefill $ (not $0).
- Project total = sum of line totals (0 here) + install prefill $.

---

## Issue 12 — project-level margin modifier

**Files:**
- `app/(app)/projects/[id]/page.tsx` (display + input + rollup math)
- `lib/types.ts` (type for new field)
- New migration: `db/migrations/027_project_target_margin.sql`

**What's missing.** Margin is displayed across the app (`0% margin · target 35%`, `below 32%`, etc.) but there's no knob to set the target OR to actually apply markup. Project totals today are shown AT COST.

**Scope per Andrew: project-level modifier only.** One input at the project level. Applied uniformly to all cost buckets (labor, material, consumables, specialty hardware, install). No per-subproject, no per-line.

### Data model

New column on `projects`:

```sql
-- db/migrations/027_project_target_margin.sql
BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_target_margin_valid;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_target_margin_valid
    CHECK (target_margin_pct IS NULL OR (target_margin_pct >= 0 AND target_margin_pct < 100));

COMMIT;

-- DOWN:
--   BEGIN;
--   ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_target_margin_valid;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS target_margin_pct;
--   COMMIT;
```

NULL = "inherit from org default." Org's default target margin lives on `orgs.profit_margin_pct` already (the rollup code reads `org.profit_margin_pct` at line 383 of the project page). Keep that as the fallback.

### Math

Markup factor from target margin:

```ts
// margin% → markup multiplier on cost
// margin = (price - cost) / price → price = cost / (1 - margin/100)
function markupFromMargin(marginPct: number): number {
  const m = Math.max(0, Math.min(99, marginPct)) / 100
  return 1 / (1 - m)
}
```

Apply uniformly in the project rollup:

```ts
const effectiveMarginPct = project.target_margin_pct ?? org.profit_margin_pct ?? 0
const markup = markupFromMargin(effectiveMarginPct)

// All cost buckets get marked up:
acc.laborCost       = rawLaborCost       * markup
acc.materialCost    = rawMaterialCost    * markup
acc.consumablesCost = rawConsumablesCost * markup
acc.hardwareCost    = rawHardwareCost    * markup
acc.installCost     = rawInstallCost     * markup
acc.optionsCost     = rawOptionsCost     * markup
acc.total           = sum of the above
acc.subtotal        = raw cost sum (pre-markup)
acc.marginPct       = (total - subtotal) / total × 100  // = effectiveMarginPct
```

Keep `subtotal` as the pre-markup cost (this is what the existing `marginPct` calculation treats as "cost"), and `total` as the marked-up price. The existing margin formula on line 435–436 already computes `((total - subtotal) / total) × 100`, which will correctly reflect the effective margin once both sides are populated.

### Subproject rollup

Subproject rollups currently compute their own `total` (cost) and pass to the project. Subproject-level breakdowns can stay at COST (no markup) — the UI is for operators building the estimate, and costs are what they're thinking about. Only the **project-total** view applies the markup for the customer-facing number.

If that feels off on sight, we can add a "as priced" toggle to the subproject bottom-bar later. V1 = subproject shows cost, project shows marked-up price. Keep it simple.

### UI

On the project page, in the PROJECT TOTAL / BREAKDOWN panel where the current `0% margin · target 35%` text lives:

- Replace the display-only margin line with an inline editable input: `Target margin: [__] %`
- Default value = `project.target_margin_pct ?? org.profit_margin_pct ?? 35`
- On change, debounce-write to the project via supabase update and re-trigger the rollup memo
- Below the input, keep the delta display: `Current margin: Y% · target X% · (under|over|on) target`

Visually: the target input should feel primary (this is where you adjust price), the current-margin readout secondary.

### Margin source consistency (subproject vs project target number)

Andrew noted: subproject bottom-bar says `0% margin · below 32%`, project total says `target 35% · 35% below`. Two different target numbers. Trace where each is read from — one is probably reading `org.profit_margin_pct` (35%) and the other is reading a stale/derived value (32%). Make both read from `project.target_margin_pct ?? org.profit_margin_pct` so they always agree.

### Fallback when input is NULL

NULL `target_margin_pct` on project = inherit org default. Input renders the inherited value with placeholder styling or an "inherited from org" hint. Editing the input writes a non-NULL value (pins the project). A "Reset to org default" button sets the column back to NULL.

### Verify

Create a project with one subproject, one line at $1000 cost. Set project target margin to 35%. Expected:

- Project total displays $1,538.46 (= 1000 / 0.65).
- BREAKDOWN: labor/material/install all show marked-up numbers summing to $1,538.46.
- Margin readout: `Current margin: 35% · on target`.

Change target to 50%. Project total = $2000. Margin readout: `50% · on target`.

Leave target empty (revert to NULL), with org default 35%. Project total = $1,538.46 again. Input placeholder shows "35% (org default)".

---

## Invariants that must still hold

Same as before — dark mode only in WelcomeOverlay, sheets-per-LF never asked, interior ≠ exterior, per-dept $ dead, `activity_type` dead, Prefinished sentinel client-side.

New invariants for this round:

- **Subproject rollups are at cost.** Project-level applies the markup. Don't apply markup in the subproject rollup.
- **Project target margin falls back to org default** when NULL. Both the display and the math should use the same `effectiveMarginPct` computation.
- **Install prefill hours flow into project labor hours.** Never omit them.
- **"Install" (not "Install (subproject)")** is the breakdown label. Shows `proj.installCost`.

---

## When you're done

Update `BUILD-ORDER.md` Phase 12 close-out notes with PR refs. Don't cut the close-out commit — that's Andrew's. Issues 9/10 as one PR, 11/12 as another, land in that order.

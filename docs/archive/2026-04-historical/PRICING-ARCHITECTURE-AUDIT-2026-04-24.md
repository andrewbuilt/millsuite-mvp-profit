# Pricing architecture audit + redesign

**Date:** 2026-04-24
**Author:** Claude (in dialogue with Andrew)
**Status:** Spec — supersedes the margin-handling instructions in DOGFOOD2 + DOGFOOD3 handoffs. Read this before touching any pricing display code.

---

## What's wrong (root cause)

The app applies the project margin in **two places, against two different source numbers, with no shared source of truth**. Specifically:

### Place 1 — every subproject card on the project page (`app/(app)/projects/[id]/page.tsx`, lines 297-303)

```ts
const perSubCtx: PricingContext = {
  shopRate,
  consumableMarkupPct: sub.consumable_markup_pct ?? (org?.consumable_markup_pct ?? 10),
  profitMarginPct:     sub.profit_margin_pct ?? (org?.profit_margin_pct ?? 35),
}
const rollup = computeSubprojectRollup(subLines, rateBook.itemsById, new Map(), perSubCtx)
```

This passes `profitMarginPct = 35%` (or whatever sub/org has) to the rollup. Inside `computeSubprojectRollup`, `rollup.total = subtotal / (1 - 0.35) = subtotal × 1.5385`. The subproject CARD (line 747) displays `rollup.total + installPrefillCost` — i.e., **cost × 1.5385**, which is the marked-up price.

### Place 2 — project rollup (`proj` useMemo, ~line 488)

```ts
const marginFraction = Math.min(Math.max(marginTarget / 100, 0), 0.99)
const markup = marginFraction > 0 ? 1 / (1 - marginFraction) : 1
acc.laborCost = raw.laborCost * markup
// ... etc for each cost bucket
```

This uses the project's `marginTarget` (from `projects.target_margin_pct ?? org.profit_margin_pct ?? 35`), summing raw costs from `rollup.subtotal` (NOT `rollup.total`), then applying markup once at the project level.

### Place 3 — subproject DETAIL page (`subprojects/[subId]/page.tsx`, lines 180-188)

This page calls `computeSubprojectRollup` with `profitMarginPct: 0`, so `rollup.total === rollup.subtotal === cost`. The subproject's bottom bar shows COST.

### Net result

- Subproject DETAIL page shows COST ($3,518 in Andrew's screenshot)
- Subproject CARD on project page shows PRICE at sub/org margin ($5,413 = $3,518 × 1.5385)
- Project TOTAL shows PRICE at project margin
- When the project margin matches the org default the two coincidentally agree. When they DON'T match (e.g., user adjusts the project target margin input from 35 to 50 — which Andrew did and called out), the project total updates but the subproject card doesn't.
- BREAKDOWN rows on the project total also show marked-up values for each bucket, so the displayed "Material $440" on the project page is materially different from the subproject's own "Material $329" for the same data. Two markups, no shared mental model.

---

## The architectural fix

**One source of truth: `projects.target_margin_pct ?? org.profit_margin_pct`. Applied exactly ONCE, at the project total, and only at the very last step.**

Everything else — line buildups, subproject rollups, subproject cards on the project page, BREAKDOWN bucket totals on the project page — shows COST.

The project total card is the only place margin appears, and it appears as a clearly-labeled separate row between Cost and Price. Like every contractor cost-plus quote ever:

```
COST
─────────────────────────────────
Labor               21.5h   $3,189
Material                     $286
Consumables (15%)             $43
Specialty hardware             $0
Options                        $0
Install              0.0h      $0
─────────────────────────────────
Project cost               $3,518

Project margin (35%)       +$1,895
─────────────────────────────────
PROJECT PRICE              $5,413
```

That's the whole pricing model. Cost up top, margin as a clearly separate line, price as the final number. No surprise double-markups. No "cost · target 35% at project" hint text trying to explain why the same number appears two different ways. Numbers reconcile cleanly: each line cost sums to subproject cost; each subproject cost sums to project cost; project cost + margin = project price.

---

## Concrete changes

### 1. Subproject rollup: always margin=0

**File:** `app/(app)/projects/[id]/page.tsx`, lines 297-303.

Change the `perSubCtx` to always pass `profitMarginPct: 0`:

```ts
const perSubCtx: PricingContext = {
  shopRate,
  consumableMarkupPct: sub.consumable_markup_pct ?? (org?.consumable_markup_pct ?? 15),
  profitMarginPct: 0,  // Margin is applied at the project rollup, not here.
}
```

This makes `rollup.total === rollup.subtotal === cost` for every subproject, matching the subproject detail page.

### 2. Subproject card: show cost

**File:** `app/(app)/projects/[id]/page.tsx`, ~line 747 (the `subTotalWithInstall` display).

After change #1, `subTotalWithInstall = rollup.total + installPrefillCost` is already cost. The card displays the right number, but the label text near it should be updated to read "cost" not "total" if it doesn't already. And the `0% margin` text on the card (line ~750-ish) should be removed entirely — margin is a project-level concept, not a per-subproject one.

### 3. Drop the per-subproject margin column and per-sub `consumable_markup_pct` override

**Schema:** `subprojects.profit_margin_pct` (column) — rip it out. It was mistakenly created as a per-sub override; nothing should override the project margin. Same for `subprojects.consumable_markup_pct` if it exists — consumables markup belongs at the org (`orgs.consumable_markup_pct`).

New migration `db/migrations/030_drop_subproject_margin_overrides.sql`:

```sql
BEGIN;

ALTER TABLE public.subprojects
  DROP COLUMN IF EXISTS profit_margin_pct;

-- Keep consumable_markup_pct column for now if nothing reads it; drop in a
-- follow-up if grep is clean. Inline comment why kept/removed.

COMMIT;
```

**Code:** Remove all reads of `sub.profit_margin_pct` (page.tsx line 302, plus any others). Single source of truth becomes `projects.target_margin_pct ?? org.profit_margin_pct`.

### 4. Project rollup: split cost from price

**File:** `app/(app)/projects/[id]/page.tsx`, the `proj: ProjectRollup` useMemo (~lines 405-508).

Stop applying `× markup` to each bucket. Keep the cost buckets at COST. Add separate top-level `costTotal` and `priceTotal` fields:

```ts
const acc: ProjectRollup = {
  // ... existing fields, but each cost bucket is now plain COST:
  laborCost: 0,
  materialCost: 0,
  consumablesCost: 0,
  hardwareCost: 0,
  optionsCost: 0,
  installCost: 0,
  // ...
  costTotal: 0,    // sum of all cost buckets (no markup)
  marginPct: 0,    // = effective project target margin
  marginAmount: 0, // = priceTotal - costTotal
  priceTotal: 0,   // = costTotal × markup (the customer-facing number)
}

// In the reduce:
for (const { sub, rollup, finishSpecCount, installPrefillCost, installPrefillHours } of cards) {
  acc.laborCost       += rollup.laborCost
  acc.materialCost    += rollup.materialCost
  acc.consumablesCost += rollup.consumablesCost
  acc.hardwareCost    += rollup.hardwareCost
  acc.optionsCost     += rollup.optionsCost
  acc.installCost     += rollup.installCost + installPrefillCost
  acc.hoursByDept.eng      += rollup.hoursByDept.eng
  acc.hoursByDept.cnc      += rollup.hoursByDept.cnc
  acc.hoursByDept.assembly += rollup.hoursByDept.assembly
  acc.hoursByDept.finish   += rollup.hoursByDept.finish
  acc.hoursByDept.install  += rollup.hoursByDept.install + installPrefillHours
  acc.totalHours    += rollup.totalHours
  acc.finishSpecCount += finishSpecCount
}

// After reduce:
acc.costTotal = acc.laborCost + acc.materialCost + acc.consumablesCost +
                acc.hardwareCost + acc.optionsCost + acc.installCost

const marginTarget = project?.target_margin_pct ?? org?.profit_margin_pct ?? 35
const marginFraction = Math.min(Math.max(marginTarget / 100, 0), 0.99)
const markup = marginFraction > 0 ? 1 / (1 - marginFraction) : 1

acc.priceTotal    = acc.costTotal * markup
acc.marginAmount  = acc.priceTotal - acc.costTotal
acc.marginPct     = marginTarget  // store the input, not the recomputed
```

`installPrefillHours` still goes into `hoursByDept.install` only (per dogfood3 invariant). It does NOT add to `totalHours`.

### 5. Project total card UI

**File:** `app/(app)/projects/[id]/page.tsx`, the project total card and BREAKDOWN section (~lines 811-926).

New structure:

```
PROJECT TOTAL          ← header
$5,413                 ← acc.priceTotal (large, bold)
35% margin · $1,895    ← acc.marginPct + acc.marginAmount
                         (the "margin" hint text under the price)

TARGET MARGIN  [35] %   ← editable input (existing, unchanged behavior)
Inherited from org default (35%)
35% applied to total cost. Subprojects show cost; this is the markup at the project level.

COST BREAKDOWN          ← section header (renamed from BREAKDOWN)
─────────────────────
Labor       21.5h est   $3,189
Material                  $286
Consumables (15%)          $43
Specialty hardware          $0
Options                     $0
Install      0.0h           $0
─────────────────────
Project cost            $3,518

Project margin (35%)    +$1,895
─────────────────────
PROJECT PRICE           $5,413
```

Three sections: header (price), target margin editor, cost breakdown ending with the explicit margin row and the final price. The bucket rows show COST (from `acc.laborCost` etc., not marked up). The Material row reads `$286` consistent with what the subproject shows; no surprise.

Drop the chevron-expand on Labor (the install-row nesting was the only thing making it expandable; install is now its own peer row, dogfood3 invariant 20).

### 6. Subproject detail page bottom bar

**File:** `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`, the bottom-bar grid (~lines 917-949).

Three changes:

**6a. Drop the "cost · target 35% at project" hint.** Line ~570. Just remove it. The header label "COST" (or no label, just the dollar amount as today) is enough; the project page is where margin happens.

**6b. Split "Hardware / Install" into separate columns.** Current:
```
LABOR    MATERIAL    HARDWARE / INSTALL    SUBTOTAL
```

New:
```
LABOR    MATERIAL    HARDWARE    INSTALL    SUBTOTAL
```

`Hardware` value = `rollup.hardwareCost` (specialty hardware $).
`Install` value = `rollup.installCost + installPrefillCost` (on-site install labor + cost).
`Subtotal` value = sum of all five.

If there's a width problem, drop the SUBTOTAL column (it's redundant with the leading `$X` total in the bar header) and use the freed space.

**6c. Drop the "$X labor · $Y mat · $Z hw/inst" subtitle line.** Replace with hours-only summary if you want to surface anything: "21.5 hr est." Or remove entirely. The bar's columns already show all the relevant breakdowns.

### 7. Subproject card on project page

**File:** `app/(app)/projects/[id]/page.tsx`, the subproject list card (~lines 630-776).

**7a. Show cost (after change #1, this is automatic).** Big number on the card = `subTotalWithInstall = rollup.total + installPrefillCost`, which is now cost.

**7b. Drop the "0% margin" / "35% margin" line on the card.** Lines ~750-760ish — find and remove. Margin is a project concept; the card shouldn't try to display it.

**7c. Add a small "+ $X install" hint below the cost if install prefill is non-zero.** This already exists (line ~679: `+ {money(installPrefillCost)} install`). Keep.

**7d. Card subtitle ("0 lines · 0.0h est · 0 finish specs").** Keep — these are factual subproject descriptors, not margin-related.

### 8. Don't re-display marked-up bucket totals anywhere

Anywhere else in the app that shows project bucket costs (sales/handoff/preprod/etc.), they should display COST consistently. If a downstream surface needs the marked-up price, it reads `proj.priceTotal` directly. Don't reconstruct marked-up bucket totals — the bucket display is at cost everywhere.

### 9. Sold handoff page (`/projects/[id]/handoff`) — same fix

**File:** `app/(app)/projects/[id]/handoff/page.tsx`.

The sold-handoff page has the same three-way mess as the project page had, plus a fourth bug:

- **Lines 203-211:** calls `computeSubprojectRollup` with `profitMarginPct: sub.profit_margin_pct ?? (org?.profit_margin_pct ?? 35)` — per-subproject markup baked into `r.total`.
- **Lines 274-299:** sums `r.total` across subs (which already carries per-sub markup) for `acc.total`. No project-level markup applied — the markup is buried inside each subproject and uses sub/org default, not the project's `target_margin_pct`.
- **No install prefill anywhere.** `installPrefillCost` is never computed or added to the rollup. The "Estimate snapshot" therefore shows project totals that exclude install entirely.

Andrew's screenshot showed bidding-page `$50,710` (cost $45,639 + 10% project margin + $5,933 install) vs sold-handoff page `$44,118` (subproject costs × per-sub margin, install dropped). They should be the same number.

**Fix.**

1. **`perSubCtx.profitMarginPct = 0`** — same as the project page change. Subproject rollups are pure cost.
2. **Compute install prefill per subproject** — same pattern as the project page's `cardData` build (`computeInstallCost(installPrefill, shopRate)` and `computeInstallHours(installPrefill)`). Carry these in a `installCostBySub` / `installHoursBySub` map keyed by subId.
3. **Project totals reduce becomes:**

```ts
const acc = {
  total: 0,            // project price (cost + margin)
  costTotal: 0,        // pre-margin
  marginAmount: 0,     // priceTotal - costTotal
  marginPct: 0,        // = effective project target margin
  hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
  totalHours: 0,
  subCount: subs.length,
  linearFeet: 0,
}
for (const sub of subs) {
  const r = rollupBySub[sub.id]
  const installCost  = installCostBySub[sub.id]  || 0
  const installHours = installHoursBySub[sub.id] || 0
  acc.linearFeet += Number(sub.linear_feet) || 0
  if (!r) continue
  acc.costTotal += r.subtotal + installCost
  acc.hoursByDept.eng      += r.hoursByDept.eng
  acc.hoursByDept.cnc      += r.hoursByDept.cnc
  acc.hoursByDept.assembly += r.hoursByDept.assembly
  acc.hoursByDept.finish   += r.hoursByDept.finish
  acc.hoursByDept.install  += r.hoursByDept.install + installHours
  acc.totalHours += r.totalHours
}

const marginTarget = project?.target_margin_pct ?? org?.profit_margin_pct ?? 35
const marginFraction = Math.min(Math.max(marginTarget / 100, 0), 0.99)
const markup = marginFraction > 0 ? 1 / (1 - marginFraction) : 1
acc.total        = acc.costTotal * markup
acc.marginAmount = acc.total - acc.costTotal
acc.marginPct    = marginTarget
```

4. **Estimate-snapshot card per-subproject TOTAL column** — display `r.subtotal + installCostBySub[sub.id]` for each subproject (cost), NOT `r.total`. Same number that shows up on the bidding-page subproject card.

5. **Project total row at the bottom of the snapshot** — display `acc.total` (price). The header callout "10% margin" reads `acc.marginPct`. The project header above the snapshot ("$44,118 · 2 subprojects · 239.9 hrs · 10% margin") should also read `acc.total` and `acc.marginPct`.

### Verification (handoff page specific — add to verification block below)

Same fixture as the main verification block, with two subs and a non-zero install prefill on one sub.

1. Bidding-page `PROJECT PRICE` and handoff-page header total are the **same number**.
2. Bidding-page subproject card numbers and handoff-page snapshot per-sub TOTAL column are **the same numbers** (cost, including install prefill where applicable).
3. Sum of snapshot per-sub TOTALs equals `acc.costTotal`. `acc.costTotal × markup = acc.total`. Math closes.
4. If a subproject has install prefill > 0, that install is INCLUDED in the snapshot's per-sub TOTAL and in `acc.costTotal`. Not silently dropped.

---

## Verification (Code must demonstrate ALL of these)

Set up: project with one subproject ("Kitchen") with one composer line (qty=8 LF, slots producing $3,518 cost), no install. `org.profit_margin_pct = 35`.

1. **Subproject detail page bottom bar:**
   - Subtotal: $3,518
   - Labor: $3,189 (21.5h)
   - Material: $286
   - Consumables: $43
   - Hardware: $0
   - Install: $0
   - No "cost · target 35% at project" text.
   - No "21.5 hr labor · $329 mat · $0 hw/inst" subtitle.

2. **Project overview subproject card (Kitchen):**
   - Big number: $3,518 (cost).
   - No "35% margin" text on the card.
   - "1 line · 21.5h est · 0 finish specs" subtitle present.

3. **Project total pane:**
   - PROJECT TOTAL: $5,413.
   - "35% margin · $1,895" hint under the price.
   - TARGET MARGIN input shows 35.
   - COST BREAKDOWN section:
     - Labor 21.5h $3,189
     - Material $286
     - Consumables $43
     - Specialty hardware $0
     - Options $0
     - Install 0.0h $0
   - "Project cost: $3,518"
   - "Project margin (35%): +$1,895"
   - "PROJECT PRICE: $5,413"

4. **Adjusting target margin:**
   - Type 50 in TARGET MARGIN input.
   - PROJECT PRICE updates to $7,036 (= $3,518 / 0.5).
   - Margin row shows "+$3,518" (= $7,036 - $3,518).
   - Subproject card "Kitchen" still shows $3,518 (unchanged — it's cost).
   - COST BREAKDOWN bucket numbers unchanged.

5. **Two-subproject project:**
   - Kitchen $3,518 + Bath $1,500 = $5,018 cost.
   - Project total at 35%: $7,720.
   - Both cards show their own cost. Sum of cards equals "Project cost" in the breakdown. Adding them by hand should match.

6. **No double-markup verification:** `grep -rn 'profitMarginPct' lib/ app/ components/` should turn up exactly ONE non-zero use site: the `marginTarget` lookup in the project rollup. Every other call site of `computeSubprojectRollup` passes `profitMarginPct: 0` or the equivalent.

---

## What NOT to do

- Don't add per-line, per-subproject, or per-bucket margin overrides. One knob at the project level. Per Andrew's prior call.
- Don't try to display marked-up bucket totals in any view. The cost view IS the breakdown view; the price view shows ONE number.
- Don't keep "cost · target X% at project" hint text. It was a workaround for the inconsistency — once the inconsistency is gone the hint is noise.
- Don't lump Hardware and Install into one column anywhere. They're different cost categories with different P&L treatment.
- Don't apply `× markup` to per-bucket numbers in the project rollup. Apply only to the cost total.

---

## Summary of code changes (PR scope)

This is one PR. Don't bundle with other dogfood issues. Single name: `pricing-architecture-margin-cleanup`.

Files:
- `db/migrations/030_drop_subproject_margin_overrides.sql` — new
- `app/(app)/projects/[id]/page.tsx` — perSubCtx margin=0; rollup math; project total card UI; subproject card cleanup
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` — bottom bar columns; drop hint text
- `app/(app)/projects/[id]/handoff/page.tsx` — perSubCtx margin=0; install prefill in rollup; per-sub snapshot TOTAL = cost; project total at price (section 9)
- `lib/types.ts` — drop `Subproject.profit_margin_pct` (and `consumable_markup_pct` if confirmed unused)
- Any other readers of `sub.profit_margin_pct` — find via grep and clean up
- `lib/project-rollup.ts` — if it has its own ProjectRollup shape, update `costTotal` / `priceTotal` / `marginAmount` fields to match

Process: ship as one PR with the verification screenshots from the list above. Do NOT start on dogfood4 issues 19-21 until this lands and Andrew confirms the numbers reconcile cleanly.

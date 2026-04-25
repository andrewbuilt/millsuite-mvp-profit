# Claude Code handoff — dogfood triage (April 2026)

**Date:** 2026-04-24
**Context:** Andrew ran the composer end-to-end on a real estimate (Phase 12 Item 11 close-out gate). Eight issues surfaced. This doc is the fix list, ordered by dependency.
**Supersedes nothing.** Treat `docs/CLAUDE-CODE-HANDOFF-2026-04-24.md` as still authoritative for the Phase 12 invariants. These are follow-ups on top of what shipped in PR 22.

---

## Read before writing code

1. `docs/CLAUDE-CODE-HANDOFF-2026-04-24.md` — the prior handoff + invariants (dark mode lives only in WelcomeOverlay; sheets-per-LF is never asked; interior ≠ exterior; per-dept $ is dead; `activity_type` is a relic).
2. `specs/add-line-composer/README.md` — the amendment block at the top. Still the source of truth for composer slot model + breakdown math.
3. This file, in order. Issues 1/2/3/6/8 are the fast bundle. Issue 4 is the architectural one. Issues 5/7 are Andrew-resolved design changes.

**Don't** re-open questions about the palette, the Prefinished sentinel, the blended shop rate, or the `application` discriminator. Those are settled.

---

## Execution order

1. **Issue 1** (bug) — `DoorStyleWalkthrough` stepIdx cap
2. **Issue 2** (copy) — naming example trim
3. **Issue 3** (copy) — Wood machining rewrite + em-dash sweep
4. **Issue 6** (bug) — finish-dropdown filter
5. **Issue 8** (info) — document, no change
6. **Issue 5** (design) — first-line-empty preload behavior
7. **Issue 7** (design) — end panels scale with door style + material + finish
8. **Issue 4** (major) — BaseCabinetWalkthrough seeds Slab door_style

Items 1–6 can land as one PR. Item 7 is its own PR (touches composer pricing math). Item 4 is its own PR (touches BaseCabinetWalkthrough save path). Land in that order; Item 4 last because dogfood verification depends on the new save behavior not double-counting door labor once the end-panel rollup lands.

---

## Issue 1 — DoorStyleWalkthrough stuck at 5 of 6

**File:** `components/walkthroughs/DoorStyleWalkthrough.tsx`

**Bug.** Line 233:

```tsx
onNext={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
```

For a new style, `totalSteps` (line 275) = `STEPS.length + 1 = 6` (name screen + 5 dept screens). The cap of `STEPS.length - 1 = 4` means `stepIdx` tops out at 4, which displays as "Step 5 of 6 · Assembly." User can never reach Finish, save button never appears.

**Fix.** Cap off the correct total:

```tsx
onNext={() => setStepIdx((i) => Math.min(isNewStyle ? STEPS.length : STEPS.length - 1, i + 1))}
```

For existing-style full-modal flow (no name step), `totalSteps = 5`, cap at 4 — same as before, still correct.

**Verify.** On a fresh org, open the composer, click "+ Add new door style," enter a name, click Next through all 5 dept screens. Last screen (Finish) should show "Step 6 of 6" and the CTA should read "Save to rate book."

---

## Issue 2 — drop "Reveal-edge slab" from naming examples

**File:** `components/walkthroughs/DoorStyleWalkthrough.tsx`

**Copy fix.** Lines 321-322:

```tsx
The name appears in the composer dropdown. "Shaker," "Slab,"
"Reveal-edge slab," anything that reads like what you build.
```

"Reveal-edge slab" isn't a real door type. Change to:

```tsx
The name appears in the composer dropdown. "Shaker," "Slab,"
anything that reads like what you build.
```

---

## Issue 3 — rewrite Wood machining copy, sweep em dashes

**File:** `components/walkthroughs/DoorStyleWalkthrough.tsx`

**Copy fix.** Lines 64-68:

```tsx
{
  key: 'machining',
  heading: 'Wood machining',
  bucketLabel: 'Assembly',
  prompt:
    'Rails & stiles, jointer, planer, shaper — for 4 doors. Folds into Assembly on save — asked separately so it doesn\u2019t get lost.',
},
```

Replace the prompt with:

```tsx
  prompt:
    'Solid wood processing if applicable. Folds into Assembly on save.',
```

**Then do a broader em-dash sweep.** Grep for the em dash character (`—`, U+2014) in user-facing copy across the walkthroughs and composer:

```bash
grep -rn '—' components/walkthroughs/ components/composer/ app/\(app\)/onboarding-overlay/
```

For each hit, either rewrite into a period/comma split or a colon. Andrew's asked us to drop the em-dash stylism in operator-facing copy — it reads like prose, not like instructions.

**Don't sweep** code comments, README/spec/handoff docs, or commit messages. Only user-visible strings.

---

## Issue 6 — exterior finish dropdown shows all 4 combos

**File:** `components/composer/AddLineComposer.tsx`, helper in `lib/composer.ts`

**Bug.** `components/walkthroughs/FinishWalkthrough.tsx` `ensureAndLoadFinishData` (lines 514-528) inserts all 4 `rate_book_items` rows on first walkthrough open, one per combo × application, regardless of whether the operator ever touches a card. Composer then renders every row as a pickable finish. Operator only calibrated one → composer shows four, three of which are zero.

**Fix (composer-side, less invasive).** Filter `rateBook.finishes` to only finishes with at least one non-zero breakdown row. The Prefinished sentinel is always included (zero breakdown is the whole point of it — keep it).

In `lib/composer.ts` add a helper that decides whether a finish is "used":

```ts
/** A DB-loaded finish is "used" if at least one product category has a
 *  non-zero per-LF labor OR material contribution. Prefinished sentinel
 *  is always considered used (labor/material are zero by design). */
export function isFinishUsed(f: ComposerFinish): boolean {
  if (f.isPrefinished) return true
  for (const p of ['base', 'upper', 'full'] as const) {
    const row = f.byProduct[p]
    if (!row) continue
    if (row.laborHr > 0 || row.material > 0) return true
  }
  return false
}
```

Then in `AddLineComposer.tsx` where the interior/exterior dropdowns filter by application (lines 728 and 744 per the prior audit), chain the `isFinishUsed` filter after the application filter:

```ts
const interiorFinishes = withPrefinishedSentinel(
  rateBook.finishes
    .filter((f) => f.application === 'interior')
    .filter(isFinishUsed)
)
const exteriorFinishes = rateBook.finishes
  .filter((f) => f.application === 'exterior')
  .filter(isFinishUsed)
```

**Edge case.** If `exteriorFinishes.length === 0` (nothing calibrated yet), the dropdown should show only the "+ Calibrate exterior finish" affordance, no rows. Same for interior (Prefinished sentinel will still be there — it doesn't get filtered out).

**Verify.** On a fresh org, open FinishWalkthrough, calibrate only "Stain + clear on slab" at Base 8'. Close. Open composer, pick Base. Exterior dropdown should show exactly one row ("Stain + clear on slab") plus "+ Calibrate exterior finish" — not four.

---

## Issue 8 — filler/scribes price source (documentation only)

**No code change.** Andrew asked where the filler/scribes number comes from. Answer: `lib/composer.ts` lines 214-215, `FILLER_LABOR_HR = 0.5` (at assembly-dept rate, which is just `orgs.shop_rate` now) and `FILLER_MATERIAL = 18` ($ per each). Spec calls these V1 defaults; V2 lifts them into the rate book.

No action. Noted for the dogfood log.

---

## Issue 5 — first-line-empty preload (Andrew's call: A)

**File:** `components/composer/AddLineComposer.tsx`

**Design change.** Andrew picked option (a): on a fresh subproject, the first composer line starts empty. Preload from last-used only kicks in on the 2nd+ line of the same subproject.

Currently lines 225-249 hydrate slots from `orgs.last_used_slots_by_product` + hard fallbacks on every product pick, so even a brand-new subproject opens to a fully-priced breakdown before the operator has confirmed anything.

**Fix.**

1. Pass a new prop into `AddLineComposer` from the subproject editor: `hasExistingLinesInSubproject: boolean`. Parent computes this from the current subproject's line count (not the org's last-used cache).
2. In the product-pick handler, gate the preload:

```ts
const shouldPreload = hasExistingLinesInSubproject
const carry = shouldPreload ? lastUsed[key] : null
// ... existing hard-fallback + slot hydration logic below, unchanged
```

3. When `shouldPreload` is false, skip the `carry` branch entirely — start with `emptySlots()` plus only the minimum hard fallbacks needed to render (probably just qty = 8 and empty slot ids). The breakdown component should render "Pick materials + door style to see pricing" in that state rather than a zero-everything $0 table.

**Don't** change `orgs.last_used_slots_by_product` write behavior — we still cache the last-used slots on save for future subprojects. The gate is only on read.

**Verify.** Create a new subproject. Click Add line. Pick Base. Composer should open with empty slots and no breakdown $. Fill it in, save. Click Add line again (2nd line of same subproject). Pick Base. NOW it should preload from the first line's slots with the breakdown already populated.

---

## Issue 7 — end panels scale with door style + material + finish (Andrew's call)

**File:** `lib/composer.ts`, breakdown rendering in `components/composer/AddLineComposer.tsx`

**Design change.** Andrew's call: an end panel is 2 LF of whatever cabinet height is being priced (assumes 24" deep). Price is a rollup of door style labor + door material + exterior finish. Add estimator-facing note: "Assumes 24" deep. Price multiple panels if oversized."

### Math

For a given line at product `P` (base | upper | full), with slots picked:

- `endPanelLaborPerPanel = 2 × (doorStyleLaborPerLf[P] + exteriorFinishLaborPerLf[P])`
- `endPanelMaterialPerPanel = 2 × (doorMaterialSheetCost × sheetsPerLfFace[P] + exteriorFinishMaterialPerLf[P])`
- `endPanelsLabor = count × endPanelLaborPerPanel × shop_rate`
- `endPanelsMaterial = count × endPanelMaterialPerPanel`

Where:
- `doorStyleLaborPerLf[P]` = per-door labor hours × doorsPerLf[P] × doorLaborMultiplier[P] (same formula the composer already uses for door labor on a line — reuse it, don't recompute).
- `sheetsPerLfFace[P]` = from `lib/products.ts` (`sheetsPerLfFace`: Base 1/12, Upper 1/8, Full 1/4).
- `exteriorFinishLaborPerLf[P]` and `exteriorFinishMaterialPerLf[P]` = what we already compute for the exterior finish line in the breakdown. Pull from the same product row on the finish.

### Fallbacks

If no door style is picked → labor contribution from door style is 0 (panel is unpainted raw sheet). If no exterior material → material contribution is 0 (probably a bug in the slot, but don't crash). If no exterior finish → finish contribution is 0 (unfinished panel — valid if interior-only use case).

**Delete** the hardcoded `END_PANEL_LABOR_HR = 1.2` and `END_PANEL_MATERIAL = 140` constants on lines 212-213. If no door style / material / finish is picked, the panel price is legitimately 0 — the old $140 flat was carrying pricing for an unchosen exterior.

### Estimator-facing note

In the slot UI where operators enter the end-panel count (AddLineComposer.tsx around line 775-788), add a small helper text below the field:

```tsx
<p className="text-xs text-[#9CA3AF] mt-1">
  Assumes 24" deep. Price multiple panels if oversized.
</p>
```

### Breakdown render

The breakdown row label stays "End panels" with the existing `breakdown.endPanelsCount` detail. The math change is all in `computeBreakdown` / the `endPanelsLabor` + `endPanelsMaterial` computation (currently lines 325-326).

**Verify.** On a line with:
- Product = Base (sheetsPerLfFace = 1/12)
- Door style = Slab with per-door finish labor 0.5 hr, and doorsPerLf[base] = 0.5, doorLaborMultiplier[base] = 1.0 → doorStyleLaborPerLf = 0.5 × 0.5 × 1.0 = 0.25 hr/LF
- Door material = Veneer Maple at $80/sheet
- Exterior finish = Stain + clear on slab at Base: 0.15 hr/LF labor, $3/LF material
- Shop rate = $100/hr
- 2 end panels

Expected per panel:
- Labor: 2 LF × (0.25 + 0.15) = 0.8 hr × $100 = $80
- Material: 2 LF × (0.167 × $80 + $3) = 2 × ($13.33 + $3) = $32.67
- Total per panel: $112.67 × 2 panels = $225.33

Prototype HTML (`specs/add-line-composer/index.html`) will diverge here — it's using the old hardcoded constants. That's expected and NOT a bug; the prototype is frozen. Update the dogfood template's prototype-vs-app delta table to note the new end-panel math and skip that row in the comparison.

---

## Issue 4 — BaseCabinetWalkthrough must seed Slab door_style

**File:** `components/walkthroughs/BaseCabinetWalkthrough.tsx` (+ new door_style write path)

**The meatiest one.** The walkthrough explicitly calibrates against veneer slab doors (line 78 op: "How long does it take to cut an 8' run of veneer slab doors in your shop?"). Four of the nine ops are door-specific. But `saveBaseCabinetCalibration` (line 550) writes all 9 ops, folded to 4 depts, to a single `base_labor_hours_*` field on the Base cabinet row. Result:

- Composer's door dropdown is empty on first composer open → fires `DoorStyleWalkthrough` for Slab, which the user already implicitly calibrated during Base walkthrough. Double work, and the two calibrations will drift.
- Base cabinet row double-counts door labor: it contains carcass + door ops, but composer ALSO pulls door labor from the door_style row → if the user later runs the door walkthrough, their line prices jump because they're now paying for doors twice.

### Fix — split save path

In `BaseCabinetWalkthrough.tsx`:

1. **Split OPERATIONS into two groups** (keep the ordering as-is in the UI — this is data only):
   - Carcass ops: `engineering`, `cutInterior`, `edgebandInterior`, `boxAssembly`, `fullAssembly`
   - Door ops: `cutDoors`, `edgebandDoors`, `hingeCups`, `finish`

2. **Replace `toPerLfByDept`** with two functions:

```ts
const CARCASS_OP_KEYS: OpKey[] = ['engineering', 'cutInterior', 'edgebandInterior', 'boxAssembly', 'fullAssembly']
const DOOR_OP_KEYS: OpKey[]    = ['cutDoors', 'edgebandDoors', 'hingeCups', 'finish']

function toCarcassPerLfByDept(answers: Answers) {
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) {
    if (!CARCASS_OP_KEYS.includes(op.key)) continue
    byDept[op.dept] += answers[op.key] || 0
  }
  return {
    eng: byDept.Engineering / 8,
    cnc: byDept.CNC / 8,
    assembly: byDept.Assembly / 8,
    finish: byDept.Finish / 8,
  }
}

function toDoorPerDoorByDept(answers: Answers) {
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) {
    if (!DOOR_OP_KEYS.includes(op.key)) continue
    byDept[op.dept] += answers[op.key] || 0
  }
  // Walkthrough unit is 4 doors per 8' run — divide by 4 to land at per-door.
  return {
    eng: byDept.Engineering / 4,
    cnc: byDept.CNC / 4,
    assembly: byDept.Assembly / 4,
    finish: byDept.Finish / 4,
  }
}
```

3. **Rename and extend the save function** to `saveBaseCabinetAndDoorStyleCalibration`. It writes two rows:

```ts
async function saveBaseCabinetAndDoorStyleCalibration(
  orgId: string,
  carcassPerLf: { eng: number; cnc: number; assembly: number; finish: number },
  doorPerDoor: { eng: number; cnc: number; assembly: number; finish: number },
): Promise<void> {
  // 1. Existing logic: find-or-create cabinet_style "Cabinets" category,
  //    find-or-create "Base cabinet" item, upsert base_labor_hours_*.
  //    (Reuse the code that's there — just pass carcassPerLf instead of
  //    the old combined perLf.)

  // 2. New: find-or-create door_style "Doors" category for this org
  //    (item_type = 'door_style'), then find-or-create "Slab" item under
  //    it. Upsert door_labor_hours_{eng,cnc,assembly,finish} with
  //    doorPerDoor values.
}
```

Door-style category + item lookup pattern should match what's already in `DoorStyleWalkthrough.tsx`'s `saveDoorStyleCalibration` — reuse or factor out a shared helper in `lib/rate-book.ts` so both walkthroughs converge on the same find-or-create logic. Do NOT call into DoorStyleWalkthrough's save directly — keep the base walkthrough self-contained.

4. **Update the save call site** (line 167):

```ts
await saveBaseCabinetAndDoorStyleCalibration(
  orgId,
  toCarcassPerLfByDept(answers),
  toDoorPerDoorByDept(answers),
)
```

5. **Update the summary screen preview.** Currently it shows four per-LF numbers. It should now show six lines — four carcass per-LF + two door per-door lines (one for CNC/Assembly/Finish combined, since Eng for doors will usually be 0). Or keep it as one table with a small divider between "Base cabinet" and "Slab door style" sections. Andrew will call this on sight once dogfooded — make the cleanest split you can and note the choice in the dogfood doc.

### Summary screen copy

Add a one-liner to the summary header acknowledging the two writes:

> "This creates your Base cabinet row AND a Slab door style. You can rename or recalibrate either in the rate book later."

### Verify

On a fresh org, run the Base walkthrough with non-zero values for cutDoors / edgebandDoors / hingeCups / finish. Save. Then:

```sql
select name, item_type, base_labor_hours_cnc, base_labor_hours_finish,
       door_labor_hours_cnc, door_labor_hours_finish
  from rate_book_items ri
  join rate_book_categories rc on rc.id = ri.category_id
 where ri.org_id = '<org>' and ri.active = true;
```

Should return two rows:
- `Base cabinet` (cabinet_style): non-zero `base_labor_hours_*`, null `door_labor_hours_*`.
- `Slab` (door_style): null `base_labor_hours_*`, non-zero `door_labor_hours_*`.

Then open the composer. Pick Base. Door dropdown should show "Slab" as calibrated (not flagged for walkthrough). Line should price correctly without needing to run DoorStyleWalkthrough.

---

## Invariants that must still hold

- Dark mode only in `WelcomeOverlay`. Everything else light palette.
- Sheets-per-LF is never asked.
- Interior ≠ Exterior finish. Both filters on `application` on the composer side.
- Per-dept $ is dead. Everything multiplies by `orgs.shop_rate`.
- `activity_type` on subprojects is a relic — don't resurrect.
- Prefinished sentinel stays client-side — not a rate-book row.

---

## When you're done

Update `BUILD-ORDER.md` Phase 12 close-out notes with the new PR references. Keep the Phase 12 close-out commit Andrew owns — don't cut it yourself. Leave the dogfood template in place; Andrew will rerun on a fresh branch after these land and fill it in.

Issues 1/2/3/6/8 can all merge as a single PR — call it `dogfood-quick-fixes`.
Issue 5 its own PR — `dogfood-first-line-empty`.
Issue 7 its own PR — `dogfood-endpanel-rollup`.
Issue 4 its own PR — `dogfood-basecab-doorstyle-seed`.

Land in that order.

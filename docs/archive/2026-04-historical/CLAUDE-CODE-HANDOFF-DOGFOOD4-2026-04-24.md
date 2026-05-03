# Claude Code handoff — dogfood round 4 (April 2026)

**Date:** 2026-04-24
**Context:** Dogfood pass after dogfood3 ship surfaced four issues, including one critical computation bug that's been latent since AddLineComposer first shipped. This handoff is tighter and more prescriptive than prior rounds because the prior rounds had spec ambiguities that produced break-fix-break cycles.

**Land in this PR order. Do not bundle. Verify each PR end-to-end before opening the next.**

1. **Issue 18 (CRITICAL)** — line save stores qty-multiplied hours; rollup multiplies by qty again. 8x labor cost on saved lines.
2. **Issue 19** — line click does nothing (Issue 15 cleanup overshot). Need composer in edit mode.
3. **Issue 20** — un-nest Install from Labor in BREAKDOWN. Make Install a peer-level row.
4. **Issue 21** — change order from a line targets a slot, not the whole line.

---

## Process change for this round

Andrew has been dogfooding hard and surfacing real bugs. Prior handoffs queued multiple PRs in parallel which let several spec misreads slip through. For this round:

- One PR at a time. Open the next handoff conversation with Andrew only after he's confirmed the previous PR works in dogfood.
- Each PR includes the verification block from this doc as a checklist Code runs through before declaring done.
- For Issue 18 specifically: do NOT declare done by passing a unit test alone. Save a real composer line at qty=8 and confirm the line table renders the same dollar amount as the editor breakdown showed. Screenshot diff in the PR description.

---

## Issue 18 (CRITICAL) — composer line save 8x labor bug

### Root cause

**Files:**
- `lib/composer.ts` (`computeBreakdown` returns qty-multiplied hours)
- `lib/composer-persist.ts` (`saveComposerLine` stores those qty-multiplied hours into `dept_hour_overrides`)
- `lib/estimate-lines.ts` (`computeLineBuildup` treats `dept_hour_overrides` as per-unit and multiplies by `qty`)

`computeBreakdown` (line 239+ of `lib/composer.ts`) computes hours-by-dept for the WHOLE LINE at the chosen qty:

```ts
// lines 258-261
const carcassHoursByDept = {
  eng: qty * cl.eng,
  cnc: qty * cl.cnc,
  assembly: qty * cl.assembly,
  finish: qty * cl.finish,
}
```

`saveComposerLine` (`lib/composer-persist.ts:160-164`) writes those values straight into `dept_hour_overrides`:

```ts
if (breakdown.hoursByDept.eng > 0) deptHourOverrides.eng = breakdown.hoursByDept.eng
// ... etc
```

But `computeLineBuildup` (`lib/estimate-lines.ts:466`) treats `dept_hour_overrides` as PER-UNIT and multiplies by `qty`:

```ts
hoursByDept[d] = h * qty   // h here is from effectiveHours which reads dept_hour_overrides
```

Net effect: a line at 8 LF with 40 total hours of labor saves with `dept_hour_overrides = { ..., assembly: 40 }`, then renders with `40 * 8 = 320` hours. 8x labor cost.

### Fix

**Two files. Plus a data migration.**

**1. `lib/composer-persist.ts` — divide by qty before storing.** Around line 160-164:

```ts
const qty = Number(draft.qty) || 0
const deptHourOverrides: Record<string, number> = {}
if (qty > 0) {
  if (breakdown.hoursByDept.eng > 0)      deptHourOverrides.eng      = breakdown.hoursByDept.eng      / qty
  if (breakdown.hoursByDept.cnc > 0)      deptHourOverrides.cnc      = breakdown.hoursByDept.cnc      / qty
  if (breakdown.hoursByDept.assembly > 0) deptHourOverrides.assembly = breakdown.hoursByDept.assembly / qty
  if (breakdown.hoursByDept.finish > 0)   deptHourOverrides.finish   = breakdown.hoursByDept.finish   / qty
}
```

If `qty <= 0` (shouldn't happen — save gate blocks it — but defensive), don't write overrides.

**2. New migration: `db/migrations/029_fix_composer_line_hours.sql`** — divides existing composer-saved lines' overrides by their qty, since they're currently 8x (or whatever-qty-x). Composer-saved lines are identified by `product_key IS NOT NULL AND product_slots IS NOT NULL`.

```sql
-- Migration 029 - fix composer-saved estimate_lines whose dept_hour_overrides
-- were stored as qty-multiplied totals instead of per-unit. The save path was
-- patched in the same PR; this migration corrects existing rows.
--
-- Only touches rows where product_key + product_slots are both set (composer
-- origin). Lines saved by other paths use per-unit overrides correctly and
-- must not be touched.
--
-- Idempotent guard: only runs against rows that haven't been corrected yet.
-- We use a small marker column to track this — `composer_hours_corrected
-- boolean` defaults false; migration flips to true after dividing.

BEGIN;

ALTER TABLE public.estimate_lines
  ADD COLUMN IF NOT EXISTS composer_hours_corrected boolean NOT NULL DEFAULT false;

UPDATE public.estimate_lines
   SET dept_hour_overrides = (
         SELECT jsonb_object_agg(
                  k,
                  CASE
                    WHEN v::text ~ '^-?[0-9]+(\.[0-9]+)?$' AND quantity > 0
                      THEN to_jsonb((v::text)::numeric / quantity)
                    ELSE v
                  END
                )
           FROM jsonb_each(dept_hour_overrides) AS kv(k, v)
       ),
       composer_hours_corrected = true
 WHERE product_key      IS NOT NULL
   AND product_slots    IS NOT NULL
   AND quantity         > 0
   AND dept_hour_overrides IS NOT NULL
   AND composer_hours_corrected = false;

COMMIT;

-- DOWN reference: there is no clean down — once divided, the original totals
-- are gone. If you need to revert, re-run the upstream save with the original
-- draft. Keep the marker column even on revert so future migrations can detect
-- corrected rows.
```

The marker column approach makes this safe to re-run if the migration partially fails. After this migration ships, leave `composer_hours_corrected` in place — future composer audits can check it.

### Verification (Code must do this before declaring done)

1. Apply migration 029 to a dev/staging DB with at least one existing composer line.
2. Open that subproject. The line table should render the SAME dollar total it would have rendered before the migration (because we divided overrides AND the save path now divides too — net effect on display is zero for already-saved lines, since `computeLineBuildup` does `per_unit × qty`).
3. Open AddLineComposer, build a new line with qty=8, capture the editor's "Line total" $ figure (e.g., $6,659).
4. Save the line. Editor closes, line appears in the table.
5. Line table TOTAL column for the new line should match the editor's "Line total" exactly. **Same number to the dollar.**
6. Click the line and check via the dev-tools network tab: `dept_hour_overrides` in the saved row should be PER-UNIT (e.g., 5 hours per LF), not totals.
7. Re-open the subproject in a fresh tab — number stays the same on reload.

Screenshot diff (editor vs line table) in PR description. If they differ even by $1, the bug is still there.

### Don't

- Don't rewrite `computeBreakdown` to return per-unit hours. The breakdown UI relies on totals to render the right-rail breakdown ("8 LF × $74/LF" etc.). Keep `computeBreakdown` semantics; only the save path needs to divide.
- Don't change `computeLineBuildup` to skip the `× qty` multiplication. Other code paths (rate-book-driven lines) rely on per-unit overrides.
- Don't add a second `composer_hours_corrected = false` row; the marker is permanent for a row.

---

## Issue 19 — restore line edit (composer in edit mode)

### What's wrong

Issue 15's handoff said "click does nothing" when removing the relic Selected-line side pane. That removed the only edit path for saved lines. Operators can delete lines but can't modify them.

### Fix

**Files:**
- `components/composer/AddLineComposer.tsx` (add edit mode)
- `lib/composer-persist.ts` (add `updateComposerLine`)
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` (line click handler → composer in edit mode)

### 1. AddLineComposer accepts an `editingLineId` prop

```ts
interface Props {
  subprojectId: string
  orgId: string
  // ... existing props
  /** When non-null, hydrates the composer with the existing line's
   *  product_key/product_slots/quantity and switches save → update. */
  editingLineId?: string | null
}
```

When `editingLineId` is non-null:

1. On mount, load the line:
```ts
const { data: line } = await supabase
  .from('estimate_lines')
  .select('id, product_key, product_slots, quantity, notes')
  .eq('id', editingLineId)
  .single()
```

2. If `line.product_key IS NULL` (legacy line, not composer-created), bail with an error toast: "This line was created before the composer existed and can't be edited here. Delete and recreate." Don't try to backfill.

3. Hydrate state directly into the composer's `view = 'composer'` mode:
```ts
setView('composer')
setDraft({
  productId: line.product_key as ProductKey,
  qty: Number(line.quantity) || 0,
  slots: { ...emptySlots(), ...(line.product_slots ?? {}), notes: line.notes ?? '' },
})
```

Skip the product-pick and last-used hydration — we're not opening fresh, we're loading existing.

4. Save button label: "Save changes" instead of "Add line" when `editingLineId` is non-null.

### 2. `lib/composer-persist.ts` — add `updateComposerLine`

```ts
export async function updateComposerLine(args: {
  lineId: string
  draft: ComposerDraft
  breakdown: ComposerBreakdown
  rateBook: ComposerRateBook
}): Promise<void> {
  // Mirror saveComposerLine shape but UPDATE instead of INSERT.
  const { lineId, draft, breakdown } = args
  const summary = summarizeSlots(draft.slots, /* args matching save path */)
  const description = /* compose same as save path */

  const qty = Number(draft.qty) || 0
  const deptHourOverrides: Record<string, number> = {}
  if (qty > 0) {
    if (breakdown.hoursByDept.eng > 0)      deptHourOverrides.eng      = breakdown.hoursByDept.eng      / qty
    if (breakdown.hoursByDept.cnc > 0)      deptHourOverrides.cnc      = breakdown.hoursByDept.cnc      / qty
    if (breakdown.hoursByDept.assembly > 0) deptHourOverrides.assembly = breakdown.hoursByDept.assembly / qty
    if (breakdown.hoursByDept.finish > 0)   deptHourOverrides.finish   = breakdown.hoursByDept.finish   / qty
  }

  const { error } = await supabase
    .from('estimate_lines')
    .update({
      description,
      quantity: draft.qty,
      product_slots: draft.slots,
      lump_cost_override: breakdown.totals.material,
      dept_hour_overrides: Object.keys(deptHourOverrides).length > 0 ? deptHourOverrides : null,
      notes: draft.slots.notes || null,
      composer_hours_corrected: true, // already correctly per-unit on this write
    })
    .eq('id', lineId)
  if (error) throw new Error(error.message || 'Failed to update line')
}
```

Note: `updateComposerLine` writes per-unit overrides (same divide-by-qty as the new save path). Stamps `composer_hours_corrected = true`.

In AddLineComposer's save handler, branch:

```ts
if (editingLineId) {
  await updateComposerLine({ lineId: editingLineId, draft, breakdown, rateBook })
} else {
  await saveComposerLine({ subprojectId, draft, breakdown, rateBook })
}
```

### 3. Subproject page — click handler

In `app/(app)/projects/[id]/subprojects/[subId]/page.tsx`:

```ts
const [composerOpen, setComposerOpen] = useState(false)
const [editingLineId, setEditingLineId] = useState<string | null>(null)

function openComposerForNew() {
  setEditingLineId(null)
  setComposerOpen(true)
}
function openComposerForLine(line: EstimateLine) {
  if (!line.product_key) {
    showToast("This line can't be edited in the composer.")
    return
  }
  setEditingLineId(line.id)
  setComposerOpen(true)
}
```

The line row's `onClick` (around line 680) sets `openComposerForLine(line)` instead of doing nothing.

The "+ Compose line" button up top calls `openComposerForNew()`.

When the composer closes (`onLineSaved` or `onCancel`), reset both `composerOpen` and `editingLineId` to null.

### Verification

1. Save a composer line. Click it. Composer opens with the line's qty + slots prefilled.
2. Change the qty from 8 to 10. Save. Line table updates qty + total.
3. Re-click the same line. Composer reopens with qty=10.
4. Click a non-composer line (rate-book line, no `product_key`). Toast appears, composer doesn't open.
5. Click "+ Compose line" up top. Composer opens fresh, no prefill.

---

## Issue 20 — un-nest Install from Labor in BREAKDOWN

### What's wrong

After Issue 17b shipped, the project BREAKDOWN renders Install as a CHILD of Labor (under a chevron expand) AND as a separate row at the bottom. Two issues:
- Labor row reads `0.0h est $0` because line-driven labor is empty, but the chevron suggests there's content underneath; expanding shows the install hours/$ which feels misleading (install isn't labor in the line-driven sense).
- The duplicate Install row at the bottom shows the marked-up total ($18,256) while the child-of-Labor Install shows the unmarked-up cost ($11,866). Same line item, two numbers.

### Fix

**File:** `app/(app)/projects/[id]/page.tsx` (BREAKDOWN section)

1. Remove Install from being a child of Labor. Drop the chevron-expand on Labor entirely if Install was its only child. Labor renders as a flat row: `Labor: ${proj.totalHours.toFixed(1)}h est ${money(proj.laborCost)}`.

2. Keep Install as a single peer-level row at the position it has now (after Options). Render with both hours AND marked-up $:

```tsx
<BreakdownRow
  label="Install"
  hours={proj.hoursByDept.install}
  value={money(proj.installCost)}
/>
```

3. If Labor row had any other expandable detail (per-dept hours breakdown), keep that — but Install is no longer one of them.

### Verification

Project with one composer subproject with install prefill `guys=10, days=10, complexity=0%` and 0 lines. Org's shop_rate set to a known value (e.g., $100/hr).

BREAKDOWN should render:
```
Labor:               0.0h est  $0
Material:                       $0
Consumables:                    $0
Specialty hardware:             $0
Options:                        $0
Install:           800.0h     $12,308   ← (8000 cost × 1.5385 markup at 35%)
```

Install appears ONCE, not twice. Labor has no chevron, no child rows.

---

## Issue 21 — change order from a line targets a slot, not the whole line

### What's wrong

Dogfood3 Issue 14's handoff treated lines as monolithic ("original material" → "proposed material"). But a composer line is a stack of slots:

> Base cabinet · Black liner · Slab door · Whiye oak · Stain + clear on slab · 4 end panels · 10 fillers

A real CO targets ONE slot — typically a material or a finish swap. The dogfood3 modal seeds the whole-line "original material" field, which doesn't match what operators are actually doing.

### Fix

**Files:**
- `components/change-orders.tsx` (CreateCoModal — add slot picker, recompute via composer math)
- `app/(app)/projects/[id]/subprojects/[subId]/page.tsx` (line-row "Create CO" handler — pass slot context)

### Modal redesign — slot-aware seed

The seed prop changes shape:

```ts
interface CreateCoModalSeed {
  subprojectId: string
  lineId: string
  productKey: ProductKey
  productSlots: ComposerSlots  // current slots from the line
  qty: number
  productLabel: string         // for header display
  // line description summary, for "Original" panel header
  description: string
}
```

When seeded, the modal renders THREE sections:

**1. Header.** "Change order on: ${productLabel} · ${qty} LF · ${description}". Subproject locked. Title input becomes optional with a placeholder that auto-generates from the slot change once chosen.

**2. Slot picker.** Dropdown or chip selector: "What's changing?" Options derived from the slot keys with labels:

| Slot key       | Label                | Input type for Proposed                              |
|----------------|----------------------|------------------------------------------------------|
| `qty`          | Quantity (LF)        | number                                               |
| `carcassMaterial` | Carcass material  | dropdown of `rateBook.carcassMaterials`              |
| `doorStyle`    | Door style           | dropdown of `rateBook.doorStyles`                    |
| `doorMaterial` | Door/drawer material | dropdown of `rateBook.extMaterials`                  |
| `interiorFinish` | Interior finish    | dropdown of interior finishes (incl Prefinished)     |
| `exteriorFinish` | Exterior finish    | dropdown of exterior finishes                        |
| `endPanels`    | End panels (count)   | number                                               |
| `fillers`      | Fillers (count)      | number                                               |

V1: support all eight slot keys. If user picks `qty`, both `productKey` and `slots` stay the same; only quantity changes.

**3. Original / Proposed panels.**

Left ("Original"): read-only display of the current slot value as a label (e.g., "Whiye oak" for `doorMaterial`). Sub-line: "Other specs: ..." listing the unchanged slots in a compact form.

Right ("Proposed"): the input matched to slot type (above table). Operator picks/types the new value.

### Net change math — recompute via composer

The modal recomputes both the original line breakdown and the proposed line breakdown using `computeBreakdown` from `lib/composer.ts`:

```ts
import { computeBreakdown, type ComposerDraft } from '@/lib/composer'

const originalDraft: ComposerDraft = {
  productId: seed.productKey,
  qty: seed.qty,
  slots: seed.productSlots,
}
const proposedDraft: ComposerDraft = {
  ...originalDraft,
  qty:   slotKey === 'qty'   ? Number(proposedQty)   : originalDraft.qty,
  slots: slotKey === 'qty'   ? originalDraft.slots
       : { ...originalDraft.slots, [slotKey]: proposedSlotValue },
}

const originalBreakdown = computeBreakdown(originalDraft, rateBook, defaults)
const proposedBreakdown = computeBreakdown(proposedDraft, rateBook, defaults)

const netChange = proposedBreakdown.totals.lineTotal - originalBreakdown.totals.lineTotal
```

`rateBook` and `defaults` are loaded by the modal from the subproject's org/rate-book context (same as AddLineComposer does on open). Plumb them through the modal's parent.

The modal's NET CHANGE box displays `netChange` (auto-computed; no manual entry needed unless the operator overrides). The "Not enough info to auto-price" banner only appears if a slot value can't be resolved (e.g., proposed door style isn't calibrated yet).

### CO record on save

Existing schema (`change_orders.original_line_snapshot` + `proposed_line` as `LineSnapshot`) doesn't have a slot-level shape. For V1, keep the schema and write the snapshot as a flattened summary:

```ts
const slotLabel = SLOT_LABELS[slotKey]  // "Door material", etc.
const origValue = originalSlotValueLabel(seed.productSlots, slotKey, rateBook)  // "Whiye oak"
const propValue = proposedSlotValueLabel(proposedSlotValue, slotKey, rateBook)   // "White oak rift"

const origSnap: LineSnapshot = {
  label: seed.description,
  material: slotLabel === 'Door material' ? origValue : `${slotLabel}: ${origValue}`,
  linear_feet: seed.qty,
  material_cost_per_lf: null,  // set if you can derive it; null is fine
  labor_hours_eng: 0, labor_hours_cnc: 0, labor_hours_assembly: 0, labor_hours_finish: 0, labor_hours_install: 0,
}
const propSnap: LineSnapshot = {
  label: seed.description,
  material: slotLabel === 'Door material' ? propValue : `${slotLabel}: ${propValue}`,
  linear_feet: seed.qty,
  material_cost_per_lf: null,
  labor_hours_eng: 0, labor_hours_cnc: 0, labor_hours_assembly: 0, labor_hours_finish: 0, labor_hours_install: 0,
  notes: notes || undefined,
}
```

Auto-title: `${slotLabel}: ${origValue} → ${propValue}`. Operator can override.

`net_change` = computed `netChange` from above. `no_price_change` checkbox stays available for documentation-only COs.

### Top-level "+ New CO" button

Stays as fallback, opens the legacy modal with no seed. Title required, manual entry. Use case: COs that don't map to a single line (project-level scope additions, custom adjustments).

### Verification

1. Save a composer line at qty=8 with door material "Whiye oak."
2. Click "Create CO" on the line.
3. Modal opens with header "Change order on: Base · 8 LF · ${description}". Slot picker shown.
4. Pick "Door/drawer material." Proposed dropdown shows other materials (not Whiye oak as default).
5. Pick "White oak rift." Net change updates live to reflect the material delta.
6. Title autofills "Door material: Whiye oak → White oak rift."
7. Save. CO appears on the project's CO list with the right delta.
8. Top-level "+ New CO" button still opens the legacy modal with required Title + manual entry.

### Don't

- Don't change the `change_orders` schema in this PR. Squash slot detail into the existing `original_line_snapshot.material` text field. Schema-level slot tracking is a future migration if it proves needed.
- Don't auto-apply the CO to the line. CO is a record of agreement; the line stays as it was. Application-to-line is a separate flow (preprod approvals).
- Don't recompute `material_cost_per_lf` or labor hours into the snapshot — leave them null/zero. The `net_change` field is the source of truth for the dollar delta; the snapshot is for display.

---

## Invariants (cumulative)

- Dark mode only in WelcomeOverlay.
- Sheets-per-LF never asked.
- Interior ≠ Exterior; both filter on `application`.
- Per-dept $ is dead.
- `activity_type` is dead.
- Prefinished is a client-side sentinel.
- Settings page reads from JSON columns on `orgs`.
- Selected-line side pane stays gone — line click opens AddLineComposer in edit mode (NEW from Issue 19).
- Shop rate is NULL until walkthrough completes; no `|| 75` or `|| 0` fallbacks.
- Install hours live in `hoursByDept.install` only; surface on Install BREAKDOWN row.
- **NEW:** `dept_hour_overrides` are per-unit. Composer save divides by qty before write. Composer-saved lines tracked via `composer_hours_corrected` column.
- **NEW:** CO from a line targets a single slot. Top-level "+ New CO" stays as fallback.

---

## When you're done

Update `BUILD-ORDER.md` Phase 12 close-out notes with the four PR refs. Don't cut the close-out commit. Issues 18, 19, 20, 21 each as their own PR. Land in order: 18 → 19 → 20 → 21.

After EACH PR merges, ping Andrew with the verification screenshot/numbers from this doc. Wait for his confirmation before starting the next one.

// ============================================================================
// lib/parser-slot-resolver.ts — parser slot hints → rate-book ids
// ============================================================================
// Bridges the parser's free-text slot hints (Claude reads "white oak",
// "shaker", "matte clear" off the drawing) to the org's actual rate-book
// rows. Two-stage match per slot: exact case-insensitive name first,
// then a substring containment fallback. Never invents an id —
// unmatched hints land as null so the line saves with partial slots
// and the composer's missing-slot hint surfaces them for the operator
// to fill in.
//
// Door material + door finish are SCOPED to their parent door type:
// matchByName runs against the per-type / per-material list from the
// loader's cascading-dropdown maps, not the global flat lists. This
// keeps "Slab Oak" from matching the slab door's material when the
// parsed door type was actually shaker.
// ============================================================================

import { loadComposerRateBook } from './composer-loader'
import { PREFINISHED_FINISH_ID, type ComposerSlots } from './composer'
import type { ParsedSlotHints } from './pdf-parser'

interface NamedRow {
  id: string
  name: string
}

/** Two-stage name match. Exact (case-insensitive, whitespace-collapsed)
 *  first, then bidirectional substring containment (either side >=4
 *  chars to avoid spurious matches on short tokens like "oak"). Never
 *  fuzzy / Levenshtein — we don't want clever, we want predictable. */
function matchByName<T extends NamedRow>(
  rows: T[] | undefined,
  parsedName: string | null | undefined,
): T | null {
  if (!rows || rows.length === 0) return null
  if (!parsedName || !parsedName.trim()) return null
  const target = parsedName.trim().toLowerCase().replace(/\s+/g, ' ')
  const exact = rows.find((r) => r.name.trim().toLowerCase() === target)
  if (exact) return exact
  for (const r of rows) {
    const n = r.name.trim().toLowerCase()
    if (n.length >= 4 && target.includes(n)) return r
    if (target.length >= 4 && n.includes(target)) return r
  }
  return null
}

/** Resolve a parser's slot hints against the org's composer rate book.
 *  Returns ComposerSlots with null for any unmatched slot. Drawer
 *  count, end panels, and fillers come straight from numeric hints
 *  (default 0 when missing — matches the composer's empty-line shape). */
/** All-null slots — used as a fallback when the rate book can't load
 *  (org hasn't run any walkthroughs yet, network error, etc.). The
 *  composer happily renders missing slots with $0 contribution and
 *  the "Needs slots" pill flags the line for the operator. */
export function emptySlots(): ComposerSlots {
  return {
    carcassMaterial: null,
    backPanelMaterial: null,
    doorTypeId: null,
    doorMaterialId: null,
    doorFinishId: null,
    interiorFinish: null,
    endPanels: 0,
    fillers: 0,
    drawerCount: 0,
    drawerStyle: null,
    notes: '',
  }
}

export async function resolveSlots(
  orgId: string,
  hints: ParsedSlotHints | null | undefined,
): Promise<ComposerSlots> {
  try {
    const rb = await loadComposerRateBook(orgId)
    return resolveSlotsAgainstRateBook(rb, hints)
  } catch (err) {
    console.warn('resolveSlots: rate-book load failed, falling back to empty slots', err)
    return emptySlots()
  }
}

/** Pure slot-resolution against an already-loaded rate book. Caller
 *  uses this when seeding many lines in one go (load the rate book
 *  once, resolve N items). resolveSlots() above wraps this for the
 *  one-off case. */
export function resolveSlotsAgainstRateBook(
  rb: Awaited<ReturnType<typeof loadComposerRateBook>> | null | undefined,
  hints: ParsedSlotHints | null | undefined,
): ComposerSlots {
  if (!rb) {
    // Even with no rate book, we should still record the parsed
    // strings so the composer can offer to calibrate them later.
    const empty = emptySlots()
    if (hints) {
      empty.carcassMaterialUnmatched = nonEmpty(hints.carcass_material)
      empty.doorTypeUnmatched = nonEmpty(hints.door_style)
      empty.doorMaterialUnmatched = nonEmpty(hints.door_material)
      empty.doorFinishUnmatched = nonEmpty(hints.exterior_finish)
      empty.interiorFinishUnmatched =
        nonEmpty(hints.interior_finish) === 'prefinished'
          ? null
          : nonEmpty(hints.interior_finish)
    }
    return empty
  }
  const h = hints || {}

  const carcass = matchByName(rb.carcassMaterials, h.carcass_material)
  const backPanel = matchByName(rb.backPanelMaterials, null) // parser doesn't extract back-panel today

  const doorType = matchByName(rb.doorTypes, h.door_style)
  // DoorTypeMaterial / DoorTypeMaterialFinish carry the display
  // name on a different field (material_name / finish_name) — wrap
  // them as NamedRow so matchByName works without bespoke logic.
  const doorMaterials = doorType
    ? (rb.doorTypeMaterialsByTypeId.get(doorType.id) ?? []).map((m) => ({
        id: m.id,
        name: m.material_name,
      }))
    : []
  const doorMaterial = matchByName(doorMaterials, h.door_material)

  const doorFinishes = doorMaterial
    ? (rb.doorFinishesByMaterialId.get(doorMaterial.id) ?? []).map((f) => ({
        id: f.id,
        name: f.finish_name,
      }))
    : []
  // exterior_finish is the door-side finish hint — match against
  // finishes scoped to the picked material.
  const doorFinish = matchByName(doorFinishes, h.exterior_finish)

  // Interior finish — handle the "prefinished" sentinel up front so
  // the composer treats the line as zero finish labor/cost. Otherwise
  // match against the flat finishes list.
  let interiorFinish: string | null = null
  let interiorFinishUnmatched: string | null = null
  const interiorHint = h.interior_finish?.trim().toLowerCase()
  if (interiorHint === 'prefinished') {
    interiorFinish = PREFINISHED_FINISH_ID
  } else {
    const f = matchByName(rb.finishes, h.interior_finish)
    if (f) {
      interiorFinish = f.id
    } else if (h.interior_finish && h.interior_finish.trim()) {
      interiorFinishUnmatched = h.interior_finish.trim()
    }
  }

  const drawerCount = Number.isFinite(h.drawer_count as number)
    ? Math.max(0, Math.round(Number(h.drawer_count)))
    : 0
  const endPanels = Number.isFinite(h.end_panel_count as number)
    ? Math.max(0, Math.round(Number(h.end_panel_count)))
    : 0
  const fillers = Number.isFinite(h.filler_count as number)
    ? Math.max(0, Math.round(Number(h.filler_count)))
    : 0

  // Persist unmatched strings on the slot so the composer dropdown
  // can render "FROM DRAWINGS · NOT YET CALIBRATED · {value}
  // [+ Calibrate]" at the top. Only set when the parsed hint had a
  // value AND no match was found.
  return {
    carcassMaterial: carcass?.id ?? null,
    backPanelMaterial: backPanel?.id ?? null,
    doorTypeId: doorType?.id ?? null,
    doorMaterialId: doorMaterial?.id ?? null,
    doorFinishId: doorFinish?.id ?? null,
    interiorFinish,
    endPanels,
    fillers,
    drawerCount,
    drawerStyle: null,
    notes: '',
    carcassMaterialUnmatched: !carcass ? nonEmpty(h.carcass_material) : null,
    doorTypeUnmatched: !doorType ? nonEmpty(h.door_style) : null,
    doorMaterialUnmatched: !doorMaterial ? nonEmpty(h.door_material) : null,
    doorFinishUnmatched: !doorFinish ? nonEmpty(h.exterior_finish) : null,
    interiorFinishUnmatched,
    backPanelMaterialUnmatched: null,
  }
}

function nonEmpty(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

/** Required slots for a given product key. The needs-slots indicator
 *  in the subproject line table reads this to decide whether to flag
 *  a partially-priced composer line. Keep aligned with the composer's
 *  pricing inputs — slots that can produce $0 without warning don't
 *  belong here. */
export function requiredSlotsFor(
  productKey: 'base' | 'upper' | 'full' | 'drawer',
): Array<keyof ComposerSlots> {
  // V1 — same required-slot set across the four cabinet products.
  // Drawer-only banks technically don't need door slots, but seeding
  // is rare so we lean conservative; refine if it nags too much.
  if (productKey === 'drawer') {
    return ['carcassMaterial', 'interiorFinish']
  }
  return ['carcassMaterial', 'doorTypeId', 'doorMaterialId', 'doorFinishId', 'interiorFinish']
}

/** True when any required slot for the line's product_key is null —
 *  drives the "needs slots" amber pill on subproject line rows. */
export function hasMissingSlots(
  productKey: 'base' | 'upper' | 'full' | 'drawer',
  slots: ComposerSlots | null | undefined,
): boolean {
  if (!slots) return true
  for (const key of requiredSlotsFor(productKey)) {
    const v = (slots as any)[key]
    if (v == null || v === '') return true
  }
  return false
}

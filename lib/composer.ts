// ============================================================================
// lib/composer.ts — add-line composer types + pricing math
// ============================================================================
// Pure compute. No I/O. The component loads data, shapes it into
// ComposerRateBook + ComposerDefaults, then calls computeBreakdown for
// the live right-rail update on every slot change.
//
// Labor $ math: total_hours × orgs.shop_rate. Per Phase 12 item 12, the
// per-department rate layer was deprecated — the shop rate walkthrough
// derives a single blended rate. Per-dept hours are still captured (for
// scheduling / time-tracking) and summed here before the multiply.
//
// Hardcoded constants (end panel labor + material, filler labor + material)
// match the prototype literal values. Spec calls these out as V1 defaults;
// V2 lifts them into the rate book.
// ============================================================================

import { PRODUCTS, type Product, type ProductKey } from './products'
import type {
  DoorType,
  DoorTypeMaterial,
  DoorTypeMaterialFinish,
} from './door-types'

/** Per-LF carcass labor hours, from the "Base cabinet" rate_book_item's
 *  base_labor_hours_*. Reused across Base / Upper / Full per the spec. */
export interface ComposerCarcassLabor {
  eng: number
  cnc: number
  assembly: number
  finish: number
}

export interface ComposerCarcassMaterial {
  id: string
  name: string
  sheet_cost: number
  sheets_per_lf: number
}

export interface ComposerExtMaterial {
  id: string
  name: string
  sheet_cost: number
}

export interface ComposerDoorStyle {
  id: string
  name: string
  /** Per-door (post-÷4) labor by dept; 0 for every dept = uncalibrated. */
  labor: {
    eng: number
    cnc: number
    assembly: number
    finish: number
  }
  /** true iff any dept has non-zero per-door labor. V1 treats "all zero"
   *  as "not calibrated"; item 7 walkthrough populates the values. */
  calibrated: boolean
  /** Per-unit hardware cost ($). Drawer styles use this for slides + pulls
   *  + anything that ships per-drawer (drawer_hardware_cost on
   *  rate_book_items). Door styles leave this 0 — they don't ship with
   *  per-door hardware in V1. */
  hardwareCost: number
}

/** A finish item plus its per-product calibration rows. Missing product
 *  keys in byProduct mean "not calibrated for that cab height." */
export interface ComposerFinish {
  id: string
  name: string
  /** Which composer dropdown the finish belongs to. DB rows carry
   *  'interior' or 'exterior' via migration 025. The client-side
   *  Prefinished sentinel is 'interior'. */
  application: 'interior' | 'exterior'
  /** true for the client-side Prefinished sentinel — byProduct entries
   *  all zero, treated as always-valid and labor-free. Never true on a
   *  DB-loaded finish. */
  isPrefinished: boolean
  byProduct: {
    base?: ComposerFinishProductRow
    upper?: ComposerFinishProductRow
    full?: ComposerFinishProductRow
  }
}

/** Client-side sentinel id for the Prefinished option. Lives at the top
 *  of the Interior finish dropdown; not a rate-book row. */
export const PREFINISHED_FINISH_ID = '__prefinished__'

/** A DB-loaded finish counts as "used" when at least one product
 *  category has non-zero per-LF labor OR material. Lets the composer
 *  hide the blank combo rows that FinishWalkthrough creates on first
 *  open so the operator isn't picking from four zero-cost options.
 *  Prefinished sentinel is always used (zero is the whole point). */
export function isFinishUsed(f: ComposerFinish): boolean {
  if (f.isPrefinished) return true
  const cats: Array<'base' | 'upper' | 'full'> = ['base', 'upper', 'full']
  for (const p of cats) {
    const row = f.byProduct[p]
    if (!row) continue
    if (row.laborHr > 0 || row.material > 0) return true
  }
  return false
}

/** Build the Prefinished sentinel that the composer prepends to the
 *  Interior finish dropdown. Zero everywhere, marked interior. */
export function prefinishedSentinel(): ComposerFinish {
  return {
    id: PREFINISHED_FINISH_ID,
    name: 'Prefinished',
    application: 'interior',
    isPrefinished: true,
    byProduct: {
      base: { laborHr: 0, material: 0 },
      upper: { laborHr: 0, material: 0 },
      full: { laborHr: 0, material: 0 },
    },
  }
}

export interface ComposerFinishProductRow {
  /** Per-LF labor hours for this product category. */
  laborHr: number
  /** Per-LF material cost, summed across primer/paint/stain/lacquer. */
  material: number
}

export interface ComposerRateBook {
  /** Single blended rate from orgs.shop_rate, applied to total hours. */
  shopRate: number
  carcassLabor: ComposerCarcassLabor
  /** "Base cabinet" item row exists and at least one dept is non-zero.
   *  When false, the composer should surface "run BaseCabinetWalkthrough
   *  first" and block save. */
  carcassCalibrated: boolean
  carcassMaterials: ComposerCarcassMaterial[]
  extMaterials: ComposerExtMaterial[]
  /** Back-panel sheet stock, kept in its own pool so face stock (Walnut,
   *  White oak, etc.) doesn't appear as a back-panel option. Same flat
   *  shape as ext: just name + sheet_cost. Sourced from rate_book_items
   *  under a category whose item_type='back_panel_material'. */
  backPanelMaterials: ComposerExtMaterial[]
  /** Door pricing v2 — door types, scoped materials, scoped finishes.
   *  doorTypeMaterialsByTypeId / doorFinishesByMaterialId drive the
   *  cascading composer dropdowns. Flat lookup arrays let id-based
   *  resolves (approvals, summarizeSlots) skip iterating maps. */
  doorTypes: DoorType[]
  doorTypeMaterialsByTypeId: Map<string, DoorTypeMaterial[]>
  doorFinishesByMaterialId: Map<string, DoorTypeMaterialFinish[]>
  doorTypeMaterials: DoorTypeMaterial[]
  doorTypeMaterialFinishes: DoorTypeMaterialFinish[]
  /** Drawer styles — same shape as the legacy ComposerDoorStyle. Per-drawer
   *  labor stored on rate_book_items.drawer_labor_hours_*. Base-only. */
  drawerStyles: ComposerDoorStyle[]
  finishes: ComposerFinish[]
}

/** Per-subproject markup inputs — editable inline on the breakdown panel,
 *  persisted to subprojects.defaults on change. */
export interface ComposerDefaults {
  consumablesPct: number
  wastePct: number
}

// ── Draft shape + slot types ──

export interface ComposerSlots {
  carcassMaterial: string | null
  /** Back-panel sheet stock (1/4" ply typical). Picked from a dedicated
   *  back-panel pool — separate from face stock. Null = no back panel
   *  material priced (rare but valid for open-back specials). */
  backPanelMaterial: string | null
  /** Door-pricing-v2 trio: cascading picks. doorTypeId selects the door
   *  type (labor + hardware live there); doorMaterialId selects a
   *  material scoped to that type (cost_value + unit); doorFinishId
   *  selects a finish scoped to that material (per-door labor + per-door
   *  $). Picking a parent slot clears the children. */
  doorTypeId: string | null
  doorMaterialId: string | null
  doorFinishId: string | null
  interiorFinish: string | null
  endPanels: number
  fillers: number
  /** Drawer count and style. Base-only product slots; Upper / Full leave
   *  drawerCount=0 + drawerStyle=null and the composer hides the section. */
  drawerCount: number
  drawerStyle: string | null
  notes: string
  /** Door-side LF when it differs from the carcass run. null = match
   *  draft.qty (same LF for carcass + doors — every kitchen, most
   *  base/upper runs). Set explicitly for closet built-ins or runs
   *  with mixed open + door sections: 14 LF carcass + 6 LF doors
   *  prices the box at 14 and the doors / exterior finish at 6.
   *  Existing lines saved before this field was added carry null and
   *  fall back to the carcass LF — no migration needed. Clamped to
   *  draft.qty in the composer; values > draft.qty are operator
   *  errors caught at the input. */
  qty_doors?: number | null
}

export interface ComposerDraft {
  productId: ProductKey
  qty: number
  slots: ComposerSlots
}

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
    qty_doors: null,
  }
}

/** Human label for a product key. Mirrors what composer-persist.ts
 *  bakes into estimate_lines.description as the leading segment, so
 *  callers can strip "{label} · " from the description to get just
 *  the slot summary. Inactive products (drawer/led/countertop) fall
 *  through to the raw key string — they don't ship as composer
 *  outputs in V1. */
export function productLabelFromKey(key: ProductKey): string {
  if (key === 'base') return 'Base cabinet'
  if (key === 'upper') return 'Upper cabinet'
  if (key === 'full') return 'Full height'
  return key
}

/** Count the finish-spec slots set on a composer line:
 *    +1 if carcassMaterial is set
 *    +1 if doorMaterialId is set
 *    +1 if doorFinishId is set
 *  Freeform / rate-book lines (no slots) return 0. Used by surfaces
 *  that previously read line.finish_specs.length (legacy field). */
export function countFinishSpecsFromSlots(
  slots: Partial<ComposerSlots> | null | undefined
): number {
  if (!slots) return 0
  let count = 0
  if (slots.carcassMaterial) count++
  if (slots.doorMaterialId) count++
  if (slots.doorFinishId) count++
  return count
}

/** Convert a door-type material's cost_unit into "cost per door."
 *  - 'sheet': cost is per-sheet; sheets-per-door = sheetsPerLfFace ÷ doorsPerLf.
 *  - 'ea' / 'lump': cost is already-per-door (or per-line lump treated as
 *    per-door for V1 — operator does the math when entering the cost).
 *  - 'lf' / 'bf': operator entered the cost as already-per-door's-worth
 *    (V1 simplification — no auto conversion). Surfaced on the breakdown
 *    detail so the operator can sanity-check.
 */
export function materialCostPerDoor(
  cost_unit: string | undefined,
  prod: Product,
): number {
  switch (cost_unit) {
    case 'sheet': {
      const dpl = Math.max(prod.doorsPerLf, 1e-9)
      return prod.sheetsPerLfFace / dpl
    }
    case 'ea':
    case 'lump':
    case 'lf':
    case 'bf':
    default:
      return 1
  }
}

// ── Breakdown output ──

export interface ComposerBreakdown {
  /** Carcass-side LF — the cabinet box run that drives carcass labor,
   *  carcass + back-panel sheets, and interior finish. Mirrors
   *  draft.qty after the >0 guard. */
  qtyCarcass: number
  /** Door-side LF — the subset of qtyCarcass that has doors. Drives
   *  doorsPerLine, door labor, door material, exterior finish. Falls
   *  back to qtyCarcass when slots.qty_doors is null (every kitchen
   *  case). Always clamped to qtyCarcass. */
  qtyDoors: number
  carcassLabor: number
  carcassLaborPerLf: number
  carcassMaterial: number
  carcassMaterialDetail: string | null
  backPanelMaterial: number
  backPanelMaterialDetail: string | null

  doorLabor: number
  doorLaborPerLf: number
  doorLaborWarn: boolean
  doorMaterial: number
  doorMaterialDetail: string | null
  /** True when the door type is picked but the door material slot is
   *  null. Surfaces a "pick a material to price" inline hint in the
   *  breakdown panel. Door material cost stays $0 in this state — the
   *  hint just makes the missing-pick obvious instead of silent. */
  doorMaterialMissing: boolean
  /** True when the door material is picked but the door finish slot
   *  is null. Same hint pattern as doorMaterialMissing. */
  doorFinishMissing: boolean
  /** Door type hardware × door count. Per door pricing v2 — dt.hardware_cost
   *  applied at doorsPerLine. */
  doorHardware: number
  /** Per-door numerics for the breakdown panel's ($X/door) annotations.
   *  All zero when the underlying slot isn't picked. avgPerDoor sums
   *  labor + material + finish + hardware so the breakdown can render a
   *  single roll-up at the bottom of the door section. */
  doorsPerLine: number
  doorLaborPerDoor: number
  doorMaterialPerDoor: number
  doorFinishLaborPerDoor: number
  doorFinishMaterialPerDoor: number
  doorHardwarePerDoor: number
  avgPerDoor: number

  /** Drawer-slot rollup. drawerLaborWarn fires when drawerCount>0 but the
   *  drawer style isn't calibrated; the breakdown panel shows a hint and
   *  drawer labor contributes 0 until the operator calibrates. drawerHardware
   *  is per-drawer hardware $ × count (slides + pulls). */
  drawerLabor: number
  drawerLaborWarn: boolean
  drawerLaborDetail: string | null
  drawerMaterial: number
  drawerMaterialDetail: string | null
  drawerHardware: number

  interiorFinishLabor: number
  interiorFinishMaterial: number
  interiorFinishDetail: string | null
  exteriorFinishLabor: number
  exteriorFinishMaterial: number
  exteriorFinishDetail: string | null

  endPanelsLabor: number
  endPanelsMaterial: number
  endPanelsCount: number
  fillersLabor: number
  fillersMaterial: number
  fillersCount: number

  materialSubtotal: number
  consumablesPct: number
  consumables: number
  wastePct: number
  waste: number

  totals: {
    labor: number
    material: number
    total: number
  }

  /** Per-dept labor hours — used to populate estimate_lines.
   *  dept_hour_overrides so the existing subproject rollup compute
   *  (lib/estimate-lines.computeSubprojectRollup) renders the composer
   *  line correctly without knowing about composer internals. */
  hoursByDept: {
    eng: number
    cnc: number
    assembly: number
    finish: number
  }
}

// ── Hardcoded V1 constants ──
// Filler/scribes is a flat per-unit approximation. End panels under door
// pricing v2 = one full-door rollup per panel (labor + material + finish
// labor + finish material + hardware) — the legacy 2-LF formula is gone.
const FILLER_LABOR_HR = 0.5         // applied at assembly-dept rate
const FILLER_MATERIAL = 18          // dollars per each

// ── The compute ──

export function computeBreakdown(
  draft: ComposerDraft,
  rb: ComposerRateBook,
  defaults: ComposerDefaults
): ComposerBreakdown {
  const prod: Product = PRODUCTS[draft.productId]
  // Two LF inputs: qtyCarcass is the cabinet box run (everything that
  // gets a back, sides, and shelves); qtyDoors is the subset of that
  // run that actually has doors on it. Standard kitchen runs have
  // doors on every section, so qty_doors==null falls back to
  // qtyCarcass and pricing is unchanged. Closet built-ins with mixed
  // open + door sections set qty_doors explicitly.
  const qtyCarcass = Number.isFinite(draft.qty) && draft.qty > 0 ? draft.qty : 0
  const s = draft.slots
  const qtyDoorsRaw = s.qty_doors == null ? qtyCarcass : Number(s.qty_doors)
  const qtyDoors =
    Number.isFinite(qtyDoorsRaw) && qtyDoorsRaw >= 0
      ? Math.min(qtyDoorsRaw, qtyCarcass) // clamp — never bill more doors than carcass
      : qtyCarcass
  const rate = Number(rb.shopRate) || 0
  const cl = rb.carcassLabor

  // Carcass labor — 4 depts captured for scheduling, but priced at the
  // single blended shop rate. Wood machining is already rolled into
  // assembly (BaseCabinetWalkthrough's save folds it in).
  const carcassHoursPerLf = cl.eng + cl.cnc + cl.assembly + cl.finish
  const carcassLaborPerLf = carcassHoursPerLf * rate
  const carcassLabor = qtyCarcass * carcassLaborPerLf

  const carcassHoursByDept = {
    eng: qtyCarcass * cl.eng,
    cnc: qtyCarcass * cl.cnc,
    assembly: qtyCarcass * cl.assembly,
    finish: qtyCarcass * cl.finish,
  }

  const cm = rb.carcassMaterials.find((m) => m.id === s.carcassMaterial) || null
  const bm = rb.backPanelMaterials.find((m) => m.id === s.backPanelMaterial) || null
  // Door pricing v2: cascading lookups against the new tables. The
  // doorMaterials/doorFinishes flat arrays let us resolve by id without
  // walking the by-parent maps (those drive dropdowns, not lookups).
  const dt = rb.doorTypes.find((t) => t.id === s.doorTypeId) || null
  const dm = s.doorMaterialId
    ? rb.doorTypeMaterials.find((m) => m.id === s.doorMaterialId) || null
    : null
  const df = s.doorFinishId
    ? rb.doorTypeMaterialFinishes.find((f) => f.id === s.doorFinishId) || null
    : null
  const drs = rb.drawerStyles.find((d) => d.id === s.drawerStyle) || null
  const ifn = rb.finishes.find((f) => f.id === s.interiorFinish) || null

  // Carcass sheets/LF comes from the product's dedicated carcass constant
  // (3/4" ply yield, much higher than face yield because every cab eats
  // sides + bottom + shelf + nailers — face math underpriced this badly
  // before sheetsPerLfCarcass was split out from sheetsPerLfFace).
  const carcassSheets = qtyCarcass * prod.sheetsPerLfCarcass
  const carcassMaterial = cm ? carcassSheets * cm.sheet_cost : 0
  const carcassMaterialDetail = cm
    ? `${carcassSheets.toFixed(2)} sht × $${cm.sheet_cost}`
    : null

  // Back panel — separate stock (1/4" ply typical) picked from the same
  // extMaterials pool as door faces. Per-LF ratio mirrors the legacy
  // face-sheet ratio because back-panel area scales with cabinet face.
  const backPanelSheets = qtyCarcass * prod.sheetsPerLfBack
  const backPanelMaterial = bm ? backPanelSheets * bm.sheet_cost : 0
  const backPanelMaterialDetail = bm
    ? `${backPanelSheets.toFixed(2)} sht × $${bm.sheet_cost}`
    : null

  // Doors per line — count of doors this run carries, scaled by the
  // door-side LF only. Pure open shelving (qtyDoors=0) → 0 doors,
  // every door-side cost zeroes out cleanly.
  const doorsPerLine = qtyDoors * prod.doorsPerLf

  // Door type labor — sum per-door dept hours × door count.
  let doorHoursByDept = { eng: 0, cnc: 0, assembly: 0, finish: 0 }
  let doorLabor = 0
  if (dt && dt.calibrated) {
    doorHoursByDept = {
      eng: doorsPerLine * dt.labor_hours_eng,
      cnc: doorsPerLine * dt.labor_hours_cnc,
      assembly: doorsPerLine * dt.labor_hours_assembly,
      finish: doorsPerLine * dt.labor_hours_finish,
    }
    const totalHours =
      doorHoursByDept.eng +
      doorHoursByDept.cnc +
      doorHoursByDept.assembly +
      doorHoursByDept.finish
    doorLabor = totalHours * rate
  }
  // Per-LF here is "per LF of door run", so divide by qtyDoors. With
  // qtyDoors=0 the divide is guarded and the value reads 0.
  const doorLaborPerLf = doorsPerLine > 0 ? doorLabor / Math.max(qtyDoors, 1e-9) : 0
  const doorLaborWarn = !!s.doorTypeId && dt !== null && !dt.calibrated

  // Door material — cost_value × per-door conversion × door count.
  const matPerDoor = dm ? materialCostPerDoor(dm.cost_unit, prod) : 0
  const doorMaterial = dm ? doorsPerLine * dm.cost_value * matPerDoor : 0
  const doorMaterialDetail = dm
    ? `${doorsPerLine.toFixed(2)} doors × $${dm.cost_value}/${dm.cost_unit}` +
      (dm.cost_unit === 'sheet' ? ` (${matPerDoor.toFixed(3)} sht/door)` : '')
    : null

  // Door hardware — per-type × door count. 0 for door types without
  // hardware on file.
  const doorHardware = dt ? doorsPerLine * (dt.hardware_cost || 0) : 0

  // Per-door rolls for the breakdown panel's ($X/door) annotations.
  // safeDoors guards the divides — when doorsPerLine rounds to 0 (qty 0
  // or a product with doorsPerLf=0), every per-door reads 0.
  const safeDoors = doorsPerLine > 0 ? doorsPerLine : 0
  const doorLaborPerDoor = safeDoors > 0 ? doorLabor / safeDoors : 0
  const doorMaterialPerDoor = safeDoors > 0 ? doorMaterial / safeDoors : 0
  const doorHardwarePerDoor = dt ? dt.hardware_cost || 0 : 0

  // Drawers — Base only. drawerCount × per-drawer hours by dept.
  // Drawer fronts pull from the doorMaterial slot (faces are the same
  // stock); sheetsPerDrawerFront is a small constant per product (0 on
  // products that don't carry drawers, so the math zeroes itself).
  const drawerCount = Math.max(0, Math.round(s.drawerCount || 0))
  let drawerHoursByDept = { eng: 0, cnc: 0, assembly: 0, finish: 0 }
  let drawerLabor = 0
  let drawerLaborDetail: string | null = null
  if (drawerCount > 0 && drs && drs.calibrated) {
    drawerHoursByDept = {
      eng: drawerCount * drs.labor.eng,
      cnc: drawerCount * drs.labor.cnc,
      assembly: drawerCount * drs.labor.assembly,
      finish: drawerCount * drs.labor.finish,
    }
    const totalHours =
      drawerHoursByDept.eng + drawerHoursByDept.cnc +
      drawerHoursByDept.assembly + drawerHoursByDept.finish
    drawerLabor = totalHours * rate
    drawerLaborDetail = `${drawerCount} × ${drs.name}`
  } else if (drawerCount > 0 && drs) {
    drawerLaborDetail = `${drawerCount} × ${drs.name} (uncalibrated)`
  } else if (drawerCount > 0) {
    drawerLaborDetail = `${drawerCount} drawer${drawerCount === 1 ? '' : 's'} — pick a style to price`
  }
  const drawerLaborWarn = drawerCount > 0 && (!drs || !drs.calibrated)

  // Drawer fronts share the door material slot under v2. We only know how
  // to convert sheet-unit costs into a per-front cost (sheetsPerDrawerFront
  // is already a per-drawer ratio); other units leave drawer material at 0
  // until the operator switches to a sheet-unit material or we add explicit
  // per-front conversions.
  const drawerSheets = drawerCount * prod.sheetsPerDrawerFront
  const drawerMaterial =
    drawerCount > 0 && dm && dm.cost_unit === 'sheet'
      ? drawerSheets * dm.cost_value
      : 0
  const drawerMaterialDetail =
    drawerCount > 0 && dm && dm.cost_unit === 'sheet'
      ? `${drawerSheets.toFixed(2)} sht × $${dm.cost_value}`
      : null
  const drawerHardware = drawerCount > 0 && drs ? drawerCount * (drs.hardwareCost || 0) : 0

  // Finishes — per-LF labor hours + per-LF material, per product
  // category. Prefinished or missing byProduct row → zero, no error.
  // Labor $ applies the blended shop rate. Interior finish is a
  // carcass-side cost (scales with qtyCarcass — every cabinet box
  // gets an interior surface).
  function finishLabor(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qtyCarcass * row.laborHr * rate
  }
  function finishMaterial(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qtyCarcass * row.material
  }
  function finishLaborHours(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qtyCarcass * row.laborHr
  }
  function finishDetail(f: ComposerFinish | null): string | null {
    if (!f) return null
    if (f.isPrefinished) return 'prefinished, no labor'
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 'not calibrated for this category'
    const perLf = row.laborHr * rate + row.material
    return `${qtyCarcass} LF × $${Math.round(perLf)}/LF`
  }

  const interiorFinishLabor = finishLabor(ifn)
  const interiorFinishMaterial = finishMaterial(ifn)
  // Door pricing v2: the "exterior finish" slot is now a door-material-
  // scoped finish row (door_type_material_finishes). Per-door labor +
  // per-door material costs come from there directly — no per-product
  // calibration row.
  const doorFinishLabor = df ? doorsPerLine * df.labor_hours_per_door * rate : 0
  const doorFinishMaterial = df ? doorsPerLine * df.material_per_door : 0
  const doorFinishHours = df ? doorsPerLine * df.labor_hours_per_door : 0
  const doorFinishDetail = df
    ? `${doorsPerLine.toFixed(2)} doors × ${df.labor_hours_per_door}h/door + $${df.material_per_door}/door`
    : null
  const doorFinishLaborPerDoor = df ? df.labor_hours_per_door * rate : 0
  const doorFinishMaterialPerDoor = df ? df.material_per_door : 0
  const avgPerDoor =
    doorLaborPerDoor +
    doorMaterialPerDoor +
    doorFinishLaborPerDoor +
    doorFinishMaterialPerDoor +
    doorHardwarePerDoor
  const finishHoursTotal = finishLaborHours(ifn) + doorFinishHours

  // End panels — under door pricing v2 each panel rolls up as one full
  // door equivalent. perPanelTotal sums door-type labor + door material +
  // door-finish labor + door-finish material + hardware per door. Hours
  // are dept-distributed via dt.labor_hours_* / df.labor_hours_per_door.
  const dtLaborHrsPerDoor = dt
    ? dt.labor_hours_eng +
      dt.labor_hours_cnc +
      dt.labor_hours_assembly +
      dt.labor_hours_finish
    : 0
  const perPanelLabor =
    (dtLaborHrsPerDoor + (df?.labor_hours_per_door || 0)) * rate
  const perPanelMaterial =
    (dm ? dm.cost_value * matPerDoor : 0) +
    (df?.material_per_door || 0) +
    (dt?.hardware_cost || 0)
  const endPanelsCount = s.endPanels || 0
  const endPanelsLabor = endPanelsCount * perPanelLabor
  const endPanelsMaterial = endPanelsCount * perPanelMaterial

  // Fillers — flat per-each, still priced at the blended rate.
  const fillersLabor = (s.fillers || 0) * FILLER_LABOR_HR * rate
  const fillersMaterial = (s.fillers || 0) * FILLER_MATERIAL

  // Aggregate dept hours for the saved-line round-trip. End-panel hours
  // fold in as one full-door equivalent per panel: door-type hours per
  // dept × endPanels, plus the door-finish per-door hours into Finish.
  // Drawer + filler hours land on the same depts they always have.
  const endPanelDoorEng = dt && dt.calibrated ? dt.labor_hours_eng * endPanelsCount : 0
  const endPanelDoorCnc = dt && dt.calibrated ? dt.labor_hours_cnc * endPanelsCount : 0
  const endPanelDoorAsm = dt && dt.calibrated ? dt.labor_hours_assembly * endPanelsCount : 0
  const endPanelDoorFin = dt && dt.calibrated ? dt.labor_hours_finish * endPanelsCount : 0
  const endPanelFinishHoursTotal = df ? df.labor_hours_per_door * endPanelsCount : 0

  const hoursByDept = {
    eng: carcassHoursByDept.eng + doorHoursByDept.eng + drawerHoursByDept.eng + endPanelDoorEng,
    cnc: carcassHoursByDept.cnc + doorHoursByDept.cnc + drawerHoursByDept.cnc + endPanelDoorCnc,
    assembly:
      carcassHoursByDept.assembly +
      doorHoursByDept.assembly +
      drawerHoursByDept.assembly +
      endPanelDoorAsm +
      (s.fillers || 0) * FILLER_LABOR_HR,
    finish:
      carcassHoursByDept.finish +
      doorHoursByDept.finish +
      drawerHoursByDept.finish +
      finishHoursTotal +
      endPanelDoorFin +
      endPanelFinishHoursTotal,
  }

  const totalLabor =
    carcassLabor +
    doorLabor +
    drawerLabor +
    interiorFinishLabor +
    doorFinishLabor +
    endPanelsLabor +
    fillersLabor

  const materialSubtotal =
    carcassMaterial +
    backPanelMaterial +
    doorMaterial +
    doorHardware +
    drawerMaterial +
    drawerHardware +
    interiorFinishMaterial +
    doorFinishMaterial +
    endPanelsMaterial +
    fillersMaterial

  const consumablesPct = Number(defaults.consumablesPct) || 0
  const wastePct = Number(defaults.wastePct) || 0
  const consumables = materialSubtotal * (consumablesPct / 100)
  const waste = materialSubtotal * (wastePct / 100)
  const totalMaterial = materialSubtotal + consumables + waste

  return {
    qtyCarcass,
    qtyDoors,
    carcassLabor,
    carcassLaborPerLf,
    carcassMaterial,
    carcassMaterialDetail,
    backPanelMaterial,
    backPanelMaterialDetail,

    doorLabor,
    doorLaborPerLf,
    doorLaborWarn,
    doorMaterial,
    doorMaterialDetail,
    doorMaterialMissing: !!s.doorTypeId && !s.doorMaterialId,
    doorFinishMissing: !!s.doorMaterialId && !s.doorFinishId,
    doorHardware,
    doorsPerLine,
    doorLaborPerDoor,
    doorMaterialPerDoor,
    doorFinishLaborPerDoor,
    doorFinishMaterialPerDoor,
    doorHardwarePerDoor,
    avgPerDoor,

    drawerLabor,
    drawerLaborWarn,
    drawerLaborDetail,
    drawerMaterial,
    drawerMaterialDetail,
    drawerHardware,

    interiorFinishLabor,
    interiorFinishMaterial,
    interiorFinishDetail: finishDetail(ifn),
    // The breakdown shape keeps the legacy "exterior finish" key names
    // so the AddLineComposer Row labels don't churn — under door v2 these
    // values come from the door-material-scoped finish (df).
    exteriorFinishLabor: doorFinishLabor,
    exteriorFinishMaterial: doorFinishMaterial,
    exteriorFinishDetail: doorFinishDetail,

    endPanelsLabor,
    endPanelsMaterial,
    endPanelsCount: s.endPanels || 0,
    fillersLabor,
    fillersMaterial,
    fillersCount: s.fillers || 0,

    materialSubtotal,
    consumablesPct,
    consumables,
    wastePct,
    waste,

    totals: {
      labor: totalLabor,
      material: totalMaterial,
      total: totalLabor + totalMaterial,
    },

    hoursByDept,
  }
}

// ── Save-gate check ──

export interface SaveGate {
  ok: boolean
  reason: string | null
}

/** Gate clicking "Add line" — the spec requires block-on-save when
 *  required calibrations are missing. Returns a single-sentence reason
 *  for the first blocker found. */
export function checkSaveGate(
  draft: ComposerDraft,
  rb: ComposerRateBook
): SaveGate {
  if (!rb.carcassCalibrated) {
    return {
      ok: false,
      reason:
        'Run the Base cabinet calibration from Settings before saving — carcass labor is uncalibrated.',
    }
  }
  if (!draft.qty || draft.qty <= 0) {
    return { ok: false, reason: 'Set a quantity first.' }
  }
  if (!draft.slots.carcassMaterial) {
    return { ok: false, reason: 'Pick a carcass material.' }
  }
  if (!draft.slots.doorTypeId) {
    return { ok: false, reason: 'Pick a door type.' }
  }
  const dt = rb.doorTypes.find((t) => t.id === draft.slots.doorTypeId)
  if (dt && !dt.calibrated) {
    return {
      ok: false,
      reason: `Door type "${dt.name}" isn't calibrated yet — open the door-type walkthrough.`,
    }
  }
  if (!draft.slots.doorMaterialId) {
    return { ok: false, reason: 'Pick a door material.' }
  }
  if (!draft.slots.doorFinishId) {
    return { ok: false, reason: 'Pick a door finish.' }
  }
  if (!draft.slots.interiorFinish) {
    return { ok: false, reason: 'Pick an interior finish.' }
  }
  return { ok: true, reason: null }
}

// ── Slot summary — for the subproject lines list ──

export function summarizeSlots(
  draft: ComposerDraft,
  rb: ComposerRateBook
): string {
  const bits: string[] = []
  const cm = rb.carcassMaterials.find((m) => m.id === draft.slots.carcassMaterial)
  if (cm) bits.push(cm.name)
  const bm = rb.backPanelMaterials.find((m) => m.id === draft.slots.backPanelMaterial)
  if (bm) bits.push(`${bm.name} back`)
  const dt = rb.doorTypes.find((t) => t.id === draft.slots.doorTypeId)
  if (dt) bits.push(`${dt.name} door`)
  const dm = rb.doorTypeMaterials.find((m) => m.id === draft.slots.doorMaterialId)
  if (dm) bits.push(dm.material_name)
  const df = rb.doorTypeMaterialFinishes.find((f) => f.id === draft.slots.doorFinishId)
  if (df) bits.push(df.finish_name)
  if (draft.slots.drawerCount > 0) {
    const drs = rb.drawerStyles.find((d) => d.id === draft.slots.drawerStyle)
    const drawerLabel = drs ? `${drs.name} drawer` : 'drawer'
    bits.push(
      `${draft.slots.drawerCount} ${drawerLabel}${draft.slots.drawerCount === 1 ? '' : 's'}`,
    )
  }
  if (draft.slots.endPanels > 0) {
    bits.push(
      `${draft.slots.endPanels} end panel${draft.slots.endPanels === 1 ? '' : 's'}`
    )
  }
  if (draft.slots.fillers > 0) {
    bits.push(
      `${draft.slots.fillers} filler${draft.slots.fillers === 1 ? '' : 's'}`
    )
  }
  return bits.join(' · ')
}

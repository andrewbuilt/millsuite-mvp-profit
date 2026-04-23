// ============================================================================
// lib/composer.ts — add-line composer types + pricing math
// ============================================================================
// Pure compute. No I/O. The component loads data, shapes it into
// ComposerRateBook + ComposerDefaults, then calls computeBreakdown for
// the live right-rail update on every slot change.
//
// Math mirrors specs/add-line-composer/index.html verbatim — the math
// layer there is the closed contract. Any change to how a line prices
// must come from a spec edit.
//
// Hardcoded constants (end panel labor + material, filler labor + material)
// match the prototype literal values. Spec calls these out as V1 defaults;
// V2 lifts them into the rate book.
// ============================================================================

import { PRODUCTS, type Product, type ProductKey } from './products'

// ── Shapes loaded out of Supabase ──

export interface ComposerShopRates {
  eng: number
  cnc: number
  assembly: number
  finish: number
  // install is outside the composer's scope; subproject header owns it.
}

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
}

/** A finish item plus its per-product calibration rows. Missing product
 *  keys in byProduct mean "not calibrated for that cab height." */
export interface ComposerFinish {
  id: string
  name: string
  /** true for a synthetic "prefinished" row — byProduct entries all
   *  zero, treated as always-valid and labor-free. */
  isPrefinished: boolean
  byProduct: {
    base?: ComposerFinishProductRow
    upper?: ComposerFinishProductRow
    full?: ComposerFinishProductRow
  }
}

export interface ComposerFinishProductRow {
  /** Per-LF labor hours for this product category. */
  laborHr: number
  /** Per-LF material cost, summed across primer/paint/stain/lacquer. */
  material: number
}

export interface ComposerRateBook {
  shopRates: ComposerShopRates
  carcassLabor: ComposerCarcassLabor
  /** "Base cabinet" item row exists and at least one dept is non-zero.
   *  When false, the composer should surface "run BaseCabinetWalkthrough
   *  first" and block save. */
  carcassCalibrated: boolean
  carcassMaterials: ComposerCarcassMaterial[]
  extMaterials: ComposerExtMaterial[]
  doorStyles: ComposerDoorStyle[]
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
  doorStyle: string | null
  doorMaterial: string | null
  interiorFinish: string | null
  exteriorFinish: string | null
  endPanels: number
  fillers: number
  notes: string
}

export interface ComposerDraft {
  productId: ProductKey
  qty: number
  slots: ComposerSlots
}

export function emptySlots(): ComposerSlots {
  return {
    carcassMaterial: null,
    doorStyle: null,
    doorMaterial: null,
    interiorFinish: null,
    exteriorFinish: null,
    endPanels: 0,
    fillers: 0,
    notes: '',
  }
}

// ── Breakdown output ──

export interface ComposerBreakdown {
  carcassLabor: number
  carcassLaborPerLf: number
  carcassMaterial: number
  carcassMaterialDetail: string | null

  doorLabor: number
  doorLaborPerLf: number
  doorLaborWarn: boolean
  doorMaterial: number
  doorMaterialDetail: string | null

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

// ── Hardcoded V1 constants per spec ──
// End panels + filler/scribes are flat per-unit approximations. Lifted
// into the rate book in a follow-up if real shops push back.
const END_PANEL_LABOR_HR = 1.2      // applied at finish-dept rate
const END_PANEL_MATERIAL = 140      // dollars per each
const FILLER_LABOR_HR = 0.5         // applied at assembly-dept rate
const FILLER_MATERIAL = 18          // dollars per each

// ── The compute ──

export function computeBreakdown(
  draft: ComposerDraft,
  rb: ComposerRateBook,
  defaults: ComposerDefaults
): ComposerBreakdown {
  const prod: Product = PRODUCTS[draft.productId]
  const qty = Number.isFinite(draft.qty) && draft.qty > 0 ? draft.qty : 0
  const s = draft.slots
  const r = rb.shopRates
  const cl = rb.carcassLabor

  // Carcass labor — 4 depts. Wood machining is already rolled into
  // assembly (BaseCabinetWalkthrough's save folds it in).
  const carcassLaborPerLf =
    cl.eng * r.eng +
    cl.cnc * r.cnc +
    cl.assembly * r.assembly +
    cl.finish * r.finish
  const carcassLabor = qty * carcassLaborPerLf

  const carcassHoursByDept = {
    eng: qty * cl.eng,
    cnc: qty * cl.cnc,
    assembly: qty * cl.assembly,
    finish: qty * cl.finish,
  }

  const cm = rb.carcassMaterials.find((m) => m.id === s.carcassMaterial) || null
  const em = rb.extMaterials.find((m) => m.id === s.doorMaterial) || null
  const ds = rb.doorStyles.find((d) => d.id === s.doorStyle) || null
  const ifn = rb.finishes.find((f) => f.id === s.interiorFinish) || null
  const efn = rb.finishes.find((f) => f.id === s.exteriorFinish) || null

  const carcassMaterial = cm ? qty * cm.sheets_per_lf * cm.sheet_cost : 0
  const carcassMaterialDetail = cm
    ? `${(qty * cm.sheets_per_lf).toFixed(1)} sht × $${cm.sheet_cost}`
    : null

  // Door labor — per-door × doorsPerLf × product multiplier → per-LF across
  // 4 depts. Uncalibrated door (all zero) → zero labor + warn flag.
  let doorLaborPerLfBase = 0
  let doorHoursByDept = { eng: 0, cnc: 0, assembly: 0, finish: 0 }
  if (ds && ds.calibrated) {
    const perLfMult = prod.doorsPerLf * prod.doorLaborMultiplier
    doorHoursByDept = {
      eng: qty * ds.labor.eng * perLfMult,
      cnc: qty * ds.labor.cnc * perLfMult,
      assembly: qty * ds.labor.assembly * perLfMult,
      finish: qty * ds.labor.finish * perLfMult,
    }
    doorLaborPerLfBase =
      prod.doorsPerLf *
      (ds.labor.eng * r.eng +
        ds.labor.cnc * r.cnc +
        ds.labor.assembly * r.assembly +
        ds.labor.finish * r.finish)
  }
  const doorLaborPerLf = doorLaborPerLfBase * prod.doorLaborMultiplier
  const doorLabor = qty * doorLaborPerLf
  const doorLaborWarn = !!s.doorStyle && ds !== null && !ds.calibrated

  // Door/drawer face material — sheetsPerLfFace is product, not template.
  const faceSheets = qty * prod.sheetsPerLfFace
  const doorMaterial = em ? faceSheets * em.sheet_cost : 0
  const doorMaterialDetail = em
    ? `${faceSheets.toFixed(2)} sht × $${em.sheet_cost}`
    : null

  // Finishes — per-LF labor at finish rate + per-LF material, per product
  // category. Prefinished or missing byProduct row → zero, no error.
  function finishLabor(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qty * row.laborHr * r.finish
  }
  function finishMaterial(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qty * row.material
  }
  function finishLaborHours(f: ComposerFinish | null): number {
    if (!f) return 0
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 0
    return qty * row.laborHr
  }
  function finishDetail(f: ComposerFinish | null): string | null {
    if (!f) return null
    if (f.isPrefinished) return 'prefinished, no labor'
    const row = f.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) return 'not calibrated for this category'
    const perLf = row.laborHr * r.finish + row.material
    return `${qty} LF × $${Math.round(perLf)}/LF`
  }

  const interiorFinishLabor = finishLabor(ifn)
  const interiorFinishMaterial = finishMaterial(ifn)
  const exteriorFinishLabor = finishLabor(efn)
  const exteriorFinishMaterial = finishMaterial(efn)
  const finishHoursTotal = finishLaborHours(ifn) + finishLaborHours(efn)

  // End panels + fillers — hardcoded V1.
  const endPanelsLabor = (s.endPanels || 0) * END_PANEL_LABOR_HR * r.finish
  const endPanelsMaterial = (s.endPanels || 0) * END_PANEL_MATERIAL
  const fillersLabor = (s.fillers || 0) * FILLER_LABOR_HR * r.assembly
  const fillersMaterial = (s.fillers || 0) * FILLER_MATERIAL

  // Aggregate dept hours for the saved-line round-trip.
  const hoursByDept = {
    eng: carcassHoursByDept.eng + doorHoursByDept.eng,
    cnc: carcassHoursByDept.cnc + doorHoursByDept.cnc,
    assembly:
      carcassHoursByDept.assembly +
      doorHoursByDept.assembly +
      (s.fillers || 0) * FILLER_LABOR_HR,
    finish:
      carcassHoursByDept.finish +
      doorHoursByDept.finish +
      finishHoursTotal +
      (s.endPanels || 0) * END_PANEL_LABOR_HR,
  }

  const totalLabor =
    carcassLabor +
    doorLabor +
    interiorFinishLabor +
    exteriorFinishLabor +
    endPanelsLabor +
    fillersLabor

  const materialSubtotal =
    carcassMaterial +
    doorMaterial +
    interiorFinishMaterial +
    exteriorFinishMaterial +
    endPanelsMaterial +
    fillersMaterial

  const consumablesPct = Number(defaults.consumablesPct) || 0
  const wastePct = Number(defaults.wastePct) || 0
  const consumables = materialSubtotal * (consumablesPct / 100)
  const waste = materialSubtotal * (wastePct / 100)
  const totalMaterial = materialSubtotal + consumables + waste

  return {
    carcassLabor,
    carcassLaborPerLf,
    carcassMaterial,
    carcassMaterialDetail,

    doorLabor,
    doorLaborPerLf,
    doorLaborWarn,
    doorMaterial,
    doorMaterialDetail,

    interiorFinishLabor,
    interiorFinishMaterial,
    interiorFinishDetail: finishDetail(ifn),
    exteriorFinishLabor,
    exteriorFinishMaterial,
    exteriorFinishDetail: finishDetail(efn),

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
  if (!draft.slots.doorStyle) {
    return { ok: false, reason: 'Pick a door style.' }
  }
  const ds = rb.doorStyles.find((d) => d.id === draft.slots.doorStyle)
  if (ds && !ds.calibrated) {
    return {
      ok: false,
      reason: `Door style "${ds.name}" isn't calibrated yet — walkthrough coming in the next item.`,
    }
  }
  if (!draft.slots.doorMaterial) {
    return { ok: false, reason: 'Pick a door/drawer material.' }
  }
  if (!draft.slots.exteriorFinish) {
    return { ok: false, reason: 'Pick an exterior finish.' }
  }
  const efn = rb.finishes.find((f) => f.id === draft.slots.exteriorFinish)
  if (efn && !efn.isPrefinished) {
    const row = efn.byProduct[draft.productId as 'base' | 'upper' | 'full']
    if (!row) {
      return {
        ok: false,
        reason: `Exterior finish "${efn.name}" isn't calibrated for ${draft.productId} cabinets — walkthrough coming.`,
      }
    }
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
  const ds = rb.doorStyles.find((d) => d.id === draft.slots.doorStyle)
  if (ds) bits.push(`${ds.name} door`)
  const em = rb.extMaterials.find((m) => m.id === draft.slots.doorMaterial)
  if (em) bits.push(em.name)
  const efn = rb.finishes.find((f) => f.id === draft.slots.exteriorFinish)
  if (efn && !efn.isPrefinished) bits.push(efn.name)
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

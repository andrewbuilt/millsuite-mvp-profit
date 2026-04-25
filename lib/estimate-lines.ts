// ============================================================================
// lib/estimate-lines.ts — data + pricing for per-subproject estimate lines
// ============================================================================
// Phase 2 (BUILD-ORDER): lines are first-class and everything routes through
// the new rate book (rate_book_items with material_mode + confidence). A line
// is either:
//   (a) a rate_book_item reference with optional per-line overrides, or
//   (b) freeform — rate_book_item_id null, all fields populated on the line.
//
// The editor's math engine is computeLineBuildup (pure). The bottom-math
// rollup is computeSubprojectRollup (also pure). Both price labor at
// the single blended orgs.shop_rate (Phase 12 item 12); per-dept hours
// are still tracked on the line for scheduling / time tracking.
// ============================================================================

import { supabase } from './supabase'
import {
  recomputeProjectBidTotalForLine,
  recomputeProjectBidTotalForSubproject,
} from './project-totals'
import type {
  RateBookItemRow,
  RateBookOptionRow,
  MaterialMode,
  Unit,
} from './rate-book-v2'
import type { LaborDept } from './rate-book-seed'
import { LABOR_DEPTS } from './rate-book-seed'

// ── Types ──

export type InstallMode = 'per_man_per_day' | 'per_box' | 'flat'

export interface InstallParamsPerManPerDay {
  days: number
  men: number
  rate: number // $ per man per day
}
export interface InstallParamsPerBox {
  boxes: number
  rate_per_box: number
}
export interface InstallParamsFlat {
  amount: number
}
export type InstallParams =
  | InstallParamsPerManPerDay
  | InstallParamsPerBox
  | InstallParamsFlat

export interface FinishSpec {
  material?: string
  finish?: string
  edge?: string
  notes?: string
}

export interface EstimateLine {
  id: string
  subproject_id: string
  sort_order: number
  description: string
  rate_book_item_id: string | null
  quantity: number
  unit: Unit | null
  // Per-line overrides (null = inherit from rate book item).
  material_mode_override: MaterialMode | null
  linear_cost_override: number | null
  lump_cost_override: number | null
  dept_hour_overrides: Partial<Record<LaborDept, number>> | null
  // Freeform-line material (used when rate_book_item_id is null).
  material_description: string | null
  // Install (per line, optional).
  install_mode: InstallMode | null
  install_params: InstallParams | null
  // Finishes (new, structured) + legacy callouts text[] (still present, kept
  // for back-compat until the approval-items flow is migrated).
  finish_specs: FinishSpec[] | null
  callouts: string[] | null
  unit_price_override: number | null
  notes: string | null
  // Phase 12 item 6 — composer round-trip. Non-null on lines saved via
  // AddLineComposer; null on freeform / legacy lines.
  product_key: string | null
  product_slots: Record<string, unknown> | null
}

export interface EstimateLineOptionRow {
  estimate_line_id: string
  rate_book_option_id: string
  effect_value_override: number | null
}

// Computed breakdown for one line. Pure function output.
export interface LineBuildup {
  hoursByDept: Record<LaborDept, number>
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  consumablesCost: number
  installCost: number
  optionsFlatAdd: number
  optionsFlag: string[]
  lineTotal: number
  effectiveCallouts: string[]
  effectiveFinishSpecs: FinishSpec[]
}

export interface SubprojectRollup {
  hoursByDept: Record<LaborDept, number>
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  consumablesCost: number
  installCost: number
  optionsCost: number // sum of flat_add + per_unit_add option effects
  subtotal: number
  total: number
  marginPct: number
  lineCount: number
}

// ── Loaders ──

/**
 * Load an org's active rate book items keyed for the line editor.
 */
export async function loadRateBook(orgId: string): Promise<{
  items: RateBookItemRow[]
  itemsById: Map<string, RateBookItemRow>
}> {
  const { data, error } = await supabase
    .from('rate_book_items')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  const items = (data || []) as RateBookItemRow[]
  const itemsById = new Map(items.map((i) => [i.id, i]))
  return { items, itemsById }
}

export async function loadEstimateLines(subprojectId: string): Promise<EstimateLine[]> {
  const { data, error } = await supabase
    .from('estimate_lines')
    .select(
      `id, subproject_id, sort_order, description, rate_book_item_id,
       quantity, unit, material_mode_override, linear_cost_override,
       lump_cost_override, dept_hour_overrides, material_description,
       install_mode, install_params, finish_specs, callouts,
       unit_price_override, notes, product_key, product_slots`
    )
    .eq('subproject_id', subprojectId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('loadEstimateLines', error)
    return []
  }
  return (data || []).map(normalizeLine)
}

function normalizeLine(row: any): EstimateLine {
  return {
    id: row.id,
    subproject_id: row.subproject_id,
    sort_order: row.sort_order ?? 0,
    description: row.description || '',
    rate_book_item_id: row.rate_book_item_id,
    quantity: Number(row.quantity) || 0,
    unit: row.unit ?? null,
    material_mode_override: row.material_mode_override ?? null,
    linear_cost_override:
      row.linear_cost_override != null ? Number(row.linear_cost_override) : null,
    lump_cost_override:
      row.lump_cost_override != null ? Number(row.lump_cost_override) : null,
    dept_hour_overrides: row.dept_hour_overrides ?? null,
    material_description: row.material_description ?? null,
    install_mode: row.install_mode ?? null,
    install_params: row.install_params ?? null,
    finish_specs: row.finish_specs ?? null,
    callouts: row.callouts ?? null,
    unit_price_override:
      row.unit_price_override != null ? Number(row.unit_price_override) : null,
    notes: row.notes ?? null,
    product_key: row.product_key ?? null,
    product_slots: row.product_slots ?? null,
  }
}

export async function loadLineOptions(
  subprojectId: string
): Promise<Map<string, EstimateLineOptionRow[]>> {
  // Join through estimate_lines to narrow by subproject, then return a
  // per-line map the editor can merge into its line state.
  const { data: lines } = await supabase
    .from('estimate_lines')
    .select('id')
    .eq('subproject_id', subprojectId)
  const ids = (lines || []).map((l: any) => l.id)
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('estimate_line_options')
    .select('estimate_line_id, rate_book_option_id, effect_value_override')
    .in('estimate_line_id', ids)
  if (error) throw error

  const map = new Map<string, EstimateLineOptionRow[]>()
  for (const row of (data || []) as EstimateLineOptionRow[]) {
    const list = map.get(row.estimate_line_id) || []
    list.push(row)
    map.set(row.estimate_line_id, list)
  }
  return map
}

// ── Estimate-line CRUD ──

/**
 * Add a new line. If `item` is supplied, it pre-fills description + unit from
 * the rate book. For freeform lines, pass only subprojectId + description.
 */
export async function addEstimateLine(input: {
  subprojectId: string
  item?: RateBookItemRow
  description?: string
  quantity?: number
  unit?: Unit
}): Promise<EstimateLine | null> {
  const { data: last } = await supabase
    .from('estimate_lines')
    .select('sort_order')
    .eq('subproject_id', input.subprojectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

  const { data, error } = await supabase
    .from('estimate_lines')
    .insert({
      subproject_id: input.subprojectId,
      sort_order: nextOrder,
      description: input.description ?? input.item?.name ?? '',
      rate_book_item_id: input.item?.id ?? null,
      quantity: input.quantity ?? 1,
      unit: input.unit ?? input.item?.unit ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('addEstimateLine', error)
    throw new Error(error.message || 'Failed to add line')
  }
  // Pricing-input write-back (see lib/project-totals.ts contract).
  void recomputeProjectBidTotalForSubproject(input.subprojectId)
  return normalizeLine(data)
}

export async function updateEstimateLine(
  id: string,
  patch: Partial<Omit<EstimateLine, 'id' | 'subproject_id'>>
): Promise<void> {
  const { error } = await supabase
    .from('estimate_lines')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('updateEstimateLine', error)
    throw error
  }
  // Pricing-input write-back. Most callers patch qty / unit_price /
  // material_mode_override etc — all priceTotal-affecting.
  void recomputeProjectBidTotalForLine(id)
}

export async function deleteEstimateLine(id: string): Promise<void> {
  // Resolve subproject_id BEFORE the delete so we can fan out the
  // bid_total recompute after the row is gone.
  const { data: lineRow } = await supabase
    .from('estimate_lines')
    .select('subproject_id')
    .eq('id', id)
    .maybeSingle()
  const subprojectId = lineRow?.subproject_id as string | undefined
  const { error } = await supabase.from('estimate_lines').delete().eq('id', id)
  if (error) {
    console.error('deleteEstimateLine', error)
    throw error
  }
  if (subprojectId) {
    void recomputeProjectBidTotalForSubproject(subprojectId)
  }
}

export async function duplicateEstimateLine(
  id: string
): Promise<EstimateLine | null> {
  const { data: src } = await supabase
    .from('estimate_lines')
    .select('*')
    .eq('id', id)
    .single()
  if (!src) return null
  const { data: last } = await supabase
    .from('estimate_lines')
    .select('sort_order')
    .eq('subproject_id', src.subproject_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

  const { id: _drop, created_at, updated_at, ...rest } = src
  const { data, error } = await supabase
    .from('estimate_lines')
    .insert({ ...rest, sort_order: nextOrder })
    .select()
    .single()
  if (error) {
    console.error('duplicateEstimateLine', error)
    return null
  }
  void recomputeProjectBidTotalForSubproject(src.subproject_id as string)
  return normalizeLine(data)
}

// ── Line options CRUD ──

export async function attachLineOption(
  lineId: string,
  optionId: string,
  effectValueOverride: number | null = null
) {
  const { error } = await supabase.from('estimate_line_options').upsert(
    {
      estimate_line_id: lineId,
      rate_book_option_id: optionId,
      effect_value_override: effectValueOverride,
    },
    { onConflict: 'estimate_line_id,rate_book_option_id' }
  )
  if (error) throw error
  // Options can carry $ via flat_add / per_unit_add — recompute.
  void recomputeProjectBidTotalForLine(lineId)
}

export async function detachLineOption(lineId: string, optionId: string) {
  const { error } = await supabase
    .from('estimate_line_options')
    .delete()
    .eq('estimate_line_id', lineId)
    .eq('rate_book_option_id', optionId)
  if (error) throw error
  void recomputeProjectBidTotalForLine(lineId)
}

// ── Pricing ──

export interface PricingContext {
  shopRate: number                       // orgs.shop_rate (single blended)
  consumableMarkupPct: number            // e.g. 10 (%)
  profitMarginPct: number                // e.g. 25 (%)
}

// Pull the effective hours-by-dept for a line: override wins, else inherit.
function effectiveHours(
  line: EstimateLine,
  item: RateBookItemRow | null
): Record<LaborDept, number> {
  const ov = line.dept_hour_overrides || {}
  const base = (d: LaborDept): number => {
    if (!item) return 0
    return d === 'eng'
      ? item.base_labor_hours_eng
      : d === 'cnc'
      ? item.base_labor_hours_cnc
      : d === 'assembly'
      ? item.base_labor_hours_assembly
      : d === 'finish'
      ? item.base_labor_hours_finish
      : item.base_labor_hours_install
  }
  const out = {} as Record<LaborDept, number>
  for (const d of LABOR_DEPTS) {
    const v = ov[d]
    out[d] = v != null ? Number(v) || 0 : Number(base(d)) || 0
  }
  return out
}

function effectiveMaterialMode(
  line: EstimateLine,
  item: RateBookItemRow | null
): MaterialMode {
  return line.material_mode_override || item?.material_mode || 'none'
}

function effectiveMaterialCost(
  line: EstimateLine,
  item: RateBookItemRow | null
): number {
  const mode = effectiveMaterialMode(line, item)
  if (mode === 'sheets') {
    const sheetsPer = Number(item?.sheets_per_unit || 0)
    const sheetCost = Number(item?.sheet_cost || 0)
    return sheetsPer * sheetCost
  }
  if (mode === 'linear') {
    return line.linear_cost_override != null
      ? Number(line.linear_cost_override)
      : Number(item?.linear_cost || 0)
  }
  if (mode === 'lump') {
    return line.lump_cost_override != null
      ? Number(line.lump_cost_override)
      : Number(item?.lump_cost || 0)
  }
  return 0
}

function computeInstallCost(line: EstimateLine): number {
  if (!line.install_mode || !line.install_params) return 0
  const p = line.install_params as any
  if (line.install_mode === 'per_man_per_day') {
    return (Number(p.days) || 0) * (Number(p.men) || 0) * (Number(p.rate) || 0)
  }
  if (line.install_mode === 'per_box') {
    return (Number(p.boxes) || 0) * (Number(p.rate_per_box) || 0)
  }
  if (line.install_mode === 'flat') {
    return Number(p.amount) || 0
  }
  return 0
}

/**
 * Compute the build-up for one line. Pure. Takes the resolved rate book item
 * (or null for freeform) and the set of options attached to the line with
 * their effect metadata already merged in.
 */
export function computeLineBuildup(
  line: EstimateLine,
  item: RateBookItemRow | null,
  appliedOptions: Array<{
    option: RateBookOptionRow
    effect_value_override: number | null
  }>,
  ctx: PricingContext
): LineBuildup {
  const qty = Number(line.quantity) || 0

  // unit_price_override short-circuits the build-up entirely.
  if (line.unit_price_override != null) {
    return {
      hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      totalHours: 0,
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      consumablesCost: 0,
      installCost: 0,
      optionsFlatAdd: 0,
      optionsFlag: [],
      lineTotal: Number(line.unit_price_override) * qty,
      effectiveCallouts: line.callouts || [],
      effectiveFinishSpecs: line.finish_specs || [],
    }
  }

  // Start from base hours (already mixing overrides + item).
  const baseHours = effectiveHours(line, item)

  // Apply hours_multiplier options per dept (effect_target = dept name).
  const hoursByDept: Record<LaborDept, number> = { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 }
  for (const d of LABOR_DEPTS) {
    let h = baseHours[d]
    for (const { option, effect_value_override } of appliedOptions) {
      if (option.effect_type !== 'hours_multiplier') continue
      const t = option.effect_target
      if (t && t !== d) continue
      const mult = effect_value_override != null ? Number(effect_value_override) : Number(option.effect_value || 1)
      h = h * (mult || 1)
    }
    hoursByDept[d] = h * qty
  }
  const totalHours =
    hoursByDept.eng + hoursByDept.cnc + hoursByDept.assembly +
    hoursByDept.finish + hoursByDept.install

  // Total hours across depts × single blended shop rate.
  let laborCost = totalHours * (Number(ctx.shopRate) || 0)

  // rate_multiplier options apply to the line's labor $ total.
  for (const { option, effect_value_override } of appliedOptions) {
    if (option.effect_type !== 'rate_multiplier') continue
    const mult = effect_value_override != null ? Number(effect_value_override) : Number(option.effect_value || 1)
    laborCost = laborCost * (mult || 1)
  }

  // Material, scaled by qty. material_multiplier options adjust this total.
  let materialCost = effectiveMaterialCost(line, item) * qty
  for (const { option, effect_value_override } of appliedOptions) {
    if (option.effect_type !== 'material_multiplier') continue
    const mult = effect_value_override != null ? Number(effect_value_override) : Number(option.effect_value || 1)
    materialCost = materialCost * (mult || 1)
  }

  const hardwareCost = Number(item?.hardware_cost || 0) * qty
  const consumablesCost = materialCost * (ctx.consumableMarkupPct / 100)
  const installCost = computeInstallCost(line)

  // flat_add and per_unit_add options.
  let optionsFlatAdd = 0
  const optionsFlag: string[] = []
  for (const { option, effect_value_override } of appliedOptions) {
    const val = effect_value_override != null ? Number(effect_value_override) : Number(option.effect_value || 0)
    if (option.effect_type === 'flat_add') optionsFlatAdd += val
    else if (option.effect_type === 'per_unit_add') optionsFlatAdd += val * qty
    else if (option.effect_type === 'flag') optionsFlag.push(option.name)
  }

  const lineTotal =
    laborCost + materialCost + hardwareCost + consumablesCost + installCost + optionsFlatAdd

  return {
    hoursByDept,
    totalHours,
    laborCost,
    materialCost,
    hardwareCost,
    consumablesCost,
    installCost,
    optionsFlatAdd,
    optionsFlag,
    lineTotal,
    effectiveCallouts: line.callouts || [],
    effectiveFinishSpecs: line.finish_specs || [],
  }
}

/**
 * Subproject-level rollup. Profit margin is applied as a gross-margin mark-up
 * (price = cost / (1 - margin%)), matching lib/pricing.ts.
 */
export function computeSubprojectRollup(
  lines: EstimateLine[],
  itemsById: Map<string, RateBookItemRow>,
  lineOptions: Map<string, Array<{ option: RateBookOptionRow; effect_value_override: number | null }>>,
  ctx: PricingContext
): SubprojectRollup {
  const acc: SubprojectRollup = {
    hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
    totalHours: 0,
    laborCost: 0,
    materialCost: 0,
    hardwareCost: 0,
    consumablesCost: 0,
    installCost: 0,
    optionsCost: 0,
    subtotal: 0,
    total: 0,
    marginPct: 0,
    lineCount: lines.length,
  }

  for (const line of lines) {
    const item = line.rate_book_item_id ? itemsById.get(line.rate_book_item_id) ?? null : null
    const opts = lineOptions.get(line.id) || []
    const b = computeLineBuildup(line, item, opts, ctx)
    for (const d of LABOR_DEPTS) acc.hoursByDept[d] += b.hoursByDept[d]
    acc.totalHours += b.totalHours
    acc.laborCost += b.laborCost
    acc.materialCost += b.materialCost
    acc.hardwareCost += b.hardwareCost
    acc.consumablesCost += b.consumablesCost
    acc.installCost += b.installCost
    acc.optionsCost += b.optionsFlatAdd
  }

  acc.subtotal =
    acc.laborCost + acc.materialCost + acc.hardwareCost +
    acc.consumablesCost + acc.installCost + acc.optionsCost

  const marginFraction = Math.min(Math.max(ctx.profitMarginPct / 100, 0), 0.95)
  acc.total = marginFraction > 0 ? acc.subtotal / (1 - marginFraction) : acc.subtotal
  acc.marginPct = acc.total > 0 ? ((acc.total - acc.subtotal) / acc.total) * 100 : 0

  return acc
}

/**
 * Filter the rate book's options list to those applicable to a given category
 * / item (honoring the options.scope field).
 */
export function applicableOptionsForItem(
  options: RateBookOptionRow[],
  item: RateBookItemRow | null
): RateBookOptionRow[] {
  return options.filter((o) => {
    if (o.scope === 'shop_wide') return true
    if (!item) return false
    if (o.scope.startsWith('category:')) {
      const cid = o.scope.slice('category:'.length)
      return item.category_id === cid
    }
    if (o.scope.startsWith('item:')) {
      const iid = o.scope.slice('item:'.length)
      return item.id === iid
    }
    return false
  })
}

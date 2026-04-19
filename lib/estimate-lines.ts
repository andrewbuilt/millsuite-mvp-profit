// ============================================================================
// lib/estimate-lines.ts — data + pricing for per-subproject estimate lines
// ============================================================================
// Per subproject-editor-mockup.html + BUILD-PLAN.md: lines are first-class.
// A subproject is the sum of its lines. Each line is an instance of a
// `rate_book_item` (construction labor + sheets + hardware) with a chosen
// `rate_book_material_variant` (material cost + per-dept labor multipliers).
// Callouts on the line are the editable chips that become approval_items
// labels once the project is sold.
// ============================================================================

import { supabase } from './supabase'

// ── Types ──

export interface RateBookItem {
  id: string
  name: string
  category_id: string | null
  category_name?: string | null
  unit: 'lf' | 'each' | 'sf'
  base_labor_hours_eng: number
  base_labor_hours_cnc: number
  base_labor_hours_assembly: number
  base_labor_hours_finish: number
  base_labor_hours_install: number
  sheets_per_unit: number
  sheet_cost: number
  hardware_cost: number
  default_callouts: string[]
  default_variant_id: string | null
  // Confidence / usage — set by the learning loop when rate_book_items are
  // used on real jobs. Null when never used.
  confidence_job_count?: number
  confidence_last_used_at?: string | null
}

export interface MaterialVariant {
  id: string
  rate_book_item_id: string
  material_name: string
  material_cost_per_lf: number
  labor_multiplier_eng: number
  labor_multiplier_cnc: number
  labor_multiplier_assembly: number
  labor_multiplier_finish: number
  labor_multiplier_install: number
  active: boolean
}

export interface EstimateLine {
  id: string
  subproject_id: string
  sort_order: number
  description: string
  rate_book_item_id: string | null
  rate_book_material_variant_id: string | null
  quantity: number
  linear_feet: number | null
  callouts: string[] | null
  unit_price_override: number | null
  notes: string | null
}

// Computed breakdown for a single line.
export interface LineBuildup {
  hoursByDept: {
    eng: number
    cnc: number
    assembly: number
    finish: number
    install: number
  }
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  sheetCost: number // materials from sheet consumption
  lineTotal: number // sum before markup + margin
  // Effective callouts = line-level callouts when set, else item defaults.
  effectiveCallouts: string[]
}

export interface SubprojectRollup {
  hoursByDept: {
    eng: number
    cnc: number
    assembly: number
    finish: number
    install: number
  }
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  sheetCost: number
  consumables: number // markup on (material + sheet)
  subtotal: number // labor + material + sheet + hardware + consumables
  total: number // subtotal with profit margin applied
  marginPct: number
  lineCount: number
}

// ── Rate book loading ──

/**
 * Load the whole rate book for an org plus variants, keyed for fast lookup
 * in the editor. Used by the autocomplete + line-buildup renderer.
 */
export async function loadRateBook(orgId: string): Promise<{
  items: RateBookItem[]
  variantsByItem: Record<string, MaterialVariant[]>
}> {
  const [itemsRes, variantsRes] = await Promise.all([
    supabase
      .from('rate_book_items')
      .select(
        `id, name, unit, category_id,
         base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly,
         base_labor_hours_finish, base_labor_hours_install,
         sheets_per_unit, sheet_cost, hardware_cost,
         default_callouts, default_variant_id,
         confidence_job_count, confidence_last_used_at,
         rate_book_categories(name)`
      )
      .eq('org_id', orgId)
      .eq('active', true)
      .order('name'),
    supabase
      .from('rate_book_material_variants')
      .select(
        `id, rate_book_item_id, material_name, material_cost_per_lf,
         labor_multiplier_eng, labor_multiplier_cnc, labor_multiplier_assembly,
         labor_multiplier_finish, labor_multiplier_install, active`
      )
      .eq('active', true),
  ])

  const items: RateBookItem[] = (itemsRes.data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    category_id: r.category_id,
    category_name: r.rate_book_categories?.name ?? null,
    unit: r.unit,
    base_labor_hours_eng: Number(r.base_labor_hours_eng) || 0,
    base_labor_hours_cnc: Number(r.base_labor_hours_cnc) || 0,
    base_labor_hours_assembly: Number(r.base_labor_hours_assembly) || 0,
    base_labor_hours_finish: Number(r.base_labor_hours_finish) || 0,
    base_labor_hours_install: Number(r.base_labor_hours_install) || 0,
    sheets_per_unit: Number(r.sheets_per_unit) || 0,
    sheet_cost: Number(r.sheet_cost) || 0,
    hardware_cost: Number(r.hardware_cost) || 0,
    default_callouts: r.default_callouts || [],
    default_variant_id: r.default_variant_id,
    confidence_job_count: Number(r.confidence_job_count) || 0,
    confidence_last_used_at: r.confidence_last_used_at ?? null,
  }))

  const variantsByItem: Record<string, MaterialVariant[]> = {}
  for (const v of variantsRes.data || []) {
    const variant: MaterialVariant = {
      id: v.id,
      rate_book_item_id: v.rate_book_item_id,
      material_name: v.material_name,
      material_cost_per_lf: Number(v.material_cost_per_lf) || 0,
      labor_multiplier_eng: Number(v.labor_multiplier_eng) || 1,
      labor_multiplier_cnc: Number(v.labor_multiplier_cnc) || 1,
      labor_multiplier_assembly: Number(v.labor_multiplier_assembly) || 1,
      labor_multiplier_finish: Number(v.labor_multiplier_finish) || 1,
      labor_multiplier_install: Number(v.labor_multiplier_install) || 1,
      active: v.active,
    }
    ;(variantsByItem[variant.rate_book_item_id] ||= []).push(variant)
  }

  return { items, variantsByItem }
}

// ── Estimate-line CRUD ──

export async function loadEstimateLines(subprojectId: string): Promise<EstimateLine[]> {
  const { data, error } = await supabase
    .from('estimate_lines')
    .select(
      `id, subproject_id, sort_order, description, rate_book_item_id,
       rate_book_material_variant_id, quantity, linear_feet, callouts,
       unit_price_override, notes`
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
    rate_book_material_variant_id: row.rate_book_material_variant_id,
    quantity: Number(row.quantity) || 0,
    linear_feet: row.linear_feet != null ? Number(row.linear_feet) : null,
    callouts: row.callouts || null,
    unit_price_override:
      row.unit_price_override != null ? Number(row.unit_price_override) : null,
    notes: row.notes,
  }
}

/**
 * Add a line to a subproject. Pulls defaults from the rate book item — the
 * caller can immediately overwrite qty, variant, callouts via updateEstimateLine.
 */
export async function addEstimateLine(input: {
  subprojectId: string
  item: RateBookItem
  quantity?: number
}): Promise<EstimateLine | null> {
  // sort_order = current max + 1. One extra round-trip is fine in an editor.
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
      description: input.item.name,
      rate_book_item_id: input.item.id,
      rate_book_material_variant_id: input.item.default_variant_id,
      quantity: input.quantity ?? 1,
      callouts: null, // null = inherit defaults
    })
    .select()
    .single()

  if (error) {
    console.error('addEstimateLine', error)
    return null
  }
  return normalizeLine(data)
}

export async function updateEstimateLine(
  id: string,
  patch: Partial<Pick<EstimateLine,
    'description' | 'quantity' | 'linear_feet' | 'rate_book_material_variant_id'
    | 'callouts' | 'unit_price_override' | 'notes' | 'sort_order'
  >>
): Promise<void> {
  const { error } = await supabase
    .from('estimate_lines')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('updateEstimateLine', error)
    throw error
  }
}

export async function deleteEstimateLine(id: string): Promise<void> {
  const { error } = await supabase.from('estimate_lines').delete().eq('id', id)
  if (error) {
    console.error('deleteEstimateLine', error)
    throw error
  }
}

// ── Pricing ──

export interface PricingDefaults {
  shopRate: number // default $/hr when a department doesn't have its own rate
  consumableMarkupPct: number // markup % on material + sheet cost
  profitMarginPct: number // profit margin applied at subproject subtotal level
  deptRates?: {
    eng?: number
    cnc?: number
    assembly?: number
    finish?: number
    install?: number
  }
}

/**
 * Compute the build-up for a single line. Pure — no DB calls. The caller
 * passes the rate book item + chosen variant from the already-loaded rate
 * book map, so this function is trivially memoizable in React.
 */
export function computeLineBuildup(
  line: EstimateLine,
  item: RateBookItem | null,
  variant: MaterialVariant | null,
  defaults: PricingDefaults
): LineBuildup {
  const qty = line.quantity || 0
  const deptRate = (dept: keyof NonNullable<PricingDefaults['deptRates']>) =>
    defaults.deptRates?.[dept] ?? defaults.shopRate

  if (!item) {
    // Custom/free-text line. Honor unit_price_override if set.
    const lineTotal = (line.unit_price_override ?? 0) * qty
    return {
      hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      totalHours: 0,
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      sheetCost: 0,
      lineTotal,
      effectiveCallouts: line.callouts || [],
    }
  }

  // Multipliers default to 1.0 when no variant is chosen.
  const mEng = variant?.labor_multiplier_eng ?? 1
  const mCnc = variant?.labor_multiplier_cnc ?? 1
  const mAsm = variant?.labor_multiplier_assembly ?? 1
  const mFin = variant?.labor_multiplier_finish ?? 1
  const mIns = variant?.labor_multiplier_install ?? 1

  const hoursByDept = {
    eng: item.base_labor_hours_eng * mEng * qty,
    cnc: item.base_labor_hours_cnc * mCnc * qty,
    assembly: item.base_labor_hours_assembly * mAsm * qty,
    finish: item.base_labor_hours_finish * mFin * qty,
    install: item.base_labor_hours_install * mIns * qty,
  }
  const totalHours =
    hoursByDept.eng +
    hoursByDept.cnc +
    hoursByDept.assembly +
    hoursByDept.finish +
    hoursByDept.install

  const laborCost =
    hoursByDept.eng * deptRate('eng') +
    hoursByDept.cnc * deptRate('cnc') +
    hoursByDept.assembly * deptRate('assembly') +
    hoursByDept.finish * deptRate('finish') +
    hoursByDept.install * deptRate('install')

  const materialCost = (variant?.material_cost_per_lf ?? 0) * qty
  const sheetCost = item.sheets_per_unit * item.sheet_cost * qty
  const hardwareCost = item.hardware_cost * qty

  // Override wins if set; else compute from the build-up.
  const computedUnitTotal =
    laborCost / Math.max(qty, 1) +
    materialCost / Math.max(qty, 1) +
    sheetCost / Math.max(qty, 1) +
    hardwareCost / Math.max(qty, 1)
  const unitPrice =
    line.unit_price_override != null ? line.unit_price_override : computedUnitTotal
  const lineTotal = unitPrice * qty

  const effectiveCallouts = line.callouts ?? item.default_callouts

  return {
    hoursByDept,
    totalHours,
    laborCost,
    materialCost,
    hardwareCost,
    sheetCost,
    lineTotal,
    effectiveCallouts,
  }
}

/**
 * Roll up every line in a subproject into the totals the editor's bottom
 * math panel shows. Applies consumable markup + profit margin at the
 * subproject level (not per-line).
 */
export function computeSubprojectRollup(
  lines: EstimateLine[],
  rateBook: {
    items: RateBookItem[]
    variantsByItem: Record<string, MaterialVariant[]>
  },
  defaults: PricingDefaults
): SubprojectRollup {
  const itemById = new Map(rateBook.items.map((i) => [i.id, i]))
  const variantById = new Map<string, MaterialVariant>()
  for (const list of Object.values(rateBook.variantsByItem)) {
    for (const v of list) variantById.set(v.id, v)
  }

  const acc: SubprojectRollup = {
    hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
    totalHours: 0,
    laborCost: 0,
    materialCost: 0,
    hardwareCost: 0,
    sheetCost: 0,
    consumables: 0,
    subtotal: 0,
    total: 0,
    marginPct: 0,
    lineCount: lines.length,
  }

  for (const line of lines) {
    const item = line.rate_book_item_id
      ? itemById.get(line.rate_book_item_id) ?? null
      : null
    const variant = line.rate_book_material_variant_id
      ? variantById.get(line.rate_book_material_variant_id) ?? null
      : null
    const b = computeLineBuildup(line, item, variant, defaults)
    acc.hoursByDept.eng += b.hoursByDept.eng
    acc.hoursByDept.cnc += b.hoursByDept.cnc
    acc.hoursByDept.assembly += b.hoursByDept.assembly
    acc.hoursByDept.finish += b.hoursByDept.finish
    acc.hoursByDept.install += b.hoursByDept.install
    acc.totalHours += b.totalHours
    acc.laborCost += b.laborCost
    acc.materialCost += b.materialCost
    acc.hardwareCost += b.hardwareCost
    acc.sheetCost += b.sheetCost
  }

  const markupBase = acc.materialCost + acc.sheetCost
  acc.consumables = markupBase * (defaults.consumableMarkupPct / 100)
  acc.subtotal =
    acc.laborCost + acc.materialCost + acc.sheetCost + acc.hardwareCost + acc.consumables

  // Profit margin applied as a gross-margin mark-up: price = cost / (1 - margin%).
  // Matches the rest of the app (see lib/pricing.ts).
  const marginFraction = Math.min(Math.max(defaults.profitMarginPct / 100, 0), 0.95)
  acc.total = marginFraction > 0 ? acc.subtotal / (1 - marginFraction) : acc.subtotal
  acc.marginPct =
    acc.total > 0 ? ((acc.total - acc.subtotal) / acc.total) * 100 : 0

  return acc
}

// ============================================================================
// lib/composer-loader.ts — assemble the ComposerRateBook payload.
// ============================================================================
// The composer needs six bundles of rate-book data to price a line:
//
//   1. Shop rate (orgs.shop_rate — single blended rate, per Phase 12 item 12)
//   2. Carcass per-LF labor (rate_book_items "Base cabinet" row from
//      BaseCabinetWalkthrough)
//   3. Carcass material templates (rate_book_carcass_materials)
//   4. Ext material templates (rate_book_ext_materials)
//   5. Door style items w/ per-door labor (rate_book_items where
//      category.item_type='door_style' — labor in door_labor_hours_*
//      populated by DoorStyleWalkthrough in item 7; V1 reads zeros as
//      "not calibrated")
//   6. Finish items (rate_book_items where category.item_type='finish')
//      plus their rate_book_finish_breakdown rows (per product category)
//
// Assembles and shapes into ComposerRateBook. Done in one pass so the
// composer's initial paint reads from a single ready object.
// ============================================================================

import { supabase } from './supabase'
import type {
  ComposerRateBook,
  ComposerCarcassLabor,
  ComposerDoorStyle,
  ComposerFinish,
  ComposerFinishProductRow,
} from './composer'
import { listCarcassMaterials, listExtMaterials } from './rate-book-materials'

/** Load + shape the composer's rate-book payload for an org. */
export async function loadComposerRateBook(orgId: string): Promise<ComposerRateBook> {
  const [
    shopRate,
    carcassLabor,
    carcassMats,
    extMats,
    doorStyles,
    finishes,
  ] = await Promise.all([
    loadShopRate(orgId),
    loadCarcassLaborFromBaseCab(orgId),
    listCarcassMaterials(orgId),
    listExtMaterials(orgId),
    loadDoorStyles(orgId),
    loadFinishes(orgId),
  ])

  const carcassCalibrated =
    carcassLabor.eng + carcassLabor.cnc + carcassLabor.assembly + carcassLabor.finish > 0

  return {
    shopRate,
    carcassLabor,
    carcassCalibrated,
    carcassMaterials: carcassMats.map((m) => ({
      id: m.id,
      name: m.name,
      sheet_cost: Number(m.sheet_cost) || 0,
      sheets_per_lf: Number(m.sheets_per_lf) || 0,
    })),
    extMaterials: extMats.map((m) => ({
      id: m.id,
      name: m.name,
      sheet_cost: Number(m.sheet_cost) || 0,
    })),
    doorStyles,
    finishes,
  }
}

// ── Shop rate ──

async function loadShopRate(orgId: string): Promise<number> {
  const { data } = await supabase
    .from('orgs')
    .select('shop_rate')
    .eq('id', orgId)
    .single()
  return Number((data as { shop_rate: number | null } | null)?.shop_rate) || 0
}

// ── Carcass labor from "Base cabinet" item ──

async function loadCarcassLaborFromBaseCab(orgId: string): Promise<ComposerCarcassLabor> {
  // Match the name BaseCabinetWalkthrough uses on save. Case-insensitive
  // so the lookup still works if a user typed it differently later.
  const { data } = await supabase
    .from('rate_book_items')
    .select(
      'base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly, base_labor_hours_finish'
    )
    .eq('org_id', orgId)
    .ilike('name', 'Base cabinet')
    .order('created_at', { ascending: true })
    .limit(1)
  const row = (data || [])[0] as
    | {
        base_labor_hours_eng: number | null
        base_labor_hours_cnc: number | null
        base_labor_hours_assembly: number | null
        base_labor_hours_finish: number | null
      }
    | undefined
  return {
    eng: Number(row?.base_labor_hours_eng ?? 0),
    cnc: Number(row?.base_labor_hours_cnc ?? 0),
    assembly: Number(row?.base_labor_hours_assembly ?? 0),
    finish: Number(row?.base_labor_hours_finish ?? 0),
  }
}

// ── Door styles ──

async function loadDoorStyles(orgId: string): Promise<ComposerDoorStyle[]> {
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id')
    .eq('org_id', orgId)
    .eq('item_type', 'door_style')
    .eq('active', true)
  const catIds = ((cats || []) as Array<{ id: string }>).map((c) => c.id)
  if (catIds.length === 0) return []

  const { data: items } = await supabase
    .from('rate_book_items')
    .select(
      'id, name, door_labor_hours_eng, door_labor_hours_cnc, door_labor_hours_assembly, door_labor_hours_finish'
    )
    .eq('org_id', orgId)
    .in('category_id', catIds)
    .eq('active', true)
    .order('name')

  return ((items || []) as Array<{
    id: string
    name: string
    door_labor_hours_eng: number | null
    door_labor_hours_cnc: number | null
    door_labor_hours_assembly: number | null
    door_labor_hours_finish: number | null
  }>).map((row) => {
    const labor = {
      eng: Number(row.door_labor_hours_eng ?? 0),
      cnc: Number(row.door_labor_hours_cnc ?? 0),
      assembly: Number(row.door_labor_hours_assembly ?? 0),
      finish: Number(row.door_labor_hours_finish ?? 0),
    }
    const calibrated = labor.eng + labor.cnc + labor.assembly + labor.finish > 0
    return { id: row.id, name: row.name, labor, calibrated }
  })
}

// ── Finishes + breakdown ──

async function loadFinishes(orgId: string): Promise<ComposerFinish[]> {
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id')
    .eq('org_id', orgId)
    .eq('item_type', 'finish')
    .eq('active', true)
  const catIds = ((cats || []) as Array<{ id: string }>).map((c) => c.id)
  if (catIds.length === 0) return []

  const { data: items } = await supabase
    .from('rate_book_items')
    .select('id, name')
    .eq('org_id', orgId)
    .in('category_id', catIds)
    .eq('active', true)
    .order('name')
  const finishItems = (items || []) as Array<{ id: string; name: string }>
  if (finishItems.length === 0) return []

  const finishIds = finishItems.map((f) => f.id)
  const { data: rows } = await supabase
    .from('rate_book_finish_breakdown')
    .select(
      'rate_book_item_id, product_category, labor_hr_per_lf, primer_cost_per_lf, paint_cost_per_lf, stain_cost_per_lf, lacquer_cost_per_lf'
    )
    .in('rate_book_item_id', finishIds)

  const breakdownByItem = new Map<string, Map<string, ComposerFinishProductRow>>()
  for (const r of (rows || []) as Array<{
    rate_book_item_id: string
    product_category: string
    labor_hr_per_lf: number | null
    primer_cost_per_lf: number | null
    paint_cost_per_lf: number | null
    stain_cost_per_lf: number | null
    lacquer_cost_per_lf: number | null
  }>) {
    const material =
      (Number(r.primer_cost_per_lf) || 0) +
      (Number(r.paint_cost_per_lf) || 0) +
      (Number(r.stain_cost_per_lf) || 0) +
      (Number(r.lacquer_cost_per_lf) || 0)
    const prodMap =
      breakdownByItem.get(r.rate_book_item_id) ||
      new Map<string, ComposerFinishProductRow>()
    prodMap.set(r.product_category, {
      laborHr: Number(r.labor_hr_per_lf) || 0,
      material,
    })
    breakdownByItem.set(r.rate_book_item_id, prodMap)
  }

  return finishItems.map((f) => {
    const isPrefinished = /^prefinished$/i.test(f.name)
    const prodMap = breakdownByItem.get(f.id)
    const byProduct: ComposerFinish['byProduct'] = {}
    if (prodMap) {
      if (prodMap.has('base')) byProduct.base = prodMap.get('base')!
      if (prodMap.has('upper')) byProduct.upper = prodMap.get('upper')!
      if (prodMap.has('full')) byProduct.full = prodMap.get('full')!
    }
    // Prefinished is implicit zero everywhere — if a user has a
    // "Prefinished" item without breakdown rows, synthesize zeros so the
    // line can still save.
    if (isPrefinished) {
      if (!byProduct.base) byProduct.base = { laborHr: 0, material: 0 }
      if (!byProduct.upper) byProduct.upper = { laborHr: 0, material: 0 }
      if (!byProduct.full) byProduct.full = { laborHr: 0, material: 0 }
    }
    return { id: f.id, name: f.name, isPrefinished, byProduct }
  })
}

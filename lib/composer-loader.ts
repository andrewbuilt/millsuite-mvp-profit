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
  ComposerSolidWoodComponent,
  SolidWoodTopCalibration,
} from './composer'
import {
  listCarcassMaterials,
  listExtMaterials,
  listBackPanelMaterials,
} from './rate-book-materials'
import {
  listDoorTypes,
  listDoorTypeMaterials,
  listDoorTypeMaterialFinishes,
  indexDoorTypeMaterials,
  indexDoorTypeMaterialFinishes,
} from './door-types'

/** Load + shape the composer's rate-book payload for an org. */
export async function loadComposerRateBook(orgId: string): Promise<ComposerRateBook> {
  const [
    shopRate,
    carcassLabor,
    carcassMats,
    extMats,
    backPanelMats,
    doorTypes,
    doorTypeMaterials,
    doorTypeMaterialFinishes,
    drawerStyles,
    finishes,
    solidWoodTopCalibration,
    solidWoodComponents,
  ] = await Promise.all([
    loadShopRate(orgId),
    loadCarcassLaborFromBaseCab(orgId),
    listCarcassMaterials(orgId),
    listExtMaterials(orgId),
    listBackPanelMaterials(orgId),
    listDoorTypes(orgId),
    listDoorTypeMaterials(orgId),
    listDoorTypeMaterialFinishes(orgId),
    loadDrawerStyles(orgId),
    loadFinishes(orgId),
    loadSolidWoodTopCalibration(orgId),
    loadSolidWoodComponentsForComposer(orgId),
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
    backPanelMaterials: backPanelMats.map((m) => ({
      id: m.id,
      name: m.name,
      sheet_cost: Number(m.sheet_cost) || 0,
    })),
    doorTypes,
    doorTypeMaterials,
    doorTypeMaterialFinishes,
    doorTypeMaterialsByTypeId: indexDoorTypeMaterials(doorTypeMaterials),
    doorFinishesByMaterialId: indexDoorTypeMaterialFinishes(doorTypeMaterialFinishes),
    drawerStyles,
    finishes,
    solidWoodTopCalibration,
    solidWoodComponents,
  }
}

// ── Solid Wood Top calibration + materials ──

async function loadSolidWoodTopCalibration(
  orgId: string,
): Promise<SolidWoodTopCalibration | null> {
  const { data, error } = await supabase
    .from('solid_wood_top_calibrations')
    .select(
      'calib_length_in, calib_width_in, calib_thickness_in, hours_by_op, edge_mult_hand, edge_mult_cnc, default_cut_method, default_material_id',
    )
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return null
  return {
    calib_length_in: Number((data as any).calib_length_in) || 0,
    calib_width_in: Number((data as any).calib_width_in) || 0,
    calib_thickness_in: Number((data as any).calib_thickness_in) || 0,
    hours_by_op: ((data as any).hours_by_op || {}) as SolidWoodTopCalibration['hours_by_op'],
    edge_mult_hand: Number((data as any).edge_mult_hand) || 1,
    edge_mult_cnc: Number((data as any).edge_mult_cnc) || 1,
    default_cut_method:
      ((data as any).default_cut_method as 'saw' | 'cnc') || 'saw',
    default_material_id: (data as any).default_material_id ?? null,
  }
}

async function loadSolidWoodComponentsForComposer(
  orgId: string,
): Promise<ComposerSolidWoodComponent[]> {
  const { data, error } = await supabase
    .from('solid_wood_components')
    .select('id, name, cost_per_bdft, waste_pct')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error || !data) return []
  return (data as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    cost_per_bdft: Number(r.cost_per_bdft) || 0,
    waste_pct: Number(r.waste_pct) || 0,
  }))
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

// ── Drawer styles ──

async function loadDrawerStyles(orgId: string): Promise<ComposerDoorStyle[]> {
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id')
    .eq('org_id', orgId)
    .eq('item_type', 'drawer_style')
    .eq('active', true)
  const catIds = ((cats || []) as Array<{ id: string }>).map((c) => c.id)
  if (catIds.length === 0) return []

  const { data: items } = await supabase
    .from('rate_book_items')
    .select(
      'id, name, drawer_labor_hours_eng, drawer_labor_hours_cnc, drawer_labor_hours_assembly, drawer_labor_hours_finish, drawer_hardware_cost',
    )
    .eq('org_id', orgId)
    .in('category_id', catIds)
    .eq('active', true)
    .order('name')

  return ((items || []) as Array<{
    id: string
    name: string
    drawer_labor_hours_eng: number | null
    drawer_labor_hours_cnc: number | null
    drawer_labor_hours_assembly: number | null
    drawer_labor_hours_finish: number | null
    drawer_hardware_cost: number | null
  }>).map((row) => {
    const labor = {
      eng: Number(row.drawer_labor_hours_eng ?? 0),
      cnc: Number(row.drawer_labor_hours_cnc ?? 0),
      assembly: Number(row.drawer_labor_hours_assembly ?? 0),
      finish: Number(row.drawer_labor_hours_finish ?? 0),
    }
    const calibrated = labor.eng + labor.cnc + labor.assembly + labor.finish > 0
    return {
      id: row.id,
      name: row.name,
      labor,
      calibrated,
      hardwareCost: Number(row.drawer_hardware_cost ?? 0),
    }
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
    .select('id, name, application')
    .eq('org_id', orgId)
    .in('category_id', catIds)
    .eq('active', true)
    .order('name')
  const finishItems = (items || []) as Array<{
    id: string
    name: string
    application: string | null
  }>
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

  return finishItems
    .filter((f) => !/^prefinished$/i.test(f.name))
    .map((f) => {
      const application: 'interior' | 'exterior' =
        f.application === 'interior' ? 'interior' : 'exterior'
      const prodMap = breakdownByItem.get(f.id)
      const byProduct: ComposerFinish['byProduct'] = {}
      if (prodMap) {
        if (prodMap.has('base')) byProduct.base = prodMap.get('base')!
        if (prodMap.has('upper')) byProduct.upper = prodMap.get('upper')!
        if (prodMap.has('full')) byProduct.full = prodMap.get('full')!
      }
      return {
        id: f.id,
        name: f.name,
        application,
        isPrefinished: false,
        byProduct,
      }
    })
}
// NOTE: legacy "Prefinished" rate_book_item rows (from before the sentinel
// landed) are filtered out above. The Prefinished option shown in the
// Interior dropdown is synthesized client-side via prefinishedSentinel().

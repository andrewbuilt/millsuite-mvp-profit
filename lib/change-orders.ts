// ============================================================================
// change-orders.ts — data access for change orders (Phase 4)
// ============================================================================
// Implements the D3 (separate-invoice default), D7 (custom baseline diff),
// and D10 (bid math) decisions from BUILD-PLAN.md against change_orders in
// migrations/002_preprod_approval_schema.sql. V1 is manual throughout: no QB
// API call, no auto-email, no portal signing. Shop user captures the
// client's verbal/email approval and the QB handoff method by hand.
// ============================================================================

import { supabase } from './supabase'

// ── Types ──

export type CoState = 'draft' | 'sent_to_client' | 'approved' | 'rejected' | 'void'
export type QbHandoffState =
  | 'not_yet'
  | 'separate_invoice'
  | 'invoice_edited'
  | 'not_applicable'

/**
 * Snapshot shape stored in `original_line_snapshot` / `proposed_line`. Kept
 * loose intentionally — covers rate-book-sourced slots AND custom slots.
 */
export interface LineSnapshot {
  // Rate-book-sourced:
  rate_book_item_id?: string | null
  rate_book_material_variant_id?: string | null
  linear_feet?: number | null
  quantity?: number | null
  // Custom slot:
  is_custom?: boolean
  material_cost_per_lf?: number | null
  labor_hours_eng?: number | null
  labor_hours_cnc?: number | null
  labor_hours_assembly?: number | null
  labor_hours_finish?: number | null
  labor_hours_install?: number | null
  // Display:
  label?: string
  material?: string
  finish?: string | null
  notes?: string
}

export interface ChangeOrder {
  id: string
  project_id: string
  subproject_id: string | null
  approval_item_id: string | null
  title: string
  original_line_snapshot: LineSnapshot
  proposed_line: LineSnapshot
  net_change: number
  no_price_change: boolean
  state: CoState
  client_response_note: string | null
  qb_handoff_state: QbHandoffState
  qb_handoff_note: string | null
  created_at: string
  updated_at: string
}

// ── Reads ──

/**
 * Load every CO on a project, newest first. The UI's CO list uses this.
 */
export async function loadChangeOrdersForProject(
  projectId: string
): Promise<ChangeOrder[]> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('loadChangeOrdersForProject', error)
    return []
  }
  return (data || []) as ChangeOrder[]
}

/**
 * Load COs on a single subproject. Used when surfacing the CO panel inside
 * the subproject expanded view.
 */
export async function loadChangeOrdersForSubproject(
  subprojectId: string
): Promise<ChangeOrder[]> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('subproject_id', subprojectId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('loadChangeOrdersForSubproject', error)
    return []
  }
  return (data || []) as ChangeOrder[]
}

// ── Repricing math (D2 + D7 + D10) ──

export interface PricingInputs {
  /** $/hour shop rate, e.g. org.shop_rate. */
  shopRate: number
  /** 0–100, applied to material. Matches subproject pricing. */
  consumableMarkupPct: number
  /** 0–100, applied after cost to get price. Matches subproject pricing. */
  profitMarginPct: number
}

/**
 * Compute a line's cost (labor + material + consumables) given a snapshot. If
 * the snapshot doesn't have enough info (e.g. custom slot without baseline),
 * returns null to signal "manual entry required."
 */
export function computeSnapshotCost(
  snap: LineSnapshot,
  inputs: PricingInputs
): { materialCost: number; laborCost: number; totalCost: number } | null {
  // Custom slot diff path (D7).
  if (snap.is_custom) {
    if (
      snap.material_cost_per_lf == null ||
      snap.labor_hours_eng == null ||
      snap.labor_hours_cnc == null ||
      snap.labor_hours_assembly == null ||
      snap.labor_hours_finish == null ||
      snap.labor_hours_install == null
    ) {
      return null
    }
    const lf = snap.linear_feet ?? 0
    const matCost =
      (snap.material_cost_per_lf ?? 0) * lf * (1 + inputs.consumableMarkupPct / 100)
    const hours =
      (snap.labor_hours_eng ?? 0) +
      (snap.labor_hours_cnc ?? 0) +
      (snap.labor_hours_assembly ?? 0) +
      (snap.labor_hours_finish ?? 0) +
      (snap.labor_hours_install ?? 0)
    const laborCost = hours * inputs.shopRate
    return { materialCost: matCost, laborCost, totalCost: matCost + laborCost }
  }

  // Rate-book path — caller must enrich the snapshot with variant + item
  // details before calling. Any snapshot missing LF + numbers returns null.
  if (
    snap.material_cost_per_lf == null ||
    snap.labor_hours_eng == null ||
    snap.labor_hours_cnc == null ||
    snap.labor_hours_assembly == null ||
    snap.labor_hours_finish == null ||
    snap.labor_hours_install == null
  ) {
    return null
  }
  const lf = snap.linear_feet ?? 0
  const matCost =
    (snap.material_cost_per_lf ?? 0) * lf * (1 + inputs.consumableMarkupPct / 100)
  const hours =
    (snap.labor_hours_eng ?? 0) +
    (snap.labor_hours_cnc ?? 0) +
    (snap.labor_hours_assembly ?? 0) +
    (snap.labor_hours_finish ?? 0) +
    (snap.labor_hours_install ?? 0)
  const laborCost = hours * inputs.shopRate
  return { materialCost: matCost, laborCost, totalCost: matCost + laborCost }
}

/**
 * Net price delta for a CO = (proposed price) − (original price). Applies the
 * same margin the subproject pricer uses so the client-facing number is
 * consistent with the original bid. Returns null when either side is
 * unpriceable (caller should prompt manual entry).
 */
export function computeNetChange(
  original: LineSnapshot,
  proposed: LineSnapshot,
  inputs: PricingInputs
): number | null {
  const o = computeSnapshotCost(original, inputs)
  const p = computeSnapshotCost(proposed, inputs)
  if (!o || !p) return null
  const marginMultiplier = 1 / (1 - inputs.profitMarginPct / 100)
  const originalPrice = o.totalCost * marginMultiplier
  const proposedPrice = p.totalCost * marginMultiplier
  return Math.round((proposedPrice - originalPrice) * 100) / 100
}

/**
 * Enrich a rate-book-backed snapshot with material + labor numbers pulled
 * from the variant + item records. Mutation-free: returns a new snapshot.
 * Labor hours = base item hours × variant multipliers. LF stays as provided
 * (or pulled from the source estimate line separately).
 */
export async function enrichRateBookSnapshot(
  snap: LineSnapshot
): Promise<LineSnapshot> {
  if (!snap.rate_book_item_id) return snap
  const { data: item } = await supabase
    .from('rate_book_items')
    .select(
      'id, base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly, base_labor_hours_finish, base_labor_hours_install'
    )
    .eq('id', snap.rate_book_item_id)
    .maybeSingle()
  if (!item) return snap

  let variant: any = null
  if (snap.rate_book_material_variant_id) {
    const { data } = await supabase
      .from('rate_book_material_variants')
      .select(
        'id, material_cost_per_lf, labor_multiplier_eng, labor_multiplier_cnc, labor_multiplier_assembly, labor_multiplier_finish, labor_multiplier_install'
      )
      .eq('id', snap.rate_book_material_variant_id)
      .maybeSingle()
    variant = data
  }
  const mult = (k: string) => (variant ? Number(variant[`labor_multiplier_${k}`] ?? 1) : 1)

  return {
    ...snap,
    material_cost_per_lf:
      snap.material_cost_per_lf ?? (variant ? Number(variant.material_cost_per_lf ?? 0) : 0),
    labor_hours_eng: Number(item.base_labor_hours_eng ?? 0) * mult('eng'),
    labor_hours_cnc: Number(item.base_labor_hours_cnc ?? 0) * mult('cnc'),
    labor_hours_assembly: Number(item.base_labor_hours_assembly ?? 0) * mult('assembly'),
    labor_hours_finish: Number(item.base_labor_hours_finish ?? 0) * mult('finish'),
    labor_hours_install: Number(item.base_labor_hours_install ?? 0) * mult('install'),
  }
}

// ── Create + update ──

/**
 * Create a new change order. Caller is responsible for enriching snapshots
 * and computing net_change (or marking no_price_change). State starts in
 * 'draft' and qb_handoff_state in 'not_yet'.
 */
export async function createChangeOrder(
  input: {
    project_id: string
    subproject_id?: string | null
    approval_item_id?: string | null
    title: string
    original_line_snapshot: LineSnapshot
    proposed_line: LineSnapshot
    net_change: number
    no_price_change?: boolean
  }
): Promise<ChangeOrder | null> {
  const { data, error } = await supabase
    .from('change_orders')
    .insert({
      project_id: input.project_id,
      subproject_id: input.subproject_id ?? null,
      approval_item_id: input.approval_item_id ?? null,
      title: input.title,
      original_line_snapshot: input.original_line_snapshot,
      proposed_line: input.proposed_line,
      net_change: input.net_change,
      no_price_change: input.no_price_change ?? false,
      state: 'draft' as CoState,
      qb_handoff_state: 'not_yet' as QbHandoffState,
    })
    .select()
    .single()
  if (error) {
    console.error('createChangeOrder', error)
    return null
  }
  return data as ChangeOrder
}

// ── State transitions ──

export async function sendCoToClient(coId: string): Promise<void> {
  const { error } = await supabase
    .from('change_orders')
    .update({ state: 'sent_to_client' as CoState, updated_at: new Date().toISOString() })
    .eq('id', coId)
  if (error) throw error
}

export async function approveCo(coId: string, note?: string): Promise<void> {
  const patch: any = {
    state: 'approved' as CoState,
    updated_at: new Date().toISOString(),
  }
  if (note !== undefined) patch.client_response_note = note
  const { error } = await supabase.from('change_orders').update(patch).eq('id', coId)
  if (error) throw error
}

export async function rejectCo(coId: string, note?: string): Promise<void> {
  const patch: any = {
    state: 'rejected' as CoState,
    updated_at: new Date().toISOString(),
  }
  if (note !== undefined) patch.client_response_note = note
  const { error } = await supabase.from('change_orders').update(patch).eq('id', coId)
  if (error) throw error
}

export async function voidCo(coId: string): Promise<void> {
  const { error } = await supabase
    .from('change_orders')
    .update({ state: 'void' as CoState, updated_at: new Date().toISOString() })
    .eq('id', coId)
  if (error) throw error
}

// ── QB handoff (D3) ──

/**
 * Mark how the CO dollars made it to QuickBooks. Default pattern per D3 is
 * separate_invoice. Fully manual — no API call. The note field is free-form
 * so the user can record "Added to invoice #1234 on 4/22" etc.
 */
export async function markQbHandoff(
  coId: string,
  state: QbHandoffState,
  note?: string
): Promise<void> {
  const patch: any = {
    qb_handoff_state: state,
    updated_at: new Date().toISOString(),
  }
  if (note !== undefined) patch.qb_handoff_note = note
  const { error } = await supabase.from('change_orders').update(patch).eq('id', coId)
  if (error) throw error
}

// ── Derived helpers ──

/**
 * D10 math: sum of approved CO net_change amounts for a project. Original
 * bid stays frozen; this number is layered on top for the "current total"
 * display.
 */
export function sumApprovedNetChange(cos: ChangeOrder[]): number {
  return cos
    .filter((c) => c.state === 'approved')
    .reduce((sum, c) => sum + Number(c.net_change || 0), 0)
}

export function openCoCount(cos: ChangeOrder[]): number {
  return cos.filter((c) => c.state === 'draft' || c.state === 'sent_to_client').length
}

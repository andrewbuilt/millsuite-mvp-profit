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
import { recomputeProjectBidTotal } from './project-totals'
import { createInvoice, appendInvoiceLine } from './invoices'
import {
  computeBucketedPrice,
  type BucketMargins,
  type CostBuckets,
} from './pricing'

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
  // v2 (migration 067) — Andrew's 2026-07-20 flow:
  co_number: number | null
  material_cost: number | null
  labor_cost: number | null
  client_price: number | null
  internal_cost_delta: number | null
  drawing_revision_required: boolean
  co_invoice_id: string | null
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
 * Every change order billed on a given invoice, oldest first.
 *
 * A CO invoice is a rolling document — accepting a priced CO appends to the
 * open one rather than raising a new invoice each time (see
 * `appendCoToRollingInvoice`). That's deliberate, but it means an invoice can
 * carry several COs with nothing on screen saying which, so "what is this
 * $4,890 for?" had no answer. Payment audit item 3.
 */
export async function loadChangeOrdersForInvoice(
  invoiceId: string
): Promise<ChangeOrder[]> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('co_invoice_id', invoiceId)
    .order('co_number', { ascending: true })
  if (error) {
    console.error('loadChangeOrdersForInvoice', error)
    return []
  }
  return (data || []) as ChangeOrder[]
}

/** Load a single change order by id (the CO detail page). */
export async function loadChangeOrder(id: string): Promise<ChangeOrder | null> {
  const { data, error } = await supabase
    .from('change_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('loadChangeOrder', error)
    return null
  }
  return (data as ChangeOrder) ?? null
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
  /** 0–100, applied to material to derive consumables. Matches subproject pricing. */
  consumableMarkupPct: number
  /** 0–100, legacy single margin. Used only when `margins` is absent. */
  profitMarginPct: number
  /** Per-bucket true gross margins (migration 052). When present, CO
   *  pricing uses these via computeBucketedPrice so it matches the project
   *  total. When absent, falls back to profitMarginPct (legacy). */
  margins?: BucketMargins
}

/**
 * Compute a line's cost broken into the buckets the margin model needs:
 * labor (all dept hours incl. install × shop rate), base material (before
 * consumables), and consumables (material × markup). Returns null when the
 * snapshot lacks enough info (e.g. custom slot without baseline) so the
 * caller can prompt manual entry.
 */
export function computeSnapshotCost(
  snap: LineSnapshot,
  inputs: PricingInputs
): {
  materialCost: number
  consumablesCost: number
  laborCost: number
  totalCost: number
} | null {
  const hasNumbers =
    snap.material_cost_per_lf != null &&
    snap.labor_hours_eng != null &&
    snap.labor_hours_cnc != null &&
    snap.labor_hours_assembly != null &&
    snap.labor_hours_finish != null &&
    snap.labor_hours_install != null
  // Custom (D7) and rate-book paths share the same math once numbers are
  // present; both require the full set or they're unpriceable.
  if (!hasNumbers) return null

  const lf = snap.linear_feet ?? 0
  const materialCost = (snap.material_cost_per_lf ?? 0) * lf
  const consumablesCost = materialCost * (inputs.consumableMarkupPct / 100)
  const hours =
    (snap.labor_hours_eng ?? 0) +
    (snap.labor_hours_cnc ?? 0) +
    (snap.labor_hours_assembly ?? 0) +
    (snap.labor_hours_finish ?? 0) +
    (snap.labor_hours_install ?? 0)
  const laborCost = hours * inputs.shopRate
  return {
    materialCost,
    consumablesCost,
    laborCost,
    totalCost: materialCost + consumablesCost + laborCost,
  }
}

/** Price a CO snapshot's cost split into a customer price. Uses the three
 *  per-bucket margins when available (consistent with the project total),
 *  else the legacy single margin. CO lines have no hardware/options and
 *  fold install into labor hours, so those buckets are 0. */
function priceSnapshot(
  cost: { materialCost: number; consumablesCost: number; laborCost: number; totalCost: number },
  inputs: PricingInputs,
): number {
  if (inputs.margins) {
    const buckets: CostBuckets = {
      laborCost: cost.laborCost,
      materialCost: cost.materialCost,
      consumablesCost: cost.consumablesCost,
      hardwareCost: 0,
      installCost: 0,
      optionsCost: 0,
    }
    return computeBucketedPrice(buckets, inputs.margins).priceTotal
  }
  const m = Math.min(Math.max(inputs.profitMarginPct / 100, 0), 0.99)
  return m > 0 ? cost.totalCost / (1 - m) : cost.totalCost
}

/**
 * Net price delta for a CO = (proposed price) − (original price). Applies the
 * same per-bucket margins the project pricer uses so the client-facing number
 * is consistent with the original bid. Returns null when either side is
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
  return Math.round((priceSnapshot(p, inputs) - priceSnapshot(o, inputs)) * 100) / 100
}

/**
 * v2 (Andrew's flow): the client price for a change where the operator enters
 * material + labor cost directly. Runs those through the project's margins
 * (same pricer as the bid) so the CO reads consistently with the contract.
 * Consumables derive from material × the org markup. The modal shows this as
 * the default; the operator can override the final number.
 */
export function computeCoClientPrice(
  materialCost: number,
  laborCost: number,
  inputs: PricingInputs,
): number {
  const mat = Number(materialCost) || 0
  const lab = Number(laborCost) || 0
  const consumables = mat * ((Number(inputs.consumableMarkupPct) || 0) / 100)
  return Math.round(
    priceSnapshot(
      {
        materialCost: mat,
        consumablesCost: consumables,
        laborCost: lab,
        totalCost: mat + consumables + lab,
      },
      inputs,
    ),
  )
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

/** Rate-book materials for the CO modal's "new material" autocomplete. Distinct
 *  material names across the org's rate-book variants, with a representative
 *  cost/LF. Empty until the org's rate book has materials. */
export interface CoMaterial {
  name: string
  costPerLf: number
}
export async function listCoMaterials(orgId: string): Promise<CoMaterial[]> {
  const { data, error } = await supabase
    .from('rate_book_material_variants')
    .select('material_name, material_cost_per_lf, rate_book_items!inner(org_id)')
    .eq('rate_book_items.org_id', orgId)
  if (error) {
    console.error('listCoMaterials', error)
    return []
  }
  const byName = new Map<string, number>()
  for (const r of (data || []) as any[]) {
    const name = String(r.material_name || '').trim()
    if (!name) continue
    const cost = Number(r.material_cost_per_lf) || 0
    if (!byName.has(name)) byName.set(name, cost)
  }
  return Array.from(byName.entries())
    .map(([name, costPerLf]) => ({ name, costPerLf }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Next sequential CO number for a project (CO-01, CO-02, …). */
async function nextCoNumber(projectId: string): Promise<number> {
  // Must exclude null co_number rows: Postgres sorts DESC as NULLS FIRST, so
  // a single legacy/null-numbered CO would win .limit(1) and peg every new
  // number at 1. Filtering nulls makes the max reflect real CO numbers.
  const { data } = await supabase
    .from('change_orders')
    .select('co_number')
    .eq('project_id', projectId)
    .not('co_number', 'is', null)
    .order('co_number', { ascending: false })
    .limit(1)
  const max = data && data[0]?.co_number ? Number(data[0].co_number) : 0
  return max + 1
}

/**
 * v2 create (Andrew's flow): the operator picked the spec that's changing, set
 * the new material, and entered material + labor cost; `client_price` is the
 * margin-priced amount (0 = a free CO). Auto-assigns the next CO number and
 * starts in `draft`. `net_change` = client_price so the Option-A contract
 * display (sumApprovedNetChange) tallies correctly once approved.
 */
export async function createChangeOrderV2(input: {
  project_id: string
  subproject_id?: string | null
  title: string
  original_line_snapshot?: LineSnapshot
  proposed_line?: LineSnapshot
  material_cost: number
  labor_cost: number
  client_price: number
  internal_cost_delta?: number | null
  drawing_revision_required?: boolean
}): Promise<ChangeOrder | null> {
  const co_number = await nextCoNumber(input.project_id)
  const price = Number(input.client_price) || 0
  const { data, error } = await supabase
    .from('change_orders')
    .insert({
      project_id: input.project_id,
      subproject_id: input.subproject_id ?? null,
      title: input.title,
      original_line_snapshot: input.original_line_snapshot ?? {},
      proposed_line: input.proposed_line ?? {},
      net_change: price,
      no_price_change: price === 0,
      state: 'draft' as CoState,
      qb_handoff_state: 'not_yet' as QbHandoffState,
      co_number,
      material_cost: input.material_cost,
      labor_cost: input.labor_cost,
      client_price: price,
      internal_cost_delta: input.internal_cost_delta ?? null,
      drawing_revision_required: input.drawing_revision_required ?? false,
    })
    .select()
    .single()
  if (error) {
    console.error('createChangeOrderV2', error)
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
  // Phase 7: on approve, propagate the proposed_line into the linked
  // approval_item + estimate_line in place. Best-effort — failures here are
  // logged but don't roll back the state change.
  try {
    await applyApprovedCo(coId)
  } catch (err) {
    console.error('approveCo: applyApprovedCo failed (state already flipped)', err)
  }
  // Pricing-input write-back: a CO approval shifts material/finish on
  // the underlying line, which can move priceTotal. Resolve project_id
  // off the CO row and refresh.
  try {
    const { data: coRow } = await supabase
      .from('change_orders')
      .select('project_id')
      .eq('id', coId)
      .maybeSingle()
    const projectId = (coRow as { project_id: string | null } | null)?.project_id
    if (projectId) {
      void recomputeProjectBidTotal(projectId)
    }
  } catch (err) {
    console.error('approveCo: bid_total recompute', err)
  }
  // Step 4 — priced path: a priced CO ($client_price > 0) bills to the
  // project's rolling CO invoice on accept. Free ($0) COs go through
  // finalizeFreeCo, never here, so this only ever runs for real charges.
  try {
    const { data: coFull } = await supabase
      .from('change_orders')
      .select('*')
      .eq('id', coId)
      .maybeSingle()
    if (coFull && (Number((coFull as ChangeOrder).client_price) || 0) > 0) {
      await appendCoToRollingInvoice(coFull as ChangeOrder)
    }
  } catch (err) {
    console.error('approveCo: rolling CO invoice', err)
  }
}

/**
 * Free-path finalize (step 3, Andrew's 2026-07-20 model). A $0 change order
 * needs no client price approval and produces NO invoice — it only documents
 * the change and propagates it. Called right after createChangeOrderV2 when
 * client_price === 0, so a free CO applies immediately instead of sitting in
 * draft waiting for Send/Accept.
 *
 * Flips state → approved and runs applyApprovedCo (spec flip on the linked
 * approval card + estimate line — the same propagation the priced Accept uses).
 * drawing_revision_required is already stored on the row from create. Never
 * touches any invoice — that's the priced path (step 4) only, which is why this
 * is a separate function from approveCo rather than a call to it.
 */
export async function finalizeFreeCo(coId: string): Promise<void> {
  const { error } = await supabase
    .from('change_orders')
    .update({ state: 'approved' as CoState, updated_at: new Date().toISOString() })
    .eq('id', coId)
  if (error) throw error
  try {
    await applyApprovedCo(coId)
  } catch (err) {
    console.error('finalizeFreeCo: applyApprovedCo failed (state already flipped)', err)
  }
  try {
    const { data: coRow } = await supabase
      .from('change_orders')
      .select('project_id')
      .eq('id', coId)
      .maybeSingle()
    const projectId = (coRow as { project_id: string | null } | null)?.project_id
    if (projectId) void recomputeProjectBidTotal(projectId)
  } catch (err) {
    console.error('finalizeFreeCo: bid_total recompute', err)
  }
}

// ── Priced path: rolling per-project CO invoice (step 4) ──

/**
 * Find the project's OPEN CO invoice — the current un-pushed batch. COs append
 * to it until it's pushed to QuickBooks; once pushed (`qbo_invoice_id` set) it
 * LOCKS (batch-and-lock, Andrew 2026-07-21) and the next accepted CO opens a
 * fresh invoice, so each QB invoice is pushed exactly once and MillSuite always
 * matches QB. Voided + already-pushed invoices are skipped.
 */
async function findCoInvoiceId(projectId: string): Promise<string | null> {
  const { data: cos } = await supabase
    .from('change_orders')
    .select('co_invoice_id')
    .eq('project_id', projectId)
    .not('co_invoice_id', 'is', null)
  const ids = Array.from(
    new Set(
      ((cos as { co_invoice_id: string | null }[] | null) || [])
        .map((c) => c.co_invoice_id)
        .filter((x): x is string => !!x),
    ),
  )
  if (ids.length === 0) return null
  const { data: inv } = await supabase
    .from('client_invoices')
    .select('id')
    .in('id', ids)
    .is('qbo_invoice_id', null)
    .neq('status', 'void')
    .limit(1)
  return (inv && (inv[0] as { id: string } | undefined)?.id) || null
}

/**
 * Step 4 — priced path. When a priced CO ($client_price > 0) is accepted, its
 * amount lands on the project's ROLLING CO invoice (one per project): the first
 * accepted CO creates the invoice, later ones append a line. Line carries
 * `source_type='change_order'` + `source_id=co.id`; the CO's `co_invoice_id`
 * links back. Free ($0) COs never reach this (finalizeFreeCo, not approveCo).
 *
 * Idempotent: a CO that already has `co_invoice_id` is skipped (a double-accept
 * won't double-bill). This writes the MillSuite invoice only — the QB push
 * mirrors the contract flow and is operator-initiated separately.
 */
async function appendCoToRollingInvoice(co: ChangeOrder): Promise<void> {
  const price = Number(co.client_price) || 0
  if (price <= 0) return
  if (co.co_invoice_id) return // already billed

  const { data: project } = await supabase
    .from('projects')
    .select('id, org_id, client_id')
    .eq('id', co.project_id)
    .maybeSingle()
  const proj = project as { org_id: string | null; client_id: string | null } | null
  if (!proj?.org_id) {
    console.error('appendCoToRollingInvoice: no org for project', co.project_id)
    return
  }

  const desc = `CO-${String(co.co_number ?? 0).padStart(2, '0')} — ${co.title}`
  const line = {
    description: desc,
    quantity: 1,
    unit_price: price,
    amount: price,
    source_type: 'change_order' as const,
    source_id: co.id,
  }

  const existingInvoiceId = await findCoInvoiceId(co.project_id)
  if (existingInvoiceId) {
    await appendInvoiceLine(existingInvoiceId, line)
    await supabase
      .from('change_orders')
      .update({ co_invoice_id: existingInvoiceId })
      .eq('id', co.id)
    return
  }

  // First accepted CO on this project — open the rolling invoice.
  const { data: org } = await supabase
    .from('orgs')
    .select('default_tax_pct')
    .eq('id', proj.org_id)
    .maybeSingle()
  const taxPct = Number((org as { default_tax_pct: number | null } | null)?.default_tax_pct) || 0
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const inv = await createInvoice({
    invoice: {
      org_id: proj.org_id,
      project_id: co.project_id,
      client_id: proj.client_id ?? null,
      invoice_date: today,
      due_date: due,
      tax_pct: taxPct,
      notes: 'Change order invoice',
    },
    lineItems: [{ sort_order: 0, ...line }],
    markSent: true,
  })
  await supabase
    .from('change_orders')
    .update({ co_invoice_id: inv.id })
    .eq('id', co.id)
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

/**
 * Hard-delete a change order. Used from the CO dashboard to clean up
 * void/declined rows for good (voidCo only flips state; this removes the
 * record). Guarded to non-live states so an approved/billed CO can't be
 * silently deleted out from under its invoice.
 */
export async function deleteCo(coId: string): Promise<void> {
  const { data: co } = await supabase
    .from('change_orders')
    .select('state')
    .eq('id', coId)
    .maybeSingle()
  const state = (co as { state: CoState } | null)?.state
  if (state === 'approved') {
    throw new Error('An approved change order cannot be deleted — void its invoice first.')
  }
  const { error } = await supabase.from('change_orders').delete().eq('id', coId)
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

// ── Phase 7: draft-from-approval-card path ──

/**
 * Spawn a draft CO seeded from an approval card. Used when the client says
 * "actually I want a different material" on an in-review or approved slot —
 * we lock in what was on the slot at this moment as the original snapshot,
 * then leave proposed_line as a copy the user can edit. The new draft is
 * linked back to the approval_item via approval_item_id.
 *
 * Returns the new CO row, or null on failure.
 */
export async function draftCoFromApprovalCard(
  approvalItemId: string
): Promise<ChangeOrder | null> {
  const { data: itemRaw, error: itemErr } = await supabase
    .from('approval_items')
    .select(
      'id, subproject_id, source_estimate_line_id, label, material, finish, is_custom, ' +
        'rate_book_item_id, rate_book_material_variant_id, ' +
        'custom_material_cost_per_lf, custom_labor_hours_eng, custom_labor_hours_cnc, ' +
        'custom_labor_hours_assembly, custom_labor_hours_finish, custom_labor_hours_install, ' +
        'subprojects(id, project_id)'
    )
    .eq('id', approvalItemId)
    .maybeSingle()

  if (itemErr || !itemRaw) {
    console.error('draftCoFromApprovalCard: item not found', itemErr)
    return null
  }

  // Supabase typegen for select-with-join can't refine into a literal shape;
  // cast to a local shape after the null check.
  const item = itemRaw as unknown as {
    id: string
    subproject_id: string
    source_estimate_line_id: string | null
    label: string
    material: string | null
    finish: string | null
    is_custom: boolean | null
    rate_book_item_id: string | null
    rate_book_material_variant_id: string | null
    custom_material_cost_per_lf: number | null
    custom_labor_hours_eng: number | null
    custom_labor_hours_cnc: number | null
    custom_labor_hours_assembly: number | null
    custom_labor_hours_finish: number | null
    custom_labor_hours_install: number | null
    subprojects:
      | { id: string; project_id: string }
      | { id: string; project_id: string }[]
      | null
  }

  const projectId = Array.isArray(item.subprojects)
    ? item.subprojects[0]?.project_id
    : item.subprojects?.project_id
  if (!projectId) {
    console.error('draftCoFromApprovalCard: no project_id resolved')
    return null
  }

  // Pull LF off the source estimate_line if present so the snapshot can price.
  let linearFeet: number | null = null
  if (item.source_estimate_line_id) {
    const { data: line } = await supabase
      .from('estimate_lines')
      .select('linear_feet, quantity')
      .eq('id', item.source_estimate_line_id)
      .maybeSingle()
    linearFeet = line?.linear_feet ?? line?.quantity ?? null
  }

  const baseSnap: LineSnapshot = {
    label: item.label,
    material: item.material ?? undefined,
    finish: item.finish ?? null,
    is_custom: !!item.is_custom,
    rate_book_item_id: item.rate_book_item_id ?? null,
    rate_book_material_variant_id: item.rate_book_material_variant_id ?? null,
    linear_feet: linearFeet,
    material_cost_per_lf: item.is_custom
      ? item.custom_material_cost_per_lf ?? null
      : null,
    labor_hours_eng: item.is_custom ? item.custom_labor_hours_eng ?? null : null,
    labor_hours_cnc: item.is_custom ? item.custom_labor_hours_cnc ?? null : null,
    labor_hours_assembly: item.is_custom ? item.custom_labor_hours_assembly ?? null : null,
    labor_hours_finish: item.is_custom ? item.custom_labor_hours_finish ?? null : null,
    labor_hours_install: item.is_custom ? item.custom_labor_hours_install ?? null : null,
  }

  // proposed starts as a copy — user edits material/finish (and optionally
  // LF / variant) before sending to client.
  const proposed: LineSnapshot = { ...baseSnap }

  const { data, error } = await supabase
    .from('change_orders')
    .insert({
      project_id: projectId,
      subproject_id: item.subproject_id,
      approval_item_id: item.id,
      title: `${item.label} — material change`,
      original_line_snapshot: baseSnap,
      proposed_line: proposed,
      net_change: 0,
      no_price_change: false,
      state: 'draft' as CoState,
      qb_handoff_state: 'not_yet' as QbHandoffState,
    })
    .select()
    .single()

  if (error) {
    console.error('draftCoFromApprovalCard: insert failed', error)
    return null
  }
  return data as ChangeOrder
}

/**
 * Apply an approved CO back into the source data. Called after `approveCo`
 * flips the CO state to 'approved'. Idempotent: if the underlying row no
 * longer exists or the proposed snapshot is missing material/finish, we log
 * and skip.
 *
 * What it does:
 *   - Updates the linked approval_item.material / .finish in place (if any).
 *   - Updates the linked estimate_line.callouts (legacy) and the relevant
 *     finish_specs jsonb entry where the material matches.
 *   - Writes an item_revisions row (action 'material_changed') so the slot's
 *     timeline reflects the change with the CO id captured in the note.
 *
 * The CO row itself remains the canonical audit record (original_line_snapshot
 * is frozen at draft time and can be replayed).
 */
/** SlotCoEditor slot label → approval-card label (proposeSlotsFromComposerLine).
 *  Only the three slots that get approval cards need aliasing; the rest have no
 *  card and simply resolve to no match. */
const APPROVAL_CARD_LABEL_ALIAS: Record<string, string> = {
  'Door material': 'Door/drawer material',
  'Door finish': 'Exterior finish',
}

/** Human CO label for audit notes — "CO-05" when numbered, else "change order". */
function coNumberLabel(coNumber: number | null | undefined): string {
  return coNumber ? `CO-${String(coNumber).padStart(2, '0')}` : 'change order'
}

export async function applyApprovedCo(
  coId: string,
  opts: {
    /** Suppress the "approved spec → reset to pending + bump rev" branch.
     *  Used by the spec-CO finalize path where the spec is being approved
     *  WITH the proposed value; we don't want to immediately re-pending
     *  the spec we just approved. */
    skipReopen?: boolean
  } = {},
): Promise<void> {
  const { data: co, error } = await supabase
    .from('change_orders')
    .select(
      'id, co_number, approval_item_id, subproject_id, proposed_line, original_line_snapshot, state',
    )
    .eq('id', coId)
    .maybeSingle()
  if (error || !co) {
    console.error('applyApprovedCo: CO not found', error)
    return
  }
  if (co.state !== 'approved') {
    console.warn('applyApprovedCo called on non-approved CO; skipping', coId)
    return
  }

  const proposed = (co.proposed_line || {}) as LineSnapshot
  const original = (co.original_line_snapshot || {}) as LineSnapshot

  // Resolve which approval_item this CO targets:
  //   1. Direct link (legacy "Material changed — reopen" path) carried
  //      approval_item_id on the row.
  //   2. Seeded slot-aware COs (Issue 21) leave approval_item_id null but
  //      stash the targeted slot label as the prefix on proposed.material
  //      ("Carcass material: White oak"). Match against the
  //      subproject + label so we can find the same approval_item that
  //      proposeSlotsFromComposerLine generated on handoff.
  let approvalItemId: string | null = co.approval_item_id ?? null
  let slotLabelFromCo: string | null = null
  let slotValueFromCo: string | null = null
  const slotPrefixMatch = (proposed.material || '').match(/^([^:]+):\s*(.*)$/)
  if (slotPrefixMatch) {
    slotLabelFromCo = slotPrefixMatch[1].trim()
    slotValueFromCo = slotPrefixMatch[2].trim() || null
    if (!approvalItemId && co.subproject_id) {
      // The CO's slot labels (SlotCoEditor SLOT_LABEL) don't all match the
      // approval-card labels (proposeSlotsFromComposerLine): the composer
      // names them "Door material" / "Door finish", the cards name them
      // "Door/drawer material" / "Exterior finish". Alias before matching so
      // the card actually gets updated. (Carcass material already matches;
      // slots with no card — door type, drawer type, etc. — just find none.)
      const cardLabel = APPROVAL_CARD_LABEL_ALIAS[slotLabelFromCo] ?? slotLabelFromCo
      const { data: matched } = await supabase
        .from('approval_items')
        .select('id, state')
        .eq('subproject_id', co.subproject_id)
        .eq('label', cardLabel)
        .maybeSingle()
      if (matched?.id) approvalItemId = matched.id
    }
  }

  // 1. Update the approval card.
  if (approvalItemId) {
    // Read the existing row so we know whether to bump (was approved) and
    // how much (revision + 1). Fail-soft: if the read errors, fall back to
    // a no-op patch so the CO state flip still stands.
    const { data: priorItem, error: priorErr } = await supabase
      .from('approval_items')
      .select('id, state, revision, label')
      .eq('id', approvalItemId)
      .maybeSingle()
    if (priorErr) console.error('applyApprovedCo: read approval_item', priorErr)

    const wasApproved = priorItem?.state === 'approved'
    const currentRev = Number(priorItem?.revision) || 1
    const slotLabel = slotLabelFromCo || priorItem?.label || ''
    // Map slot label → which approval_item column the new value lives in.
    // proposeSlotsFromComposerLine puts carcassMaterial / doorMaterial
    // under .material and exteriorFinish under .finish.
    const isFinishSlot = /finish/i.test(slotLabel)

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { updated_at: now }
    if (slotValueFromCo != null) {
      // Seeded CO: write the new value into the appropriate column. Clear
      // the other column so the card doesn't read with stale text.
      if (isFinishSlot) {
        patch.finish = slotValueFromCo
      } else {
        patch.material = slotValueFromCo
      }
    } else {
      // Legacy CO (linked via approval_item_id): use the snapshot fields
      // directly.
      if (proposed.material !== undefined) patch.material = proposed.material ?? null
      if (proposed.finish !== undefined) patch.finish = proposed.finish ?? null
    }
    if (proposed.rate_book_material_variant_id !== undefined) {
      patch.rate_book_material_variant_id =
        proposed.rate_book_material_variant_id ?? null
    }
    if (wasApproved && !opts.skipReopen) {
      // Item 3 of the post-sale dogfood pass: an approved spec touched by
      // an approved CO is no longer truly approved — the value moved.
      // Bump rev and reset to pending so the operator knows a new sample
      // round is needed against the new value. Ball flips to shop because
      // they own the next move (resample / re-confirm).
      patch.revision = currentRev + 1
      patch.state = 'pending'
      patch.last_state_change_at = now
      patch.ball_in_court = 'shop'
    }
    const { error: itemErr } = await supabase
      .from('approval_items')
      .update(patch)
      .eq('id', approvalItemId)
    if (itemErr) console.error('applyApprovedCo: approval_items update', itemErr)

    // Audit trail: material_changed revision row referencing the CO. The
    // note carries the old → new value so the timeline reads cleanly even
    // when the CO row is later voided.
    const oldDisp = wasApproved
      ? slotValueFromCo
        ? `${original.material ?? '?'}`
        : original.material ?? '?'
      : original.material ?? '?'
    const newDisp = slotValueFromCo ?? proposed.material ?? '?'
    await supabase.from('item_revisions').insert({
      approval_item_id: approvalItemId,
      action: 'material_changed',
      note: `Applied via ${coNumberLabel(co.co_number)}: ${oldDisp} → ${newDisp}`,
    })

    // 2. Update the source estimate_line's finish_specs jsonb in place.
    const { data: itemRow } = await supabase
      .from('approval_items')
      .select('source_estimate_line_id')
      .eq('id', approvalItemId)
      .maybeSingle()

    const lineId = itemRow?.source_estimate_line_id
    if (lineId) {
      const { data: line } = await supabase
        .from('estimate_lines')
        .select('id, callouts, finish_specs')
        .eq('id', lineId)
        .maybeSingle()
      if (line) {
        // Update finish_specs jsonb where material matches the original.
        const specs = Array.isArray(line.finish_specs) ? [...line.finish_specs] : []
        let touched = false
        for (let i = 0; i < specs.length; i++) {
          const s = specs[i] as { material?: string; finish?: string }
          if (
            s.material &&
            original.material &&
            s.material.toLowerCase() === original.material.toLowerCase()
          ) {
            specs[i] = {
              ...s,
              material: proposed.material ?? s.material,
              finish: proposed.finish ?? s.finish,
            }
            touched = true
          }
        }
        // Also rewrite the matching legacy callout string for back-compat.
        const callouts = Array.isArray(line.callouts) ? [...line.callouts] : null
        if (callouts && original.material) {
          for (let i = 0; i < callouts.length; i++) {
            if (
              typeof callouts[i] === 'string' &&
              callouts[i].toLowerCase().includes(original.material.toLowerCase())
            ) {
              callouts[i] = proposed.material
                ? callouts[i].replace(
                    new RegExp(original.material, 'i'),
                    proposed.material
                  )
                : callouts[i]
              touched = true
            }
          }
        }
        if (touched) {
          await supabase
            .from('estimate_lines')
            .update({
              finish_specs: specs,
              callouts: callouts ?? undefined,
              updated_at: new Date().toISOString(),
            })
            .eq('id', lineId)
        }
      }
    }
  }
}

/**
 * Spec-CO redesign (post-sale dogfood pass): a CO whose
 * approval_item_id is non-null is "spec-gated" — it doesn't have its own
 * approve/decline buttons. It auto-flips to approved when the spec it
 * targets transitions to approved. This helper runs from the approve()
 * handler in lib/approvals.ts after the spec's state is written.
 *
 * For each draft CO targeting `approvalItemId`:
 *   - State → 'approved'
 *   - applyApprovedCo runs with skipReopen=true so the spec we just
 *     approved doesn't immediately re-pending. The proposed value gets
 *     written through to estimate_lines.product_slots / .finish_specs
 *     and to approval_items.material/.finish.
 *   - bid_total recompute fires once at the end.
 *
 * Errors are best-effort: each CO is processed independently, failures
 * log and move on. The spec's approval state is already committed by
 * the caller; we don't roll it back if a CO finalize fails.
 *
 * Returns the count of COs flipped.
 */
export async function finalizeSpecCosOnApproval(
  approvalItemId: string,
): Promise<number> {
  const { data: drafts, error } = await supabase
    .from('change_orders')
    .select('id, project_id')
    .eq('approval_item_id', approvalItemId)
    .eq('state', 'draft')
  if (error) {
    console.error('finalizeSpecCosOnApproval: read drafts', error)
    return 0
  }
  if (!drafts || drafts.length === 0) return 0

  const now = new Date().toISOString()
  let flipped = 0
  let projectId: string | null = null
  for (const co of drafts as Array<{ id: string; project_id: string | null }>) {
    if (!projectId && co.project_id) projectId = co.project_id
    const { error: updErr } = await supabase
      .from('change_orders')
      .update({ state: 'approved' as CoState, updated_at: now })
      .eq('id', co.id)
    if (updErr) {
      console.error('finalizeSpecCosOnApproval: update CO', co.id, updErr)
      continue
    }
    try {
      await applyApprovedCo(co.id, { skipReopen: true })
      flipped += 1
    } catch (err) {
      console.error('finalizeSpecCosOnApproval: applyApprovedCo', co.id, err)
    }
  }
  if (projectId) void recomputeProjectBidTotal(projectId)
  return flipped
}

/**
 * Plain-English reconciliation note the user can paste into QB / their email
 * client. Phase 7 D3: MillSuite never pushes to QB; this is what to type.
 *
 * Examples:
 *   +$420 — Add as separate invoice in QuickBooks.
 *      Title: "Island faces — walnut to white oak"
 *      Original: Walnut slab @ $42/LF
 *      Proposed: White oak rift @ $58/LF
 *      Approved 4/22 (note: "via email")
 */
export function qbReconciliationText(
  co: ChangeOrder,
  ctx: { projectName?: string; subprojectName?: string | null | undefined }
): string {
  const sign = co.net_change > 0 ? '+' : co.net_change < 0 ? '-' : ''
  const amt = `${sign}$${Math.abs(co.net_change).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`

  const action =
    co.no_price_change || co.net_change === 0
      ? 'No QuickBooks entry needed (documentation-only).'
      : co.net_change > 0
      ? 'Add as a separate invoice in QuickBooks (or edit the existing invoice and re-send).'
      : 'Issue a credit memo in QuickBooks for the difference.'

  const lines: string[] = []
  lines.push(`${amt} — ${action}`)
  if (ctx.projectName) {
    lines.push(`Project: ${ctx.projectName}${ctx.subprojectName ? ` / ${ctx.subprojectName}` : ''}`)
  }
  lines.push(`Title: ${co.title}`)

  const orig = co.original_line_snapshot
  const prop = co.proposed_line
  if (orig?.material || prop?.material) {
    const o = [orig?.material, orig?.finish].filter(Boolean).join(' / ') || '(unspecified)'
    const p = [prop?.material, prop?.finish].filter(Boolean).join(' / ') || '(unspecified)'
    lines.push(`Was: ${o}`)
    lines.push(`Now: ${p}`)
  }

  if (co.client_response_note) {
    lines.push(`Client response: ${co.client_response_note}`)
  }
  if (co.state === 'approved') {
    lines.push(`Approved: ${new Date(co.updated_at).toLocaleDateString()}`)
  }

  return lines.join('\n')
}

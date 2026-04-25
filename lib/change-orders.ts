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
export async function applyApprovedCo(coId: string): Promise<void> {
  const { data: co, error } = await supabase
    .from('change_orders')
    .select(
      'id, approval_item_id, subproject_id, proposed_line, original_line_snapshot, state',
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
      const { data: matched } = await supabase
        .from('approval_items')
        .select('id, state')
        .eq('subproject_id', co.subproject_id)
        .eq('label', slotLabelFromCo)
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
    if (wasApproved) {
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
      note: `Applied via change order ${coId.slice(0, 8)}: ${oldDisp} → ${newDisp}`,
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

// ============================================================================
// approvals.ts — data access for pre-prod approval slots
// ============================================================================
// Implements the D1–D10 decisions from BUILD-PLAN.md against the schema in
// migrations/002_preprod_approval_schema.sql. This module covers Phase 1
// (slot read + state transitions + custom slot + linking). CO + drawings
// tracks live in their own modules (Phase 2 + 4).
// ============================================================================

import { supabase } from './supabase'

// ── Types ──

export type ApprovalState = 'pending' | 'in_review' | 'approved'
export type BallInCourt = 'client' | 'shop' | 'vendor' | null

export type ItemRevisionAction =
  | 'submitted'
  | 'client_requested_change'
  | 'approved'
  | 'material_changed'

export interface ItemRevision {
  id: string
  approval_item_id: string
  action: ItemRevisionAction
  note: string | null
  actor_user_id: string | null
  occurred_at: string
}

export interface ApprovalItem {
  id: string
  subproject_id: string
  source_estimate_line_id: string | null
  label: string
  rate_book_item_id: string | null
  rate_book_material_variant_id: string | null
  material: string | null
  finish: string | null
  is_custom: boolean
  // D7: custom-slot baseline (null on rate-book-sourced slots)
  custom_material_cost_per_lf: number | null
  custom_labor_hours_eng: number | null
  custom_labor_hours_cnc: number | null
  custom_labor_hours_assembly: number | null
  custom_labor_hours_finish: number | null
  custom_labor_hours_install: number | null
  linked_to_item_id: string | null
  state: ApprovalState
  last_state_change_at: string
  ball_in_court: BallInCourt
  created_at: string
  updated_at: string
  // Populated by loadApprovalItemsForSubproject
  revisions?: ItemRevision[]
}

// ── Reads ──

/**
 * Load every approval slot for a subproject, newest state-change first, with
 * all its item_revisions eager-loaded. Empty array if the subproject has no
 * slots yet (pre-sold or estimator flagged nothing).
 */
export async function loadApprovalItemsForSubproject(
  subprojectId: string
): Promise<ApprovalItem[]> {
  const { data: items, error: itemsError } = await supabase
    .from('approval_items')
    .select('*')
    .eq('subproject_id', subprojectId)
    .order('created_at', { ascending: true })

  if (itemsError) {
    console.error('loadApprovalItemsForSubproject items', itemsError)
    return []
  }
  if (!items || items.length === 0) return []

  const itemIds = items.map((i) => i.id)
  const { data: revs, error: revsError } = await supabase
    .from('item_revisions')
    .select('*')
    .in('approval_item_id', itemIds)
    .order('occurred_at', { ascending: true })

  if (revsError) {
    console.error('loadApprovalItemsForSubproject revs', revsError)
    // Return items without revisions rather than failing the whole load.
    return items as ApprovalItem[]
  }

  const byItem = new Map<string, ItemRevision[]>()
  for (const r of revs || []) {
    const bucket = byItem.get(r.approval_item_id) || []
    bucket.push(r as ItemRevision)
    byItem.set(r.approval_item_id, bucket)
  }

  return (items as ApprovalItem[]).map((i) => ({
    ...i,
    revisions: byItem.get(i.id) || [],
  }))
}

/**
 * Load other approval slots on the same project (across subprojects) that
 * share a label — used to populate the "link to existing slot?" suggestion
 * chip per D4.
 */
export async function loadLinkSuggestionsForLabel(
  projectId: string,
  label: string,
  excludeItemId?: string
): Promise<{ id: string; subproject_id: string; subproject_name: string; label: string; state: ApprovalState }[]> {
  // Join through subprojects to project_id. Supabase can do this implicitly
  // when we .select with foreign-key syntax.
  const { data, error } = await supabase
    .from('approval_items')
    .select('id, subproject_id, label, state, subprojects!inner(name, project_id)')
    .eq('label', label)
    .eq('subprojects.project_id', projectId)

  if (error) {
    console.error('loadLinkSuggestionsForLabel', error)
    return []
  }
  return (data || [])
    .filter((row: any) => row.id !== excludeItemId)
    .map((row: any) => ({
      id: row.id,
      subproject_id: row.subproject_id,
      subproject_name: row.subprojects?.name ?? '',
      label: row.label,
      state: row.state,
    }))
}

// ── State transitions ──
//
// Every transition writes an item_revisions audit row AND updates the slot's
// state, last_state_change_at, and ball_in_court per D5's rules:
//   client flips in when state → in_review
//   shop flips in when state → pending after a change request
//   ball clears on approved

interface TransitionArgs {
  actorUserId?: string
  note?: string
}

/**
 * pending/in_review → in_review via 'submitted'. Ball flips to client.
 */
export async function submitSample(
  itemId: string,
  args: TransitionArgs = {}
): Promise<void> {
  await applyTransition(itemId, {
    newState: 'in_review',
    action: 'submitted',
    newBallInCourt: 'client',
    ...args,
  })
}

/**
 * in_review → pending via 'client_requested_change'. Ball flips to shop.
 */
export async function requestChange(
  itemId: string,
  args: TransitionArgs = {}
): Promise<void> {
  await applyTransition(itemId, {
    newState: 'pending',
    action: 'client_requested_change',
    newBallInCourt: 'shop',
    ...args,
  })
}

/**
 * in_review → approved via 'approved'. Ball clears. Per D6, shop user marks
 * this on the client's behalf after verbal/email sign-off.
 */
export async function approve(
  itemId: string,
  args: TransitionArgs = {}
): Promise<void> {
  await applyTransition(itemId, {
    newState: 'approved',
    action: 'approved',
    newBallInCourt: null,
    ...args,
  })
}

/**
 * approved → pending via 'material_changed'. Used when a CO triggers a
 * material swap that invalidates the prior approval. Ball flips to shop
 * (new sample round).
 */
export async function changeMaterial(
  itemId: string,
  args: TransitionArgs = {}
): Promise<void> {
  await applyTransition(itemId, {
    newState: 'pending',
    action: 'material_changed',
    newBallInCourt: 'shop',
    ...args,
  })
}

async function applyTransition(
  itemId: string,
  opts: {
    newState: ApprovalState
    action: ItemRevisionAction
    newBallInCourt: BallInCourt
    actorUserId?: string
    note?: string
  }
): Promise<void> {
  const now = new Date().toISOString()

  const { error: updErr } = await supabase
    .from('approval_items')
    .update({
      state: opts.newState,
      last_state_change_at: now,
      ball_in_court: opts.newBallInCourt,
      updated_at: now,
    })
    .eq('id', itemId)
  if (updErr) throw updErr

  const { error: revErr } = await supabase.from('item_revisions').insert({
    approval_item_id: itemId,
    action: opts.action,
    note: opts.note || null,
    actor_user_id: opts.actorUserId || null,
    occurred_at: now,
  })
  if (revErr) throw revErr

  // When a linked slot's source changes state, propagate. Per D4, the link
  // means one approval covers both; we treat the source's state as canonical
  // and mirror it to dependents. Only propagates to slots that link TO this
  // one (i.e., this is the source).
  const { data: dependents } = await supabase
    .from('approval_items')
    .select('id')
    .eq('linked_to_item_id', itemId)
  for (const dep of dependents || []) {
    await supabase
      .from('approval_items')
      .update({
        state: opts.newState,
        last_state_change_at: now,
        ball_in_court: opts.newBallInCourt,
        updated_at: now,
      })
      .eq('id', dep.id)
    await supabase.from('item_revisions').insert({
      approval_item_id: dep.id,
      action: opts.action,
      note: `(auto) linked to ${itemId}`,
      actor_user_id: opts.actorUserId || null,
      occurred_at: now,
    })
  }
}

// ── Custom slot creation ──

/**
 * Create a new custom approval slot on a subproject. Per D7, the baseline
 * fields are optional at creation time; if skipped, the CO panel will refuse
 * to auto-reprice and prompt manual entry later.
 */
export async function createCustomSlot(
  subprojectId: string,
  input: {
    label: string
    material: string
    finish: string | null
    baseline?: {
      material_cost_per_lf: number
      labor_hours_eng: number
      labor_hours_cnc: number
      labor_hours_assembly: number
      labor_hours_finish: number
      labor_hours_install: number
    }
  }
): Promise<ApprovalItem | null> {
  const now = new Date().toISOString()
  const row: any = {
    subproject_id: subprojectId,
    label: input.label,
    material: input.material,
    finish: input.finish,
    is_custom: true,
    state: 'pending' as ApprovalState,
    last_state_change_at: now,
    ball_in_court: 'shop' as BallInCourt,
  }
  if (input.baseline) {
    row.custom_material_cost_per_lf = input.baseline.material_cost_per_lf
    row.custom_labor_hours_eng = input.baseline.labor_hours_eng
    row.custom_labor_hours_cnc = input.baseline.labor_hours_cnc
    row.custom_labor_hours_assembly = input.baseline.labor_hours_assembly
    row.custom_labor_hours_finish = input.baseline.labor_hours_finish
    row.custom_labor_hours_install = input.baseline.labor_hours_install
  }

  const { data, error } = await supabase
    .from('approval_items')
    .insert(row)
    .select()
    .single()
  if (error) {
    console.error('createCustomSlot', error)
    return null
  }
  return data as ApprovalItem
}

// ── Linking ──

/**
 * Link slot `itemId` to `linkedToItemId` so that the target's approval state
 * propagates to this slot. Per D4, always user-initiated — no auto-linking.
 */
export async function linkSlot(itemId: string, linkedToItemId: string): Promise<void> {
  const { error } = await supabase
    .from('approval_items')
    .update({ linked_to_item_id: linkedToItemId, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) throw error
}

export async function unlinkSlot(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('approval_items')
    .update({ linked_to_item_id: null, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) throw error
}

// ── Handoff: estimate_lines → approval_items generation ──

/**
 * Preview shape of a slot that would be created during sold-handoff. Pure —
 * caller passes already-loaded estimate_lines + rate-book items. No DB write.
 */
export interface ProposedApprovalSlot {
  subproject_id: string
  subproject_name: string
  source_estimate_line_id: string
  source_line_description: string
  rate_book_item_id: string | null
  rate_book_material_variant_id: string | null
  material: string | null
  label: string
  // Heuristic owner: 'client' = finish/color/style decision, 'vendor' = hardware
  // order, 'shop' = everything else (locked from estimate).
  owner: 'client' | 'shop' | 'vendor'
}

const CLIENT_KEYWORDS = [
  'color',
  'finish',
  'paint',
  'stain',
  'sheen',
  'pull',
  'knob',
  'handle',
  'hardware',
  'selection',
  'style',
  'cushion',
  'upholstery',
]
const VENDOR_KEYWORDS = [
  'hinge',
  'slide',
  'glide',
  'blum',
  'hettich',
  'order',
  'vendor',
  'po',
  'purchase',
]

/** Heuristic bucket — drives the three groups on the handoff review page. */
export function guessSlotOwner(label: string): 'client' | 'shop' | 'vendor' {
  const l = (label || '').toLowerCase()
  if (VENDOR_KEYWORDS.some((k) => l.includes(k))) return 'vendor'
  if (CLIENT_KEYWORDS.some((k) => l.includes(k))) return 'client'
  return 'shop'
}

/**
 * Expand a single estimate_line into the slots it would create on handoff.
 * Mirrors what `createApprovalItemsForProject` writes — caller reads this to
 * preview the selection-cards section of the handoff page before committing.
 *
 * One slot per effective callout (line.callouts if non-null, else the item's
 * default_callouts). A line with zero callouts produces zero slots.
 */
export function proposeSlotsForLine(
  line: {
    id: string
    subproject_id: string
    description: string
    callouts: string[] | null
    rate_book_item_id: string | null
    rate_book_material_variant_id: string | null
  },
  ctx: {
    subproject_name: string
    item_default_callouts: string[] | null
    variant_name: string | null
  }
): ProposedApprovalSlot[] {
  const callouts = line.callouts ?? ctx.item_default_callouts ?? []
  return callouts
    .filter((c) => (c || '').trim().length > 0)
    .map((label) => ({
      subproject_id: line.subproject_id,
      subproject_name: ctx.subproject_name,
      source_estimate_line_id: line.id,
      source_line_description: line.description,
      rate_book_item_id: line.rate_book_item_id,
      rate_book_material_variant_id: line.rate_book_material_variant_id,
      material: ctx.variant_name,
      label,
      owner: guessSlotOwner(label),
    }))
}

/**
 * Write proposed slots to the approval_items table. De-duplicates by
 * (subproject_id, label) so re-running on a project that already had a
 * partial handoff won't create duplicates.
 *
 * Called from the sold-handoff confirmation flow after the user reviews the
 * preview. Returns the number of new rows inserted.
 */
export async function createApprovalItemsFromProposals(
  proposals: ProposedApprovalSlot[]
): Promise<number> {
  if (proposals.length === 0) return 0

  // De-dupe against existing slots per subproject so a re-run is idempotent.
  const subIds = Array.from(new Set(proposals.map((p) => p.subproject_id)))
  const { data: existing } = await supabase
    .from('approval_items')
    .select('subproject_id, label')
    .in('subproject_id', subIds)

  const existingKey = new Set(
    (existing || []).map((r: any) => `${r.subproject_id}::${r.label}`)
  )

  const toInsert = proposals
    .filter((p) => !existingKey.has(`${p.subproject_id}::${p.label}`))
    .map((p) => ({
      subproject_id: p.subproject_id,
      source_estimate_line_id: p.source_estimate_line_id,
      rate_book_item_id: p.rate_book_item_id,
      rate_book_material_variant_id: p.rate_book_material_variant_id,
      material: p.material,
      label: p.label,
      state: 'pending' as ApprovalState,
      ball_in_court: (p.owner === 'client' ? 'client' : 'shop') as BallInCourt,
    }))

  if (toInsert.length === 0) return 0

  const { error } = await supabase.from('approval_items').insert(toInsert)
  if (error) {
    console.error('createApprovalItemsFromProposals', error)
    throw error
  }
  return toInsert.length
}

// ── Derived helpers ──

/**
 * Count of item_revisions rows with action='submitted' — this is what the
 * mockup shows as "rev 1", "rev 2", etc. next to a slot badge.
 */
export function revNumber(item: ApprovalItem): number {
  if (!item.revisions) return 0
  return item.revisions.filter((r) => r.action === 'submitted').length
}

/**
 * Days since last_state_change_at. Drives the ball-in-court warning chip per
 * D5: neutral 0–3 days, warning 3–7, red 7+.
 */
export function daysSinceStateChange(item: ApprovalItem): number {
  const ms = Date.now() - new Date(item.last_state_change_at).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export function ballChipTone(item: ApprovalItem): 'neutral' | 'warning' | 'red' {
  const days = daysSinceStateChange(item)
  if (days >= 7) return 'red'
  if (days >= 3) return 'warning'
  return 'neutral'
}

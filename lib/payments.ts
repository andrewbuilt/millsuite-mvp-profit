// ============================================================================
// lib/payments.ts — reading and moving draw payments
// ============================================================================
// The DATA half of the /payments page. All the calendar and bucketing logic
// lives in `lib/payment-schedule`, which is deliberately pure (no database
// import) so its timezone guard can run without credentials — see the header
// there, and read the TIMEZONE TRAP note before touching any date.
//
// ⛔ THE TABLE IS `cash_flow_receivables`, NOT `project_milestones`. Milestones
// piggyback on the receivables table with `type='receivable'` (lib/milestones).
// ============================================================================

import { supabase } from './supabase'
import { POSTSOLD_STAGES, type ProjectStage } from './types'
import { formatLocalDate, type PaymentRow } from './payment-schedule'
import type { LedgerEntry } from './payment-ledger'

export * from './payment-schedule'
export * from './payment-ledger'

interface RawRow {
  id: string
  project_id: string
  milestone_label: string | null
  amount: number | null
  status: string
  expected_date: string | null
  received_date: string | null
  notes: string | null
  created_at: string | null
  projects: {
    name: string | null
    client_name: string | null
    stage: string
    bid_total: number | null
  } | null
}

export interface PaymentsLoad {
  rows: PaymentRow[]
  /** Contract value per project id — `bid_total`, the number the client
   *  agreed to. The reconciliation balances the schedule against THIS. */
  contractTotals: Record<string, number>
  /** Non-null when the READ failed.
   *  ⛔ A swallowed error here is indistinguishable from "this shop has no
   *  draws", and the page would cheerfully tell Andrew to go set up milestones
   *  he already has. An empty board must only ever mean an empty board. */
  error: string | null
}

/**
 * Every draw across the org's SOLD-and-later projects.
 *
 * Pre-sold jobs are excluded on purpose: their milestones hang off a bid
 * nobody has signed, and folding hypothetical draws into "needed this month"
 * would make the number useless for deciding anything.
 *
 * Received rows ARE loaded — "what came in this month" needs them.
 */
export async function loadOrgPayments(orgId: string): Promise<PaymentsLoad> {
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .select(
      'id, project_id, milestone_label, amount, status, expected_date, received_date, ' +
        'notes, created_at, projects!inner(name, client_name, stage, bid_total)',
    )
    .eq('org_id', orgId)
    .eq('type', 'receivable')
    .neq('status', 'cancelled')
    .in('projects.stage', POSTSOLD_STAGES)
  if (error) {
    console.error('loadOrgPayments', error)
    return { rows: [], contractTotals: {}, error: error.message || 'Could not load payments.' }
  }

  const rows = ((data || []) as unknown as RawRow[]).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.projects?.name || 'Untitled project',
    clientName: r.projects?.client_name ?? null,
    stage: (r.projects?.stage as ProjectStage) || 'sold',
    label: r.milestone_label || 'Milestone',
    amount: Number(r.amount) || 0,
    status: (r.status as PaymentRow['status']) || 'projected',
    expectedDate: r.expected_date,
    receivedDate: r.received_date,
    // `sort_order` has no column of its own — it's encoded in `notes` as
    // `order:N` (see rowToMilestone in lib/milestones). A row without it sorts
    // last rather than to the front, so an unlabelled row can't hijack the
    // deposit position in the waterfall.
    sortOrder: Number(/order:(\d+)/.exec(r.notes || '')?.[1] ?? Number.MAX_SAFE_INTEGER),
    createdAt: r.created_at,
  }))
  const contractTotals: Record<string, number> = {}
  for (const r of (data || []) as unknown as RawRow[]) {
    contractTotals[r.project_id] = Number(r.projects?.bid_total) || 0
  }
  return { rows, contractTotals, error: null }
}

// ── The ledger (migration 099) ──────────────────────────────────────────────

const LEDGER_COLUMNS = 'id, project_id, amount, payment_date, method, reference, notes'

function toEntry(r: any): LedgerEntry {
  return {
    id: r.id,
    projectId: r.project_id,
    amount: Number(r.amount) || 0,
    paymentDate: r.payment_date,
    method: r.method ?? null,
    reference: r.reference ?? null,
    notes: r.notes ?? null,
  }
}

export interface LedgerLoad {
  entries: LedgerEntry[]
  error: string | null
  /** True when migration 099 hasn't been run. The page degrades to a
   *  schedule-only view instead of showing nothing. */
  missing: boolean
}

/** True when PostgREST is telling us the table/column isn't there. */
function isMissingRelation(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  const code = e.code || ''
  if (code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205') return true
  return /does not exist|could not find the/i.test(e.message || '')
}

/** Every payment the org has received. */
export async function loadOrgLedger(orgId: string): Promise<LedgerLoad> {
  const { data, error } = await supabase
    .from('project_payments')
    .select(LEDGER_COLUMNS)
    .eq('org_id', orgId)
    .order('payment_date', { ascending: false })
  if (error) {
    if (isMissingRelation(error)) {
      console.warn('loadOrgLedger: migration 099 (project_payments) has not been run.')
      return { entries: [], error: null, missing: true }
    }
    console.error('loadOrgLedger', error)
    return { entries: [], error: error.message || 'Could not load payments.', missing: false }
  }
  return { entries: (data || []).map(toEntry), error: null, missing: false }
}

/** One project's payments, newest first — the project page's ledger. */
export async function loadProjectLedger(projectId: string): Promise<LedgerLoad> {
  const { data, error } = await supabase
    .from('project_payments')
    .select(LEDGER_COLUMNS)
    .eq('project_id', projectId)
    .order('payment_date', { ascending: false })
  if (error) {
    if (isMissingRelation(error)) return { entries: [], error: null, missing: true }
    console.error('loadProjectLedger', error)
    return { entries: [], error: error.message || 'Could not load payments.', missing: false }
  }
  return { entries: (data || []).map(toEntry), error: null, missing: false }
}

/**
 * Record cash received.
 *
 * ⛔ THIS IS THE ONLY THING THAT MAKES A DRAW "PAID", and it does not touch the
 * schedule at all. Paid-ness is derived by `reconcileProject`. There is no
 * "mark received" any more: a draw can't be flipped, because the old flag
 * could only ever record the PROJECTED amount, which is precisely why a
 * payment that differed from its projection had nowhere to go.
 */
export async function logPayment(input: {
  orgId: string
  projectId: string
  amount: number
  paymentDate: string
  method?: string | null
  reference?: string | null
  notes?: string | null
  createdBy?: string | null
}): Promise<LedgerEntry> {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('Enter an amount. (A refund can be negative; zero can’t.)')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
    throw new Error('Pick a payment date.')
  }
  const { data, error } = await supabase
    .from('project_payments')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      amount,
      payment_date: input.paymentDate,
      method: input.method || null,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: input.createdBy ?? null,
    })
    .select(LEDGER_COLUMNS)
    .single()
  if (error || !data) {
    console.error('logPayment', error)
    if (isMissingRelation(error)) {
      throw new Error('Recording payments needs migration 099. Run it, then reload.')
    }
    throw new Error(error?.message || 'Could not record that payment.')
  }
  return toEntry(data)
}

/** Remove a ledger entry — a mis-keyed amount, a duplicate.
 *  Zero rows is failure: PostgREST reports an RLS-blocked delete as success. */
export async function deletePayment(id: string, orgId?: string): Promise<void> {
  let q = supabase.from('project_payments').delete().eq('id', id)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('deletePayment', error)
    throw new Error(error.message || 'Could not remove that payment.')
  }
  if (!data || data.length === 0) {
    throw new Error('Could not remove that payment (no row deleted).')
  }
}

/**
 * Move a draw to a different month.
 *
 * ⛔ Asks for the row back and treats zero rows as failure. PostgREST answers
 * `{ error: null }` for an UPDATE that matched nothing, so without this an
 * RLS-blocked write looks exactly like a successful drag — the card moves, the
 * page reloads, and it's back where it started with no error. Same trap as
 * `updateProjectName`, the team merge, and the importer's id map.
 *
 * Writes `expected_date` and nothing else: this changes the FORECAST, never
 * the contract, the amount or the status.
 */
export async function reschedulePayment(
  milestoneId: string,
  expectedDate: string,
  orgId?: string,
): Promise<void> {
  let q = supabase
    .from('cash_flow_receivables')
    .update({ expected_date: expectedDate })
    .eq('id', milestoneId)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('reschedulePayment', error)
    throw new Error(error.message || 'Could not move that payment.')
  }
  if (!data || data.length === 0) {
    throw new Error('Could not move that payment (no row updated).')
  }
}

/**
 * Net cash received against one project — the sum of its ledger.
 *
 * Small and cheap on purpose: this is the DEPOSIT GATE's signal
 * (`isDepositReceived`), which runs on every project-page load.
 *
 * Returns 0 when migration 099 isn't there, so the gate falls through to its
 * older invoice check rather than throwing on a pre-099 database.
 */
export async function projectReceivedTotal(projectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('project_payments')
    .select('amount')
    .eq('project_id', projectId)
  if (error) {
    if (!isMissingRelation(error)) console.error('projectReceivedTotal', error)
    return 0
  }
  const sum = (data || []).reduce(
    (s: number, r: { amount: number | null }) => s + (Number(r.amount) || 0),
    0,
  )
  return Math.round(sum * 100) / 100
}

/** Today as a bare calendar day, for stamping `received_date`.
 *  ⛔ Not `new Date().toISOString().slice(0,10)` — that's the UTC day, so any
 *  shop west of Greenwich marking a payment received in the evening stamps
 *  TOMORROW, and on the last evening of a month the cash lands in the wrong
 *  column of this very page. */
export function todayStamp(): string {
  return formatLocalDate(new Date())
}

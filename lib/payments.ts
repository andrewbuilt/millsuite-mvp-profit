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

export * from './payment-schedule'

interface RawRow {
  id: string
  project_id: string
  milestone_label: string | null
  amount: number | null
  status: string
  expected_date: string | null
  received_date: string | null
  projects: { name: string | null; client_name: string | null; stage: string } | null
}

export interface PaymentsLoad {
  rows: PaymentRow[]
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
        'projects!inner(name, client_name, stage)',
    )
    .eq('org_id', orgId)
    .eq('type', 'receivable')
    .neq('status', 'cancelled')
    .in('projects.stage', POSTSOLD_STAGES)
  if (error) {
    console.error('loadOrgPayments', error)
    return { rows: [], error: error.message || 'Could not load payments.' }
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
  }))
  return { rows, error: null }
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

/** Today as a bare calendar day, for stamping `received_date`.
 *  ⛔ Not `new Date().toISOString().slice(0,10)` — that's the UTC day, so any
 *  shop west of Greenwich marking a payment received in the evening stamps
 *  TOMORROW, and on the last evening of a month the cash lands in the wrong
 *  column of this very page. */
export function todayStamp(): string {
  return formatLocalDate(new Date())
}

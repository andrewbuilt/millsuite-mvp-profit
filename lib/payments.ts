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
//
// ⛔ PAYMENTS V4 (2026-11-05): the receivables rows are the FORECAST and
// `project_payments` is the LEDGER — two independent lists (lib/payment-forecast).
// The ONLY writers of a forecast row here are `saveForecast` (the editor and
// the Redivide modal) and `reschedulePayment` (dragging a card between
// months). Nothing that records, edits or deletes a payment touches one.
// ============================================================================

import { loadTempProjectIds } from './temp-projects'
import { supabase } from './supabase'
import { recordProjectEvent } from './project-events'
import { POSTSOLD_STAGES, type ProjectStage } from './types'
import { formatLocalDate, type PaymentRow } from './payment-schedule'
import { type LedgerEntry } from './payment-forecast'

export * from './payment-schedule'
export * from './payment-forecast'

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
    // `order:N` (see rowToMilestone in lib/milestones). Display order only.
    sortOrder: Number(/order:(\d+)/.exec(r.notes || '')?.[1] ?? Number.MAX_SAFE_INTEGER),
    createdAt: r.created_at,
  }))
  const contractTotals: Record<string, number> = {}
  for (const r of (data || []) as unknown as RawRow[]) {
    contractTotals[r.project_id] = Number(r.projects?.bid_total) || 0
  }
  return { rows, contractTotals, error: null }
}

/**
 * One project's forecast rows, in schedule order — the project page's view.
 *
 * ⛔ WHY THIS EXISTS. `loadOrgPayments` selects FROM `cash_flow_receivables`
 * with `projects!inner`, which is right for the board but wrong for a single
 * project page.
 */
export async function loadProjectForecast(projectId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .select('id, project_id, milestone_label, amount, status, expected_date, received_date, notes, created_at')
    .eq('project_id', projectId)
    .eq('type', 'receivable')
    .neq('status', 'cancelled')
  if (error) {
    console.error('loadProjectForecast', error)
    return []
  }
  return (data || []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    projectId: String(r.project_id),
    projectName: '',
    clientName: null,
    stage: 'sold' as ProjectStage,
    label: String(r.milestone_label || 'Milestone'),
    amount: Number(r.amount) || 0,
    status: (r.status as PaymentRow['status']) || 'projected',
    expectedDate: (r.expected_date as string) ?? null,
    receivedDate: (r.received_date as string) ?? null,
    sortOrder: Number(/order:(\d+)/.exec(String(r.notes || ''))?.[1] ?? Number.MAX_SAFE_INTEGER),
    createdAt: String(r.created_at ?? ''),
  }))
}

/** One row as the editor / Redivide modal hands it to `saveForecast`. */
export interface ForecastDraft {
  /** Existing row id, or null for a row being added. */
  id: string | null
  label: string
  amount: number
  /** The month dropdown (2026-11-06): a date to write, null = "No date set",
   *  undefined = leave the stored date alone. */
  expectedDate?: string | null
}

/**
 * Write a project's forecast — ⛔ THE ONLY WRITER OF FORECAST ROWS besides the
 * month drag. Called by exactly two surfaces: the forecast editor and the
 * Redivide modal, both a human pressing Save.
 *
 * The rows passed ARE the forecast afterwards: matched by id (label, amount,
 * order rewritten; the expected date kept unless the row's month dropdown
 * changed it — dates also move by dragging), new rows inserted with the month
 * picked or no date ("No date set" → drag them in), and every
 * existing row NOT in the list deleted.
 *
 * ⛔ NO CASH VETO, ON PURPOSE. Under v4 a forecast row has no payment against
 * it — the ledger is a separate list — so there is nothing to orphan. (The
 * v3 lock/floor rules that lived here are gone with the binding.)
 */
export async function saveForecast(
  orgId: string,
  projectId: string,
  rows: ForecastDraft[],
  /** Which surface saved — recorded on the project timeline. */
  via: 'editor' | 'redivide',
  /** `bid_total`, to keep `milestone_pct` meaningful for anything that still
   *  reads it (the pre-sale composer). 0 = leave pct at 0. */
  contractTotal = 0,
): Promise<void> {
  for (const r of rows) {
    if (!r.label.trim()) throw new Error('Every forecast row needs a label.')
    if (!Number.isFinite(r.amount) || r.amount < 0) throw new Error(`"${r.label}" needs an amount.`)
  }

  const { data: existing, error: readErr } = await supabase
    .from('cash_flow_receivables')
    .select('id, notes')
    .eq('project_id', projectId)
    .eq('type', 'receivable')
    .neq('status', 'cancelled')
  if (readErr) throw new Error(readErr.message || 'Could not read the forecast.')

  const keep = new Set(rows.map((r) => r.id).filter(Boolean) as string[])
  const byId = new Map((existing || []).map((e) => [e.id as string, e]))
  const pctOf = (amount: number) =>
    contractTotal > 0 ? Math.round((amount / contractTotal) * 10000) / 100 : 0

  // 1. Rows the human removed.
  const toDelete = (existing || []).map((e) => e.id as string).filter((id) => !keep.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('cash_flow_receivables')
      .delete()
      .in('id', toDelete)
      .select('id')
    if (error) throw new Error(error.message || 'Could not remove forecast rows.')
  }

  // 2. Update / insert, re-stamping `order:N` to the order on screen.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const prior = r.id ? byId.get(r.id) : null
    // ⚠️ PRESERVE THE NOTE BODY — `order:N` shares the column with it.
    const priorNote = String(prior?.notes || '').replace(/order:\d+\s*/, '').trim()
    const notes = priorNote ? `order:${i} ${priorNote}` : `order:${i}`
    const label = r.label.trim()
    const amount = Math.round(r.amount * 100) / 100

    if (r.id && prior) {
      const { data, error } = await supabase
        .from('cash_flow_receivables')
        .update({
          notes,
          amount,
          milestone_pct: pctOf(amount),
          milestone_label: label,
          description: label,
          // Only when the month dropdown changed it.
          ...(r.expectedDate !== undefined ? { expected_date: r.expectedDate } : {}),
        })
        .eq('id', r.id)
        .select('id')
      // ⛔ .select() — a zero-row UPDATE returns { error: null }, so an RLS
      // refusal is otherwise indistinguishable from a successful save.
      if (error || !data || data.length === 0) {
        throw new Error(error?.message || 'A forecast row did not save. Reload and check.')
      }
    } else {
      const { data, error } = await supabase
        .from('cash_flow_receivables')
        .insert({
          org_id: orgId,
          project_id: projectId,
          type: 'receivable' as const,
          status: 'projected' as const,
          description: label,
          milestone_label: label,
          milestone_pct: pctOf(amount),
          milestone_trigger: 'manual',
          amount,
          // The month picked in the modal, else NO DATE — "No date set" and
          // dragged in. Andrew: "just add them to the no-date bucket so I can
          // drag them in."
          expected_date: r.expectedDate ?? null,
          notes,
        })
        .select('id')
      if (error || !data || data.length === 0) {
        throw new Error(error?.message || 'A new forecast row did not save.')
      }
    }
  }

  await recordProjectEvent({
    orgId,
    projectId,
    eventType: via === 'redivide' ? 'forecast_redivided' : 'forecast_edited',
    label: via === 'redivide' ? 'Payment forecast redivided' : 'Payment forecast edited',
    meta: { rows: rows.map((r) => ({ id: r.id, label: r.label, amount: r.amount })), removed: toDelete },
  })
}

/** A sold job, for spotting the ones with no draw schedule at all. */
export interface SoldProjectRef {
  id: string
  name: string
  clientName: string | null
  contractTotal: number
}

/**
 * Every sold-or-later project, whether or not it has any draws.
 *
 * ⛔ WHY THIS EXISTS. `loadOrgPayments` selects FROM `cash_flow_receivables`,
 * so a project with no milestone rows produces no rows and simply cannot
 * appear — the board can't tell "this job has no schedule" from "this job
 * doesn't exist". Andrew: "i dont see any of the Leonard payments."
 *
 * Three sold jobs worth $426,032 were invisible, and the board's own
 * "still owed across every sold job" line was quietly understating the book by
 * more than it was reporting. A cash-flow tool that silently omits contracts
 * is worse than one that shows nothing.
 */
export async function loadSoldProjects(orgId: string): Promise<SoldProjectRef[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_name, bid_total')
    .eq('org_id', orgId)
    .in('stage', POSTSOLD_STAGES)
  if (error) {
    console.error('loadSoldProjects', error)
    return []
  }
  // Temp projects (117) carry hours only — no contract, no draws.
  const tempIds = await loadTempProjectIds(orgId)
  return (data || []).filter((r: any) => !tempIds.has(r.id)).map((r: any) => ({
    id: r.id,
    name: r.name || 'Untitled project',
    clientName: r.client_name ?? null,
    contractTotal: Number(r.bid_total) || 0,
  }))
}

// ── The ledger (migration 099) ──────────────────────────────────────────────

const LEDGER_COLUMNS = 'id, project_id, amount, payment_date, label, method, reference, notes'

function toEntry(r: any): LedgerEntry {
  return {
    id: r.id,
    projectId: r.project_id,
    amount: Number(r.amount) || 0,
    paymentDate: r.payment_date,
    label: r.label ?? null,
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
 * Record cash received — a ledger row, and NOTHING ELSE.
 *
 * ⛔ V4: THIS DOES NOT TOUCH THE FORECAST. No row is settled, locked, renamed,
 * renumbered, re-spread or spawned. If the forecast no longer foots to what's
 * left, the board shows the Redivide hint and a human decides.
 */
export async function logPayment(input: {
  orgId: string
  projectId: string
  amount: number
  paymentDate: string
  label?: string | null
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
      label: input.label?.trim() || null,
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
      throw new Error('Recording payments needs migrations 099 and 130. Run them, then reload.')
    }
    throw new Error(error?.message || 'Could not record that payment.')
  }
  return toEntry(data)
}

/** Edit a ledger entry in place — a mis-keyed amount, date or label.
 *  Like `logPayment`, it touches nothing but the ledger row. */
export async function updatePayment(
  id: string,
  patch: {
    amount: number
    paymentDate: string
    label?: string | null
    method?: string | null
    reference?: string | null
    notes?: string | null
  },
  orgId?: string,
): Promise<LedgerEntry> {
  const amount = Number(patch.amount)
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error('Enter an amount. (A refund can be negative; zero can’t.)')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.paymentDate)) throw new Error('Pick a payment date.')
  let q = supabase
    .from('project_payments')
    .update({
      amount,
      payment_date: patch.paymentDate,
      label: patch.label?.trim() || null,
      method: patch.method || null,
      reference: patch.reference?.trim() || null,
      notes: patch.notes?.trim() || null,
    })
    .eq('id', id)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select(LEDGER_COLUMNS)
  if (error) {
    console.error('updatePayment', error)
    throw new Error(error.message || 'Could not save that payment.')
  }
  // ⛔ Zero rows is failure: PostgREST reports an RLS-blocked update as success.
  if (!data || data.length === 0) throw new Error('Could not save that payment (no row updated).')
  return toEntry(data[0])
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

/**
 * What a change order does to the forecast: NOTHING (v4). The CO moves the
 * contract (`bid_total`), `remaining` moves with it, and the board's
 * forecast-vs-remaining hint appears — a human redivides. Nothing auto-spreads.
 * This only records the change on the project timeline — once per CO (`key`).
 */
export async function applyChangeToSchedule(input: {
  orgId: string
  projectId: string
  delta: number
  key: string
  label: string
  actorUserId?: string | null
}): Promise<void> {
  if (Math.round(input.delta) === 0) return
  const { data: prior } = await supabase
    .from('project_events')
    .select('id')
    .eq('project_id', input.projectId)
    .eq('event_type', 'co_schedule_applied')
    .contains('meta', { key: input.key })
    .limit(1)
  if (prior && prior.length > 0) return
  await recordProjectEvent({
    orgId: input.orgId,
    projectId: input.projectId,
    eventType: 'co_schedule_applied',
    label: input.label,
    meta: { key: input.key, delta: Math.round(input.delta) },
    actorUserId: input.actorUserId ?? null,
  })
}

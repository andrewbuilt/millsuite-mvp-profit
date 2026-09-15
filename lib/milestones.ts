// ============================================================================
// lib/milestones.ts — per-project payment milestones (Phase 4)
// ============================================================================
// Milestones are the user-defined schedule of how the project's cash comes in.
// Examples: 50/25/25 (deposit / rough-in / install), 30/10/10/10/10/10/10/10
// (long-build shop), 40/60, etc. No fixed default — the user composes them
// per project.
//
// Storage piggybacks on `cash_flow_receivables`: each milestone row has
//   type='receivable', status='projected', milestone_label, milestone_pct,
//   milestone_trigger, amount (rounded from project total × pct).
// On Phase 5 confirmation they stay 'projected'. On Phase 9 QB watcher they
// advance to 'received' when matched.
// ============================================================================

import { supabase } from './supabase'
import { recordProjectEvent } from './project-events'
import { formatLocalDate } from './payment-schedule'
import {
  syncInvoiceFromMilestoneReceived,
  findInvoiceForMilestone,
  ensureContractInvoice,
  recordInvoicePayment,
  projectInvoicingMode,
} from './invoices'

export type MilestoneTrigger =
  | 'signing'        // deposit at contract signing
  | 'approvals'      // finish specs + drawings all approved
  | 'production'    // entered in-production
  | 'install_start' // install scheduled / trucks rolling
  | 'punchout'      // final walkthrough
  | 'delivery'      // delivered but not installed (install-only jobs)
  | 'manual'        // user-triggered ("we invoice this manually")

export const TRIGGER_LABEL: Record<MilestoneTrigger, string> = {
  signing: 'At signing',
  approvals: 'Approvals complete',
  production: 'Enters production',
  install_start: 'Install starts',
  punchout: 'Final punchout',
  delivery: 'Delivered',
  manual: 'Manual',
}

export const TRIGGER_ORDER: MilestoneTrigger[] = [
  'signing',
  'approvals',
  'production',
  'install_start',
  'delivery',
  'punchout',
  'manual',
]

export interface ProjectMilestone {
  id: string
  project_id: string
  label: string
  pct: number
  trigger: MilestoneTrigger
  amount: number
  status: 'projected' | 'invoiced' | 'received' | 'cancelled'
  /** When we PLAN for the money. */
  expected_date: string | null
  /** When the money ACTUALLY ARRIVED — stamped by `markMilestoneReceived`.
   *  ⚠️ This column has existed all along; it just wasn't on this type, which
   *  is why a later scope pass concluded it was missing and budgeted a
   *  migration for it. The two dates answer different questions and /payments
   *  buckets by each separately — see lib/payments. */
  received_date: string | null
  sort_order: number
}

interface Raw {
  id: string
  project_id: string
  milestone_label: string | null
  milestone_pct: number | null
  milestone_trigger: string | null
  amount: number | null
  status: string
  expected_date: string | null
  received_date: string | null
  created_at: string
  notes: string | null
}

function rowToMilestone(r: Raw, idx: number): ProjectMilestone {
  return {
    id: r.id,
    project_id: r.project_id,
    label: r.milestone_label || 'Milestone',
    pct: Number(r.milestone_pct) || 0,
    trigger: ((r.milestone_trigger as MilestoneTrigger) || 'manual'),
    amount: Number(r.amount) || 0,
    status: (r.status as ProjectMilestone['status']) || 'projected',
    expected_date: r.expected_date,
    received_date: r.received_date ?? null,
    // sort_order is encoded in notes until we add a column; fallback to idx.
    sort_order: Number(r.notes?.match(/order:(\d+)/)?.[1] ?? idx),
  }
}

export async function loadMilestones(projectId: string): Promise<ProjectMilestone[]> {
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .select('id, project_id, milestone_label, milestone_pct, milestone_trigger, amount, status, expected_date, received_date, created_at, notes')
    .eq('project_id', projectId)
    .eq('type', 'receivable')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('loadMilestones', error)
    return []
  }
  return (data as Raw[])
    .map(rowToMilestone)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Replace the entire milestone list for a project in one transactional-ish
 * swap: delete the projected receivables, re-insert the new set.
 *
 * ⛔⛔ THE `status='projected'` GUARD NO LONGER MEANS "UNPAID". READ THIS
 * BEFORE CHANGING ANYTHING HERE.
 *
 * The old comment said the delete "can't accidentally clobber real payments"
 * because received milestones carried status='received'. **Payments v2 made
 * paid-ness DERIVED**: `logPayment` writes a `project_payments` row and
 * deliberately never touches the draw (lib/payments — "there is no 'mark
 * received' any more"). So a draw that is fully paid is STILL
 * status='projected', and this delete will happily destroy it.
 *
 * That is exactly what happened to Schiller: a 50/25/25 schedule with all
 * three draws paid came back as 25/25/25/25 with the deposit row gone. The
 * ledger cash survived — it lives in another table — and the waterfall
 * silently re-allocated it across the regenerated rows, leaving a $2 orphan.
 * A safety check that was made obsolete by a later refactor, still looking
 * correct.
 *
 * ⛔ SO THE REAL GUARD IS CASH, NOT STATUS. `assertNoLedgerCash` below
 * refuses the whole operation when the project has any recorded payment.
 * Money cannot be linked to a specific draw — allocation is derived by the
 * waterfall — so "which row is safe to delete" is not an answerable
 * question. The only safe rule is: once cash exists, the schedule is not
 * regenerable wholesale.
 */
export async function saveMilestones(input: {
  org_id: string
  project_id: string
  project_total: number
  milestones: Array<
    Pick<ProjectMilestone, 'label' | 'pct' | 'trigger' | 'expected_date'> & {
      /** ⛔ REQUIRED so this can re-insert ONLY what it deleted. See below. */
      status?: ProjectMilestone['status']
    }
  >
}): Promise<boolean> {
  // ⛔ CASH ON THE PROJECT VETOES THE WHOLE SWAP. See the header: status is
  // no longer a proxy for "unpaid", so this is the only honest test. Refusing
  // is correct even though it's blunt — the alternative is what happened to
  // Schiller, where a regenerated schedule silently re-allocated paid money.
  //
  // ⚠️ Tolerant of a pre-099 database (no project_payments table): treat an
  // unknown relation as "no cash" rather than blocking every save.
  const { data: cash, error: cashErr } = await supabase
    .from('project_payments')
    .select('id')
    .eq('project_id', input.project_id)
    .limit(1)
  const ledgerMissing =
    !!cashErr &&
    /42P01|PGRST205|does not exist|schema cache/i.test(
      `${(cashErr as { code?: string }).code || ''} ${cashErr.message || ''}`,
    )
  if (cashErr && !ledgerMissing) {
    console.error('saveMilestones: could not check the ledger', cashErr)
    return false
  }
  if (!ledgerMissing && cash && cash.length > 0) {
    console.error(
      'saveMilestones: REFUSED — this project has recorded payments. ' +
        'Regenerating the schedule would re-allocate money that has already ' +
        'been received. Edit the draws on /payments instead.',
    )
    return false
  }

  // ⛔ NEVER DELETE A CHANGE-ORDER DRAW (migration 106). CO rows are written
  // by `appendCoDrawRow` with status='projected' — exactly what this delete
  // targets — so without the guard, opening the milestone builder and saving
  // would silently destroy the change order's line and put the board back to
  // quietly inflating the final draw. The builder doesn't know about CO rows,
  // so it can't re-insert what it removed.
  //
  // ⚠️ Tolerant of a pre-106 database: PostgREST fails the WHOLE statement on
  // one unknown column (42703), and a builder that can't save because a
  // migration is pending would be a worse bug than the one this prevents.
  // Same shape as the pre-098 fallback in lib/tasks.
  const runDelete = (guardCo: boolean) => {
    const q = supabase
      .from('cash_flow_receivables')
      .delete()
      .eq('project_id', input.project_id)
      .eq('type', 'receivable')
      .eq('status', 'projected')
    return guardCo ? q.is('change_order_id', null) : q
  }
  let { error: delErr } = await runDelete(true)
  if (
    delErr &&
    /change_order_id|42703|does not exist|schema cache/i.test(
      `${(delErr as { code?: string }).code || ''} ${delErr.message || ''}`,
    )
  ) {
    console.warn('saveMilestones: pre-106 database — deleting without the CO guard')
    ;({ error: delErr } = await runDelete(false))
  }
  if (delErr) {
    console.error('saveMilestones delete', delErr)
    return false
  }
  // ⛔ RE-INSERT ONLY THE ROWS THE DELETE ABOVE ACTUALLY REMOVED.
  // The delete is scoped to status='projected' (so it can't clobber real
  // money), but this used to insert the caller's ENTIRE list — including
  // milestones already 'received' or 'invoiced', every one of them as a fresh
  // 'projected' row. The received row survived the delete and the copy was
  // added beside it, so the project quietly ended up with MORE than 100% of
  // its value scheduled, and /payments counted that money twice: once under
  // "received", once under "needed".
  // A row with no status is new (the builder's unsaved rows) ⇒ projected.
  //
  // ⚠️ THE ORIGINAL INDEX IS CARRIED THROUGH THE FILTER. `sort_order` is
  // encoded as `order:N` in `notes`, and the received rows that survive the
  // delete keep the N they already have. Re-numbering the survivors 0..n over
  // the FILTERED list would collide with those — a received row at order:0 and
  // a projected row also at order:0 — and the builder's ordering would scramble
  // the next time the list loaded.
  const insertable = input.milestones
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (m.status ?? 'projected') === 'projected')
  if (insertable.length === 0) return true

  const rows = insertable.map(({ m, i }) => ({
    org_id: input.org_id,
    project_id: input.project_id,
    type: 'receivable' as const,
    description: m.label,
    milestone_label: m.label,
    milestone_pct: m.pct,
    milestone_trigger: m.trigger,
    amount: Math.round((input.project_total * m.pct) / 100),
    status: 'projected' as const,
    expected_date: m.expected_date,
    notes: `order:${i}`,
  }))
  const { error: insErr } = await supabase.from('cash_flow_receivables').insert(rows)
  if (insErr) {
    console.error('saveMilestones insert', insErr)
    return false
  }
  return true
}

export function sumMilestonePct(milestones: Array<{ pct: number }>): number {
  return milestones.reduce((s, m) => s + (Number(m.pct) || 0), 0)
}

/**
 * Manual flip: projected → received with received_date stamped to now.
 * Mirror of what the QB watcher does automatically when a deposit lands.
 * Used as a fallback for shops that aren't connected to QB or take a
 * payment outside QB. Returns the patched row.
 */
export async function markMilestoneReceived(
  milestoneId: string,
): Promise<ProjectMilestone | null> {
  // ⛔ LOCAL calendar day, not the UTC one. `new Date().toISOString().slice(0,10)`
  // rolls over at 8pm Eastern / 5pm Pacific, so an evening payment was stamped
  // TOMORROW — and on the last evening of a month that pushes the cash into the
  // next month's column on /payments, understating the month that actually
  // received it. See the timezone note in lib/payment-schedule.
  const paymentDate = formatLocalDate(new Date())
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .update({
      status: 'received',
      received_date: paymentDate,
    })
    .eq('id', milestoneId)
    .select(
      'id, project_id, milestone_label, milestone_pct, milestone_trigger, amount, status, expected_date, received_date, created_at, notes',
    )
    .single()
  if (error) {
    console.error('markMilestoneReceived', error)
    throw error
  }
  // Timeline (094). Placed HERE, before the invoicing branch below, because
  // that branch returns early in QuickBooks mode — logging further down would
  // silently skip every QB org, and Built is one.
  if (data?.project_id) {
    const { data: projRow } = await supabase
      .from('projects')
      .select('org_id')
      .eq('id', data.project_id as string)
      .maybeSingle()
    const orgId = (projRow as { org_id?: string } | null)?.org_id
    if (orgId) {
      void recordProjectEvent({
        orgId,
        projectId: data.project_id as string,
        eventType: 'milestone_received',
        label: `Payment received — ${(data as Raw).milestone_label || 'milestone'}`,
        meta: { amount: Number((data as Raw).amount) || 0, milestoneId },
      })
    }
  }
  // Move real money on the invoice — otherwise this is a dead toggle that
  // sets a status but never raises amount_received (the bug that stranded
  // projects in Pre-Production). INTERNAL mode only: in QB mode the system
  // never creates/records internal invoice payments — money comes from the QB
  // watcher, so the milestone toggle is projection-only. Two internal cases,
  // both non-fatal:
  //   - the milestone HAS a linked invoice → settle its outstanding balance.
  //   - no linked invoice → record this milestone's amount on the project's
  //     contract invoice (creating it if missing) so the deposit signal + AR
  //     actually move.
  try {
    if (data?.project_id && (await projectInvoicingMode(data.project_id as string)) === 'quickbooks') {
      // QB mode: leave invoices to QB + the watcher.
      return data ? rowToMilestone(data as Raw, 0) : null
    }
    const linked = await findInvoiceForMilestone(milestoneId)
    if (linked) {
      await syncInvoiceFromMilestoneReceived(milestoneId, paymentDate, 'manual')
    } else if (data?.project_id) {
      const inv = await ensureContractInvoice(data.project_id as string)
      if (inv) {
        const balance = +(inv.total - inv.amount_received).toFixed(2)
        const amt = Math.min(Number((data as Raw).amount) || 0, balance)
        if (amt > 0) {
          await recordInvoicePayment({
            invoice_id: inv.id,
            amount: amt,
            payment_date: paymentDate,
            payment_method: null,
            reference: null,
            notes: `${(data as Raw).milestone_label || 'Milestone'} — marked received`,
          })
        }
      }
    }
  } catch (e) {
    console.warn('markMilestoneReceived → invoice sync', e)
  }
  return data ? rowToMilestone(data as Raw, 0) : null
}

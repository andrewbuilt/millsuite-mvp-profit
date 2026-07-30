// ============================================================================
// lib/project-stage.ts — Pre-Production → Ready → In Production helpers
// ============================================================================
// "Ready for production" is a DERIVED sub-state of the 'sold' stage, not a
// stored stage. isReadyForProduction(projectId) returns true when a sold
// project has cleared every gate; startProduction(projectId) is the single
// writer that flips 'sold' → 'production' (operator-driven, via the manual
// "Start production" button). There is no auto-advance anymore.
//
// Gates (all must be true):
//   1. project.stage === 'sold'
//   2. the project has ≥1 subproject and EVERY subproject's
//      ready_for_scheduling flag is true (specs + drawings approved)
//   3. the deposit is in — the project's contract invoice (client_invoices)
//      has amount_received > 0. Both signals feed it: the QB watcher applies a
//      real draw, and the manual paths (the "Mark deposit received" button and
//      the milestone RECEIVED toggle) record a payment on the contract invoice
//      via ensureContractInvoice + recordInvoicePayment — creating the invoice
//      first when one doesn't exist yet (the bug that stranded projects in
//      Pre-Production: the milestone toggle used to no-op with no invoice).
// ============================================================================

import { supabase } from './supabase'
import { loadSubprojectStatusMap } from './subproject-status'
import { seedAllocationsForProduction } from './schedule-seed'
import {
  ensureContractInvoice,
  findContractInvoice,
  recordInvoicePayment,
  projectInvoicingMode,
} from './invoices'

/**
 * Derived readiness gate for the Pre-Production → In Production transition.
 * Read-only: never writes. Cheap (a few small queries) and safe to call on
 * mount / reload to drive the status-bar chip + the Ready banner.
 */
export async function isReadyForProduction(projectId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, stage')
    .eq('id', projectId)
    .single()
  if (project?.stage !== 'sold') return false

  const { data: subs } = await supabase
    .from('subprojects')
    .select('id')
    .eq('project_id', projectId)
  const subIds = (subs || []).map((s: { id: string }) => s.id)
  if (subIds.length === 0) return false

  const status = await loadSubprojectStatusMap(subIds)
  const allReady = subIds.every((id) => status[id]?.ready_for_scheduling === true)
  if (!allReady) return false

  return await isDepositReceived(projectId)
}

/**
 * Deposit signal: the project's CONTRACT invoice has received money. Must read
 * the contract invoice specifically (findContractInvoice) — NOT "the latest
 * invoice", because a change-order invoice is more recent and its
 * amount_received is 0, which would mask a paid contract and strand the project
 * in Pre-Production (the bug). amount_received > 0 = "the deposit / first draw
 * is in."
 */
export async function isDepositReceived(projectId: string): Promise<boolean> {
  // Manual override (QB failsafe) short-circuits the gate.
  const { data: p } = await supabase
    .from('projects')
    .select('deposit_override')
    .eq('id', projectId)
    .maybeSingle()
  if ((p as { deposit_override?: boolean } | null)?.deposit_override) return true
  const inv = await findContractInvoice(projectId)
  if (!inv) return false
  return inv.total > 0 && inv.amount_received > 0
}

/**
 * Move the project past the deposit gate. Mode-aware:
 *   - QB mode: a manual OVERRIDE (rare failsafe — payment forthcoming / the QB
 *     connection is messed up). Sets projects.deposit_override; NO internal
 *     invoice is created. The normal QB path is the watcher marking the pushed
 *     contract invoice paid.
 *   - internal mode: records a real deposit payment on the contract invoice
 *     (creating it from bid_total if missing). Deposit = first milestone amount
 *     (the deposit %), else 30% of total, capped at the balance. Idempotent.
 * Returns true when the gate will now pass, false when there's nothing to
 * invoice (internal mode, no positive total).
 */
export async function markDepositReceived(projectId: string): Promise<boolean> {
  if ((await projectInvoicingMode(projectId)) === 'quickbooks') {
    const { error } = await supabase
      .from('projects')
      .update({ deposit_override: true })
      .eq('id', projectId)
    if (error) {
      console.error('markDepositReceived override', error)
      return false
    }
    return true
  }

  const inv = await ensureContractInvoice(projectId)
  if (!inv) return false
  if (inv.amount_received > 0) return true // deposit already in
  const balance = +(inv.total - inv.amount_received).toFixed(2)
  if (balance <= 0) return true

  const { data: ms } = await supabase
    .from('cash_flow_receivables')
    .select('amount')
    .eq('project_id', projectId)
    .eq('type', 'receivable')
    .order('created_at', { ascending: true })
    .limit(1)
  const firstAmt = ms && ms[0] ? Number((ms[0] as { amount: number | null }).amount) || 0 : 0
  const deposit = firstAmt > 0 ? firstAmt : Math.round(inv.total * 0.3)
  const amount = Math.min(deposit, balance)
  if (amount <= 0) return true

  await recordInvoicePayment({
    invoice_id: inv.id,
    amount,
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: null,
    reference: null,
    notes: 'Deposit — marked received (manual)',
  })
  return true
}

/**
 * The single writer of the sold → production transition. Operator-driven
 * (the "Start production" button). Guards on isReadyForProduction so a stale
 * UI can't push an un-ready project through, then flips the stage and seeds
 * the schedule allocations. Returns true on success, false if not ready or
 * the write failed.
 */
export async function startProduction(projectId: string): Promise<boolean> {
  const ready = await isReadyForProduction(projectId)
  if (!ready) return false
  return commitProductionStart(projectId)
}

/** The actual transition: flip the stage + seed schedule allocations. Shared
 *  by the gated path and the override so both behave identically once the
 *  decision to start has been made. */
async function commitProductionStart(projectId: string): Promise<boolean> {
  const { error } = await supabase
    .from('projects')
    .update({ stage: 'production' })
    .eq('id', projectId)
  if (error) {
    console.error('startProduction update', error)
    return false
  }
  await seedAllocationsForProduction(projectId)
  return true
}

/**
 * Approval override (6c item 3). For jobs whose approvals already happened
 * OUTSIDE MillSuite — the Built-OS imports, where the client signed off on
 * samples months ago — force the remaining approval cards closed and then run
 * the normal startProduction().
 *
 * Deliberately NOT import-specific (any project can need it), but it is
 * owner-only + confirm-gated in the UI because it bypasses the sample
 * sign-off trail. Every card it closes gets an audit note so the history
 * shows the approval was overridden, not actually obtained here.
 *
 * The DEPOSIT gate still applies — this only clears approvals. If the deposit
 * isn't recorded the project stays put and this returns
 * { ok: false, reason: 'deposit' } so the UI can say why.
 *
 * NB: it bypasses isReadyForProduction rather than calling startProduction,
 * because that gate also requires approved DRAWING revisions — imported jobs
 * have no drawings in MillSuite (they lived in Built / the shop's drive), so
 * the gate could never pass no matter how many cards we approve. Approvals +
 * drawings are exactly what "overridden" means here; the deposit is not.
 */
export async function forceStartProduction(
  projectId: string,
  args: { actorUserId?: string; note?: string } = {},
): Promise<{ ok: boolean; approvedCount: number; reason?: 'deposit' | 'stage' | 'error' }> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, stage')
    .eq('id', projectId)
    .single()
  if (project?.stage !== 'sold') return { ok: false, approvedCount: 0, reason: 'stage' }

  const { data: subs } = await supabase
    .from('subprojects')
    .select('id')
    .eq('project_id', projectId)
  const subIds = (subs || []).map((s: { id: string }) => s.id)

  // Close every card that isn't approved yet, with an audit note.
  let approvedCount = 0
  if (subIds.length) {
    const { data: items } = await supabase
      .from('approval_items')
      .select('id, state')
      .in('subproject_id', subIds)
      .neq('state', 'approved')
    const { approve } = await import('./approvals')
    for (const it of (items || []) as Array<{ id: string }>) {
      try {
        await approve(it.id, {
          actorUserId: args.actorUserId,
          note:
            args.note ||
            'Approval overridden — sign-off happened outside MillSuite (imported job).',
        })
        approvedCount++
      } catch (err) {
        console.error('forceStartProduction approve', it.id, err)
      }
    }
  }

  // Deposit is the one gate the override does NOT bypass.
  if (!(await isDepositReceived(projectId))) {
    return { ok: false, approvedCount, reason: 'deposit' }
  }
  const ok = await commitProductionStart(projectId)
  return { ok, approvedCount, reason: ok ? undefined : 'error' }
}

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
import { ensureContractInvoice, recordInvoicePayment } from './invoices'

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
 * Deposit signal: the project's contract invoice has received money. We read
 * the latest non-void invoice for the project (one-invoice-per-project = the
 * contract; change-order invoices don't exist at the sold stage) and treat
 * amount_received > 0 as "the deposit / first draw is in."
 */
export async function isDepositReceived(projectId: string): Promise<boolean> {
  const { data: inv } = await supabase
    .from('client_invoices')
    .select('total, amount_received, status')
    .eq('project_id', projectId)
    .neq('status', 'void')
    .order('invoice_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!inv) return false
  return Number(inv.total) > 0 && Number(inv.amount_received) > 0
}

/**
 * Manual deposit path (testing + payments taken outside QB). Ensures the
 * project has a contract invoice, then records a deposit payment so
 * amount_received > 0 → the readiness gate passes. Idempotent: a no-op once
 * the invoice already has money. Deposit amount = the first milestone's amount
 * (the deposit %), else 30% of the total, capped at the outstanding balance.
 * Returns true when the deposit is (now) in, false when there's nothing to
 * invoice (no positive project total).
 */
export async function markDepositReceived(projectId: string): Promise<boolean> {
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

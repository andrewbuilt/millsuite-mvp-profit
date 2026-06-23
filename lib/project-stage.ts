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
//      has amount_received > 0. Post invoicing-rebuild, milestones are
//      projection-only and a milestone only flips to 'received' once the
//      invoice is FULLY paid, so the old "deposit milestone received" gate
//      is unreliable; the invoice's received amount is the real signal.
//      (Both the QB watcher applying a draw and the manual
//      markMilestoneReceived path raise amount_received, so this catches
//      both.)
// ============================================================================

import { supabase } from './supabase'
import { loadSubprojectStatusMap } from './subproject-status'
import { seedAllocationsForProduction } from './schedule-seed'

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

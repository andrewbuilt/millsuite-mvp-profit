// ============================================================================
// lib/project-stage.ts — stage-machine helpers (auto-advance to production)
// ============================================================================
// Single owner of the sold → production transition. Callers fire this after
// any state change that could be the last gate (spec approval, drawings
// approval, deposit milestone marked received, project page mount). The
// helper is idempotent: if the project isn't sold (or any gate is unmet),
// it returns false without writing anything.
//
// Gates (all must be true):
//   1. project.stage === 'sold'
//   2. every subproject's ready_for_scheduling flag is true (specs +
//      drawings approved across the board)
//   3. at least one milestone whose label contains "deposit" has
//      status === 'received'
//
// On success, the row flips to stage='production' and seedAllocationsForProduction
// fans out the schedule allocations (PR2 — currently a no-op stub).
// ============================================================================

import { supabase } from './supabase'
import { loadSubprojectStatusMap } from './subproject-status'
import { loadMilestones } from './milestones'
import { seedAllocationsForProduction } from './schedule-seed'

export async function maybeAdvanceToProduction(projectId: string): Promise<boolean> {
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
  const allReady =
    subIds.length > 0 &&
    subIds.every((id) => status[id]?.ready_for_scheduling === true)
  if (!allReady) return false

  const milestones = await loadMilestones(projectId)
  const depositReceived = milestones.some(
    (m) => (m.label || '').toLowerCase().includes('deposit') && m.status === 'received',
  )
  if (!depositReceived) return false

  const { error } = await supabase
    .from('projects')
    .update({ stage: 'production' })
    .eq('id', projectId)
  if (error) {
    console.error('maybeAdvanceToProduction update', error)
    return false
  }
  await seedAllocationsForProduction(projectId)
  return true
}

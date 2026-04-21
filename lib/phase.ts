// ============================================================================
// lib/phase.ts — project stage advancement engine
// ============================================================================
// After the migration-016 consolidation, `projects.stage` is the single
// pipeline field: new_lead → fifty_fifty → ninety_percent → sold →
// production → installed → complete (with `lost` terminal from pre-sold).
//
// Transitions the cover page surfaces as manual action-bar buttons; this
// engine only handles the ONE auto-advance we still honor:
//
//   sold → production   when every subproject is ready_for_scheduling
//                       (all approval_items approved + the latest drawing
//                       revision approved per sub). Called from the
//                       pre-prod approval page after anything changes.
//
// Everything else (starting a project, marking installed, marking complete)
// is a deliberate click on the cover — the old production_phase scheduling
// sub-stage and the auto "first time entry" transition are gone.
// ============================================================================

import { supabase } from './supabase'
import type { ProjectStage } from './types'

/**
 * If a sold project has all subproject approvals + drawings approved, flip
 * the stage to 'production' and stamp `approvals_complete_date`. Returns
 * the current stage after any advancement. No-op for non-sold projects.
 */
export async function checkAndAdvanceProjectStage(
  projectId: string
): Promise<ProjectStage | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, stage')
    .eq('id', projectId)
    .single()

  if (!project) return null
  const stage = project.stage as ProjectStage
  if (stage !== 'sold') return stage

  const { data: subs } = await supabase
    .from('subprojects')
    .select('id')
    .eq('project_id', projectId)

  if (!subs || subs.length === 0) return stage

  const subIds = subs.map((s) => s.id)

  const { data: statusRows } = await supabase
    .from('subproject_approval_status')
    .select('subproject_id, ready_for_scheduling')
    .in('subproject_id', subIds)

  if (!statusRows || statusRows.length < subIds.length) return stage
  if (!statusRows.every((r) => r.ready_for_scheduling)) return stage

  await supabase
    .from('projects')
    .update({
      stage: 'production',
      approvals_complete_date: new Date().toISOString().split('T')[0],
    })
    .eq('id', projectId)

  return 'production'
}

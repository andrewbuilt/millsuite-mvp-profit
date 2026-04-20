// ============================================================================
// lib/phase.ts — production_phase advancement engine
// ============================================================================
// Phase 0 cleanup: stripped of client-portal side effects (portal_timeline
// writes, portal_step updates, firePortalStepEmail). The portal was removed
// as scope creep from prior threads. What remains is the in-shop lifecycle:
//
//   pre_production → scheduling   when every subproject is ready_for_scheduling
//                                 (all approval_items approved + at least one
//                                 latest drawing revision approved per sub)
//   scheduling      → in_production  when any time entry is logged
//
// Reads the `subproject_approval_status` view introduced in migration 002.
// ============================================================================

import { supabase } from './supabase'

export async function checkAndAdvanceProductionPhase(
  projectId: string
): Promise<string | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, status, production_phase')
    .eq('id', projectId)
    .single()

  if (!project) return null
  if (project.status !== 'active') return project.production_phase

  // ── pre_production → scheduling ──
  if (project.production_phase === 'pre_production') {
    const { data: subs } = await supabase
      .from('subprojects')
      .select('id')
      .eq('project_id', projectId)

    if (!subs || subs.length === 0) return project.production_phase

    const subIds = subs.map((s) => s.id)

    // Single trip to the approval-status view. A subproject is ready when all
    // approval_items are approved AND all latest drawing revisions are
    // approved. See migration 002 for the view definition.
    const { data: statusRows } = await supabase
      .from('subproject_approval_status')
      .select('subproject_id, ready_for_scheduling')
      .in('subproject_id', subIds)

    if (!statusRows || statusRows.length < subIds.length) {
      return project.production_phase
    }
    if (!statusRows.every((r) => r.ready_for_scheduling)) {
      return project.production_phase
    }

    await supabase
      .from('projects')
      .update({
        production_phase: 'scheduling',
        approvals_complete_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', projectId)

    return 'scheduling'
  }

  // ── scheduling → in_production ──
  if (project.production_phase === 'scheduling') {
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)

    if (!timeEntries || timeEntries.length === 0) return project.production_phase

    await supabase
      .from('projects')
      .update({ production_phase: 'in_production' })
      .eq('id', projectId)

    return 'in_production'
  }

  return project.production_phase
}

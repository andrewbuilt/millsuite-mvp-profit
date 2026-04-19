// ============================================================================
// lib/phase.ts — production_phase advancement engine
// ============================================================================
// Lifted out of the deleted lib/leads.ts during Phase 5. The function itself
// has nothing to do with leads — it owns the in-shop lifecycle transitions
// for an active project:
//
//   pre_production → scheduling   when every subproject is ready_for_scheduling
//                                 (all approval_items approved + at least one
//                                 latest drawing revision approved per sub)
//   scheduling      → in_production  when any time entry is logged
//
// The old version queried the dropped `selections` table and the Apr-18
// drawing_revisions shape. Now it reads the `subproject_approval_status` view
// introduced in migration 002, which is the canonical source of truth.
//
// Idempotent — safe to call after any approval-state change or time entry
// creation. Returns the new production_phase (or the current one if nothing
// advanced).
// ============================================================================

import { supabase } from './supabase'
import { firePortalStepEmail } from './portal'

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
        portal_step: 'scheduling',
        approvals_complete_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', projectId)

    await supabase.from('portal_timeline').insert({
      project_id: projectId,
      event_type: 'step_change',
      event_label: 'All Approvals Complete',
      event_detail: 'Approvals and drawings approved — moving to scheduling',
      portal_step: 'scheduling',
      actor_type: 'system',
      triggered_by: 'system',
    })

    await firePortalStepEmail(projectId, 'scheduling')

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
      .update({ production_phase: 'in_production', portal_step: 'in_production' })
      .eq('id', projectId)

    await firePortalStepEmail(projectId, 'in_production')

    return 'in_production'
  }

  return project.production_phase
}

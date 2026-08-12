'use client'

// ============================================================================
// lib/practice.ts — throwaway projects created by the first-job walkthrough
// ============================================================================
// `projects.practice_at` (088) is modelled on `imported_at` (080): a nullable
// timestamp that doubles as "when", driving both the badge and the exclusion
// filters. Practice work is real enough to price — it uses the shop's actual
// rate book — but it must never reach a number anyone makes a decision on.
//
// EVERY READ HERE IS BEST-EFFORT ON PURPOSE. The exclusion filters could have
// been written straight into the dashboard/capacity/reports queries as
// `.is('practice_at', null)`, which is tidier — but a filter on a column that
// doesn't exist yet doesn't return nothing, it fails the WHOLE query. That
// would take out the dashboard, the capacity calendar and reports for a live
// customer in the window between deploying this and running 088. Fetching the
// ids separately means a pre-088 database returns an empty set and every page
// behaves exactly as it does today.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { deleteProject } from '@/lib/sales'

export interface PracticeProject {
  id: string
  name: string
  practice_at: string
}

/** Ids of this org's practice projects. Empty set on any failure — see above. */
export async function loadPracticeProjectIds(orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .not('practice_at', 'is', null)
  if (error || !data) return new Set()
  return new Set(data.map((r) => r.id as string))
}

export async function listPracticeProjects(orgId: string): Promise<PracticeProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, practice_at')
    .eq('org_id', orgId)
    .not('practice_at', 'is', null)
    .order('practice_at', { ascending: false })
  if (error || !data) return []
  return data as PracticeProject[]
}

/** Stamp a project as practice. Called by the tour once it sees which project
 *  the user actually made. Never un-stamps: turning practice work into real
 *  work should be a deliberate act, not a side effect of re-running a tour. */
export async function markProjectAsPractice(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ practice_at: new Date().toISOString() })
    .eq('id', projectId)
    .is('practice_at', null)
  if (error) console.warn('markProjectAsPractice', error.message)
}

/** Delete every practice project in the org. Reuses deleteProject so the
 *  non-cascading children (time entries, invoices, milestones…) go with them.
 *  Returns how many were removed. */
export async function deleteAllPracticeData(orgId: string): Promise<number> {
  const rows = await listPracticeProjects(orgId)
  for (const p of rows) await deleteProject(p.id)
  return rows.length
}

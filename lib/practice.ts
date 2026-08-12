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

/** Every project id in the org. The tour snapshots this before a practice run
 *  so it can tell a project the user just created from one that was already
 *  there — see the knownProjectsRef note in TourProvider. Empty set on failure
 *  would be the DANGEROUS default here (it would make every real project look
 *  new), so this one returns null on error and callers must refuse to stamp. */
export async function loadProjectIds(orgId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase.from('projects').select('id').eq('org_id', orgId)
  if (error || !data) return null
  return new Set(data.map((r) => r.id as string))
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
 *  Keeps going past a failure — one stubborn project shouldn't silently strand
 *  the rest — and reports what didn't go. */
export async function deleteAllPracticeData(
  orgId: string,
): Promise<{ deleted: number; failed: number }> {
  const rows = await listPracticeProjects(orgId)
  let failed = 0
  for (const p of rows) {
    try {
      await deleteProject(p.id)
    } catch {
      failed++
    }
  }
  return { deleted: rows.length - failed, failed }
}

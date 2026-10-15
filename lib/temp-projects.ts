// ============================================================================
// lib/temp-projects.ts — hours-only TEMP projects (October batch item 9, 117)
// ============================================================================
// For the tracking habit: the crew clocks time against old jobs that were
// never estimated in MillSuite. A temp project is a name + subprojects + est
// hours per department, and NOTHING else — no money, estimate, payments,
// portal, QB or approvals.
//
//   · `projects.temp_at` (117) marks it. Separate from practice_at on purpose:
//     practice is the tour's scratch and gets cleaned up; temp jobs carry
//     real tracked time and must never be swept with it.
//   · Stage 'production' so it shows in /time and the worker clock-in list
//     (which offer sold/production/installed) with no new stage.
//   · Est hours live where every other est hour lives: one estimate line per
//     sub ("Estimated hours", qty 1, dept_hour_overrides per dept), so the
//     clock-in sub cards' used/total bars read them with zero new code.
//     bid_total stays 0 and is never recomputed from here.
//   · EXCLUDED from sales, payments, reports, capacity, schedule and the /pm
//     money cards via `loadExcludedProjectIds` (lib/practice) — fetched as a
//     separate id set, never as a `.is('temp_at', null)` filter, because a
//     filter on a pre-117 column fails the WHOLE query (practice's lesson).
//
// ⚠️ TEMPORARY FEATURE. The "+ Temp project" button on /projects is the only
// way in; remove it (search "TEMP-PROJECT-BUTTON") once the shop has cycled
// through the old jobs. Existing temp projects keep working without it.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { deleteProject } from '@/lib/sales'
import { LABOR_DEPTS, type LaborDept } from '@/lib/rate-book-seed'

export interface TempSubInput {
  name: string
  hours: Partial<Record<LaborDept, number>>
}

/** Ids of this org's temp projects. Empty set on any failure (incl. pre-117). */
export async function loadTempProjectIds(orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .not('temp_at', 'is', null)
  if (error || !data) return new Set()
  return new Set(data.map((r) => r.id as string))
}

/** Create the project, its subs, and one hours-only line per sub. All or
 *  nothing: a failure after the project row exists deletes it again. */
export async function createTempProject(input: {
  orgId: string
  name: string
  subs: TempSubInput[]
}): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('Give the project a name.')
  const subs = input.subs
    .map((s) => ({ name: s.name.trim(), hours: s.hours }))
    .filter((s) => s.name)
  if (subs.length === 0) throw new Error('Add at least one subproject.')

  const { data: proj, error: projErr } = await supabase
    .from('projects')
    .insert({
      org_id: input.orgId,
      name,
      stage: 'production',
      bid_total: 0,
      temp_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (projErr || !proj) {
    const code = String((projErr as { code?: string } | null)?.code)
    if (code === '42703' || code === 'PGRST204') {
      throw new Error('Temp projects need migration 117 — run it on the database first.')
    }
    throw new Error(projErr?.message || 'Could not create the project.')
  }
  const projectId = proj.id as string

  try {
    const { data: subRows, error: subErr } = await supabase
      .from('subprojects')
      .insert(
        subs.map((s, i) => ({
          project_id: projectId,
          org_id: input.orgId,
          name: s.name,
          sort_order: i,
        })),
      )
      .select('id, sort_order')
    if (subErr || !subRows) throw new Error(subErr?.message || 'Could not create the subprojects.')

    const lines = subRows
      .map((row: { id: string; sort_order: number }) => {
        const hours = subs[row.sort_order]?.hours || {}
        const overrides: Partial<Record<LaborDept, number>> = {}
        for (const d of LABOR_DEPTS) {
          const h = Number(hours[d]) || 0
          if (h > 0) overrides[d] = h
        }
        if (Object.keys(overrides).length === 0) return null
        return {
          subproject_id: row.id,
          sort_order: 0,
          description: 'Estimated hours',
          quantity: 1,
          unit: 'job',
          dept_hour_overrides: overrides,
        }
      })
      .filter(Boolean)
    if (lines.length > 0) {
      const { error: lineErr } = await supabase.from('estimate_lines').insert(lines)
      if (lineErr) throw new Error(lineErr.message || 'Could not save the hours.')
    }
  } catch (e) {
    try {
      await deleteProject(projectId)
    } catch {
      /* best effort — the error below is the one that matters */
    }
    throw e
  }
  return projectId
}

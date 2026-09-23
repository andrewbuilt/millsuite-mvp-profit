// ============================================================================
// lib/duplicate-project.ts — copy a project so pricing can diverge per option
// ============================================================================
// Andrew's use case (2026-09-23): a customer wants "Option 2" — same scope,
// different pricing. So the copy carries the SCOPE MODEL (subprojects,
// estimate lines + their options, descriptions, install prefills) and leaves
// behind everything that belongs to the ORIGINAL deal's history:
//
//   NOT copied: payments/draws/invoices · estimate history + sent stamp ·
//   approvals · drawings · time entries · tasks · timeline events · notes ·
//   portal linkage (portal access is per-CLIENT token; the copy simply lands
//   pre-sold, which the portal never shows) · CO docs · Drive folders.
//
// ⛔ THE FREEZE FLAGS CARRY. `imported_at` on the project and `price_frozen`
// per subproject (migration 108) are PRICING SEMANTICS, not history: an
// imported job's stored line costs ARE its price, and a copy that dropped the
// flags would silently reprice every line at today's shop rate — the exact
// bug 108 exists to prevent. A copy must price to the penny like its source
// until someone deliberately changes it.
//
// ⛔ BUILT ON SPREAD-AND-STRIP, NOT A COLUMN LIST. `select('*')` and carry
// everything except a NAMED strip/override set — so a future pricing column
// added to estimate_lines is copied automatically instead of silently
// defaulting on every copy. The strip sets below name only columns verified
// to exist (grep migrations 001/004/016/080/094/108 + lib/types.ts, 2026-09-23);
// naming a column that doesn't exist would PGRST204 the whole insert.
//
// Ids are generated CLIENT-SIDE (crypto.randomUUID) so subprojects and lines
// can be bulk-inserted with their parent links already wired — no per-row
// round trips, no id-mapping second pass.
//
// Browser-legal: projects / subprojects / estimate_lines / estimate_line_options
// all carry FOR ALL org RLS policies (migrations 017 + 083). Every insert
// re-selects and treats zero rows as failure (the house rule — PostgREST
// answers { error: null } for a write that matched nothing). A failure after
// the project row lands deletes the new project (children cascade), so a
// half-copy can't survive as a project with missing scope.
// ============================================================================

import { supabase } from './supabase'

export type DuplicateStage = 'new_lead' | 'fifty_fifty' | 'ninety_percent'

/**
 * Where the copy lands (Andrew's defaults, veto-able):
 *   · pre-sold source → the SAME column, it's a sibling option;
 *   · sold-or-later source → 90%, a fresh option about to close;
 *   · lost source → new lead — copying a dead deal is reviving it.
 */
export function duplicateTargetStage(sourceStage: string): DuplicateStage {
  if (sourceStage === 'new_lead' || sourceStage === 'fifty_fifty' || sourceStage === 'ninety_percent') {
    return sourceStage
  }
  if (sourceStage === 'lost') return 'new_lead'
  return 'ninety_percent'
}

/** The default name offered in the confirm dialog — editable there. */
export function duplicateDefaultName(sourceName: string): string {
  return `${(sourceName || '').trim() || 'Project'} · Option 2`
}

/** Spread-and-strip: everything except id + timestamps (the database stamps
 *  fresh ones) — overrides are applied by the caller on top. */
function stripRow<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = row
  return rest
}

export async function duplicateProject(sourceProjectId: string, newName: string): Promise<string> {
  const name = newName.trim()
  if (!name) throw new Error('The copy needs a name.')

  // ── Load the source model ──
  const { data: src, error: srcErr } = await supabase
    .from('projects')
    .select('*')
    .eq('id', sourceProjectId)
    .single()
  if (srcErr || !src) throw new Error(srcErr?.message || 'Could not load the project.')

  const { data: subs, error: subErr } = await supabase
    .from('subprojects')
    .select('*')
    .eq('project_id', sourceProjectId)
    .order('sort_order', { ascending: true })
  if (subErr) throw new Error(subErr.message)
  const srcSubs = (subs || []) as Array<Record<string, unknown>>

  const srcSubIds = srcSubs.map((s) => s.id as string)
  let srcLines: Array<Record<string, unknown>> = []
  let srcOptions: Array<Record<string, unknown>> = []
  if (srcSubIds.length > 0) {
    const { data: lines, error: lineErr } = await supabase
      .from('estimate_lines')
      .select('*')
      .in('subproject_id', srcSubIds)
    if (lineErr) throw new Error(lineErr.message)
    srcLines = (lines || []) as Array<Record<string, unknown>>

    const lineIds = srcLines.map((l) => l.id as string)
    if (lineIds.length > 0) {
      const { data: opts, error: optErr } = await supabase
        .from('estimate_line_options')
        .select('*')
        .in('estimate_line_id', lineIds)
      if (optErr) throw new Error(optErr.message)
      srcOptions = (opts || []) as Array<Record<string, unknown>>
    }
  }

  // ── Build the copy ──
  const newProjectId = crypto.randomUUID()

  const projectRow: Record<string, unknown> = {
    ...stripRow(src as Record<string, unknown>),
    id: newProjectId,
    name,
    // A fresh option re-enters the pipeline — never lands post-sold.
    stage: duplicateTargetStage(String((src as Record<string, unknown>).stage || '')),
    // History the copy hasn't earned. bid_total CARRIES (same lines, same
    // total — the board and dashboards read it before any recompute runs);
    // actual_total resets because no hours or invoices exist here yet.
    actual_total: 0,
    sold_at: null,
    completed_at: null,
    due_date: null,
    estimate_sent_at: null,
    approvals_complete_date: null,
    target_start_date: null,
    production_phase: null,
    source_lead_id: null,
    drive_folder_id: null,
    drive_folder_url: null,
    // ⚠️ imported_at deliberately NOT nulled — see the freeze note above.
  }

  const subIdMap = new Map<string, string>()
  const subRows = srcSubs.map((s) => {
    const newId = crypto.randomUUID()
    subIdMap.set(s.id as string, newId)
    return {
      ...stripRow(s),
      id: newId,
      project_id: newProjectId,
      // Production/approval state resets; scope + pricing (price_frozen
      // included) carries.
      ready_for_production: false,
      selections_confirmed: false,
      selections_confirmed_date: null,
      drive_folder_id: null,
      drive_approval_folder_id: null,
    }
  })

  const lineIdMap = new Map<string, string>()
  const lineRows = srcLines.map((l) => {
    const newId = crypto.randomUUID()
    lineIdMap.set(l.id as string, newId)
    return {
      ...stripRow(l),
      id: newId,
      subproject_id: subIdMap.get(l.subproject_id as string),
    }
  })

  // Composite-PK join rows: no id column to strip beyond created_at.
  const optionRows = srcOptions.map((o) => {
    const { created_at: _c, ...rest } = o
    return { ...rest, estimate_line_id: lineIdMap.get(o.estimate_line_id as string) }
  })

  // ── Insert, parent first; clean up the parent if any child insert fails ──
  const { data: insProj, error: projErr } = await supabase
    .from('projects')
    .insert(projectRow)
    .select('id')
  if (projErr || !insProj || insProj.length === 0) {
    throw new Error(projErr?.message || 'Could not create the copy.')
  }

  try {
    if (subRows.length > 0) {
      const { data: insSubs, error: e } = await supabase
        .from('subprojects')
        .insert(subRows)
        .select('id')
      if (e || !insSubs || insSubs.length !== subRows.length) {
        throw new Error(e?.message || 'Could not copy the subprojects.')
      }
    }
    if (lineRows.length > 0) {
      const { data: insLines, error: e } = await supabase
        .from('estimate_lines')
        .insert(lineRows)
        .select('id')
      if (e || !insLines || insLines.length !== lineRows.length) {
        throw new Error(e?.message || 'Could not copy the estimate lines.')
      }
    }
    if (optionRows.length > 0) {
      const { data: insOpts, error: e } = await supabase
        .from('estimate_line_options')
        .insert(optionRows)
        .select('estimate_line_id')
      if (e || !insOpts || insOpts.length !== optionRows.length) {
        throw new Error(e?.message || 'Could not copy the line options.')
      }
    }
  } catch (err) {
    // Best effort: children cascade off the project row. If even this fails,
    // the thrown error below still tells the operator the copy is bad.
    await supabase.from('projects').delete().eq('id', newProjectId)
    throw err
  }

  return newProjectId
}

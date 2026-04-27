// ============================================================================
// lib/reparse.ts — re-parse orchestration helpers
// ============================================================================
// Glue between the project page re-parse button and the parsing
// pipeline. Three responsibilities:
//
//   1. loadCurrentScope(projectId) — read estimate_lines + their
//      subprojects so the diff helper can compare against today's
//      state.
//   2. runReparse(project, paths) — fetch each stored PDF from the
//      parse-drawings bucket, re-run parsePdfFile on each, merge the
//      results.
//   3. applyReparseDiff(...) — apply the operator's accepted changes
//      and append the run to intake_context.reparse_history.
// ============================================================================

import { supabase } from './supabase'
import { mergeParsedPdfs, parsePdfFile, type ParsedPdf, type ParsedScopeItem } from './pdf-parser'
import type { CurrentScopeLine, ReparseDiff } from './reparse-diff'
import { recomputeProjectBidTotal } from './project-totals'

const PARSE_BUCKET = 'parse-drawings'

interface ProjectIntake {
  source_pdf_paths?: string[]
  reparse_history?: any[]
  [key: string]: any
}

/** Read estimate_lines on every subproject in the project, joining
 *  subproject name as the room. Returned in a flat array suited for
 *  the diff helper. */
export async function loadCurrentScope(
  projectId: string,
): Promise<CurrentScopeLine[]> {
  const { data: subs, error: subErr } = await supabase
    .from('subprojects')
    .select('id, name')
    .eq('project_id', projectId)
  if (subErr || !subs) {
    throw new Error(subErr?.message || 'Failed to load subprojects')
  }
  if (subs.length === 0) return []
  const subById = new Map(subs.map((s: any) => [s.id as string, s.name as string]))
  const subIds = subs.map((s: any) => s.id as string)
  const { data: lines, error: lineErr } = await supabase
    .from('estimate_lines')
    .select('id, subproject_id, description, quantity, unit, item_type, finish_specs')
    .in('subproject_id', subIds)
  if (lineErr || !lines) {
    throw new Error(lineErr?.message || 'Failed to load estimate_lines')
  }
  return (lines as any[]).map((r) => ({
    lineId: r.id as string,
    subprojectId: r.subproject_id as string,
    room: subById.get(r.subproject_id as string) || '',
    description: r.description || '',
    quantity: r.quantity == null ? null : Number(r.quantity),
    unit: r.unit ?? null,
    item_type: r.item_type ?? null,
    finishSpecs: r.finish_specs ?? null,
  }))
}

/** Download a PDF from the parse-drawings bucket and reconstitute it
 *  as a File so parsePdfFile can ingest it through the same path it
 *  uses for browser uploads. The filename is best-effort recovered
 *  from the storage path's tail segment (drops the random key
 *  prefix added at upload time). */
async function downloadStoredPdf(path: string): Promise<File> {
  const { data, error } = await supabase.storage.from(PARSE_BUCKET).download(path)
  if (error || !data) {
    throw new Error(`Failed to fetch ${path}: ${error?.message || 'no data'}`)
  }
  const tail = path.split('/').pop() || 'reparse.pdf'
  // Upload added a random-key prefix like `${randomKey()}-${safeName}`.
  // Strip the prefix when present so the file name matches what the
  // operator saw at upload time.
  const cleaned = tail.replace(/^[a-z0-9]{6,}-/i, '')
  return new File([data], cleaned, { type: 'application/pdf' })
}

/** Pull the stored PDFs, run the parser on each, merge the results.
 *  Throws when none of the paths resolve (operator should fall back
 *  to manual editing). Pass through orgId so the parser can re-upload
 *  to a fresh storage object — the re-parse run gets its OWN keep-pdf
 *  retention so the project's source_pdf_paths can be appended. */
export async function runReparse(input: {
  orgId: string
  paths: string[]
}): Promise<{
  parsed: ParsedPdf
  failures: { file: string; error: string }[]
}> {
  if (!input.paths || input.paths.length === 0) {
    throw new Error('No stored PDFs to re-parse')
  }
  const failures: { file: string; error: string }[] = []
  const successes: ParsedPdf[] = []
  for (const path of input.paths) {
    try {
      const file = await downloadStoredPdf(path)
      const r = await parsePdfFile(file, input.orgId, { keepPdf: false })
      if (r.parseSucceeded) successes.push(r)
      else failures.push({ file: file.name, error: r.apiError || 'parse failed' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'fetch failed'
      failures.push({ file: path, error: msg })
    }
  }
  if (successes.length === 0) {
    throw new Error(
      failures.length > 0
        ? `All ${failures.length} re-parse attempts failed`
        : 'No re-parse results',
    )
  }
  return { parsed: mergeParsedPdfs(successes), failures }
}

interface ApplyDecisions {
  acceptedNewIndexes: Set<number>
  acceptedChangedIds: Set<string>
  acceptedRemovedIds: Set<string>
}

/** Apply the operator's accepted changes from the diff modal, then
 *  recompute the project bid total and append the run to
 *  intake_context.reparse_history. Returns the count of changes
 *  actually applied so the toast can echo it. */
export async function applyReparseDiff(input: {
  projectId: string
  orgId: string
  diff: ReparseDiff
  decisions: ApplyDecisions
  parsedSourceFileNames: string[]
}): Promise<{ applied: number }> {
  const { projectId, orgId, diff, decisions } = input
  let applied = 0

  // 1. Removed items — delete the matching estimate_lines.
  const removedIds = diff.removedItems
    .filter((r) => decisions.acceptedRemovedIds.has(r.currentLineId))
    .map((r) => r.currentLineId)
  if (removedIds.length > 0) {
    const { error } = await supabase
      .from('estimate_lines')
      .delete()
      .in('id', removedIds)
    if (error) console.warn('reparse delete', error)
    else applied += removedIds.length
  }

  // 2. Changed items — patch the diffed fields only.
  for (const c of diff.changedItems) {
    if (!decisions.acceptedChangedIds.has(c.currentLineId)) continue
    const update: Record<string, any> = {}
    for (const f of c.fieldDiffs) {
      if (f.field === 'room') continue // room moves require subproject change — skip in V1
      if (f.field === 'description') update.description = f.to
      if (f.field === 'quantity') update.quantity = f.to
      if (f.field === 'unit') update.unit = f.to
      if (f.field === 'finish_specs') update.finish_specs = f.to
    }
    if (Object.keys(update).length === 0) continue
    const { error } = await supabase
      .from('estimate_lines')
      .update(update)
      .eq('id', c.currentLineId)
    if (error) console.warn('reparse update', error)
    else applied += 1
  }

  // 3. New items — insert into the matching subproject. Create a new
  // sub for any room not yet present.
  if (decisions.acceptedNewIndexes.size > 0) {
    const { data: subs } = await supabase
      .from('subprojects')
      .select('id, name')
      .eq('project_id', projectId)
    const subIdByRoom = new Map<string, string>()
    for (const s of (subs || []) as any[]) {
      subIdByRoom.set(String(s.name).trim().toLowerCase(), s.id as string)
    }

    const newItemRows: any[] = []
    for (let i = 0; i < diff.newItems.length; i++) {
      if (!decisions.acceptedNewIndexes.has(i)) continue
      const it = diff.newItems[i]
      const roomKey = (it.room || 'Other').trim().toLowerCase()
      let subId = subIdByRoom.get(roomKey)
      if (!subId) {
        const { data: created, error } = await supabase
          .from('subprojects')
          .insert({
            project_id: projectId,
            org_id: orgId,
            name: it.room || 'Other',
          })
          .select('id')
          .single()
        if (error || !created) {
          console.warn('reparse new sub', error)
          continue
        }
        subId = (created as any).id as string
        subIdByRoom.set(roomKey, subId)
      }
      const qty = it.linear_feet ?? it.quantity ?? 1
      const unit = it.linear_feet != null ? 'lf' : 'each'
      newItemRows.push({
        subproject_id: subId,
        description: it.name,
        quantity: qty,
        unit,
        item_type: it.item_type ?? null,
        finish_specs: it.finish_specs ?? null,
      })
    }
    if (newItemRows.length > 0) {
      const { error } = await supabase.from('estimate_lines').insert(newItemRows)
      if (error) console.warn('reparse insert', error)
      else applied += newItemRows.length
    }
  }

  // 4. Recompute the project bid total.
  await recomputeProjectBidTotal(projectId)

  // 5. Append the run to intake_context.reparse_history. Read-modify-
  // write the jsonb — small payload, fine for V1.
  const { data: projData } = await supabase
    .from('projects')
    .select('intake_context')
    .eq('id', projectId)
    .single()
  const intake = ((projData as any)?.intake_context as ProjectIntake) || {}
  const history = Array.isArray(intake.reparse_history) ? intake.reparse_history : []
  history.push({
    at: new Date().toISOString(),
    source_files: input.parsedSourceFileNames,
    summary: {
      new: diff.newItems.length,
      changed: diff.changedItems.length,
      removed: diff.removedItems.length,
      accepted_new: decisions.acceptedNewIndexes.size,
      accepted_changed: decisions.acceptedChangedIds.size,
      accepted_removed: decisions.acceptedRemovedIds.size,
    },
  })
  await supabase
    .from('projects')
    .update({
      intake_context: { ...intake, reparse_history: history },
    })
    .eq('id', projectId)

  return { applied }
}

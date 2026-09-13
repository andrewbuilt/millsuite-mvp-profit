// ============================================================================
// lib/bom.ts — the project's purchasing list.
// ============================================================================
// The MERGE RULE lives in lib/bom-merge (pure, verified). This file is the
// database half. ⛔ Don't reimplement merging here — the whole point of that
// module is that a re-parse has no way to express "overwrite" or "delete".
//
// ⛔ EVERY WRITE SELECTS THE ROW BACK AND THROWS ON ZERO ROWS. PostgREST
// reports an RLS-blocked UPDATE as `{ error: null }` with an empty body.
// ============================================================================

import { supabase } from '@/lib/supabase'
import {
  BOM_CATEGORY_LABEL,
  BOM_CATEGORY_ORDER,
  mergeParsedBom,
  type BomCategory,
  type BomRow,
  type ParsedBomItem,
} from '@/lib/bom-merge'

export type { BomRow, BomCategory, ParsedBomItem }

const COLUMNS =
  'id, category, name, spec, qty, parsed_qty, unit, source, checked_off, notes, created_at'

function isMissing(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  const code = e.code || ''
  if (code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205') return true
  return /does not exist|could not find the/i.test(e.message || '')
}

function toRow(r: Record<string, unknown>): BomRow {
  return {
    id: String(r.id),
    category: (r.category as BomCategory) ?? 'other',
    name: String(r.name ?? ''),
    spec: r.spec ? String(r.spec) : null,
    qty: Number(r.qty) || 0,
    // ⛔ NULL SURVIVES AS NULL. `Number(null)` is 0, and a 0 here would mean
    // "the parser says none of these" instead of "the parser has never had an
    // opinion about this row" — which is the difference between a flagged
    // disagreement and a hand-added item.
    parsedQty: r.parsed_qty === null || r.parsed_qty === undefined ? null : Number(r.parsed_qty),
    unit: String(r.unit ?? 'ea'),
    source: r.source === 'parsed' ? 'parsed' : 'manual',
    checkedOff: r.checked_off === true,
    notes: r.notes ? String(r.notes) : null,
  }
}

export interface BomLoad {
  rows: BomRow[]
  error: string | null
  /** Migration 103 hasn't run. */
  missing: boolean
}

export async function loadBom(projectId: string): Promise<BomLoad> {
  const { data, error } = await supabase
    .from('bom_items')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at')

  if (error) {
    if (isMissing(error)) return { rows: [], error: null, missing: true }
    console.error('loadBom', error)
    return { rows: [], error: error.message || 'Could not load the list.', missing: false }
  }
  return {
    rows: (data || []).map((r) => toRow(r as Record<string, unknown>)),
    error: null,
    missing: false,
  }
}

/**
 * Apply a parse to the saved list.
 *
 * ⛔ THE ONLY WRITES THIS MAKES ARE INSERTS AND `parsed_qty`. That is not a
 * convention, it's what `mergeParsedBom` can return — see its header. A human
 * edit to `qty`, `notes` or `checked_off` cannot be touched from here.
 *
 * Returns what happened so the UI can say it out loud: silently appending 30
 * rows to a list someone already checked would be alarming.
 */
export async function applyParsedBom(
  orgId: string,
  projectId: string,
  incoming: ParsedBomItem[],
): Promise<{ added: number; flagged: number; unchanged: number }> {
  // ⛔ RE-READ, NEVER TRUST THE CALLER'S COPY. This used to take the list the
  // UI was holding, and a parse takes up to five minutes (the route's
  // maxDuration) — during which someone can add a row in another tab, or in
  // this one. The merge would then see a row that already exists as new and
  // insert it a second time, which is precisely the duplication `bomKey`
  // exists to prevent. The database is the only copy that can't be stale.
  const fresh = await loadBom(projectId)
  if (fresh.missing) throw new Error('The purchasing list needs migration 103.')
  if (fresh.error) throw new Error(fresh.error)

  const plan = mergeParsedBom(fresh.rows, incoming)

  if (plan.inserts.length > 0) {
    const { error } = await supabase.from('bom_items').insert(
      plan.inserts.map((it) => ({
        org_id: orgId,
        project_id: projectId,
        category: it.category,
        name: it.name,
        spec: it.spec,
        // Both columns on a NEW row: there's no human number to protect yet,
        // so the parser's count is also the working count.
        qty: it.qty,
        parsed_qty: it.qty,
        unit: it.unit,
        source: 'parsed',
        notes: it.notes,
      })),
    )
    if (error) {
      if (isMissing(error)) throw new Error('The purchasing list needs migration 103.')
      throw new Error(error.message || 'Could not save the parsed items.')
    }
  }

  // One statement per flag. The counts are small (a flag only happens when
  // the drawings changed) and a bulk upsert here would need the full row,
  // which is exactly how `qty` would end up being written by accident.
  let flagged = 0
  for (const f of plan.flags) {
    const { data, error } = await supabase
      .from('bom_items')
      .update({ parsed_qty: f.parsedQty, updated_at: new Date().toISOString() })
      .eq('id', f.id)
      .select('id')
    if (error) throw new Error(error.message || 'Could not record a count change.')
    // ⛔ THIS FILE'S OWN RULE, WHICH THIS LOOP WAS BREAKING. A zero-row UPDATE
    // returns `{ error: null }`, so an RLS refusal or a row someone deleted
    // mid-parse counted as a success — and the UI then reported "3 counts
    // changed. Yours was kept." when nothing had been written. The flag is
    // the ONLY way "the drawings now say 14" reaches a human; a flag that
    // silently fails is the exact failure this design exists to prevent.
    if (data && data.length > 0) flagged += 1
  }

  return { added: plan.inserts.length, flagged, unchanged: plan.unchanged }
}

export async function addBomItem(
  orgId: string,
  projectId: string,
  input: { category: BomCategory; name: string; spec?: string | null; qty: number; unit: string },
): Promise<BomRow> {
  const name = input.name.trim()
  if (!name) throw new Error('That needs a name.')
  const { data, error } = await supabase
    .from('bom_items')
    .insert({
      org_id: orgId,
      project_id: projectId,
      category: input.category,
      name,
      spec: input.spec?.trim() || null,
      qty: Number(input.qty) || 0,
      // ⛔ NULL, not 0. The parser has no opinion about a row a human typed,
      // and a 0 here would render as "the parser says none of these".
      parsed_qty: null,
      unit: input.unit || 'ea',
      source: 'manual',
    })
    .select(COLUMNS)
    .single()
  if (error) {
    if (isMissing(error)) throw new Error('The purchasing list needs migration 103.')
    throw new Error(error.message || 'Could not add that.')
  }
  return toRow(data as Record<string, unknown>)
}

export async function updateBomItem(
  id: string,
  patch: Partial<{
    name: string
    spec: string | null
    qty: number
    unit: string
    checkedOff: boolean
    notes: string | null
    /** Accept the parser's count as the working number. The ONE place qty is
     *  set from parsed_qty, and a person has to click it. */
    acceptParsedQty: number
  }>,
): Promise<BomRow> {
  // ⛔ TWO WAYS TO SET ONE COLUMN. Both `qty` and `acceptParsedQty` write
  // `update.qty`, so passing both silently discarded one of two conflicting
  // numbers — on a list someone orders from. Refuse instead of picking.
  if (patch.qty !== undefined && patch.acceptParsedQty !== undefined) {
    throw new Error('Set a quantity or accept the parsed one, not both.')
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.spec !== undefined) update.spec = patch.spec?.trim() || null
  // Clamped: a negative count is never a real order, and the parser can emit
  // one even though the input strips the minus sign.
  if (patch.qty !== undefined) update.qty = Math.max(0, Number(patch.qty) || 0)
  if (patch.unit !== undefined) update.unit = patch.unit
  if (patch.checkedOff !== undefined) update.checked_off = patch.checkedOff
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  if (patch.acceptParsedQty !== undefined) {
    update.qty = Math.max(0, Number(patch.acceptParsedQty) || 0)
  }

  const { data, error } = await supabase
    .from('bom_items')
    .update(update)
    .eq('id', id)
    .select(COLUMNS)
  if (error) throw new Error(error.message || 'Could not save that.')
  // Zero rows is a refusal, not a success.
  if (!data || data.length === 0) {
    throw new Error(
      'That save did not reach the database. You may not have permission, or the session expired — reload and sign in again.',
    )
  }
  return toRow(data[0] as Record<string, unknown>)
}

export async function deleteBomItem(id: string): Promise<void> {
  // A PERSON deleting one row is fine; it's the PARSER that may never delete.
  const { data, error } = await supabase.from('bom_items').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message || 'Could not remove that.')
  if (!data || data.length === 0) {
    throw new Error('That delete did not reach the database. Reload and try again.')
  }
}

/**
 * Plain text for pasting into an email or a PO.
 *
 * ⚠️ THIS IS THE ARTEFACT THAT REACHES THE SUPPLIER, so it follows the same
 * order and the same words as the screen. It used to emit categories in
 * row-insertion order with raw keys ("SHEET GOOD"), so the pasted list could
 * be ordered differently from the one the person was just looking at.
 */
export function bomToText(rows: BomRow[], projectName: string): string {
  const lines = [`Purchasing list — ${projectName}`, '']
  for (const cat of BOM_CATEGORY_ORDER) {
    const list = rows.filter((r) => r.category === cat)
    if (list.length === 0) continue
    lines.push(BOM_CATEGORY_LABEL[cat].toUpperCase())
    for (const r of list) {
      lines.push(
        `  ${r.qty} ${r.unit}  ${r.name}${r.spec ? ` (${r.spec})` : ''}${r.checkedOff ? '  [checked]' : ''}`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

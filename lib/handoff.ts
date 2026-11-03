// ============================================================================
// lib/handoff.ts — the pre-production HANDOFF checklist (125, November item 3)
// ============================================================================
// Andrew, off the Luka project sheet: "a lot of time passes between the lead
// and the sale and things are missed." The pre-production page becomes the
// handoff document, and three facts now GATE production alongside approvals +
// the deposit:
//
//   · a point of contact — a name AND a way to reach them (phone or email).
//     A name alone isn't a contact; that's the one judgment call here.
//   · the jobsite address — `projects.delivery_address`, surfaced + editable
//   · the client's deadline — free text, because "ASAP" is a real answer
//
// Site-access notes are on the sheet but don't gate (plenty of jobs have none).
//
// ⛔ IMPORTED JOBS ARE NOT GATED. They came from Built mid-flight with none of
// this captured; gating them would strand every one of them in pre-production
// for paperwork that happened outside the app — the same reason
// forceStartProduction exists. Jobs already in production are never re-gated
// either: the gate only guards sold → production.
//
// `isReadyForProduction` (lib/project-stage) and the /projects kanban both ask
// `handoffMissing` — one rule, so the drag bounce, the What's-left rail and the
// Start button can't disagree.
// ============================================================================

import { supabase } from './supabase'

export interface HandoffFields {
  poc_name?: string | null
  poc_phone?: string | null
  poc_email?: string | null
  delivery_address?: string | null
  client_deadline?: string | null
  site_access_notes?: string | null
  imported_at?: string | null
}

/** Columns a caller must select for `handoffMissing` to answer honestly. */
export const HANDOFF_COLS =
  'poc_name, poc_phone, poc_email, delivery_address, client_deadline, site_access_notes, imported_at'

export type HandoffGap = 'contact' | 'address' | 'deadline'

export const HANDOFF_GAP_LABEL: Record<HandoffGap, string> = {
  contact: 'Point of contact',
  address: 'Jobsite address',
  deadline: 'Client deadline',
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0

/** What's still missing before this job may start production. Empty = clear.
 *  Imported jobs are never gated (see the header). */
export function handoffMissing(p: HandoffFields | null | undefined): HandoffGap[] {
  if (!p || p.imported_at) return []
  const out: HandoffGap[] = []
  if (!filled(p.poc_name) || !(filled(p.poc_phone) || filled(p.poc_email))) out.push('contact')
  if (!filled(p.delivery_address)) out.push('address')
  if (!filled(p.client_deadline)) out.push('deadline')
  return out
}

/** "the point of contact and the client deadline are missing" — for the
 *  kanban's bounce note. */
export function handoffMissingPhrase(gaps: HandoffGap[]): string {
  const words = gaps.map((g) => HANDOFF_GAP_LABEL[g].toLowerCase())
  if (words.length === 0) return ''
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `the ${list} ${words.length === 1 ? 'is' : 'are'} missing`
}

/**
 * The handoff gaps for one project, read on its own.
 *
 * ⚠️ A FAILED READ DOES NOT GATE. If the 125 columns aren't there yet the
 * select errors, and treating that as "everything missing" would freeze every
 * sold job in pre-production. Returns [] then; the approvals + deposit gates
 * still apply as before.
 */
export async function loadHandoffGaps(projectId: string): Promise<HandoffGap[]> {
  const { data, error } = await supabase.from('projects').select(HANDOFF_COLS).eq('id', projectId).maybeSingle()
  if (error) {
    console.warn('handoff read skipped (migration 125 not run?)', error.message)
    return []
  }
  return handoffMissing(data as HandoffFields | null)
}

export type HandoffField = Exclude<keyof HandoffFields, 'imported_at'>

/** Save one handoff field. Empty string → null. Throws on a refused write. */
export async function saveHandoffField(projectId: string, field: HandoffField, value: string): Promise<void> {
  const v = value.trim()
  const { data, error } = await supabase
    .from('projects')
    .update({ [field]: v.length ? v : null })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(/column/.test(error.message) ? 'Run migration 125 first.' : error.message)
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
}

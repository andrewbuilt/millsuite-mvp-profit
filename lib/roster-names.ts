// ============================================================================
// lib/roster-names.ts — login id → the person's name, from the shop ROSTER
// ============================================================================
// ⛔ Names live on `orgs.team_members` (the roster), bridged to a login by
// `user_id`. NOT `users` — a manager's session can't read other people's
// `users` rows, which is why the P&L time modal first shipped showing "…" for
// every name (2026-10-29). Same bridge /time uses (memberByUserId).
//
// Keeps INACTIVE people (unlike tasks.listAssignees): someone who left the
// shop still clocked the hours on an old job, and their entries need a name.
// ============================================================================

import { supabase } from './supabase'

export interface RosterName {
  /** The roster id — what /time?member= filters on. */
  memberId: string
  name: string
}

export async function loadRosterNamesByUserId(orgId: string): Promise<Record<string, RosterName>> {
  const { data, error } = await supabase.from('orgs').select('team_members').eq('id', orgId).maybeSingle()
  if (error) {
    console.error('loadRosterNamesByUserId', error)
    return {}
  }
  const raw = (data as { team_members?: unknown } | null)?.team_members
  const out: Record<string, RosterName> = {}
  for (const m of (Array.isArray(raw) ? raw : []) as Record<string, unknown>[]) {
    const userId = m?.user_id ? String(m.user_id) : ''
    const name = String(m?.name ?? '').trim()
    if (userId && name) out[userId] = { memberId: String(m.id ?? ''), name }
  }
  return out
}

// ============================================================================
// lib/team-comp.ts — compensation, stored apart from the employee record
// ============================================================================
// Salary used to live inside orgs.team_members alongside names, titles and
// departments. That coupling is what forced /team's roster to be owner-only
// (hiding salary meant hiding everything) and what made two pages edit the
// same blob. Migration 087 moves it to `team_compensation`, a table whose RLS
// policy admits the OWNER only — so a manager can't read salaries even with a
// direct query, which the old "strip it from the API response" approach never
// achieved.
//
// `annual_comp` stays a field on the in-memory TeamMember, populated from here
// for readers allowed to see it and 0 for everyone else, so every shop-rate
// calculation keeps working untouched.
//
// ROLLOUT: reads fall back to whatever is still in the blob, so this is
// correct before 087 runs, after it runs, and after 088 clears the blob.
// Writes only ever go to the table.
// ============================================================================

import { supabase } from './supabase'
import type { TeamMember } from './shop-rate-setup'

export type CompByMemberId = Record<string, number>

/**
 * Comp for one org, keyed by team_members[].id.
 *
 * Returns an EMPTY map when the caller isn't allowed to see it (manager) or
 * the table isn't there yet (pre-087) — both are "no figures available", and
 * callers merge with a 0 default. Never throws: a missing salary must not
 * break the roster.
 */
export async function loadTeamComp(
  orgId: string,
  client: typeof supabase = supabase,
): Promise<CompByMemberId> {
  const { data, error } = await client
    .from('team_compensation')
    .select('member_id, annual_comp')
    .eq('org_id', orgId)
  if (error || !data) return {}
  const out: CompByMemberId = {}
  for (const row of data as Array<{ member_id: string; annual_comp: number }>) {
    out[row.member_id] = Number(row.annual_comp) || 0
  }
  return out
}

/** Overlay comp onto a roster. Falls back to whatever the member already
 *  carries (the pre-087 blob value) when the table has no row for them. */
export function applyTeamComp(
  team: TeamMember[],
  comp: CompByMemberId,
): TeamMember[] {
  return team.map((m) => ({
    ...m,
    annual_comp: comp[m.id] ?? (Number(m.annual_comp) || 0),
  }))
}

/** Write one person's salary. Owner-only at the database level. */
export async function saveTeamComp(
  orgId: string,
  memberId: string,
  annualComp: number,
): Promise<void> {
  const { error } = await supabase
    .from('team_compensation')
    .upsert(
      {
        org_id: orgId,
        member_id: memberId,
        annual_comp: Number(annualComp) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,member_id' },
    )
  if (error) throw error
}

/** Drop a person's salary row — call when they're removed from the roster so
 *  a recycled id can't inherit an old figure. */
export async function deleteTeamComp(orgId: string, memberId: string): Promise<void> {
  const { error } = await supabase
    .from('team_compensation')
    .delete()
    .eq('org_id', orgId)
    .eq('member_id', memberId)
  if (error) throw error
}

/** Persist every changed salary in one pass, diffing against what was loaded
 *  so an untouched roster writes nothing. */
export async function saveChangedComp(
  orgId: string,
  base: TeamMember[],
  next: TeamMember[],
): Promise<void> {
  const baseById = new Map(base.map((m) => [m.id, Number(m.annual_comp) || 0]))
  const nextIds = new Set(next.map((m) => m.id))
  for (const m of next) {
    const before = baseById.get(m.id)
    const after = Number(m.annual_comp) || 0
    if (before === undefined || before !== after) {
      await saveTeamComp(orgId, m.id, after)
    }
  }
  // Removed members lose their figure too.
  for (const m of base) {
    if (!nextIds.has(m.id)) await deleteTeamComp(orgId, m.id)
  }
}

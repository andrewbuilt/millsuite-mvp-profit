// ============================================================================
// lib/team-merge.ts — three-way merge for orgs.team_members
// ============================================================================
// THE BUG THIS EXISTS FOR
//
// `orgs.team_members` is one jsonb column holding the whole roster, and TWO
// pages edit it: /team (names, titles, contact, hours, dept assignments) and
// /settings (compensation, add/remove). Both autosave by writing the ENTIRE
// array from the copy they loaded.
//
// So any page instance holding an older copy silently reverts everything
// changed since it loaded. Observed live: a title went "sdff" → "New test
// title" → back to "sdff", with no error, because a stale writer put its whole
// array down on top. Every earlier fix aimed at the save path — flush on
// unmount, controlled inputs, waiting for in-flight writes — was treating
// symptoms of this.
//
// THE FIX
//
// Don't replace; merge. A page knows three things: what it loaded (base), what
// it has now (next), and what the server holds at write time (current). That's
// a classic three-way merge, and it lets each page write only what its user
// actually touched:
//
//   • field changed by me (next ≠ base)  → mine wins
//   • field I never touched              → server's wins, even if it moved
//   • member I added   (in next, not base) → appended
//   • member I removed (in base, not next) → removed
//   • member someone else added          → kept
//
// Pure and dependency-free so it can be tested directly — see the run at the
// bottom of scripts/verify-team-merge.mjs.
// ============================================================================

import type { TeamMember } from './shop-rate-setup'

/** Fields a page can own. Anything not listed is copied from the server. */
const MERGEABLE_FIELDS = [
  'name',
  'annual_comp',
  'billable',
  'dept_assignments',
  'user_id',
  'email',
  'phone',
  'title',
  'start_date',
  'hours_per_week',
  'active',
] as const

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  // undefined and null both mean "not set" for these optional fields.
  if (a == null && b == null) return true
  return a === b
}

/**
 * Three-way merge of one org's roster.
 *
 * @param base    the roster this page loaded (its baseline)
 * @param next    the roster this page holds now (what the user edited into it)
 * @param current the roster on the server right now
 */
export function mergeTeam(
  base: TeamMember[],
  next: TeamMember[],
  current: TeamMember[],
): TeamMember[] {
  const baseById = new Map(base.map((m) => [m.id, m]))
  const nextById = new Map(next.map((m) => [m.id, m]))
  const currentById = new Map(current.map((m) => [m.id, m]))

  // Members this page deleted: present when it loaded, gone now.
  const deleted = new Set([...baseById.keys()].filter((id) => !nextById.has(id)))

  const out: TeamMember[] = []

  // Server order first, so members added by anyone else keep their place.
  for (const server of current) {
    if (deleted.has(server.id)) continue
    const mine = nextById.get(server.id)
    if (!mine) {
      out.push(server) // untouched by this page
      continue
    }
    const wasLoadedAs = baseById.get(server.id)
    if (!wasLoadedAs) {
      // This page has it but never loaded it — it created it. Its version wins.
      out.push(mine)
      continue
    }
    const merged: TeamMember = { ...server }
    for (const field of MERGEABLE_FIELDS) {
      // Only fields this page actually changed override the server's.
      if (!sameValue(mine[field], wasLoadedAs[field])) {
        ;(merged as unknown as Record<string, unknown>)[field] = mine[field]
      }
    }
    out.push(merged)
  }

  // Members this page added, in its own order.
  for (const mine of next) {
    if (!currentById.has(mine.id)) out.push(mine)
  }

  return out
}

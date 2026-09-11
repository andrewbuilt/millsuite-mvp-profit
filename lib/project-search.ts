// ============================================================================
// lib/project-search.ts — "find the job" typed into a box
// ============================================================================
// The projects dashboard and the sales kanban both let you search the same
// thing: a project by its name or its client's name. One predicate, because
// two surfaces that answer "is this a match?" differently is precisely how a
// shop ends up saying "it finds it on one page but not the other".
//
// Both fields are denormalized onto the project row (`name`, `client_name`),
// so this needs no lookup and works on any shape carrying those two.
//
// Substring, case-insensitive, matched against name and client TOGETHER so
// "smith kitchen" finds the Smith job called Kitchen. That does mean the query
// is matched across the join, which is the behaviour people expect from a
// single search box.
// ============================================================================

/** The minimum shape this can search — anything with a name and a client. */
export interface SearchableProject {
  name?: string | null
  client_name?: string | null
}

/** Normalise once, outside the loop, so a 200-project filter doesn't lowercase
 *  the query 200 times. Returns '' when there's nothing to search for. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * True when the project matches the (already normalised) query.
 * An empty query matches everything — "no filter", not "no results".
 */
export function matchesProjectSearch(p: SearchableProject, q: string): boolean {
  if (!q) return true
  return `${p.name || ''} ${p.client_name || ''}`.toLowerCase().includes(q)
}

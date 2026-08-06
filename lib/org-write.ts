// ============================================================================
// lib/org-write.ts — the one way to write to `orgs` from the browser.
// ============================================================================
// PostgREST returns `{ error: null }` for an UPDATE that matched zero rows, so
// a write blocked by RLS (or aimed at an org the session can't touch) is
// indistinguishable from success. Every org write in the app goes through
// `updateOrgChecked`, which asks for the row back and throws when nothing came
// — that's what turns "my settings vanished" into a visible error.
// ============================================================================

import { supabase } from './supabase'

// ── Read-after-write guard ──────────────────────────────────────────────────
// Autosaved pages flush on the way out, but that write is fire-and-forget:
// React has unmounted, so nothing can await it. Land on a page that reads the
// same row and the GET races the UPDATE — the server answers with the PREVIOUS
// values and the edit looks lost, even though it commits a moment later.
// (/team and /settings both write orgs.team_members, so they race each other
// as well as themselves.)
//
// Module scope outlives unmount, so every write parks itself here and any
// reader can wait for a quiet moment first. Cheap, and it makes the race
// impossible rather than unlikely.
let inFlight = new Set<Promise<unknown>>()

/** Wait for any org write already in progress. Never throws — a failed write
 *  is the writer's problem to surface; the reader just wants a settled row. */
export async function awaitPendingOrgWrites(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight])
  }
}

export async function updateOrgChecked(
  orgId: string,
  update: Record<string, unknown>,
): Promise<void> {
  const write = (async () => {
    const { data, error } = await supabase
      .from('orgs')
      .update(update)
      .eq('id', orgId)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error(
        'The save did not reach the database (no row updated). You may not have permission to change this org, or the session expired — reload and sign in again.',
      )
    }
  })()
  inFlight.add(write)
  // Detach the bookkeeping from the returned promise so an unhandled rejection
  // here can't surface twice — the caller still gets the real one.
  void write.catch(() => {}).finally(() => inFlight.delete(write))
  return write
}

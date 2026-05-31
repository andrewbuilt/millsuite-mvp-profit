// lib/phase-client.ts
// Client-side fire-and-forget triggers for the per-project background
// routes hit after a time entry: recompute financial actuals (/rollup)
// and auto-advance sold→production (/advance-phase).
//
// Both routes gate on the caller's session (M5), so each request carries
// the Supabase access token. These are best-effort side effects of
// logging time, so errors are swallowed rather than surfaced.

import { supabase } from './supabase'

async function postProjectRoute(projectId: string, path: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch(`/api/projects/${projectId}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* best-effort: ignore */
  }
}

/** Recompute projects.bid_total + actual_total from current inputs.
 *  Replaces the old POST to /api/projects/[id], which hit a route that
 *  doesn't exist (404) — so actuals silently never refreshed (M6). */
export function triggerProjectRollup(projectId: string): Promise<void> {
  return postProjectRoute(projectId, 'rollup')
}

export function triggerPhaseAdvance(projectId: string): Promise<void> {
  return postProjectRoute(projectId, 'advance-phase')
}

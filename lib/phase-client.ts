// lib/phase-client.ts
// Client-side trigger for POST /api/projects/[id]/advance-phase.
//
// The route gates on the caller's session (M5), so the request has to
// carry the Supabase access token. This is fire-and-forget — auto-
// advancing sold→production is a best-effort side effect of logging
// time, so errors are swallowed rather than surfaced.

import { supabase } from './supabase'

export async function triggerPhaseAdvance(projectId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch(`/api/projects/${projectId}/advance-phase`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    /* best-effort: ignore */
  }
}

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

export async function updateOrgChecked(
  orgId: string,
  update: Record<string, unknown>,
): Promise<void> {
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
}

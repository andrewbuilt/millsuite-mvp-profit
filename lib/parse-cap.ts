// ============================================================================
// lib/parse-cap.ts — daily parse-call usage helpers
// ============================================================================
// Reads orgs.daily_parse_cap + counts today's parse_call_log rows so the
// /api/parse-drawings cap check + the sales drop-zone counter share the
// same source of truth. Failed calls don't count toward the cap;
// success + rate_limited do.
// ============================================================================

import { supabase } from './supabase'

export interface ParseUsage {
  used: number
  cap: number
  /** YYYY-MM-DD — same date the API route compares against. */
  date: string
}

const DEFAULT_CAP = 50

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Read today's parse usage for an org. Used by the sales dashboard
 *  drop-zone counter. Returns the safe default cap when the row is
 *  missing rather than throwing — pre-migration orgs see 50. */
export async function loadParseUsage(orgId: string): Promise<ParseUsage> {
  const date = todayIso()
  const [usageRes, orgRes] = await Promise.all([
    supabase
      .from('parse_call_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('call_date', date)
      .in('status', ['success', 'rate_limited']),
    supabase.from('orgs').select('daily_parse_cap').eq('id', orgId).single(),
  ])
  return {
    used: usageRes.count ?? 0,
    cap: Number((orgRes.data as any)?.daily_parse_cap) || DEFAULT_CAP,
    date,
  }
}

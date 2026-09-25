// ============================================================================
// lib/lead-sources.ts — where jobs come from (migration 116)
// ============================================================================
// `orgs.lead_sources` is a REGISTRY OF NAMES for the picker — the task-tags
// pattern exactly: `projects.lead_source` stores the NAME, so renaming a
// registry entry does not rewrite the projects already carrying the old one
// (they keep it; the per-source report simply shows both spellings). The
// registry exists so the picker offers a consistent list and the advertising
// scoreboard doesn't fracture into "FB" / "facebook" / "Facebook ads".
// ============================================================================

import { supabase } from './supabase'
import { updateOrgChecked } from './org-write'

export async function loadLeadSources(orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('orgs')
    .select('lead_sources')
    .eq('id', orgId)
    .maybeSingle()
  // Pre-116 (42703) or any failure → empty list; the picker still allows
  // typing a new source, so capture never blocks on the registry.
  if (error) return []
  const raw = (data as { lead_sources?: unknown } | null)?.lead_sources
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    if (typeof r !== 'string') continue
    const name = r.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

/** Add a name to the registry if it's new (case-insensitive). Returns the
 *  canonical list. `orgs` writes go through updateOrgChecked — a zero-row
 *  org update reports success. */
export async function addLeadSource(orgId: string, name: string): Promise<string[]> {
  const clean = name.trim().slice(0, 60)
  if (!clean) return loadLeadSources(orgId)
  const existing = await loadLeadSources(orgId)
  if (existing.some((s) => s.toLowerCase() === clean.toLowerCase())) return existing
  const next = [...existing, clean]
  await updateOrgChecked(orgId, { lead_sources: next })
  return next
}

/** Stamp (or clear) a project's lead source. Zero rows = failure, the house
 *  rule — an RLS refusal must not read as saved. */
export async function setProjectLeadSource(
  projectId: string,
  source: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .update({ lead_source: source?.trim() || null })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(error.message || 'Could not save the lead source.')
  if (!data || data.length === 0) throw new Error('Could not save the lead source.')
}

/** The optional reason typed at the lost-drag prompt. Capture must never
 *  block the drag — callers fire this AFTER the stage write succeeds. */
export async function setProjectLostReason(
  projectId: string,
  reason: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .update({ lost_reason: reason?.trim().slice(0, 300) || null })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(error.message || 'Could not save the reason.')
  if (!data || data.length === 0) throw new Error('Could not save the reason.')
}

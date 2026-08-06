// ============================================================================
// lib/org-public.ts — shop branding for the two PRE-LOGIN pages.
// ============================================================================
// `/{slug}` (the vanity shop login) and `/join/{slug}` both render a shop's
// name and logo before anyone has signed in. They used to select straight from
// `orgs`, which only worked because that table had no row-level security —
// the same hole that made every shop's payroll public (migration 083).
//
// After 083 the anon key can't read `orgs` at all, so branding comes from
// `org_public_by_slug()`, a SECURITY DEFINER function that returns exactly
// name / slug / logo_url for one slug and nothing else.
//
// The direct-select fallback exists ONLY to survive the deploy window: the app
// and the migration land at different moments, and whichever goes first, these
// two pages have to keep working. Once 083 is applied the fallback is dead
// code — and it fails closed anyway, because by then the select returns
// nothing. Safe to delete on the next pass through this file.
// ============================================================================

import { supabase } from './supabase'

export interface PublicOrg {
  name: string
  logo_url: string | null
}

export async function loadPublicOrgBySlug(slug: string): Promise<PublicOrg | null> {
  const { data, error } = await supabase.rpc('org_public_by_slug', { p_slug: slug })
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as PublicOrg | undefined
    return row ?? null
  }

  // Pre-083 database: the function doesn't exist yet.
  const { data: legacy } = await supabase
    .from('orgs')
    .select('name, logo_url')
    .eq('slug', slug)
    .maybeSingle()
  return (legacy as PublicOrg | null) ?? null
}

// ============================================================================
// lib/portal-admin.ts — the SHOP's side of the client portal
// ============================================================================
// Browser-side helpers for the internal project/client pages: read the photo
// feed, flip the Finishing phase, and fetch a client's portal link.
//
// Split of responsibilities, deliberately:
//   • reads + the finishing flag go direct through RLS (both tables have a
//     FOR ALL own-org policy from 083, so an authenticated shop user is
//     entitled to them);
//   • minting a portal token and uploading a photo go through SERVER routes on
//     the service role. The token is a bearer credential and the shop-photos
//     bucket has no storage RLS policy — same shape as org-logos.
//
// Nothing here is imported by the portal itself; the portal reads through
// lib/client-portal on the service role. Keep it that way.
// ============================================================================

import { supabase } from './supabase'

export interface ProjectPhoto {
  id: string
  project_id: string
  storage_path: string
  url: string
  caption: string | null
  taken_on: string
  created_at: string
}

const BUCKET = 'shop-photos'

function publicUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** The project's shop photos, newest first — the same order the client sees. */
export async function loadProjectPhotos(projectId: string): Promise<ProjectPhoto[]> {
  const { data, error } = await supabase
    .from('project_photos')
    .select('id, project_id, storage_path, caption, taken_on, created_at')
    .eq('project_id', projectId)
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) {
    // Pre-092 databases have no table. Degrade to "no photos" rather than
    // taking the whole project page down.
    console.error('loadProjectPhotos', error)
    return []
  }
  return ((data as Omit<ProjectPhoto, 'url'>[] | null) || []).map((r) => ({ ...r, url: publicUrl(r.storage_path) }))
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

/** Upload one shop photo. Goes through the server route so the service role
 *  owns the bucket write and the row insert together. */
export async function uploadProjectPhoto(
  projectId: string,
  file: File,
  caption: string,
  takenOn?: string,
): Promise<ProjectPhoto | null> {
  const form = new FormData()
  form.append('file', file)
  form.append('caption', caption)
  if (takenOn) form.append('takenOn', takenOn)

  const res = await fetch(`/api/projects/${projectId}/photos`, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  })
  if (!res.ok) {
    console.error('uploadProjectPhoto', res.status, await res.text().catch(() => ''))
    return null
  }
  const body = (await res.json()) as { photo: Omit<ProjectPhoto, 'url'> }
  return { ...body.photo, url: publicUrl(body.photo.storage_path) }
}

export async function deleteProjectPhoto(projectId: string, photoId: string): Promise<boolean> {
  const res = await fetch(`/api/projects/${projectId}/photos?photoId=${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  return res.ok
}

/** The client's portal link. Mints a token on first call; pass regenerate to
 *  burn the old one (which instantly kills every link already sent). */
export async function getPortalLink(
  clientId: string,
  regenerate = false,
): Promise<{ url: string; issuedAt: string | null } | null> {
  const res = await fetch('/api/portal-admin/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ clientId, regenerate }),
  })
  if (!res.ok) {
    console.error('getPortalLink', res.status)
    return null
  }
  return (await res.json()) as { url: string; issuedAt: string | null }
}

/**
 * The Finishing phase toggle. There is no `finishing` stage in the enum —
 * projects go 'production' → 'installed' — so the client-facing phase 5 is
 * driven by this timestamp alone (Andrew's call, 2026-08-31: a manual toggle
 * rather than deriving it from schedule allocations, which can be wrong and
 * can't be corrected).
 *
 * ⛔ DISPLAY ONLY. It gates nothing: not production, not scheduling, not
 * invoicing. `stage` stays the single source of truth for the app. If you find
 * yourself reading finishing_at anywhere outside the portal, that's the bug.
 */
export async function setProjectFinishing(projectId: string, on: boolean, orgId?: string): Promise<boolean> {
  let q = supabase
    .from('projects')
    .update({ finishing_at: on ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  if (orgId) q = q.eq('org_id', orgId)
  // Select the id back: a zero-row update returns { error: null } through
  // PostgREST, so "no error" alone does not mean it saved.
  const { data, error } = await q.select('id')
  if (error) {
    console.error('setProjectFinishing', error)
    return false
  }
  return !!data && data.length > 0
}

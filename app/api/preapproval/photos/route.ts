// ============================================================================
// /api/preapproval/photos — the SHOP's finish-photo uploader (slot editor)
// ============================================================================
// GET ?itemId=       → the item's photos, as short-lived signed URLs
// POST (multipart)   → upload one photo to an approval item
// DELETE ?photoId=   → remove one
//
// Bearer-authenticated; the item is re-proved against the caller's org through
// its subproject on every call. The `approval-photos` bucket is PRIVATE with
// no storage policy (migration 135), so even the shop's own reads come through
// here as signed URLs — same bucket and same rows the client's portal shows.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { APPROVAL_PHOTO_BUCKET, signedPhotosForItem, storeApprovalPhoto } from '@/lib/preapproval-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** The item's project, only if it belongs to the caller's org. */
async function ownedItem(itemId: string, orgId: string): Promise<{ itemId: string; projectId: string } | null> {
  if (!itemId) return null
  const { data: item } = await supabaseAdmin
    .from('approval_items')
    .select('id, subproject_id')
    .eq('id', itemId)
    .maybeSingle()
  const subId = (item as { subproject_id: string } | null)?.subproject_id
  if (!subId) return null
  const { data: sub } = await supabaseAdmin.from('subprojects').select('project_id').eq('id', subId).maybeSingle()
  const projectId = (sub as { project_id: string } | null)?.project_id
  if (!projectId) return null
  const { data: proj } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (proj as { id: string } | null)?.id ? { itemId, projectId } : null
}

/** The caller's roster name — what `added_by` shows the shop. (The client's
 *  portal says the SHOP's name for these, never a teammate's.) */
async function callerName(orgId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data: org } = await supabaseAdmin.from('orgs').select('team_members').eq('id', orgId).maybeSingle()
  const roster = (org as { team_members?: unknown } | null)?.team_members
  const hit = (Array.isArray(roster) ? roster : []).find((m: any) => m?.user_id === userId)
  if (hit?.name) return String(hit.name)
  const { data: user } = await supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle()
  return (user as { name?: string } | null)?.name || null
}

export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const owned = await ownedItem(req.nextUrl.searchParams.get('itemId') || '', caller.orgId)
  if (!owned) return notFound()
  return NextResponse.json({ photos: await signedPhotosForItem(owned.itemId) })
}

export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const owned = await ownedItem(String(form.get('itemId') || ''), caller.orgId)
  if (!owned) return notFound()
  const r = await storeApprovalPhoto({
    orgId: caller.orgId,
    projectId: owned.projectId,
    itemId: owned.itemId,
    file,
    addedBy: await callerName(caller.orgId, caller.userId),
    fromClient: false,
    caption: String(form.get('caption') || ''),
  })
  if (r.status !== 200) return NextResponse.json(r.body, { status: r.status })
  return NextResponse.json({ photos: await signedPhotosForItem(owned.itemId) })
}

export async function DELETE(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const photoId = req.nextUrl.searchParams.get('photoId') || ''
  if (!photoId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  // Scoped by org on the row itself, so another shop's photo id is a 404.
  const { data: row } = await supabaseAdmin
    .from('approval_item_photos')
    .select('id, storage_path, approval_item_id')
    .eq('id', photoId)
    .eq('org_id', caller.orgId)
    .maybeSingle()
  const photo = row as { id: string; storage_path: string; approval_item_id: string } | null
  if (!photo) return notFound()
  const { error } = await supabaseAdmin.from('approval_item_photos').delete().eq('id', photo.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabaseAdmin.storage.from(APPROVAL_PHOTO_BUCKET).remove([photo.storage_path])
  return NextResponse.json({ photos: await signedPhotosForItem(photo.approval_item_id) })
}

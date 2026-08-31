// ============================================================================
// /api/projects/{id}/photos — the shop's "From the shop" uploads
// ============================================================================
// POST (multipart) uploads one image and inserts its row; DELETE removes both.
// Bearer-authenticated, and the project is re-checked against the caller's org
// on every call.
//
// This runs on the service role because the shop-photos bucket has no storage
// RLS policy (same shape as org-logos, migration 070): the bucket is public to
// READ so the portal can render an <img> straight at it, and every WRITE comes
// through here.
//
// The bucket also enforces a 10 MB cap and an image-only mime list, so a bad
// upload fails at storage rather than becoming a row pointing at nothing — but
// the row is only inserted AFTER the upload succeeds, so the two can't diverge.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'shop-photos'
const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif'])

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/** The project, only if it belongs to the caller's org. */
async function ownedProject(projectId: string, orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle()
  return !!(data as { id: string } | null)?.id
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  if (!(await ownedProject(projectId, caller.orgId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `That file type isn't supported (${file.type || 'unknown'})` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That photo is over 10 MB' }, { status: 400 })
  }

  const caption = String(form.get('caption') || '').trim().slice(0, 200) || null
  const rawDate = String(form.get('takenOn') || '').trim()
  // Date-only, and never in the future — a mistyped year would sort the whole
  // client-facing feed wrong.
  const today = new Date().toISOString().slice(0, 10)
  const takenOn = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today

  const path = `${caller.orgId}/${projectId}/${randomUUID()}.${EXT[file.type] || 'jpg'}`
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message || 'Upload failed' }, { status: 500 })

  const { data, error } = await supabaseAdmin
    .from('project_photos')
    .insert({ org_id: caller.orgId, project_id: projectId, storage_path: path, caption, taken_on: takenOn })
    .select('id, project_id, storage_path, caption, taken_on, created_at')
    .single()

  if (error) {
    // Don't leave an orphan object in the bucket that nothing points at.
    await supabaseAdmin.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ photo: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()

  const photoId = req.nextUrl.searchParams.get('photoId') || ''
  if (!photoId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // Scoped by org AND project, so a photo id from another job can't be deleted
  // through this project's URL.
  const { data: row } = await supabaseAdmin
    .from('project_photos')
    .select('id, storage_path')
    .eq('id', photoId)
    .eq('project_id', projectId)
    .eq('org_id', caller.orgId)
    .maybeSingle()
  const photo = row as { id: string; storage_path: string } | null
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('project_photos').delete().eq('id', photoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Row first, then the object: a leftover object is invisible, a leftover row
  // renders as a broken image on a client-facing page.
  await supabaseAdmin.storage.from(BUCKET).remove([photo.storage_path])

  return NextResponse.json({ ok: true })
}

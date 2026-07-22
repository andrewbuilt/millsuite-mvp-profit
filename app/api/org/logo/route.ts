import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs' // existing public bucket; logos live under logos/

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

// Upload (or replace) the org's logo. Multipart form with a `file` field.
// Service-role upload to the public bucket → stamp orgs.logo_url with the
// public URL. Cache-busted by a per-upload timestamp in the path.
export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }
  const type = file.type || ''
  const ext = EXT[type]
  if (!ext) {
    return NextResponse.json(
      { error: 'Unsupported image type. Use PNG, JPG, WEBP, GIF, or SVG.' },
      { status: 400 },
    )
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Logo must be under 2 MB.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `logos/${caller.orgId}/${Date.now()}.${ext}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: type, upsert: true })
  if (upErr) {
    return NextResponse.json({ error: upErr.message || 'Upload failed.' }, { status: 502 })
  }
  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)

  const { error: updErr } = await supabaseAdmin
    .from('orgs')
    .update({ logo_url: publicUrl })
    .eq('id', caller.orgId)
  if (updErr) {
    return NextResponse.json({ error: updErr.message || 'Failed to save logo.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, logo_url: publicUrl })
}

// Remove the org's logo (clears the column; the old file is left in storage).
export async function DELETE(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  const { error } = await supabaseAdmin
    .from('orgs')
    .update({ logo_url: null })
    .eq('id', caller.orgId)
  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to remove logo.' }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}

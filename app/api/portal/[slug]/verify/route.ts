// POST /api/portal/[slug]/verify
// Verifies a client portal password and returns a short-lived JWT.
// The portal page stores this JWT in a httpOnly cookie for subsequent actions.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPassword, createPortalToken } from '@/lib/portal'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> | { slug: string } }
) {
  try {
    const resolved = await Promise.resolve(params)
    const slug = resolved.slug
    const { password } = await req.json()

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    const { data: project, error } = await supabaseAdmin
      .from('projects')
      .select('id, portal_password_hash')
      .eq('portal_slug', slug)
      .single()

    if (error || !project || !project.portal_password_hash) {
      return NextResponse.json({ error: 'Portal not found' }, { status: 404 })
    }

    const ok = await verifyPassword(password, project.portal_password_hash)
    if (!ok) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    const token = await createPortalToken(project.id, slug)

    const res = NextResponse.json({ ok: true })
    res.cookies.set(`portal_${slug}`, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })
    return res
  } catch (err: any) {
    console.error('Portal verify error:', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}

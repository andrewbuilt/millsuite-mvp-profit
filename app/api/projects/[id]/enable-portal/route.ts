// POST /api/projects/[id]/enable-portal
// Creates a client portal for a project that doesn't already have one.
// Returns the slug + one-time plaintext password for the shop to show the client.
// Idempotent failure if portal already exists (use regenerate-password to reset).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setupPortal } from '@/lib/portal'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params)
    const projectId = resolved.id
    if (!projectId) {
      return NextResponse.json({ error: 'Project id required' }, { status: 400 })
    }

    // Look up current state — don't clobber an existing portal
    const { data: project, error: fetchErr } = await supabaseAdmin
      .from('projects')
      .select('id, name, portal_slug')
      .eq('id', projectId)
      .single()

    if (fetchErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.portal_slug) {
      return NextResponse.json(
        { error: 'Portal already enabled', slug: project.portal_slug },
        { status: 409 }
      )
    }

    const result = await setupPortal(projectId, project.name || 'project')
    if (!result) {
      return NextResponse.json({ error: 'Failed to create portal' }, { status: 500 })
    }

    return NextResponse.json({ slug: result.slug, password: result.password })
  } catch (err: any) {
    console.error('enable-portal error:', err)
    return NextResponse.json(
      { error: err?.message || 'Enable portal failed' },
      { status: 500 }
    )
  }
}

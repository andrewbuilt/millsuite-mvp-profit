// POST /api/projects/[id]/reset-portal-password
// Generates a new one-time password for an existing portal. Used when the
// client loses their password or the shop wants to rotate access.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generatePortalPassword, hashPassword, firePortalCreatedEvent } from '@/lib/portal'

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

    const { data: project, error: fetchErr } = await supabaseAdmin
      .from('projects')
      .select('id, portal_slug')
      .eq('id', projectId)
      .single()

    if (fetchErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    if (!project.portal_slug) {
      return NextResponse.json(
        { error: 'Portal not enabled' },
        { status: 400 }
      )
    }

    const password = generatePortalPassword()
    const passwordHash = await hashPassword(password)

    const { error: updateErr } = await supabaseAdmin
      .from('projects')
      .update({ portal_password_hash: passwordHash })
      .eq('id', projectId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Log the reset so the timeline reflects the password rotation
    await supabaseAdmin.from('portal_timeline').insert({
      project_id: projectId,
      event_type: 'portal_password_reset',
      event_label: 'Portal password reset',
      event_detail: 'Shop generated a new access password',
      actor_type: 'shop',
      triggered_by: 'shop',
    })

    // Re-fire "Portal Created" so the homeowner gets a fresh email with the
    // new password. Same event — the Klaviyo flow doesn't distinguish first
    // send from a re-send; every fire is self-contained.
    await firePortalCreatedEvent(projectId, password)

    return NextResponse.json({ password })
  } catch (err: any) {
    console.error('reset-portal-password error:', err)
    return NextResponse.json(
      { error: err?.message || 'Reset failed' },
      { status: 500 }
    )
  }
}

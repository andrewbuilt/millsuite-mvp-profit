// POST /api/portal/[slug]/signoff
// Client sign-off action. Writes client_signed_off_at/by on a selection or
// drawing revision, and logs an entry to portal_timeline. Requires valid JWT
// cookie (portal_<slug>).

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPortalToken } from '@/lib/portal'
import { checkAndAdvanceProductionPhase } from '@/lib/leads'

export const dynamic = 'force-dynamic'

interface SignoffBody {
  kind: 'selection' | 'drawing'
  id: string
  signerName: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> | { slug: string } }
) {
  try {
    const resolved = await Promise.resolve(params)
    const slug = resolved.slug

    // Verify auth cookie
    const token = req.cookies.get(`portal_${slug}`)?.value
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const claims = await verifyPortalToken(token)
    if (!claims || claims.slug !== slug) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const body = (await req.json()) as SignoffBody
    if (!body.id || !body.kind || !body.signerName?.trim()) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const signer = body.signerName.trim()

    if (body.kind === 'selection') {
      const { data: sel, error } = await supabaseAdmin
        .from('selections')
        .update({
          client_signed_off_at: now,
          client_signed_off_by: signer,
          // Auto-flip to confirmed when the client signs off
          status: 'confirmed',
          confirmed_date: now,
          confirmed_by: signer,
          updated_at: now,
        })
        .eq('id', body.id)
        .eq('project_id', claims.sub)
        .select('id, label, category')
        .single()

      if (error || !sel) {
        return NextResponse.json({ error: 'Selection not found' }, { status: 404 })
      }

      // Log to selection_history
      await supabaseAdmin.from('selection_history').insert({
        selection_id: sel.id,
        action: 'confirmed',
        new_status: 'confirmed',
        source: 'client_approval',
        changed_by: signer,
        changed_by_name: signer,
      })

      // Log to portal_timeline
      await supabaseAdmin.from('portal_timeline').insert({
        project_id: claims.sub,
        event_type: 'selection_signoff',
        event_label: 'Selection Approved',
        event_detail: `${signer} approved: ${sel.label}`,
        actor_type: 'client',
        triggered_by: signer,
      })

      // If this was the last outstanding selection, mirror the shop-side flag
      // and attempt to advance production_phase.
      await syncSelectionsConfirmedAndAdvance(claims.sub)

      return NextResponse.json({ ok: true })
    }

    if (body.kind === 'drawing') {
      const { data: dr, error } = await supabaseAdmin
        .from('drawing_revisions')
        .update({
          client_signed_off_at: now,
          client_signed_off_by: signer,
          status: 'approved',
        })
        .eq('id', body.id)
        .eq('project_id', claims.sub)
        .select('id, revision_number')
        .single()

      if (error || !dr) {
        return NextResponse.json({ error: 'Drawing not found' }, { status: 404 })
      }

      await supabaseAdmin.from('portal_timeline').insert({
        project_id: claims.sub,
        event_type: 'drawing_signoff',
        event_label: 'Drawing Approved',
        event_detail: `${signer} approved revision ${dr.revision_number}`,
        actor_type: 'client',
        triggered_by: signer,
      })

      await syncSelectionsConfirmedAndAdvance(claims.sub)

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })
  } catch (err: any) {
    console.error('Portal signoff error:', err)
    return NextResponse.json({ error: err?.message || 'Signoff failed' }, { status: 500 })
  }
}

// ── Helper: mirror the shop-side selections_confirmed flag and nudge the
// production_phase engine. Swallows errors — the signoff itself already
// succeeded before we get here.
async function syncSelectionsConfirmedAndAdvance(projectId: string) {
  try {
    const { data: sels } = await supabaseAdmin
      .from('selections')
      .select('status')
      .eq('project_id', projectId)
      .neq('status', 'voided')

    const active = sels || []
    const allConfirmed = active.length > 0 && active.every(s => s.status === 'confirmed')

    await supabaseAdmin
      .from('projects')
      .update({
        selections_confirmed: allConfirmed,
        selections_confirmed_date: allConfirmed ? new Date().toISOString() : null,
      })
      .eq('id', projectId)

    if (allConfirmed) {
      await checkAndAdvanceProductionPhase(projectId)
    }
  } catch (err) {
    console.error('syncSelectionsConfirmedAndAdvance error:', err)
  }
}

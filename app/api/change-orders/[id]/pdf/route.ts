// ============================================================================
// /api/change-orders/[id]/pdf — render, cache, return URL for a CO PDF.
// ============================================================================
// Renders ChangeOrderPdf server-side and caches it in the invoice-pdfs bucket
// at ${org_id}/change-orders/${coId}.pdf. Auth: Bearer → caller org must own
// the CO's project.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChangeOrderPdf } from '@/components/changeorders/ChangeOrderPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs'

async function authResolveOrg(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null
  const { data: row } = await supabaseAdmin.from('users').select('org_id').eq('auth_user_id', data.user.id).single()
  return row?.org_id ?? null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing CO id' }, { status: 400 })
  const callerOrgId = await authResolveOrg(req)
  if (!callerOrgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: co } = await supabaseAdmin.from('change_orders').select('*').eq('id', id).single()
  if (!co) return NextResponse.json({ error: 'Change order not found' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, org_id, client_id, client_name')
    .eq('id', (co as any).project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if ((project as any).org_id !== callerOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [orgRes, cliRes] = await Promise.all([
    supabaseAdmin
      .from('orgs')
      .select('name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email')
      .eq('id', callerOrgId)
      .single(),
    (project as any).client_id
      ? supabaseAdmin.from('clients').select('name, address, email, phone').eq('id', (project as any).client_id).single()
      : Promise.resolve({ data: null, error: null }),
  ])
  const org = (orgRes.data as any) || { name: 'Your Company' }
  const client = cliRes.data
    ? {
        name: (cliRes.data as any).name,
        address: (cliRes.data as any).address ?? null,
        email: (cliRes.data as any).email ?? null,
        phone: (cliRes.data as any).phone ?? null,
      }
    : (project as any).client_name
      ? { name: (project as any).client_name, address: null, email: null, phone: null }
      : null

  // Custom-mode materials are stashed in proposed_line.notes as JSON.
  let materials: { desc: string; qty: number; unit_cost: number; vendor?: boolean }[] | undefined
  const notes = (co as any).proposed_line?.notes
  if (typeof notes === 'string') {
    try {
      const parsed = JSON.parse(notes)
      if (Array.isArray(parsed?.materials)) materials = parsed.materials
    } catch {
      /* not JSON — spec-mode CO */
    }
  }

  // Subproject name → the CO heading (the spec change shows in the chips
  // below, so the title needn't repeat it).
  let subprojectName: string | null = null
  if ((co as any).subproject_id) {
    const { data: sub } = await supabaseAdmin
      .from('subprojects')
      .select('name')
      .eq('id', (co as any).subproject_id)
      .single()
    subprojectName = (sub as { name?: string } | null)?.name ?? null
  }

  const coNumber = `CO-${String((co as any).co_number ?? 0).padStart(2, '0')}`
  const element = React.createElement(ChangeOrderPdf, {
    coNumber,
    coDate: new Date().toISOString().slice(0, 10),
    org,
    project: { name: (project as any).name },
    client,
    subprojectName,
    title: (co as any).title || 'Change order',
    originalLabel: (co as any).original_line_snapshot?.material || (co as any).original_line_snapshot?.label || null,
    proposedLabel: (co as any).proposed_line?.material || null,
    materials,
    clientPrice: Number((co as any).client_price) || 0,
    noCharge: !!(co as any).no_price_change,
    drawingRevisionRequired: !!(co as any).drawing_revision_required,
  })
  const buffer: Buffer = await renderToBuffer(element as any)

  const path = `${callerOrgId}/change-orders/${id}.pdf`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message || 'Storage upload failed' }, { status: 500 })

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: `${publicUrl}?v=${Date.now()}` })
}

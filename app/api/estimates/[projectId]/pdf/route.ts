// ============================================================================
// /api/estimates/[projectId]/pdf — generate, cache, return URL
// ============================================================================
// Renders the project's estimate with @react-pdf/renderer and caches it in the
// invoice-pdfs Storage bucket at ${org_id}/estimates/${projectId}.pdf.
//
// The client sends the SAME computed line data it shows on screen (lineItems +
// schedule + totals + terms) so the PDF total reconciles exactly with the
// on-screen estimate. The server owns identity/branding (org), numbering
// (estimate_number, reserved once), client lookup, and storage.
//
// Auth: Bearer <jwt> → resolve caller org → must match the project's org.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { EstimatePdf } from '@/components/estimates/EstimatePdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs'

async function authResolveOrg(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null
  const { data: row } = await supabaseAdmin
    .from('users')
    .select('org_id')
    .eq('auth_user_id', data.user.id)
    .single()
  return row?.org_id ?? null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  if (!projectId) return NextResponse.json({ error: 'Missing project id' }, { status: 400 })

  const callerOrgId = await authResolveOrg(req)
  if (!callerOrgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.lineItems)) {
    return NextResponse.json({ error: 'lineItems required' }, { status: 400 })
  }

  const { data: project, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('id, name, org_id, client_id, client_name, estimate_number')
    .eq('id', projectId)
    .single()
  if (projErr || !project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if ((project as any).org_id !== callerOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [orgRes, cliRes] = await Promise.all([
    supabaseAdmin
      .from('orgs')
      .select(
        'name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email, estimate_prefix, next_estimate_number, estimate_footer_text, estimate_closing_note',
      )
      .eq('id', callerOrgId)
      .single(),
    (project as any).client_id
      ? supabaseAdmin
          .from('clients')
          .select('name, address, email, phone')
          .eq('id', (project as any).client_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])
  const org = (orgRes.data as any) || { name: 'Your Company' }

  // Reserve the estimate number once (first download); reuse thereafter.
  let estimateNumber: string = (project as any).estimate_number || ''
  if (!estimateNumber) {
    const seq = Number(org.next_estimate_number) || 1
    const prefix = org.estimate_prefix || 'EST-'
    estimateNumber = `${prefix}${String(seq).padStart(4, '0')}`
    await supabaseAdmin
      .from('orgs')
      .update({ next_estimate_number: seq + 1 })
      .eq('id', callerOrgId)
  }

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

  const estimateDate = new Date().toISOString().slice(0, 10)
  const totals = body.totals || { subtotal: 0, taxPct: 0, taxAmount: 0, total: 0 }
  const terms = body.terms ?? org.estimate_footer_text ?? null
  // Org-level only — no request override. The sign-off is the shop's standing
  // copy, not something a caller should be able to swap per estimate.
  const closingNote = (org as { estimate_closing_note?: string | null }).estimate_closing_note ?? null
  const schedule = Array.isArray(body.schedule) ? body.schedule : []

  const element = React.createElement(EstimatePdf, {
    estimateNumber,
    estimateDate,
    validUntil: body.validUntil ?? null,
    org,
    project: { name: (project as any).name },
    client,
    lines: body.lineItems,
    schedule,
    totals,
    terms,
    closingNote,
  })
  const buffer: Buffer = await renderToBuffer(element as any)

  const path = `${callerOrgId}/estimates/${projectId}.pdf`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    console.error('estimate pdf upload', upErr)
    return NextResponse.json({ error: upErr.message || 'Storage upload failed' }, { status: 500 })
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`

  await supabaseAdmin
    .from('projects')
    .update({
      // NB: estimate_sent_at is NOT set here — rendering/downloading the PDF no
      // longer marks the estimate "sent". Only the explicit "Mark as sent"
      // action on the project page stamps it (an estimate is "open" once sent).
      estimate_pdf_url: cacheBustedUrl,
      estimate_number: estimateNumber,
      estimate_snapshot_json: { estimateNumber, estimateDate, lineItems: body.lineItems, schedule, totals, terms },
    })
    .eq('id', projectId)

  return NextResponse.json({ url: cacheBustedUrl, estimateNumber })
}

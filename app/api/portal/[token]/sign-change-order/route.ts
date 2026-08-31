// ============================================================================
// POST /api/portal/{token}/sign-change-order — client write #2
// ============================================================================
// The client types their name to sign a change order. Records the signature and
// renders a countersigned PDF into the client's documents.
//
// ⛔ THIS DOES NOT FLIP THE CO TO `approved`, AND THAT IS ON PURPOSE.
// In the app, `approveCo()` flips the state and then runs `applyApprovedCo()`,
// which rewrites the estimate line, reopens/settles the linked approval slot
// and recomputes the project's bid total. That whole chain runs on the BROWSER
// supabase client, so it cannot execute in a route handler — RLS refuses it,
// and PostgREST reports the refusal as a zero-row success. Re-implementing a
// hundred-odd lines of money-moving logic on the service role, on a public
// endpoint, to be exercised for the first time by a real client, is not a trade
// worth making.
//
// So the split is: THE PORTAL RECORDS CONSENT, THE APP APPLIES THE MONEY. The
// CO stays in `sent_to_client` carrying signed_name/signed_at, the shop sees
// "Client signed …" on the change order, and clicks the existing Approve
// button, which runs the one and only financial path, unchanged. One code path
// touches the contract total, and it is the one that has always touched it.
//
// The client-facing copy never claims otherwise: the portal says a countersigned
// copy is in their documents, and says nothing about schedules or totals.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authorizePortalProject } from '@/lib/client-portal'
import { ChangeOrderPdf } from '@/components/changeorders/ChangeOrderPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const body = (await req.json().catch(() => null)) as
    | { projectId?: string; changeOrderId?: string; name?: string }
    | null
  const projectId = String(body?.projectId || '')
  const changeOrderId = String(body?.changeOrderId || '')
  const name = String(body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 120)

  if (!projectId || !changeOrderId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  // Re-checked server-side; the disabled button in the UI is a courtesy only.
  if (name.length < 3) return NextResponse.json({ error: 'Please type your full name' }, { status: 400 })

  const auth = await authorizePortalProject(token, projectId)
  if (!auth) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const orgId = auth.identity.orgId

  const { data: coRow } = await supabaseAdmin
    .from('change_orders')
    .select(
      'id, project_id, subproject_id, co_number, title, state, client_price, no_price_change, drawing_revision_required, original_line_snapshot, proposed_line, signed_name, signed_at, signed_pdf_url',
    )
    .eq('id', changeOrderId)
    .eq('project_id', projectId)
    .maybeSingle()
  const co = coRow as Record<string, any> | null
  if (!co) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Idempotent: a retry returns the existing signature rather than overwriting
  // it with a new timestamp (or a different name).
  if (co.signed_at && co.signed_name) {
    return NextResponse.json({ ok: true, signedName: co.signed_name, signedAt: co.signed_at, alreadySigned: true })
  }
  // Only a CO actually sitting with the client is signable. Drafts are the shop
  // thinking out loud; rejected/void ones are settled.
  if (co.state !== 'sent_to_client') {
    return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 409 })
  }

  const now = new Date().toISOString()
  // Best-effort client IP for the signature record. Behind Vercel this is the
  // real client address; locally it's absent, which is fine — the column is
  // evidence, not a gate.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || null

  const { data: signedRows, error: signErr } = await supabaseAdmin
    .from('change_orders')
    .update({ signed_name: name, signed_at: now, signed_ip: ip, updated_at: now })
    .eq('id', changeOrderId)
    // Re-assert the state in the WHERE clause so two concurrent submissions
    // can't both win.
    .eq('state', 'sent_to_client')
    .is('signed_at', null)
    .select('id')
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 })
  if (!signedRows || signedRows.length === 0) {
    return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 409 })
  }

  // ── Countersigned PDF ─────────────────────────────────────────────────────
  // Everything past this point is best-effort: the signature is already
  // recorded, and failing to render a PDF must not tell the client their
  // signature didn't take.
  try {
    const [projRes, orgRes] = await Promise.all([
      supabaseAdmin.from('projects').select('name, client_id, client_name').eq('id', projectId).single(),
      supabaseAdmin
        .from('orgs')
        .select(
          'name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email',
        )
        .eq('id', orgId)
        .single(),
    ])
    const project = projRes.data as Record<string, any> | null
    const org = { name: 'Your Company', ...((orgRes.data as Record<string, any>) || {}) } as {
      name: string
    } & Record<string, any>

    const { data: cliRow } = project?.client_id
      ? await supabaseAdmin.from('clients').select('name, address, email, phone').eq('id', project.client_id).single()
      : { data: null }
    const client = cliRow
      ? {
          name: (cliRow as any).name,
          address: (cliRow as any).address ?? null,
          email: (cliRow as any).email ?? null,
          phone: (cliRow as any).phone ?? null,
        }
      : project?.client_name
        ? { name: project.client_name, address: null, email: null, phone: null }
        : null

    let subprojectName: string | null = null
    if (co.subproject_id) {
      const { data: sub } = await supabaseAdmin.from('subprojects').select('name').eq('id', co.subproject_id).single()
      subprojectName = (sub as { name?: string } | null)?.name ?? null
    }

    // Custom-mode CO materials live in proposed_line.notes as JSON — same
    // read as the in-app PDF route, so both copies show identical lines.
    let materials: { desc: string; qty: number; unit_cost: number; vendor?: boolean }[] | undefined
    if (typeof co.proposed_line?.notes === 'string') {
      try {
        const parsed = JSON.parse(co.proposed_line.notes)
        if (Array.isArray(parsed?.materials)) materials = parsed.materials
      } catch {
        /* spec-mode CO: notes is prose */
      }
    }

    const buffer: Buffer = await renderToBuffer(
      React.createElement(ChangeOrderPdf, {
        coNumber: `CO-${String(co.co_number ?? 0).padStart(2, '0')}`,
        coDate: now.slice(0, 10),
        org,
        project: project ? { name: project.name } : null,
        client,
        subprojectName,
        title: co.title || 'Change order',
        originalLabel: co.original_line_snapshot?.material || co.original_line_snapshot?.label || null,
        proposedLabel: co.proposed_line?.material || null,
        materials,
        clientPrice: Number(co.client_price) || 0,
        noCharge: !!co.no_price_change,
        drawingRevisionRequired: !!co.drawing_revision_required,
        signature: { name, at: now },
      }) as any,
    )

    // Distinct path from the unsigned copy so the blank-signature PDF the shop
    // may already have sent is not overwritten.
    const path = `${orgId}/change-orders/${changeOrderId}-signed.pdf`
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
    if (!upErr) {
      const {
        data: { publicUrl },
      } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
      await supabaseAdmin.from('change_orders').update({ signed_pdf_url: publicUrl }).eq('id', changeOrderId)
    } else {
      console.error('sign-change-order: storage upload', upErr)
    }
  } catch (err) {
    console.error('sign-change-order: countersigned PDF failed (signature IS recorded)', err)
  }

  return NextResponse.json({ ok: true, signedName: name, signedAt: now })
}

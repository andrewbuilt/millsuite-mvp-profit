// ============================================================================
// POST /api/portal/{token}/sign-co-doc — the client signs a v2 change order
// ============================================================================
// ⛔ THIS DOES NOT ACCEPT THE DOCUMENT, AND THAT IS THE WHOLE DESIGN.
//
// The spec says acceptance can come from "an in-app mark OR the portal
// signature". Taken literally that would mean this public endpoint applies the
// money: `acceptDoc` materialises subprojects, deletes and rewrites estimate
// lines, recomputes `bid_total`, raises an invoice and writes a draw row.
//
// It cannot run here, and re-implementing it would be worse than not having it:
//
//   1. `lib/co-docs` runs on the BROWSER supabase client. In a route handler
//      RLS refuses every write — and PostgREST reports a refusal as a ZERO-ROW
//      SUCCESS, so a half-applied acceptance would return `ok`.
//   2. Acceptance is not a transaction. A partial failure mid-way through a
//      public endpoint, triggered by a client tapping a button on their phone,
//      leaves scope materialised and the doc unlocked.
//   3. It would put the one code path that moves the contract total behind an
//      unauthenticated URL, to be exercised for the first time by a real
//      client.
//
// So the split is v1's, for v1's reasons: THE PORTAL RECORDS CONSENT, THE APP
// APPLIES THE MONEY. The doc stays OPEN carrying signed_name/signed_at, the
// shop sees "Client signed …" on the panel and clicks Accept, which runs the
// one and only financial path, unchanged and already tested.
//
// The client-facing copy never claims otherwise: it says a countersigned copy
// is in their documents, and says nothing about totals or schedules.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authorizePortalProject } from '@/lib/client-portal'
import { CoDocPdf, type CoDocPdfItem } from '@/components/changeorders/CoDocPdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const body = (await req.json().catch(() => null)) as
    | { projectId?: string; docId?: string; name?: string }
    | null
  const projectId = String(body?.projectId || '')
  const docId = String(body?.docId || '')
  const name = String(body?.name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)

  if (!projectId || !docId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  // Re-checked server-side; the disabled button is a courtesy only.
  if (name.length < 3) {
    return NextResponse.json({ error: 'Please type your full name' }, { status: 400 })
  }

  const auth = await authorizePortalProject(token, projectId)
  if (!auth) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const orgId = auth.identity.orgId

  const { data: docRow } = await supabaseAdmin
    .from('co_docs')
    .select('id, project_id, org_id, number, title, status, sent_at, signed_name, signed_at, accepted_at')
    .eq('id', docId)
    .eq('project_id', projectId)
    .maybeSingle()
  const doc = docRow as Record<string, any> | null
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Idempotent: a retry returns the existing signature rather than overwriting
  // it with a new timestamp, or a different name.
  if (doc.signed_at && doc.signed_name) {
    return NextResponse.json({
      ok: true,
      signedName: doc.signed_name,
      signedAt: doc.signed_at,
      alreadySigned: true,
    })
  }
  // ⛔ ONLY A SENT, STILL-OPEN DOC IS SIGNABLE. An unsent one is the shop
  // composing; an accepted or voided one is settled.
  if (!doc.sent_at || doc.status !== 'open') {
    return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    null

  const { data: signedRows, error: signErr } = await supabaseAdmin
    .from('co_docs')
    .update({ signed_name: name, signed_at: now, signed_ip: ip, updated_at: now })
    .eq('id', docId)
    // Re-assert the state in the WHERE clause so two concurrent submissions
    // can't both win.
    .eq('status', 'open')
    .is('signed_at', null)
    .select('id')
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 })
  if (!signedRows || signedRows.length === 0) {
    return NextResponse.json({ error: 'This change order is not open for signing' }, { status: 409 })
  }

  // ── Countersigned PDF ─────────────────────────────────────────────────────
  // Everything past this point is best-effort: the signature IS recorded, and
  // failing to render a PDF must not tell the client their signature didn't
  // take.
  try {
    const [projRes, orgRes, itemsRes] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('name, client_id, client_name, bid_total')
        .eq('id', projectId)
        .single(),
      supabaseAdmin
        .from('orgs')
        .select(
          'name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email',
        )
        .eq('id', orgId)
        .single(),
      supabaseAdmin
        .from('co_doc_items')
        .select('kind, description, draft, delta_amount, subproject_id, sort_order')
        .eq('doc_id', docId)
        .order('sort_order', { ascending: true }),
    ])

    const project = projRes.data as Record<string, any> | null
    const org = { name: 'Your Company', ...((orgRes.data as Record<string, any>) || {}) } as {
      name: string
    } & Record<string, any>

    const { data: cliRow } = project?.client_id
      ? await supabaseAdmin
          .from('clients')
          .select('name, address, email, phone')
          .eq('id', project.client_id)
          .single()
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

    const rows = (itemsRes.data as any[]) || []
    const subIds = rows.map((r) => r.subproject_id).filter(Boolean)
    const subNames = new Map<string, string>()
    if (subIds.length > 0) {
      const { data: subs } = await supabaseAdmin
        .from('subprojects')
        .select('id, name')
        .in('id', subIds)
      for (const s of (subs || []) as any[]) subNames.set(s.id, s.name)
    }

    const items: CoDocPdfItem[] = rows.map((r) => ({
      kind: r.kind,
      headline:
        r.kind === 'add_sub'
          ? r.draft?.name || 'New scope'
          : subNames.get(r.subproject_id) || 'Scope',
      description: r.description || null,
      delta: Number(r.delta_amount) || 0,
      lines: Array.isArray(r.draft?.lines)
        ? r.draft.lines.map((l: any) => ({
            description: l?.row?.description || '',
            quantity: Number(l?.row?.quantity) || 0,
            unit: l?.row?.unit ?? null,
          }))
        : undefined,
    }))
    const netChange = items.reduce((s, i) => s + i.delta, 0)

    const buffer: Buffer = await renderToBuffer(
      React.createElement(CoDocPdf, {
        coNumber: `CO-${String(doc.number ?? 0).padStart(2, '0')}`,
        coDate: now.slice(0, 10),
        org,
        project: project ? { name: project.name } : null,
        client,
        title: doc.title ?? null,
        items,
        // ⚠️ The doc is NOT accepted yet (see the header), so `bid_total` is
        // still the pre-change contract — no backing-out needed here.
        contractBefore: Number(project?.bid_total) || null,
        netChange,
        signature: { name, at: now },
      }) as any,
    )

    // ⛔ A DISTINCT PATH FROM THE UNSIGNED COPY. Writing over it would destroy
    // the blank-signature PDF the shop may already have emailed — v1 learned
    // this, and 110 gives the doc its own `signed_pdf_url` for the same reason.
    const path = `${orgId}/co-docs/${docId}-signed.pdf`
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
    if (!upErr) {
      const {
        data: { publicUrl },
      } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
      await supabaseAdmin.from('co_docs').update({ signed_pdf_url: publicUrl }).eq('id', docId)
    } else {
      console.error('sign-co-doc: storage upload', upErr)
    }
  } catch (err) {
    console.error('sign-co-doc: countersigned PDF failed (signature IS recorded)', err)
  }

  return NextResponse.json({ ok: true, signedName: name, signedAt: now })
}

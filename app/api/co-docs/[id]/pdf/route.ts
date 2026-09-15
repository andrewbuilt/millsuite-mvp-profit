// ============================================================================
// /api/co-docs/[id]/pdf — render a change order DOCUMENT (v2, migration 107)
// ============================================================================
// Mirrors /api/change-orders/[id]/pdf: Bearer auth, caller's org must own the
// project, render server-side, cache in the invoice-pdfs bucket.
//
// ⛔ THE ONE RULE THAT DIFFERS, AND IT IS THE IMPORTANT ONE:
//
//     AN ACCEPTED DOC'S PDF IS IMMUTABLE.
//
// 107 calls `pdf_url` "an immutable snapshot taken at acceptance", and the v1
// route cannot honour that — it re-renders on every request and `upsert`s over
// the same path. For a v1 CO that's survivable because the CO's own fields are
// frozen. For a v2 doc it is NOT: the items carry `delta_amount` values priced
// against a rate book that keeps moving, an accepted doc's drafts have already
// been materialised into real subprojects, and re-rendering would quietly
// replace the document the client signed with a new one at the same URL.
//
// So: if the doc is accepted and already has a `pdf_url`, that URL is returned
// untouched. Only an OPEN doc re-renders — which is what you want while it's
// still being negotiated.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CoDocPdf, type CoDocPdfItem } from '@/components/changeorders/CoDocPdf'

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing doc id' }, { status: 400 })
  const callerOrgId = await authResolveOrg(req)
  if (!callerOrgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: doc } = await supabaseAdmin.from('co_docs').select('*').eq('id', id).single()
  if (!doc) return NextResponse.json({ error: 'Change order not found' }, { status: 404 })
  // ⛔ ORG CHECK ON THE DOC ITSELF, not only on its project. This route runs as
  // the service role, which bypasses RLS entirely — the check IS the security.
  if ((doc as any).org_id !== callerOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── The immutability rule (see the header) ──
  if ((doc as any).status === 'accepted' && (doc as any).pdf_url) {
    return NextResponse.json({ url: (doc as any).pdf_url, immutable: true })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, org_id, client_id, client_name, bid_total')
    .eq('id', (doc as any).project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if ((project as any).org_id !== callerOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [orgRes, cliRes, itemsRes] = await Promise.all([
    supabaseAdmin
      .from('orgs')
      .select(
        'name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email',
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
    supabaseAdmin
      .from('co_doc_items')
      .select('*')
      .eq('doc_id', id)
      .order('sort_order', { ascending: true }),
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

  const rows = (itemsRes.data || []) as any[]
  if (rows.length === 0) {
    // A PDF of an empty change order is a signature page for nothing.
    return NextResponse.json({ error: 'This change order has nothing in it yet.' }, { status: 400 })
  }

  // Removals name the subproject they remove; the draft payload has no name
  // for them because the name lives on the real row.
  const subIds = rows.map((r) => r.subproject_id).filter(Boolean)
  const subNames = new Map<string, string>()
  if (subIds.length > 0) {
    const { data: subs } = await supabaseAdmin
      .from('subprojects')
      .select('id, name')
      .in('id', subIds)
    for (const s of (subs || []) as any[]) subNames.set(s.id, s.name)
  }

  // ⛔ A REVISION HAS TO SAY WHAT WAS REMOVED, not just what was added. The
  // client is being credited for those lines; showing only the new ones makes
  // the credit look like an unexplained discount. So the removed lines are
  // read back by id and listed with the rest.
  const removedIds = rows.flatMap((r) =>
    r.kind === 'edit_sub'
      ? [
          ...((r.draft?.removeLineIds as string[]) || []),
          ...(((r.draft?.reviseLines as any[]) || []).map((x) => x?.lineId).filter(Boolean)),
        ]
      : [],
  )
  const removedLines = new Map<string, { description: string; quantity: number; unit: string | null }>()
  if (removedIds.length > 0) {
    const { data: els } = await supabaseAdmin
      .from('estimate_lines')
      .select('id, description, quantity, unit')
      .in('id', removedIds)
    for (const l of (els || []) as any[]) {
      removedLines.set(l.id, {
        description: l.description || '',
        quantity: Number(l.quantity) || 0,
        unit: l.unit ?? null,
      })
    }
  }

  const items: CoDocPdfItem[] = rows.map((r) => {
    const draft = r.draft || {}
    const headline =
      r.kind === 'add_sub'
        ? draft.name || 'New scope'
        : subNames.get(r.subproject_id) || 'Scope'

    const asLine = (l: any) => ({
      description: l?.row?.description || '',
      quantity: Number(l?.row?.quantity) || 0,
      unit: l?.row?.unit ?? null,
    })

    let lines: CoDocPdfItem['lines']
    if (r.kind === 'add_sub' && Array.isArray(draft.lines)) {
      lines = draft.lines.map(asLine)
    } else if (r.kind === 'edit_sub') {
      const removed = [
        ...((draft.removeLineIds as string[]) || []),
        ...(((draft.reviseLines as any[]) || []).map((x) => x?.lineId).filter(Boolean)),
      ]
        .map((id) => removedLines.get(id))
        .filter(Boolean)
        .map((l) => ({ ...l!, description: `Removed: ${l!.description}` }))
      const added = [
        ...((draft.addLines as any[]) || []),
        ...(((draft.reviseLines as any[]) || []).map((x) => x?.line).filter(Boolean)),
      ]
        .map(asLine)
        .map((l) => ({ ...l, description: `Added: ${l.description}` }))
      lines = [...removed, ...added]
    }

    return {
      kind: r.kind,
      headline,
      description: r.description || null,
      delta: Number(r.delta_amount) || 0,
      lines,
    }
  })

  const netChange = items.reduce((s, i) => s + i.delta, 0)

  // ⚠️ `bid_total` is the contract AFTER acceptance (the drafts are already
  // materialised by then), so the "before" figure has to be backed out rather
  // than read. On an open doc it IS the before figure, untouched.
  const storedTotal = Number((project as any).bid_total) || 0
  const contractBefore =
    (doc as any).status === 'accepted' ? storedTotal - netChange : storedTotal

  const coNumber = `CO-${String((doc as any).number ?? 0).padStart(2, '0')}`
  const element = React.createElement(CoDocPdf, {
    coNumber,
    // An accepted doc is dated when it was accepted, not when someone happened
    // to re-open the PDF.
    coDate: ((doc as any).accepted_at || new Date().toISOString()).slice(0, 10),
    org,
    project: { name: (project as any).name },
    client,
    title: (doc as any).title ?? null,
    items,
    contractBefore,
    netChange,
    signature: (doc as any).signed_name
      ? { name: (doc as any).signed_name, at: (doc as any).signed_at || (doc as any).accepted_at }
      : null,
  })
  const buffer: Buffer = await renderToBuffer(element as any)

  const path = `${callerOrgId}/co-docs/${id}.pdf`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    return NextResponse.json({ error: upErr.message || 'Storage upload failed' }, { status: 500 })
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)

  // ⛔ STAMP `pdf_url` ONLY ONCE THE DOC IS ACCEPTED. Writing it while the doc
  // is still open would make the FIRST preview the permanent record, freezing
  // a document that is still being negotiated.
  if ((doc as any).status === 'accepted') {
    await supabaseAdmin.from('co_docs').update({ pdf_url: publicUrl }).eq('id', id)
  }

  return NextResponse.json({ url: `${publicUrl}?v=${Date.now()}` })
}

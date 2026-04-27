// ============================================================================
// /api/invoices/[id]/pdf — generate, cache, return URL
// ============================================================================
// Renders the invoice with @react-pdf/renderer's renderToBuffer, uploads
// to the invoice-pdfs Supabase Storage bucket at
// ${org_id}/${invoice_id}.pdf, persists the public URL on
// client_invoices.pdf_url, and returns the URL.
//
// Idempotent — every call regenerates and overwrites. PDFs are small
// and the caching cost (re-render + re-upload) is < 500 ms.
//
// Auth: the client passes its Supabase access token in the Authorization
// header (Bearer <jwt>). The route validates the token with the service
// role, resolves the calling user's org_id from public.users, and
// confirms it matches the invoice's org. Mismatch → 403.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { InvoicePdf } from '@/components/invoices/InvoicePdf'
import type { Invoice, InvoiceLineItem, InvoicePayment } from '@/lib/invoices'

export const runtime = 'nodejs'
// react-pdf relies on Node-only APIs (fs, stream); force Node runtime.
export const dynamic = 'force-dynamic'

const BUCKET = 'invoice-pdfs'

function num(v: unknown): number {
  return Number(v) || 0
}

function normalizeInvoice(r: any): Invoice {
  return {
    ...r,
    subtotal: num(r.subtotal),
    tax_pct: num(r.tax_pct),
    tax_amount: num(r.tax_amount),
    total: num(r.total),
    amount_received: num(r.amount_received),
  } as Invoice
}

function normalizeLine(r: any): InvoiceLineItem {
  return {
    ...r,
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    amount: num(r.amount),
  } as InvoiceLineItem
}

function normalizePayment(r: any): InvoicePayment {
  return { ...r, amount: num(r.amount) } as InvoicePayment
}

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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Missing invoice id' }, { status: 400 })
  }

  const callerOrgId = await authResolveOrg(req)
  if (!callerOrgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Load the invoice + line items + payments.
  const [invRes, lineRes, payRes] = await Promise.all([
    supabaseAdmin.from('client_invoices').select('*').eq('id', id).single(),
    supabaseAdmin
      .from('client_invoice_line_items')
      .select('*')
      .eq('invoice_id', id)
      .order('sort_order'),
    supabaseAdmin
      .from('client_invoice_payments')
      .select('*')
      .eq('invoice_id', id)
      .order('payment_date'),
  ])
  if (invRes.error || !invRes.data) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  const invoice = normalizeInvoice(invRes.data)
  if (invoice.org_id !== callerOrgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const lineItems = (lineRes.data || []).map(normalizeLine)
  const payments = (payRes.data || []).map(normalizePayment)

  // Org header + project + client. All read with service role; RLS
  // already cleared on the invoice row above.
  const [orgRes, projRes, cliRes] = await Promise.all([
    supabaseAdmin
      .from('orgs')
      .select(
        'name, business_address, business_city, business_state, business_zip, business_phone, business_email',
      )
      .eq('id', invoice.org_id)
      .single(),
    supabaseAdmin
      .from('projects')
      .select('name')
      .eq('id', invoice.project_id)
      .single(),
    invoice.client_id
      ? supabaseAdmin
          .from('clients')
          .select('name, address, email, phone')
          .eq('id', invoice.client_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])

  const org = (orgRes.data as any) || { name: 'Your Company' }
  const project = projRes.data ? { name: (projRes.data as any).name } : null
  const client = cliRes.data
    ? {
        name: (cliRes.data as any).name,
        address: (cliRes.data as any).address ?? null,
        email: (cliRes.data as any).email ?? null,
        phone: (cliRes.data as any).phone ?? null,
      }
    : null

  // Render. renderToBuffer's typings want a Document element; our
  // component wraps one, but TS loses that through React.createElement.
  // Cast is safe — renderToBuffer just walks the tree at runtime.
  const element = React.createElement(InvoicePdf, {
    invoice,
    lineItems,
    payments,
    org,
    project,
    client,
  })
  const buffer: Buffer = await renderToBuffer(element as any)

  // Upload (upsert overwrites previous cached copy).
  const path = `${invoice.org_id}/${invoice.id}.pdf`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (upErr) {
    console.error('invoice pdf upload', upErr)
    return NextResponse.json(
      { error: upErr.message || 'Storage upload failed' },
      { status: 500 },
    )
  }

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)

  // Append a cache-bust to the persisted URL so re-generated PDFs don't
  // serve stale CDN copies to operators clicking Download right after
  // an edit.
  const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`

  await supabaseAdmin
    .from('client_invoices')
    .update({ pdf_url: cacheBustedUrl, updated_at: new Date().toISOString() })
    .eq('id', invoice.id)

  return NextResponse.json({ url: cacheBustedUrl })
}

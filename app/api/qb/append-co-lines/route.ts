// POST /api/qb/append-co-lines  { docId }
// ============================================================================
// An ACCEPTED change-order doc lands on the project's PRIMARY invoice
// (2026-10-26) — "we'll manually add them to the primary invoice", automated.
// Replaces v2's separate-invoice-per-CO path: the contract is one growing
// total (payments item 1a), so the bill is too.
//
//   1. The doc must be accepted and in the caller's org (service role below —
//      the checks ARE the security).
//   2. The PRIMARY invoice = the project's newest non-void client invoice that
//      isn't a change-order invoice (same rule as lib/invoices
//      findContractInvoice). None → nothing to append: the contract invoice
//      raised later is built from a bid_total that already includes the CO.
//   3. ⛔ IDEMPOTENT: a local line tagged source_type='change_order' +
//      source_id=<doc id> means it's done. QB is written FIRST, so a QB
//      failure leaves nothing local and a retry is clean.
//   4. QB-linked invoice → appendLinesToInvoice (sparse update), then the same
//      lines are mirrored onto the MillSuite invoice so the payment watcher
//      keeps reconciling. Internal-mode invoice → local lines only.
//   5. One line per CO item with a non-zero delta, worded with the client-
//      facing description (the 113 work), never shop internals.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  appendLinesToInvoice,
  CacheMissError,
  strictCacheItemLookup,
  type QbLineItemInput,
} from '@/lib/quickbooks'
import { coLabel, itemAutoDescription, type CoDocItem } from '@/lib/co-doc-math'
import { DEFAULT_ACTIVITY_TYPE } from '@/lib/subproject-description'
import { nextStatusFromReceived, recomputeInvoiceTotals } from '@/lib/invoices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  const body = await req.json().catch(() => null)
  const docId = typeof body?.docId === 'string' ? body.docId : null
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

  const { data: doc } = await supabaseAdmin.from('co_docs').select('*').eq('id', docId).maybeSingle()
  if (!doc || doc.org_id !== caller.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status !== 'accepted') {
    return NextResponse.json({ error: 'Only an accepted change order is billed.' }, { status: 409 })
  }

  // ── The primary invoice ──
  const [{ data: invoices }, { data: v1 }, { data: v2 }] = await Promise.all([
    supabaseAdmin
      .from('client_invoices')
      .select('id, qbo_invoice_id, status, tax_pct, amount_received, created_at')
      .eq('project_id', doc.project_id)
      .neq('status', 'void')
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('change_orders').select('co_invoice_id').eq('project_id', doc.project_id).not('co_invoice_id', 'is', null),
    supabaseAdmin.from('co_docs').select('qbo_invoice_id').eq('project_id', doc.project_id).not('qbo_invoice_id', 'is', null),
  ])
  const coInvoiceIds = new Set([
    ...((v1 || []) as Array<{ co_invoice_id: string }>).map((r) => r.co_invoice_id),
    ...((v2 || []) as Array<{ qbo_invoice_id: string }>).map((r) => r.qbo_invoice_id),
  ])
  const primary = (invoices || []).find((i: any) => !coInvoiceIds.has(i.id)) as any
  if (!primary) {
    return NextResponse.json({ ok: true, skipped: 'no_primary_invoice' })
  }

  // ── Idempotency ──
  const { data: already } = await supabaseAdmin
    .from('client_invoice_line_items')
    .select('id')
    .eq('invoice_id', primary.id)
    .eq('source_type', 'change_order')
    .eq('source_id', docId)
    .limit(1)
  if (already && already.length > 0) return NextResponse.json({ ok: true, skipped: 'already_appended' })

  // ── The lines ──
  const { data: itemRows } = await supabaseAdmin
    .from('co_doc_items')
    .select('*')
    .eq('doc_id', docId)
    .order('sort_order', { ascending: true })
  const items = ((itemRows || []) as CoDocItem[]).filter((i) => Math.abs(Number(i.delta_amount) || 0) > 0.005)
  if (items.length === 0) return NextResponse.json({ ok: true, skipped: 'no_money' })
  const subIds = items.map((i) => i.subproject_id).filter(Boolean) as string[]
  const subs = new Map<string, { name: string; activity_type: string | null }>()
  if (subIds.length) {
    const { data } = await supabaseAdmin.from('subprojects').select('id, name, activity_type').in('id', subIds)
    for (const s of (data || []) as any[]) subs.set(s.id, { name: s.name, activity_type: s.activity_type })
  }
  const label = coLabel(doc)
  const lines = items.map((i) => {
    const sub = i.subproject_id ? subs.get(i.subproject_id) : undefined
    const words = (i.description || '').trim() || itemAutoDescription(i, sub?.name ?? null)
    const amount = Math.round((Number(i.delta_amount) || 0) * 100) / 100
    return {
      description: `${label} — ${words}`.slice(0, 4000),
      amount,
      activityType:
        sub?.activity_type ||
        (typeof (i.draft as any)?.activityType === 'string' ? (i.draft as any).activityType : null) ||
        DEFAULT_ACTIVITY_TYPE,
    }
  })

  // ── 1. QuickBooks first ──
  let qb: { totalAmt: number; docNumber: string } | null = null
  if (primary.qbo_invoice_id) {
    let qbLines: QbLineItemInput[]
    try {
      qbLines = await Promise.all(
        lines.map(async (l) => ({
          description: l.description,
          amount: l.amount,
          qty: 1,
          unitPrice: l.amount,
          itemRef: await strictCacheItemLookup(caller.orgId, l.activityType),
        })),
      )
    } catch (err) {
      if (err instanceof CacheMissError) {
        return NextResponse.json(
          {
            error: `Activity type "${err.activityType}" isn't in your QuickBooks item list. Sync your QB items (Settings → QuickBooks), then retry.`,
            missing_activity: err.activityType,
          },
          { status: 422 },
        )
      }
      throw err
    }
    try {
      qb = await appendLinesToInvoice(caller.orgId, primary.qbo_invoice_id, qbLines)
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'QuickBooks refused the update.' }, { status: 502 })
    }
  }

  // ── 2. Mirror onto the MillSuite invoice ──
  const { data: existing } = await supabaseAdmin
    .from('client_invoice_line_items')
    .select('sort_order, quantity, unit_price, amount')
    .eq('invoice_id', primary.id)
  const startSort = (existing || []).reduce((m: number, r: any) => Math.max(m, Number(r.sort_order) || 0), -1) + 1
  const rows = lines.map((l, k) => ({
    invoice_id: primary.id,
    sort_order: startSort + k,
    description: l.description,
    quantity: 1,
    unit: null,
    unit_price: l.amount,
    amount: l.amount,
    source_type: 'change_order',
    source_id: docId,
  }))
  const { error: insErr } = await supabaseAdmin.from('client_invoice_line_items').insert(rows)
  if (insErr) {
    return NextResponse.json(
      { error: `QuickBooks was updated, but the MillSuite invoice wasn't: ${insErr.message}`, qb },
      { status: 500 },
    )
  }
  const totals = recomputeInvoiceTotals(
    [...(existing || []), ...rows].map((li: any) => ({
      quantity: Number(li.quantity) || 0,
      unit_price: Number(li.unit_price) || 0,
      amount: Number(li.amount) || 0,
    })),
    Number(primary.tax_pct) || 0,
  )
  const nowIso = new Date().toISOString()
  const next = nextStatusFromReceived(primary.status, totals.total, Number(primary.amount_received) || 0, nowIso)
  await supabaseAdmin
    .from('client_invoices')
    .update({
      subtotal: totals.subtotal,
      tax_amount: totals.tax_amount,
      total: totals.total,
      status: next.status,
      paid_at: next.paid_at,
      updated_at: nowIso,
    })
    .eq('id', primary.id)

  await supabaseAdmin.from('project_events').insert({
    org_id: caller.orgId,
    project_id: doc.project_id,
    event_type: 'co_invoice_appended',
    label: `${label} added to the ${qb ? 'QuickBooks' : 'contract'} invoice`,
    meta: { docId, invoiceId: primary.id, qboInvoiceId: primary.qbo_invoice_id ?? null, lines, qb },
    actor_user_id: caller.userId ?? null,
  })

  return NextResponse.json({ ok: true, invoiceId: primary.id, qb, lines: lines.length })
}

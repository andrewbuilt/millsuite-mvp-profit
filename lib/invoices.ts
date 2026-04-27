// ============================================================================
// lib/invoices.ts — invoice CRUD + helpers
// ============================================================================
// Invoices live alongside cash_flow_receivables, not on top of them. A
// milestone (cash_flow_receivables row) is the demand-side projection
// of cash; an invoice is the document that goes to the client. They
// link 1:1 via invoices.linked_milestone_id when generated from a
// milestone, but ad-hoc invoices (PR-3) carry no link.
//
// Status state machine:
//   draft   → sent | void
//   sent    → partial | paid | void   (overdue is computed client-side
//             from due_date < today, not a stored state)
//   partial → paid | void
//   paid    → (terminal)
//   void    → (terminal)
// ============================================================================

import { supabase } from './supabase'

export type InvoiceStatus =
  | 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void'

export type InvoiceLineSourceType =
  | 'milestone' | 'subproject' | 'change_order' | 'custom'

export interface Invoice {
  id: string
  org_id: string
  project_id: string
  client_id: string | null
  invoice_number: string
  invoice_date: string
  due_date: string
  status: InvoiceStatus
  subtotal: number
  tax_pct: number
  tax_amount: number
  total: number
  amount_received: number
  notes: string | null
  internal_notes: string | null
  linked_milestone_id: string | null
  pdf_url: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceLineItem {
  id: string
  invoice_id: string
  sort_order: number
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  amount: number
  source_type: InvoiceLineSourceType | null
  source_id: string | null
}

export interface InvoicePayment {
  id: string
  invoice_id: string
  amount: number
  payment_date: string
  payment_method: 'check' | 'ach' | 'card' | 'cash' | 'other' | null
  reference: string | null
  notes: string | null
  qb_event_id: string | null
  created_at: string
}

const INVOICE_COLUMNS =
  'id, org_id, project_id, client_id, invoice_number, invoice_date, due_date, status, ' +
  'subtotal, tax_pct, tax_amount, total, amount_received, notes, internal_notes, ' +
  'linked_milestone_id, pdf_url, sent_at, paid_at, created_at, updated_at'

const LINE_COLUMNS =
  'id, invoice_id, sort_order, description, quantity, unit, unit_price, amount, source_type, source_id'

const PAYMENT_COLUMNS =
  'id, invoice_id, amount, payment_date, payment_method, reference, notes, qb_event_id, created_at'

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

// ── Reads ──

export interface InvoiceFilters {
  project_id?: string
  status?: InvoiceStatus
  client_id?: string
  /** ISO date inclusive lower bound on invoice_date */
  from?: string
  /** ISO date inclusive upper bound on invoice_date */
  to?: string
}

export async function loadInvoices(
  orgId: string,
  filters: InvoiceFilters = {},
): Promise<Invoice[]> {
  let q = supabase
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('org_id', orgId)
  if (filters.project_id) q = q.eq('project_id', filters.project_id)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.client_id) q = q.eq('client_id', filters.client_id)
  if (filters.from) q = q.gte('invoice_date', filters.from)
  if (filters.to) q = q.lte('invoice_date', filters.to)
  const { data, error } = await q.order('invoice_date', { ascending: false })
  if (error) {
    console.error('loadInvoices', error)
    return []
  }
  return (data || []).map(normalizeInvoice)
}

export async function loadInvoicesForProject(projectId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('project_id', projectId)
    .order('invoice_date', { ascending: false })
  if (error) {
    console.error('loadInvoicesForProject', error)
    return []
  }
  return (data || []).map(normalizeInvoice)
}

export async function getInvoice(id: string): Promise<{
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  payments: InvoicePayment[]
} | null> {
  const [invRes, lineRes, payRes] = await Promise.all([
    supabase.from('invoices').select(INVOICE_COLUMNS).eq('id', id).single(),
    supabase.from('invoice_line_items').select(LINE_COLUMNS).eq('invoice_id', id).order('sort_order'),
    supabase.from('invoice_payments').select(PAYMENT_COLUMNS).eq('invoice_id', id).order('payment_date'),
  ])
  if (invRes.error || !invRes.data) {
    if (invRes.error) console.error('getInvoice', invRes.error)
    return null
  }
  return {
    invoice: normalizeInvoice(invRes.data),
    lineItems: (lineRes.data || []).map(normalizeLine),
    payments: (payRes.data || []).map(normalizePayment),
  }
}

// ── Numbering ──

interface OrgInvoiceSettings {
  invoice_prefix: string | null
  next_invoice_number: number
  default_tax_pct: number | null
  default_payment_terms_days: number
  invoice_footer_text: string | null
  invoice_email_template: string | null
}

async function loadOrgInvoiceSettings(orgId: string): Promise<OrgInvoiceSettings> {
  const { data, error } = await supabase
    .from('orgs')
    .select(
      'invoice_prefix, next_invoice_number, default_tax_pct, default_payment_terms_days, invoice_footer_text, invoice_email_template',
    )
    .eq('id', orgId)
    .single()
  if (error || !data) {
    throw new Error(error?.message || 'Failed to load org invoice settings')
  }
  return {
    invoice_prefix: data.invoice_prefix ?? null,
    next_invoice_number: Number(data.next_invoice_number) || 1,
    default_tax_pct:
      data.default_tax_pct == null ? null : Number(data.default_tax_pct),
    default_payment_terms_days: Number(data.default_payment_terms_days) || 14,
    invoice_footer_text: data.invoice_footer_text ?? null,
    invoice_email_template: data.invoice_email_template ?? null,
  }
}

function formatInvoiceNumber(prefix: string | null, n: number): string {
  const pre = prefix && prefix.length > 0 ? prefix : 'INV-'
  return `${pre}${String(n).padStart(4, '0')}`
}

/** Reserve the next invoice number for an org and atomically bump the
 *  counter. Two simultaneous creates can race the read; the unique
 *  constraint on (org_id, invoice_number) catches that and the caller
 *  can retry. PR-2 may upgrade this to a Postgres function for stronger
 *  guarantees. */
export async function reserveNextInvoiceNumber(orgId: string): Promise<string> {
  const s = await loadOrgInvoiceSettings(orgId)
  const number = formatInvoiceNumber(s.invoice_prefix, s.next_invoice_number)
  const { error } = await supabase
    .from('orgs')
    .update({ next_invoice_number: s.next_invoice_number + 1 })
    .eq('id', orgId)
  if (error) {
    console.error('reserveNextInvoiceNumber bump', error)
    throw new Error(error.message || 'Failed to reserve invoice number')
  }
  return number
}

// ── Build from milestone ──

interface BuiltInvoice {
  invoice: Partial<Invoice>
  lineItems: Partial<InvoiceLineItem>[]
}

/** Pure prefill — does not write. Pulls the milestone, the project, and
 *  the org's invoicing settings, builds the modal seed. The modal then
 *  lets the operator edit any field before save. */
export async function buildInvoiceFromMilestone(
  milestoneId: string,
): Promise<BuiltInvoice> {
  const { data: milestone, error: mErr } = await supabase
    .from('cash_flow_receivables')
    .select('id, org_id, project_id, milestone_label, milestone_pct, amount, status, expected_date')
    .eq('id', milestoneId)
    .single()
  if (mErr || !milestone) {
    throw new Error(mErr?.message || 'Milestone not found')
  }
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, client_id, bid_total')
    .eq('id', milestone.project_id)
    .single()

  const settings = await loadOrgInvoiceSettings(milestone.org_id)
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date()
  due.setUTCDate(due.getUTCDate() + settings.default_payment_terms_days)
  const dueIso = due.toISOString().slice(0, 10)

  const pct = Number(milestone.milestone_pct) || 0
  const amount = Number(milestone.amount) || 0
  const label = milestone.milestone_label || 'Project milestone'
  const description = pct > 0
    ? `${label} — ${pct}% of project total`
    : label

  return {
    invoice: {
      org_id: milestone.org_id,
      project_id: milestone.project_id,
      client_id: project?.client_id ?? null,
      invoice_date: today,
      due_date: dueIso,
      status: 'draft',
      tax_pct: settings.default_tax_pct ?? 0,
      notes: settings.invoice_footer_text ?? null,
      internal_notes: null,
      linked_milestone_id: milestone.id,
    },
    lineItems: [
      {
        sort_order: 0,
        description,
        quantity: 1,
        unit: null,
        unit_price: amount,
        amount,
        source_type: 'milestone',
        source_id: milestone.id,
      },
    ],
  }
}

// ── Totals ──

export function recomputeInvoiceTotals(
  lineItems: Array<Pick<InvoiceLineItem, 'quantity' | 'unit_price' | 'amount'>>,
  taxPct: number,
): { subtotal: number; tax_amount: number; total: number } {
  const subtotal = lineItems.reduce((s, li) => {
    const qty = num(li.quantity)
    const price = num(li.unit_price)
    const computed = qty * price
    const stored = num(li.amount)
    return s + (stored > 0 ? stored : computed)
  }, 0)
  const pct = num(taxPct)
  const tax_amount = +(subtotal * (pct / 100)).toFixed(2)
  const total = +(subtotal + tax_amount).toFixed(2)
  return { subtotal: +subtotal.toFixed(2), tax_amount, total }
}

// ── Writes ──

export async function createInvoice(args: {
  invoice: Partial<Invoice>
  lineItems: Partial<InvoiceLineItem>[]
  /** When true, also flips the linked cash_flow_receivables row to
   *  status='invoiced' and stamps invoiced_date. */
  markSent?: boolean
}): Promise<Invoice> {
  const { invoice, lineItems, markSent } = args
  if (!invoice.org_id || !invoice.project_id) {
    throw new Error('createInvoice: org_id + project_id required')
  }

  const number = invoice.invoice_number ?? (await reserveNextInvoiceNumber(invoice.org_id))
  const totals = recomputeInvoiceTotals(
    lineItems.map((li) => ({
      quantity: num(li.quantity),
      unit_price: num(li.unit_price),
      amount: num(li.amount),
    })),
    num(invoice.tax_pct),
  )

  const nowIso = new Date().toISOString()
  const status: InvoiceStatus = markSent ? 'sent' : (invoice.status as InvoiceStatus) || 'draft'

  const insertRow = {
    org_id: invoice.org_id,
    project_id: invoice.project_id,
    client_id: invoice.client_id ?? null,
    invoice_number: number,
    invoice_date: invoice.invoice_date ?? nowIso.slice(0, 10),
    due_date: invoice.due_date ?? nowIso.slice(0, 10),
    status,
    subtotal: totals.subtotal,
    tax_pct: num(invoice.tax_pct),
    tax_amount: totals.tax_amount,
    total: totals.total,
    amount_received: 0,
    notes: invoice.notes ?? null,
    internal_notes: invoice.internal_notes ?? null,
    linked_milestone_id: invoice.linked_milestone_id ?? null,
    sent_at: markSent ? nowIso : null,
  }

  const { data: created, error: invErr } = await supabase
    .from('invoices')
    .insert(insertRow)
    .select(INVOICE_COLUMNS)
    .single()
  if (invErr || !created) {
    console.error('createInvoice', invErr)
    throw new Error(invErr?.message || 'Failed to create invoice')
  }
  const normalized = normalizeInvoice(created)

  if (lineItems.length > 0) {
    const lineRows = lineItems.map((li, i) => ({
      invoice_id: normalized.id,
      sort_order: li.sort_order ?? i,
      description: li.description ?? '',
      quantity: num(li.quantity || 1),
      unit: li.unit ?? null,
      unit_price: num(li.unit_price),
      amount: num(li.amount || (num(li.quantity || 1) * num(li.unit_price))),
      source_type: li.source_type ?? null,
      source_id: li.source_id ?? null,
    }))
    const { error: linesErr } = await supabase.from('invoice_line_items').insert(lineRows)
    if (linesErr) {
      console.error('createInvoice lines', linesErr)
      throw new Error(linesErr.message || 'Failed to insert line items')
    }
  }

  if (markSent && normalized.linked_milestone_id) {
    await supabase
      .from('cash_flow_receivables')
      .update({ status: 'invoiced', invoiced_date: nowIso.slice(0, 10) })
      .eq('id', normalized.linked_milestone_id)
  }

  return normalized
}

export async function updateInvoice(
  id: string,
  patch: Partial<Invoice>,
): Promise<Invoice | null> {
  const update: Record<string, unknown> = {}
  const fields: (keyof Invoice)[] = [
    'invoice_number',
    'invoice_date',
    'due_date',
    'status',
    'subtotal',
    'tax_pct',
    'tax_amount',
    'total',
    'amount_received',
    'notes',
    'internal_notes',
    'client_id',
    'sent_at',
    'paid_at',
    'pdf_url',
  ]
  for (const f of fields) {
    if (patch[f] !== undefined) update[f] = patch[f] as unknown
  }
  if (Object.keys(update).length === 0) return null
  update.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('invoices')
    .update(update)
    .eq('id', id)
    .select(INVOICE_COLUMNS)
    .single()
  if (error) {
    console.error('updateInvoice', error)
    throw new Error(error.message || 'Failed to update invoice')
  }
  return data ? normalizeInvoice(data) : null
}

/** Replace every line item on an invoice in a single delete-and-insert.
 *  Recomputes invoice totals using the supplied tax_pct (caller passes
 *  the patched value if it's also being edited; otherwise read it from
 *  the loaded invoice). Use only when status='draft'. */
export async function updateInvoiceLineItems(
  invoiceId: string,
  lineItems: Partial<InvoiceLineItem>[],
  taxPct: number,
): Promise<void> {
  const { error: delErr } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', invoiceId)
  if (delErr) {
    console.error('updateInvoiceLineItems delete', delErr)
    throw new Error(delErr.message || 'Failed to clear line items')
  }
  if (lineItems.length > 0) {
    const rows = lineItems.map((li, i) => ({
      invoice_id: invoiceId,
      sort_order: li.sort_order ?? i,
      description: li.description ?? '',
      quantity: num(li.quantity || 1),
      unit: li.unit ?? null,
      unit_price: num(li.unit_price),
      amount: num(li.amount || (num(li.quantity || 1) * num(li.unit_price))),
      source_type: li.source_type ?? null,
      source_id: li.source_id ?? null,
    }))
    const { error: insErr } = await supabase.from('invoice_line_items').insert(rows)
    if (insErr) {
      console.error('updateInvoiceLineItems insert', insErr)
      throw new Error(insErr.message || 'Failed to save line items')
    }
  }
  const totals = recomputeInvoiceTotals(
    lineItems.map((li) => ({
      quantity: num(li.quantity || 1),
      unit_price: num(li.unit_price),
      amount: num(li.amount),
    })),
    taxPct,
  )
  await updateInvoice(invoiceId, {
    subtotal: totals.subtotal,
    tax_pct: taxPct,
    tax_amount: totals.tax_amount,
    total: totals.total,
  })
}

/** Mark an invoice void. Terminal — caller should confirm. */
export async function voidInvoice(id: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('voidInvoice', error)
    throw new Error(error.message || 'Failed to void invoice')
  }
}

/** Stamp a draft invoice as sent. PR-2 will replace this with a real
 *  send pipeline (PDF render + email template); for now it's a status
 *  flip + sent_at timestamp + milestone-status update. */
export async function markInvoiceSent(id: string): Promise<Invoice | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .select(INVOICE_COLUMNS)
    .single()
  if (error || !data) {
    console.error('markInvoiceSent', error)
    throw new Error(error?.message || 'Failed to mark invoice sent')
  }
  const normalized = normalizeInvoice(data)
  if (normalized.linked_milestone_id) {
    await supabase
      .from('cash_flow_receivables')
      .update({ status: 'invoiced', invoiced_date: nowIso.slice(0, 10) })
      .eq('id', normalized.linked_milestone_id)
  }
  return normalized
}

// ── Status helpers ──

/** Computed-only state — overdue is not stored. An invoice is overdue
 *  when status='sent' (not partial/paid/void/draft) and due_date is
 *  before today. List + detail views call this to show the overdue
 *  pill. */
export function isOverdue(inv: Pick<Invoice, 'status' | 'due_date'>): boolean {
  if (inv.status !== 'sent') return false
  const today = new Date().toISOString().slice(0, 10)
  return inv.due_date < today
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, { bg: string; fg: string }> = {
  draft:   { bg: '#F3F4F6', fg: '#374151' },
  sent:    { bg: '#DBEAFE', fg: '#1E40AF' },
  partial: { bg: '#FEF3C7', fg: '#92400E' },
  paid:    { bg: '#D1FAE5', fg: '#065F46' },
  overdue: { bg: '#FEE2E2', fg: '#991B1B' },
  void:    { bg: '#E5E7EB', fg: '#9CA3AF' },
}

// ============================================================================
// lib/project-expenses.ts — material spend against a project (migration 124)
// ============================================================================
// The ledger is the `invoices` table: VENDOR bills (not client_invoices, the
// shop's own bills). Andrew 2026-10-29: extend the table everything already
// reads as material spend rather than fork a new one — project-outcome,
// /reports, the /pm Watch list, the shop report and the weekly snapshot keep
// working untouched.
//
// Two ways in, one row shape:
//   · parsed — the invoice dropzone (/pm, and inside the project's Material
//     modal) reads vendor / number / date / total, then asks which project
//   · manual — a plain row form in the Material modal
// Edits stamp edited_by / edited_at (the time-entry pattern); delete is a real
// delete — a mistyped bill is not history worth keeping.
//
// ⛔ PRE-124 SAFETY: the new columns don't exist until the migration runs, and
// PostgREST fails a whole select on one unknown column. `listProjectExpenses`
// retries with the base columns so the panel still shows spend.
// ============================================================================

import { supabase } from './supabase'

export type ExpenseSource = 'parsed' | 'manual'

export interface ProjectExpense {
  id: string
  project_id: string
  subproject_id: string | null
  vendor_name: string
  invoice_number: string | null
  invoice_date: string | null
  amount: number
  source: ExpenseSource
  note: string | null
  file_url: string | null
  entered_by: string | null
  edited_by: string | null
  edited_at: string | null
  created_at: string
}

const BASE_COLS = 'id, project_id, subproject_id, vendor_name, invoice_number, invoice_date, total_amount, file_url, created_at'
const FULL_COLS = `${BASE_COLS}, source, note, entered_by, edited_by, edited_at`

function toExpense(r: Record<string, unknown>): ProjectExpense {
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    subproject_id: (r.subproject_id as string) ?? null,
    vendor_name: (r.vendor_name as string) || '',
    invoice_number: (r.invoice_number as string) ?? null,
    invoice_date: (r.invoice_date as string) ?? null,
    amount: Number(r.total_amount) || 0,
    source: r.source === 'manual' ? 'manual' : 'parsed',
    note: (r.note as string) ?? null,
    file_url: (r.file_url as string) ?? null,
    entered_by: (r.entered_by as string) ?? null,
    edited_by: (r.edited_by as string) ?? null,
    edited_at: (r.edited_at as string) ?? null,
    created_at: r.created_at as string,
  }
}

/** One project's spend, newest bill first. */
export async function listProjectExpenses(projectId: string): Promise<ProjectExpense[]> {
  const q = (cols: string) =>
    supabase
      .from('invoices')
      .select(cols)
      .eq('project_id', projectId)
      .order('invoice_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
  let { data, error } = await q(FULL_COLS)
  if (error && String((error as { code?: string }).code) === '42703') {
    console.warn('listProjectExpenses: run migration 124')
    ;({ data, error } = await q(BASE_COLS))
  }
  if (error) {
    console.error('listProjectExpenses', error)
    return []
  }
  return ((data || []) as unknown as Record<string, unknown>[]).map(toExpense)
}

export { findLikelyDuplicates, sumExpenses } from './project-expenses-math'

export interface ExpenseInput {
  orgId: string
  projectId: string
  subprojectId?: string | null
  vendorName: string
  invoiceNumber?: string | null
  invoiceDate?: string | null
  amount: number
  source: ExpenseSource
  note?: string | null
  fileUrl?: string | null
  userId?: string | null
  lineItems?: { description: string; quantity: number; unit_price: number; total: number }[]
}

/** Insert one bill (+ its parsed line items). Throws on failure. */
export async function createExpense(input: ExpenseInput): Promise<string> {
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      subproject_id: input.subprojectId || null,
      vendor_name: input.vendorName.trim(),
      invoice_number: input.invoiceNumber?.trim() || null,
      invoice_date: input.invoiceDate || null,
      total_amount: Math.round(input.amount * 100) / 100,
      file_url: input.fileUrl ?? null,
      source: input.source,
      note: input.note?.trim() || null,
      entered_by: input.userId ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as { id: string }).id
  if (input.lineItems?.length) {
    // org/project carried on every line — the 124 RLS policy checks org_id,
    // and the old parser left it null.
    const { error: liErr } = await supabase.from('invoice_line_items').insert(
      input.lineItems.map((li) => ({
        invoice_id: id,
        org_id: input.orgId,
        project_id: input.projectId,
        subproject_id: input.subprojectId || null,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total: li.total,
      })),
    )
    if (liErr) console.error('createExpense line items', liErr)
  }
  return id
}

/** Edit a bill's header fields; stamps who and when. Throws on failure. */
export async function updateExpense(
  id: string,
  patch: { vendorName?: string; invoiceNumber?: string | null; invoiceDate?: string | null; amount?: number; note?: string | null },
  userId?: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { edited_by: userId ?? null, edited_at: now, updated_at: now }
  if (patch.vendorName !== undefined) row.vendor_name = patch.vendorName.trim()
  if (patch.invoiceNumber !== undefined) row.invoice_number = patch.invoiceNumber?.trim() || null
  if (patch.invoiceDate !== undefined) row.invoice_date = patch.invoiceDate || null
  if (patch.amount !== undefined) row.total_amount = Math.round(patch.amount * 100) / 100
  if (patch.note !== undefined) row.note = patch.note?.trim() || null
  const { data, error } = await supabase.from('invoices').update(row).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('That bill could not be found.')
}

/** Delete a bill and its line items. Throws on failure. */
export async function deleteExpense(id: string): Promise<void> {
  await supabase.from('invoice_line_items').delete().eq('invoice_id', id)
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw error
}

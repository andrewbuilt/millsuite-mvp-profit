import { NextRequest, NextResponse } from 'next/server'
import {
  resolveApiCaller,
  unauthorized,
  notFound,
  projectBelongsToOrg,
} from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  findOrCreateCustomer,
  createInvoice,
  type QbLineItemInput,
} from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Push the project's invoice to the org's QuickBooks company. We stamp the QB
// invoice id onto the MillSuite invoice row (body.invoiceId) so the inbound
// watcher can match incoming payments (draws) back to it and lower its balance.
export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()

  const body = await req.json().catch(() => null)
  if (!body?.projectId || !Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return NextResponse.json(
      { error: 'projectId and at least one line item are required' },
      { status: 400 },
    )
  }
  if (!(await projectBelongsToOrg(body.projectId, caller.orgId))) return notFound()

  try {
    const customerName: string = body.customerName || 'Customer'
    const customerQboId = await findOrCreateCustomer(
      caller.orgId,
      customerName,
      body.clientEmail,
      body.clientPhone,
      body.clientAddress,
    )
    const { invoiceId: qbInvoiceId, docNumber, totalAmt } = await createInvoice(caller.orgId, {
      customerQboId,
      customerName,
      lineItems: body.lineItems as QbLineItemInput[],
      dueDate: body.dueDate,
      memo: body.memo,
    })
    // Link the QB invoice id to the MillSuite invoice row (body.invoiceId) so
    // the inbound watcher can apply incoming draws to its balance.
    if (body.invoiceId) {
      await supabaseAdmin
        .from('client_invoices')
        .update({ qbo_invoice_id: qbInvoiceId })
        .eq('id', body.invoiceId)
        .eq('org_id', caller.orgId)
    }
    return NextResponse.json({ ok: true, qbInvoiceId, docNumber, totalAmt })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to push invoice to QuickBooks' },
      { status: 502 },
    )
  }
}

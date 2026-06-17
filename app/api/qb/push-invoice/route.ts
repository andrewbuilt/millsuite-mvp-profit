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

// Push an invoice to the org's QuickBooks company. When a milestone
// (cash_flow_receivables) is being billed, we stamp the returned QB invoice id
// on it so the payment watcher can reconcile the payment back to the milestone.
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
    const { invoiceId, docNumber, totalAmt } = await createInvoice(caller.orgId, {
      customerQboId,
      customerName,
      lineItems: body.lineItems as QbLineItemInput[],
      dueDate: body.dueDate,
      memo: body.memo,
    })
    // Attach the QB invoice id to the billed milestone so the inbound watcher
    // can match the eventual payment back to it. (Ad-hoc invoices have no
    // milestone — they just land in QB.)
    if (body.milestoneId) {
      await supabaseAdmin
        .from('cash_flow_receivables')
        .update({ qbo_invoice_id: invoiceId })
        .eq('id', body.milestoneId)
        .eq('project_id', body.projectId)
    }
    return NextResponse.json({ ok: true, invoiceId, docNumber, totalAmt })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to push invoice to QuickBooks' },
      { status: 502 },
    )
  }
}

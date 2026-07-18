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
  strictCacheItemLookup,
  CacheMissError,
  type QbLineItemInput,
} from '@/lib/quickbooks'
import { DEFAULT_ACTIVITY_TYPE } from '@/lib/subproject-description'

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
    // Map each line's activity type to a real QB service item (ItemRef) via a
    // strict cache match. A miss surfaces as a 422 with the offending activity
    // type so the UI can prompt "sync your QB items" — never a silent fallback.
    let lineItems: QbLineItemInput[]
    try {
      lineItems = await Promise.all(
        (body.lineItems as any[]).map(async (l) => {
          const activityType = (l.activityType || DEFAULT_ACTIVITY_TYPE) as string
          const itemRef = await strictCacheItemLookup(caller.orgId, activityType)
          return {
            description: l.description,
            amount: l.amount,
            qty: l.qty,
            unitPrice: l.unitPrice,
            itemRef,
          } as QbLineItemInput
        }),
      )
    } catch (err) {
      if (err instanceof CacheMissError) {
        return NextResponse.json(
          {
            error:
              `Activity type "${err.activityType}" isn't in your QuickBooks item list. ` +
              `Sync your QB items (Settings → QuickBooks), or fix the subproject's activity type.`,
            missing_activity: err.activityType,
          },
          { status: 422 },
        )
      }
      throw err
    }

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
      lineItems,
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

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
  createEstimate,
  type QbLineItemInput,
} from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Push a project's estimate to the org's QuickBooks company. The client sends
// the same line items it previews; we find/create the customer, create the QB
// estimate, and stamp the returned id/number on the project.
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
    const { estimateId, docNumber } = await createEstimate(caller.orgId, {
      customerQboId,
      customerName,
      lineItems: body.lineItems as QbLineItemInput[],
      memo: body.memo,
      expirationDate: body.expirationDate,
    })
    await supabaseAdmin
      .from('projects')
      .update({ qbo_estimate_id: estimateId, qbo_estimate_number: docNumber })
      .eq('id', body.projectId)
    return NextResponse.json({ ok: true, estimateId, docNumber })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to push estimate to QuickBooks' },
      { status: 502 },
    )
  }
}

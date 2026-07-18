import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { syncQbItems } from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pull the caller org's active QB Service/NonInventory items into
// qbo_items_cache so the invoice push can map subproject activity types to
// real ItemRefs. Idempotent (upsert on org_id,qb_id).
export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  try {
    const count = await syncQbItems(caller.orgId)
    return NextResponse.json({ ok: true, count })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to sync QuickBooks items' },
      { status: 502 },
    )
  }
}

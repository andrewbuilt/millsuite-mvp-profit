import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { listQbItems } from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The org's active cached QB items — feeds the subproject activity-type
// dropdown. Reads the cache only (no live QB call); empty until a sync runs.
export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  try {
    const items = await listQbItems(caller.orgId)
    return NextResponse.json({ items })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to load QuickBooks items' },
      { status: 500 },
    )
  }
}

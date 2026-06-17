import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { getConnectionStatus } from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live connection status for the caller's org. Hits QB companyinfo, so a
// `connected: true` means the stored tokens actually work.
export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  return NextResponse.json(await getConnectionStatus(caller.orgId))
}

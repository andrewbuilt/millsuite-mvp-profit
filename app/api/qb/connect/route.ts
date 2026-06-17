import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { getAuthUrl } from '@/lib/quickbooks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Returns the Intuit consent URL for the caller's org; the client then redirects
// the browser to it. We don't redirect server-side here because this is a
// Bearer-authenticated fetch — the actual top-level navigation to Intuit happens
// on the client. `state` carries the org id back to /api/qb/callback.
export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  return NextResponse.json({ url: getAuthUrl(caller.orgId) })
}

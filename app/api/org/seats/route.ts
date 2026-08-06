import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { getSeatStatus } from '@/lib/seats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/org/seats — { used, limit, remaining, atLimit } for the caller's org.
//
// Seat counts used to be a browser-side `count` over the `users` table. After
// migration 084 a client can only see its OWN users row (that's what stops the
// policy recursing), so the count has to come from the service role. Same
// numbers, one round trip, and it now also honours the internal plan's
// unlimited seats instead of re-deriving the limit in the UI.
export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller) return unauthorized()
  return NextResponse.json(await getSeatStatus(caller.orgId))
}

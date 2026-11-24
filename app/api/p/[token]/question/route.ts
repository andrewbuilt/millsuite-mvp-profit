// ============================================================================
// POST /api/p/{token}/question — B2B approval portal, client write
// ============================================================================
// Public-by-link: the token in the path is the only credential. All the
// checking and every database call live in lib/preapproval-portal (service
// role) — this handler takes the request apart and nothing else, so there is
// exactly one place where "is this row this project's?" gets answered.
// ⛔ No anon key, no browser supabase client, on any /api/p route.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { portalAskQuestion } from '@/lib/preapproval-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await portalAskQuestion(token, await req.json().catch(() => null))
  return NextResponse.json(r.body, { status: r.status })
}

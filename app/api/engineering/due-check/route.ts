// ============================================================================
// /api/engineering/due-check — the end-of-day engineering check
// ============================================================================
// Bearer-authenticated (the caller's Supabase session). Rules: lib/eng-due-check.ts.
//   GET                                   → { jobs, today, checkAt } — what the
//                                           caller must answer right now
//   POST { action: 'answer', projectId, answer: 'done' }
//   POST { action: 'answer', projectId, answer: 'not_yet', newDate, reason }
//   POST { action: 'sweep' }              → unanswered due days become a
//                                           Critical task for the PM (once each)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { answerDueCheck, dueCheckFor, sweepMissed, DueCheckError } from '@/lib/eng-due-check-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(e: unknown) {
  if (e instanceof DueCheckError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('due-check', e)
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId || !caller.userId) return unauthorized()
  try {
    return NextResponse.json(await dueCheckFor(caller.orgId, caller.userId))
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    if (body.action === 'sweep') {
      return NextResponse.json({ made: await sweepMissed(caller.orgId) })
    }
    if (body.action === 'answer' && typeof body.projectId === 'string' && (body.answer === 'done' || body.answer === 'not_yet')) {
      await answerDueCheck({
        orgId: caller.orgId,
        userId: caller.userId,
        role: caller.role,
        projectId: body.projectId,
        answer: body.answer,
        newDate: typeof body.newDate === 'string' ? body.newDate : null,
        reason: typeof body.reason === 'string' ? body.reason : null,
      })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  } catch (e) {
    return fail(e)
  }
}

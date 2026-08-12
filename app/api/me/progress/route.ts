import { NextRequest, NextResponse } from 'next/server'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { TOUR_IDS } from '@/lib/walkthroughs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================================================
// /api/me/progress — the caller's own onboarding + walkthrough state
// ============================================================================
// WHY THIS EXISTS AT ALL: `users` has RLS on (083) with exactly two policies
// (084/085) — SELECT self and DELETE own-org. There is no UPDATE policy, so an
// UPDATE issued from the browser matches zero rows and PostgREST answers
// `{ error: null }`. Success-shaped silence. `useOnboardingStatus` had been
// writing that way since 083 reached prod on 2026-08-06, which meant
// `onboarded_at` never actually stamped and a new owner got the setup wizard
// again on every sign-in.
//
// So writes go through the service role here instead. The safety comes from
// two rules, both enforced below and neither negotiable:
//
//   1. The target row is ALWAYS `caller.userId`, resolved from the bearer
//      token. No user id is ever read from the request body — that's the
//      difference between "update myself" and "update anyone".
//   2. Only three columns are writable: onboarding_step, onboarded_at,
//      walkthrough_state. `role` and `org_id` are not on the list, so this
//      route cannot be turned into a privilege-escalation or tenant-hop.
//
// The alternative — adding an UPDATE policy on `users` — needs column-level
// grants to be safe (a plain self-row UPDATE policy would let anyone rewrite
// their own `role`), and Supabase's default table-level grants would have to be
// revoked first. That's a bigger change to the auth table than this feature
// justifies.
// ============================================================================

const ONBOARDING_STEPS = new Set(['welcome', 'shop_rate', 'base_cabinet'])

/** The only keys a tour may persist. Anything else is dropped rather than
 *  rejected — a newer client writing a key this deploy doesn't know about
 *  shouldn't hard-fail its own progress save. */
const TOUR_PATCH_KEYS = new Set(['step', 'offered_at', 'started_at', 'completed_at', 'dismissed_at'])

type TourState = Record<string, Record<string, unknown>>

// Read in two steps: before 088 runs, asking for `walkthrough_state` fails the
// whole select with "column does not exist" rather than returning null, which
// would take onboarding state down with it. The onboarding fix has to work the
// moment it deploys, migration or no migration.
async function readRow(userId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('onboarded_at, onboarding_step')
    .eq('id', userId)
    .single()
  const { data: wt } = await supabaseAdmin
    .from('users')
    .select('walkthrough_state')
    .eq('id', userId)
    .single()
  return {
    onboarded_at: (data?.onboarded_at as string | null) ?? null,
    onboarding_step: (data?.onboarding_step as string | null) ?? null,
    walkthrough_state: ((wt?.walkthrough_state as TourState) ?? {}) as TourState,
  }
}

export async function GET(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.userId) return unauthorized()
  return NextResponse.json(await readRow(caller.userId))
}

export async function POST(req: NextRequest) {
  const caller = await resolveApiCaller(req)
  if (!caller?.userId) return unauthorized()

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const action = String(body.action || '')
  const patch: Record<string, unknown> = {}

  if (action === 'onboarding_step') {
    const step = String(body.step || '')
    if (!ONBOARDING_STEPS.has(step)) {
      return NextResponse.json({ error: 'Unknown onboarding step' }, { status: 400 })
    }
    patch.onboarding_step = step
  } else if (action === 'onboarding_complete') {
    patch.onboarded_at = new Date().toISOString()
    patch.onboarding_step = null
  } else if (action === 'tour' || action === 'tour_reset') {
    const tourId = String(body.tourId || '')
    // Validated against the catalog so this can't be used to grow the jsonb
    // blob with arbitrary keys.
    if (!(TOUR_IDS as string[]).includes(tourId)) {
      return NextResponse.json({ error: 'Unknown tour' }, { status: 400 })
    }
    const current = (await readRow(caller.userId)).walkthrough_state
    const next: TourState = { ...current }
    if (action === 'tour_reset') {
      delete next[tourId]
    } else {
      const incoming = (body.patch || {}) as Record<string, unknown>
      const clean: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(incoming)) {
        if (!TOUR_PATCH_KEYS.has(k)) continue
        if (k === 'step') {
          const n = Number(v)
          if (Number.isFinite(n) && n >= 0) clean.step = Math.floor(n)
          continue
        }
        clean[k] = v === null ? null : String(v)
      }
      next[tourId] = { ...(current[tourId] || {}), ...clean }
    }
    patch.walkthrough_state = next
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // .select('id') so a write that matched nothing is loud here rather than
  // silently fine — the exact failure this route was built to escape. Only
  // `id` is asked for: selecting walkthrough_state back would fail the whole
  // statement pre-088 and take the onboarding fix down with it.
  const { data, error } = await supabaseAdmin
    .from('users')
    .update(patch)
    .eq('id', caller.userId)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No user row updated' }, { status: 500 })
  }
  return NextResponse.json(await readRow(caller.userId))
}

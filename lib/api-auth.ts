// ============================================================================
// lib/api-auth.ts — shared Bearer-token auth resolver for API routes.
// ============================================================================
// Several routes need the same thing: take the caller's Supabase access
// token from the Authorization header, resolve it to a user + org, and
// pull the org's plan + subscription status so the route can gate on
// entitlement. parse-drawings and invoices/[id]/pdf each grew their own
// copy of the token→org step; this lifts it into one place and adds the
// plan/plan_status lookup that entitlement gating needs.
//
// Usage in a route:
//   const caller = await resolveApiCaller(req)
//   if (!caller) return unauthorized()
//   if (!hasActiveSubscription(caller.planStatus)) return paymentRequired()
//   if (!hasAccess(caller.plan, 'schedule')) return forbidden('schedule')
// ============================================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase-admin'

export interface ApiCaller {
  orgId: string
  userId: string | null
  plan: string
  planStatus: string
}

/**
 * Resolve the caller from the `Authorization: Bearer <access_token>`
 * header. Returns null when the request is unauthenticated, the token is
 * invalid/expired, or the user has no org row yet. Callers should treat
 * null as a 401.
 */
export async function resolveApiCaller(
  req: NextRequest,
): Promise<ApiCaller | null> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) return null

  const { data: row } = await supabaseAdmin
    .from('users')
    .select('id, org_id')
    .eq('auth_user_id', data.user.id)
    .single()
  if (!row?.org_id) return null

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('plan, plan_status')
    .eq('id', row.org_id)
    .single()

  return {
    orgId: row.org_id as string,
    userId: (row as { id?: string }).id ?? null,
    plan: (org?.plan as string) ?? 'starter',
    planStatus: (org?.plan_status as string) ?? 'pending',
  }
}

// ── Standard gate responses ─────────────────────────────────────────────────
// Kept here so every route returns the same shapes/status codes.

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/** 402 Payment Required — authenticated, but the subscription isn't in
 *  good standing (pending / canceled / incomplete). */
export function paymentRequired() {
  return NextResponse.json(
    { error: 'Subscription is not active.' },
    { status: 402 },
  )
}

/** 403 Forbidden — authenticated and paid, but the plan tier doesn't
 *  include the requested feature. */
export function forbidden(feature: string) {
  return NextResponse.json(
    { error: `Your plan does not include this feature (${feature}).` },
    { status: 403 },
  )
}

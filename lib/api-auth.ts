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
  role: string
  plan: string
  planStatus: string
  trialEndsAt: string | null
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
    .select('id, org_id, role')
    .eq('auth_user_id', data.user.id)
    .single()
  if (!row?.org_id) return null

  const { data: org } = await supabaseAdmin
    .from('orgs')
    .select('plan, plan_status, trial_ends_at')
    .eq('id', row.org_id)
    .single()

  return {
    orgId: row.org_id as string,
    userId: (row as { id?: string }).id ?? null,
    role: (row as { role?: string }).role ?? 'member',
    plan: (org?.plan as string) ?? 'starter',
    planStatus: (org?.plan_status as string) ?? 'pending',
    trialEndsAt: (org?.trial_ends_at as string | null) ?? null,
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

/** 404 Not Found — used for tenant-isolation failures so we never reveal
 *  whether a resource ID belongs to another org. */
export function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/**
 * Tenant-isolation check: does this project belong to the caller's org?
 * Uses the admin client so it works in routes that don't carry an
 * RLS-scoped client. Returns false when the project is missing OR owned
 * by a different org — callers should respond 404 either way.
 */
export async function projectBelongsToOrg(
  projectId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()
  return !!data && (data as { org_id: string | null }).org_id === orgId
}

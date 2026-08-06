// lib/seats.ts
// Seat enforcement helpers. A "seat" in MillSuite = one row in the
// `users` table for the org (a login account). The owner counts as a
// seat. Team members invited via /join/[slug] also count.
//
// orgs.team_members (jsonb) is a separate concept — payroll/dept
// roster used by the shop rate calc. Those are NOT counted as seats
// today; you can have 20 people on the team_members roster but only
// 5 of them will have login accounts.
//
// PR #115 gates user creation at /api/auth/join. The signup path
// (/api/auth/setup) doesn't need a check because it always creates
// the FIRST user against fresh seats. The Stripe webhook also rejects
// downgrades that would orphan existing users (see /api/stripe-webhook).

import { supabaseAdmin } from './supabase-admin'
import { isInternalPlan } from './feature-flags'

export interface SeatStatus {
  used: number
  limit: number
  remaining: number
  atLimit: boolean
}

/** Count of users currently in the org. Service-role query — bypasses RLS
 *  so it works correctly from server routes. */
export async function getUsedSeats(orgId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) {
    console.error('getUsedSeats error:', error)
    return 0
  }
  return count ?? 0
}

/** Sentinel limit for orgs that don't buy seats (internal / founder tier).
 *  Big enough to never bind, small enough to print without looking absurd. */
export const UNLIMITED_SEATS = 9999

/** Configured seat limit on the org row. Set by the Stripe webhook
 *  whenever the subscription's quantity changes. Internal orgs aren't
 *  customers, so they aren't seat-limited at all. */
export async function getOrgSeatLimit(orgId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('orgs')
    .select('seats, plan')
    .eq('id', orgId)
    .single()
  if (error || !data) {
    console.error('getOrgSeatLimit error:', error)
    return 1
  }
  if (isInternalPlan(data.plan)) return UNLIMITED_SEATS
  return data.seats ?? 1
}

/** Single combined check — returns used / limit / remaining / atLimit. */
export async function getSeatStatus(orgId: string): Promise<SeatStatus> {
  const [used, limit] = await Promise.all([
    getUsedSeats(orgId),
    getOrgSeatLimit(orgId),
  ])
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining, atLimit: used >= limit }
}

/** Convenience predicate for "can this org add another user right now?" */
export async function canAddSeat(orgId: string): Promise<boolean> {
  const status = await getSeatStatus(orgId)
  return !status.atLimit
}

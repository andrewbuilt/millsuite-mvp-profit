// ============================================================================
// lib/pto.ts — PTO requests, policies, balances (chunk B)
// ============================================================================
// Workers request time off; owners approve/deny on /team. Approving a
// request writes one capacity_overrides row per weekday in the range so
// /capacity + /schedule subtract those days automatically (045). Denying or
// deleting removes them. team_member_id is the orgs.team_members jsonb id,
// the same identity capacity_overrides uses.
// ============================================================================

import { supabase } from './supabase'
import { memberDailyHours, type TeamMember } from './shop-rate-setup'

export type PtoReason = 'PTO' | 'Sick' | 'Personal' | 'Other'
export type PtoStatus = 'pending' | 'approved' | 'denied'

export interface PtoRequest {
  id: string
  org_id: string
  team_member_id: string
  start_date: string
  end_date: string
  reason: PtoReason
  status: PtoStatus
  notes: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

export interface PtoBand {
  min_years: number
  max_years: number
  days_per_year: number
}

export interface PtoPolicy {
  id: string
  org_id: string
  name: string
  is_default: boolean
  rules: PtoBand[]
  notes: string | null
  created_at: string
}

export function defaultBands(): PtoBand[] {
  return [
    { min_years: 0, max_years: 1, days_per_year: 5 },
    { min_years: 1, max_years: 3, days_per_year: 10 },
    { min_years: 3, max_years: 100, days_per_year: 15 },
  ]
}

// ── Date helpers (weekday-based; capacity only counts Mon–Fri) ──

/** Every Mon–Fri ISO date in [start, end] inclusive. */
export function weekdaysInRange(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const start = new Date(startISO + 'T12:00:00Z')
  const end = new Date(endISO + 'T12:00:00Z')
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function countWeekdays(startISO: string, endISO: string): number {
  return weekdaysInRange(startISO, endISO).length
}

/** Tenure in years from a start date to `asOf` (default today via the
 *  passed reference — callers pass today's ISO to keep this pure). */
export function tenureYears(startDate: string | null | undefined, asOfISO: string): number {
  if (!startDate) return 0
  const s = new Date(startDate + 'T00:00:00Z')
  const e = new Date(asOfISO + 'T00:00:00Z')
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0
  return (e.getTime() - s.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}

/** Allowed PTO days from the policy band matching the member's tenure. */
export function allowanceDays(
  startDate: string | null | undefined,
  policy: PtoPolicy | null,
  asOfISO: string,
): number {
  if (!policy?.rules?.length) return 0
  const years = tenureYears(startDate, asOfISO)
  const band = policy.rules.find((r) => years >= r.min_years && years < r.max_years)
  return band?.days_per_year ?? 0
}

/** The start of the member's current anniversary year (used to scope
 *  "used" days). Falls back to Jan 1 of the current year when no start
 *  date is set. */
export function anniversaryYearStart(
  startDate: string | null | undefined,
  asOfISO: string,
): string {
  const asOf = new Date(asOfISO + 'T00:00:00Z')
  if (!startDate) return `${asOf.getUTCFullYear()}-01-01`
  const s = new Date(startDate + 'T00:00:00Z')
  if (isNaN(s.getTime())) return `${asOf.getUTCFullYear()}-01-01`
  const anniv = new Date(Date.UTC(asOf.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
  if (anniv > asOf) anniv.setUTCFullYear(anniv.getUTCFullYear() - 1)
  return anniv.toISOString().slice(0, 10)
}

export interface PtoBalance {
  allowed: number
  used: number
  pending: number
  remaining: number
}

/** Balance for one member: allowed (from tenure band) vs used (approved
 *  weekdays this anniversary year) and pending (weekdays awaiting review). */
export function computeBalance(
  member: Pick<TeamMember, 'id' | 'start_date'>,
  policy: PtoPolicy | null,
  requests: PtoRequest[],
  asOfISO: string,
): PtoBalance {
  const allowed = allowanceDays(member.start_date, policy, asOfISO)
  const yearStart = anniversaryYearStart(member.start_date, asOfISO)
  const mine = requests.filter((r) => r.team_member_id === member.id)
  const used = mine
    .filter((r) => r.status === 'approved' && r.start_date >= yearStart)
    .reduce((s, r) => s + countWeekdays(r.start_date, r.end_date), 0)
  const pending = mine
    .filter((r) => r.status === 'pending')
    .reduce((s, r) => s + countWeekdays(r.start_date, r.end_date), 0)
  return { allowed, used, pending, remaining: Math.max(0, allowed - used) }
}

// ── IO ──

export async function loadPtoRequests(orgId: string): Promise<PtoRequest[]> {
  const { data } = await supabase
    .from('pto_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  return (data || []) as PtoRequest[]
}

/** The org's default policy, seeding one with default bands if none exists. */
export async function loadOrCreateDefaultPolicy(orgId: string): Promise<PtoPolicy> {
  const { data } = await supabase
    .from('pto_policies')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .order('created_at', { ascending: false })
    .limit(1)
  const existing = (data || [])[0] as PtoPolicy | undefined
  if (existing) return existing
  const { data: created, error } = await supabase
    .from('pto_policies')
    .insert({ org_id: orgId, name: 'Standard', is_default: true, rules: defaultBands() })
    .select('*')
    .single()
  if (error) throw error
  return created as PtoPolicy
}

export async function savePolicyRules(policyId: string, rules: PtoBand[]): Promise<void> {
  const { error } = await supabase.from('pto_policies').update({ rules }).eq('id', policyId)
  if (error) throw error
}

export async function createPtoRequest(args: {
  orgId: string
  teamMemberId: string
  startDate: string
  endDate: string
  reason: PtoReason
  notes?: string | null
}): Promise<void> {
  const { error } = await supabase.from('pto_requests').insert({
    org_id: args.orgId,
    team_member_id: args.teamMemberId,
    start_date: args.startDate,
    end_date: args.endDate,
    reason: args.reason,
    status: 'pending',
    notes: args.notes ?? null,
  })
  if (error) throw error
}

/** Remove the capacity_overrides this request would have written (used on
 *  deny/delete, and before a re-approve to avoid duplicates). */
async function clearOverridesFor(req: PtoRequest): Promise<void> {
  const days = weekdaysInRange(req.start_date, req.end_date)
  if (days.length === 0) return
  await supabase
    .from('capacity_overrides')
    .delete()
    .eq('org_id', req.org_id)
    .eq('team_member_id', req.team_member_id)
    .in('override_date', days)
}

/** Approve: flip status + write one capacity_overrides row per weekday. The
 *  per-day hours_reduction is the member's own daily hours so /capacity
 *  subtracts the right amount. */
export async function approvePtoRequest(
  req: PtoRequest,
  approvedByUserId: string,
  member: TeamMember | undefined,
  orgHrsPerWeek: number,
): Promise<void> {
  await clearOverridesFor(req)
  const days = weekdaysInRange(req.start_date, req.end_date)
  const hoursReduction = member ? memberDailyHours(member, orgHrsPerWeek) : 0
  if (days.length > 0) {
    const rows = days.map((d) => ({
      org_id: req.org_id,
      override_date: d,
      team_member_id: req.team_member_id,
      reason: req.reason || 'PTO',
      hours_reduction: hoursReduction,
      is_full_day: true,
    }))
    const { error } = await supabase.from('capacity_overrides').insert(rows)
    if (error) throw error
  }
  const { error: updErr } = await supabase
    .from('pto_requests')
    .update({ status: 'approved', approved_by: approvedByUserId, approved_at: new Date().toISOString() })
    .eq('id', req.id)
  if (updErr) throw updErr
}

export async function denyPtoRequest(req: PtoRequest, approvedByUserId: string): Promise<void> {
  await clearOverridesFor(req)
  const { error } = await supabase
    .from('pto_requests')
    .update({ status: 'denied', approved_by: approvedByUserId, approved_at: new Date().toISOString() })
    .eq('id', req.id)
  if (error) throw error
}

export async function deletePtoRequest(req: PtoRequest): Promise<void> {
  await clearOverridesFor(req)
  const { error } = await supabase.from('pto_requests').delete().eq('id', req.id)
  if (error) throw error
}

// lib/shop-rate-setup.ts - first-principles shop rate compute + IO.
// Spec: mockups/shop-rate-setup-mockup.html (canonical). BUILD-ORDER Phase 12 item 12.
//
// Four walkthrough screens capture three input groups, which persist to
// the jsonb columns added in migration 022. The Result screen derives
// a blended shop rate and writes the user's chosen value to
// orgs.shop_rate (existing column).
//
//   annual_overhead    = Σ overhead_inputs (monthly × 12 + annuals)
//   annual_team_comp   = Σ team_members.annual_comp
//   billable_hours_yr  = hrs_per_week × weeks_per_year × utilization%
//   derived_shop_rate  = (annual_overhead + annual_team_comp) / billable_hours_yr
//
// Re-entry: show derived alongside current orgs.shop_rate; user picks
// each time. No persistent "is this an override" flag — see migration
// 022 header for rationale.

import { supabase } from './supabase'
import { updateOrgChecked } from './org-write'
import { mergeTeam } from './team-merge'

export type Period = 'monthly' | 'annual'

export interface OverheadInput {
  amount: number
  period: Period
}

export type OverheadInputs = Record<string, OverheadInput>

export interface TeamMember {
  id: string
  name: string
  annual_comp: number
  /** Whether this person's time gets billed to jobs. Owner admin time,
   *  office managers = false; everyone touching production = true. Drives
   *  billable_hours_year's people multiplier. Non-billable still counts
   *  toward total payroll cost (the numerator). */
  billable: boolean
  /** Department assignments — array of departments.id (UUID). Single
   *  source of truth for schedule capacity per dept: a billable member
   *  contributes `hours_per_week / 5` hours per working day to every dept
   *  they're assigned to (see deptDailyHoursByTeam). Replaces the legacy
   *  split where /team wrote department_members rows + the schedule read
   *  those rows for capacity. The walkthrough doesn't populate this —
   *  defaults to []. */
  dept_assignments: string[]
  /** Optional FK to users.id, kept for time-tracking surfaces that
   *  reference users (clock-in, time_entries.user_id). Set when /team
   *  creates a login for this person (the account is the one explicit
   *  bridge). NULL for payroll-only members. */
  user_id?: string | null
  // ── Depth fields (chunk A1). All optional/backfilled so pre-existing
  // jsonb rows keep working; the /team edit pane fills them in. ──
  /** Contact email. Also seeds the login email when an account is created. */
  email?: string | null
  phone?: string | null
  title?: string | null
  /** ISO date (YYYY-MM-DD). Drives PTO tenure bands (chunk B). */
  start_date?: string | null
  /** Per-person scheduled hours/week. Feeds BOTH the shop-rate billable
   *  denominator and per-dept capacity (hours_per_week / 5 per working
   *  day). Defaults from the org billable inputs (40) so existing members
   *  compute exactly as before. */
  hours_per_week?: number
  /** Active on the roster. Inactive members drop out of capacity, the
   *  shop-rate denominator, and the worker app. Defaults true. */
  active?: boolean
}

/** Standard work week used to convert a per-person weekly hours figure
 *  into a per-working-day rate for capacity math. */
export const WORK_DAYS_PER_WEEK = 5

/** A member's scheduled hours per working day (hours_per_week / 5).
 *  Falls back to the org default (40/wk → 8/day) when unset. */
export function memberDailyHours(m: TeamMember, defaultHrsPerWeek = 40): number {
  const hpw = Number(m.hours_per_week) || defaultHrsPerWeek
  return hpw / WORK_DAYS_PER_WEEK
}

/** Per-dept daily capacity hours from the team roster: the sum, over active
 *  billable members assigned to each dept, of their per-day hours. This is
 *  the single source both /capacity and /schedule use in place of the old
 *  `headcount × dept.hours_per_day`. */
export function deptDailyHoursByTeam(
  team: TeamMember[],
  defaultHrsPerWeek = 40,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of team || []) {
    if (!m.billable) continue
    if (m.active === false) continue
    const daily = memberDailyHours(m, defaultHrsPerWeek)
    if (daily <= 0) continue
    for (const deptId of m.dept_assignments || []) {
      out[deptId] = (out[deptId] || 0) + daily
    }
  }
  return out
}

export interface BillableHoursInputs {
  hrs_per_week: number
  weeks_per_year: number
  utilization_pct: number
}

export const DEFAULT_OVERHEAD_CATEGORIES: string[] = [
  'Rent',
  'Utilities',
  'Insurance',
  'Software',
  'Vehicle',
  'Shop consumables',
  'Tools',
  'Other',
]
// "Admin" is intentionally not a default overhead line. Owner admin time
// and office-manager salary belong on the Team list with billable=false
// so they flow into the numerator without inflating billable hours.

export function emptyOverheadInputs(): OverheadInputs {
  const out: OverheadInputs = {}
  for (const c of DEFAULT_OVERHEAD_CATEGORIES) {
    out[c] = { amount: 0, period: 'monthly' }
  }
  return out
}

export function defaultBillableHoursInputs(): BillableHoursInputs {
  return { hrs_per_week: 40, weeks_per_year: 48, utilization_pct: 70 }
}

export function makeTeamMember(
  name = '',
  annual_comp = 0,
  billable = true
): TeamMember {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return { id, name, annual_comp, billable, dept_assignments: [], active: true }
}

/** Floor of 1 so an empty-team state doesn't divide by zero in the
 *  derived rate calc. The Result screen still surfaces the zero-state
 *  honestly via the math breakdown text. Inactive members are excluded. */
export function countBillable(team: TeamMember[]): number {
  return (team || []).filter((m) => m.billable && m.active !== false).length || 1
}

export function normalizeOverheadAnnual(i: OverheadInput): number {
  const a = Number(i.amount) || 0
  return i.period === 'monthly' ? a * 12 : a
}

export function sumOverheadAnnual(inputs: OverheadInputs): number {
  let total = 0
  for (const key of Object.keys(inputs || {})) {
    total += normalizeOverheadAnnual(inputs[key])
  }
  return total
}

export function sumTeamAnnualComp(team: TeamMember[]): number {
  let total = 0
  // Inactive members aren't on payroll, so they leave the numerator too.
  for (const m of team || []) {
    if (m.active === false) continue
    total += Number(m.annual_comp) || 0
  }
  return total
}

/** Legacy uniform billable-hours calc (everyone at the org hrs/week).
 *  Kept for the onboarding walkthrough + settings display; the derived
 *  rate itself now uses the per-person sumBillableHoursYear below. For a
 *  team where nobody overrides hours_per_week the two agree exactly. */
export function computeBillableHoursYear(
  b: BillableHoursInputs,
  billablePeople: number
): number {
  const hpw = Number(b?.hrs_per_week) || 0
  const wpy = Number(b?.weeks_per_year) || 0
  const util = Number(b?.utilization_pct) || 0
  const n = Math.max(1, Number(billablePeople) || 0)
  return n * hpw * wpy * (util / 100)
}

/** Per-person billable hours/year: sum each active billable member's own
 *  hours_per_week (falling back to the org default) × weeks × utilization.
 *  This is the denominator the derived shop rate uses. */
export function sumBillableHoursYear(
  team: TeamMember[],
  b: BillableHoursInputs
): number {
  const wpy = Number(b?.weeks_per_year) || 0
  const util = Number(b?.utilization_pct) || 0
  const defHpw = Number(b?.hrs_per_week) || 0
  let total = 0
  for (const m of team || []) {
    if (!m.billable) continue
    if (m.active === false) continue
    const hpw = Number(m.hours_per_week) || defHpw
    total += hpw * wpy * (util / 100)
  }
  return total
}

export function computeDerivedShopRate(
  overhead: OverheadInputs,
  team: TeamMember[],
  billable: BillableHoursInputs
): number {
  const hours = sumBillableHoursYear(team, billable)
  if (hours <= 0) return 0
  // Numerator is ALL payroll + ALL overhead — non-billable people still
  // cost money. The billable flag only shapes the denominator.
  return (sumOverheadAnnual(overhead) + sumTeamAnnualComp(team)) / hours
}

// ── Storage ──

export interface ShopRateSetup {
  shopRate: number
  overhead: OverheadInputs
  team: TeamMember[]
  billable: BillableHoursInputs
}

export async function loadShopRateSetup(
  orgId: string,
  client: typeof supabase = supabase,
): Promise<ShopRateSetup> {
  const { data, error } = await client
    .from('orgs')
    .select('shop_rate, overhead_inputs, team_members, billable_hours_inputs')
    .eq('id', orgId)
    .single()
  if (error) throw error
  const row = (data || {}) as {
    shop_rate: number | null
    overhead_inputs: OverheadInputs | null
    team_members: Array<Partial<TeamMember>> | null
    billable_hours_inputs: BillableHoursInputs | null
  }
  const team = normalizeTeamMembers(row.team_members ?? [])
  return {
    shopRate: Number(row.shop_rate) || 0,
    overhead: row.overhead_inputs ?? emptyOverheadInputs(),
    team,
    billable: row.billable_hours_inputs ?? defaultBillableHoursInputs(),
  }
}

/**
 * Stored jsonb → the TeamMember shape the app works with.
 *
 * Backfills billable=true for members predating the flag (only an explicit
 * `false` persists), and dept_assignments=[] for those predating the jsonb
 * dept-assignment migration (the schedule reads missing as "no dept", i.e.
 * zero capacity). Exported because the merge path has to normalize the
 * server's copy the same way the loader does — otherwise a field would look
 * "changed" purely because one side was undefined and the other null.
 */
export function normalizeTeamMembers(
  raw: Array<Partial<TeamMember>>,
): TeamMember[] {
  return (raw ?? []).map((m) => ({
    id: String(m.id ?? makeTeamMember().id),
    name: String(m.name ?? ''),
    annual_comp: Number(m.annual_comp) || 0,
    billable: m.billable === false ? false : true,
    dept_assignments: Array.isArray((m as { dept_assignments?: unknown }).dept_assignments)
      ? ((m as { dept_assignments: unknown[] }).dept_assignments).map(String)
      : [],
    user_id: m.user_id ? String(m.user_id) : null,
    // Depth fields (chunk A1) — undefined on pre-existing rows; the edit
    // pane fills them. active defaults true so old members stay counted.
    email: m.email ? String(m.email) : null,
    phone: m.phone ? String(m.phone) : null,
    title: m.title ? String(m.title) : null,
    start_date: m.start_date ? String(m.start_date) : null,
    hours_per_week:
      m.hours_per_week != null && String(m.hours_per_week).trim() !== ''
        ? Number(m.hours_per_week)
        : undefined,
    active: m.active === false ? false : true,
  }))
}

export async function saveShopRateInputs(
  orgId: string,
  patch: Partial<{
    overhead: OverheadInputs
    team: TeamMember[]
    billable: BillableHoursInputs
  }>
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.overhead !== undefined) update.overhead_inputs = patch.overhead
  if (patch.team !== undefined) update.team_members = patch.team
  if (patch.billable !== undefined) update.billable_hours_inputs = patch.billable
  if (Object.keys(update).length === 0) return
  await updateOrgChecked(orgId, update)
}

export async function saveShopRate(orgId: string, rate: number): Promise<void> {
  await updateOrgChecked(orgId, { shop_rate: rate })
}

/**
 * Save the roster WITHOUT clobbering edits made elsewhere.
 *
 * `team_members` is a single jsonb column that both /team and /settings edit,
 * and both used to write their whole array — so whichever saved last silently
 * reverted everything the other had changed since it loaded. Observed live: a
 * title went "sdff" → "New test title" → back to "sdff".
 *
 * Instead: re-read the row at write time and three-way merge (see
 * lib/team-merge). Only fields this page actually changed are applied; anything
 * it never touched keeps the server's value.
 *
 * @param base the roster this page loaded — the merge needs it to tell an edit
 *             from an untouched field. Null falls back to a plain overwrite.
 */
export async function saveTeamMembersMerged(
  orgId: string,
  base: TeamMember[] | null,
  next: TeamMember[],
): Promise<void> {
  if (!base) {
    await updateOrgChecked(orgId, { team_members: next })
    return
  }
  const { data, error } = await supabase
    .from('orgs')
    .select('team_members')
    .eq('id', orgId)
    .single()
  // Can't see the current value (RLS, transient failure) — writing our whole
  // array here is exactly the clobber this function exists to prevent, so bail
  // loudly and let the caller surface it.
  if (error) throw error
  const current = normalizeTeamMembers(
    (data?.team_members as Array<Partial<TeamMember>> | null) ?? [],
  )
  await updateOrgChecked(orgId, { team_members: mergeTeam(base, next, current) })
}

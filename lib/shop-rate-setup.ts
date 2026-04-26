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
  /** Optional FK to users.id. The walkthrough doesn't set it; the Team
   *  page does, on first dept-assignment toggle, by auto-creating a users
   *  row whose name matches. Lets one TeamMember row carry both the
   *  shop-rate inputs (here) and the dept assignments (department_members
   *  via users.id). NULL when this team member isn't being used for
   *  scheduling — they're a payroll-only line item. */
  user_id?: string | null
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
  return { id, name, annual_comp, billable }
}

/** Floor of 1 so an empty-team state doesn't divide by zero in the
 *  derived rate calc. The Result screen still surfaces the zero-state
 *  honestly via the math breakdown text. */
export function countBillable(team: TeamMember[]): number {
  return (team || []).filter((m) => m.billable).length || 1
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
  for (const m of team || []) total += Number(m.annual_comp) || 0
  return total
}

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

export function computeDerivedShopRate(
  overhead: OverheadInputs,
  team: TeamMember[],
  billable: BillableHoursInputs
): number {
  const hours = computeBillableHoursYear(billable, countBillable(team))
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

export async function loadShopRateSetup(orgId: string): Promise<ShopRateSetup> {
  const { data, error } = await supabase
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
  // Backfill billable=true on any member that predates the flag.
  // Only an explicit `false` persists a non-billable state.
  const team: TeamMember[] = (row.team_members ?? []).map((m) => ({
    id: String(m.id ?? makeTeamMember().id),
    name: String(m.name ?? ''),
    annual_comp: Number(m.annual_comp) || 0,
    billable: m.billable === false ? false : true,
    user_id: m.user_id ? String(m.user_id) : null,
  }))
  return {
    shopRate: Number(row.shop_rate) || 0,
    overhead: row.overhead_inputs ?? emptyOverheadInputs(),
    team,
    billable: row.billable_hours_inputs ?? defaultBillableHoursInputs(),
  }
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
  const { error } = await supabase.from('orgs').update(update).eq('id', orgId)
  if (error) throw error
}

export async function saveShopRate(orgId: string, rate: number): Promise<void> {
  const { error } = await supabase.from('orgs').update({ shop_rate: rate }).eq('id', orgId)
  if (error) throw error
}

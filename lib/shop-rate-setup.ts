// lib/shop-rate-setup.ts - first-principles shop rate compute + IO.
// Per BUILD-ORDER Phase 12 item 12 + specs/shop-rate-setup/.
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
  'Admin',
  'Other',
]

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

export function makeTeamMember(name = '', annual_comp = 0): TeamMember {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return { id, name, annual_comp }
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

export function computeBillableHoursYear(b: BillableHoursInputs): number {
  const hpw = Number(b?.hrs_per_week) || 0
  const wpy = Number(b?.weeks_per_year) || 0
  const util = Number(b?.utilization_pct) || 0
  return hpw * wpy * (util / 100)
}

export function computeDerivedShopRate(
  overhead: OverheadInputs,
  team: TeamMember[],
  billable: BillableHoursInputs
): number {
  const hours = computeBillableHoursYear(billable)
  if (hours <= 0) return 0
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
    team_members: TeamMember[] | null
    billable_hours_inputs: BillableHoursInputs | null
  }
  return {
    shopRate: Number(row.shop_rate) || 0,
    overhead: row.overhead_inputs ?? emptyOverheadInputs(),
    team: row.team_members ?? [],
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

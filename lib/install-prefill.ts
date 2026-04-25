// ============================================================================
// lib/install-prefill.ts — subproject-level install prefill compute + IO.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 9 + specs/add-line-composer/README.md.
//
// Install labor sits at the subproject level, NOT on estimate_lines. Three
// inputs:
//
//   - install_guys            integer  — installers on the job
//   - install_days            numeric  — estimated days on site
//   - install_complexity_pct  numeric  — flat % markup for elevator, 2nd-
//                                         floor stairs, long carry, etc.
//
// Formula:
//   guys × days × 8 (hrs/day) × orgs.shop_rate × (1 + pct/100)
//
// The 8 hrs/day assumption is implicit in the spec (shop rate is hourly).
// A full day on site = 8 billable hours; the markup % is where elevator /
// stairs / tight-stairwell bumps land so the hours stay truthful.
//
// NULL on any of the three inputs = "not configured" → install cost = 0,
// the prefill block still shows for the user to fill in.
// ============================================================================

import { supabase } from './supabase'
import { recomputeProjectBidTotalForSubproject } from './project-totals'

export interface InstallPrefill {
  guys: number | null
  days: number | null
  complexityPct: number | null
}

export function emptyInstallPrefill(): InstallPrefill {
  return { guys: null, days: null, complexityPct: null }
}

const HOURS_PER_DAY = 8

/**
 * Install cost rolled up from the three subproject columns + the org's
 * install labor rate. Returns 0 whenever any input is NULL / <=0 —
 * partial state = no contribution to subproject total.
 */
export function computeInstallCost(
  prefill: InstallPrefill,
  installRatePerHour: number
): number {
  const g = Number(prefill.guys) || 0
  const d = Number(prefill.days) || 0
  const pct = Number(prefill.complexityPct) || 0
  const rate = Number(installRatePerHour) || 0
  if (g <= 0 || d <= 0 || rate <= 0) return 0
  const base = g * d * HOURS_PER_DAY * rate
  return base * (1 + pct / 100)
}

export function computeInstallHours(prefill: InstallPrefill): number {
  const g = Number(prefill.guys) || 0
  const d = Number(prefill.days) || 0
  if (g <= 0 || d <= 0) return 0
  return g * d * HOURS_PER_DAY
}

// ── Storage ──

export async function loadInstallPrefill(subprojectId: string): Promise<InstallPrefill> {
  const { data } = await supabase
    .from('subprojects')
    .select('install_guys, install_days, install_complexity_pct')
    .eq('id', subprojectId)
    .single()
  const row = (data || {}) as {
    install_guys: number | null
    install_days: number | null
    install_complexity_pct: number | null
  }
  return {
    guys: row.install_guys ?? null,
    days: row.install_days != null ? Number(row.install_days) : null,
    complexityPct:
      row.install_complexity_pct != null ? Number(row.install_complexity_pct) : null,
  }
}

export async function saveInstallPrefill(
  subprojectId: string,
  prefill: InstallPrefill
): Promise<void> {
  const { error } = await supabase
    .from('subprojects')
    .update({
      install_guys: prefill.guys,
      install_days: prefill.days,
      install_complexity_pct: prefill.complexityPct,
    })
    .eq('id', subprojectId)
  if (error) {
    console.error('saveInstallPrefill', error)
    throw error
  }
  // Pricing-input write-back (see lib/project-totals.ts contract).
  void recomputeProjectBidTotalForSubproject(subprojectId)
}

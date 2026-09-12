// ============================================================================
// lib/sales-goal-data.ts — loading and saving the goal settings.
// ============================================================================
// Split from lib/sales-goal so the MATH stays pure and testable without
// credentials. This half touches the database; that half never does.
//
// ⛔ THE SELECT IS ISOLATED ON PURPOSE — DO NOT FOLD THESE THREE COLUMNS INTO
// `ORG_SELECT` IN lib/auth-context. PostgREST fails the WHOLE select on one
// unknown column (42703), so before migration 101 lands on a given database,
// adding them there would take down sign-in for every user — org load is on
// the auth path. Isolated, a pre-101 database just makes this one query fail
// and the goal reads as "not set up", which is exactly right.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { awaitPendingOrgWrites, updateOrgChecked } from '@/lib/org-write'

export interface GoalSettings {
  materialPct: number | null
  profitPct: number | null
  /** Dollars/month. Null ⇒ derive from the shop-rate setup. */
  fixedMonthlyOverride: number | null
  /** True when migration 101 hasn't run. Callers should show the nudge, not
   *  an error — the feature simply isn't there yet. */
  missing: boolean
}

const EMPTY: GoalSettings = {
  materialPct: null,
  profitPct: null,
  fixedMonthlyOverride: null,
  missing: false,
}

/** True when PostgREST is telling us the column isn't there.
 *  ⚠️ READS report 42703; WRITES report PGRST204 with a different message.
 *  Both, or the save throws a raw error at the user. */
function isMissingColumn(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  const code = e.code || ''
  if (code === '42703' || code === 'PGRST204' || code === '42P01') return true
  return /does not exist|could not find the/i.test(e.message || '')
}

export async function loadGoalSettings(orgId: string): Promise<GoalSettings> {
  // Let any in-flight org write land first. Every other reader of `orgs` does
  // this (settings, team) — without it, arriving on a page straight after a
  // save can read the pre-save row. See lib/org-write.
  await awaitPendingOrgWrites()

  const { data, error } = await supabase
    .from('orgs')
    .select('goal_material_pct, goal_profit_pct, goal_fixed_monthly_override')
    .eq('id', orgId)
    .maybeSingle()

  if (error) {
    if (isMissingColumn(error)) {
      console.warn('loadGoalSettings: migration 101 has not been run.')
      return { ...EMPTY, missing: true }
    }
    console.error('loadGoalSettings', error)
    return EMPTY
  }

  const r = (data || {}) as Record<string, unknown>
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v)

  return {
    materialPct: num(r.goal_material_pct),
    profitPct: num(r.goal_profit_pct),
    fixedMonthlyOverride: num(r.goal_fixed_monthly_override),
    missing: false,
  }
}

export async function saveGoalSettings(
  orgId: string,
  patch: Partial<Omit<GoalSettings, 'missing'>>,
): Promise<void> {
  const update: Record<string, unknown> = {}
  if ('materialPct' in patch) update.goal_material_pct = patch.materialPct
  if ('profitPct' in patch) update.goal_profit_pct = patch.profitPct
  if ('fixedMonthlyOverride' in patch) {
    update.goal_fixed_monthly_override = patch.fixedMonthlyOverride
  }
  if (Object.keys(update).length === 0) return
  // updateOrgChecked selects the row back and throws on zero rows — a blocked
  // write is otherwise indistinguishable from a successful one.
  try {
    await updateOrgChecked(orgId, update)
  } catch (e) {
    // ⛔ THE WRITE-SIDE MISSING-COLUMN MESSAGE IS DIFFERENT FROM THE READ ONE
    // and this is where it's caught. PostgREST answers a read with 42703
    // ("column does not exist") and a write with PGRST204 ("Could not find
    // the 'x' column in the schema cache"). Matching only the read code left
    // the raw PostgREST error to surface verbatim at the user.
    if (isMissingColumn(e as { code?: string; message?: string })) {
      throw new Error(
        'The sales goal needs migration 101, which has not been run on this database yet.',
      )
    }
    throw e
  }
}

export interface SoldJobSample {
  price: number
  materialCost: number
}

export interface MaterialSamples {
  samples: SoldJobSample[]
  /** How many finished jobs were examined, before the ones with no bills were
   *  dropped. The card said "your last 3 jobs" when it meant "3 of the last
   *  10 had bills entered". */
  considered: number
}

/**
 * Material cost ÷ price over recently sold jobs, for the "your last N jobs
 * averaged X%" hint.
 *
 * ⚠️ MATERIAL COST HERE IS VENDOR INVOICES (`invoices.total_amount`), which
 * is what the shop has actually been billed for stuff. It is NOT the
 * estimate's material bucket — that's what the shop THOUGHT material would
 * be, and suggesting a target from an estimate would just feed the estimate's
 * own assumption back to itself.
 */
export async function loadSoldJobMaterialSamples(
  orgId: string,
  limit = 10,
): Promise<MaterialSamples> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, bid_total, sold_at')
    .eq('org_id', orgId)
    // ⛔ FINISHED JOBS ONLY, AND THAT IS THE WHOLE POINT OF THIS QUERY.
    // Vendor bills arrive across a job's life, so an in-flight job has most
    // of its price and only some of its material — and because the average is
    // weighted by price, one big barely-billed job dominates. Sampling
    // sold/production/installed understated material by ~2/3 in a worked
    // example (10.5% against a true 32.2%), which would have understated the
    // monthly goal by nearly a third. A job is only evidence about material
    // share once its bills have stopped coming.
    .eq('stage', 'complete')
    .not('sold_at', 'is', null)
    .order('sold_at', { ascending: false })
    .limit(limit)

  if (error || !projects?.length) {
    if (error) console.error('loadSoldJobMaterialSamples', error)
    return { samples: [], considered: 0 }
  }

  const ids = projects.map((p) => p.id)
  const { data: invoices } = await supabase
    .from('invoices')
    .select('project_id, total_amount')
    .in('project_id', ids)

  const materialByProject = new Map<string, number>()
  for (const inv of invoices || []) {
    const id = String(inv.project_id)
    materialByProject.set(id, (materialByProject.get(id) ?? 0) + (Number(inv.total_amount) || 0))
  }

  const samples = projects
    .map((p) => ({
      price: Number(p.bid_total) || 0,
      materialCost: materialByProject.get(String(p.id)) ?? 0,
    }))
    // A job with no vendor invoices says nothing about material share — it
    // would drag the suggestion toward zero on a shop that simply hasn't
    // entered its bills.
    .filter((s) => s.price > 0 && s.materialCost > 0)

  return { samples, considered: projects.length }
}

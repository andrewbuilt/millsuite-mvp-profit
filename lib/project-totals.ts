// ============================================================================
// lib/project-totals.ts — recompute and persist projects.bid_total.
// ============================================================================
// `projects.bid_total` is a denormalized cache of the live priceTotal that
// the project page computes from estimate_lines + install prefills + the
// project-level target margin. Pricing-architecture cleanup (#38) makes
// priceTotal the single canonical project price; this module gives every
// mutation path a one-line way to keep bid_total in sync.
//
// Why a denorm: every list / header surface (sales card, kanban,
// /projects card, dashboard report, pre-prod header) reads bid_total
// directly. Recomputing on each render would mean loading lines + the
// composer rate book + install prefills per row — too expensive. The
// trade-off is "the column lies if anyone forgets to call recompute."
// To prevent that, every mutation path that affects pricing inputs
// MUST call recomputeProjectBidTotal{ForSubproject,ForLine,…} after
// the underlying write succeeds. SYSTEM-MAP.md keeps the canonical
// list.
//
// The math is deliberately a duplicate of the project page's `proj`
// useMemo (app/(app)/projects/[id]/page.tsx). If you change one, change
// both. A future refactor can lift both into a shared pure helper.
// ============================================================================

import { supabase } from './supabase'
import {
  computeSubprojectRollup,
  loadEstimateLines,
  loadRateBook,
  type PricingContext,
} from './estimate-lines'
import { computeInstallCost, computeInstallHours } from './install-prefill'

const EPSILON_DOLLARS = 1

interface ProjectRow {
  id: string
  org_id: string | null
  bid_total: number | null
  target_margin_pct: number | null
}

interface SubRow {
  id: string
  consumable_markup_pct: number | null
  install_guys: number | null
  install_days: number | null
  install_complexity_pct: number | null
}

/**
 * Compute the live priceTotal for a project and write it to
 * projects.bid_total when the diff > $1. Idempotent: a no-op when
 * already in agreement. Returns the number it wrote (or the stored
 * value if nothing changed). Logs and swallows errors — callers don't
 * need to handle them; the failure is best-effort.
 *
 * Side-effect-only contract: callers don't need to await the result
 * unless they want to surface the new total.
 */
export async function recomputeProjectBidTotal(
  projectId: string,
): Promise<number | null> {
  try {
    const { data: projData, error: projErr } = await supabase
      .from('projects')
      .select('id, org_id, bid_total, target_margin_pct')
      .eq('id', projectId)
      .single()
    if (projErr || !projData) {
      console.error('recomputeProjectBidTotal: project lookup', projErr)
      return null
    }
    const project = projData as ProjectRow
    if (!project.org_id) return Number(project.bid_total) || 0

    // Pull the org's profit_margin_pct + consumable_markup_pct + shop_rate
    // for the rollup context. Falls back to the same defaults the project
    // page uses (profit 35, consumables 10).
    const { data: orgData } = await supabase
      .from('orgs')
      .select('profit_margin_pct, consumable_markup_pct, shop_rate')
      .eq('id', project.org_id)
      .single()
    const orgProfit = Number(
      (orgData as { profit_margin_pct: number | null } | null)?.profit_margin_pct ??
        35,
    )
    const orgConsumables = Number(
      (orgData as { consumable_markup_pct: number | null } | null)
        ?.consumable_markup_pct ?? 10,
    )
    const shopRate = Number(
      (orgData as { shop_rate: number | null } | null)?.shop_rate ?? 0,
    )

    const { data: subsData } = await supabase
      .from('subprojects')
      .select(
        'id, consumable_markup_pct, install_guys, install_days, install_complexity_pct',
      )
      .eq('project_id', projectId)
    const subs = (subsData || []) as SubRow[]
    if (subs.length === 0) {
      // No subs → priceTotal of 0 means we shouldn't overwrite a
      // legitimate stored value with zero. Project might be brand-new
      // with no subs yet but a placeholder bid_total from import.
      // Safer no-op.
      return Number(project.bid_total) || 0
    }

    const rateBook = await loadRateBook(project.org_id)

    let costTotal = 0
    for (const sub of subs) {
      const lines = await loadEstimateLines(sub.id)
      const ctx: PricingContext = {
        shopRate,
        consumableMarkupPct: sub.consumable_markup_pct ?? orgConsumables,
        // Subproject rollups always run at COST. Margin lives on the
        // project markup below — same as the project page.
        profitMarginPct: 0,
      }
      const rollup = computeSubprojectRollup(lines, rateBook.itemsById, new Map(), ctx)
      const installPrefill = {
        guys: sub.install_guys,
        days: sub.install_days,
        complexityPct: sub.install_complexity_pct,
      }
      const installCost = computeInstallCost(installPrefill, shopRate)
      // computeInstallHours is read but doesn't affect priceTotal —
      // hours fold into hoursByDept; dollars come from rollup.subtotal
      // + installCost.
      void computeInstallHours(installPrefill)
      costTotal += rollup.subtotal + installCost
    }

    const marginTarget = project.target_margin_pct ?? orgProfit
    const marginFraction = Math.min(Math.max(marginTarget / 100, 0), 0.99)
    const markup = marginFraction > 0 ? 1 / (1 - marginFraction) : 1
    const priceTotal = Math.round(costTotal * markup)

    const stored = Number(project.bid_total) || 0
    if (Math.abs(stored - priceTotal) <= EPSILON_DOLLARS) return stored

    const { error: updErr } = await supabase
      .from('projects')
      .update({ bid_total: priceTotal, updated_at: new Date().toISOString() })
      .eq('id', projectId)
    if (updErr) {
      console.error('recomputeProjectBidTotal: update', updErr)
      return stored
    }
    return priceTotal
  } catch (err) {
    console.error('recomputeProjectBidTotal: unexpected', err)
    return null
  }
}

/** Convenience wrapper: resolve project_id from a subproject_id, then
 *  delegate. Returns null when the subproject can't be found. */
export async function recomputeProjectBidTotalForSubproject(
  subprojectId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('subprojects')
      .select('project_id')
      .eq('id', subprojectId)
      .single()
    if (error || !data?.project_id) {
      console.error('recomputeProjectBidTotalForSubproject: lookup', error)
      return null
    }
    return recomputeProjectBidTotal(data.project_id as string)
  } catch (err) {
    console.error('recomputeProjectBidTotalForSubproject: unexpected', err)
    return null
  }
}

/** Convenience wrapper: resolve subproject_id → project_id from an
 *  estimate_line_id, then delegate. */
export async function recomputeProjectBidTotalForLine(
  lineId: string,
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('estimate_lines')
      .select('subproject_id')
      .eq('id', lineId)
      .single()
    if (error || !data?.subproject_id) {
      console.error('recomputeProjectBidTotalForLine: lookup', error)
      return null
    }
    return recomputeProjectBidTotalForSubproject(data.subproject_id as string)
  } catch (err) {
    console.error('recomputeProjectBidTotalForLine: unexpected', err)
    return null
  }
}

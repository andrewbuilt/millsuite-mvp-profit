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
import {
  computeBucketedPrice,
  resolveBucketMargins,
  type CostBuckets,
} from './pricing'

const EPSILON_DOLLARS = 1

interface ProjectRow {
  id: string
  org_id: string | null
  bid_total: number | null
  /** Labor rate pinned to this job (migration 001 column, wired 6c). When set,
   *  it replaces the org shop rate for every cost rollup on this project, so a
   *  sold job's cost stops moving when the shop rate changes. */
  locked_shop_rate: number | null
  /** Non-null = imported from Built OS. These carry FROZEN pricing (6c-2):
   *  each line's price is Built's quoted number verbatim, so MillSuite must
   *  not re-derive it. See FROZEN_CTX below. */
  imported_at: string | null
  target_margin_pct: number | null
  labor_margin_pct: number | null
  material_margin_pct: number | null
  consumable_margin_pct: number | null
}

interface SubRow {
  id: string
  consumable_markup_pct: number | null
  install_guys: number | null
  install_days: number | null
  install_complexity_pct: number | null
  install_rate_per_hour: number | null
  install_included: boolean | null
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
      .select(
        'id, org_id, bid_total, locked_shop_rate, imported_at, target_margin_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct',
      )
      .eq('id', projectId)
      .single()
    if (projErr || !projData) {
      console.error('recomputeProjectBidTotal: project lookup', projErr)
      return null
    }
    const project = projData as ProjectRow
    if (!project.org_id) return Number(project.bid_total) || 0

    // Pull the org's consumable_markup_pct + shop_rate for the rollup
    // context, plus the three per-bucket margin defaults (migration 052).
    const { data: orgData } = await supabase
      .from('orgs')
      .select(
        'consumable_markup_pct, shop_rate, labor_margin_pct, material_margin_pct, consumable_margin_pct',
      )
      .eq('id', project.org_id)
      .single()
    const orgRow = orgData as {
      consumable_markup_pct: number | null
      shop_rate: number | null
      labor_margin_pct: number | null
      material_margin_pct: number | null
      consumable_margin_pct: number | null
    } | null
    const orgConsumables = Number(orgRow?.consumable_markup_pct ?? 10)
    // Rate precedence: the job's locked rate (pinned at sale / at import) wins
    // over the org's current rate. Without this, changing orgs.shop_rate
    // silently reprices every already-sold job — the labor cost moves, the
    // margin math follows, and subproject prices drift off what the client
    // signed. Imported jobs carry Built's rate; native jobs lock theirs when
    // they're marked sold.
    const lockedRate = Number(project.locked_shop_rate) || 0
    const shopRate = lockedRate > 0 ? lockedRate : Number(orgRow?.shop_rate ?? 0)

    // ── Imported jobs price FROZEN (6c-2) ──────────────────────────────────
    // These were quoted in Built; the price cannot vary. Each migrated line
    // carries Built's per-sub price verbatim as its material lump, so the
    // rollup must add NOTHING on top: no labor $ (hours are still preserved —
    // hoursByDept doesn't depend on the rate — so scheduling and est-vs-actual
    // still work), no consumables, no margin. Cost therefore == the quoted
    // price, and the project total lands exactly on Built's contract number.
    // Native projects are completely unaffected.
    const isImported = !!project.imported_at

    // Effective per-bucket margins: project pin → org default → 35.
    const margins = isImported
      ? { laborMarginPct: 0, materialMarginPct: 0, consumableMarginPct: 0 }
      : resolveBucketMargins(project, orgRow)

    const { data: subsData } = await supabase
      .from('subprojects')
      .select(
        'id, consumable_markup_pct, install_guys, install_days, install_complexity_pct, install_rate_per_hour, install_included',
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

    // Accumulate the six cost buckets across subs (all at COST — margin is
    // applied once below via computeBucketedPrice). Install prefill dollars
    // land in the install bucket.
    const buckets: CostBuckets = {
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      consumablesCost: 0,
      installCost: 0,
      optionsCost: 0,
    }
    for (const sub of subs) {
      const lines = await loadEstimateLines(sub.id)
      const ctx: PricingContext = {
        // Imported (frozen): zero rate + zero consumables so the line's stored
        // price is the whole number. Hours still accumulate.
        shopRate: isImported ? 0 : shopRate,
        consumableMarkupPct: isImported ? 0 : (sub.consumable_markup_pct ?? orgConsumables),
        // Subproject rollups always run at COST. Margin lives on the
        // project-level computeBucketedPrice below — same as the project page.
        profitMarginPct: 0,
      }
      const rollup = computeSubprojectRollup(lines, rateBook.itemsById, new Map(), ctx)
      const installPrefill = {
        guys: sub.install_guys,
        days: sub.install_days,
        complexityPct: sub.install_complexity_pct,
        ratePerHour: sub.install_rate_per_hour,
        included: sub.install_included ?? false,
      }
      const installPrefillCost = isImported ? 0 : computeInstallCost(installPrefill, shopRate)
      // computeInstallHours is read but doesn't affect priceTotal —
      // hours fold into hoursByDept; dollars come from the cost buckets.
      void computeInstallHours(installPrefill)
      buckets.laborCost += rollup.laborCost
      buckets.materialCost += rollup.materialCost
      buckets.hardwareCost += rollup.hardwareCost
      buckets.consumablesCost += rollup.consumablesCost
      buckets.installCost += rollup.installCost + installPrefillCost
      buckets.optionsCost += rollup.optionsCost
    }

    const priceTotal = Math.round(computeBucketedPrice(buckets, margins).priceTotal)

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

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
  type EstimateLine,
  type PricingContext,
} from './estimate-lines'
import { computeInstallCost, computeInstallHours } from './install-prefill'
import {
  addBuckets,
  computeBucketedPrice,
  emptyBuckets,
  isSubFrozen,
  priceMixedBuckets,
  resolveBucketMargins,
  resolveMarginsForNewScope,
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
  /** Migration 108. `undefined` = the column wasn't selected (pre-108 retry
   *  path), which `isSubFrozen` resolves to the old project-level answer. */
  price_frozen?: boolean | null
  /** Migration 097 — the "(QTY N)" multiplier. `undefined` = not selected
   *  (pre-097 retry path) → priced ×1, the pre-097 answer. */
  quantity?: number | null
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
    const priced = await computeProjectPrice(projectId)
    if (!priced) return null
    const { priceTotal, stored } = priced
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

/**
 * The project's price, computed exactly as recomputeProjectBidTotal would
 * write it — WITHOUT writing. `what-if` inputs let the shop-rate and
 * staleness gateways show "this quote becomes $Y" before anyone accepts:
 *   · `shopRate` replaces the project's pinned rate (live subs only; frozen
 *     subs stay at 0 either way).
 *   · `lineOverrides` patches individual estimate lines (the fresh composer
 *     values a refresh would write).
 *   · `orgShopRate` pretends the ORG's rate is this — what
 *     scripts/verify-shop-rate-change uses to prove a rate change moves
 *     nothing, without writing the real org row.
 * Returns null when the project can't be read.
 */
export async function computeProjectPrice(
  projectId: string,
  whatIf: {
    shopRate?: number
    lineOverrides?: Record<string, Partial<EstimateLine>>
    orgShopRate?: number
  } = {},
): Promise<{ priceTotal: number; stored: number } | null> {
  const { data: projData, error: projErr } = await supabase
    .from('projects')
    .select(
      'id, org_id, bid_total, locked_shop_rate, imported_at, temp_at, target_margin_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct',
    )
    .eq('id', projectId)
    .single()
  if (projErr || !projData) {
    console.error('computeProjectPrice: project lookup', projErr)
    return null
  }
  const project = projData as ProjectRow & { temp_at?: string | null }
  if (!project.org_id) return { priceTotal: Number(project.bid_total) || 0, stored: Number(project.bid_total) || 0 }
  // A TEMP project (117) is hours only: its "Estimated hours" lines would
  // otherwise price at hours × rate and land a real-looking number in
  // bid_total. It has no price, ever.
  if (project.temp_at) return { priceTotal: 0, stored: Number(project.bid_total) || 0 }

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
  const shopRate =
    whatIf.shopRate != null
      ? whatIf.shopRate
      : lockedRate > 0
        ? lockedRate
        : whatIf.orgShopRate != null
        ? whatIf.orgShopRate
        : Number(orgRow?.shop_rate ?? 0)

  // ── MIGRATED SUBPROJECTS price FROZEN (6c-2, narrowed by 108) ──────────
  // A migrated line carries Built's per-sub price verbatim as its material
  // lump, so the rollup must add NOTHING on top: no labor $ (hours are still
  // preserved — hoursByDept doesn't depend on the rate — so scheduling and
  // est-vs-actual still work), no consumables, no margin. Cost therefore ==
  // the quoted price, and the total lands exactly on Built's number.
  //
  // ⛔ THIS IS PER-SUBPROJECT NOW, NOT PER-PROJECT. It used to key on
  // `projects.imported_at`, which also froze any scope added AFTER the
  // import — so a subproject created today on an imported job, with real
  // composer lines and real hours, priced at material cost with zero labor
  // and zero margin. That is thousands of dollars per change order, and CO
  // v2 acceptance walks straight into it (Pajot is imported). See
  // `isSubFrozen` and migration 108.
  //
  // ⚠️ So ONE PROJECT CAN NOW HOLD BOTH KINDS, and margin can no longer be
  // applied once over a single bucket sum — the frozen half would be marked
  // up a second time. Two accumulators, priced separately, summed by
  // `priceMixedBuckets`. Exact, because priceFromMargin is linear.
  // ⚠️ The FROZEN half needs no margins object at all — `priceMixedBuckets`
  // hard-zeroes it. This one is for the LIVE half, and on an imported
  // project it deliberately ignores the importer's pinned zeros; see
  // `resolveMarginsForNewScope`.
  const margins = resolveMarginsForNewScope(project, orgRow)

  const SUB_COLS =
    'id, consumable_markup_pct, install_guys, install_days, install_complexity_pct, install_rate_per_hour, install_included'
  let subsData: SubRow[] | null = null
  // ⛔ `quantity` (097) WAS NEVER SELECTED HERE — found 2026-10-22 off the COS
  // banner. The rollup below reads `sub.quantity ?? 1`, so every "(QTY N)"
  // subproject priced ×1 in this file while the project page priced it ×N:
  // every line edit wrote the ×1 total into bid_total (the page wrote ×N back
  // on its next open), and the shop-rate banner offered COS Laminate at
  // $341,940 against its real $1,022,901. Ladder: 108+097 → 097 → base.
  const withFlag = await supabase
    .from('subprojects')
    .select(`${SUB_COLS}, price_frozen, quantity`)
    .eq('project_id', projectId)
  subsData = (withFlag.data as SubRow[] | null) ?? null
  if (!subsData) {
    const qtyOnly = await supabase.from('subprojects').select(`${SUB_COLS}, quantity`).eq('project_id', projectId)
    subsData = (qtyOnly.data as SubRow[] | null) ?? null
  }
  if (!subsData) {
    // ⛔ PRE-108 FALLBACK. PostgREST fails the WHOLE select on ONE unknown
    // column (42703), so asking for `price_frozen` before the migration runs
    // returns NO SUBPROJECTS — and the `subs.length === 0` guard below would
    // then leave bid_total untouched, making a real pricing bug look like a
    // page that simply didn't update. Retry without it; `isSubFrozen` sees
    // `undefined` and gives the old project-level answer.
    const retry = await supabase.from('subprojects').select(SUB_COLS).eq('project_id', projectId)
    subsData = (retry.data as SubRow[] | null) ?? null
  }
  const subs = (subsData || []) as SubRow[]
  if (subs.length === 0) {
    // No subs → priceTotal of 0 means we shouldn't overwrite a
    // legitimate stored value with zero. Project might be brand-new
    // with no subs yet but a placeholder bid_total from import.
    // Safer no-op.
    return { priceTotal: Number(project.bid_total) || 0, stored: Number(project.bid_total) || 0 }
  }

  const rateBook = await loadRateBook(project.org_id)

  // Accumulate the six cost buckets across subs, all at COST — margin is
  // applied below. Install prefill dollars land in the install bucket.
  //
  // ⛔ TWO ACCUMULATORS. A frozen sub's cost IS its price and must not be
  // marked up; a live sub's cost must be. Mixing them into one sum and
  // applying one margin gets one of the two wrong by the whole margin.
  const frozenBuckets = emptyBuckets()
  const liveBuckets = emptyBuckets()
  for (const sub of subs) {
    const frozen = isSubFrozen(project, sub)
    const rawLines = await loadEstimateLines(sub.id)
    const ov = whatIf.lineOverrides
    const lines = ov ? rawLines.map((l) => (ov[l.id] ? { ...l, ...ov[l.id] } : l)) : rawLines
    const ctx: PricingContext = {
      // Frozen: zero rate + zero consumables so the line's stored price is
      // the whole number. Hours still accumulate either way.
      shopRate: frozen ? 0 : shopRate,
      consumableMarkupPct: frozen ? 0 : (sub.consumable_markup_pct ?? orgConsumables),
      // Subproject rollups always run at COST. Margin lives on the
      // project-level price below — same as the project page.
      profitMarginPct: 0,
    }
    // 097: a "(TYP)" subproject priced once but built N times.
    const rollup = computeSubprojectRollup(
      lines,
      rateBook.itemsById,
      new Map(),
      ctx,
      sub.quantity ?? 1,
    )
    const installPrefill = {
      guys: sub.install_guys,
      days: sub.install_days,
      complexityPct: sub.install_complexity_pct,
      ratePerHour: sub.install_rate_per_hour,
      included: sub.install_included ?? false,
    }
    // ⛔ A FROZEN SUB'S INSTALL PREFILL IS ITS PRICE, NOT SOMETHING ON TOP
    // (2026-10-22, Batia · Final). The Built importer deliberately gives an
    // install sub NO estimate lines and prices it from the prefill alone, and
    // the project page + handoff have always counted it: own install rate if
    // set, else the sub's rate (0 when frozen), into the FROZEN bucket — no
    // margin. This file used `frozen ? 0`, which dropped Batia's $24,640
    // install ($232,891 sold vs $208,251 here) and would have written the
    // lower number on the next recompute. Same rule as the page now.
    const installPrefillCost = computeInstallCost(installPrefill, frozen ? 0 : shopRate)
    // computeInstallHours is read but doesn't affect priceTotal —
    // hours fold into hoursByDept; dollars come from the cost buckets.
    void computeInstallHours(installPrefill)
    addBuckets(frozen ? frozenBuckets : liveBuckets, {
      ...rollup,
      installCost: rollup.installCost + installPrefillCost,
    })
  }

  const priceTotal = Math.round(priceMixedBuckets(frozenBuckets, liveBuckets, margins).priceTotal)
  return { priceTotal, stored: Number(project.bid_total) || 0 }
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

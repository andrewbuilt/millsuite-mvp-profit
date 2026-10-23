// ============================================================================
// lib/shop-rate-gateway.ts — the ONLY way a shop-rate change reaches a job
// ============================================================================
// Andrew (2026-10-21): change the rate whenever; it must not touch anything
// being priced or already priced; a sent price never changes silently; a
// gateway accepts or ignores the new rate.
//
//   · Every project prices at its own `locked_shop_rate`, stamped at creation
//     (migration 118's trigger) — saving a new org rate moves NO number.
//   · An OPEN bid whose pinned rate differs from the org's current rate gets
//     an offer (ShopRateBanner on the project page). "Use $X/hr" re-pins and
//     recomputes bid_total; "Keep $Y/hr" records the declined rate in
//     `shop_rate_ignored` so the banner stays quiet until the org rate moves
//     AGAIN. Ignoring costs nothing, forever.
//   · Sold work is never offered — its rate is the contract's.
//   · When the estimate has been SENT, the offer says so in money: the sent
//     total, the new one, and that the PDF already sent stays as issued.
// ============================================================================

import { supabase } from './supabase'
import { isPresold, type ProjectStage } from './types'
import { computeProjectPrice, recomputeProjectBidTotal } from './project-totals'
import type { LockedMargins } from './pricing'

export interface RateOfferProject {
  stage: ProjectStage | string
  locked_shop_rate?: number | null
  shop_rate_ignored?: number | null
  temp_at?: string | null
  practice_at?: string | null
}

export interface RateOffer {
  /** The rate this job prices at today. */
  from: number
  /** The org's current rate, on offer. */
  to: number
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.005

/** Pure: is there a rate to offer this project? Null = say nothing. */
export function shopRateOffer(project: RateOfferProject | null | undefined, orgRate: number | null | undefined): RateOffer | null {
  if (!project) return null
  if (!isPresold(project.stage as ProjectStage)) return null
  if (project.temp_at) return null // hours only — no price to move
  const to = Number(orgRate) || 0
  const from = Number(project.locked_shop_rate) || 0
  // Unpinned (pre-118, or an org with no rate when it was created) already
  // prices at the org rate — nothing to offer.
  if (to <= 0 || from <= 0 || same(from, to)) return null
  if (project.shop_rate_ignored != null && same(Number(project.shop_rate_ignored), to)) return null
  return { from, to }
}

// ── The math-agrees guard (2026-10-22, the COS banner) ──
// A recompute is only safe to OFFER when this library prices the job, at its
// CURRENT pinned rate, to the number everyone is looking at. If it doesn't,
// the gap is a pricing-path bug or bad stored data — not a rate change — and
// "Use new rate" would write that gap over the bid (COS Laminate: $1,022,901
// → $341,940 off a ~4% rate move). So: compare first, offer only on agreement.

export const MATH_EPSILON = 1

/** The job priced by this library at its current pin, vs `shown` (the page's
 *  live total) and the stored bid_total. `agrees` false = do not offer. */
export async function checkPriceAgrees(
  projectId: string,
  shown?: number | null,
): Promise<{ agrees: boolean; atPin: number | null; stored: number }> {
  const r = await computeProjectPrice(projectId)
  if (!r) return { agrees: false, atPin: null, stored: 0 }
  const okStored = Math.abs(r.priceTotal - r.stored) <= MATH_EPSILON
  const okShown = shown == null || Math.abs(r.priceTotal - shown) <= MATH_EPSILON
  return { agrees: okStored && okShown, atPin: r.priceTotal, stored: r.stored }
}

/** "Use $X/hr": re-pin, clear any ignore, recompute bid_total. Throws on a
 *  refused write — an RLS no-op must not look like success — and REFUSES
 *  when the price math doesn't agree with the stored total (see above). */
export async function acceptShopRate(projectId: string, rate: number): Promise<number | null> {
  const check = await checkPriceAgrees(projectId)
  if (!check.agrees) {
    throw new Error(
      `Not updated: this bid's stored price ($${Math.round(check.stored).toLocaleString()}) doesn't match its line math` +
        (check.atPin != null ? ` ($${Math.round(check.atPin).toLocaleString()})` : '') +
        '. It needs attention before any rate change.',
    )
  }
  const { data, error } = await supabase
    .from('projects')
    .update({ locked_shop_rate: rate, shop_rate_ignored: null })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
  return recomputeProjectBidTotal(projectId)
}

/** "Keep $Y/hr": remember the declined org rate. Nothing is repriced. */
export async function ignoreShopRate(projectId: string, orgRate: number): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .update({ shop_rate_ignored: orgRate })
    .eq('id', projectId)
    .select('id')
  if (error) {
    // Pre-118 the column doesn't exist; say what to do instead of failing mute.
    throw new Error(
      /shop_rate_ignored/.test(error.message)
        ? 'Run migration 118 to remember this choice.'
        : error.message,
    )
  }
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
}

// ── The sent-price guard ──

export interface SentQuote {
  number: string | null
  sentAt: string
  /** The total on the estimate as last rendered (estimate_snapshot_json). */
  total: number | null
}

/** What was sent, if anything. `snapshot` is projects.estimate_snapshot_json. */
export function sentQuote(project: {
  estimate_sent_at?: string | null
  estimate_number?: string | null
  estimate_snapshot_json?: unknown
} | null | undefined): SentQuote | null {
  if (!project?.estimate_sent_at) return null
  const snap = project.estimate_snapshot_json as { totals?: { subtotal?: number; total?: number } } | null
  // Subtotal, not total: the project price is pre-tax, and comparing a taxed
  // figure to an untaxed one would invent a difference.
  const t = snap?.totals
  const total = t ? Number(t.subtotal || t.total) || null : null
  return { number: project.estimate_number ?? null, sentAt: project.estimate_sent_at, total }
}

/** The price this job WOULD be at the offered rate. Nothing is written. */
export async function priceAtRate(projectId: string, rate: number): Promise<number | null> {
  const r = await computeProjectPrice(projectId, { shopRate: rate })
  return r ? r.priceTotal : null
}

// ── Margins (migration 121) — the same gateway, for default margins ─────────
// A project inherits the org default margins it was CREATED under
// (projects.locked_margins). A Settings change moves nothing; an OPEN bid gets
// an offer here. Only buckets the project hasn't pinned explicitly can differ
// — an explicit *_margin_pct pin ignores defaults entirely.

export interface MarginOfferProject extends RateOfferProject {
  labor_margin_pct?: number | null
  material_margin_pct?: number | null
  consumable_margin_pct?: number | null
  imported_at?: string | null
  locked_margins?: LockedMargins | null
  margins_ignored?: LockedMargins | null
}

export interface MarginOffer {
  /** What the project's unpinned buckets price at today (its lock). */
  from: Required<{ [K in keyof LockedMargins]: number }>
  /** The org's current defaults, on offer. */
  to: Required<{ [K in keyof LockedMargins]: number }>
  /** The buckets that would actually change. */
  buckets: Array<keyof LockedMargins>
}

const BUCKETS = [
  ['labor', 'labor_margin_pct'],
  ['material', 'material_margin_pct'],
  ['consumable', 'consumable_margin_pct'],
] as const

/** The org's current defaults as a lock-shaped object (null org column → 35). */
export function orgMarginDefaults(org: {
  labor_margin_pct?: number | null
  material_margin_pct?: number | null
  consumable_margin_pct?: number | null
} | null | undefined): Required<{ [K in keyof LockedMargins]: number }> {
  return {
    labor: Number(org?.labor_margin_pct ?? 35),
    material: Number(org?.material_margin_pct ?? 35),
    consumable: Number(org?.consumable_margin_pct ?? 35),
  }
}

/** Pure: is there a margin change to offer this project? Null = say nothing. */
export function marginOffer(
  project: MarginOfferProject | null | undefined,
  org: Parameters<typeof orgMarginDefaults>[0],
): MarginOffer | null {
  if (!project) return null
  if (!isPresold(project.stage as ProjectStage)) return null
  if (project.temp_at) return null
  const lock = project.locked_margins
  if (!lock) return null // pre-121: still inherits live, nothing to offer
  const to = orgMarginDefaults(org)
  const from = {
    labor: Number(lock.labor ?? to.labor),
    material: Number(lock.material ?? to.material),
    consumable: Number(lock.consumable ?? to.consumable),
  }
  // Imported jobs: their *_margin_pct are the importer's zeros and are
  // skipped for new scope (lib/pricing), so every bucket follows the lock.
  const pinned = (col: (typeof BUCKETS)[number][1]) => !project.imported_at && project[col] != null
  const buckets = BUCKETS.filter(([b, col]) => !pinned(col) && !same(from[b], to[b])).map(([b]) => b)
  if (buckets.length === 0) return null
  const ig = project.margins_ignored
  if (ig && BUCKETS.every(([b]) => same(Number(ig[b] ?? NaN), to[b]))) return null
  return { from, to, buckets }
}

/** The price this job WOULD be with the org's current defaults as its lock. */
export async function priceAtMargins(projectId: string, lock: LockedMargins): Promise<number | null> {
  const r = await computeProjectPrice(projectId, { lockedMargins: lock })
  return r ? r.priceTotal : null
}

/** "Use new margins": re-lock to the org's defaults, clear any ignore,
 *  recompute bid_total — refused when the price math already disagrees. */
export async function acceptMargins(projectId: string, lock: LockedMargins): Promise<number | null> {
  const check = await checkPriceAgrees(projectId)
  if (!check.agrees) {
    throw new Error(
      `Not updated: this bid's stored price ($${Math.round(check.stored).toLocaleString()}) doesn't match its line math` +
        (check.atPin != null ? ` ($${Math.round(check.atPin).toLocaleString()})` : '') +
        '. It needs attention before any margin change.',
    )
  }
  const { data, error } = await supabase
    .from('projects')
    .update({ locked_margins: lock, margins_ignored: null })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(/locked_margins|margins_ignored/.test(error.message) ? 'Run migration 121 first.' : error.message)
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
  return recomputeProjectBidTotal(projectId)
}

/** "Keep": remember the declined defaults. Nothing is repriced. */
export async function ignoreMargins(projectId: string, orgDefaults: LockedMargins): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .update({ margins_ignored: orgDefaults })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(/margins_ignored/.test(error.message) ? 'Run migration 121 to remember this choice.' : error.message)
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
}

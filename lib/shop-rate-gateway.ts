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

/** "Use $X/hr": re-pin, clear any ignore, recompute bid_total. Throws on a
 *  refused write — an RLS no-op must not look like success. */
export async function acceptShopRate(projectId: string, rate: number): Promise<number | null> {
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

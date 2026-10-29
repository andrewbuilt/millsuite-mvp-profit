// ============================================================================
// lib/attention.ts — ATTENTION RINGS: at-a-glance "how long has this sat?"
// ============================================================================
// Andrew 2026-10-29: "I want to read less." A card's BORDER says how stale it
// is — the ring gets THICKER AND DARKER together as the clock climbs (amber →
// orange → deep red). Thickness is the signal that survives colour-blindness;
// the pair covers accessibility. Stepped, never a continuous fade. The fact
// chip ("12d", "3w") is small and secondary; the wording lives in the tooltip.
//
// PURE. No supabase — the loader is lib/attention-data. That keeps this file
// importable from scripts/verify-attention.mjs.
//
// Per-stage clocks (thresholds are constants HERE — org-tunable is LATER):
//   · New lead       days since created / last activity   amber 7d · orange 14d · red 21d
//   · Estimate sent  days since estimate_sent_at           amber 10d · red 21d
//   · Pre-production days since sold_at (the /pm math)     amber 2w · red 4w
//   · Production     NOT time — the FILL ring: tracked ÷ estimated hours,
//                    red segment past 100%.
// A clock RESETS on a later relevant event (stage move, estimate re-sent, CO
// activity, payment, a one-click "Touched base") — see lib/attention-data.
//
// ⛔ HONEST DATA: no stamp (imported job, null sold_at) → NO ring, never a
// fake age. Same rule as weeks-waiting on the /pm pre-production card.
// Installed / complete / lost / temp / archived never wear a ring.
// ============================================================================

export type AttentionClock = 'lead' | 'sent' | 'preprod'
export type AttentionLevel = 0 | 1 | 2 | 3

const DAY_MS = 86_400_000

/** Days at which each level starts. `null` = that step doesn't exist for this
 *  clock (estimate-sent and pre-production go straight amber → red). */
export const ATTENTION_THRESHOLDS: Record<AttentionClock, { amber: number; orange: number | null; red: number }> = {
  lead: { amber: 7, orange: 14, red: 21 },
  sent: { amber: 10, orange: null, red: 21 },
  preprod: { amber: 14, orange: null, red: 28 },
}

/** Ring per level — thicker AND darker together. Level 0 = no ring. */
export const RING_STYLE: Record<1 | 2 | 3, { width: number; color: string; chipBg: string; chipFg: string }> = {
  1: { width: 2, color: '#F59E0B', chipBg: '#FEF3C7', chipFg: '#92400E' },
  2: { width: 3, color: '#EA580C', chipBg: '#FFEDD5', chipFg: '#9A3412' },
  3: { width: 4, color: '#B91C1C', chipBg: '#FEE2E2', chipFg: '#991B1B' },
}

export const FILL_GREEN = '#16A34A'
export const FILL_RED = '#DC2626'
export const FILL_TRACK = '#E5E7EB'

/** The most recent thing that resets a clock. */
export interface LastTouch {
  at: string
  label: string
}

export interface AgeAttention {
  kind: 'age'
  clock: AttentionClock
  level: AttentionLevel
  /** Whole days on the clock. */
  days: number
  /** "12d" / "3w" — shown only when level ≥ 1. */
  chip: string
  /** /pm list wording: "12d quiet" · "sent 3w ago" · "4w in pre-prod". */
  phrase: string
  tooltip: string
  /** When the clock started (the base stamp or the later touch). Sort key. */
  since: string
}

export interface FillAttention {
  kind: 'fill'
  /** tracked ÷ estimated; > 1 = over. */
  ratio: number
  overHours: number
  /** "+8h over" when over, else null. */
  chip: string | null
  tooltip: string
}

export type Attention = AgeAttention | FillAttention

export interface AttentionInput {
  /** Raw projects.stage. */
  stage: string
  created_at?: string | null
  estimate_sent_at?: string | null
  sold_at?: string | null
  lastTouch?: LastTouch | null
}

const PIPELINE = new Set(['new_lead', 'fifty_fifty', 'ninety_percent'])

/** Which clock a stage runs, or null for none. A pipeline card with a sent
 *  estimate runs the SENT clock whatever its column; otherwise it's a lead. */
export function clockFor(stage: string, estimateSentAt?: string | null): AttentionClock | null {
  if (PIPELINE.has(stage)) return estimateSentAt ? 'sent' : 'lead'
  if (stage === 'sold') return 'preprod'
  return null
}

export function levelFor(clock: AttentionClock, days: number): AttentionLevel {
  const t = ATTENTION_THRESHOLDS[clock]
  if (days >= t.red) return 3
  if (t.orange != null && days >= t.orange) return 2
  if (days >= t.amber) return 1
  return 0
}

/** "12d" under two weeks, whole weeks after ("3w"). */
export function ageChip(days: number): string {
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function agoWords(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

const BASE_LABEL: Record<AttentionClock, string> = {
  lead: 'Lead created',
  sent: 'Estimate sent',
  preprod: 'Sold',
}

/**
 * The age attention for one project, or null when its stage runs no clock or
 * the clock has no honest start. `now` is injectable for the verify script.
 */
export function ageAttention(p: AttentionInput, now = Date.now()): AgeAttention | null {
  const clock = clockFor(p.stage, p.estimate_sent_at)
  if (!clock) return null
  const base = clock === 'lead' ? p.created_at : clock === 'sent' ? p.estimate_sent_at : p.sold_at
  if (!base) return null
  const baseMs = new Date(base).getTime()
  if (!Number.isFinite(baseMs)) return null

  // A touch only counts if it came AFTER the clock's own start — an event from
  // before the estimate went out says nothing about how long it's sat since.
  const touchMs = p.lastTouch ? new Date(p.lastTouch.at).getTime() : NaN
  const reset = Number.isFinite(touchMs) && touchMs > baseMs
  const startMs = reset ? touchMs : baseMs
  const days = Math.max(0, Math.floor((now - startMs) / DAY_MS))
  const level = levelFor(clock, days)
  const chip = ageChip(days)

  const baseDays = Math.max(0, Math.floor((now - baseMs) / DAY_MS))
  let tooltip = `${BASE_LABEL[clock]} ${fmtDate(base)} (${agoWords(baseDays)})`
  if (reset && p.lastTouch) {
    tooltip += ` · clock reset by "${p.lastTouch.label}" ${fmtDate(p.lastTouch.at)} (${agoWords(days)})`
  } else if (clock === 'lead') {
    tooltip += ' · no activity since'
  }
  const t = ATTENTION_THRESHOLDS[clock]
  tooltip += ` · amber at ${t.amber}d${t.orange != null ? `, orange at ${t.orange}d` : ''}, red at ${t.red}d`

  const phrase =
    clock === 'lead' ? `${chip} quiet` : clock === 'sent' ? (reset ? `${chip} since touch` : `sent ${chip} ago`) : reset ? `${chip} since touch` : `${chip} in pre-prod`

  return { kind: 'age', clock, level, days, chip, phrase, tooltip, since: new Date(startMs).toISOString() }
}

/** The production fill ring. Null with no estimate — nothing honest to fill. */
export function fillAttention(estHours: number, trackedHours: number): FillAttention | null {
  if (!(estHours > 0)) return null
  const ratio = Math.max(0, trackedHours) / estHours
  const overHours = Math.max(0, trackedHours - estHours)
  const over = Math.round(overHours)
  return {
    kind: 'fill',
    ratio,
    overHours,
    chip: over >= 1 ? `+${over}h over` : null,
    tooltip: `${Math.round(trackedHours)}h tracked of ${Math.round(estHours)}h estimated (${Math.round(ratio * 100)}%)`,
  }
}

/** CSS background for the fill ring: green up to the tracked share; past 100%
 *  the whole ring is the job and the overage is the red slice at the end. */
export function fillGradient(ratio: number): string {
  if (ratio <= 1) {
    const deg = Math.round(ratio * 360)
    return `conic-gradient(${FILL_GREEN} 0deg ${deg}deg, ${FILL_TRACK} ${deg}deg 360deg)`
  }
  const deg = Math.round((1 / ratio) * 360)
  return `conic-gradient(${FILL_GREEN} 0deg ${deg}deg, ${FILL_RED} ${deg}deg 360deg)`
}

/** Worst-first ordering for the /pm list. Higher = worse. Over-hours
 *  production sits with red; within a level, further past red is worse. */
export function attentionScore(a: Attention): number {
  if (a.kind === 'fill') return a.overHours > 0 ? 3000 + Math.min(999, (a.ratio - 1) * 1000) : 0
  if (a.level === 0) return 0
  return a.level * 1000 + Math.min(999, (a.days / ATTENTION_THRESHOLDS[a.clock].red) * 100)
}

/** Newest first, unknown last — both boards' column order (Andrew: the column
 *  "darkens downward"). Keys are ISO strings or null. */
export function newestFirst(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? new Date(a).getTime() : NaN
  const tb = b ? new Date(b).getTime() : NaN
  const fa = Number.isFinite(ta)
  const fb = Number.isFinite(tb)
  if (fa && fb) return tb - ta
  if (fa) return -1
  if (fb) return 1
  return 0
}

/** Column order for both boards: CALMEST at top, then newest within a level
 *  (Andrew 2026-10-29, "some of the colors are out of order"). Newest-first
 *  alone isn't enough — one column mixes clocks with different thresholds (a
 *  50/50 card on the lead clock rings amber at 7d, its neighbour on the sent
 *  clock stays calm until 10d), so pure age put an unringed card below an
 *  amber one. Level first guarantees the column only darkens downward. */
export function ringLevel(a: Attention | null | undefined): number {
  if (!a) return 0
  if (a.kind === 'fill') return a.overHours >= 1 ? 3 : 0
  return a.level
}
export function boardOrder(
  a: { attention: Attention | null | undefined; key: string | null | undefined },
  b: { attention: Attention | null | undefined; key: string | null | undefined },
): number {
  return ringLevel(a.attention) - ringLevel(b.attention) || newestFirst(a.key, b.key)
}

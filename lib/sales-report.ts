// ============================================================================
// lib/sales-report.ts — the sales report's math, with no database
// ============================================================================
// Pure on purpose (no supabase import) so scripts/verify-sales-report can pin
// every rule without a connection — the payments/CO libs' pattern. The
// /reports Sales section does the IO and feeds rows in.
//
// ⛔ THE DEFINITIONS (Andrew, scoped 2026-09-23 — veto-able but decided):
//   · A BID is an estimate marked sent (`estimate_sent_at`). Pipeline cards
//     without one are leads, not bids — they appear in no rate.
//   · time-to-close = estimate_sent_at → sold_at; falls back to created_at
//     when sent was never stamped (imported/legacy sales).
//   · win rate = sold ÷ (sold + lost), AMONG BIDS. Open bids count in
//     neither the numerator nor the denominator — an undecided bid isn't a
//     loss yet, and counting it as one would punish a full pipeline.
//
// ⛔ THE HONESTY RULE: the stamps mostly began Sep 2026. `window` reports the
// earliest decided-bid stamp the math actually used; the UI SAYS "computed
// from {window}" and never extrapolates a season from one data point
// (seasonality rows carry their observation count so the UI can grey thin
// ones). The report gets smarter every month it runs — by design.
// ============================================================================

export interface SalesFactRow {
  id: string
  name: string
  clientName: string | null
  /** bid_total falling back to estimated_price — the same value the kanban
   *  card and its column sums show. */
  value: number
  createdAt: string | null
  estimateSentAt: string | null
  soldAt: string | null
  lostAt: string | null
  stage: string
  leadSource: string | null
  lostReason: string | null
}

export type BidOutcome = 'won' | 'lost' | 'open'

const SOLD_FAMILY = new Set(['sold', 'production', 'installed', 'complete'])
const DAY_MS = 86400000

/** Won / lost / open. Stage is the authority; the stamps carry the WHEN. */
export function bidOutcome(r: SalesFactRow): BidOutcome {
  if (SOLD_FAMILY.has(r.stage)) return 'won'
  if (r.stage === 'lost') return 'lost'
  return 'open'
}

export function isBid(r: SalesFactRow): boolean {
  return !!r.estimateSentAt
}

/** Whole days, sent (or created) → sold. Null when it can't be computed. */
export function daysToClose(r: SalesFactRow): number | null {
  if (!r.soldAt) return null
  const from = r.estimateSentAt || r.createdAt
  if (!from) return null
  const ms = new Date(r.soldAt).getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms / DAY_MS)
}

const ym = (iso: string) => iso.slice(0, 7)

export interface SalesKpis {
  /** Bids SENT in the calendar month of `now`. */
  bidsThisMonth: number
  bidsThisMonthValue: number
  /** All-window, among decided bids. Null when nothing has decided yet. */
  winRatePct: number | null
  avgDaysToClose: number | null
  /** All-window value of lost bids. */
  lostValue: number
}

export interface MonthlyRow {
  month: string // 'YYYY-MM'
  wonCount: number
  wonValue: number
  lostCount: number
  lostValue: number
  /** Among that month's decided bids. Null when none decided. */
  winPct: number | null
}

export interface ClientRow {
  client: string
  bids: number
  wins: number
  winPct: number | null
  totalValue: number
  /** Repeatedly bid, never closed — the "stop quoting these for free" flag. */
  neverCloses: boolean
}

export interface SeasonRow {
  /** 1-12 calendar month. */
  month: number
  bids: number
  wins: number
}

export interface SourceRow {
  source: string
  bids: number
  wins: number
  winPct: number | null
  avgDaysToClose: number | null
  totalValue: number
}

export interface SalesReport {
  /** Earliest and latest stamps the math used, or null when nothing decided.
   *  The UI prints this — the honesty rule. */
  window: { from: string | null; to: string }
  kpis: SalesKpis
  monthly: MonthlyRow[]
  perClient: ClientRow[]
  seasonality: SeasonRow[]
  perSource: SourceRow[]
}

const pct = (wins: number, decided: number): number | null =>
  decided > 0 ? Math.round((wins / decided) * 100) : null

const avg = (xs: number[]): number | null =>
  xs.length > 0 ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null

export function buildSalesReport(rows: SalesFactRow[], now: Date): SalesReport {
  const bids = rows.filter(isBid)
  const won = bids.filter((r) => bidOutcome(r) === 'won')
  const lost = bids.filter((r) => bidOutcome(r) === 'lost')

  // ── Honesty window: the stamps the decided math actually consumed ──
  const stamps = [
    ...won.map((r) => r.soldAt),
    ...lost.map((r) => r.lostAt),
    ...bids.map((r) => r.estimateSentAt),
  ].filter((s): s is string => !!s)
  const from = stamps.length > 0 ? stamps.reduce((a, b) => (a < b ? a : b)) : null

  // ── KPIs ──
  const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const sentThisMonth = bids.filter((r) => ym(r.estimateSentAt!) === nowYm)
  const closeDays = won.map(daysToClose).filter((d): d is number => d != null)
  const kpis: SalesKpis = {
    bidsThisMonth: sentThisMonth.length,
    bidsThisMonthValue: sentThisMonth.reduce((s, r) => s + r.value, 0),
    winRatePct: pct(won.length, won.length + lost.length),
    avgDaysToClose: avg(closeDays),
    lostValue: lost.reduce((s, r) => s + r.value, 0),
  }

  // ── Monthly trend, by the month the DECISION landed ──
  const months = new Map<string, MonthlyRow>()
  const monthRow = (m: string): MonthlyRow => {
    let r = months.get(m)
    if (!r) {
      r = { month: m, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0, winPct: null }
      months.set(m, r)
    }
    return r
  }
  for (const r of won) {
    if (!r.soldAt) continue
    const row = monthRow(ym(r.soldAt))
    row.wonCount++
    row.wonValue += r.value
  }
  for (const r of lost) {
    if (!r.lostAt) continue
    const row = monthRow(ym(r.lostAt))
    row.lostCount++
    row.lostValue += r.value
  }
  const monthly = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
  for (const m of monthly) m.winPct = pct(m.wonCount, m.wonCount + m.lostCount)

  // ── Per client — decided AND open bids count as bids; wins need a win ──
  const clients = new Map<string, { bids: number; wins: number; decided: number; value: number }>()
  for (const r of bids) {
    const key = (r.clientName || '').trim() || '(no client)'
    let c = clients.get(key)
    if (!c) {
      c = { bids: 0, wins: 0, decided: 0, value: 0 }
      clients.set(key, c)
    }
    c.bids++
    c.value += r.value
    const o = bidOutcome(r)
    if (o !== 'open') c.decided++
    if (o === 'won') c.wins++
  }
  const perClient: ClientRow[] = [...clients.entries()]
    .map(([client, c]) => ({
      client,
      bids: c.bids,
      wins: c.wins,
      winPct: pct(c.wins, c.decided),
      totalValue: c.value,
      // ⚠️ ≥3 DECIDED bids, zero wins — open bids don't flag a client who
      // simply hasn't answered yet.
      neverCloses: c.decided >= 3 && c.wins === 0,
    }))
    .sort((a, b) => b.totalValue - a.totalValue)

  // ── Seasonality: bids by month SENT, wins by month SOLD, across years ──
  const seasonality: SeasonRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    bids: 0,
    wins: 0,
  }))
  for (const r of bids) {
    seasonality[Number(r.estimateSentAt!.slice(5, 7)) - 1].bids++
  }
  for (const r of won) {
    if (r.soldAt) seasonality[Number(r.soldAt.slice(5, 7)) - 1].wins++
  }

  // ── Per lead source — the advertising scoreboard ──
  const sources = new Map<
    string,
    { bids: number; wins: number; decided: number; value: number; days: number[] }
  >()
  for (const r of bids) {
    const key = (r.leadSource || '').trim() || '(no source)'
    let s = sources.get(key)
    if (!s) {
      s = { bids: 0, wins: 0, decided: 0, value: 0, days: [] }
      sources.set(key, s)
    }
    s.bids++
    s.value += r.value
    const o = bidOutcome(r)
    if (o !== 'open') s.decided++
    if (o === 'won') {
      s.wins++
      const d = daysToClose(r)
      if (d != null) s.days.push(d)
    }
  }
  const perSource: SourceRow[] = [...sources.entries()]
    .map(([source, s]) => ({
      source,
      bids: s.bids,
      wins: s.wins,
      winPct: pct(s.wins, s.decided),
      avgDaysToClose: avg(s.days),
      totalValue: s.value,
    }))
    .sort((a, b) => b.totalValue - a.totalValue)

  return { window: { from, to: now.toISOString() }, kpis, monthly, perClient, seasonality, perSource }
}

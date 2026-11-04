// ============================================================================
// lib/payment-forecast.ts — Payments v4: the ledger and the forecast
// ============================================================================
// ⛔ THE CONSTITUTION (Andrew, 2026-11-05). QuickBooks is the accounting
// truth. MillSuite's payments page is a CASH-FLOW MONITOR: payments are noted
// by hand after they happen in QB, at whatever amount they actually were, and
// the schedule is a LOOSE FORECAST of what's left and roughly when.
//
// TWO INDEPENDENT LISTS, ZERO BINDING BETWEEN THEM:
//
//   LEDGER   (`project_payments`)       money in.  Σ = received.
//   FORECAST (`cash_flow_receivables`)  money coming. Human-owned, period.
//
//   remaining = contract − received
//
// When Σ forecast ≠ remaining (a payment landed, a change order moved the
// contract) the board shows ONE quiet hint — "Forecast $X vs $Y remaining —
// Redivide" — and a human re-spreads it in the Redivide modal.
//
// ⛔ THERE IS NO CODE PATH THAT WRITES A FORECAST ROW EXCEPT THE EDITOR AND
// THE REDIVIDE MODAL. Nothing in this file pairs a payment with a row. That
// pairing — "settle the next draw", paid-draw locks, pinned amounts, the CO
// re-spread, the waterfall — is what spawned the Leonard "App 5 · $18,217"
// ghost: no row was ever created, the machinery just paired payments with
// draws in date order and relabelled them. It is deleted, not tuned:
//
//   ✗ reconcileProject / reconcileAll / reconcileEverything  (settle-next-draw)
//   ✗ DerivedDraw.state 'paid' | 'partial' | 'open'          (paid-draw locking)
//   ✗ amount_pinned                                          (pinned amounts)
//   ✗ the open-draw re-spread after a CO                     (CO redistribution)
//   ✗ SettledCard / AppliedPayment / unapplied               (payment↔draw matching)
//   ✗ coDrawSlot                                             (CO rows appended to the schedule)
//
// ⚠️ `status` ON A FORECAST ROW IS IGNORED. The legacy invoicing / QB-watcher
// paths still flip it to 'invoiced'/'received' when they run; under v4 that is
// inert — a row is in the forecast until a human edits it out. Only
// 'cancelled' (a removed row) is excluded, at the loader.
//
// Pure: no database import, so scripts/verify-payments-v4 runs it with no
// credentials.
// ============================================================================

import {
  monthId,
  monthOf,
  parseLocalDate,
  type MonthKey,
  type PaymentRow,
} from './payment-schedule'

/** One logged receipt. */
export interface LedgerEntry {
  id: string
  projectId: string
  amount: number
  /** Bare 'YYYY-MM-DD'. */
  paymentDate: string
  /** 130 — what the payment was, in the operator's words ("App 3"). The green
   *  card's headline. Optional: an unlabelled payment reads "Payment". */
  label?: string | null
  method: string | null
  reference: string | null
  notes: string | null
}

/** Money compares to the cent. */
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Below this, forecast-vs-remaining is rounding, not a gap worth a hint.
 * Same resolution the board prints money at (whole dollars).
 */
export const HINT_EPS = 1

/** What a green card says. */
export function paymentLabel(e: LedgerEntry): string {
  return (e.label || '').trim() || (e.notes || '').trim() || 'Payment'
}

// ── Per project: the one hint ───────────────────────────────────────────────

export interface ProjectForecast {
  projectId: string
  projectName: string
  /** `bid_total`. 0 = no contract recorded. */
  contractTotal: number
  contractKnown: boolean
  /** Σ ledger. */
  received: number
  /** contract − received, floored at 0. */
  remaining: number
  /** Received beyond the contract. */
  credit: number
  /** Σ forecast rows. */
  forecastTotal: number
  /** forecastTotal − remaining. Positive = the forecast expects MORE than is
   *  left to collect. Meaningless when `contractKnown` is false. */
  gap: number
  /** The forecast rows, in schedule order. */
  rows: PaymentRow[]
  /** True when the board should say "Forecast $X vs $Y remaining — Redivide". */
  needsRedivide: boolean
}

export function scheduleOrder(a: PaymentRow, b: PaymentRow): number {
  return (
    a.sortOrder - b.sortOrder ||
    (a.createdAt || '').localeCompare(b.createdAt || '') ||
    a.label.localeCompare(b.label)
  )
}

/**
 * Summarise one project. Reads both lists; writes neither; pairs nothing.
 */
export function projectForecast(
  projectId: string,
  projectName: string,
  rows: PaymentRow[],
  entries: LedgerEntry[],
  contractTotal: number,
): ProjectForecast {
  const received = round2(entries.reduce((s, e) => s + e.amount, 0))
  const forecastTotal = round2(rows.reduce((s, r) => s + r.amount, 0))
  const contractKnown = contractTotal > 0
  const remaining = round2(Math.max(0, contractTotal - received))
  const gap = round2(forecastTotal - remaining)
  return {
    projectId,
    projectName,
    contractTotal,
    contractKnown,
    received,
    remaining,
    credit: round2(Math.max(0, received - contractTotal)),
    forecastTotal,
    gap,
    rows: [...rows].sort(scheduleOrder),
    needsRedivide: contractKnown && Math.abs(gap) >= HINT_EPS,
  }
}

/** Every project that has a forecast, a payment, or a contract on the board. */
export function forecastAll(
  rows: PaymentRow[],
  entries: LedgerEntry[],
  contractTotals: Record<string, number>,
  projectNames: Record<string, string> = {},
): ProjectForecast[] {
  const rowsBy = new Map<string, PaymentRow[]>()
  for (const r of rows) {
    const l = rowsBy.get(r.projectId)
    if (l) l.push(r)
    else rowsBy.set(r.projectId, [r])
  }
  const payBy = new Map<string, LedgerEntry[]>()
  for (const e of entries) {
    const l = payBy.get(e.projectId)
    if (l) l.push(e)
    else payBy.set(e.projectId, [e])
  }
  const ids = new Set([...rowsBy.keys(), ...payBy.keys(), ...Object.keys(contractTotals)])
  const out: ProjectForecast[] = []
  for (const id of ids) {
    const mine = rowsBy.get(id) || []
    out.push(
      projectForecast(
        id,
        mine[0]?.projectName || projectNames[id] || 'Project',
        mine,
        payBy.get(id) || [],
        contractTotals[id] ?? 0,
      ),
    )
  }
  return out.sort((a, b) => a.projectName.localeCompare(b.projectName))
}

// ── The board: green cards and white cards, by month ────────────────────────

export interface MonthBucket {
  key: MonthKey
  /** WHITE cards: forecast rows expected this month. Soonest first. */
  forecast: PaymentRow[]
  /** GREEN cards: ledger payments dated this month. One card per payment. */
  payments: LedgerEntry[]
  /** Σ forecast — "Scheduled". */
  scheduled: number
  /** Σ payments — "Received". */
  receivedTotal: number
}

export interface ForecastView {
  months: MonthBucket[]
  /** Forecast rows with no expected date. */
  unscheduled: PaymentRow[]
  /** Forecast rows expected before THIS month (relative to today, never to
   *  the paged window — paging forward must not paint this month red). */
  overdue: PaymentRow[]
}

/**
 * Bucket the forecast and the ledger into the visible months.
 *
 * ⛔ THE HEADERS FOOT TRIVIALLY, BY CONSTRUCTION: Received = Σ the green cards
 * under it, Scheduled = Σ the white cards under it. Each list lands in exactly
 * one place — a payment in the month it was dated, a forecast row in the
 * month it's expected — and nothing moves money between the two.
 */
export function buildForecastView(
  rows: PaymentRow[],
  ledger: LedgerEntry[],
  months: MonthKey[],
  today: MonthKey,
): ForecastView {
  const buckets = new Map<string, MonthBucket>()
  for (const k of months) {
    buckets.set(monthId(k), { key: k, forecast: [], payments: [], scheduled: 0, receivedTotal: 0 })
  }
  const idx = (k: MonthKey) => k.year * 12 + k.month
  const unscheduled: PaymentRow[] = []
  const overdue: PaymentRow[] = []

  for (const r of rows) {
    const day = parseLocalDate(r.expectedDate)
    if (!day) {
      unscheduled.push(r)
      continue
    }
    const m = monthOf(day)
    const b = buckets.get(monthId(m))
    if (b) {
      b.forecast.push(r)
      b.scheduled += r.amount
      continue
    }
    // Outside the window: only the PAST is surfaced (as overdue). The future
    // is a page-forward away.
    if (idx(m) < idx(today)) overdue.push(r)
  }

  for (const e of ledger) {
    const day = parseLocalDate(e.paymentDate)
    if (!day) continue
    const b = buckets.get(monthId(monthOf(day)))
    if (!b) continue
    b.payments.push(e)
    b.receivedTotal += e.amount
  }

  const byDate = (a: PaymentRow, b: PaymentRow) =>
    (a.expectedDate || '').localeCompare(b.expectedDate || '') ||
    a.projectName.localeCompare(b.projectName) ||
    scheduleOrder(a, b)
  for (const b of buckets.values()) {
    b.forecast.sort(byDate)
    b.payments.sort((x, y) => x.paymentDate.localeCompare(y.paymentDate) || x.id.localeCompare(y.id))
    b.scheduled = round2(b.scheduled)
    b.receivedTotal = round2(b.receivedTotal)
  }
  overdue.sort(byDate)
  unscheduled.sort((a, b) => a.projectName.localeCompare(b.projectName) || scheduleOrder(a, b))
  return { months: months.map((k) => buckets.get(monthId(k))!), unscheduled, overdue }
}

// ── The Redivide modal's math ───────────────────────────────────────────────
// Human-triggered. These compute a PROPOSAL the modal shows; only the modal's
// Save writes it.

/**
 * Split `total` into `n` parts that sum to it EXACTLY.
 *
 * Whole dollars where the total is whole dollars (a loose forecast has no
 * business carrying cents); otherwise the cents land on the LAST row so the
 * rest stay round. Largest remainder over the weights.
 */
export function splitByWeights(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const t = round2(Math.max(0, total))
  const dollars = Math.floor(t)
  const cents = round2(t - dollars)
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const wSum = w.reduce((a, b) => a + b, 0)
  const raw = wSum > 0 ? w.map((x) => (dollars * x) / wSum) : w.map(() => dollars / n)
  const floors = raw.map((v) => Math.floor(v))
  let left = dollars - floors.reduce((a, b) => a + b, 0)
  // Hand the leftover dollars to the rows robbed of the most; ties → earlier.
  const order = raw
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    floors[o.i] += 1
    left -= 1
  }
  floors[n - 1] = round2(floors[n - 1] + cents)
  return floors
}

/** Even split of `total` over `n` rows. */
export function evenSplit(total: number, n: number): number[] {
  return splitByWeights(total, Array.from({ length: n }, () => 1))
}

/** Split `total` in proportion to the rows' current amounts. All-zero
 *  amounts fall back to even. */
export function proportionalSplit(total: number, current: number[]): number[] {
  return splitByWeights(total, current)
}

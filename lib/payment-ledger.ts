// ============================================================================
// lib/payment-ledger.ts — reconciling what was promised with what arrived
// ============================================================================
// The schedule (cash_flow_receivables) is the PLAN. The ledger
// (project_payments, migration 099) is what actually happened. This module is
// the bridge, and it is the piece Built OS never had.
//
// ⛔ THE RULE THAT MAKES THE HARD CASES EASY:
//
//     received  = sum(ledger)
//     remaining = contract total − received
//     the UNPAID part of the schedule is rebalanced to equal `remaining`,
//     with the FINAL draw absorbing the difference.
//
// Once payments are their own rows, a partial payment, an overpayment and a
// payment made out of order are all just entries. Nothing special-cases them.
// Andrew: "it should just log the payment and adjust the final payments."
//
// ⛔ NOTHING HERE IS EVER WRITTEN BACK. The draws keep the amounts they were
// authored with; the balancing is DERIVED on read. This codebase has been
// bitten twice by a screen that silently persisted recomputed money — the
// staleness refresh banking a $0 material cost, and the handoff re-pricing a
// frozen import. A ledger view must never edit the contract.
//
// ── WATERFALL ──────────────────────────────────────────────────────────────
// Money fills the oldest unpaid draw first and overflows into the next. That
// is Andrew's call and it's right for a cash-flow tool: the question this page
// answers is "how much is in and how much is left", not "which specific draw
// did that cheque settle". A consequence worth knowing: paying the install
// draw early still shows the deposit as the thing that got paid.
// ============================================================================

import {
  isOutstanding,
  monthId,
  parseLocalDate,
  monthOf,
  type MonthKey,
  type PaymentRow,
} from './payment-schedule'

/** Money compares to the cent; anything finer is float noise. */
const EPS = 0.005

/**
 * ⛔ A DRAW OWING LESS THAN A DOLLAR IS SETTLED.
 *
 * Not fussiness — this was a live bug. Draw amounts are ROUNDED to whole
 * dollars when the schedule is saved, but a contract total and a real payment
 * both carry cents. Murtagh Bar: contract $26,227, deposit stored as $13,114
 * (half of an odd number, rounded up), client paid the true half — $13,113.50.
 * That left $0.50 "outstanding", which is a rounding artifact and not a debt.
 *
 * At the old $0.005 tolerance the draw came back `partial`, and because the
 * board prints whole dollars it rendered as a card reading **"$1"** with the
 * badge "$13,114 of $13,114 in" — a phantom bill for a draw that was paid.
 *
 * So the comparison has to match the resolution the money is DISPLAYED at.
 * Nobody chases fifty cents, and nobody should have to explain a $1 card.
 */
const SETTLED = 1

/** One logged receipt. */
export interface LedgerEntry {
  id: string
  projectId: string
  amount: number
  /** Bare 'YYYY-MM-DD'. */
  paymentDate: string
  method: string | null
  reference: string | null
  notes: string | null
}

export type DrawState = 'paid' | 'partial' | 'open'

export interface DerivedDraw {
  row: PaymentRow
  /** What the draw was authored as. */
  stored: number
  /** What it's worth after the final-draw balancing — the number to SHOW. */
  scheduled: number
  /** How much of `scheduled` the ledger covers. */
  covered: number
  /** `scheduled - covered`. What's still owed on this draw. */
  outstanding: number
  state: DrawState
}

export interface ProjectReconciliation {
  contractTotal: number
  received: number
  /** contractTotal − received. Negative is impossible here; see `credit`. */
  remaining: number
  draws: DerivedDraw[]
  /** Received beyond the whole contract. Surfaced, never hidden in a draw. */
  credit: number
  /**
   * `sum(stored draw amounts) − contractTotal`.
   *
   * ⚠️ NON-ZERO IS THE NORMAL STATE TODAY, not an exception. Draw amounts are
   * frozen dollars computed from a percentage at save time, and CHANGE ORDERS
   * NEVER TOUCH THEM (`lib/change-orders` doesn't reference the receivables
   * table at all). So any job that's had a CO or a re-price has draws that no
   * longer sum to its total. The balancing below silently absorbs that, which
   * is the desired behaviour — this field exists so a UI can still SAY so
   * rather than pretend the schedule was always right.
   */
  drift: number
  /** True when the schedule has no draws at all — every other number is then
   *  meaningless and the caller should say "no schedule" rather than "$0". */
  empty: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Reconcile one project's schedule against its ledger.
 *
 * `draws` must be in schedule order (the waterfall depends on it).
 * `contractTotal` is the project's contract value — `bid_total` for a sold
 * job, which is the number the client agreed to.
 */
export function reconcileProject(
  draws: PaymentRow[],
  entries: LedgerEntry[],
  contractTotal: number,
): ProjectReconciliation {
  const received = round2(entries.reduce((s, e) => s + e.amount, 0))
  const storedSum = round2(draws.reduce((s, d) => s + d.amount, 0))
  const drift = round2(storedSum - contractTotal)

  if (draws.length === 0) {
    return {
      contractTotal,
      received,
      remaining: round2(Math.max(0, contractTotal - received)),
      draws: [],
      credit: round2(Math.max(0, received - contractTotal)),
      drift,
      empty: true,
    }
  }

  // ── 1. Waterfall the money over the draws, oldest first ──
  let pool = received
  const out: DerivedDraw[] = draws.map((row) => {
    const stored = row.amount
    const covered = round2(Math.min(Math.max(pool, 0), stored))
    pool = round2(pool - covered)
    return {
      row,
      stored,
      scheduled: stored,
      covered,
      outstanding: round2(stored - covered),
      state: 'open' as DrawState,
    }
  })

  // ── 2. Rebalance the UNPAID portion so it equals `remaining` ──
  // Only the unpaid part may move. A covered draw is settled history, and
  // shrinking it would un-say something that already happened.
  const remaining = round2(Math.max(0, contractTotal - received))
  const unpaidSum = round2(out.reduce((s, d) => s + (d.scheduled - d.covered), 0))
  let delta = round2(remaining - unpaidSum)

  if (delta > EPS) {
    // The contract grew (a change order) — the FINAL draw absorbs it whole.
    // Andrew's call, and symmetric with the waterfall: the last draw is the
    // balancing item, which is how a final payment works anyway.
    const last = out[out.length - 1]
    last.scheduled = round2(last.scheduled + delta)
    delta = 0
  } else if (delta < -EPS) {
    // The contract shrank, or the draws were over-authored. Take it back from
    // the end, never letting a draw fall below what's already been paid
    // against it.
    for (let i = out.length - 1; i >= 0 && delta < -EPS; i--) {
      const d = out[i]
      const room = round2(d.scheduled - d.covered)
      if (room <= 0) continue
      const take = Math.min(room, -delta)
      d.scheduled = round2(d.scheduled - take)
      delta = round2(delta + take)
    }
    // Any residue means the draws couldn't shrink far enough — the paid
    // amounts already exceed the contract. That's the `credit` below, not
    // something to force into a negative draw.
  }

  for (const d of out) {
    d.outstanding = round2(Math.max(0, d.scheduled - d.covered))
    d.state =
      d.outstanding < SETTLED ? 'paid' : d.covered > EPS ? 'partial' : 'open'
  }

  return {
    contractTotal,
    received,
    remaining,
    draws: out,
    credit: round2(Math.max(0, received - contractTotal)),
    drift,
    empty: false,
  }
}

/**
 * Default expected dates for a fresh schedule: one month apart.
 *
 * ⛔ DELIBERATELY NOT DERIVED FROM COMPLETION. Andrew, asked whether the app
 * should infer "due" from project stage or approval triggers: "Just make each
 * draw payment due a month apart as default. we will manually move them where
 * appropriate as the schedule shifts."
 *
 * That's the honest answer — the app cannot know the jobsite wasn't ready, and
 * a wrong inference about when money is due is worse than no inference. The
 * schedule is a forecast a human maintains by dragging. `milestone_trigger`
 * survives as a LABEL; nothing derives state from it.
 */
export function defaultDrawDates(start: Date, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate())
    // Clamp, don't roll: starting on the 31st must not skip February.
    if (d.getMonth() !== (start.getMonth() + i) % 12) d.setDate(0)
    const p = (n: number) => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
  }
  return out
}


// ============================================================================
// The board: draws and receipts, by the month the cash belongs to
// ============================================================================
// ⛔ THIS LIVES HERE, NOT IN payment-schedule, BECAUSE IT NEEDS THE LEDGER.
// "Received this month" is now the sum of LEDGER ENTRIES dated that month —
// not a `status='received'` flag on a draw. That flag could only ever record
// the projected amount, which is exactly why a payment that differed from its
// projection had nowhere to go.

export interface MonthBucket {
  key: MonthKey
  /** Draws with money still owed, expected this month. Soonest first.
   *  ⚠️ Fully-paid draws are NOT here — they have nothing outstanding, and the
   *  cash they represent shows as a ledger entry instead. */
  outstanding: DerivedDraw[]
  /** Payments that actually landed this month. */
  received: LedgerEntry[]
  /** Sum of `outstanding` — "needed this month". */
  needed: number
  /** Sum of `received` — "came in this month". */
  receivedTotal: number
}

export interface PaymentsView {
  months: MonthBucket[]
  /** Owed, but with no expected date — belongs to no column and would
   *  otherwise be invisible. */
  unscheduled: DerivedDraw[]
  /** Owed and expected before this month. ⛔ Relative to TODAY, never to the
   *  window: deciding it from the window start paints this month's un-due
   *  draws red the moment you page forward. */
  overdue: DerivedDraw[]
}

/**
 * Bucket derived draws and ledger entries into the visible months.
 *
 * Anything expected after the window is simply not shown — page forward for
 * it. Anything owed before today is surfaced as overdue rather than dropped.
 */
export function buildPaymentsView(
  draws: DerivedDraw[],
  ledger: LedgerEntry[],
  months: MonthKey[],
  today: MonthKey,
): PaymentsView {
  const buckets = new Map<string, MonthBucket>()
  for (const k of months) {
    buckets.set(monthId(k), { key: k, outstanding: [], received: [], needed: 0, receivedTotal: 0 })
  }
  const first = months[0]
  const idx = (k: MonthKey) => k.year * 12 + k.month
  const unscheduled: DerivedDraw[] = []
  const overdue: DerivedDraw[] = []

  for (const d of draws) {
    // Nothing meaningfully owed ⇒ nothing to plan for; the money is in the
    // ledger. Uses the same sub-dollar tolerance as `state`, or a settled draw
    // would drop off the card list but still be counted in "needed".
    if (d.outstanding < SETTLED) continue
    if (d.row.status === 'cancelled') continue
    if (!isOutstanding(d.row) && d.row.status !== 'received') continue

    const day = parseLocalDate(d.row.expectedDate)
    if (!day) {
      unscheduled.push(d)
      continue
    }
    const m = monthOf(day)
    const b = buckets.get(monthId(m))
    if (!b) {
      if (first && idx(m) < idx(first) && idx(m) < idx(today)) overdue.push(d)
      continue
    }
    b.outstanding.push(d)
    b.needed += d.outstanding
  }

  for (const e of ledger) {
    const day = parseLocalDate(e.paymentDate)
    if (!day) continue
    const b = buckets.get(monthId(monthOf(day)))
    if (!b) continue
    b.received.push(e)
    b.receivedTotal += e.amount
  }

  const byDate = (a: DerivedDraw, b: DerivedDraw) =>
    (a.row.expectedDate || '').localeCompare(b.row.expectedDate || '') ||
    a.row.projectName.localeCompare(b.row.projectName)

  for (const b of buckets.values()) {
    b.outstanding.sort(byDate)
    b.received.sort((x, y) => x.paymentDate.localeCompare(y.paymentDate))
    b.needed = round2(b.needed)
    b.receivedTotal = round2(b.receivedTotal)
  }
  overdue.sort(byDate)
  unscheduled.sort((a, b) => a.row.projectName.localeCompare(b.row.projectName))

  return { months: months.map((k) => buckets.get(monthId(k))!), unscheduled, overdue }
}

/**
 * Reconcile every project at once: the schedule, the ledger and the contract
 * totals in, derived draws out.
 *
 * ⛔ DRAWS ARE ORDERED BY THE AUTHORED SCHEDULE (`sortOrder`), NEVER BY
 * `expectedDate`.
 *
 * This sorted by expected date, and it was a real bug with a very confusing
 * symptom: dragging a card to another month CHANGED THE WATERFALL ORDER, so
 * whichever draw counted as "paid" jumped to a different card. Andrew:
 * "it's making a new card for $1 and saying the $6k ish was received but then
 * changes when I move the new card."
 *
 * Deposit-then-final is a property of the agreement. A forecast date is a
 * guess about timing and must not decide which draw a payment settled.
 */
export function reconcileAll(
  rows: PaymentRow[],
  entries: LedgerEntry[],
  contractTotals: Record<string, number>,
): DerivedDraw[] {
  const byProject = new Map<string, PaymentRow[]>()
  for (const r of rows) {
    const list = byProject.get(r.projectId)
    if (list) list.push(r)
    else byProject.set(r.projectId, [r])
  }
  const payByProject = new Map<string, LedgerEntry[]>()
  for (const e of entries) {
    const list = payByProject.get(e.projectId)
    if (list) list.push(e)
    else payByProject.set(e.projectId, [e])
  }

  const out: DerivedDraw[] = []
  for (const [projectId, draws] of byProject) {
    draws.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (a.createdAt || '').localeCompare(b.createdAt || '') ||
        a.label.localeCompare(b.label),
    )
    const r = reconcileProject(
      draws,
      payByProject.get(projectId) || [],
      contractTotals[projectId] ?? draws.reduce((s, d) => s + d.amount, 0),
    )
    out.push(...r.draws)
  }
  return out
}

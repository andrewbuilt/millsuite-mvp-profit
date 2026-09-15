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

/**
 * One payment, or the slice of one, that went to a particular draw.
 *
 * ⛔ A SLICE, NOT ALWAYS A WHOLE PAYMENT. The waterfall overflows: a $20,000
 * cheque against a $13,000 deposit puts $13,000 on the deposit and $7,000 on
 * the next draw. So `amount` is what THIS draw got, and `entry.amount` is what
 * the client actually sent. Any UI showing a slice has to say so — deleting it
 * removes the whole payment, not the slice.
 */
export interface AppliedPayment {
  entry: LedgerEntry
  amount: number
}

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
  /**
   * Which payments covered it, oldest first. ⛔ THIS IS WHAT LETS THE BOARD
   * STOP SHOWING THE SAME MONEY TWICE. Before it existed, a fully-paid draw
   * rendered as a grey "paid in full" card AND its payments rendered as green
   * receipt cards — Andrew: "I don't want to see both." Nothing linked the two,
   * so neither could be merged into the other.
   */
  applied: AppliedPayment[]
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
  /**
   * Money that reached no draw — an overpayment, or any payment on a project
   * with no schedule. Sums to `credit`.
   *
   * ⛔ IT MUST BE RETURNED, NOT DROPPED. Every dollar of the ledger has to land
   * in exactly one card on the board or a month's cards stop summing to its
   * Received figure — which is the complaint that started this: grey cards in
   * September summed past $100k while the header said $49,075.
   */
  unapplied: AppliedPayment[]
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

  // ⛔ OLDEST PAYMENT FIRST. The waterfall fills the oldest unpaid draw first,
  // so the payments have to be walked in the same direction or "Paid {date}"
  // names the wrong cheque. Ties break on id so the result is stable across
  // reloads — a card that reorders itself reads as data changing.
  const ordered = [...entries].sort(
    (a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.id.localeCompare(b.id),
  )

  if (draws.length === 0) {
    return {
      contractTotal,
      received,
      remaining: round2(Math.max(0, contractTotal - received)),
      draws: [],
      credit: round2(Math.max(0, received - contractTotal)),
      drift,
      empty: true,
      // No draws to attribute to: every payment is unapplied, and the board
      // still has to be able to render it.
      unapplied: ordered.map((entry) => ({ entry, amount: entry.amount })),
    }
  }

  // ── 1. Waterfall the money over the draws, oldest first ──
  // Tracks WHICH payment filled which draw, not just how much. A single
  // payment can span draws (a $20k cheque against a $13k deposit spills $7k
  // onto the next one), so an entry may appear in two draws as two slices.
  let cursor = 0
  let leftInEntry = ordered.length > 0 ? ordered[0].amount : 0
  const unapplied: AppliedPayment[] = []

  const out: DerivedDraw[] = draws.map((row) => {
    const stored = row.amount
    const applied: AppliedPayment[] = []
    let need = stored
    while (need > EPS && cursor < ordered.length) {
      if (leftInEntry <= EPS) {
        cursor++
        leftInEntry = cursor < ordered.length ? ordered[cursor].amount : 0
        continue
      }
      const take = round2(Math.min(need, leftInEntry))
      applied.push({ entry: ordered[cursor], amount: take })
      leftInEntry = round2(leftInEntry - take)
      need = round2(need - take)
    }
    const covered = round2(applied.reduce((s, a) => s + a.amount, 0))
    return {
      row,
      stored,
      scheduled: stored,
      covered,
      outstanding: round2(stored - covered),
      state: 'open' as DrawState,
      applied,
    }
  })

  // Whatever the draws couldn't absorb — an overpayment. Kept, never dropped.
  if (cursor < ordered.length) {
    if (leftInEntry > EPS) unapplied.push({ entry: ordered[cursor], amount: leftInEntry })
    for (let i = cursor + 1; i < ordered.length; i++) {
      unapplied.push({ entry: ordered[i], amount: ordered[i].amount })
    }
  }

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
    unapplied,
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

/**
 * One green card: money that landed, labelled with the draw it paid.
 *
 * ⛔ THIS REPLACES TWO CARDS WITH ONE. A fully-paid draw used to render as a
 * grey "paid in full" schedule card AND as one green receipt card per payment.
 * Andrew: "I don't want to see both." Worse, the grey card sat in the month the
 * draw was SCHEDULED while the green one sat in the month the money LANDED, so
 * a month's cards could sum past $100k while its header said $49,075. The card
 * is now the payment — it lives where the cash landed, and it carries the draw
 * label the grey card used to supply.
 */
export interface SettledCard {
  /** Stable React key: draw (or 'none') + month + first entry. */
  key: string
  projectId: string
  projectName: string
  /** The draw this money paid. NULL = it matched no draw (an overpayment, or a
   *  project with no schedule) — those keep their own card, unlabelled. */
  drawLabel: string | null
  drawId: string | null
  /** Sum of this card's slices — what landed THIS month against THIS draw. */
  amount: number
  /** The draw's full scheduled value, for "X of Y" when this doesn't finish it. */
  drawScheduled: number | null
  /** True when the draw is fully covered and this card carries its last money.
   *  Only then is "Paid {date}" honest. */
  completesDraw: boolean
  /** Latest payment date in the card. */
  paidOn: string
  /** The real ledger rows, for expand + delete. */
  entries: LedgerEntry[]
  /** ⚠️ TRUE when any entry here was SPLIT across draws, so the card shows
   *  less than the client actually sent. Deleting it removes the whole
   *  payment, not the slice — the UI has to say so. */
  partialEntry: boolean
}

export interface MonthBucket {
  key: MonthKey
  /** Draws with money still owed, expected this month. Soonest first.
   *  ⚠️ Fully-paid draws are NOT here — they owe nothing, and their money is a
   *  settled card in the month it arrived. */
  outstanding: DerivedDraw[]
  /** ⛔ THE GREEN CARDS, and the ONLY place cash appears. Their amounts sum to
   *  `receivedTotal` by construction — which is the month-math fix: every
   *  dollar of the ledger lands in exactly one card, in the month it landed. */
  settledCards: SettledCard[]
  /** Sum of `outstanding` — "needed this month". */
  needed: number
  /** Sum of the ledger entries dated this month — "came in this month". */
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
  /** Money that reached no draw, from every project's reconciliation. Each
   *  keeps its own card — it's real cash and the month has to foot. */
  unapplied: Array<AppliedPayment & { projectId: string; projectName: string }> = [],
): PaymentsView {
  const buckets = new Map<string, MonthBucket>()
  for (const k of months) {
    buckets.set(monthId(k), {
      key: k,
      outstanding: [],
      settledCards: [],
      needed: 0,
      receivedTotal: 0,
    })
  }
  const first = months[0]
  const idx = (k: MonthKey) => k.year * 12 + k.month
  const unscheduled: DerivedDraw[] = []
  const overdue: DerivedDraw[] = []

  // ── The draws that still owe something ──────────────────────────────────
  for (const d of draws) {
    if (d.row.status === 'cancelled') continue
    if (!isOutstanding(d.row) && d.row.status !== 'received') continue

    // ⛔ A SETTLED DRAW IS NOT A SCHEDULE CARD ANY MORE. It owes nothing, and
    // its money is rendered as a settled card below — in the month the cash
    // ARRIVED, which is the only way a month's cards can sum to its Received
    // figure. Leaving it here too is the duplicate Andrew asked us to kill.
    if (d.outstanding < SETTLED) continue

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

  // ── The cash, grouped into one card per (draw, month) ────────────────────
  // ⛔ GROUPED BY MONTH AS WELL AS BY DRAW. A draw paid across two months has
  // to produce a card in each, or one month claims money that landed in the
  // other and the header stops matching the cards under it.
  const cardBy = new Map<string, SettledCard>()
  /** The last card built for a project in a month — where crumbs go. */
  const lastForProject = new Map<string, SettledCard>()

  const push = (
    monthIdStr: string,
    key: string,
    seed: () => SettledCard,
    slice: AppliedPayment,
    projectKey?: string,
  ) => {
    const b = buckets.get(monthIdStr)
    if (!b) return // outside the window; the month totals below still ignore it

    // ⛔ A SUB-DOLLAR SPILL IS ROUNDING NOISE, NOT A PAYMENT ON THE NEXT DRAW.
    // Murtagh: the deposit row is $13,113 and the client paid $13,114, so a
    // dollar overflowed onto the next draw and rendered as its own green card
    // reading "$1 of $6,557" — which says the client made a one-dollar payment
    // toward the kickoff. That is the same phantom-$1 card Andrew rejected
    // once already (634c0eb); it just moved.
    //
    // So a crumb is folded into the previous card for the same project in the
    // same month. It is NOT dropped — the month has to keep footing — it just
    // stops claiming to be a payment against a draw nobody has paid.
    // ⚠️ `<=`, NOT `<`. A whole-dollar spill is the COMMON case, not an edge
    // one: draw amounts are stored as whole dollars, so a schedule that's a
    // dollar off its contract — which every schedule generated before
    // `allocateRounded` was — spills exactly $1.00. A strict `<` folds
    // Murtagh's 50¢ and leaves the next job's $1 card standing.
    const prior = projectKey ? lastForProject.get(projectKey) : undefined
    if (prior && slice.amount <= SETTLED) {
      prior.amount = round2(prior.amount + slice.amount)
      prior.entries.push(slice.entry)
      if (slice.entry.paymentDate > prior.paidOn) prior.paidOn = slice.entry.paymentDate
      return
    }

    let card = cardBy.get(key)
    if (!card) {
      card = seed()
      cardBy.set(key, card)
      b.settledCards.push(card)
    }
    card.amount = round2(card.amount + slice.amount)
    card.entries.push(slice.entry)
    if (slice.entry.paymentDate > card.paidOn) card.paidOn = slice.entry.paymentDate
    if (slice.amount + EPS < slice.entry.amount) card.partialEntry = true
    if (projectKey) lastForProject.set(projectKey, card)
  }

  for (const d of draws) {
    if (d.row.status === 'cancelled') continue
    const settled = d.outstanding < SETTLED
    for (const slice of d.applied) {
      const day = parseLocalDate(slice.entry.paymentDate)
      if (!day) continue
      const mId = monthId(monthOf(day))
      push(mId, `${d.row.id}:${mId}`, () => ({
        key: `${d.row.id}:${mId}`,
        projectId: d.row.projectId,
        projectName: d.row.projectName,
        drawLabel: d.row.label,
        drawId: d.row.id,
        amount: 0,
        drawScheduled: d.scheduled,
        // ⚠️ Only the draw being FULLY covered makes "Paid" true. A card that
        // carries half a draw says "$6,000 of $12,269" instead — claiming a
        // draw is paid when it isn't is how a board loses trust.
        completesDraw: settled,
        paidOn: slice.entry.paymentDate,
        entries: [],
        partialEntry: false,
      }), slice, `${d.row.projectId}:${mId}`)
    }
  }

  for (const u of unapplied) {
    const day = parseLocalDate(u.entry.paymentDate)
    if (!day) continue
    const mId = monthId(monthOf(day))
    push(mId, `unapplied:${u.entry.id}:${mId}`, () => ({
      key: `unapplied:${u.entry.id}:${mId}`,
      projectId: u.projectId,
      projectName: u.projectName,
      drawLabel: null,
      drawId: null,
      amount: 0,
      drawScheduled: null,
      completesDraw: false,
      paidOn: u.entry.paymentDate,
      entries: [],
      partialEntry: false,
    }), u)
  }

  // ⛔ receivedTotal COMES FROM THE LEDGER, NOT FROM THE CARDS. They must
  // agree — that is the invariant this whole change exists to create — so
  // deriving the header from the cards would make the check vacuous and hide
  // the very drift it's meant to catch.
  for (const e of ledger) {
    const day = parseLocalDate(e.paymentDate)
    if (!day) continue
    const b = buckets.get(monthId(monthOf(day)))
    if (!b) continue
    b.receivedTotal += e.amount
  }

  const byDate = (a: DerivedDraw, b: DerivedDraw) =>
    (a.row.expectedDate || '').localeCompare(b.row.expectedDate || '') ||
    a.row.projectName.localeCompare(b.row.projectName)

  for (const b of buckets.values()) {
    b.outstanding.sort(byDate)
    b.settledCards.sort(
      (x, y) => x.paidOn.localeCompare(y.paidOn) || x.projectName.localeCompare(y.projectName),
    )
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
  return reconcileEverything(rows, entries, contractTotals).draws
}

/** What `reconcileAll` returns, plus the money that reached no draw. */
export interface OrgReconciliation {
  draws: DerivedDraw[]
  unapplied: Array<AppliedPayment & { projectId: string; projectName: string }>
}

/**
 * ⛔ THE UNAPPLIED HALF IS NOT OPTIONAL. `reconcileAll` discarded it, which was
 * survivable while the board rendered raw ledger rows as their own green cards.
 * Now that every card comes from attribution, dropped money is INVISIBLE money
 * — and the worst case is a project with PAYMENTS BUT NO DRAWS, which has no
 * draws to iterate and so contributed nothing at all. That's ~$600k of
 * un-scheduled contracts on this board.
 */
export function reconcileEverything(
  rows: PaymentRow[],
  entries: LedgerEntry[],
  contractTotals: Record<string, number>,
  /** Only needed for projects that have payments but no draws — there's no
   *  draw row to read a name off. */
  projectNames: Record<string, string> = {},
): OrgReconciliation {
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

  const draws: DerivedDraw[] = []
  const unapplied: OrgReconciliation['unapplied'] = []

  // The UNION of both sides, so a project that has only payments is included.
  const projectIds = new Set([...byProject.keys(), ...payByProject.keys()])

  for (const projectId of projectIds) {
    const list = byProject.get(projectId) || []
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (a.createdAt || '').localeCompare(b.createdAt || '') ||
        a.label.localeCompare(b.label),
    )
    const r = reconcileProject(
      list,
      payByProject.get(projectId) || [],
      contractTotals[projectId] ?? list.reduce((s, d) => s + d.amount, 0),
    )
    draws.push(...r.draws)
    const projectName = list[0]?.projectName || projectNames[projectId] || 'Project'
    for (const u of r.unapplied) unapplied.push({ ...u, projectId, projectName })
  }
  return { draws, unapplied }
}

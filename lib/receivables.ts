// ============================================================================
// lib/receivables.ts — AR aging, reconciled against the cash ledger.
// ============================================================================
// PURE. No supabase import, so `scripts/verify-receivables.mjs` can run it
// without credentials. Same rule as lib/payment-ledger.
//
// ⛔ WHY THIS EXISTS RATHER THAN THE OLD INLINE REDUCE. The dashboard's
// Receivables card had three bugs, and the first one made it actively wrong
// for Built:
//
//  1. ⛔ IT READ `amount_received` AND NOTHING ELSE. In QuickBooks mode
//     `markMilestoneReceived` deliberately returns before touching the
//     invoice (lib/milestones:256) — money is meant to arrive via QB. It CAN
//     still get there: `lib/qb-events` → `syncInvoiceFromMilestoneReceived`
//     → `recordInvoicePayment` writes it, but only for a QB event someone has
//     confirmed on /qb-reconciliation. So `amount_received` is 0 for every
//     payment recorded the ordinary way on /payments, which is how Andrew's
//     $13,114 went in. That invoice read as fully outstanding, and overdue on
//     its due date, with the money sitting in `project_payments` untouched.
//     (An earlier draft of this comment claimed no writer existed at all.
//     Wrong — and the difference matters, because it means a QB org can have
//     the SAME money in both places, which is what the MAX below is for.)
//  2. ⛔ A NULL `due_date` VANISHED. The old reduce was if/else-if/else-if
//     with no final else, and every comparison against null is false — so an
//     invoice with no due date fell through all three buckets and was
//     silently dropped from a total labelled as the money owed. Same failure
//     class as the Leonard bug and the undated draws on /pm. Third time.
//  3. ⚠️ "TODAY" WAS UTC. `new Date().toISOString().slice(0,10)` rolls over
//     at 20:00 in New York, so for four hours every evening invoices due
//     today read as overdue. The caller passes a LOCAL day now.
//
// THE RECONCILIATION RULE — EACH INVOICE KEEPS ITS OWN, THE SURPLUS POURS:
//
//   surplus(project) = max(0, ledgerNet − Σ invoice.amount_received)
//
// Every invoice starts at its own `total − amountReceived`. Only the LEDGER
// SURPLUS — cash the invoices can't account for — waterfalls across them,
// oldest due first.
//
// ⛔ TWO WAYS TO GET THIS WRONG, BOTH OF WHICH I DID GET WRONG FIRST:
//
//   · SUMMING ledger and invoice receipts double-counts. In internal mode the
//     same dollar is recorded in both places. Hence the subtraction, which is
//     the same call the client portal made (`paid = Math.max(...)`).
//   · POURING THE WHOLE `max(...)` re-allocates receipts that were already
//     allocated. Invoice A (old, $5,000, unpaid) + invoice B (new, $2,000,
//     paid) on one project: pouring $2,000 oldest-first credits it to A, and
//     the card reports $3,000 overdue + $2,000 due-later when the truth is
//     $5,000 overdue and B settled. The TOTAL was right, which is what made
//     it easy to miss — the buckets are the only thing the card renders.
//
// ⛔ AND THE CALLER MUST PASS PAID INVOICES TOO. The ledger is PROJECT-level
// cash covering ALL of that project's obligations. Feed in only the open ones
// and a settled invoice's money has nothing to attach to, so the surplus
// wrongly wipes out what's genuinely still owed — the exact inverse of bug 1,
// and silent, because it under-reports. `openOnly` below is what renders;
// everything non-void is what reconciles.
// ============================================================================

export interface ArInvoice {
  id: string
  /** Null for an invoice not tied to a project — it then reconciles against
   *  nothing and falls back to its own `amountReceived`. */
  projectId: string | null
  /** 'YYYY-MM-DD', or null. Null is a real state, not a bug — see bucket 2. */
  dueDate: string | null
  total: number
  amountReceived: number
  /**
   * Does this invoice appear in the aging buckets?
   *
   * ⛔ FALSE STILL RECONCILES. A paid invoice is not shown, but its dollars
   * must still soak up the project's ledger cash — otherwise that cash spills
   * onto the open invoices and silently erases money the shop is owed.
   */
  open: boolean
}

export interface ArBucket {
  count: number
  total: number
}

export interface ArAging {
  overdue: ArBucket
  due7: ArBucket
  due30: ArBucket
  /** Owed, but not due within 30 days. The old card dropped these. */
  later: ArBucket
  /** Owed, with no due date at all. The old card dropped these too. */
  noDueDate: ArBucket
  /** Every unpaid dollar, in every bucket. */
  outstanding: number
  /** True when anything sits outside the three headline buckets, so the card
   *  can say so instead of quietly under-reporting. */
  hasUnbucketed: boolean
}

const EMPTY = (): ArBucket => ({ count: 0, total: 0 })

/** Cents-level tolerance. A balance under half a cent is settled. */
const EPS = 0.005

function addDays(iso: string, days: number): string {
  // Parsed as LOCAL midnight (not UTC) to match the caller's `today`.
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${mm}-${dd}`
}

/**
 * Age a set of AR invoices against the cash actually received.
 *
 * @param invoices    open invoices (status sent/partial)
 * @param ledgerByProject  project id → net dollars received (sum of
 *                    project_payments; may be absent for any project)
 * @param todayIso    TODAY AS A LOCAL CALENDAR DAY ('YYYY-MM-DD'). ⛔ Do not
 *                    pass `new Date().toISOString().slice(0,10)` — see bug 3.
 */
export function buildReceivables(
  invoices: ArInvoice[],
  ledgerByProject: Map<string, number>,
  todayIso: string,
): ArAging {
  const plus7 = addDays(todayIso, 7)
  const plus30 = addDays(todayIso, 30)

  // ── Reconcile per project, then pour across that project's invoices ──
  // Invoices with no project reconcile alone, so they can't share a credit.
  const byProject = new Map<string, ArInvoice[]>()
  const loners: ArInvoice[] = []
  for (const inv of invoices) {
    if (!inv.projectId) {
      loners.push(inv)
      continue
    }
    const list = byProject.get(inv.projectId)
    if (list) list.push(inv)
    else byProject.set(inv.projectId, [inv])
  }

  /** id → dollars still owed on that invoice. */
  const balances = new Map<string, number>()

  for (const inv of loners) {
    balances.set(inv.id, Math.max(0, inv.total - inv.amountReceived))
  }

  for (const [projectId, list] of byProject) {
    const fromInvoices = list.reduce((s, i) => s + i.amountReceived, 0)
    const fromLedger = ledgerByProject.get(projectId) ?? 0
    // Only the cash the invoices CAN'T account for is loose. Subtract, don't
    // max-then-pour — see the two failure modes in the header.
    let surplus = Math.max(0, fromLedger - fromInvoices)

    // Each invoice starts at what it says it's owed.
    for (const inv of list) {
      balances.set(inv.id, Math.max(0, inv.total - inv.amountReceived))
    }

    // Oldest due first; an invoice with no due date is paid last, because we
    // can't claim it came due before one that has a date.
    const ordered = [...list].sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    })

    for (const inv of ordered) {
      if (surplus <= EPS) break
      const owed = balances.get(inv.id) ?? 0
      const applied = Math.min(surplus, owed)
      surplus -= applied
      balances.set(inv.id, owed - applied)
    }
  }

  // ── Bucket ──
  const out: ArAging = {
    overdue: EMPTY(),
    due7: EMPTY(),
    due30: EMPTY(),
    later: EMPTY(),
    noDueDate: EMPTY(),
    outstanding: 0,
    hasUnbucketed: false,
  }

  for (const inv of invoices) {
    // ⛔ Paid/void invoices reconciled above and stop here. They are not
    // receivables; they were only ever in the list to absorb their own cash.
    if (!inv.open) continue
    const balance = +(balances.get(inv.id) ?? 0).toFixed(2)
    if (balance <= EPS) continue
    out.outstanding += balance

    // ⛔ EVERY ROW LANDS SOMEWHERE. The final `else` is the fix for bug 2 —
    // if you add a condition here, add its bucket too.
    let bucket: ArBucket
    if (!inv.dueDate) bucket = out.noDueDate
    else if (inv.dueDate < todayIso) bucket = out.overdue
    else if (inv.dueDate <= plus7) bucket = out.due7
    else if (inv.dueDate <= plus30) bucket = out.due30
    else bucket = out.later

    bucket.count += 1
    bucket.total += balance
  }

  out.outstanding = +out.outstanding.toFixed(2)
  out.hasUnbucketed = out.later.count > 0 || out.noDueDate.count > 0
  return out
}

/** Today as a LOCAL calendar day. The one safe source for `todayIso`. */
export function localToday(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

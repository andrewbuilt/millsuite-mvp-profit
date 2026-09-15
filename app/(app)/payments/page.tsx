'use client'

// ============================================================================
// /payments — the cash view: what's owed, what came in, and when
// ============================================================================
// Andrew: "automatically populates with the upcoming draw payments · drag the
// payment to another month · total needed for the month · the math of what has
// come in this month… really it's a ledger of the transactions. The project
// page is a link and ledger but the changes happen in the payments page."
//
// ⛔ THERE IS NO "MARK RECEIVED" HERE, AND THAT IS THE WHOLE POINT.
// A draw used to carry `status='received'`, which could only ever record the
// PROJECTED amount — so a client who paid something else had nowhere to go.
// Now you LOG A PAYMENT (amount + date) and a draw's paid-ness is DERIVED by
// `reconcileProject`. Partial, overpaid and out-of-order payments stop being
// special cases.
//
// ⛔ NOTHING ON THIS PAGE REWRITES THE SCHEDULE. Draw amounts stay as authored;
// the final-draw balancing is derived on read. Dragging writes `expected_date`
// and nothing else. (Two past bugs in this codebase came from a screen quietly
// persisting recomputed money.)
//
// QuickBooks: entry is manual. Bookkeeping lives in QB; this is an internal
// cash-flow tool. `qb_event_id` on the ledger is a hook for a future watcher.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, FileQuestion, Inbox, Plus, Trash2, X } from 'lucide-react'
import PlanGate from '@/components/plan-gate'
import GoalBanner from '@/components/payments/GoalBanner'
import DefineDrawsModal, { type DrawDraft } from '@/components/payments/DefineDrawsModal'
import { useAuth } from '@/lib/auth-context'
import { deriveMonthlyFixed } from '@/lib/sales-goal'
import { loadGoalSettings, type GoalSettings } from '@/lib/sales-goal-data'
import {
  loadShopRateSetup,
  sumOverheadAnnual,
  sumTeamAnnualComp,
} from '@/lib/shop-rate-setup'
import {
  addMonths,
  buildPaymentsView,
  currentMonth,
  deletePayment,
  loadOrgLedger,
  loadOrgPayments,
  createDrawSchedule,
  updateDrawSchedule,
  loadSoldProjects,
  logPayment,
  monthId,
  monthLabel,
  monthLabelShort,
  parseLocalDate,
  reconcileEverything,
  reschedulePayment,
  rescheduleTo,
  sameMonth,
  todayStamp,
  type DerivedDraw,
  type LedgerEntry,
  type MonthKey,
  type PaymentRow,
  type SettledCard,
  type SoldProjectRef,
} from '@/lib/payments'

/** How many months the board shows at once. Three is the horizon a shop plans
 *  cash against and it fits without scrolling. */
const VISIBLE_MONTHS = 3

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

function dayLabel(iso: string | null): string {
  const d = parseLocalDate(iso)
  if (!d) return 'No date'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

interface PayTarget {
  projectId: string
  projectName: string
  amount: number
}

export default function PaymentsPage() {
  const { org, user } = useAuth()
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [soldProjects, setSoldProjects] = useState<SoldProjectRef[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ledgerMissing, setLedgerMissing] = useState(false)
  const [monthOffset, setMonthOffset] = useState(0)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<PayTarget | null>(null)
  /** The project whose draws are being defined, or null. */
  const [defineFor, setDefineFor] = useState<SoldProjectRef | null>(null)
  const [defining, setDefining] = useState(false)
  /** Non-null = the modal is EDITING this project's existing draws rather than
   *  creating a schedule. Carries the lock state per row. */
  const [editDraws, setEditDraws] = useState<DrawDraft[] | null>(null)

  const [today] = useState(() => currentMonth())

  const refresh = useCallback(async () => {
    if (!org?.id) return
    const [sched, led, sold] = await Promise.all([
      loadOrgPayments(org.id),
      loadOrgLedger(org.id),
      loadSoldProjects(org.id),
    ])
    setSoldProjects(sold)
    setLoadError(sched.error || led.error)
    setLedgerMissing(led.missing)
    // Don't blank the board on a failed refresh — a failed drag would otherwise
    // wipe every card and leave an error above an empty page.
    if (!sched.error) {
      setRows(sched.rows)
      setTotals(sched.contractTotals)
    }
    if (!led.error) setLedger(led.entries)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const months = useMemo<MonthKey[]>(
    () => Array.from({ length: VISIBLE_MONTHS }, (_, i) => addMonths(today, monthOffset + i)),
    [today, monthOffset],
  )

  /**
   * Schedule × ledger → what's still owed on each draw, AND the money that
   * reached no draw.
   *
   * ⛔ THE UNAPPLIED HALF IS LOAD-BEARING NOW. Every green card is built by
   * attributing payments to draws, so a payment that attributes to nothing —
   * an overpayment, or any payment on a job with no schedule — would simply
   * not render. It used to survive because the board drew raw ledger rows.
   */
  const { draws: derived, unapplied } = useMemo(
    () =>
      reconcileEverything(
        rows,
        ledger,
        totals,
        Object.fromEntries(soldProjects.map((p) => [p.id, p.name])),
      ),
    [rows, ledger, totals, soldProjects],
  )

  /**
   * THIS month, regardless of where the pager is.
   *
   * ⛔ Built from its own one-month view, not picked out of `view.months` —
   * paging three months forward would otherwise leave the goal with no bucket
   * to read and the banner would vanish exactly when someone is planning
   * ahead. `buildPaymentsView` partitions its input, so asking it for one
   * month is the honest way to get one month.
   */
  const thisMonthBucket = useMemo(
    () => buildPaymentsView(derived, ledger, [today], today, unapplied).months[0] ?? null,
    [derived, ledger, today, unapplied],
  )

  /** Goal settings + the derived fixed cost behind them (migration 101). */
  const [goalSettings, setGoalSettings] = useState<GoalSettings | null>(null)
  const [derivedFixed, setDerivedFixed] = useState(0)
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      // ⛔ loadShopRateSetup THROWS (it uses .single()). Unguarded, one
      // transient failure left the goal permanently 'unset' behind an
      // unhandled rejection.
      const settings = await loadGoalSettings(org.id).catch(() => null)
      const setup = await loadShopRateSetup(org.id).catch(() => null)
      if (cancelled) return
      setGoalSettings(settings)
      setDerivedFixed(
        setup
          ? deriveMonthlyFixed(sumOverheadAnnual(setup.overhead), sumTeamAnnualComp(setup.team))
          : 0,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const view = useMemo(
    () => buildPaymentsView(derived, ledger, months, today, unapplied),
    [derived, ledger, months, today, unapplied],
  )

  /** Still owed across every sold job — not just the visible window. */
  const outstandingTotal = useMemo(
    () => derived.reduce((s, d) => s + d.outstanding, 0),
    [derived],
  )

  /** Every sold job can receive a payment — INCLUDING ones with no draw
   *  schedule. Deriving this from the schedule meant a job with no draws
   *  couldn't even be picked in the Log-a-payment modal. */
  const projectOptions = useMemo(
    () =>
      [...soldProjects]
        .map((p) => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [soldProjects],
  )

  /**
   * Sold jobs with NO draw schedule at all.
   * ⛔ Surfaced, never silently omitted — the board reads FROM the schedule, so
   * these contribute nothing to any total and would otherwise be invisible
   * money. This is how $426k of Leonard work went missing.
   */
  const unscheduledProjects = useMemo(() => {
    const withDraws = new Set(rows.map((r) => r.projectId))
    return soldProjects
      .filter((p) => !withDraws.has(p.id))
      .sort((a, b) => b.contractTotal - a.contractTotal)
  }, [rows, soldProjects])

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of soldProjects) m.set(p.id, p.name)
    for (const r of rows) m.set(r.projectId, r.projectName)
    return m
  }, [rows, soldProjects])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDropInto(target: MonthKey) {
    const id = dragId
    setDragId(null)
    setDragOver(null)
    if (!id) return
    const row = rows.find((r) => r.id === id)
    if (!row) return
    const next = rescheduleTo(row, target)
    if (next === row.expectedDate) return
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, expectedDate: next } : r)))
    await run(id, () => reschedulePayment(id, next, org?.id))
  }

  const pagerLabel =
    monthOffset === 0 ? null : monthOffset < 0 ? `${-monthOffset}m back` : `${monthOffset}m ahead`

  /**
   * Open the schedule editor for a project, prefilled from its real draws.
   *
   * ⛔ THERE WAS NO EDIT PATH AT ALL. `DefineDrawsModal` only ran on first
   * setup, `createDrawSchedule` refuses once draws exist, and the old
   * milestone builder now refuses on any project with recorded cash — so a
   * mis-set percentage was permanent. Andrew hit exactly that.
   *
   * ⚠️ PERCENTAGES ARE DERIVED FROM THE STORED DOLLARS, because the board
   * doesn't carry `milestone_pct`. Dollars are what the schedule actually
   * holds; the percentage is a way of typing them.
   */
  const openEditDraws = useCallback(
    (projectId: string) => {
      const mine = derived
        .filter((d) => d.row.projectId === projectId && d.row.status !== 'cancelled')
        .sort((a, b) => a.row.sortOrder - b.row.sortOrder)
      if (mine.length === 0) return
      const contract = totals[projectId] ?? mine.reduce((s, d) => s + d.stored, 0)
      setDefineFor({
        id: projectId,
        name: mine[0].row.projectName,
        clientName: mine[0].row.clientName ?? null,
        contractTotal: contract,
      })
      setEditDraws(
        mine.map((d) => ({
          id: d.row.id,
          label: d.row.label,
          pct: contract > 0 ? String(Math.round((d.stored / contract) * 10000) / 100) : '0',
          note: '',
          // Any money credited against it locks it — re-authoring the amount
          // would un-say a payment, and removing it would orphan one.
          locked: d.covered > 0.005,
          lockedAmount: d.stored,
        })),
      )
    },
    [derived, totals],
  )

  /**
   * `/payments?edit=<projectId>` opens the editor for that project — how the
   * project page's "Edit draws" link gets here without a second editor.
   *
   * ⚠️ `window.location.search`, NOT `useSearchParams`: the hook forces the
   * page under a Suspense boundary at build time, and this is a client-only
   * concern on an already client-only page.
   *
   * ⛔ IT WAITS FOR THE DRAWS. `openEditDraws` reads `derived`, so firing
   * before the first load returns finds nothing and silently does nothing —
   * the link would simply look broken.
   */
  const editHandled = useRef(false)
  useEffect(() => {
    if (loading || editHandled.current || derived.length === 0) return
    const id = new URLSearchParams(window.location.search).get('edit')
    if (!id) return
    editHandled.current = true
    openEditDraws(id)
    // Drop the param so a refresh doesn't reopen the modal forever.
    window.history.replaceState({}, '', '/payments')
  }, [loading, derived, openEditDraws])

  const cardProps = (d: DerivedDraw) => ({
    draw: d,
    busy: busyId === d.row.id,
    onDragStart: () => setDragId(d.row.id),
    onDragEnd: () => {
      setDragId(null)
      setDragOver(null)
    },
    dragging: dragId === d.row.id,
    onEditDraws: () => openEditDraws(d.row.projectId),
    onLogPayment: () =>
      setPayFor({
        projectId: d.row.projectId,
        projectName: d.row.projectName,
        amount: d.outstanding,
      }),
  })

  return (
    <PlanGate requires="invoices">
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-6 max-w-[1200px] mx-auto">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[20px] font-semibold text-[#111]">Payments</h1>
            {/* ⛔ THE MONTH PAGER IS NOT HERE ANY MORE. Andrew: "the arrows
                are at the top of the page and i have to scroll up to advance
                to the next month." It now sits directly above the month
                columns AND sticks there — see MonthPager below. */}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setPayFor({ projectId: '', projectName: '', amount: 0 })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857]"
              >
                <Plus className="w-3.5 h-3.5" /> Log a payment
              </button>
            </div>
          </div>
          <p className="text-xs text-[#6B7280] mb-5">
            Draw payments on sold and in-production jobs. Drag one to move when
            you expect it — that changes the forecast, not the contract.
          </p>

          {ledgerMissing && (
            <div className="mb-4 text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
              Recording payments needs migration <code>099</code>. Until it runs
              the schedule still shows, but nothing can be marked paid.
            </div>
          )}
          {(error || loadError) && (
            <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error || `Couldn’t load payments: ${loadError}`}
            </div>
          )}

          {/* ⛔ THE GOAL IS ALWAYS THIS MONTH, never the paged month. The
              pager walks the FORECAST back and forth; a target that moved
              with it would silently answer a different question than the one
              the header appears to ask. `view.months[0]` is the paged window's
              first month, so it is deliberately not used here. */}
          {/* `goalSettings !== null` gates the render: without it a configured
              org flashed "Set a monthly goal" for a beat while the settings
              were still loading. */}
          {!loading && thisMonthBucket && goalSettings && (
            <GoalBanner
              inputs={{
                monthlyFixed: goalSettings.fixedMonthlyOverride ?? derivedFixed,
                materialPct: goalSettings.materialPct,
                profitPct: goalSettings.profitPct,
                // Consumables are derived from material × this, matching how
                // a job is priced. See lib/sales-goal.
                consumableMarkupPct: org?.consumable_markup_pct ?? 0,
                // Payroll is owner-only in the database, so an admin's
                // derived fixed cost is overhead alone. Pinning an override
                // is what makes the goal shareable.
                fixedIsKnown:
                  goalSettings.fixedMonthlyOverride != null || user?.role === 'owner',
              }}
              received={thisMonthBucket.receivedTotal}
              scheduled={thisMonthBucket.needed}
              monthLabel={monthLabel(today)}
              missing={goalSettings.missing}
              // ⛔ WITHOUT THIS THE BANNER INVENTED A ZERO. Pre-099 there is
              // no ledger, so `received` is 0 because nothing can be recorded
              // — not because nothing came in. /pm already refused to show a
              // figure in that state; this made the two disagree.
              ledgerMissing={ledgerMissing}
              canConfigure={user?.role === 'owner'}
            />
          )}

          {loading ? (
            <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading payments…</div>
          ) : rows.length === 0 && unscheduledProjects.length === 0 && !loadError ? (
            <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
              <div className="text-sm text-[#374151] font-medium mb-1">
                No draw payments yet.
              </div>
              <div className="text-xs text-[#9CA3AF]">
                Payment milestones are set per project before the sale. Once a
                job is sold, its draws show up here.
              </div>
            </div>
          ) : (
            <>
              {/* ⛔ Sold jobs with NO draw schedule. The board reads FROM the
                  schedule, so these contribute to no total and would otherwise
                  be invisible — which is exactly how three Leonard jobs worth
                  $426k went missing from a cash-flow page. */}
              {unscheduledProjects.length > 0 && (
                <section className="mb-4 bg-white border border-[#FDE68A] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A] flex items-center gap-2 flex-wrap">
                    <FileQuestion className="w-3.5 h-3.5 text-[#92400E]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#92400E]">
                      No payment schedule · {unscheduledProjects.length}
                    </span>
                    <span className="text-[11px] text-[#B45309]">
                      sold, but no draws set up — none of this is tracked below
                    </span>
                    <span className="ml-auto text-[13px] font-mono tabular-nums font-semibold text-[#92400E]">
                      {money(unscheduledProjects.reduce((s, p) => s + p.contractTotal, 0))}
                    </span>
                  </div>
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                    {unscheduledProjects.map((p) => (
                      // ⛔ OPENS THE MODAL, DOESN'T NAVIGATE. This used to link
                      // to the project page, where the only way to define a
                      // schedule was the milestone builder — which dead-ended
                      // on imported jobs. Andrew: "I cant add draws."
                      <button
                        key={p.id}
                        onClick={() => setDefineFor(p)}
                        className="text-left rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-2 hover:border-[#FDE68A] hover:bg-[#FFFBEB] transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium text-[#111] truncate">
                              {p.name}
                            </div>
                            <div className="text-[10.5px] text-[#6B7280] truncate">
                              {p.clientName || 'No client'} · set up draws →
                            </div>
                          </div>
                          <div className="text-[13px] font-semibold font-mono tabular-nums text-[#111] flex-shrink-0">
                            {money(p.contractTotal)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {view.overdue.length > 0 && (
                <section className="mb-4 bg-white border border-[#FECACA] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FEF2F2] border-b border-[#FECACA] flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#B91C1C]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B91C1C]">
                      Past due · {view.overdue.length}
                    </span>
                    <span className="ml-auto text-[13px] font-mono tabular-nums font-semibold text-[#B91C1C]">
                      {money(view.overdue.reduce((s, d) => s + d.outstanding, 0))}
                    </span>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {view.overdue.map((d) => (
                      <DrawCard key={d.row.id} {...cardProps(d)} />
                    ))}
                  </div>
                </section>
              )}

              {view.unscheduled.length > 0 && (
                <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center gap-2 flex-wrap">
                    <Inbox className="w-3.5 h-3.5 text-[#6B7280]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      No date set · {view.unscheduled.length}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF]">
                      drag one into a month to schedule it
                    </span>
                    <span className="ml-auto text-[13px] font-mono tabular-nums text-[#374151]">
                      {money(view.unscheduled.reduce((s, d) => s + d.outstanding, 0))}
                    </span>
                  </div>
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                    {view.unscheduled.map((d) => (
                      <DrawCard key={d.row.id} {...cardProps(d)} />
                    ))}
                  </div>
                </section>
              )}

              {/* ⛔ STICKY, AND THAT IS THE POINT — not merely "moved down".
                  September's column is taller than the viewport, so a pager
                  that merely sat above the grid would still be scrolled off
                  by the time you wanted it. `top-14` clears the app nav
                  (h-14); raising the nav means raising this. */}
              <div className="sticky top-14 z-20 -mx-6 px-6 py-2 mb-3 bg-[#FAFAFA]/95 backdrop-blur-sm border-b border-[#E5E7EB] flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setMonthOffset((o) => o - 1)}
                  aria-label="Back a month"
                  title="Back a month"
                  className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                >
                  ◀
                </button>
                {/* "Sep – Nov 2026", not "September 2026 – November 2026" —
                    the full form is 30 characters of chrome on a bar whose
                    job is to stay out of the way. The year repeats only when
                    the window actually straddles one. */}
                <span className="text-[12px] font-semibold text-[#111] tabular-nums min-w-[120px] text-center">
                  {(() => {
                    const first = view.months[0].key
                    const last = view.months[view.months.length - 1].key
                    return first.year === last.year
                      ? `${monthLabelShort(first)} – ${monthLabelShort(last)} ${last.year}`
                      : `${monthLabelShort(first)} ${first.year} – ${monthLabelShort(last)} ${last.year}`
                  })()}
                </span>
                <button
                  onClick={() => setMonthOffset((o) => o + 1)}
                  aria-label="Forward a month"
                  title="Forward a month"
                  className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                >
                  ▶
                </button>
                <button
                  onClick={() => setMonthOffset(0)}
                  disabled={monthOffset === 0}
                  title="Jump back to this month"
                  className={`px-3 py-1 rounded-md border text-[11px] ${
                    monthOffset === 0
                      ? 'border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF] cursor-default'
                      : 'border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]'
                  }`}
                >
                  Today
                </button>
                {pagerLabel && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                    {pagerLabel}
                  </span>
                )}
                {/* ⚠️ The goal banner above always reads THIS month, never the
                    paged one — so say so once you've paged away, or the two
                    numbers look like they disagree. */}
                {monthOffset !== 0 && (
                  <span className="text-[11px] text-[#9CA3AF] ml-auto">
                    Goal above still shows {monthLabel(today)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                {view.months.map((b) => {
                  const id = monthId(b.key)
                  const isNow = sameMonth(b.key, today)
                  // Strictly AHEAD of this month. `isNow` is deliberately not
                  // future: money can land in the month you're standing in.
                  const isFuture = monthId(b.key) > monthId(today)
                  const isOver = dragOver === id
                  return (
                    <section
                      key={id}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOver(id)
                      }}
                      onDragLeave={() => setDragOver((x) => (x === id ? null : x))}
                      onDrop={(e) => {
                        // Firefox navigates an un-prevented drop onto an <a>.
                        e.preventDefault()
                        void handleDropInto(b.key)
                      }}
                      className={`rounded-xl border transition-colors min-h-[320px] ${
                        isOver
                          ? 'border-[#2563EB] bg-[#EFF6FF]'
                          : isNow
                            ? 'border-[#BFDBFE] bg-white'
                            : 'border-[#E5E7EB] bg-white'
                      }`}
                    >
                      <div className="px-3 pt-3 pb-2 border-b border-[#F3F4F6]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-[#111]">
                            {monthLabel(b.key)}
                          </span>
                          {isNow && (
                            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF]">
                              This month
                            </span>
                          )}
                        </div>
                        {/* ⛔ ONE NUMBER, AND "NEEDED" IS NOT ITS NAME.
                            Andrew: "the 'needed' on the month card doesnt make
                            sense." It summed the scheduled draws — which is
                            the very definition the sales goal replaced, so the
                            page was using one word for two different things
                            (the goal banner says "needed" meaning the target).
                            A month that has happened shows what LANDED; a
                            month ahead has nothing to have landed, so it shows
                            what's PLANNED. */}
                        {isFuture ? (
                          <div className="mt-1.5 flex items-baseline gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                              Scheduled
                            </span>
                            <span className="text-[15px] font-semibold text-[#111] font-mono tabular-nums">
                              {money(b.needed)}
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1.5 flex items-baseline gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-[#059669] font-semibold">
                              Received
                            </span>
                            <span className="text-[15px] font-semibold text-[#059669] font-mono tabular-nums">
                              {money(b.receivedTotal)}
                            </span>
                            {/* Still owed in a month that's already here —
                                dropping it silently would hide the gap
                                between what was planned and what came in. */}
                            {b.needed > 0 && (
                              <span className="text-[11px] text-[#9CA3AF] font-mono tabular-nums">
                                · {money(b.needed)} still scheduled
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="p-2 space-y-1.5">
                        {b.outstanding.length === 0 && b.settledCards.length === 0 ? (
                          <div className="text-[11.5px] text-[#D1D5DB] italic px-1 py-3 text-center">
                            Nothing due.
                          </div>
                        ) : (
                          <>
                            {b.outstanding.map((d) => (
                              <DrawCard key={d.row.id} {...cardProps(d)} />
                            ))}
                            {/* ⛔ ONE GREEN CARD PER SETTLED DRAW, IN THE MONTH
                                THE MONEY LANDED. This replaces two cards that
                                said the same thing in different months — a
                                grey "paid in full" draw card where it was
                                SCHEDULED plus a green receipt card where it
                                ARRIVED. Andrew: "I don't want to see both",
                                and the split is why a month's cards could sum
                                past $100k under a $49,075 header. */}
                            {b.settledCards.map((c) => (
                              <SettledDrawCard
                                key={c.key}
                                card={c}
                                busyId={busyId}
                                onDeleteEntry={(id) =>
                                  void run(id, () => deletePayment(id, org?.id))
                                }
                              />
                            ))}
                          </>
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>

              <div className="mt-4 text-[11px] text-[#9CA3AF]">
                {money(outstandingTotal)} still owed across every sold job with
                a schedule — including months outside this window.
                {unscheduledProjects.length > 0 && (
                  <>
                    {' '}
                    <span className="text-[#B45309]">
                      Another{' '}
                      {money(unscheduledProjects.reduce((s, p) => s + p.contractTotal, 0))}{' '}
                      of contract value has no draws set up and isn’t counted.
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {defineFor && (
        <DefineDrawsModal
          projectName={defineFor.name}
          contractTotal={defineFor.contractTotal}
          saving={defining}
          existing={editDraws ?? undefined}
          onCancel={() => {
            setDefineFor(null)
            setEditDraws(null)
          }}
          onSave={async (drawRows) => {
            if (!org?.id) return
            setDefining(true)
            try {
              if (editDraws) {
                // ⛔ EDIT, NOT REPLACE. `updateDrawSchedule` matches on id and
                // refuses to drop a draw that money was credited against.
                await updateDrawSchedule(
                  org.id,
                  defineFor.id,
                  drawRows,
                  editDraws.filter((d) => d.locked).map((d) => d.id!),
                )
              } else {
                await createDrawSchedule(org.id, defineFor.id, drawRows)
              }
              setDefineFor(null)
              setEditDraws(null)
              await refresh()
            } finally {
              setDefining(false)
            }
          }}
        />
      )}

      {payFor && (
        <LogPaymentModal
          target={payFor}
          projects={projectOptions}
          onClose={() => setPayFor(null)}
          onSave={async (input) => {
            if (!org?.id) return
            await logPayment({ ...input, orgId: org.id, createdBy: user?.id ?? null })
            setPayFor(null)
            await refresh()
          }}
        />
      )}
    </PlanGate>
  )
}

/** A draw with money still owed. Draggable between months; the big number is
 *  what REMAINS, not what was originally scheduled. */
function DrawCard({
  draw,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
  onLogPayment,
  onEditDraws,
}: {
  draw: DerivedDraw
  busy: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onLogPayment: () => void
  onEditDraws: () => void
}) {
  const { row, scheduled, covered, outstanding, state } = draw
  return (
    <div
      draggable
      onDragStart={(e) => {
        // Firefox won't start a drag without something on the dataTransfer.
        e.dataTransfer.setData('text/plain', row.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`rounded-lg border px-2.5 py-2 transition-colors bg-white cursor-grab active:cursor-grabbing ${
        state === 'partial' ? 'border-[#FDE68A]' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
      } ${dragging ? 'opacity-40' : ''} ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${row.projectId}`}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            className="text-[12.5px] font-medium text-[#111] hover:text-[#2563EB] hover:underline truncate block"
          >
            {row.projectName}
          </Link>
          <div className="text-[10.5px] text-[#6B7280] truncate flex items-center gap-1">
            <span className="truncate">
              {row.label}
              {row.clientName ? ` · ${row.clientName}` : ''}
            </span>
            {/* The only way back into the schedule. Andrew mis-set his
                percentages on setup and had no route to correct them. */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEditDraws()
              }}
              draggable={false}
              title="Edit this project's draw schedule"
              className="flex-shrink-0 text-[9.5px] text-[#9CA3AF] hover:text-[#2563EB] hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="text-[10px] text-[#9CA3AF] mt-0.5 flex items-center gap-1 flex-wrap">
            <CalendarClock className="w-2.5 h-2.5" />
            {dayLabel(row.expectedDate)}
            {/* A part-paid draw must show BOTH numbers, or the card looks like
                the draw shrank for no reason. */}
            {state === 'partial' && (
              <span className="px-1 rounded bg-[#FFFBEB] text-[#92400E]">
                {money(covered)} of {money(scheduled)} in
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[13px] font-semibold font-mono tabular-nums text-[#111]">
            {money(outstanding)}
          </div>
          <button
            disabled={busy}
            onClick={onLogPayment}
            title="Record a payment against this job"
            className="mt-1 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-[#E5E7EB] text-[#6B7280] hover:border-[#059669] hover:text-[#059669] hover:bg-[#ECFDF5] disabled:opacity-50"
          >
            <Plus className="w-2.5 h-2.5" /> Payment
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Money that landed, labelled with the draw it paid.
 *
 * ⛔ THIS IS ONE CARD WHERE THERE USED TO BE TWO. A fully-paid draw rendered
 * as a grey "paid in full" schedule card in the month it was SCHEDULED, and
 * its payments rendered as separate green receipt cards in the month they
 * ARRIVED. Andrew: "I don't want to see both." The two also disagreed about
 * which month they belonged to, which is why September's cards could sum past
 * $100,000 while its header said $49,075.
 *
 * ⚠️ The header is summed from the ledger and these cards are built by
 * attributing payments to draws — two different code paths. They agree by
 * construction, and `verify-payments-board` asserts it.
 */
function SettledDrawCard({
  card,
  busyId,
  onDeleteEntry,
}: {
  card: SettledCard
  busyId: string | null
  onDeleteEntry: (entryId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const refund = card.amount < 0
  // Multiple receipts, or a slice of a bigger cheque, both need the detail.
  const expandable = card.entries.length > 1 || card.partialEntry
  const busy = card.entries.some((e) => e.id === busyId)

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 group ${
        refund ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#A7F3D0] bg-[#F0FDF4]'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${card.projectId}`}
            className="text-[12.5px] font-medium text-[#111] hover:underline truncate block"
          >
            {card.projectName}
          </Link>
          {/* The draw label the grey card used to carry. Unlabelled means the
              money matched no draw — an overpayment, or a job with no
              schedule — and saying so is the point of keeping it separate. */}
          <div className="text-[11px] text-[#374151] mt-0.5 truncate">
            {card.drawLabel ?? 'Payment — no draw matched'}
          </div>
          <div className="text-[10px] text-[#6B7280] mt-0.5 truncate">
            {card.completesDraw ? (
              <>Paid {dayLabel(card.paidOn)}</>
            ) : card.drawScheduled != null ? (
              // ⚠️ NEVER "Paid" ON A PART-PAID DRAW. The remainder is still a
              // schedule card in its own month; claiming this one is settled
              // would double-count it as done.
              <>
                {money(card.amount)} of {money(card.drawScheduled)} · {dayLabel(card.paidOn)}
              </>
            ) : (
              <>Received {dayLabel(card.paidOn)}</>
            )}
            {card.entries.length > 1 ? ` · ${card.entries.length} payments` : ''}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className={`text-[13px] font-semibold font-mono tabular-nums ${
              refund ? 'text-[#B91C1C]' : 'text-[#059669]'
            }`}
          >
            {money(card.amount)}
          </div>
          {expandable ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-[10px] text-[#059669] hover:underline"
            >
              {open ? 'Hide' : 'Details'}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => onDeleteEntry(card.entries[0].id)}
              title="Remove this payment"
              className="mt-1 p-0.5 text-[#D1D5DB] hover:text-[#DC2626] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-[#A7F3D0] space-y-1">
          {/* ⚠️ DELETING REMOVES THE WHOLE PAYMENT, NOT THE SLICE. A cheque
              that spilled across two draws appears on two cards; the amounts
              shown are its parts, but there is only one ledger row. */}
          {card.partialEntry && (
            <div className="text-[9.5px] text-[#047857] leading-snug">
              Part of a larger payment — deleting removes all of it.
            </div>
          )}
          {card.entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#6B7280] truncate">
                {dayLabel(e.paymentDate)}
                {e.method ? ` · ${e.method}` : ''}
                {e.reference ? ` · ${e.reference}` : ''}
              </span>
              <span className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10.5px] font-mono tabular-nums text-[#059669]">
                  {money(e.amount)}
                </span>
                <button
                  disabled={busyId === e.id}
                  onClick={() => onDeleteEntry(e.id)}
                  title="Remove this payment"
                  className="p-0.5 text-[#D1D5DB] hover:text-[#DC2626]"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Log cash received. The amount defaults to what's outstanding on the draw
 *  you clicked, because "they paid the deposit" is the common case — but it's
 *  editable, which is the entire reason this table exists. */
function LogPaymentModal({
  target,
  projects,
  onClose,
  onSave,
}: {
  target: PayTarget
  projects: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (input: {
    projectId: string
    amount: number
    paymentDate: string
    method: string | null
    reference: string | null
    notes: string | null
  }) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(target.projectId)
  const [amount, setAmount] = useState(target.amount ? String(Math.round(target.amount)) : '')
  const [paymentDate, setPaymentDate] = useState(todayStamp())
  const [method, setMethod] = useState<string>('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    const n = Number(amount)
    if (!projectId) {
      setErr('Pick a project.')
      return
    }
    if (!amount.trim() || !Number.isFinite(n) || n === 0) {
      setErr('Enter an amount. A refund can be negative; zero can’t.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        projectId,
        amount: n,
        paymentDate,
        method: method || null,
        reference: reference || null,
        notes: notes || null,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record that payment.')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Log a payment"
        className="fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,92vw)] bg-white border border-[#E5E7EB] rounded-xl shadow-xl p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-[#111]">Log a payment</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Project
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            >
              <option value="">Pick a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Amount
              </span>
              <input
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full mt-0.5 px-2 py-1.5 text-[13px] font-mono tabular-nums border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Date received
              </span>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Method
              </span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              >
                <option value="">—</option>
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Check / ref
              </span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="1042"
                className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Note
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              placeholder="Optional"
              className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
            />
          </label>

          <p className="text-[10.5px] text-[#9CA3AF] leading-snug">
            Whatever they actually paid — it doesn’t have to match the draw. The
            remaining draws rebalance, and the final one absorbs the difference.
          </p>

          {err && (
            <div className="text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1.5">
              {err}
            </div>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              disabled={busy}
              onClick={() => void submit()}
              className="px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857] disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Record payment'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

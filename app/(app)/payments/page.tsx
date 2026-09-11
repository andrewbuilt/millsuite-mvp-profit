'use client'

// ============================================================================
// /payments — upcoming draws, by the month the cash lands in
// ============================================================================
// Andrew: "automatically populates with the upcoming draw payments · drag the
// payment to another month · mark as received · total needed for the month ·
// the math of what has come in this month."
//
// Rolling month columns with the /schedule pager feel (◀ Today ▶). Two trays
// sit above the board and are the parts most likely to matter:
//   · OVERDUE — still owed, expected before the window. The single most
//     important row on the page; it must never be something you scroll past.
//   · UNSCHEDULED — real draws with no expected date, which belong to no
//     column and would otherwise be invisible.
//
// ⛔ MARKING RECEIVED IS NOT AN INVOICE OPERATION HERE. `markMilestoneReceived`
// behaves differently by invoicing mode: internal mode also records a payment
// on the contract invoice; QUICKBOOKS MODE DELIBERATELY STOPS at the milestone,
// because money is meant to arrive via the QB watcher. BUILT IS A QB ORG, so on
// this page the milestone status IS the signal and `amount_received` staying 0
// is correct, not a bug. The portal learned this the hard way — it read only
// invoice payments and showed "$0 paid" against a project with real money on
// it. QB auto-matching stays future; don't build it here.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, CalendarClock, AlertTriangle, Inbox } from 'lucide-react'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { markMilestoneReceived } from '@/lib/milestones'
import {
  addMonths,
  buildPaymentsView,
  currentMonth,
  loadOrgPayments,
  monthId,
  monthLabel,
  parseLocalDate,
  reschedulePayment,
  rescheduleTo,
  sameMonth,
  type MonthKey,
  type PaymentRow,
} from '@/lib/payments'

/** How many months the board shows at once. Three fits without scrolling and
 *  is the horizon a shop actually plans cash against. */
const VISIBLE_MONTHS = 3

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** "Sep 15" — the day inside its column. */
function dayLabel(iso: string | null): string {
  const d = parseLocalDate(iso)
  if (!d) return 'No date'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

export default function PaymentsPage() {
  const { org } = useAuth()
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `today` is captured once per load rather than read at render time, so the
  // "Today" button and the current-month highlight can't disagree mid-session.
  const [today] = useState(() => currentMonth())

  /** Null until the first load resolves. Distinguishes "nothing here" from
   *  "we never managed to ask" — an empty board must only ever mean an empty
   *  board. */
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!org?.id) return
    const res = await loadOrgPayments(org.id)
    setLoadError(res.error)
    // ⛔ Don't blank the board on a failed refresh. A drag that fails would
    // otherwise wipe every card and leave an error floating above an empty
    // page that says "no draw payments yet".
    if (!res.error) setRows(res.rows)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const months = useMemo<MonthKey[]>(
    () =>
      Array.from({ length: VISIBLE_MONTHS }, (_, i) =>
        addMonths(today, monthOffset + i),
      ),
    [today, monthOffset],
  )

  // `today` is passed explicitly — "past due" is relative to today, never to
  // the window, which moves when the operator pages.
  const view = useMemo(() => buildPaymentsView(rows, months, today), [rows, months, today])

  /** Totals across the WHOLE board, not just the visible window — "what's
   *  still out there" shouldn't change because you paged forward. */
  const outstandingTotal = useMemo(
    () => rows.filter((r) => r.status !== 'received' && r.status !== 'cancelled')
      .reduce((s, r) => s + r.amount, 0),
    [rows],
  )

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      // Reload anyway: the optimistic move may or may not have landed, and a
      // board showing a card where it isn't is worse than a flicker.
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  /** Drop a dragged draw into a month. */
  async function handleDropInto(target: MonthKey) {
    const id = dragId
    setDragId(null)
    setDragOver(null)
    if (!id) return
    const row = rows.find((r) => r.id === id)
    if (!row) return
    // A received payment's month is when the money ARRIVED — that's a fact,
    // not a plan, so it isn't draggable and this is a no-op guard.
    if (row.status === 'received') return

    const next = rescheduleTo(row, target)
    if (next === row.expectedDate) return

    // Optimistic: the card should follow the cursor immediately.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, expectedDate: next } : r)))
    await run(id, () => reschedulePayment(id, next, org?.id))
  }

  const pagerLabel =
    monthOffset === 0 ? null : monthOffset < 0 ? `${-monthOffset}m back` : `${monthOffset}m ahead`

  return (
    <PlanGate requires="invoices">
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-6 max-w-[1200px] mx-auto">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[20px] font-semibold text-[#111]">Payments</h1>
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setMonthOffset((o) => o - 1)}
                title="Back a month"
                className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
              >
                ◀
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
              <button
                onClick={() => setMonthOffset((o) => o + 1)}
                title="Forward a month"
                className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
              >
                ▶
              </button>
              {pagerLabel && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE] ml-1">
                  {pagerLabel}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-[#6B7280] mb-5">
            Draw payments on sold and in-production jobs. Drag a payment to move
            when you expect it — that changes the forecast, not the contract.
          </p>

          {(error || loadError) && (
            <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error || `Couldn’t load payments: ${loadError}`}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading payments…</div>
          ) : rows.length === 0 && !loadError ? (
            <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
              <div className="text-sm text-[#374151] font-medium mb-1">
                No draw payments yet.
              </div>
              <div className="text-xs text-[#9CA3AF]">
                Payment milestones are set per project, on the project page. Once
                a job is sold, its draws show up here.
              </div>
            </div>
          ) : (
            <>
              {/* ── Overdue. Above the board on purpose. ── */}
              {view.overdue.length > 0 && (
                <section className="mb-4 bg-white border border-[#FECACA] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FEF2F2] border-b border-[#FECACA] flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#B91C1C]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B91C1C]">
                      Past due · {view.overdue.length}
                    </span>
                    <span className="ml-auto text-[13px] font-mono tabular-nums font-semibold text-[#B91C1C]">
                      {money(view.overdue.reduce((s, r) => s + r.amount, 0))}
                    </span>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {view.overdue.map((r) => (
                      <PaymentCard
                        key={r.id}
                        row={r}
                        busy={busyId === r.id}
                        onDragStart={() => setDragId(r.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOver(null)
                        }}
                        dragging={dragId === r.id}
                        onReceived={() =>
                          void run(r.id, () => markMilestoneReceived(r.id))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* ── Unscheduled tray ── */}
              {view.unscheduled.length > 0 && (
                <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center gap-2">
                    <Inbox className="w-3.5 h-3.5 text-[#6B7280]" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      No date set · {view.unscheduled.length}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF]">
                      drag one into a month to schedule it
                    </span>
                    <span className="ml-auto text-[13px] font-mono tabular-nums text-[#374151]">
                      {money(view.unscheduled.reduce((s, r) => s + r.amount, 0))}
                    </span>
                  </div>
                  <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
                    {view.unscheduled.map((r) => (
                      <PaymentCard
                        key={r.id}
                        row={r}
                        busy={busyId === r.id}
                        onDragStart={() => setDragId(r.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOver(null)
                        }}
                        dragging={dragId === r.id}
                        onReceived={() =>
                          void run(r.id, () => markMilestoneReceived(r.id))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* ── The board ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                {view.months.map((b) => {
                  const id = monthId(b.key)
                  const isNow = sameMonth(b.key, today)
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
                        // Firefox treats an un-prevented drop on an element
                        // containing an <a> as a navigation.
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

                        <div className="mt-1.5 flex items-baseline gap-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                            Needed
                          </span>
                          <span className="text-[15px] font-semibold text-[#111] font-mono tabular-nums">
                            {money(b.needed)}
                          </span>
                        </div>

                        {/* Received is shown wherever money actually landed —
                            not only the current month. A payment that arrived
                            in August is August's answer, and hiding it as soon
                            as the page rolls over makes the history useless. */}
                        {b.receivedTotal > 0 && (
                          <div className="mt-0.5 flex items-baseline gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-[#059669] font-semibold">
                              Received
                            </span>
                            <span className="text-[13px] font-semibold text-[#059669] font-mono tabular-nums">
                              {money(b.receivedTotal)}
                            </span>
                            {b.needed > 0 && (
                              <span className="text-[10px] text-[#9CA3AF] ml-auto font-mono tabular-nums">
                                {money(b.needed)} to go
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="p-2 space-y-1.5">
                        {b.outstanding.length === 0 && b.received.length === 0 ? (
                          <div className="text-[11.5px] text-[#D1D5DB] italic px-1 py-3 text-center">
                            Nothing due.
                          </div>
                        ) : (
                          <>
                            {b.outstanding.map((r) => (
                              <PaymentCard
                                key={r.id}
                                row={r}
                                busy={busyId === r.id}
                                onDragStart={() => setDragId(r.id)}
                                onDragEnd={() => {
                                  setDragId(null)
                                  setDragOver(null)
                                }}
                                dragging={dragId === r.id}
                                onReceived={() =>
                                  void run(r.id, () => markMilestoneReceived(r.id))
                                }
                              />
                            ))}
                            {b.received.map((r) => (
                              <PaymentCard key={r.id} row={r} busy={false} received />
                            ))}
                          </>
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>

              <div className="mt-4 text-[11px] text-[#9CA3AF]">
                {money(outstandingTotal)} outstanding across every sold job —
                including months outside this window.
              </div>
            </>
          )}
        </div>
      </div>
    </PlanGate>
  )
}

/** One draw. Received cards are inert: their date is a record of what happened,
 *  not a plan to be edited. */
function PaymentCard({
  row,
  busy,
  received = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  onReceived,
}: {
  row: PaymentRow
  busy: boolean
  received?: boolean
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onReceived?: () => void
}) {
  return (
    <div
      draggable={!received}
      onDragStart={(e) => {
        // ⛔ Firefox refuses to start a drag unless dataTransfer carries
        // something — without this the whole board is undraggable there, while
        // working fine in Chrome and Safari.
        e.dataTransfer.setData('text/plain', row.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      className={`rounded-lg border px-2.5 py-2 transition-colors ${
        received
          ? 'border-[#A7F3D0] bg-[#F0FDF4]'
          : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB] cursor-grab active:cursor-grabbing'
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
          <div className="text-[10.5px] text-[#6B7280] truncate">
            {row.label}
            {row.clientName ? ` · ${row.clientName}` : ''}
          </div>
          <div className="text-[10px] text-[#9CA3AF] mt-0.5 flex items-center gap-1">
            <CalendarClock className="w-2.5 h-2.5" />
            {received ? `Received ${dayLabel(row.receivedDate || row.expectedDate)}` : dayLabel(row.expectedDate)}
            {row.status === 'invoiced' && !received && (
              <span className="ml-1 px-1 rounded bg-[#EFF6FF] text-[#1E40AF]">invoiced</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className={`text-[13px] font-semibold font-mono tabular-nums ${
              received ? 'text-[#059669]' : 'text-[#111]'
            }`}
          >
            {money(row.amount)}
          </div>
          {!received && onReceived && (
            <button
              disabled={busy}
              onClick={onReceived}
              title="Mark this payment received"
              className="mt-1 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-[#E5E7EB] text-[#6B7280] hover:border-[#059669] hover:text-[#059669] hover:bg-[#ECFDF5] disabled:opacity-50"
            >
              <Check className="w-2.5 h-2.5" /> Received
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

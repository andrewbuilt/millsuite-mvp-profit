'use client'

// ============================================================================
// PaymentsBoard — the /payments cash-flow monitor (Payments v4, 2026-11-05)
// ============================================================================
// Two independent lists, drawn side by side by month:
//
//   GREEN cards = LEDGER payments, in the month they landed. One card per
//                 payment; click to edit, delete freely.
//   WHITE cards = FORECAST rows, in the month they're expected. Drag between
//                 months to move one (writes its date and nothing else).
//
// Month headers foot trivially: Received = Σ green, Scheduled = Σ white.
//
// ⛔ NOTHING HERE PAIRS A PAYMENT WITH A FORECAST ROW. Logging, editing or
// deleting a payment writes the ledger and nothing else. When a job's
// forecast stops footing to what's left (contract − received), it gets ONE
// quiet hint — "Forecast $X vs $Y remaining — Redivide" — and a human
// re-spreads it. (Exception, also human: the Edit forecast modal's "Record a
// payment" — a person ticks the draws a payment covered; see ForecastModal.)
// The only forecast writers are the ForecastModal (editor +
// Redivide) and the month drag.
//
// Takes an injectable api so /dev/payments-v4 can mount it on a fixture.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, FileQuestion, Inbox, Plus, Scale, Trash2, X } from 'lucide-react'
import ForecastModal, { type ForecastPurpose } from '@/components/payments/ForecastModal'
// Pure modules only (no Supabase client), so the /dev fixture can mount this.
import {
  addMonths,
  formatLocalDate,
  monthId,
  monthLabel,
  monthLabelShort,
  parseLocalDate,
  rescheduleTo,
  sameMonth,
  type MonthKey,
  type PaymentRow,
} from '@/lib/payment-schedule'
import {
  buildForecastView,
  forecastAll,
  paymentLabel,
  type LedgerEntry,
  type ProjectForecast,
} from '@/lib/payment-forecast'
import type { SoldProjectRef } from '@/lib/payments'

const todayStamp = () => formatLocalDate(new Date())

/** How many months the board shows at once. */
const VISIBLE_MONTHS = 3

export interface PaymentInput {
  projectId: string
  amount: number
  paymentDate: string
  label: string | null
  method: string | null
  reference: string | null
  notes: string | null
}

export interface PaymentsBoardApi {
  reschedule: (rowId: string, expectedDate: string) => Promise<void>
  logPayment: (input: PaymentInput) => Promise<void>
  updatePayment: (id: string, input: PaymentInput) => Promise<void>
  deletePayment: (id: string) => Promise<void>
  saveForecast: (
    projectId: string,
    rows: Array<{ id: string | null; label: string; amount: number }>,
    via: 'editor' | 'redivide',
    contractTotal: number,
  ) => Promise<void>
}

export interface PaymentsBoardData {
  rows: PaymentRow[]
  ledger: LedgerEntry[]
  contractTotals: Record<string, number>
  soldProjects: SoldProjectRef[]
}

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
  /** Present = editing that ledger entry. */
  entry?: LedgerEntry
  projectId: string
  amount: number
  label: string
}

interface ForecastTarget {
  purpose: ForecastPurpose
  projectId: string
}

export default function PaymentsBoard({
  data,
  api,
  today,
  onChanged,
  banner,
  initialEditProjectId,
  initialRedivideProjectId,
  ledgerMissing = false,
}: {
  data: PaymentsBoardData
  api: PaymentsBoardApi
  today: MonthKey
  /** Reload after a write. */
  onChanged: () => Promise<void>
  /** The goal banner (page-owned). */
  banner?: ReactNode
  /** `/payments?edit=<id>` — the project page's "Edit forecast" link. */
  initialEditProjectId?: string | null
  /** `/payments?redivide=<id>` — the project page's hint link. */
  initialRedivideProjectId?: string | null
  ledgerMissing?: boolean
}) {
  const { rows, ledger, contractTotals, soldProjects } = data
  const [monthOffset, setMonthOffset] = useState(0)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<PayTarget | null>(null)
  const [forecastFor, setForecastFor] = useState<ForecastTarget | null>(null)
  const [savingForecast, setSavingForecast] = useState(false)
  /** Bumped after a payment is recorded in the modal, so it re-mounts on the fresh rows. */
  const [modalNonce, setModalNonce] = useState(0)
  /** Optimistic dates while a drag saves. */
  const [moved, setMoved] = useState<Record<string, string>>({})

  const liveRows = useMemo(
    () => rows.map((r) => (moved[r.id] ? { ...r, expectedDate: moved[r.id] } : r)),
    [rows, moved],
  )

  const months = useMemo<MonthKey[]>(
    () => Array.from({ length: VISIBLE_MONTHS }, (_, i) => addMonths(today, monthOffset + i)),
    [today, monthOffset],
  )

  const projectNames = useMemo(
    () => Object.fromEntries(soldProjects.map((p) => [p.id, p.name])),
    [soldProjects],
  )
  /** Contract per project: the sold-projects list knows every sold job,
   *  including ones with no forecast rows (the loader's map only covers those
   *  with rows). */
  const contracts = useMemo(() => {
    const m: Record<string, number> = { ...contractTotals }
    for (const p of soldProjects) m[p.id] = p.contractTotal
    return m
  }, [contractTotals, soldProjects])

  const perProject = useMemo(
    () => forecastAll(liveRows, ledger, contracts, projectNames),
    [liveRows, ledger, contracts, projectNames],
  )
  const byProject = useMemo(() => new Map(perProject.map((p) => [p.projectId, p])), [perProject])

  /** ⛔ THE ONE QUIET HINT, per job: forecast ≠ remaining. */
  const hints = useMemo(() => perProject.filter((p) => p.needsRedivide && p.rows.length > 0), [perProject])
  /** Sold jobs with money left and NOTHING forecast — set one up. */
  const nothingForecast = useMemo(
    () =>
      perProject
        .filter((p) => p.rows.length === 0 && p.contractKnown && p.remaining >= 1)
        .sort((a, b) => b.remaining - a.remaining),
    [perProject],
  )
  /** Jobs with no contract value: nothing to foot against. */
  const noContract = useMemo(
    () => perProject.filter((p) => !p.contractKnown && (p.rows.length > 0 || p.received !== 0)),
    [perProject],
  )

  const view = useMemo(() => buildForecastView(liveRows, ledger, months, today), [liveRows, ledger, months, today])
  const forecastTotal = useMemo(() => liveRows.reduce((s, r) => s + r.amount, 0), [liveRows])
  const remainingTotal = useMemo(
    () => perProject.filter((p) => p.contractKnown).reduce((s, p) => s + p.remaining, 0),
    [perProject],
  )

  const projectOptions = useMemo(
    () =>
      [...new Map([...soldProjects.map((p) => [p.id, p.name] as const), ...liveRows.map((r) => [r.projectId, r.projectName] as const)])]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [soldProjects, liveRows],
  )

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      await onChanged()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDropInto(target: MonthKey) {
    const id = dragId
    setDragId(null)
    setDragOver(null)
    if (!id) return
    const row = liveRows.find((r) => r.id === id)
    if (!row) return
    const next = rescheduleTo(row, target)
    if (next === row.expectedDate) return
    setMoved((m) => ({ ...m, [id]: next }))
    await run(id, () => api.reschedule(id, next))
    setMoved((m) => {
      const { [id]: _drop, ...rest } = m
      return rest
    })
  }

  // Deep links from the project page. Waits for data so the modal has rows.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current) return
    const id = initialRedivideProjectId || initialEditProjectId
    if (!id || !byProject.has(id)) return
    deepLinked.current = true
    const p = byProject.get(id)!
    setForecastFor({
      projectId: id,
      purpose: initialRedivideProjectId ? 'redivide' : p.rows.length === 0 ? 'setup' : 'edit',
    })
  }, [initialEditProjectId, initialRedivideProjectId, byProject])

  const pagerLabel =
    monthOffset === 0 ? null : monthOffset < 0 ? `${-monthOffset}m back` : `${monthOffset}m ahead`

  const forecastCard = (r: PaymentRow) => (
    <ForecastCard
      key={r.id}
      row={r}
      busy={busyId === r.id}
      dragging={dragId === r.id}
      onDragStart={() => setDragId(r.id)}
      onDragEnd={() => {
        setDragId(null)
        setDragOver(null)
      }}
      onEdit={() => setForecastFor({ projectId: r.projectId, purpose: 'edit' })}
      onLogPayment={() => setPayFor({ projectId: r.projectId, amount: r.amount, label: r.label })}
    />
  )

  const fp: ProjectForecast | null = forecastFor ? byProject.get(forecastFor.projectId) ?? null : null

  return (
    <>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-[20px] font-semibold text-[#111]">Payments</h1>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setPayFor({ projectId: '', amount: 0, label: '' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857]"
          >
            <Plus className="w-3.5 h-3.5" /> Log a payment
          </button>
        </div>
      </div>
      <p className="text-xs text-[#6B7280] mb-5">
        Green = payments received (as recorded in QuickBooks). White = the forecast of what&apos;s
        still coming — drag a card to move when you expect it.
      </p>

      {ledgerMissing && (
        <div className="mb-4 text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
          Recording payments needs migration <code>099</code>. Until it runs the forecast still shows, but
          nothing can be logged.
        </div>
      )}
      {error && (
        <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {banner}

      {/* ⛔ THE ONE QUIET HINT. Forecast ≠ remaining is not an error — a
          payment landed or a change order moved the contract. Neutral grey,
          one line per job, one button. Nothing re-spreads by itself. */}
      {hints.length > 0 && (
        <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl overflow-hidden" aria-label="Forecast hints">
          <div className="px-4 py-2 bg-[#F9FAFB] border-b border-[#F3F4F6] flex items-center gap-2">
            <Scale className="w-3.5 h-3.5 text-[#6B7280]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              Unresolved · {hints.length}
            </span>
          </div>
          <div className="divide-y divide-[#F3F4F6]">
            {hints.map((p) => (
              <div key={p.projectId} className="px-4 py-1.5 flex items-center gap-2 flex-wrap">
                <Link href={`/projects/${p.projectId}`} className="text-[12.5px] text-[#111] hover:underline truncate min-w-0">
                  {p.projectName}
                </Link>
                {/* Andrew: "Forecast $X vs $Y remaining" didn't read. Unresolved =
                    paid + scheduled ≠ contract; Resolve opens the forecast. */}
                <span className="text-[11.5px] text-[#92400E] font-mono tabular-nums">
                  {money(Math.abs(p.gap))} unresolved
                </span>
                <span className="text-[11px] text-[#9CA3AF]">
                  paid + scheduled is {money(Math.abs(p.gap))} {p.gap > 0 ? 'over' : 'under'} the contract
                </span>
                <button
                  onClick={() => setForecastFor({ projectId: p.projectId, purpose: 'edit' })}
                  className="ml-auto text-[11.5px] font-medium text-[#2563EB] hover:underline"
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {nothingForecast.length > 0 && (
        <section className="mb-4 bg-white border border-[#FDE68A] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A] flex items-center gap-2 flex-wrap">
            <FileQuestion className="w-3.5 h-3.5 text-[#92400E]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#92400E]">
              Nothing forecast · {nothingForecast.length}
            </span>
            <span className="text-[11px] text-[#B45309]">sold, money still to come, no forecast rows</span>
            <span className="ml-auto text-[13px] font-mono tabular-nums font-semibold text-[#92400E]">
              {money(nothingForecast.reduce((s, p) => s + p.remaining, 0))}
            </span>
          </div>
          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
            {nothingForecast.map((p) => (
              <button
                key={p.projectId}
                onClick={() => setForecastFor({ projectId: p.projectId, purpose: 'setup' })}
                className="text-left rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-2 hover:border-[#FDE68A] hover:bg-[#FFFBEB] transition-colors"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-[#111] truncate">{p.projectName}</div>
                    <div className="text-[10.5px] text-[#6B7280] truncate">
                      {p.received > 0 ? `${money(p.received)} in · ` : ''}set up forecast →
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold font-mono tabular-nums text-[#111] flex-shrink-0">
                    {money(p.remaining)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {noContract.length > 0 && (
        <div className="mb-4 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
          No contract value on {noContract.map((p) => p.projectName).join(', ')} — the forecast can&apos;t be
          checked against anything. Set the project total.
        </div>
      )}

      {view.overdue.length > 0 && (
        <section className="mb-4 bg-white border border-[#FECACA] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-[#FEF2F2] border-b border-[#FECACA] flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-[#B91C1C]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B91C1C]">
              Past due · {view.overdue.length}
            </span>
            <span className="text-[11px] text-[#B91C1C]/70">forecast for an earlier month — drag it forward or edit it</span>
            <span className="ml-auto text-[13px] font-mono tabular-nums font-semibold text-[#B91C1C]">
              {money(view.overdue.reduce((s, r) => s + r.amount, 0))}
            </span>
          </div>
          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">{view.overdue.map(forecastCard)}</div>
        </section>
      )}

      {view.unscheduled.length > 0 && (
        <section className="mb-4 bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center gap-2 flex-wrap">
            <Inbox className="w-3.5 h-3.5 text-[#6B7280]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              No date set · {view.unscheduled.length}
            </span>
            <span className="text-[11px] text-[#9CA3AF]">drag one into a month to schedule it</span>
            <span className="ml-auto text-[13px] font-mono tabular-nums text-[#374151]">
              {money(view.unscheduled.reduce((s, r) => s + r.amount, 0))}
            </span>
          </div>
          <div className="p-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">{view.unscheduled.map(forecastCard)}</div>
        </section>
      )}

      {/* Sticky pager — `top-14` clears the app nav (h-14). */}
      <div className="sticky top-14 z-20 -mx-6 px-6 py-2 mb-3 bg-[#FAFAFA]/95 backdrop-blur-sm border-b border-[#E5E7EB] flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setMonthOffset((o) => o - 1)}
          aria-label="Back a month"
          className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
        >
          ◀
        </button>
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
          className="px-2.5 py-1 rounded-md border border-[#E5E7EB] bg-white text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
        >
          ▶
        </button>
        <button
          onClick={() => setMonthOffset(0)}
          disabled={monthOffset === 0}
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
        {monthOffset !== 0 && banner && (
          <span className="text-[11px] text-[#9CA3AF] ml-auto">Goal above still shows {monthLabel(today)}</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
        {view.months.map((b) => {
          const id = monthId(b.key)
          const isNow = sameMonth(b.key, today)
          const isFuture = id > monthId(today)
          const isOver = dragOver === id
          return (
            <section
              key={id}
              data-month={id}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(id)
              }}
              onDragLeave={() => setDragOver((x) => (x === id ? null : x))}
              onDrop={(e) => {
                e.preventDefault()
                void handleDropInto(b.key)
              }}
              className={`rounded-xl border transition-colors min-h-[320px] ${
                isOver ? 'border-[#2563EB] bg-[#EFF6FF]' : isNow ? 'border-[#BFDBFE] bg-white' : 'border-[#E5E7EB] bg-white'
              }`}
            >
              <div className="px-3 pt-3 pb-2 border-b border-[#F3F4F6]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#111]">{monthLabel(b.key)}</span>
                  {isNow && (
                    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF]">
                      This month
                    </span>
                  )}
                </div>
                {/* ⛔ THE HEADER IS THE SUM OF THE CARDS UNDER IT. Received =
                    Σ green, Scheduled = Σ white — nothing else feeds it. */}
                <div className="mt-1.5 flex items-baseline gap-1.5 flex-wrap">
                  {!isFuture && (
                    <>
                      <span className="text-[10px] uppercase tracking-wider text-[#059669] font-semibold">Received</span>
                      <span data-received className="text-[15px] font-semibold text-[#059669] font-mono tabular-nums">
                        {money(b.receivedTotal)}
                      </span>
                    </>
                  )}
                  {(isFuture || b.scheduled !== 0) && (
                    <>
                      <span className={`text-[10px] uppercase tracking-wider font-semibold ${isFuture ? 'text-[#9CA3AF]' : 'text-[#9CA3AF] ml-1'}`}>
                        Scheduled
                      </span>
                      <span
                        data-scheduled
                        className={`font-semibold font-mono tabular-nums ${isFuture ? 'text-[15px] text-[#111]' : 'text-[12px] text-[#6B7280]'}`}
                      >
                        {money(b.scheduled)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="p-2 space-y-1.5">
                {b.forecast.length === 0 && b.payments.length === 0 ? (
                  <div className="text-[11.5px] text-[#D1D5DB] italic px-1 py-3 text-center">Nothing here.</div>
                ) : (
                  <>
                    {b.forecast.map(forecastCard)}
                    {b.payments.map((e) => (
                      <PaymentCard
                        key={e.id}
                        entry={e}
                        projectName={projectNames[e.projectId] || byProject.get(e.projectId)?.projectName || 'Project'}
                        busy={busyId === e.id}
                        onOpen={() => setPayFor({ entry: e, projectId: e.projectId, amount: e.amount, label: e.label || '' })}
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
        {money(forecastTotal)} forecast across every job · {money(remainingTotal)} remaining on contracts
        (contract − received), including months outside this window.
      </div>

      {forecastFor && fp && (
        <ForecastModal
          key={`${forecastFor.projectId}:${forecastFor.purpose}:${modalNonce}`}
          purpose={forecastFor.purpose}
          projectName={fp.projectName}
          contractTotal={fp.contractTotal}
          received={fp.received}
          payments={ledger.filter((e) => e.projectId === fp.projectId)}
          rows={fp.rows.map((r) => ({ id: r.id, label: r.label, amount: r.amount }))}
          saving={savingForecast}
          onCancel={() => setForecastFor(null)}
          onRecordPayment={async (payment, keep) => {
            // Ledger first (the money is real), then the forecast as the
            // human left it: every row except the ones they ticked as paid.
            await api.logPayment({
              projectId: fp.projectId,
              amount: payment.amount,
              paymentDate: payment.paymentDate,
              label: payment.label,
              method: payment.method,
              reference: null,
              notes: null,
            })
            await api.saveForecast(fp.projectId, keep, 'editor', fp.contractTotal)
            await onChanged()
            setForecastFor({ projectId: fp.projectId, purpose: 'edit' })
            setModalNonce((n) => n + 1)
          }}
          onSave={async (out, via) => {
            setSavingForecast(true)
            try {
              await api.saveForecast(fp.projectId, out, via, fp.contractTotal)
              setForecastFor(null)
              await onChanged()
            } finally {
              setSavingForecast(false)
            }
          }}
        />
      )}

      {payFor && (
        <PaymentModal
          target={payFor}
          projects={projectOptions}
          onClose={() => setPayFor(null)}
          onSave={async (input) => {
            if (payFor.entry) await api.updatePayment(payFor.entry.id, input)
            else await api.logPayment(input)
            setPayFor(null)
            await onChanged()
          }}
          onDelete={
            payFor.entry
              ? async () => {
                  const id = payFor.entry!.id
                  setPayFor(null)
                  await run(id, () => api.deletePayment(id))
                }
              : undefined
          }
        />
      )}
    </>
  )
}

/** A white card: one forecast row. Draggable between months. */
function ForecastCard({
  row,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
  onEdit,
  onLogPayment,
}: {
  row: PaymentRow
  busy: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onEdit: () => void
  onLogPayment: () => void
}) {
  return (
    <div
      draggable
      data-forecast-card={row.id}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', row.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-[#E5E7EB] hover:border-[#D1D5DB] px-2.5 py-2 transition-colors bg-white cursor-grab active:cursor-grabbing ${
        dragging ? 'opacity-40' : ''
      } ${busy ? 'opacity-60' : ''}`}
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
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              draggable={false}
              title="Edit this job's forecast"
              className="flex-shrink-0 text-[9.5px] text-[#9CA3AF] hover:text-[#2563EB] hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="text-[10px] text-[#9CA3AF] mt-0.5 flex items-center gap-1">
            <CalendarClock className="w-2.5 h-2.5" />
            {dayLabel(row.expectedDate)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[13px] font-semibold font-mono tabular-nums text-[#111]">{money(row.amount)}</div>
          {/* Prefills the payment modal — and that is ALL it does. The row is
              not settled, locked or removed by the payment. */}
          <button
            disabled={busy}
            onClick={onLogPayment}
            title="Log a payment on this job (the forecast row stays as it is)"
            className="mt-1 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-[#E5E7EB] text-[#6B7280] hover:border-[#059669] hover:text-[#059669] hover:bg-[#ECFDF5] disabled:opacity-50"
          >
            <Plus className="w-2.5 h-2.5" /> Payment
          </button>
        </div>
      </div>
    </div>
  )
}

/** A green card: one ledger payment, in the month it landed. Click to edit. */
function PaymentCard({
  entry,
  projectName,
  busy,
  onOpen,
}: {
  entry: LedgerEntry
  projectName: string
  busy: boolean
  onOpen: () => void
}) {
  const refund = entry.amount < 0
  return (
    <button
      type="button"
      onClick={onOpen}
      data-payment-card={entry.id}
      title="Edit or delete this payment"
      className={`w-full text-left rounded-lg border px-2.5 py-2 ${
        refund ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#A7F3D0] bg-[#F0FDF4] hover:border-[#6EE7B7]'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-[#111] truncate">{projectName}</div>
          <div className="text-[11px] text-[#374151] mt-0.5 truncate">{paymentLabel(entry)}</div>
          <div className="text-[10px] text-[#6B7280] mt-0.5 truncate">
            {refund ? 'Refunded' : 'Received'} {dayLabel(entry.paymentDate)}
            {entry.method ? ` · ${entry.method}` : ''}
            {entry.reference ? ` · ${entry.reference}` : ''}
          </div>
        </div>
        <div
          className={`text-[13px] font-semibold font-mono tabular-nums flex-shrink-0 ${
            refund ? 'text-[#B91C1C]' : 'text-[#059669]'
          }`}
        >
          {money(entry.amount)}
        </div>
      </div>
    </button>
  )
}

/** Log a payment, or edit / delete one. Writes the LEDGER and nothing else. */
function PaymentModal({
  target,
  projects,
  onClose,
  onSave,
  onDelete,
}: {
  target: PayTarget
  projects: Array<{ id: string; name: string }>
  onClose: () => void
  onSave: (input: PaymentInput) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const e = target.entry
  const [projectId, setProjectId] = useState(target.projectId)
  const [amount, setAmount] = useState(
    e ? String(e.amount) : target.amount ? String(Math.round(target.amount * 100) / 100) : '',
  )
  const [paymentDate, setPaymentDate] = useState(e?.paymentDate || todayStamp())
  const [label, setLabel] = useState(e ? e.label || '' : target.label)
  const [method, setMethod] = useState<string>(e?.method || '')
  const [reference, setReference] = useState(e?.reference || '')
  const [notes, setNotes] = useState(e?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ⚠️ A date more than a month ahead is almost always a typo (Leonard's
  // deposit was keyed as 2027-06-30). Said, not blocked.
  const farFuture = (() => {
    const d = parseLocalDate(paymentDate)
    if (!d) return false
    const limit = new Date()
    limit.setDate(limit.getDate() + 31)
    return d > limit
  })()

  async function submit() {
    const n = Number(amount)
    if (!projectId) return setErr('Pick a project.')
    if (!amount.trim() || !Number.isFinite(n) || n === 0) return setErr('Enter an amount. A refund can be negative; zero can’t.')
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        projectId,
        amount: n,
        paymentDate,
        label: label.trim() || null,
        method: method || null,
        reference: reference || null,
        notes: notes || null,
      })
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Could not save that payment.')
      setBusy(false)
    }
  }

  const input =
    'w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]'
  const cap = 'text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]'

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={e ? 'Edit payment' : 'Log a payment'}
        className="fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,92vw)] bg-white border border-[#E5E7EB] rounded-xl shadow-xl p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-[#111]">{e ? 'Edit payment' : 'Log a payment'}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          <label className="block">
            <span className={cap}>Project</span>
            <select
              value={projectId}
              onChange={(x) => setProjectId(x.target.value)}
              disabled={!!e}
              className={`${input} bg-white disabled:bg-[#F9FAFB]`}
            >
              <option value="">Pick a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={cap}>Label</span>
            <input
              value={label}
              onChange={(x) => setLabel(x.target.value)}
              placeholder="App 3, Deposit…"
              className={input}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={cap}>Amount</span>
              <input
                autoFocus
                value={amount}
                onChange={(x) => setAmount(x.target.value)}
                onKeyDown={(x) => {
                  if (x.key === 'Enter') void submit()
                }}
                inputMode="decimal"
                placeholder="0.00"
                className={`${input} font-mono tabular-nums`}
              />
            </label>
            <label className="block">
              <span className={cap}>Date received</span>
              <input type="date" value={paymentDate} onChange={(x) => setPaymentDate(x.target.value)} className={input} />
            </label>
          </div>
          {farFuture && (
            <div className="text-[11px] text-[#B45309]">That date is more than a month from now — typo?</div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={cap}>Method</span>
              <select value={method} onChange={(x) => setMethod(x.target.value)} className={`${input} bg-white`}>
                <option value="">—</option>
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className={cap}>Check / ref</span>
              <input value={reference} onChange={(x) => setReference(x.target.value)} placeholder="1042" className={input} />
            </label>
          </div>

          <label className="block">
            <span className={cap}>Note</span>
            <input
              value={notes}
              onChange={(x) => setNotes(x.target.value)}
              onKeyDown={(x) => {
                if (x.key === 'Enter') void submit()
              }}
              placeholder="Optional"
              className={input}
            />
          </label>

          <p className="text-[10.5px] text-[#9CA3AF] leading-snug">
            Whatever they actually paid. This records the payment only — the draws stay as they are, and
            any difference shows as unresolved until you resolve it in the job&apos;s forecast.
          </p>

          {err && (
            <div className="text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1.5">{err}</div>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              disabled={busy}
              onClick={() => void submit()}
              className="px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857] disabled:opacity-50"
            >
              {busy ? 'Saving…' : e ? 'Save payment' : 'Record payment'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            {onDelete &&
              (confirmDelete ? (
                <button
                  onClick={() => void onDelete()}
                  className="ml-auto px-2.5 py-1.5 rounded-md bg-[#DC2626] text-white text-[12px] hover:bg-[#B91C1C]"
                >
                  Delete it
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Remove this payment"
                  className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#DC2626]"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              ))}
          </div>
        </div>
      </div>
    </>
  )
}

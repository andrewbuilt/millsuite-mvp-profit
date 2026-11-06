'use client'

// ============================================================================
// PaymentsBoard — the /payments cash-flow monitor (Payments v4, 2026-11-05)
// ============================================================================
// Two independent lists, drawn side by side by month:
//
//   GREEN cards = LEDGER payments, in the month they landed. One card per
//                 payment.
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
// ONE MODAL (Andrew, 2026-11-04): clicking ANY card — green or white — opens
// that job's ForecastModal, where payments are recorded, edited and removed
// alongside the draws. There is no separate payment modal and no Edit /
// + Payment buttons on the cards; the project name stays a link.
//
// Takes an injectable api so /dev/payments-v4 can mount it on a fixture.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, FileQuestion, Inbox, Scale } from 'lucide-react'
import ForecastModal, { type ForecastPurpose } from '@/components/payments/ForecastModal'
// Pure modules only (no Supabase client), so the /dev fixture can mount this.
import {
  addMonths,
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
    rows: Array<{ id: string | null; label: string; amount: number; expectedDate?: string | null }>,
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

interface ForecastTarget {
  purpose: ForecastPurpose
  projectId: string
  /** Open with Record a payment already open. */
  record?: boolean
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
  const [forecastFor, setForecastFor] = useState<ForecastTarget | null>(null)
  const [savingForecast, setSavingForecast] = useState(false)
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

  /** The one modal, for one job. A job with money left and nothing forecast
   *  opens as setup; everything else as edit. */
  function openProject(projectId: string, record = false) {
    const p = byProject.get(projectId)
    const setup = !!p && p.rows.length === 0 && p.remaining >= 1
    setForecastFor({ projectId, purpose: setup ? 'setup' : 'edit', record })
  }

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
      onOpen={() => openProject(r.projectId)}
    />
  )

  const fp: ProjectForecast | null = forecastFor ? byProject.get(forecastFor.projectId) ?? null : null

  return (
    <>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-[20px] font-semibold text-[#111]">Payments</h1>
        <div className="flex items-center gap-1 ml-auto">
          {/* Pick the job → its forecast modal, Record a payment open. */}
          <select
            value=""
            aria-label="Log a payment for a project"
            disabled={ledgerMissing}
            onChange={(e) => {
              if (e.target.value) openProject(e.target.value, true)
            }}
            className="px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857] cursor-pointer disabled:opacity-50"
          >
            <option value="">+ Log a payment…</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id} className="bg-white text-[#111]">
                {p.name}
              </option>
            ))}
          </select>
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
                        onOpen={() => openProject(e.projectId)}
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
          key={`${forecastFor.projectId}:${forecastFor.purpose}`}
          purpose={forecastFor.purpose}
          projectName={fp.projectName}
          contractTotal={fp.contractTotal}
          payments={ledger.filter((e) => e.projectId === fp.projectId)}
          rows={fp.rows.map((r) => ({ id: r.id, label: r.label, amount: r.amount, expectedDate: r.expectedDate }))}
          saving={savingForecast}
          startRecording={!!forecastFor.record}
          onCancel={() => setForecastFor(null)}
          onSave={async (out, via, changes) => {
            setSavingForecast(true)
            try {
              // Ledger first (the money is real), then the forecast as the
              // human left it. Every write here is a person pressing Save.
              const byId = new Map(ledger.map((e) => [e.id, e]))
              for (const id of changes.remove) await api.deletePayment(id)
              for (const u of changes.update) {
                const was = byId.get(u.id)
                await api.updatePayment(u.id, {
                  projectId: fp.projectId,
                  amount: u.amount,
                  paymentDate: u.paymentDate,
                  label: u.label,
                  method: was?.method ?? null,
                  reference: was?.reference ?? null,
                  notes: was?.notes ?? null,
                })
              }
              for (const a of changes.add) {
                await api.logPayment({
                  projectId: fp.projectId,
                  amount: a.amount,
                  paymentDate: a.paymentDate,
                  label: a.label,
                  method: null,
                  reference: null,
                  notes: null,
                })
              }
              await api.saveForecast(fp.projectId, out, via, fp.contractTotal)
              setForecastFor(null)
              await onChanged()
            } catch (e) {
              await onChanged()
              throw e
            } finally {
              setSavingForecast(false)
            }
          }}
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
  onOpen,
}: {
  row: PaymentRow
  busy: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      title="Open this job's payments + forecast — drag to move the month"
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
          </div>
          <div className="text-[10px] text-[#9CA3AF] mt-0.5 flex items-center gap-1">
            <CalendarClock className="w-2.5 h-2.5" />
            {dayLabel(row.expectedDate)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[13px] font-semibold font-mono tabular-nums text-[#111]">{money(row.amount)}</div>
        </div>
      </div>
    </div>
  )
}

/** A green card: one ledger payment, in the month it landed. Click → the
 *  job's modal (edit / remove it there). The project name is a link. */
function PaymentCard({
  entry,
  projectName,
  onOpen,
}: {
  entry: LedgerEntry
  projectName: string
  onOpen: () => void
}) {
  const refund = entry.amount < 0
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      data-payment-card={entry.id}
      title="Open this job's payments + forecast"
      className={`w-full text-left rounded-lg border px-2.5 py-2 cursor-pointer ${
        refund ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[#A7F3D0] bg-[#F0FDF4] hover:border-[#6EE7B7]'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${entry.projectId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[12.5px] font-medium text-[#111] hover:text-[#2563EB] hover:underline truncate block"
          >
            {projectName}
          </Link>
          <div className="text-[11px] text-[#374151] mt-0.5 truncate">{paymentLabel(entry)}</div>
          <div className="text-[10px] text-[#6B7280] mt-0.5 truncate">
            {refund ? 'Refunded' : 'Received'} {dayLabel(entry.paymentDate)}
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
    </div>
  )
}

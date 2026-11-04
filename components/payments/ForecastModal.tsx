'use client'

// ============================================================================
// ForecastModal — the editor AND the Redivide modal (Payments v4, 2026-11-05)
// ============================================================================
// ⛔ THESE ARE THE ONLY TWO SURFACES THAT WRITE A FORECAST ROW (plus dragging
// a card to another month). A human presses Save; nothing else, ever. See
// lib/payment-forecast for the constitution.
//
//   setup     a sold job with nothing forecast: rows from a preset or by hand,
//             spread over what's REMAINING (contract − received). Gate: foots.
//   edit      rename, add, remove, retype rows. No gate — the forecast is a
//             loose forecast; if it stops footing, the board's hint says so.
//   redivide  re-spread what's remaining over the rows: Even split,
//             Proportional, or hand-typed. Gate: foots to remaining exactly.
//
// The divide-block pattern (capacity / engineering): per-row inputs, a live
// sum against the target, one-click resets. The $ / % toggle is the 10-28 one
// — % here means percent of what's REMAINING, not of the contract, because
// (2026-11-04, Andrew's look: everything reads against the CONTRACT —
// the payments already made are listed above the draws, percentages are of
// the contract, and the footer is Paid + Scheduled vs Contract. "$117,663 of
// $106,766 remaining" made no sense to him; "$10,897 over the contract" does.)
//
// ⛔ NO LOCKS, NO FLOORS, NO PINS. Under v4 no forecast row has a payment
// against it, so every row is freely editable and removable.
//
// RECORD A PAYMENT HERE (Andrew, 2026-11-04): "some pay app payments cover
// multiple draws." Type what was received, TICK the draws it paid, Record:
// the payment lands in the ledger and the ticked rows leave the forecast.
// That is a human choosing, row by row — still never the machinery. Money
// beyond the ticked draws is NOT applied: it shows as UNRESOLVED (forecast vs
// remaining) until a human takes it off one draw or splits it evenly. Paying
// LESS than the ticked draws leaves a "short" amount, same two tools.
// ============================================================================

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { evenSplit, paymentLabel, proportionalSplit, splitByWeights, type LedgerEntry } from '@/lib/payment-forecast'
import type { ForecastDraft } from '@/lib/payments'

/** What the Record-a-payment panel hands back. */
export interface RecordedPayment {
  amount: number
  paymentDate: string
  label: string | null
  method: string | null
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type ForecastPurpose = 'setup' | 'edit' | 'redivide'

export interface ForecastModalRow {
  id: string | null
  label: string
  amount: number
}

type InputMode = 'dollars' | 'percent'
const MODE_KEY = 'millsuite:forecast-input-mode'

const PRESETS: Array<{ name: string; rows: Array<{ label: string; pct: number }> }> = [
  { name: '50 / 25 / 25', rows: [{ label: 'Deposit', pct: 50 }, { label: 'Production kickoff', pct: 25 }, { label: 'Final', pct: 25 }] },
  { name: '50 / 50', rows: [{ label: 'Deposit', pct: 50 }, { label: 'Final', pct: 50 }] },
  {
    name: '30 / 40 / 20 / 10',
    rows: [
      { label: 'Deposit', pct: 30 },
      { label: 'Rough-in', pct: 40 },
      { label: 'Install start', pct: 20 },
      { label: 'Final punchout', pct: 10 },
    ],
  },
]

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** Cents-exact, for the gate line ("$49,610.69"). */
function moneyCents(n: number): string {
  const s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })
  return n < 0 ? `-$${s}` : `$${s}`
}

interface Draft {
  key: string
  id: string | null
  label: string
  /** The typed text in the current mode. */
  input: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

export default function ForecastModal({
  purpose: initialPurpose,
  projectName,
  contractTotal,
  received,
  payments = [],
  rows: initialRows,
  saving,
  onCancel,
  onSave,
  onRecordPayment,
}: {
  purpose: ForecastPurpose
  projectName: string
  contractTotal: number
  /** Σ ledger — shown so "remaining" is explained, never used to pair. */
  received: number
  /** The project's recorded payments, listed (read-only) above the draws so
   *  the schedule reads as the whole contract. */
  payments?: LedgerEntry[]
  rows: ForecastModalRow[]
  saving: boolean
  onCancel: () => void
  onSave: (rows: ForecastDraft[], via: 'editor' | 'redivide') => Promise<void>
  /** Record a payment for the ticked draws: ledger row + the forecast WITHOUT
   *  those rows (the rest of the draft as on screen). Absent = no panel. */
  onRecordPayment?: (payment: RecordedPayment, keep: ForecastDraft[]) => Promise<void>
}) {
  const remaining = round2(Math.max(0, contractTotal - received))
  /** Percentages are of the CONTRACT (falls back to remaining with no contract). */
  const pctBase = contractTotal > 0 ? contractTotal : remaining
  const paidPct = pctBase > 0 && contractTotal > 0 ? (received / pctBase) * 100 : 0
  const toPct = (amount: number) => (pctBase > 0 ? round2((amount / pctBase) * 100) : 0)
  const purpose = initialPurpose
  const [mode, setModeState] = useState<InputMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'percent' ? 'percent' : 'dollars'
    } catch {
      return 'dollars'
    }
  })
  let seq = 0
  const [rows, setRows] = useState<Draft[]>(() => {
    const src =
      initialRows.length > 0 || initialPurpose !== 'setup'
        ? initialRows
        : // Setup with nothing yet: seed the first preset, spread over remaining.
          // (Only SETUP — an edit whose last draws were just paid must open empty.)
          (() => {
            const p = PRESETS[0].rows
            const amts = splitByWeights(remaining, p.map((r) => r.pct))
            return p.map((r, i) => ({ id: null, label: r.label, amount: amts[i] }))
          })()
    return src.map((r) => ({
      key: r.id ?? `new-${seq++}`,
      id: r.id,
      label: r.label,
      input: mode === 'percent' && pctBase > 0 ? String(toPct(r.amount)) : String(round2(r.amount)),
    }))
  })
  const [error, setError] = useState<string | null>(null)
  // ── Record-a-payment panel ──
  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(localToday)
  const [payLabel, setPayLabel] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [recording, setRecording] = useState(false)
  const [moveTo, setMoveTo] = useState('')

  /** What each row is worth in dollars, from what's typed. */
  const amounts = useMemo(() => {
    if (mode === 'dollars') return rows.map((r) => round2(Number(r.input) || 0))
    const pcts = rows.map((r) => Number(r.input) || 0)
    const sum = pcts.reduce((a, b) => a + b, 0)
    // Paid % + these % = 100 → the dollars foot to remaining to the cent
    // (largest remainder); otherwise each row is its plain share of the contract.
    if (Math.abs(paidPct + sum - 100) < 0.01) return splitByWeights(remaining, pcts)
    return pcts.map((p) => round2((pctBase * p) / 100))
  }, [rows, mode, remaining, pctBase, paidPct])

  const total = round2(amounts.reduce((a, b) => a + b, 0))
  const off = round2(total - remaining)
  const foots = Math.abs(off) < 0.01
  /** Under a dollar is rounding (Leonard: 69¢), not money to place — the same
   *  threshold as the board's hint (HINT_EPS). The Redivide gate stays exact. */
  const nearlyFoots = Math.abs(off) < 1
  const pctSum = rows.reduce((a, r) => a + (Number(r.input) || 0), 0)

  const paid = round2(Number(payAmount) || 0)
  const coveredIdx = rows.map((r, i) => (checked.has(r.key) ? i : -1)).filter((i) => i >= 0)
  const covered = round2(coveredIdx.reduce((a, i) => a + amounts[i], 0))
  /** + = received beyond the ticked draws (unresolved); − = short of them. */
  const leftover = round2(paid - covered)
  const autoLabel = coveredIdx.map((i) => rows[i].label.trim()).filter(Boolean).join(' + ')
  const canRecord =
    !!onRecordPayment && !recording && paid !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(payDate) && rows.every((r) => r.label.trim())

  async function recordPayment() {
    if (!canRecord || !onRecordPayment) return
    setRecording(true)
    setError(null)
    try {
      await onRecordPayment(
        { amount: paid, paymentDate: payDate, label: (payLabel.trim() || autoLabel) || null, method: null },
        rows.filter((r) => !checked.has(r.key)).map((r) => ({ id: r.id, label: r.label.trim(), amount: amounts[rows.indexOf(r)] })),
      )
      // The board re-mounts this modal with the fresh rows + received.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that payment.')
      setRecording(false)
    }
  }

  /** UNRESOLVED = what the forecast expects beyond what's left (+), or short of it (−).
   *  Placed only by hand: off ONE draw, or split evenly over all of them. */
  const unresolved = round2(total - remaining)
  function settleOnto(i: number) {
    const next = amounts.map((a, j) => (j === i ? Math.max(0, round2(a - unresolved)) : a))
    writeAmounts(next)
  }
  function settleEvenly() {
    if (rows.length === 0) return
    const share = splitByWeights(Math.abs(unresolved), rows.map(() => 1))
    const sign = unresolved > 0 ? -1 : 1
    writeAmounts(amounts.map((a, i) => Math.max(0, round2(a + sign * share[i]))))
  }

  function writeAmounts(next: number[], keepRows = rows) {
    setRows(
      keepRows.map((r, i) => ({
        ...r,
        input:
          mode === 'percent' ? String(toPct(next[i])) : String(round2(next[i])),
      })),
    )
  }

  function setMode(next: InputMode) {
    if (next === mode) return
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      /* private window — just not remembered */
    }
    const cur = amounts
    setRows((prev) =>
      prev.map((r, i) => ({
        ...r,
        input:
          next === 'percent' ? String(toPct(cur[i])) : String(round2(cur[i])),
      })),
    )
    setModeState(next)
  }

  const patch = (i: number, p: Partial<Draft>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i))
  const add = () =>
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        label: `Draw ${prev.length + 1}`,
        input:
          mode === 'percent'
            ? String(Math.max(0, round2(100 - paidPct - pctSum)))
            : String(Math.max(0, round2(-off))),
      },
    ])

  function usePreset(p: (typeof PRESETS)[number]) {
    const amts = splitByWeights(remaining, p.rows.map((r) => r.pct))
    const next = p.rows.map((r, i) => ({ key: `preset-${Date.now()}-${i}`, id: null, label: r.label, input: '' }))
    writeAmounts(amts, next)
  }

  const needsFoot = purpose !== 'edit'
  const canSave =
    !saving &&
    rows.every((r) => r.label.trim()) &&
    amounts.every((a) => a >= 0) &&
    (needsFoot ? foots : true) &&
    (purpose !== 'setup' || rows.length > 0)

  async function handleSave() {
    if (!canSave) return
    setError(null)
    try {
      await onSave(
        rows.map((r, i) => ({ id: r.id, label: r.label.trim(), amount: amounts[i] })),
        purpose === 'redivide' ? 'redivide' : 'editor',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the forecast.')
    }
  }

  const field = 'px-2 py-1 text-[12.5px] border border-[#E5E7EB] rounded focus:outline-none focus:border-[#2563EB]'
  const title = purpose === 'setup' ? 'Set up the forecast' : purpose === 'redivide' ? 'Redivide' : 'Edit forecast'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="fixed inset-0 z-[200] bg-black/45 flex items-start justify-center overflow-y-auto p-4 sm:p-16"
    >
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl w-full max-w-[560px] shadow-xl">
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111]">{title}</div>
            <div className="text-[11.5px] text-[#6B7280] truncate">{projectName}</div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {/* The arithmetic the whole modal works against, stated once. */}
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {[
              ['Contract', contractTotal > 0 ? money(contractTotal) : '—'],
              ['Received', money(received)],
              ['Remaining', money(remaining)],
            ].map(([k, v]) => (
              <div key={k} className="px-2 py-1.5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB]">
                <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-semibold">{k}</div>
                <div className={`text-[13px] font-semibold font-mono tabular-nums ${k === 'Received' ? 'text-[#059669]' : 'text-[#111]'}`}>{v}</div>
              </div>
            ))}
          </div>
          {contractTotal <= 0 && (
            <div className="mb-3 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
              This project has no contract value, so there&apos;s nothing to foot the forecast to. Type
              dollars, or set the project&apos;s price first.
            </div>
          )}

          {onRecordPayment && purpose !== 'setup' && rows.length > 0 && (
            <div className={`mb-3 rounded-lg border ${payOpen ? 'border-[#A7F3D0] bg-[#F0FDF4]' : 'border-[#E5E7EB]'} px-3 py-2`}>
              {!payOpen ? (
                <button onClick={() => setPayOpen(true)} className="text-[12px] font-medium text-[#047857] hover:underline">
                  + Record a payment
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#047857]">Received</span>
                    <span className="text-[11px] text-[#9CA3AF]">$</span>
                    <input
                      autoFocus
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9.-]/g, ''))}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label="Amount received"
                      className={`${field} w-28 text-right font-mono bg-white`}
                    />
                    <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} aria-label="Date received" className={`${field} bg-white`} />
                    <button onClick={() => { setPayOpen(false); setChecked(new Set()) }} className="ml-auto text-[11px] text-[#6B7280] hover:underline">
                      Close
                    </button>
                  </div>
                  <input
                    value={payLabel}
                    onChange={(e) => setPayLabel(e.target.value)}
                    placeholder={autoLabel || 'Label — tick the draws it paid below'}
                    aria-label="Payment label"
                    className={`${field} w-full bg-white`}
                  />
                  <div className="text-[11.5px] text-[#374151] leading-snug">
                    {coveredIdx.length === 0 ? (
                      <>Tick the draws this payment covers. Nothing ticked = it&apos;s all unresolved.</>
                    ) : (
                      <>
                        Covers {coveredIdx.length} draw{coveredIdx.length > 1 ? 's' : ''} · <span className="font-mono">{moneyCents(covered)}</span>
                      </>
                    )}
                    {paid !== 0 && Math.abs(leftover) >= 0.01 && (
                      <span className={leftover > 0 ? 'text-[#B45309]' : 'text-[#B91C1C]'}>
                        {' '}· <span className="font-mono">{moneyCents(Math.abs(leftover))}</span>{' '}
                        {leftover > 0 ? 'left over — stays unresolved, not applied' : 'short of the ticked draws — stays unresolved'}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => void recordPayment()}
                    disabled={!canRecord}
                    className="px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857] disabled:opacity-50"
                  >
                    {recording ? 'Recording…' : coveredIdx.length ? `Record payment · remove ${coveredIdx.length} paid draw${coveredIdx.length > 1 ? 's' : ''}` : 'Record payment'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <div className="inline-flex rounded border border-[#E5E7EB] overflow-hidden mr-1" role="group" aria-label="Enter amounts as">
              {(['dollars', 'percent'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={m === 'percent' && pctBase <= 0}
                  className={`px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${
                    mode === m ? 'bg-[#2563EB] text-white' : 'bg-white text-[#374151] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {m === 'dollars' ? '$' : '%'}
                </button>
              ))}
            </div>
            {/* The divide-block resets. Human-triggered, always. */}
            <button
              onClick={() => writeAmounts(evenSplit(remaining, rows.length))}
              disabled={rows.length === 0}
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB] disabled:opacity-40"
            >
              Even split
            </button>
            <button
              onClick={() => writeAmounts(proportionalSplit(remaining, amounts))}
              disabled={rows.length === 0}
              title="Keep each row's share, scaled to what's remaining"
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB] disabled:opacity-40"
            >
              Proportional
            </button>
            {purpose === 'setup' && (
              <>
                <span className="text-[11px] text-[#9CA3AF] ml-1">Start from</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => usePreset(p)}
                    className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
                  >
                    {p.name}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* WHAT'S BEEN PAID — the ledger, read-only, so the list is the whole
              contract: these + the draws below = the contract. */}
          {payments.length > 0 && (
            <div className="mb-1.5 space-y-1">
              {[...payments]
                .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
                .map((e) => (
                  <div key={e.id} data-paid-row className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#A7F3D0] bg-[#F0FDF4]">
                    <span className="text-[#059669] text-[12px] w-4 text-center flex-shrink-0">✓</span>
                    <span className="text-[12.5px] text-[#065F46] truncate flex-1 min-w-0">{paymentLabel(e)}</span>
                    <span className="text-[11px] text-[#047857] flex-shrink-0">
                      Paid {(() => {
                        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.paymentDate)
                        return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : e.paymentDate
                      })()}
                    </span>
                    <span className="text-[12.5px] font-mono tabular-nums text-[#065F46] w-28 text-right flex-shrink-0">{moneyCents(e.amount)}</span>
                    <span className="text-[12px] font-mono tabular-nums w-20 text-right text-[#047857] flex-shrink-0">
                      {pctBase > 0 ? `${((e.amount / pctBase) * 100).toFixed(1)}%` : ''}
                    </span>
                    <span className="w-3.5 flex-shrink-0" />
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-1.5">
            {rows.length === 0 && (
              <div className="text-[11.5px] text-[#9CA3AF] italic py-2">
                No rows — nothing is forecast for this job.
              </div>
            )}
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-1.5">
                {payOpen && (
                  <input
                    type="checkbox"
                    checked={checked.has(r.key)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(r.key)
                        else next.delete(r.key)
                        return next
                      })
                    }
                    aria-label={`Payment covers ${r.label}`}
                    className="w-4 h-4 accent-[#059669] flex-shrink-0"
                  />
                )}
                <input
                  value={r.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="What this payment is"
                  aria-label="Label"
                  className={`${field} flex-1 min-w-0`}
                />
                {mode === 'dollars' && <span className="text-[11px] text-[#9CA3AF]">$</span>}
                <input
                  value={r.input}
                  onChange={(e) => patch(i, { input: e.target.value.replace(/[^0-9.]/g, '') })}
                  inputMode="decimal"
                  aria-label={mode === 'dollars' ? 'Amount' : 'Percent of contract'}
                  className={`${field} ${mode === 'dollars' ? 'w-28' : 'w-16'} text-right font-mono`}
                />
                <span className="text-[12px] font-mono tabular-nums w-20 text-right text-[#6B7280]">
                  {mode === 'dollars'
                    ? pctBase > 0
                      ? `${((amounts[i] / pctBase) * 100).toFixed(1)}%`
                      : ''
                    : money(amounts[i])}
                </span>
                <button
                  onClick={() => remove(i)}
                  title="Remove this row from the forecast"
                  aria-label="Remove"
                  className="text-[#D1D5DB] hover:text-[#DC2626]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <button onClick={add} className="text-[11.5px] text-[#2563EB] hover:text-[#1D4ED8] font-medium">
              + Add a row
            </button>
            {/* ⛔ THE SUM GATE, in CONTRACT terms: paid + scheduled vs contract
                (the same test as scheduled vs remaining, said the way the
                shop reads it). */}
            <div
              className={`text-[12px] font-mono tabular-nums text-right ${
                foots || (!needsFoot && nearlyFoots) ? 'text-[#059669]' : needsFoot ? 'text-[#B91C1C]' : 'text-[#B45309]'
              }`}
            >
              {contractTotal > 0 ? (
                <>
                  Paid {money(received)} + scheduled {money(total)} = {money(received + total)} (
                  {(((received + total) / contractTotal) * 100).toFixed(1)}%)
                  <span className="text-[#9CA3AF]"> · contract {money(contractTotal)}</span>
                </>
              ) : (
                <>Scheduled {money(total)}</>
              )}
            </div>
          </div>
          {/* UNRESOLVED — placed by hand only. */}
          {!nearlyFoots && contractTotal > 0 && rows.length > 0 && (
            <div className="mt-2 px-2.5 py-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] text-[11.5px] text-[#92400E] flex items-center gap-2 flex-wrap">
              <span className="w-full">
                <span className="font-mono font-semibold">{money(Math.abs(unresolved))} unresolved</span> — paid + scheduled comes to{' '}
                {money(Math.abs(unresolved))} {unresolved > 0 ? 'MORE than' : 'LESS than'} the contract. It stays here until you{' '}
                {unresolved > 0 ? 'take it off a draw' : 'add it to a draw'} or split it evenly.
              </span>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Draw to settle onto" className={`${field} bg-white text-[11.5px]`}>
                <option value="">{unresolved > 0 ? 'Take it off…' : 'Add it to…'}</option>
                {rows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label || 'Untitled'}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const i = rows.findIndex((r) => r.key === moveTo)
                  if (i >= 0) settleOnto(i)
                  setMoveTo('')
                }}
                disabled={!moveTo}
                className="px-2 py-1 rounded border border-[#FDE68A] bg-white hover:border-[#D97706] disabled:opacity-40"
              >
                Apply
              </button>
              <button onClick={settleEvenly} className="px-2 py-1 rounded border border-[#FDE68A] bg-white hover:border-[#D97706]">
                Split evenly
              </button>
            </div>
          )}
          {error && (
            <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : purpose === 'redivide' ? 'Save redivide' : purpose === 'setup' ? 'Create forecast' : 'Save forecast'}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            <span className="text-[11px] text-[#9CA3AF] ml-auto text-right">
              {rows.some((r) => !r.id)
                ? 'New rows land in “No date set” — drag them into a month.'
                : 'Dates stay put — drag cards to move them.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

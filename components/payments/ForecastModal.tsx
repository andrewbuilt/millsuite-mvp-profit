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
//
// THE ONE MODAL (Andrew, 2026-11-04): every card on /payments opens this —
// there is no separate payment modal. So the payments already made are
// EDITABLE here (label, date, amount — "we recorded the wrong amount"), and
// removing one puts it back as a draw of the same label and amount, so
// paid + scheduled is unchanged by the undo (the Deposit came back missing
// when a payment was deleted before). Everything is STAGED: recording,
// editing and removing payments and draws all wait for Save, which writes the
// ledger changes and then the forecast, together.
// ============================================================================

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { evenSplit, proportionalSplit, splitByWeights, type LedgerEntry } from '@/lib/payment-forecast'
import type { ForecastDraft } from '@/lib/payments'

/** A payment recorded in the modal (staged until Save). */
export interface RecordedPayment {
  amount: number
  paymentDate: string
  label: string | null
}

/** What Save hands back for the LEDGER, alongside the forecast rows. */
export interface LedgerChanges {
  add: RecordedPayment[]
  update: Array<{ id: string; amount: number; paymentDate: string; label: string | null }>
  remove: string[]
}

interface PaidDraft {
  key: string
  /** null = recorded in this modal, not saved yet. */
  id: string | null
  label: string
  /** Typed dollars. */
  amount: string
  date: string
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** ⚠️ A date more than a month ahead is almost always a typo (Leonard's
 *  deposit was keyed as 2027-06-30). Said, not blocked. */
function farFuture(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const limit = new Date()
  limit.setDate(limit.getDate() + 31)
  return new Date(+m[1], +m[2] - 1, +m[3]) > limit
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
  /** The stored expected date (YYYY-MM-DD), null = "No date set". */
  expectedDate?: string | null
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
  /** The month dropdown: 'YYYY-MM', or '' = No date set. */
  month: string
  /** The stored date the row opened with — kept as-is unless the month changes. */
  date: string | null
}

/** 'YYYY-MM' of a stored date, '' for none. */
const monthOfDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '')

/** The date to save for a row: unchanged month → the stored date untouched
 *  (undefined); No date → null; a new month → the same day of the month as
 *  before (clamped, like a drag), or the 1st. */
function dateForSave(r: Draft): string | null | undefined {
  if (r.month === monthOfDate(r.date)) return r.id ? undefined : r.month ? `${r.month}-01` : null
  if (!r.month) return null
  const [y, m] = r.month.split('-').map(Number)
  const day = r.date ? Number(r.date.slice(8, 10)) || 1 : 1
  const last = new Date(y, m, 0).getDate()
  return `${r.month}-${String(Math.min(day, last)).padStart(2, '0')}`
}

/** The dropdown's months: 3 back through 18 ahead of today, plus any month a
 *  row already sits in outside that window. */
function monthChoices(extra: string[]): Array<{ value: string; label: string }> {
  const now = new Date()
  const set = new Set<string>()
  for (let i = -3; i <= 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  for (const m of extra) if (m) set.add(m)
  return [...set].sort().map((value) => {
    const [y, mo] = value.split('-').map(Number)
    return { value, label: new Date(y, mo - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' }) }
  })
}

const round2 = (n: number) => Math.round(n * 100) / 100

export default function ForecastModal({
  purpose: initialPurpose,
  projectName,
  contractTotal,
  payments = [],
  rows: initialRows,
  saving,
  startRecording = false,
  onCancel,
  onSave,
}: {
  purpose: ForecastPurpose
  projectName: string
  contractTotal: number
  /** The project's recorded payments, listed (editable) above the draws so
   *  the schedule reads as the whole contract. Σ = received. */
  payments?: LedgerEntry[]
  rows: ForecastModalRow[]
  saving: boolean
  /** Open with the Record-a-payment panel already open. */
  startRecording?: boolean
  onCancel: () => void
  /** Writes the ledger changes, then the forecast rows. */
  onSave: (rows: ForecastDraft[], via: 'editor' | 'redivide', ledger: LedgerChanges) => Promise<void>
}) {
  const [paidRows, setPaidRows] = useState<PaidDraft[]>(() =>
    [...payments]
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
      .map((e) => ({ key: e.id, id: e.id, label: (e.label || '').trim() || (e.notes || '').trim(), amount: String(round2(e.amount)), date: e.paymentDate })),
  )
  const [removedIds, setRemovedIds] = useState<string[]>([])
  /** Anything staged — the backdrop then won't throw it away. */
  const [touched, setTouched] = useState(false)
  const paidAmounts = paidRows.map((p) => round2(Number(p.amount) || 0))
  /** Σ the payments as they stand in the modal (edits included). */
  const received = round2(paidAmounts.reduce((a, b) => a + b, 0))
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
      initialRows.length > 0 || initialPurpose !== 'setup' || remaining <= 0
        ? initialRows
        : // Setup with nothing yet: seed the first preset, spread over remaining.
          // (Only SETUP — an edit whose last draws were just paid must open empty.)
          (() => {
            const p = PRESETS[0].rows
            const amts = splitByWeights(remaining, p.map((r) => r.pct))
            return p.map((r, i) => ({ id: null, label: r.label, amount: amts[i], expectedDate: null as string | null }))
          })()
    return src.map((r) => ({
      key: r.id ?? `new-${seq++}`,
      id: r.id,
      label: r.label,
      input: mode === 'percent' && pctBase > 0 ? String(toPct(r.amount)) : String(round2(r.amount)),
      month: monthOfDate(r.expectedDate),
      date: r.expectedDate ?? null,
    }))
  })
  const [error, setError] = useState<string | null>(null)
  // ── Record-a-payment panel ──
  const [payOpen, setPayOpen] = useState(startRecording)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(localToday)
  const [payLabel, setPayLabel] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
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
  const canRecord = paid !== 0 && isDate(payDate)

  /** STAGED: the payment joins the paid list, the ticked draws leave the
   *  forecast. Nothing is written until Save. */
  function recordPayment() {
    if (!canRecord) return
    // Amounts of the draws that stay, frozen in dollars before the paid side
    // moves (percent mode would otherwise re-read them against a new base).
    const keep = rows.map((r, i) => ({ r, a: amounts[i] })).filter(({ r }) => !checked.has(r.key))
    setPaidRows((prev) => [
      ...prev,
      { key: `paid-${Date.now()}`, id: null, label: payLabel.trim() || autoLabel, amount: String(paid), date: payDate },
    ])
    writeAmounts(keep.map((k) => k.a), keep.map((k) => k.r))
    setChecked(new Set())
    setPayAmount('')
    setPayLabel('')
    setPayOpen(false)
    setTouched(true)
  }

  const patchPaid = (key: string, p: Partial<PaidDraft>) => {
    setPaidRows((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)))
    setTouched(true)
  }
  /** Remove a payment: it goes BACK to the draws at the same label + amount,
   *  so paid + scheduled doesn't move. × the draw too if it shouldn't exist. */
  function unpay(key: string) {
    const p = paidRows.find((x) => x.key === key)
    if (!p) return
    const amt = round2(Number(p.amount) || 0)
    setPaidRows((prev) => prev.filter((x) => x.key !== key))
    if (p.id) setRemovedIds((prev) => [...prev, p.id!])
    if (amt > 0) {
      // To the TOP: what was paid came before what's still scheduled.
      setRows((prev) => [
        {
          key: `unpaid-${Date.now()}`,
          id: null,
          label: p.label.trim() || 'Payment',
          input: mode === 'percent' ? String(toPct(amt)) : String(amt),
          // Back in the month it was paid.
          month: monthOfDate(p.date),
          date: null,
        },
        ...prev,
      ])
    }
    setTouched(true)
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
    setTouched(true)
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

  const patch = (i: number, p: Partial<Draft>) => {
    setTouched(true)
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  }
  const remove = (i: number) => {
    setTouched(true)
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  const add = () => {
    setTouched(true)
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        id: null,
        label: `Draw ${prev.length + 1}`,
        month: '',
        date: null,
        input:
          mode === 'percent'
            ? String(Math.max(0, round2(100 - paidPct - pctSum)))
            : String(Math.max(0, round2(-off))),
      },
    ])
  }

  function usePreset(p: (typeof PRESETS)[number]) {
    const amts = splitByWeights(remaining, p.rows.map((r) => r.pct))
    const next = p.rows.map((r, i) => ({ key: `preset-${Date.now()}-${i}`, id: null, label: r.label, input: '', month: '', date: null }))
    writeAmounts(amts, next)
  }

  const months = useMemo(() => monthChoices(rows.map((r) => r.month)), [rows])

  const needsFoot = purpose !== 'edit'
  const paidOk = paidRows.every((p, i) => paidAmounts[i] !== 0 && Number.isFinite(Number(p.amount)) && isDate(p.date))
  const canSave =
    !saving &&
    rows.every((r) => r.label.trim()) &&
    amounts.every((a) => a >= 0) &&
    paidOk &&
    (needsFoot ? foots : true) &&
    (purpose !== 'setup' || rows.length > 0)

  async function handleSave() {
    if (!canSave) return
    setError(null)
    const before = new Map(payments.map((e) => [e.id, e]))
    const ledger: LedgerChanges = { add: [], update: [], remove: removedIds }
    paidRows.forEach((p, i) => {
      const label = p.label.trim() || null
      if (!p.id) {
        ledger.add.push({ amount: paidAmounts[i], paymentDate: p.date, label })
        return
      }
      const was = before.get(p.id)
      if (was && (round2(was.amount) !== paidAmounts[i] || was.paymentDate !== p.date || ((was.label || '').trim() || (was.notes || '').trim() || null) !== label)) {
        ledger.update.push({ id: p.id, amount: paidAmounts[i], paymentDate: p.date, label })
      }
    })
    try {
      await onSave(
        rows.map((r, i) => ({ id: r.id, label: r.label.trim(), amount: amounts[i], expectedDate: dateForSave(r) })),
        purpose === 'redivide' ? 'redivide' : 'editor',
        ledger,
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
      onClick={() => {
        // Staged changes aren't thrown away by a stray click — Cancel / × do that.
        if (!touched) onCancel()
      }}
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

          {purpose !== 'redivide' && (
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
                    {rows.length === 0 ? (
                      <>No draws to tick — the payment is recorded against the contract.</>
                    ) : coveredIdx.length === 0 ? (
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
                  {farFuture(payDate) && <div className="text-[11px] text-[#B45309]">That date is more than a month from now — typo?</div>}
                  <button
                    onClick={recordPayment}
                    disabled={!canRecord}
                    className="px-3 py-1.5 rounded-md bg-[#059669] text-white text-[12px] font-medium hover:bg-[#047857] disabled:opacity-50"
                  >
                    {coveredIdx.length ? `Record payment · remove ${coveredIdx.length} paid draw${coveredIdx.length > 1 ? 's' : ''}` : 'Record payment'}
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

          {/* WHAT'S BEEN PAID — the ledger, EDITABLE, so the list is the whole
              contract: these + the draws below = the contract. × puts a
              payment back as a draw (same label + amount). */}
          {paidRows.length > 0 && (
            <div className="mb-1.5 space-y-1">
              {paidRows.map((p, i) => (
                <div
                  key={p.key}
                  data-paid-row={p.id ?? 'new'}
                  className="flex items-center gap-1.5 px-1.5 py-1 -mx-1.5 rounded border border-[#A7F3D0] bg-[#F0FDF4]"
                >
                  <span className="text-[#059669] text-[12px] w-4 text-center flex-shrink-0" title="Paid">✓</span>
                  <input
                    value={p.label}
                    onChange={(e) => patchPaid(p.key, { label: e.target.value })}
                    placeholder="Payment"
                    aria-label="Payment label"
                    className={`${field} flex-1 min-w-0 bg-white text-[#065F46]`}
                  />
                  <input
                    type="date"
                    value={p.date}
                    onChange={(e) => patchPaid(p.key, { date: e.target.value })}
                    aria-label="Date paid"
                    title={farFuture(p.date) ? 'More than a month from now — typo?' : 'Date paid'}
                    className={`${field} w-[124px] bg-white text-[11.5px] ${farFuture(p.date) ? 'border-[#F59E0B]' : ''}`}
                  />
                  <span className="text-[11px] text-[#9CA3AF]">$</span>
                  <input
                    value={p.amount}
                    onChange={(e) => patchPaid(p.key, { amount: e.target.value.replace(/[^0-9.-]/g, '') })}
                    inputMode="decimal"
                    aria-label="Amount paid"
                    className={`${field} w-24 text-right font-mono bg-white text-[#065F46]`}
                  />
                  <span className="text-[12px] font-mono tabular-nums w-14 text-right text-[#047857] flex-shrink-0">
                    {pctBase > 0 ? `${((paidAmounts[i] / pctBase) * 100).toFixed(1)}%` : ''}
                  </span>
                  <button
                    onClick={() => unpay(p.key)}
                    title="Remove this payment — it goes back to the draws"
                    aria-label="Remove payment"
                    className="text-[#9CA3AF] hover:text-[#DC2626] flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
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
                {!payOpen && paidRows.length > 0 && <span className="w-4 flex-shrink-0" />}
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
                <select
                  value={r.month}
                  onChange={(e) => patch(i, { month: e.target.value })}
                  aria-label={`Month expected for ${r.label || 'this row'}`}
                  title="The month this payment is expected"
                  className={`${field} w-[104px] flex-shrink-0 bg-white text-[11.5px] ${r.month ? 'text-[#111]' : 'text-[#9CA3AF]'}`}
                >
                  <option value="">No date</option>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {mode === 'dollars' && <span className="text-[11px] text-[#9CA3AF]">$</span>}
                <input
                  value={r.input}
                  onChange={(e) => patch(i, { input: e.target.value.replace(/[^0-9.]/g, '') })}
                  inputMode="decimal"
                  aria-label={mode === 'dollars' ? 'Amount' : 'Percent of contract'}
                  className={`${field} ${mode === 'dollars' ? 'w-24' : 'w-16'} text-right font-mono`}
                />
                <span className={`text-[12px] font-mono tabular-nums ${mode === 'dollars' ? 'w-14' : 'w-20'} text-right text-[#6B7280] flex-shrink-0`}>
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
              {saving ? 'Saving…' : purpose === 'redivide' ? 'Save redivide' : purpose === 'setup' ? 'Create forecast' : 'Save'}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            <span className="text-[11px] text-[#9CA3AF] ml-auto text-right">
              {touched && (paidRows.some((p) => !p.id) || removedIds.length > 0)
                ? 'Payments are written when you press Save.'
                : rows.some((r) => !r.month)
                ? 'Rows with no month land in “No date set”.'
                : 'Pick each row’s month here, or drag cards on the board.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

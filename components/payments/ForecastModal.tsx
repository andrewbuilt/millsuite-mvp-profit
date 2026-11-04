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
// that is the number the forecast has to foot to.
//
// ⛔ NO LOCKS, NO FLOORS, NO PINS. Under v4 no forecast row has a payment
// against it, so every row is freely editable and removable.
// ============================================================================

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { evenSplit, proportionalSplit, splitByWeights } from '@/lib/payment-forecast'
import type { ForecastDraft } from '@/lib/payments'

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
  rows: initialRows,
  saving,
  onCancel,
  onSave,
}: {
  purpose: ForecastPurpose
  projectName: string
  contractTotal: number
  /** Σ ledger — shown so "remaining" is explained, never used to pair. */
  received: number
  rows: ForecastModalRow[]
  saving: boolean
  onCancel: () => void
  onSave: (rows: ForecastDraft[], via: 'editor' | 'redivide') => Promise<void>
}) {
  const remaining = round2(Math.max(0, contractTotal - received))
  const [purpose, setPurpose] = useState<ForecastPurpose>(initialPurpose)
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
      initialRows.length > 0
        ? initialRows
        : // Setup with nothing yet: seed the first preset, spread over remaining.
          (() => {
            const p = PRESETS[0].rows
            const amts = splitByWeights(remaining, p.map((r) => r.pct))
            return p.map((r, i) => ({ id: null, label: r.label, amount: amts[i] }))
          })()
    return src.map((r) => ({
      key: r.id ?? `new-${seq++}`,
      id: r.id,
      label: r.label,
      input:
        mode === 'percent' && remaining > 0
          ? String(round2((r.amount / remaining) * 100))
          : String(round2(r.amount)),
    }))
  })
  const [error, setError] = useState<string | null>(null)

  /** What each row is worth in dollars, from what's typed. */
  const amounts = useMemo(() => {
    if (mode === 'dollars') return rows.map((r) => round2(Number(r.input) || 0))
    const pcts = rows.map((r) => Number(r.input) || 0)
    const sum = pcts.reduce((a, b) => a + b, 0)
    // At exactly 100% the dollars foot to remaining to the cent (largest
    // remainder); otherwise each row is its plain share.
    if (Math.abs(sum - 100) < 0.01) return splitByWeights(remaining, pcts)
    return pcts.map((p) => round2((remaining * p) / 100))
  }, [rows, mode, remaining])

  const total = round2(amounts.reduce((a, b) => a + b, 0))
  const off = round2(total - remaining)
  const foots = Math.abs(off) < 0.01
  const pctSum = rows.reduce((a, r) => a + (Number(r.input) || 0), 0)

  function writeAmounts(next: number[], keepRows = rows) {
    setRows(
      keepRows.map((r, i) => ({
        ...r,
        input:
          mode === 'percent'
            ? String(remaining > 0 ? round2((next[i] / remaining) * 100) : 0)
            : String(round2(next[i])),
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
          next === 'percent'
            ? String(remaining > 0 ? round2((cur[i] / remaining) * 100) : 0)
            : String(round2(cur[i])),
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
            ? String(Math.max(0, round2(100 - pctSum)))
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

          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            <div className="inline-flex rounded border border-[#E5E7EB] overflow-hidden mr-1" role="group" aria-label="Enter amounts as">
              {(['dollars', 'percent'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={m === 'percent' && remaining <= 0}
                  className={`px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${
                    mode === m ? 'bg-[#2563EB] text-white' : 'bg-white text-[#374151] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {m === 'dollars' ? '$' : '% of remaining'}
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

          <div className="space-y-1.5">
            {rows.length === 0 && (
              <div className="text-[11.5px] text-[#9CA3AF] italic py-2">
                No rows — nothing is forecast for this job.
              </div>
            )}
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-center gap-1.5">
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
                  aria-label={mode === 'dollars' ? 'Amount' : 'Percent of remaining'}
                  className={`${field} ${mode === 'dollars' ? 'w-28' : 'w-16'} text-right font-mono`}
                />
                <span className="text-[12px] font-mono tabular-nums w-20 text-right text-[#6B7280]">
                  {mode === 'dollars'
                    ? remaining > 0
                      ? `${((amounts[i] / remaining) * 100).toFixed(1)}%`
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
            {/* ⛔ THE SUM GATE, against REMAINING. */}
            <div
              className={`text-[12px] font-mono tabular-nums ${
                foots ? 'text-[#059669]' : needsFoot ? 'text-[#B91C1C]' : 'text-[#B45309]'
              }`}
            >
              {moneyCents(total)} of {moneyCents(remaining)} remaining
              {!foots && (
                <span className="ml-1">
                  · {moneyCents(Math.abs(off))} {off > 0 ? 'over' : 'short'}
                </span>
              )}
            </div>
          </div>
          {!foots && purpose === 'edit' && (
            <div className="mt-2 text-[11px] text-[#6B7280] leading-snug">
              Saving a forecast that doesn&apos;t foot is fine — the board keeps a Redivide hint on this job
              until it does.{' '}
              <button onClick={() => setPurpose('redivide')} className="text-[#2563EB] hover:underline">
                Redivide now
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

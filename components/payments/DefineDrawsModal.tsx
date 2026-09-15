'use client'

// ============================================================================
// DefineDrawsModal — set up a project's draw schedule, from the board.
// ============================================================================
// Andrew: "I cant add draws." The project-page route to this (tray → project →
// Compose → preset → Save) dead-ended on imported jobs, so a sold project with
// no schedule had no reachable way to get one. This is the escape hatch: it
// lives ON the payments board, takes percentages, and writes the rows itself.
//
// ⛔ PERCENT IN, DOLLARS DERIVED, AND THEY SUM TO THE CONTRACT EXACTLY.
// `allocateRounded` (largest remainder) — not `Math.round` per row, which is
// what made every generated schedule a dollar off and had the shop recording
// $2 correcting payments to make the ledger foot.
//
// ⛔ SAVE IS GATED ON EXACTLY 100%. A schedule that doesn't total the contract
// is money that silently never gets billed.
// ============================================================================

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { allocateRounded } from '@/lib/allocate'

export interface DrawDraft {
  label: string
  pct: string
  note: string
}

const PRESETS: Array<{ name: string; rows: Array<{ label: string; pct: number }> }> = [
  {
    name: '50 / 25 / 25',
    rows: [
      { label: 'Deposit', pct: 50 },
      { label: 'Production kickoff', pct: 25 },
      { label: 'Final', pct: 25 },
    ],
  },
  {
    name: '50 / 50',
    rows: [
      { label: 'Deposit', pct: 50 },
      { label: 'Final', pct: 50 },
    ],
  },
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

const blank = (label: string, pct: number): DrawDraft => ({
  label,
  pct: String(pct),
  note: '',
})

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function DefineDrawsModal({
  projectName,
  contractTotal,
  saving,
  onCancel,
  onSave,
}: {
  projectName: string
  contractTotal: number
  saving: boolean
  onCancel: () => void
  onSave: (rows: Array<{ label: string; pct: number; amount: number; note: string }>) => Promise<void>
}) {
  const [rows, setRows] = useState<DrawDraft[]>(() => [
    blank('Deposit', 50),
    blank('Production kickoff', 25),
    blank('Final', 25),
  ])
  const [error, setError] = useState<string | null>(null)

  const pcts = rows.map((r) => Number(r.pct) || 0)
  const sum = pcts.reduce((a, b) => a + b, 0)
  const balanced = Math.abs(sum - 100) < 0.01

  // Dollars are always derived from the percentages against the CONTRACT —
  // never typed, never stored separately from the percent that produced them.
  const amounts = useMemo(() => {
    if (contractTotal <= 0) return pcts.map(() => 0)
    return allocateRounded(
      pcts.map((p) => (contractTotal * p) / 100),
      contractTotal,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, contractTotal])

  function patch(i: number, p: Partial<DrawDraft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  }
  function addRow() {
    // Seed with whatever is left so the sum walks toward 100 rather than away.
    const slack = Math.max(0, 100 - sum)
    setRows((prev) => [...prev, blank(`Draw ${prev.length + 1}`, slack)])
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  function usePreset(p: (typeof PRESETS)[number]) {
    setRows(p.rows.map((r) => blank(r.label, r.pct)))
  }

  const canSave =
    balanced && contractTotal > 0 && rows.length > 0 && rows.every((r) => r.label.trim()) && !saving

  async function handleSave() {
    if (!canSave) return
    setError(null)
    try {
      await onSave(
        rows.map((r, i) => ({
          label: r.label.trim(),
          pct: Number(r.pct) || 0,
          amount: amounts[i],
          note: r.note.trim(),
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the schedule.')
    }
  }

  const field =
    'px-2 py-1 text-[12.5px] border border-[#E5E7EB] rounded focus:outline-none focus:border-[#2563EB]'

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-[200] bg-black/45 flex items-start justify-center overflow-y-auto p-4 sm:p-16"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-[560px] shadow-xl"
      >
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111]">Set up draws</div>
            <div className="text-[11.5px] text-[#6B7280] truncate">
              {projectName} · {money(contractTotal)}
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {contractTotal <= 0 ? (
            // ⛔ NO CONTRACT, NO SCHEDULE. Percentages of zero are zero, and a
            // set of $0 draws is invisible on the board — which is exactly the
            // silent dead-end this modal exists to replace.
            <div className="text-[12.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
              This project has no contract value yet, so draws can&rsquo;t be worked
              out from percentages. Set its price first.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[11px] text-[#9CA3AF]">Start from</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => usePreset(p)}
                    className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={r.label}
                      onChange={(e) => patch(i, { label: e.target.value })}
                      placeholder="What this draw is"
                      className={`${field} flex-1 min-w-0`}
                    />
                    <input
                      value={r.pct}
                      onChange={(e) => patch(i, { pct: e.target.value.replace(/[^0-9.]/g, '') })}
                      className={`${field} w-14 text-right font-mono`}
                    />
                    <span className="text-[11px] text-[#9CA3AF] w-3">%</span>
                    <span className="text-[12px] font-mono tabular-nums text-[#374151] w-20 text-right">
                      {money(amounts[i] ?? 0)}
                    </span>
                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      className="text-[#D1D5DB] hover:text-[#DC2626] disabled:opacity-30"
                      aria-label="Remove"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={addRow}
                  className="text-[11.5px] text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                >
                  + Add a draw
                </button>
                {/* ⛔ THE GATE, STATED IN BOTH UNITS. A schedule that doesn't
                    total 100% is money that never gets billed. */}
                <div
                  className={`text-[12px] font-mono tabular-nums ${
                    balanced ? 'text-[#059669]' : 'text-[#B91C1C]'
                  }`}
                >
                  {sum.toFixed(sum % 1 === 0 ? 0 : 2)}% ·{' '}
                  {money(amounts.reduce((a, b) => a + b, 0))}
                  {!balanced && <span className="ml-1">— must be 100%</span>}
                </div>
              </div>
            </>
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
              {saving ? 'Creating…' : 'Create draws'}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            <span className="text-[11px] text-[#9CA3AF] ml-auto">
              Dates default a month apart — drag them after.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

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
//
// ⛔ PERCENT | DOLLARS (2026-10-28, migration 123). The toggle flips which
// column is the INPUT. Retainage is the real case — "$17,256 retainage", not
// "10%". A row typed in DOLLARS is PINNED: its amount is exact and the
// settle-and-spread (lib/payment-ledger) never re-derives it. In dollars mode
// the gate is "foots to the contract to the dollar"; in percent mode a pinned
// row keeps its dollars and the % rows split what's left.
// ============================================================================

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { allocateRounded } from '@/lib/allocate'

export interface DrawDraft {
  /** Existing row id when editing; null for a row being added. */
  id: string | null
  label: string
  pct: string
  note: string
  /**
   * ⛔ THIS DRAW IS FULLY PAID — it cannot be re-authored. Shown, never
   * editable, never removable. Re-pricing a settled draw would un-say
   * something that happened, and deleting it would orphan the payment.
   * (2026-10-26: PARTLY-paid draws are no longer locked — see `floor`.)
   */
  locked: boolean
  /** Locked rows display their real dollars rather than a derived share. */
  lockedAmount: number
  /** Cash already credited to this draw. A PARTLY-paid draw stays editable,
   *  but its amount can't go below this, and it can't be removed. */
  floor?: number
  /** What the schedule shows right now. Until anything is edited the modal
   *  shows THESE, so it can't disagree with the board by a rounding dollar
   *  (re-deriving dollars from 2-decimal percentages did: $11,906 vs $11,904). */
  shownAmount?: number
  /** 123 — typed in DOLLARS: `dollars` is exact and the spread skips it. */
  pinned?: boolean
  /** The dollars input (dollars mode, and a pinned row's amount). */
  dollars?: string
}

type InputMode = 'percent' | 'dollars'
const MODE_KEY = 'millsuite:draws-input-mode'

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
  id: null,
  label,
  pct: String(pct),
  note: '',
  locked: false,
  lockedAmount: 0,
  floor: 0,
})

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function DefineDrawsModal({
  projectName,
  contractTotal,
  saving,
  existing,
  onCancel,
  onSave,
}: {
  projectName: string
  contractTotal: number
  saving: boolean
  /** Present = EDIT an existing schedule. Absent = first-time setup. */
  existing?: DrawDraft[]
  onCancel: () => void
  onSave: (
    rows: Array<{ id: string | null; label: string; pct: number; amount: number; note: string; pinned: boolean }>,
  ) => Promise<void>
}) {
  const isEdit = !!existing && existing.length > 0
  const [rows, setRows] = useState<DrawDraft[]>(
    () =>
      existing && existing.length > 0
        ? existing
        : [blank('Deposit', 50), blank('Production kickoff', 25), blank('Final', 25)],
  )
  const [error, setError] = useState<string | null>(null)
  // Remembered per device.
  const [mode, setModeState] = useState<InputMode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'dollars' ? 'dollars' : 'percent'
    } catch {
      return 'percent'
    }
  })

  /** Dollars already committed to draws that have been paid. */
  const lockedTotal = rows.reduce((a, r) => a + (r.locked ? r.lockedAmount : 0), 0)
  // (2026-10-27) The open draws split what's LEFT; a paid draw shows what was
  // paid. Kept as a plain sentence because that's the whole model now.
  const remaining = Math.max(0, contractTotal - lockedTotal)

  /**
   * Dollars are derived from the percentages — never typed, never stored apart
   * from the percent that produced them.
   *
   * ⛔ A LOCKED ROW SHOWS ITS REAL STORED DOLLARS, not a derived share. Money
   * has been credited against that exact number, and `updateDrawSchedule`
   * won't rewrite it — so showing a recomputed figure would display an amount
   * the save is not going to write.
   *
   * The editable rows therefore split what's LEFT of the contract, in
   * proportion to each other. `allocateRounded` (largest remainder) keeps them
   * summing to it exactly; per-row `Math.round` is what made every generated
   * schedule a dollar off and had the shop recording $2 correcting payments.
   */
  const [touched, setTouched] = useState(false)
  const dollarsOf = (r: DrawDraft) => Number(r.dollars) || 0
  const amounts = useMemo(() => {
    if (!touched && rows.every((r) => r.shownAmount != null)) return rows.map((r) => r.shownAmount as number)
    if (contractTotal <= 0) return rows.map(() => 0)
    // Dollars mode: what's typed is what's saved.
    if (mode === 'dollars') return rows.map((r) => (r.locked ? r.lockedAmount : dollarsOf(r)))
    // Percent mode: locked + pinned rows hold their dollars; the % rows split
    // what's LEFT in proportion to each other.
    const pinnedSum = rows.reduce((a, r) => a + (!r.locked && r.pinned ? dollarsOf(r) : 0), 0)
    const left = Math.max(0, remaining - pinnedSum)
    const freeIdx = rows.map((r, i) => (r.locked || r.pinned ? -1 : i)).filter((i) => i >= 0)
    const freePcts = freeIdx.map((i) => Number(rows[i].pct) || 0)
    const freeSum = freePcts.reduce((a, b) => a + b, 0)
    const shares =
      freeSum > 0
        ? allocateRounded(
            freePcts.map((p) => (left * p) / freeSum),
            left,
          )
        : freeIdx.map(() => 0)
    const out = rows.map((r) => (r.locked ? r.lockedAmount : r.pinned ? dollarsOf(r) : 0))
    freeIdx.forEach((rowIdx, n) => {
      out[rowIdx] = shares[n]
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, contractTotal, remaining, touched, mode])

  // Each row's percent: typed for % rows, derived for locked / pinned ones.
  const pctOf = (r: DrawDraft, i: number) =>
    r.locked || r.pinned ? (contractTotal > 0 ? ((amounts[i] ?? 0) / contractTotal) * 100 : 0) : Number(r.pct) || 0
  const sum = rows.reduce((a, r, i) => a + pctOf(r, i), 0)
  const totalDollars = amounts.reduce((a, b) => a + b, 0)
  const leftDollars = Math.round((contractTotal - totalDollars) * 100) / 100
  // Dollars mode foots to the contract to the dollar; percent mode to 100%.
  const balanced = mode === 'dollars' ? Math.abs(leftDollars) < 0.5 : Math.abs(sum - 100) < 0.01

  function setMode(next: InputMode) {
    if (next === mode) return
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      /* private window — fine, it just isn't remembered */
    }
    setTouched(true)
    if (next === 'dollars') {
      // Carry what each row shows into its dollars box (not pinned until typed).
      setRows((prev) => prev.map((r, i) => (r.locked ? r : { ...r, dollars: String(amounts[i] ?? 0) })))
    } else if (contractTotal > 0) {
      // Back to %: unpinned rows get the percent of what they show; the last
      // one absorbs rounding so it opens at exactly 100%.
      setRows((prev) => {
        const next2 = prev.map((r, i) =>
          r.locked || r.pinned ? r : { ...r, pct: String(Math.round(((amounts[i] ?? 0) / contractTotal) * 10000) / 100) },
        )
        const last = [...next2].reverse().find((r) => !r.locked && !r.pinned)
        if (last) {
          const others = next2.reduce((a, r, i) => (r === last ? a : a + pctOf(r, i)), 0)
          last.pct = String(Math.round((100 - others) * 100) / 100)
        }
        return next2
      })
    }
    setModeState(next)
  }

  function patch(i: number, p: Partial<DrawDraft>) {
    if (p.pct !== undefined) setTouched(true)
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)))
  }
  function addRow() {
    setTouched(true)
    // Seed with whatever is left so the sum walks toward the contract.
    const slack = Math.max(0, 100 - sum)
    setRows((prev) => [
      ...prev,
      { ...blank(`Draw ${prev.length + 1}`, slack), dollars: String(Math.max(0, leftDollars)) },
    ])
  }
  function removeRow(i: number) {
    // A draw with ANY cash can't be removed — the payment would be orphaned.
    // The button is disabled; this is the second line of defence.
    if (rows[i]?.locked || (rows[i]?.floor || 0) > 0.005) return
    setTouched(true)
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }
  function usePreset(p: (typeof PRESETS)[number]) {
    // ⚠️ Presets keep every row with money on it. Replacing a schedule
    // wholesale when half of it is already paid is exactly the rewrite this
    // modal must not do.
    // ⛔ …and they don't re-add a label a kept row already has. That's how
    // Oliveira got a second "Deposit" (2026-09-23): a preset's "Deposit" was
    // appended after the paid one and filled the rest of the contract.
    // Presets are percentages — they seed PERCENT mode.
    if (mode === 'dollars') setMode('percent')
    setTouched(true)
    setRows((prev) => {
      const kept = prev.filter((r) => r.locked || (r.floor || 0) > 0.005)
      const have = new Set(kept.map((r) => r.label.trim().toLowerCase()))
      return [...kept, ...p.rows.filter((r) => !have.has(r.label.toLowerCase())).map((r) => blank(r.label, r.pct))]
    })
  }

  // A partly-paid draw can't be set below the cash already credited to it.
  const underFloor = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !r.locked && (r.floor || 0) > 0.005 && (amounts[i] ?? 0) < (r.floor || 0) - 0.005)
  // Label hygiene (1f): two draws with the same name read as one paid twice.
  const dupLabels = (() => {
    const seen = new Map<string, number>()
    for (const r of rows) {
      const k = r.label.trim().toLowerCase()
      if (k) seen.set(k, (seen.get(k) || 0) + 1)
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => rows.find((r) => r.label.trim().toLowerCase() === k)!.label.trim())
  })()

  const canSave =
    balanced &&
    contractTotal > 0 &&
    rows.length > 0 &&
    rows.every((r) => r.label.trim()) &&
    underFloor.length === 0 &&
    !saving

  async function handleSave() {
    if (!canSave) return
    setError(null)
    try {
      await onSave(
        rows.map((r, i) => ({
          id: r.id,
          label: r.label.trim(),
          pct: Math.round(pctOf(r, i) * 100) / 100,
          amount: amounts[i],
          note: r.note.trim(),
          // Locked rows keep whatever they had; the save path won't touch them.
          pinned: !r.locked && !!r.pinned,
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
            <div className="text-[14px] font-semibold text-[#111]">
              {isEdit ? 'Edit draws' : 'Set up draws'}
            </div>
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
              {/* ⛔ SAY WHY A ROW IS FROZEN. A disabled input with no
                  explanation reads as a broken form, and the operator's next
                  move would be to delete the row — which is the one thing
                  that must not happen to a draw with money against it. */}
              {(rows.some((r) => r.locked) || rows.some((r) => (r.floor || 0) > 0.005)) && (
                <div className="mb-3 text-[11.5px] text-[#047857] bg-[#F0FDF4] border border-[#A7F3D0] rounded-md px-3 py-2 leading-snug">
                  Paid draws are locked at what was actually paid. The open draws
                  split what&apos;s left of the contract.
                  {remaining <= 0 && (
                    <div className="mt-1 text-[#B45309]">
                      The paid draws already account for the whole contract, so
                      there is nothing left to re-split.
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                {/* Which column is the INPUT (2026-10-28). Remembered. */}
                <div className="inline-flex rounded border border-[#E5E7EB] overflow-hidden mr-2" role="group" aria-label="Enter draws as">
                  {(['percent', 'dollars'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-2 py-1 text-[11px] font-medium ${
                        mode === m ? 'bg-[#2563EB] text-white' : 'bg-white text-[#374151] hover:bg-[#F3F4F6]'
                      }`}
                    >
                      {m === 'percent' ? 'Percent' : 'Dollars'}
                    </button>
                  ))}
                </div>
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
                  <div key={r.id ?? `new-${i}`} className="flex items-center gap-1.5">
                    <input
                      value={r.label}
                      onChange={(e) => patch(i, { label: e.target.value })}
                      placeholder="What this draw is"
                      disabled={r.locked}
                      title={r.locked ? 'This draw is fully paid — delete its payments to edit it.' : undefined}
                      className={`${field} flex-1 min-w-0 ${
                        r.locked ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#6B7280]' : ''
                      }`}
                    />
                    {mode === 'dollars' && !r.locked ? (
                      <>
                        <span className="text-[11px] text-[#9CA3AF]">$</span>
                        <input
                          value={r.dollars ?? ''}
                          onChange={(e) => {
                            setTouched(true)
                            // Typed in dollars ⇒ PINNED (123): exact, never re-spread.
                            patch(i, { dollars: e.target.value.replace(/[^0-9.]/g, ''), pinned: true })
                          }}
                          title="Typed in dollars — this amount stays exactly as entered"
                          className={`${field} w-24 text-right font-mono ${r.pinned ? 'border-[#93C5FD]' : ''}`}
                        />
                        {Math.abs(leftDollars) >= 0.5 && (
                          <button
                            onClick={() => {
                              setTouched(true)
                              patch(i, { dollars: String(Math.max(0, (amounts[i] ?? 0) + leftDollars)), pinned: true })
                            }}
                            title="Put the remainder on this draw"
                            className="text-[10px] text-[#2563EB] hover:underline whitespace-nowrap"
                          >
                            {leftDollars > 0 ? '+' : '−'}
                            {money(Math.abs(leftDollars))}
                          </button>
                        )}
                      </>
                    ) : mode === 'percent' && r.pinned && !r.locked ? (
                      // A dollars-pinned row in percent mode: its % is derived.
                      <>
                        <span className="w-14 text-right font-mono text-[12px] text-[#6B7280]">
                          {pctOf(r, i).toFixed(2)}
                        </span>
                        <button
                          onClick={() => {
                            setTouched(true)
                            patch(i, { pinned: false, pct: String(Math.round(pctOf(r, i) * 100) / 100) })
                          }}
                          title="Typed in dollars — click to let it follow the percentages again"
                          className="text-[10px] px-1 rounded bg-[#EFF6FF] text-[#1E40AF] hover:bg-[#DBEAFE] whitespace-nowrap"
                        >
                          fixed $ · unpin
                        </button>
                      </>
                    ) : (
                      <>
                        <input
                          value={mode === 'dollars' && r.locked ? String(Math.round(r.lockedAmount)) : r.pct}
                          onChange={(e) => patch(i, { pct: e.target.value.replace(/[^0-9.]/g, '') })}
                          disabled={r.locked}
                          className={`${field} ${mode === 'dollars' ? 'w-24' : 'w-14'} text-right font-mono ${
                            r.locked ? 'bg-[#F0FDF4] border-[#A7F3D0] text-[#6B7280]' : ''
                          }`}
                        />
                        <span className="text-[11px] text-[#9CA3AF] w-3">{mode === 'dollars' ? '' : '%'}</span>
                      </>
                    )}
                    <span
                      title={!r.locked && (r.floor || 0) > 0.005 ? `${money(r.floor || 0)} already in — can't go below` : undefined}
                      className={`text-[12px] font-mono tabular-nums w-20 text-right ${
                        r.locked
                          ? 'text-[#059669]'
                          : underFloor.some((u) => u.i === i)
                            ? 'text-[#B91C1C]'
                            : (r.floor || 0) > 0.005
                              ? 'text-[#B45309]'
                              : 'text-[#374151]'
                      }`}
                    >
                      {mode === 'dollars' ? `${pctOf(r, i).toFixed(1)}%` : money(amounts[i] ?? 0)}
                    </span>
                    {/* ⛔ PAID ROWS CANNOT BE REMOVED. Deleting one orphans the
                        payment that settled it, and the allocation can't be
                        reconstructed afterwards. */}
                    <button
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1 || r.locked || (r.floor || 0) > 0.005}
                      title={r.locked || (r.floor || 0) > 0.005 ? 'Has payments — delete them first' : 'Remove'}
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
                    total the contract is money that never gets tracked. */}
                <div
                  className={`text-[12px] font-mono tabular-nums ${
                    balanced ? 'text-[#059669]' : 'text-[#B91C1C]'
                  }`}
                >
                  {mode === 'dollars' ? (
                    <>
                      {money(totalDollars)} of {money(contractTotal)}
                      {Math.abs(leftDollars) >= 0.5 && (
                        <span className="ml-1">
                          · {money(Math.abs(leftDollars))} {leftDollars > 0 ? 'left' : 'over'}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {sum.toFixed(sum % 1 === 0 ? 0 : 2)}% · {money(totalDollars)}
                      {!balanced && <span className="ml-1">— must be 100%</span>}
                    </>
                  )}
                </div>
              </div>
              {underFloor.length > 0 && (
                <div className="mt-2 text-[11.5px] text-[#B91C1C]">
                  {underFloor
                    .map(({ r }) => `${r.label || 'A draw'} can't go below the ${money(r.floor || 0)} already received`)
                    .join(' · ')}
                  .
                </div>
              )}
              {dupLabels.length > 0 && (
                <div className="mt-2 text-[11.5px] text-[#B45309]">
                  Two draws are named {dupLabels.map((l) => `“${l}”`).join(', ')} — rename one so the schedule
                  doesn&apos;t read like the same draw twice.
                </div>
              )}
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
              {saving ? 'Saving…' : isEdit ? 'Save draws' : 'Create draws'}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            {/* Andrew: "just add them to the no-date bucket so I can drag them
                in." Stamping dates a month apart put real money into months
                nobody had agreed to. */}
            <span className="text-[11px] text-[#9CA3AF] ml-auto">
              {isEdit
                ? 'Dates stay where they are — drag cards to change them.'
                : 'New draws land in “No date set” — drag them into a month.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

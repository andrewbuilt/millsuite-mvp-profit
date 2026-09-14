'use client'

// ============================================================================
// DivideBlockModal — split a department_allocations row into N week-pinned
// pieces.
// ============================================================================
// Operator-driven manual divide: the user clicks the ⋮ on any block, the
// modal opens with the block's total hours, they pick how many splits,
// then for each split they choose a starting week + a slice of the total.
// Sum has to match the total exactly before save unlocks.
//
// On save, the parent deletes the source allocation and inserts N new
// rows — same subproject_id / department_id / org_id / crew_size, each
// with its own scheduled_date and estimated_hours. Auto-placement is
// skipped: the operator chose explicit dates, the engine doesn't get to
// override.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
// ⛔ The splitting RULES live in lib/divide-block, which is pure and verified.
// Don't reimplement them here — the sum-to-total invariant is what the Save
// gate depends on.
import {
  addDays,
  applyFirstDate,
  evenSplit,
  isCustomEdit,
  resizeRows as resizeSplitRows,
  splitIsValid,
  MAX_SPLITS,
  MIN_SPLITS,
  type SplitRow,
} from '@/lib/divide-block'

interface Props {
  blockId: string
  deptName: string
  projectName: string
  subprojectName: string
  totalHours: number
  /** Initial Monday-of-week for the source block — used to default the
   *  first split's date. Subsequent splits default to +7 days each. */
  initialWeekStartIso: string
  saving: boolean
  onCancel: () => void
  onSave: (splits: Array<{ scheduledDate: string; hours: number }>) => Promise<void>
}

export default function DivideBlockModal({
  blockId,
  deptName,
  projectName,
  subprojectName,
  totalHours,
  initialWeekStartIso,
  saving,
  onCancel,
  onSave,
}: Props) {
  const [splitCount, setSplitCount] = useState(2)
  const [countText, setCountText] = useState('2')
  const [rows, setRows] = useState<SplitRow[]>(() =>
    evenSplit(2, totalHours, initialWeekStartIso),
  )
  /**
   * ⛔ CUSTOM MODE — THE OPERATOR HAS TOUCHED A ROW, SO NOTHING AUTOMATIC MAY
   * OVERWRITE IT. Before this, changing the count regenerated every row from
   * scratch and silently discarded hand-typed dates and hours. A dialog that
   * throws away typing the moment you adjust something else is the kind of
   * thing people learn to distrust, and then stop using.
   *
   * Set by editing ANY row's hours, or any date other than the first — the
   * first date is the auto-fill handle, not an edit (see `setFirstDate`).
   */
  const [custom, setCustom] = useState(false)

  // Re-seed only while the operator hasn't taken over. `custom` is
  // deliberately NOT in the deps: flipping it must not trigger a re-seed that
  // wipes the very edit that set it.
  useEffect(() => {
    if (custom) return
    setRows(evenSplit(splitCount, totalHours, initialWeekStartIso))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitCount, totalHours, initialWeekStartIso])

  function applyCount(n: number) {
    const clamped = Math.max(MIN_SPLITS, Math.min(MAX_SPLITS, n))
    setSplitCount(clamped)
    if (custom) setRows((prev) => resizeSplitRows(prev, clamped, initialWeekStartIso))
  }

  /** Throw away the edits and spread evenly again. Explicit, never automatic. */
  function reSplitEvenly() {
    setCustom(false)
    setRows(evenSplit(splitCount, totalHours, initialWeekStartIso))
  }

  /**
   * The first row's date is the auto-fill handle: moving it walks the rest
   * forward a week at a time. That's the common case — "this whole run starts
   * a fortnight later" — and doing it by hand across a dozen rows is exactly
   * the tedium the typed week count just made possible.
   *
   * ⛔ In custom mode it moves ONLY row 1. The operator has placed the others
   * deliberately; dragging them along would undo that.
   */
  function setFirstDate(iso: string) {
    setRows((prev) => applyFirstDate(prev, iso, custom))
  }

  function patchRow(i: number, patch: Partial<SplitRow>) {
    // Any hours edit, or a date on a row other than the first, is the
    // operator taking over.
    if (isCustomEdit(i, patch)) setCustom(true)
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const sum = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.hours) || 0), 0),
    [rows],
  )
  const matches = Math.abs(sum - totalHours) < 0.001
  // ⛔ THE SUM CHECK STAYS THE GATE, in custom mode too. Custom means "don't
  // overwrite what I typed", not "don't check it" — a split that doesn't foot
  // silently loses or invents scheduled hours on save.
  const canSave = splitIsValid(rows, totalHours) && !saving

  async function handleSave() {
    if (!canSave) return
    await onSave(
      rows.map((r) => ({
        scheduledDate: r.startDate,
        hours: Number(r.hours),
      })),
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '64px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#FFF',
          border: '1px solid #E5E7EB',
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
              Divide block
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#6B7280',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {deptName} · {projectName} · {subprojectName}
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#9CA3AF',
              padding: 4,
              borderRadius: 4,
            }}
          >
            <X width={16} height={16} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          <div
            style={{
              fontSize: 12,
              color: '#374151',
              marginBottom: 14,
              padding: '8px 10px',
              background: '#F9FAFB',
              border: '1px solid #E5E7EB',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: "'SF Mono', monospace",
            }}
          >
            <span style={{ color: '#6B7280', fontFamily: 'inherit' }}>Total</span>
            <span style={{ color: '#111', fontWeight: 600 }}>
              {totalHours}h
            </span>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#374151',
              marginBottom: 12,
            }}
          >
            Split across
            {/* ⛔ TYPED, NOT A DROPDOWN. The old select topped out at 6 and a
                long run genuinely needs more. Kept as free text while editing
                so the field can be cleared and retyped — committing on every
                keystroke made "12" pass through "1" and collapse the rows. */}
            <input
              type="number"
              min={MIN_SPLITS}
              max={MAX_SPLITS}
              step={1}
              value={countText}
              onChange={(e) => setCountText(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => {
                const n = parseInt(countText, 10)
                if (!Number.isFinite(n)) {
                  setCountText(String(splitCount))
                  return
                }
                const clamped = Math.max(MIN_SPLITS, Math.min(MAX_SPLITS, n))
                setCountText(String(clamped))
                applyCount(clamped)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              style={{
                width: 56,
                fontSize: 12,
                padding: '4px 8px',
                border: '1px solid #E5E7EB',
                borderRadius: 4,
                background: '#FFF',
                textAlign: 'right',
                fontFamily: "'SF Mono', monospace",
              }}
            />
            weeks
            <span style={{ fontSize: 10.5, color: '#9CA3AF' }}>max {MAX_SPLITS}</span>
          </label>

          {custom && (
            <div
              style={{
                fontSize: 11,
                color: '#92400E',
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: 6,
                padding: '6px 9px',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span>
                Custom split — your dates and hours are kept as typed.
              </span>
              <button
                onClick={reSplitEvenly}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  fontSize: 11,
                  color: '#92400E',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Split evenly again
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr 90px',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: '#9CA3AF',
                    fontFamily: "'SF Mono', monospace",
                    textAlign: 'right',
                  }}
                >
                  #{i + 1}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
                    Starting week of
                  </span>
                  <input
                    type="date"
                    value={row.startDate}
                    onChange={(e) =>
                      i === 0
                        ? setFirstDate(e.target.value)
                        : patchRow(i, { startDate: e.target.value })
                    }
                    title={
                      i === 0 && !custom
                        ? 'Moving the first week shifts the rest along with it'
                        : undefined
                    }
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: '4px 6px',
                      border: '1px solid #E5E7EB',
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={row.hours}
                    onChange={(e) => patchRow(i, { hours: e.target.value })}
                    style={{
                      width: 60,
                      fontSize: 12,
                      padding: '4px 6px',
                      border: '1px solid #E5E7EB',
                      borderRadius: 4,
                      textAlign: 'right',
                      fontFamily: "'SF Mono', monospace",
                    }}
                  />
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>h</span>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 16,
              padding: '8px 10px',
              borderRadius: 6,
              background: matches ? '#ECFDF5' : '#FEF2F2',
              border: `1px solid ${matches ? '#A7F3D0' : '#FECACA'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 12,
              fontFamily: "'SF Mono', monospace",
            }}
          >
            <span style={{ color: matches ? '#065F46' : '#991B1B', fontFamily: 'inherit' }}>
              Sum
            </span>
            <span
              style={{
                color: matches ? '#065F46' : '#991B1B',
                fontWeight: 600,
              }}
            >
              {sum}h / {totalHours}h {matches ? '✓' : ''}
            </span>
          </div>
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #E5E7EB',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            background: '#F9FAFB',
          }}
        >
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid #E5E7EB',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#374151',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              background: canSave ? '#2563EB' : '#9CA3AF',
              border: 'none',
              borderRadius: 6,
              cursor: canSave ? 'pointer' : 'not-allowed',
              color: '#FFF',
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* For accessibility: blockId is hidden but available for ARIA. */}
        <input type="hidden" data-block-id={blockId} />
      </div>
    </div>
  )
}

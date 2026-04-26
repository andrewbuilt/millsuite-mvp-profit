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

interface SplitRow {
  startDate: string  // ISO yyyy-mm-dd, Monday of the week
  hours: string      // string while editing so the user can clear the field
}

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

const MIN_SPLITS = 2
const MAX_SPLITS = 6

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function defaultSplits(count: number, total: number, weekStartIso: string): SplitRow[] {
  // Default each split to total/N rounded to 0.5; stuff any rounding
  // remainder into the last row so the live sum matches on first render
  // and the operator can save without retyping.
  const base = Math.round((total / count) * 2) / 2
  const rows: SplitRow[] = []
  let remaining = total
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1
    const slice = isLast ? remaining : base
    rows.push({
      startDate: addDays(weekStartIso, i * 7),
      hours: String(slice),
    })
    remaining = +(remaining - slice).toFixed(2)
  }
  return rows
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
  const [rows, setRows] = useState<SplitRow[]>(() =>
    defaultSplits(2, totalHours, initialWeekStartIso),
  )

  // When the count dropdown changes, regenerate defaults — the operator
  // explicitly picked a new split count, so blowing away their per-row
  // edits is the expected behavior. Re-running defaultSplits also keeps
  // the sum at the total without forcing them to retype.
  useEffect(() => {
    setRows(defaultSplits(splitCount, totalHours, initialWeekStartIso))
  }, [splitCount, totalHours, initialWeekStartIso])

  function patchRow(i: number, patch: Partial<SplitRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const sum = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.hours) || 0), 0),
    [rows],
  )
  const matches = Math.abs(sum - totalHours) < 0.001
  const allDatesSet = rows.every((r) => r.startDate)
  const allHoursPositive = rows.every((r) => (Number(r.hours) || 0) > 0)
  const canSave = matches && allDatesSet && allHoursPositive && !saving

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
            <select
              value={splitCount}
              onChange={(e) => setSplitCount(parseInt(e.target.value, 10))}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                border: '1px solid #E5E7EB',
                borderRadius: 4,
                background: '#FFF',
              }}
            >
              {Array.from({ length: MAX_SPLITS - MIN_SPLITS + 1 }, (_, i) => MIN_SPLITS + i).map(
                (n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
            weeks
          </label>

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
                    onChange={(e) => patchRow(i, { startDate: e.target.value })}
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

'use client'

// ============================================================================
// FreeformLineModal — minimal editor for non-composer estimate lines.
// ============================================================================
// Composer lines (product_key set) round-trip through AddLineComposer in edit
// mode (Issue 19). Freeform lines have no composer to drop them into; this
// modal is the edit path for them: optional spec label, description, qty,
// unit, cost-each, notes. Live operators create freeform lines all the
// time ("client supplied range hood", "subcontracted countertop install"),
// so dropping them into the same "can't edit, delete and recreate" bail
// that legacy pre-composer rows hit was a regression.
//
// Storage:
//   - description, quantity, unit, notes go in their own columns.
//   - The "Cost each" input writes unit_price_override directly (NO
//     divide). computeLineBuildup multiplies unit_price_override × qty
//     at read time — the form's mental model and the math agree.
//   - spec_label opts the line into the pre-prod approval flow when
//     non-empty. lib/approvals.proposeSlotsFromFreeformLine emits one
//     approval slot per such line on handoff (label = spec_label,
//     material = description).
//
// Open paths in the parent (subproject editor):
//   1. Click on a freeform row → reopen the modal with stored values.
//   2. Add-line input → freeform row → addEstimateLine creates a stub →
//      open this modal automatically so the operator fills it in.
// ============================================================================

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { updateEstimateLine, type EstimateLine } from '@/lib/estimate-lines'
import type { Unit } from '@/lib/rate-book-v2'

export interface FreeformLineModalProps {
  /** The line being edited. Null when closed. */
  line: EstimateLine | null
  onClose: () => void
  /** Fired after a successful save. Receives the patched line so the
   *  parent can splice it into its lines state without a refetch. */
  onSaved: (patched: EstimateLine) => void
}

function moneyParse(input: string): number {
  // Strip $ and commas before parsing so the operator can paste "$1,200".
  const n = parseFloat(input.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function moneyFmt(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  return `$${Math.round(n).toLocaleString()}`
}

// Standard line-item units. Covers ~95% of what a millwork bid uses;
// "+ Custom" expands a small text input for the rare exception
// (per project, per drawer, etc.).
const STANDARD_UNITS = ['ea', 'lf', 'sf', 'lump', 'hr', 'set'] as const

function isStandardUnit(u: string): boolean {
  return (STANDARD_UNITS as readonly string[]).includes(u)
}

export default function FreeformLineModal({
  line,
  onClose,
  onSaved,
}: FreeformLineModalProps) {
  const [specLabel, setSpecLabel] = useState('')
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState<string>('ea')
  const [unitIsCustom, setUnitIsCustom] = useState(false)
  const [costEach, setCostEach] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate from the line every time it (re)opens.
  useEffect(() => {
    if (!line) return
    setSpecLabel(line.spec_label || '')
    setDescription(line.description || '')
    const q = Number(line.quantity) || 1
    setQty(String(q))
    const storedUnit = String(line.unit ?? 'ea')
    if (storedUnit && !isStandardUnit(storedUnit)) {
      setUnit(storedUnit)
      setUnitIsCustom(true)
    } else {
      setUnit(storedUnit || 'ea')
      setUnitIsCustom(false)
    }
    // unit_price_override is per-unit cost-each (post-2026-04-25).
    // Older rows that were saved as "total / qty" already round-trip
    // correctly because unit_price_override × qty still produces their
    // total — the user just sees the per-unit number now, which is
    // what they typed in the contractor mental model.
    const storedCost =
      line.unit_price_override != null ? Number(line.unit_price_override) : 0
    setCostEach(storedCost > 0 ? String(storedCost) : '')
    setNotes(line.notes || '')
    setError(null)
    setSaving(false)
  }, [line?.id])

  if (!line) return null

  const qtyN = parseFloat(qty)
  const costEachN = moneyParse(costEach)
  const lineTotalPreview =
    Number.isFinite(qtyN) && Number.isFinite(costEachN) && qtyN > 0 && costEachN >= 0
      ? qtyN * costEachN
      : 0

  async function handleSave() {
    if (!line) return
    const trimmedDesc = description.trim()
    if (!trimmedDesc) {
      setError('Add a description before saving.')
      return
    }
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      setError('Quantity must be a positive number.')
      return
    }
    if (!Number.isFinite(costEachN) || costEachN < 0) {
      setError('Cost each must be zero or greater.')
      return
    }
    const unitClean = unit.trim() || 'ea'

    setSaving(true)
    setError(null)
    try {
      // Per-unit storage: computeLineBuildup multiplies unit_price_override
      // by quantity at read time (lib/estimate-lines.ts ~L446). Storing
      // costEach directly makes the form input and the line total agree.
      await updateEstimateLine(line.id, {
        description: trimmedDesc,
        quantity: qtyN,
        unit: unitClean as Unit,
        unit_price_override: costEachN,
        notes: notes.trim() || null,
        spec_label: specLabel.trim() || null,
      })
      onSaved({
        ...line,
        description: trimmedDesc,
        quantity: qtyN,
        unit: unitClean as Unit,
        unit_price_override: costEachN,
        notes: notes.trim() || null,
        spec_label: specLabel.trim() || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#111]">
            Freeform line
          </h3>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Spec label (optional)
            </span>
            <input
              autoFocus
              value={specLabel}
              onChange={(e) => setSpecLabel(e.target.value)}
              placeholder="e.g. Custom doors, Toe kick, Range hood"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            />
            <span className="text-[10.5px] text-[#9CA3AF] leading-tight block mt-1">
              When set, this line becomes a pre-production approval card —
              client signs off before production. Leave blank for cost-only
              items the client doesn't need to approve.
            </span>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Description
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Client-supplied range hood"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-[80px_100px_1fr] gap-3">
            <label className="block">
              <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Qty
              </span>
              <input
                type="number"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none text-right"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Unit
              </span>
              {unitIsCustom ? (
                <div className="mt-1 flex gap-1">
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="custom"
                    className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUnit('ea')
                      setUnitIsCustom(false)
                    }}
                    className="px-2 text-[#9CA3AF] hover:text-[#111] text-sm"
                    aria-label="Cancel custom unit"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <select
                  value={unit}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setUnit('')
                      setUnitIsCustom(true)
                    } else {
                      setUnit(e.target.value)
                    }
                  }}
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none bg-white"
                >
                  {STANDARD_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                  <option value="__custom__">+ custom…</option>
                </select>
              )}
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Cost each ($)
              </span>
              <input
                value={costEach}
                onChange={(e) => setCostEach(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none text-right"
              />
            </label>
          </div>

          {/* Live derived total — confidence check that the contractor
              mental model and the stored math agree. Reads:
                  N {unit} × $X each = $Total */}
          {qtyN > 0 && (
            <div className="text-[12px] text-[#6B7280] -mt-2">
              Line total:{' '}
              <span className="font-mono tabular-nums text-[#111] font-semibold">
                {qtyN} {unit || 'ea'} × {moneyFmt(costEachN)} ={' '}
                {moneyFmt(lineTotalPreview)}
              </span>
            </div>
          )}

          <label className="block">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes — not shown to client"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none resize-vertical"
            />
          </label>

          {error && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save line'}
          </button>
        </div>
      </div>
    </div>
  )
}

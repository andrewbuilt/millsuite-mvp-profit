'use client'

// ============================================================================
// FreeformLineModal — minimal editor for non-composer estimate lines.
// ============================================================================
// Composer lines (product_key set) round-trip through AddLineComposer in edit
// mode (Issue 19). Freeform lines have no composer to drop them into; this
// modal is the edit path for them: description, qty, unit, line total,
// notes. Live operators create freeform lines all the time ("client supplied
// range hood", "subcontracted countertop install"), so dropping them into
// the same "can't edit, delete and recreate" bail that legacy pre-composer
// rows hit was a regression.
//
// Storage:
//   - description, quantity, unit, notes go in their own columns.
//   - The "line total" input writes unit_price_override = total / qty so
//     computeLineBuildup's `unit_price_override × qty` math reproduces the
//     same total. Same per-unit-storage pattern Issue 18 enforced for
//     composer lines.
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

export default function FreeformLineModal({
  line,
  onClose,
  onSaved,
}: FreeformLineModalProps) {
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState<string>('ea')
  const [total, setTotal] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Hydrate from the line every time it (re)opens.
  useEffect(() => {
    if (!line) return
    setDescription(line.description || '')
    const q = Number(line.quantity) || 1
    setQty(String(q))
    setUnit(String(line.unit ?? 'ea'))
    const lineTotal =
      line.unit_price_override != null
        ? Number(line.unit_price_override) * q
        : 0
    setTotal(lineTotal > 0 ? String(Math.round(lineTotal)) : '')
    setNotes(line.notes || '')
    setError(null)
    setSaving(false)
  }, [line?.id])

  if (!line) return null

  async function handleSave() {
    if (!line) return
    const trimmedDesc = description.trim()
    if (!trimmedDesc) {
      setError('Add a description before saving.')
      return
    }
    const qtyN = parseFloat(qty)
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      setError('Quantity must be a positive number.')
      return
    }
    const totalN = moneyParse(total)
    if (!Number.isFinite(totalN) || totalN < 0) {
      setError('Line total must be zero or greater.')
      return
    }
    const unitClean = unit.trim() || 'ea'

    // Per-unit storage: lib/estimate-lines.computeLineBuildup multiplies
    // unit_price_override by quantity at read time (line ~446). Storing
    // total/qty here makes the round-trip exact regardless of qty.
    const unitPriceOverride = qtyN > 0 ? totalN / qtyN : 0

    setSaving(true)
    setError(null)
    try {
      await updateEstimateLine(line.id, {
        description: trimmedDesc,
        quantity: qtyN,
        unit: unitClean as Unit,
        unit_price_override: unitPriceOverride,
        notes: notes.trim() || null,
      })
      onSaved({
        ...line,
        description: trimmedDesc,
        quantity: qtyN,
        unit: unitClean as Unit,
        unit_price_override: unitPriceOverride,
        notes: notes.trim() || null,
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
              Description
            </span>
            <input
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Client-supplied range hood"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-[80px_80px_1fr] gap-3">
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
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="ea"
                className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Line total
              </span>
              <input
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="$0"
                inputMode="decimal"
                className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none text-right"
              />
            </label>
          </div>

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

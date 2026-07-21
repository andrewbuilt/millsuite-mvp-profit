'use client'

// ============================================================================
// CreateChangeOrderModal — Andrew's 2026-07-20 CO flow.
// ============================================================================
// Launched from the subproject header (sold onward). The operator describes the
// change, sets the new material/finish, and enters material + labor cost; the
// modal prices it through the project margins (computeCoClientPrice) and shows
// the client price prominently — editable, because Andrew's default is "any
// cost difference gets billed; $0 is only for a true no-cost swap." Saves a
// draft CO (createChangeOrderV2); the downstream send / accept / bill flow is
// later slices.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  computeCoClientPrice,
  createChangeOrderV2,
  type PricingInputs,
  type ChangeOrder,
} from '@/lib/change-orders'

interface Props {
  projectId: string
  subprojectId: string
  subprojectName: string
  /** Current spec being changed (prefill for "what's changing"), optional. */
  currentSpec?: string | null
  pricing: PricingInputs
  onClose: () => void
  onCreated: (co: ChangeOrder) => void
}

function moneyParse(input: string): number {
  const n = parseFloat(input.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function CreateChangeOrderModal({
  projectId,
  subprojectId,
  subprojectName,
  currentSpec,
  pricing,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('')
  const [oldSpec, setOldSpec] = useState(currentSpec || '')
  const [newMaterial, setNewMaterial] = useState('')
  const [materialCost, setMaterialCost] = useState('')
  const [laborCost, setLaborCost] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [priceTouched, setPriceTouched] = useState(false)
  const [drawingRev, setDrawingRev] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matN = moneyParse(materialCost)
  const labN = moneyParse(laborCost)

  // Suggested client price = material + labor through the project margins.
  const suggested = useMemo(
    () => computeCoClientPrice(matN, labN, pricing),
    [matN, labN, pricing],
  )

  // Keep the price field synced to the suggestion until the user edits it.
  useEffect(() => {
    if (!priceTouched) setPriceInput(suggested ? String(suggested) : '')
  }, [suggested, priceTouched])

  const clientPrice = priceTouched ? moneyParse(priceInput) : suggested
  const isFree = clientPrice === 0
  const internalCostDelta = matN + labN // free-CO margin erosion

  async function handleSave() {
    if (!title.trim()) {
      setError('Describe what’s changing.')
      return
    }
    setSaving(true)
    setError(null)
    const co = await createChangeOrderV2({
      project_id: projectId,
      subproject_id: subprojectId,
      title: title.trim(),
      original_line_snapshot: oldSpec.trim() ? { label: oldSpec.trim() } : {},
      proposed_line: newMaterial.trim() ? { material: newMaterial.trim() } : {},
      material_cost: matN,
      labor_cost: labN,
      client_price: clientPrice,
      internal_cost_delta: isFree ? internalCostDelta : null,
      drawing_revision_required: drawingRev,
    })
    if (!co) {
      setSaving(false)
      setError('Could not create the change order.')
      return
    }
    onCreated(co)
  }

  const label = 'text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider'
  const field =
    'mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center px-4 py-16 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] bg-white rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div>
            <div className="text-[15px] font-semibold text-[#111]">New change order</div>
            <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{subprojectName}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111] p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className={label}>What’s changing</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Upgrade doors from maple to walnut"
              className={field}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Current spec</span>
              <input
                value={oldSpec}
                onChange={(e) => setOldSpec(e.target.value)}
                placeholder="e.g. Maple"
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>New material / finish</span>
              <input
                value={newMaterial}
                onChange={(e) => setNewMaterial(e.target.value)}
                placeholder="e.g. Walnut"
                className={field}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Material cost ($)</span>
              <input
                value={materialCost}
                onChange={(e) => setMaterialCost(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={`${field} font-mono tabular-nums text-right`}
              />
            </label>
            <label className="block">
              <span className={label}>Labor cost ($)</span>
              <input
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={`${field} font-mono tabular-nums text-right`}
              />
            </label>
          </div>

          {/* Client price — the billed number, prominent (Andrew: any cost
              difference gets billed; $0 = a true no-cost swap only). */}
          <div className="px-3 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className={label}>Client price</span>
                <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                  Material + labor through your margins. Set to $0 for a no-charge change.
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#6B7280] text-sm">$</span>
                <input
                  value={priceTouched ? priceInput : suggested ? String(suggested) : ''}
                  onChange={(e) => {
                    setPriceTouched(true)
                    setPriceInput(e.target.value)
                  }}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-28 px-2 py-1.5 text-lg font-semibold font-mono tabular-nums text-right border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none bg-white"
                />
              </div>
            </div>
            {priceTouched && suggested !== clientPrice && (
              <button
                type="button"
                onClick={() => {
                  setPriceTouched(false)
                  setError(null)
                }}
                className="mt-2 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Reset to suggested (${suggested.toLocaleString()})
              </button>
            )}
            <div className="mt-2 text-[11.5px] font-semibold">
              {isFree ? (
                <span className="text-[#6B7280]">No charge — free change (paper trail only)</span>
              ) : (
                <span className="text-[#15803D]">
                  Billed: ${clientPrice.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={drawingRev}
              onChange={(e) => setDrawingRev(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#2563EB]"
            />
            <span className="text-[12.5px] text-[#374151]">Drawing revision required</span>
          </label>

          {error && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB] rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create change order'}
          </button>
        </div>
      </div>
    </div>
  )
}

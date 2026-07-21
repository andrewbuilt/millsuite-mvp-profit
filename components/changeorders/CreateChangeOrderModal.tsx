'use client'

// ============================================================================
// CreateChangeOrderModal — Andrew's 2026-07-20 CO flow (v2 modal, 07-21 rework).
// ============================================================================
// Launched from the subproject header (sold onward).
//   1. Current Spec — dropdown of the subproject's spec lines (which is changing)
//   2. New material — type-ahead against the rate-book materials
//   3. Qty — multiplier on the material unit cost
//   4. Labor — per-department hours (eng/cnc/assembly/finish/install) that roll
//      up into one labor line at the shop rate
// Material cost = qty × unit cost; labor cost = Σ hours × shop rate; the client
// price runs both through the project margins (editable; $0 = no-charge). Saves
// a draft CO (createChangeOrderV2), stashing the detail in the snapshot jsonb.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  computeCoClientPrice,
  createChangeOrderV2,
  listCoMaterials,
  type CoMaterial,
  type PricingInputs,
  type ChangeOrder,
} from '@/lib/change-orders'
import { LABOR_DEPTS, LABOR_DEPT_LABEL, type LaborDept } from '@/lib/rate-book-seed'

export interface CoSpecLine {
  id: string
  label: string
  /** Current qty on the line (prefills the CO qty). */
  qty: number
  /** Current material unit cost on the line (the "old" side of the delta). */
  unitCost: number
}

interface Props {
  projectId: string
  subprojectId: string
  subprojectName: string
  orgId: string
  specLines: CoSpecLine[]
  pricing: PricingInputs
  onClose: () => void
  onCreated: (co: ChangeOrder) => void
}

function moneyParse(input: string): number {
  const n = parseFloat(input.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function numParse(input: string): number {
  const n = parseFloat(input)
  return Number.isFinite(n) ? n : 0
}
const emptyHours: Record<LaborDept, string> = {
  eng: '',
  cnc: '',
  assembly: '',
  finish: '',
  install: '',
}

export default function CreateChangeOrderModal({
  projectId,
  subprojectId,
  subprojectName,
  orgId,
  specLines,
  pricing,
  onClose,
  onCreated,
}: Props) {
  const [specLineId, setSpecLineId] = useState(specLines[0]?.id ?? '')
  const [materialQuery, setMaterialQuery] = useState('')
  const [materials, setMaterials] = useState<CoMaterial[]>([])
  const [showMatList, setShowMatList] = useState(false)
  const [unitCost, setUnitCost] = useState('')
  const [qty, setQty] = useState('1')
  const [hours, setHours] = useState<Record<LaborDept, string>>(emptyHours)
  const [priceInput, setPriceInput] = useState('')
  const [priceTouched, setPriceTouched] = useState(false)
  const [drawingRev, setDrawingRev] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listCoMaterials(orgId).then(setMaterials)
  }, [orgId])

  // Selecting a spec pulls its current qty in (the CO prices the delta on it).
  useEffect(() => {
    const line = specLines.find((s) => s.id === specLineId)
    if (line) setQty(String(line.qty))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specLineId])

  // Close the material dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (matBoxRef.current && !matBoxRef.current.contains(e.target as Node)) {
        setShowMatList(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matMatches = useMemo(() => {
    const q = materialQuery.trim().toLowerCase()
    if (!q) return materials.slice(0, 8)
    return materials.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8)
  }, [materials, materialQuery])

  const selectedLine = specLines.find((s) => s.id === specLineId)
  const oldUnit = selectedLine?.unitCost ?? 0
  const qtyN = numParse(qty) || 1
  const newUnit = moneyParse(unitCost)
  const oldTotal = oldUnit * qtyN
  const newTotal = newUnit * qtyN
  // CO material cost = the delta (new − old) × qty. Negative = a credit.
  const materialCost = newTotal - oldTotal
  const totalHours = LABOR_DEPTS.reduce((s, d) => s + numParse(hours[d]), 0)
  const laborCost = totalHours * (Number(pricing.shopRate) || 0)

  const suggested = useMemo(
    () => computeCoClientPrice(materialCost, laborCost, pricing),
    [materialCost, laborCost, pricing],
  )
  useEffect(() => {
    if (!priceTouched) setPriceInput(suggested ? String(suggested) : '')
  }, [suggested, priceTouched])

  const clientPrice = priceTouched ? moneyParse(priceInput) : suggested
  const isFree = clientPrice === 0

  const specLabel = specLines.find((s) => s.id === specLineId)?.label ?? ''

  async function handleSave() {
    if (!specLineId) {
      setError('Pick the spec that’s changing.')
      return
    }
    if (!materialQuery.trim()) {
      setError('Enter the new material.')
      return
    }
    setSaving(true)
    setError(null)
    const deptHours: Record<string, number> = {}
    for (const d of LABOR_DEPTS) deptHours[`labor_hours_${d}`] = numParse(hours[d])
    const co = await createChangeOrderV2({
      project_id: projectId,
      subproject_id: subprojectId,
      title: `${specLabel} → ${materialQuery.trim()}`,
      original_line_snapshot: { label: specLabel, notes: specLineId },
      proposed_line: {
        material: materialQuery.trim(),
        quantity: qtyN,
        material_cost_per_lf: newUnit,
        ...deptHours,
      },
      material_cost: materialCost,
      labor_cost: laborCost,
      client_price: clientPrice,
      internal_cost_delta: isFree ? materialCost + laborCost : null,
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
        className="w-full max-w-[540px] bg-white rounded-2xl shadow-xl"
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
          {/* 1. Current spec — which line is changing */}
          <label className="block">
            <span className={label}>Current spec</span>
            {specLines.length > 0 ? (
              <select
                value={specLineId}
                onChange={(e) => setSpecLineId(e.target.value)}
                className={`${field} bg-white`}
              >
                {specLines.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-1 text-[12.5px] text-[#9CA3AF] italic">
                No spec lines on this subproject.
              </div>
            )}
          </label>

          {/* 2. New material — rate-book type-ahead */}
          <div className="block" ref={matBoxRef}>
            <span className={label}>New material</span>
            <div className="relative">
              <input
                value={materialQuery}
                onChange={(e) => {
                  setMaterialQuery(e.target.value)
                  setShowMatList(true)
                }}
                onFocus={() => setShowMatList(true)}
                placeholder="Start typing — e.g. Walnut"
                className={field}
              />
              {showMatList && matMatches.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {matMatches.map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => {
                        setMaterialQuery(m.name)
                        if (m.costPerLf > 0) setUnitCost(String(m.costPerLf))
                        setShowMatList(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[#F9FAFB] flex items-center justify-between gap-3"
                    >
                      <span className="text-[#111] truncate">{m.name}</span>
                      {m.costPerLf > 0 && (
                        <span className="text-[11px] font-mono tabular-nums text-[#9CA3AF] flex-shrink-0">
                          ${m.costPerLf}/lf
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 3. Qty (pulled from the line) + new unit cost → material delta */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Qty</span>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                className={`${field} font-mono tabular-nums text-right`}
              />
              <span className="text-[10.5px] text-[#9CA3AF] block mt-0.5">from the spec line</span>
            </label>
            <label className="block">
              <span className={label}>New unit cost ($)</span>
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className={`${field} font-mono tabular-nums text-right`}
              />
              <span className="text-[10.5px] text-[#9CA3AF] block mt-0.5">
                current: ${oldUnit.toLocaleString()}/unit
              </span>
            </label>
          </div>

          {/* Material delta = (new − old) × qty */}
          <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg text-[12px] font-mono tabular-nums">
            <div className="flex justify-between text-[#6B7280]">
              <span>Current material</span>
              <span>{qtyN} × ${oldUnit.toLocaleString()} = ${Math.round(oldTotal).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[#6B7280] mt-0.5">
              <span>New material</span>
              <span>{qtyN} × ${newUnit.toLocaleString()} = ${Math.round(newTotal).toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-semibold text-[#111] mt-1 pt-1 border-t border-[#F3F4F6]">
              <span>Material change</span>
              <span className={materialCost < 0 ? 'text-[#B45309]' : ''}>
                {materialCost < 0 ? '−' : ''}${Math.abs(Math.round(materialCost)).toLocaleString()}
              </span>
            </div>
          </div>

          {/* 4. Labor by department → one rolled-up labor line */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={label}>Labor — hours by department</span>
              <span className="text-[11px] font-mono tabular-nums text-[#6B7280]">
                {totalHours.toFixed(1)} hr · ${Math.round(laborCost).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {LABOR_DEPTS.map((d) => (
                <label key={d} className="block">
                  <span className="text-[9.5px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                    {LABOR_DEPT_LABEL[d]}
                  </span>
                  <input
                    value={hours[d]}
                    onChange={(e) => setHours((h) => ({ ...h, [d]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0"
                    className="mt-1 w-full px-2 py-1.5 text-sm font-mono tabular-nums text-center border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Client price */}
          <div className="px-3 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className={label}>Client price</span>
                <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                  Material + labor through your margins. $0 = no-charge change.
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
                onClick={() => setPriceTouched(false)}
                className="mt-2 text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Reset to suggested (${suggested.toLocaleString()})
              </button>
            )}
            <div className="mt-2 text-[11.5px] font-semibold">
              {isFree ? (
                <span className="text-[#6B7280]">No charge — free change (paper trail only)</span>
              ) : (
                <span className="text-[#15803D]">Billed: ${clientPrice.toLocaleString()}</span>
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

'use client'

// ============================================================================
// CreateChangeOrderModal — one modal, Spec change | Custom (approved prototype
// specs/change-orders/co-modal-prototype.html, 2026-07-21).
// ============================================================================
// ONE "Change order" button (subproject header, post-sold) opens this. A
// segmented toggle switches modes; the title / checkboxes / net / footer below
// are shared and identical in both.
//
//   SPEC CHANGE — pick which spec of the line is changing (derived from the
//     line's specs), original (read-only) → proposed (rate-book material), qty
//     comes from the line, prices the delta. [Interim: uses the split-spec +
//     unit-cost-delta backing; the full composer slot integration — true slot
//     defs, per-slot rate-book options, automatic labor delta, "+ Add new" —
//     is the next slice.]
//   CUSTOM — free description, multiple material lines (desc/qty/unit + vendor
//     checkbox = not in rate book), labor hours by dept; client price = cost
//     through project margins, editable. $0 = documentation only.
//
// Both produce one CO (createChangeOrderV2) → normal lifecycle. "No charge"
// forces $0; "Drawing revision required" flagged. V1: whole-line, one change.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import {
  computeCoClientPrice,
  createChangeOrderV2,
  finalizeFreeCo,
  listCoMaterials,
  type CoMaterial,
  type PricingInputs,
  type ChangeOrder,
} from '@/lib/change-orders'
import { LABOR_DEPTS, LABOR_DEPT_LABEL, type LaborDept } from '@/lib/rate-book-seed'
import type { ComposerRateBook, ComposerDefaults, ComposerSlots } from '@/lib/composer'
import type { ProductKey } from '@/lib/products'
import SlotCoEditor, { type SlotCoResult } from '@/components/changeorders/SlotCoEditor'

export interface CoSpecLine {
  id: string
  label: string
  qty: number
  unitCost: number
  /** Composer lines carry these → slot-aware spec editing; null otherwise. */
  productKey: ProductKey | null
  productSlots: ComposerSlots | null
}

interface Props {
  projectId: string
  subprojectId: string
  subprojectName: string
  orgId: string
  specLines: CoSpecLine[]
  pricing: PricingInputs
  composerRateBook?: ComposerRateBook | null
  composerDefaults?: ComposerDefaults | null
  onClose: () => void
  onCreated: (co: ChangeOrder) => void
}

type Mode = 'spec' | 'custom'
interface MaterialLine {
  desc: string
  qty: string
  unitCost: string
  vendor: boolean
}

function moneyParse(s: string): number {
  const n = parseFloat(s.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function numParse(s: string): number {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}
const emptyHours: Record<LaborDept, string> = { eng: '', cnc: '', assembly: '', finish: '', install: '' }

export default function CreateChangeOrderModal({
  projectId,
  subprojectId,
  subprojectName,
  orgId,
  specLines,
  pricing,
  composerRateBook,
  composerDefaults,
  onClose,
  onCreated,
}: Props) {
  const [mode, setMode] = useState<Mode>('spec')
  const [slotResult, setSlotResult] = useState<SlotCoResult | null>(null)

  // ── Spec mode ──
  const [specLineId, setSpecLineId] = useState(specLines[0]?.id ?? '')
  const [materialQuery, setMaterialQuery] = useState('')
  const [materials, setMaterials] = useState<CoMaterial[]>([])
  const [showMatList, setShowMatList] = useState(false)
  const [newUnitStr, setNewUnitStr] = useState('')
  const [qty, setQty] = useState('1')
  const matBoxRef = useRef<HTMLDivElement>(null)

  // ── Custom mode ──
  const [customDesc, setCustomDesc] = useState('')
  const [vendorItems, setVendorItems] = useState(true)
  const [matLines, setMatLines] = useState<MaterialLine[]>([
    { desc: '', qty: '1', unitCost: '', vendor: true },
  ])
  const [hours, setHours] = useState<Record<LaborDept, string>>(emptyHours)

  // ── Shared ──
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [drawingRev, setDrawingRev] = useState(false)
  const [noCharge, setNoCharge] = useState(false)
  const [priceInput, setPriceInput] = useState('')
  const [priceTouched, setPriceTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listCoMaterials(orgId).then(setMaterials)
  }, [orgId])
  useEffect(() => {
    const line = specLines.find((s) => s.id === specLineId)
    if (line) setQty(String(line.qty))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specLineId])
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (matBoxRef.current && !matBoxRef.current.contains(e.target as Node)) setShowMatList(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // ── Spec-mode math ──
  const selectedLine = specLines.find((s) => s.id === specLineId)
  // Composer lines with a loaded rate book → slot-aware editing (the meaty
  // path). Otherwise the interim material-unit-cost delta.
  const useSlotEditor = !!(
    selectedLine?.productKey &&
    selectedLine?.productSlots &&
    composerRateBook &&
    composerDefaults
  )
  const oldUnit = selectedLine?.unitCost ?? 0
  const qtyN = numParse(qty) || 1
  const newUnit = moneyParse(newUnitStr)
  const specMaterialCost = (newUnit - oldUnit) * qtyN

  // ── Custom-mode math ──
  const customMaterialCost = matLines.reduce((s, m) => s + numParse(m.qty) * moneyParse(m.unitCost), 0)
  const customHours = LABOR_DEPTS.reduce((s, d) => s + numParse(hours[d]), 0)
  const customLaborCost = customHours * (Number(pricing.shopRate) || 0)

  const materialCost = mode === 'spec' ? (useSlotEditor ? slotResult?.materialDelta ?? 0 : specMaterialCost) : customMaterialCost
  const laborCost = mode === 'spec' ? (useSlotEditor ? slotResult?.laborDelta ?? 0 : 0) : customLaborCost
  const suggested = useMemo(() => {
    if (mode === 'spec' && useSlotEditor) return slotResult?.clientPrice ?? 0
    return computeCoClientPrice(materialCost, laborCost, pricing)
  }, [mode, useSlotEditor, slotResult, materialCost, laborCost, pricing])
  useEffect(() => {
    if (!priceTouched) setPriceInput(suggested ? String(suggested) : '')
  }, [suggested, priceTouched])

  const clientPrice = noCharge ? 0 : priceTouched ? moneyParse(priceInput) : suggested

  // Auto title (unless the user edited it).
  const autoTitle = useMemo(() => {
    if (mode === 'spec' && useSlotEditor) {
      return slotResult?.title || `Change: ${selectedLine?.label ?? 'Spec'}`
    }
    if (mode === 'spec') {
      const spec = selectedLine?.label ?? 'Spec'
      return materialQuery.trim() ? `${spec} → ${materialQuery.trim()}` : `Change: ${spec}`
    }
    return customDesc.trim() ? `Custom: ${customDesc.trim()}` : 'Custom change'
  }, [mode, useSlotEditor, slotResult, selectedLine, materialQuery, customDesc])
  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle)
  }, [autoTitle, titleTouched])

  const matMatches = useMemo(() => {
    const q = materialQuery.trim().toLowerCase()
    if (!q) return materials.slice(0, 8)
    return materials.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8)
  }, [materials, materialQuery])

  async function handleSave() {
    if (mode === 'spec') {
      if (!specLineId) {
        setError('Pick the spec line.')
        return
      }
      if (useSlotEditor && !slotResult) {
        setError('Pick what’s changing and a proposed value.')
        return
      }
      if (!useSlotEditor && !materialQuery.trim()) {
        setError('Enter the new material.')
        return
      }
    }
    if (mode === 'custom' && !customDesc.trim()) {
      setError('Describe the change.')
      return
    }
    setSaving(true)
    setError(null)
    const deptHours: Record<string, number> = {}
    if (mode === 'custom') for (const d of LABOR_DEPTS) deptHours[`labor_hours_${d}`] = numParse(hours[d])
    const proposed =
      mode === 'custom'
        ? {
            material: customDesc.trim(),
            notes: JSON.stringify({
              materials: matLines
                .filter((m) => m.desc.trim())
                .map((m) => ({
                  desc: m.desc.trim(),
                  qty: numParse(m.qty),
                  unit_cost: moneyParse(m.unitCost),
                  vendor: vendorItems,
                })),
            }),
            ...deptHours,
          }
        : useSlotEditor && slotResult
          ? { material: `${slotResult.slotLabel}: ${slotResult.propLabel}` }
          : { material: materialQuery.trim(), quantity: qtyN, material_cost_per_lf: newUnit }
    const original =
      mode === 'spec'
        ? useSlotEditor && slotResult
          ? { label: selectedLine?.label ?? '', material: `${slotResult.slotLabel}: ${slotResult.origLabel}`, notes: specLineId }
          : { label: selectedLine?.label ?? '', notes: specLineId }
        : {}
    const co = await createChangeOrderV2({
      project_id: projectId,
      subproject_id: subprojectId,
      title: title.trim() || autoTitle,
      original_line_snapshot: original,
      proposed_line: proposed,
      material_cost: materialCost,
      labor_cost: laborCost,
      client_price: clientPrice,
      internal_cost_delta: noCharge ? materialCost + laborCost : null,
      drawing_revision_required: drawingRev,
    })
    if (!co) {
      setSaving(false)
      setError('Could not create the change order.')
      return
    }
    // Step 3 — free path: a $0 CO needs no client approval and no invoice. It
    // propagates immediately (spec flip + approval card; drawing flag already
    // stored) instead of sitting in draft for the Send/Accept lifecycle.
    if (clientPrice === 0) {
      try {
        await finalizeFreeCo(co.id)
        co.state = 'approved'
      } catch (err) {
        // Non-fatal: the CO row exists either way. Log and still hand back.
        console.error('finalizeFreeCo', err)
      }
    }
    onCreated(co)
  }

  // ── styles ──
  const cLabel = 'text-[11px] text-[#6B7280] mb-0.5'
  const caps = 'text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider'
  const field =
    'w-full box-border text-[13px] px-2.5 py-2 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center px-4 py-12 overflow-y-auto"
      onClick={onClose}
    >
      <div className="w-full max-w-[560px] bg-white rounded-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div>
            <div className="text-[16px] font-semibold text-[#111]">New change order</div>
            <div className="text-[12px] text-[#6B7280]">{subprojectName}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-[#F3F4F6] rounded-lg p-0.5 mx-5 my-3.5">
          {(['spec', 'custom'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 text-[13px] py-1.5 rounded-md transition-colors ${
                mode === m ? 'bg-white text-[#111] shadow-sm font-medium' : 'text-[#6B7280]'
              }`}
            >
              {m === 'spec' ? 'Spec change' : 'Custom'}
            </button>
          ))}
        </div>

        {/* ── SPEC MODE ── */}
        {mode === 'spec' && (
          <div className="px-5">
            <div className="bg-[#F3F4F6] rounded-lg px-3 py-2.5 mb-3">
              <div className={caps}>Changing</div>
              <div className="text-[13px] font-semibold text-[#111] mt-0.5">
                {selectedLine?.label ?? '—'}
                {selectedLine ? <span className="text-[#6B7280] font-normal"> · qty {selectedLine.qty}</span> : null}
              </div>
            </div>
            <div className="mb-2.5">
              <div className={cLabel}>Spec line</div>
              <select
                value={specLineId}
                onChange={(e) => {
                  setSpecLineId(e.target.value)
                  setSlotResult(null)
                }}
                className={`${field} bg-white`}
              >
                {specLines.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {useSlotEditor && selectedLine ? (
              <SlotCoEditor
                key={selectedLine.id}
                orgId={orgId}
                productKey={selectedLine.productKey!}
                qty={selectedLine.qty}
                productSlots={selectedLine.productSlots!}
                rateBook={composerRateBook!}
                defaults={composerDefaults!}
                pricing={pricing}
                onChange={setSlotResult}
              />
            ) : (
              <>
                <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2 mb-2.5">
                  <div>
                    <div className={cLabel}>Original</div>
                    <input value={selectedLine?.label ?? ''} disabled className={`${field} bg-[#F9FAFB] text-[#6B7280]`} />
                  </div>
                  <div className="text-center pb-2 text-[#9CA3AF]">→</div>
                  <div ref={matBoxRef} className="relative">
                    <div className={cLabel}>Proposed</div>
                    <input
                      value={materialQuery}
                      onChange={(e) => {
                        setMaterialQuery(e.target.value)
                        setShowMatList(true)
                      }}
                      onFocus={() => setShowMatList(true)}
                      placeholder="Type a material…"
                      className={field}
                    />
                    {showMatList && matMatches.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {matMatches.map((m) => (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => {
                              setMaterialQuery(m.name)
                              if (m.costPerLf > 0) setNewUnitStr(String(m.costPerLf))
                              setShowMatList(false)
                            }}
                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#F9FAFB] flex justify-between gap-3"
                          >
                            <span className="text-[#111] truncate">{m.name}</span>
                            {m.costPerLf > 0 && (
                              <span className="text-[11px] font-mono text-[#9CA3AF]">${m.costPerLf}/lf</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <div>
                    <div className={cLabel}>Qty (from line)</div>
                    <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={`${field} font-mono text-right`} />
                  </div>
                  <div>
                    <div className={cLabel}>New unit cost ($)</div>
                    <input value={newUnitStr} onChange={(e) => setNewUnitStr(e.target.value)} inputMode="decimal" placeholder="0" className={`${field} font-mono text-right`} />
                    <div className="text-[10.5px] text-[#9CA3AF] mt-0.5">current: ${oldUnit.toLocaleString()}/unit</div>
                  </div>
                </div>
                <div className="flex justify-between items-center bg-[#E1F5EE] rounded-lg px-3.5 py-2.5 mb-3">
                  <span className="text-[12px] text-[#0F6E56]">Material change · qty from line</span>
                  <span className="text-[16px] font-semibold font-mono text-[#04342C]">
                    {specMaterialCost < 0 ? '−' : '+'}${Math.abs(Math.round(specMaterialCost)).toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CUSTOM MODE ── */}
        {mode === 'custom' && (
          <div className="px-5">
            <div className="mb-3">
              <div className={cLabel}>What’s the change?</div>
              <input
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="e.g. Client-supplied brass rail, vendor cost update"
                className={field}
              />
            </div>
            <div className={`${caps} mb-1.5`}>Materials</div>
            {matLines.map((m, i) => (
              <div key={i} className="grid grid-cols-[2fr_56px_84px_24px] items-center gap-2 mb-1.5">
                <input
                  value={m.desc}
                  onChange={(e) => setMatLines((L) => L.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
                  placeholder="Material — vendor"
                  className="text-[12px] px-2 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                />
                <input
                  value={m.qty}
                  onChange={(e) => setMatLines((L) => L.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  className="text-[12px] text-center px-1 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                />
                <input
                  value={m.unitCost}
                  onChange={(e) => setMatLines((L) => L.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))}
                  placeholder="$0"
                  className="text-[12px] text-right px-2 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none font-mono"
                />
                <button
                  type="button"
                  onClick={() => setMatLines((L) => (L.length > 1 ? L.filter((_, j) => j !== i) : L))}
                  className="text-[#9CA3AF] hover:text-[#DC2626]"
                  aria-label="Remove material"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3 mb-3">
              <button
                type="button"
                onClick={() => setMatLines((L) => [...L, { desc: '', qty: '1', unitCost: '', vendor: true }])}
                className="text-[12px] px-2.5 py-1 border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB]"
              >
                + Material line
              </button>
              <label className="flex items-center gap-1.5 text-[12px] text-[#6B7280] cursor-pointer">
                <input type="checkbox" checked={vendorItems} onChange={(e) => setVendorItems(e.target.checked)} className="accent-[#2563EB]" />
                Vendor item (not in rate book)
              </label>
              <span className="ml-auto text-[11px] text-[#9CA3AF] font-mono">
                = ${Math.round(customMaterialCost).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-baseline mb-1">
              <span className={caps}>Labor — hours by dept</span>
              <span className="text-[11px] font-mono text-[#6B7280]">
                {customHours.toFixed(1)} hr · ${Math.round(customLaborCost).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {LABOR_DEPTS.map((d) => (
                <div key={d}>
                  <div className="text-[9.5px] text-center text-[#9CA3AF] uppercase tracking-wider">{LABOR_DEPT_LABEL[d]}</div>
                  <input
                    value={hours[d]}
                    onChange={(e) => setHours((h) => ({ ...h, [d]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0"
                    className="mt-0.5 w-full text-[12px] text-center px-1 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none font-mono"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center bg-[#E1F5EE] rounded-lg px-3.5 py-2.5 mb-1">
              <span className="text-[12px] text-[#0F6E56]">Client price · through margins · editable</span>
              <div className="flex items-center gap-1">
                <span className="text-[#0F6E56] text-sm">$</span>
                <input
                  value={priceTouched ? priceInput : suggested ? String(suggested) : ''}
                  onChange={(e) => {
                    setPriceTouched(true)
                    setPriceInput(e.target.value)
                  }}
                  disabled={noCharge}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-24 text-right text-[15px] font-semibold font-mono px-2 py-1 border border-[#BBE6D8] rounded-md focus:outline-none bg-white disabled:opacity-50"
                />
              </div>
            </div>
            <div className="text-[11px] text-[#9CA3AF] mb-3">
              $0 = documentation only. Vendor items don’t enter the rate book; dept hours flow to schedule on accept.
            </div>
          </div>
        )}

        {/* Shared */}
        <div className="border-t border-[#E5E7EB] mx-5 pt-3">
          <div className="mb-3">
            <div className={cLabel}>Title (auto)</div>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
              className={field}
            />
          </div>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-1.5 text-[12px] text-[#6B7280] cursor-pointer">
              <input type="checkbox" checked={drawingRev} onChange={(e) => setDrawingRev(e.target.checked)} className="accent-[#2563EB]" />
              Drawing revision required
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-[#6B7280] cursor-pointer">
              <input type="checkbox" checked={noCharge} onChange={(e) => setNoCharge(e.target.checked)} className="accent-[#2563EB]" />
              No charge
            </label>
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3.5 border-t border-[#E5E7EB]">
          <span className="text-[13px] font-mono font-semibold text-[#0F6E56]">
            Net change {clientPrice < 0 ? '−' : '+'}${Math.abs(Math.round(clientPrice)).toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="text-[13px] px-3.5 py-2 border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[13px] px-3.5 py-2 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] font-medium rounded-lg hover:bg-[#DBEAFE] disabled:opacity-50"
            >
              {saving ? 'Creating…' : clientPrice === 0 ? 'Create & apply' : 'Create as draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

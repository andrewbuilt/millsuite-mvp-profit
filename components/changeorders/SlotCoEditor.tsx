'use client'

// ============================================================================
// SlotCoEditor — composer-slot spec-change editor for the CO modal.
// ============================================================================
// The "meaty piece" of spec-change mode: for a composer line, pick WHICH slot
// is changing (derived from the product's slots — drawers included), see the
// current value (read-only), pick the proposed value from the rate-book options
// for that slot, and the net change is real composer math. Original + proposed
// are priced with computeBreakdown; the client price is the cost delta run
// through the project margins (computeCoClientPrice), matching the bid.
//
// "+ Add new" (composer add-material flow that writes the rate book) is not
// wired yet — for now proposed values come from the existing rate-book options.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import {
  computeBreakdown,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerRateBook,
  type ComposerSlots,
} from '@/lib/composer'
import type { ProductKey } from '@/lib/products'
import { computeCoClientPrice, type PricingInputs } from '@/lib/change-orders'
import { loadComposerRateBook } from '@/lib/composer-loader'
import { createMaterial } from '@/lib/materials'
import {
  createDoorTypeMaterial,
  createDoorTypeMaterialFinish,
  type DoorMaterialCostUnit,
} from '@/lib/door-types'

type SlotKey =
  | 'qty'
  | 'carcassMaterial'
  | 'doorTypeId'
  | 'doorMaterialId'
  | 'doorFinishId'
  | 'interiorFinish'
  | 'drawerStyle'
  | 'drawerCount'
  | 'endPanels'
  | 'fillers'

const SLOT_LABELS: Record<SlotKey, string> = {
  qty: 'Quantity (LF)',
  carcassMaterial: 'Carcass material',
  doorTypeId: 'Door type',
  doorMaterialId: 'Door material',
  doorFinishId: 'Door finish',
  interiorFinish: 'Interior finish',
  drawerStyle: 'Drawer type',
  drawerCount: 'Drawer count',
  endPanels: 'End panels (count)',
  fillers: 'Fillers (count)',
}
const NUMERIC_SLOTS: SlotKey[] = ['qty', 'drawerCount', 'endPanels', 'fillers']
const PREFINISHED_FINISH_ID = 'prefinished'

export interface SlotCoResult {
  slotKey: SlotKey
  slotLabel: string
  origLabel: string
  propLabel: string
  materialDelta: number
  laborDelta: number
  clientPrice: number
  title: string
}

function slotOptions(slotKey: SlotKey, rb: ComposerRateBook): Array<{ id: string; name: string }> {
  switch (slotKey) {
    case 'carcassMaterial':
      return rb.carcassMaterials.map((m) => ({ id: m.id, name: m.name }))
    case 'doorTypeId':
      return rb.doorTypes.map((d) => ({ id: d.id, name: d.name }))
    case 'doorMaterialId':
      return rb.doorTypeMaterials.map((m) => ({ id: m.id, name: m.material_name }))
    case 'doorFinishId':
      return rb.doorTypeMaterialFinishes.map((f) => ({ id: f.id, name: f.finish_name }))
    case 'interiorFinish':
      return rb.finishes.filter((f) => f.application === 'interior').map((f) => ({ id: f.id, name: f.name }))
    case 'drawerStyle':
      return rb.drawerStyles.map((d) => ({ id: d.id, name: d.name }))
    default:
      return []
  }
}

function slotValueLabel(slotKey: SlotKey, slots: ComposerSlots, qty: number, rb: ComposerRateBook): string {
  switch (slotKey) {
    case 'qty':
      return `${qty} LF`
    case 'carcassMaterial':
      return rb.carcassMaterials.find((m) => m.id === slots.carcassMaterial)?.name || '(none)'
    case 'doorTypeId':
      return rb.doorTypes.find((t) => t.id === slots.doorTypeId)?.name || '(none)'
    case 'doorMaterialId':
      return rb.doorTypeMaterials.find((m) => m.id === slots.doorMaterialId)?.material_name || '(none)'
    case 'doorFinishId':
      return rb.doorTypeMaterialFinishes.find((f) => f.id === slots.doorFinishId)?.finish_name || '(none)'
    case 'interiorFinish':
      if (slots.interiorFinish === PREFINISHED_FINISH_ID) return 'Prefinished'
      return rb.finishes.find((f) => f.id === slots.interiorFinish)?.name || '(none)'
    case 'drawerStyle':
      return rb.drawerStyles.find((d) => d.id === slots.drawerStyle)?.name || '(none)'
    case 'drawerCount':
      return `${slots.drawerCount} drawers`
    case 'endPanels':
      return `${slots.endPanels} each`
    case 'fillers':
      return `${slots.fillers} each`
  }
}

const ADD_NEW = '__add_new__'
// Slots whose "+ Add new" writes to the rate book (material / finish swaps).
const ADDABLE: SlotKey[] = ['carcassMaterial', 'doorMaterialId', 'doorFinishId']

export default function SlotCoEditor({
  orgId,
  productKey,
  qty,
  productSlots,
  rateBook,
  defaults,
  pricing,
  onChange,
}: {
  orgId: string
  productKey: ProductKey
  qty: number
  productSlots: ComposerSlots
  rateBook: ComposerRateBook
  defaults: ComposerDefaults
  pricing: PricingInputs
  onChange: (result: SlotCoResult | null) => void
}) {
  // Local rate book so "+ Add new" can refresh it after writing a material.
  const [rb, setRb] = useState(rateBook)
  useEffect(() => setRb(rateBook), [rateBook])

  const [slotKey, setSlotKey] = useState<SlotKey | ''>('')
  const [proposed, setProposed] = useState('')
  // "+ Add new" inline form state.
  const [addName, setAddName] = useState('')
  const [addA, setAddA] = useState('') // cost/sheet-cost/labor-per-door
  const [addB, setAddB] = useState('') // sheets-per-lf / material-per-door
  const [addUnit, setAddUnit] = useState<DoorMaterialCostUnit>('lf')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const adding = proposed === ADD_NEW

  const originalDraft: ComposerDraft = useMemo(
    () => ({ productId: productKey, qty, slots: productSlots }),
    [productKey, qty, productSlots],
  )
  const proposedDraft: ComposerDraft | null = useMemo(() => {
    if (!slotKey || proposed === '' || proposed === ADD_NEW) return null
    if (slotKey === 'qty') {
      const n = Number(proposed)
      return Number.isFinite(n) && n > 0 ? { ...originalDraft, qty: n } : null
    }
    if (NUMERIC_SLOTS.includes(slotKey)) {
      const n = Number(proposed)
      if (!Number.isFinite(n) || n < 0) return null
      return { ...originalDraft, slots: { ...originalDraft.slots, [slotKey]: Math.round(n) } }
    }
    return { ...originalDraft, slots: { ...originalDraft.slots, [slotKey]: proposed } }
  }, [slotKey, proposed, originalDraft])

  const origBd = useMemo(() => computeBreakdown(originalDraft, rb, defaults), [originalDraft, rb, defaults])
  const propBd = useMemo(
    () => (proposedDraft ? computeBreakdown(proposedDraft, rb, defaults) : null),
    [proposedDraft, rb, defaults],
  )

  const materialDelta = propBd ? propBd.materialSubtotal - origBd.materialSubtotal : 0
  const laborDelta = propBd ? propBd.totals.labor - origBd.totals.labor : 0
  const clientPrice = useMemo(
    () => (propBd ? computeCoClientPrice(materialDelta, laborDelta, pricing) : 0),
    [propBd, materialDelta, laborDelta, pricing],
  )

  const origLabel = slotKey ? slotValueLabel(slotKey, productSlots, qty, rb) : ''
  const propLabel =
    slotKey && proposedDraft ? slotValueLabel(slotKey, proposedDraft.slots, proposedDraft.qty, rb) : ''

  // ── "+ Add new" → create the material in the rate book, reload, select it ──
  async function handleAddNew() {
    if (!slotKey || !ADDABLE.includes(slotKey)) return
    if (!addName.trim()) {
      setAddError('Name is required.')
      return
    }
    setAddSaving(true)
    setAddError(null)
    try {
      let newId = ''
      if (slotKey === 'carcassMaterial') {
        // Catalog-native (chunk B): carcass material = a catalog row flagged
        // show_in_carcass. newId is the catalog id the composer resolves against.
        const m = await createMaterial({
          org_id: orgId,
          name: addName.trim(),
          cost_value: Number(addA) || 0,
          cost_unit: 'sheet',
          show_in_carcass: true,
        })
        newId = m.id
      } else if (slotKey === 'doorMaterialId') {
        if (!productSlots.doorTypeId) throw new Error('This line has no door type to scope the material to.')
        const m = await createDoorTypeMaterial({
          org_id: orgId,
          door_type_id: productSlots.doorTypeId,
          material_name: addName.trim(),
          cost_value: Number(addA) || 0,
          cost_unit: addUnit,
        })
        newId = m?.id ?? ''
      } else if (slotKey === 'doorFinishId') {
        if (!productSlots.doorMaterialId) throw new Error('This line has no door material to scope the finish to.')
        const f = await createDoorTypeMaterialFinish({
          org_id: orgId,
          door_type_material_id: productSlots.doorMaterialId,
          finish_name: addName.trim(),
          labor_hours_per_door: Number(addA) || 0,
          material_per_door: Number(addB) || 0,
        })
        newId = f?.id ?? ''
      }
      const fresh = await loadComposerRateBook(orgId)
      setRb(fresh)
      setProposed(newId)
      setAddName('')
      setAddA('')
      setAddB('')
    } catch (err: any) {
      setAddError(err?.message || 'Could not add to the rate book.')
    } finally {
      setAddSaving(false)
    }
  }

  // Emit the result up whenever it's complete.
  useEffect(() => {
    if (slotKey && proposedDraft && propLabel) {
      onChange({
        slotKey,
        slotLabel: SLOT_LABELS[slotKey],
        origLabel,
        propLabel,
        materialDelta,
        laborDelta,
        clientPrice,
        title: `${SLOT_LABELS[slotKey]}: ${origLabel} → ${propLabel}`,
      })
    } else {
      onChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, proposed, clientPrice])

  const cLabel = 'text-[11px] text-[#6B7280] mb-0.5'
  const field =
    'w-full box-border text-[13px] px-2.5 py-2 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none'
  const isNumeric = slotKey ? NUMERIC_SLOTS.includes(slotKey) : false

  return (
    <>
      <div className="mb-2.5">
        <div className={cLabel}>
          What’s changing? <span className="text-[#9CA3AF]">— from the product’s slots</span>
        </div>
        <select
          value={slotKey}
          onChange={(e) => {
            setSlotKey(e.target.value as SlotKey)
            setProposed('')
          }}
          className={`${field} bg-white`}
        >
          <option value="">Pick a spec…</option>
          {(Object.keys(SLOT_LABELS) as SlotKey[]).map((k) => (
            <option key={k} value={k}>
              {SLOT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {slotKey && (
        <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2 mb-2.5">
          <div>
            <div className={cLabel}>Original</div>
            <input value={origLabel} disabled className={`${field} bg-[#F9FAFB] text-[#6B7280]`} />
          </div>
          <div className="text-center pb-2 text-[#9CA3AF]">→</div>
          <div>
            <div className={cLabel}>Proposed</div>
            {isNumeric ? (
              <input
                type="number"
                min="0"
                step={slotKey === 'qty' ? '0.5' : '1'}
                value={proposed}
                onChange={(e) => setProposed(e.target.value)}
                placeholder={slotKey === 'qty' ? 'LF' : 'each'}
                className={field}
              />
            ) : (
              <select value={proposed} onChange={(e) => setProposed(e.target.value)} className={`${field} bg-white`}>
                <option value="">Pick…</option>
                {slotOptions(slotKey, rb).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                {ADDABLE.includes(slotKey) && <option value={ADD_NEW}>+ Add new (feeds rate book)</option>}
              </select>
            )}
          </div>
        </div>
      )}

      {/* "+ Add new" inline form — writes the material into the rate book. */}
      {slotKey && adding && ADDABLE.includes(slotKey) && (
        <div className="border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3 mb-3">
          <div className="text-[11px] font-semibold text-[#1D4ED8] uppercase tracking-wider mb-2">
            New {SLOT_LABELS[slotKey].toLowerCase()} → rate book
          </div>
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Name"
            className={`${field} mb-2`}
            autoFocus
          />
          {slotKey === 'carcassMaterial' && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={addA} onChange={(e) => setAddA(e.target.value)} inputMode="decimal" placeholder="Sheet cost $" className={`${field} font-mono text-right`} />
              <input value={addB} onChange={(e) => setAddB(e.target.value)} inputMode="decimal" placeholder="Sheets / LF" className={`${field} font-mono text-right`} />
            </div>
          )}
          {slotKey === 'doorMaterialId' && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={addA} onChange={(e) => setAddA(e.target.value)} inputMode="decimal" placeholder="Cost $" className={`${field} font-mono text-right`} />
              <select value={addUnit} onChange={(e) => setAddUnit(e.target.value as DoorMaterialCostUnit)} className={`${field} bg-white`}>
                {(['lf', 'sheet', 'bf', 'ea', 'lump'] as DoorMaterialCostUnit[]).map((u) => (
                  <option key={u} value={u}>
                    per {u}
                  </option>
                ))}
              </select>
            </div>
          )}
          {slotKey === 'doorFinishId' && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={addA} onChange={(e) => setAddA(e.target.value)} inputMode="decimal" placeholder="Labor hr / door" className={`${field} font-mono text-right`} />
              <input value={addB} onChange={(e) => setAddB(e.target.value)} inputMode="decimal" placeholder="Material $ / door" className={`${field} font-mono text-right`} />
            </div>
          )}
          {addError && <div className="text-[11px] text-[#B91C1C] mb-2">{addError}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setProposed('')}
              className="text-[12px] px-3 py-1.5 border border-[#E5E7EB] bg-white rounded-lg hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddNew}
              disabled={addSaving}
              className="text-[12px] px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {addSaving ? 'Adding…' : 'Add to rate book'}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center bg-[#E1F5EE] rounded-lg px-3.5 py-2.5 mb-3">
        <span className="text-[12px] text-[#0F6E56]">Net change · composer math · qty from line</span>
        <span className="text-[16px] font-semibold font-mono text-[#04342C]">
          {clientPrice < 0 ? '−' : '+'}${Math.abs(Math.round(clientPrice)).toLocaleString()}
        </span>
      </div>
      <div className="text-[11px] text-[#9CA3AF] mb-3">Labor delta included automatically.</div>
    </>
  )
}

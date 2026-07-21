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

export default function SlotCoEditor({
  productKey,
  qty,
  productSlots,
  rateBook,
  defaults,
  pricing,
  onChange,
}: {
  productKey: ProductKey
  qty: number
  productSlots: ComposerSlots
  rateBook: ComposerRateBook
  defaults: ComposerDefaults
  pricing: PricingInputs
  onChange: (result: SlotCoResult | null) => void
}) {
  const [slotKey, setSlotKey] = useState<SlotKey | ''>('')
  const [proposed, setProposed] = useState('')

  const originalDraft: ComposerDraft = useMemo(
    () => ({ productId: productKey, qty, slots: productSlots }),
    [productKey, qty, productSlots],
  )
  const proposedDraft: ComposerDraft | null = useMemo(() => {
    if (!slotKey || proposed === '') return null
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

  const origBd = useMemo(() => computeBreakdown(originalDraft, rateBook, defaults), [originalDraft, rateBook, defaults])
  const propBd = useMemo(
    () => (proposedDraft ? computeBreakdown(proposedDraft, rateBook, defaults) : null),
    [proposedDraft, rateBook, defaults],
  )

  const materialDelta = propBd ? propBd.materialSubtotal - origBd.materialSubtotal : 0
  const laborDelta = propBd ? propBd.totals.labor - origBd.totals.labor : 0
  const clientPrice = useMemo(
    () => (propBd ? computeCoClientPrice(materialDelta, laborDelta, pricing) : 0),
    [propBd, materialDelta, laborDelta, pricing],
  )

  const origLabel = slotKey ? slotValueLabel(slotKey, productSlots, qty, rateBook) : ''
  const propLabel =
    slotKey && proposedDraft ? slotValueLabel(slotKey, proposedDraft.slots, proposedDraft.qty, rateBook) : ''

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
                {slotOptions(slotKey, rateBook).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
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

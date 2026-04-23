'use client'

// ============================================================================
// AddLineComposer — add-line flow for the subproject editor.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 6 + specs/add-line-composer/index.html.
//
// Structure:
//   1. Product picker — 6 tiles. Base/Upper/Full active. Drawer/LED stub.
//      Countertop locked.
//   2. Composer — once a product is picked, slot UI on the left + live
//      breakdown on the right.
//   3. Save — writes one estimate_lines row via saveComposerLine; updates
//      orgs.last_used_slots_by_product for the product.
//
// Renders as a full-screen modal owned by the subproject editor. onCancel
// resets state cleanly (picker view, no draft, no open dropdowns, no
// add-new card). onLineSaved notifies the parent to refetch + close.
//
// Data load: one shot on mount via loadComposerRateBook + a fresh read of
// orgs.last_used_slots_by_product (spec explicitly says no stale cache).
// Subproject defaults are loaded in parallel; missing values fall back to
// the initialSubprojectDefaults helper.
//
// Uncalibrated posture:
//   - carcass labor uncalibrated (Base cabinet item missing or zero) →
//     full-panel warning strip, composer is view-only, save blocked
//   - door style uncalibrated → DoorStyleWalkthrough (item 7). Mini-card
//     mode for partial gaps, full modal for new/all-zero. On save, rate
//     book refetches and the newly-calibrated style auto-selects.
//   - finish uncalibrated for this product → FinishWalkthrough (item 8).
//     Single walkthrough with 4 collapsible combo rows × 3 cab-height
//     cards each. Fires from "+ Calibrate finishes" in the dropdown or
//     the empty-state button. On close, rate book refetches; user picks
//     the newly-calibrated finish from the dropdown.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  PRODUCT_ORDER,
  PRODUCTS,
  type Product,
  type ProductKey,
} from '@/lib/products'
import {
  computeBreakdown,
  checkSaveGate,
  emptySlots,
  type ComposerBreakdown,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerRateBook,
} from '@/lib/composer'
import { loadComposerRateBook } from '@/lib/composer-loader'
import {
  initialSubprojectDefaults,
  loadLastUsedByProduct,
  loadSubprojectDefaults,
  saveComposerLine,
  saveLastUsedForProduct,
  saveSubprojectDefaults,
  type LastUsedPerProduct,
} from '@/lib/composer-persist'
import {
  createCarcassMaterial,
  createExtMaterial,
} from '@/lib/rate-book-materials'
import DoorStyleWalkthrough, {
  type DoorStyleWalkthroughExistingStyle,
} from '@/components/walkthroughs/DoorStyleWalkthrough'
import FinishWalkthrough from '@/components/walkthroughs/FinishWalkthrough'

interface Props {
  subprojectId: string
  orgId: string
  /** Current org.consumable_markup_pct — used for the "no subproject
   *  defaults row yet" fallback. */
  orgConsumablePct: number | null
  onLineSaved: () => void
  onCancel: () => void
}

type View = 'picker' | 'composer'

type AddNewMaterialCategory = 'carcass' | 'ext'

interface AddNewContext {
  category: AddNewMaterialCategory
  draftName: string
  draftSheetCost: string
  draftSheetsPerLf: string
}

export default function AddLineComposer({
  subprojectId,
  orgId,
  orgConsumablePct,
  onLineSaved,
  onCancel,
}: Props) {
  // ── Data load ──
  const [rateBook, setRateBook] = useState<ComposerRateBook | null>(null)
  const [defaults, setDefaults] = useState<ComposerDefaults | null>(null)
  const [lastUsed, setLastUsed] = useState<Record<ProductKey, LastUsedPerProduct>>({} as Record<ProductKey, LastUsedPerProduct>)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [rb, lu, sd] = await Promise.all([
          loadComposerRateBook(orgId),
          loadLastUsedByProduct(orgId),
          loadSubprojectDefaults(subprojectId),
        ])
        if (cancelled) return
        setRateBook(rb)
        setLastUsed(lu)
        setDefaults(sd ?? initialSubprojectDefaults(orgConsumablePct))
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Failed to load rate book')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, subprojectId, orgConsumablePct])

  // ── View state ──
  const [view, setView] = useState<View>('picker')
  const [draft, setDraft] = useState<ComposerDraft | null>(null)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [addNew, setAddNew] = useState<{ slotKey: string; ctx: AddNewContext } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Door walkthrough overlay — either { style } for an existing
  // uncalibrated style, or { style: null } for the "+ Add new" path.
  const [doorWt, setDoorWt] = useState<
    | { style: DoorStyleWalkthroughExistingStyle | null }
    | null
  >(null)
  // Finish walkthrough overlay — single instance, no per-finish config.
  const [finishWtOpen, setFinishWtOpen] = useState(false)

  function resetState() {
    setView('picker')
    setDraft(null)
    setOpenDropdown(null)
    setAddNew(null)
    setSaveError(null)
    setDoorWt(null)
    setFinishWtOpen(false)
  }

  async function refreshRateBook() {
    try {
      const rb = await loadComposerRateBook(orgId)
      setRateBook(rb)
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to refresh rate book')
    }
  }

  function openDoorWalkthroughForPick(styleId: string) {
    if (!rateBook) return
    const ds = rateBook.doorStyles.find((d) => d.id === styleId)
    if (!ds) return
    setOpenDropdown(null)
    setDoorWt({
      style: { id: ds.id, name: ds.name, labor: ds.labor },
    })
  }

  function openDoorWalkthroughForNew() {
    setOpenDropdown(null)
    setDoorWt({ style: null })
  }

  async function handleDoorWalkthroughComplete(styleId: string) {
    setDoorWt(null)
    await refreshRateBook()
    // Select the calibrated (or newly-created) style on the draft.
    setDraft((prev) =>
      prev ? { ...prev, slots: { ...prev.slots, doorStyle: styleId } } : prev
    )
  }

  function openFinishWalkthrough() {
    setOpenDropdown(null)
    setFinishWtOpen(true)
  }
  async function handleFinishWalkthroughComplete() {
    setFinishWtOpen(false)
    await refreshRateBook()
    // Don't auto-select anything — the user may have calibrated multiple
    // combos; they pick from the dropdown after the walkthrough closes.
  }

  const pickProduct = useCallback(
    (key: ProductKey) => {
      if (!rateBook) return
      const p = PRODUCTS[key]
      if (!p.active || p.locked) return

      const carry = lastUsed[key]
      const firstCarcass = rateBook.carcassMaterials[0]?.id ?? null
      const firstExt = rateBook.extMaterials[0]?.id ?? null
      const firstDoor = rateBook.doorStyles[0]?.id ?? null
      // Prefinished for interior if present; otherwise first finish.
      const prefinished = rateBook.finishes.find((f) => f.isPrefinished)?.id ?? null
      const firstFinish = rateBook.finishes[0]?.id ?? null
      const hardFallback = {
        carcassMaterial: firstCarcass,
        doorStyle: firstDoor,
        doorMaterial: firstExt,
        interiorFinish: prefinished ?? firstFinish,
        exteriorFinish: firstFinish,
        endPanels: 0,
        fillers: 0,
        notes: '',
      }

      const slots = carry
        ? { ...emptySlots(), ...hardFallback, ...carry.slots, endPanels: 0, fillers: 0, notes: '' }
        : { ...emptySlots(), ...hardFallback }
      const qty = carry?.qty || 8
      setDraft({ productId: key, qty, slots })
      setView('composer')
    },
    [rateBook, lastUsed]
  )

  // Reset everything on cancel per spec.
  const handleCancel = useCallback(() => {
    resetState()
    onCancel()
  }, [onCancel])

  // ── Breakdown (derived) ──
  const breakdown: ComposerBreakdown | null = useMemo(() => {
    if (!draft || !rateBook || !defaults) return null
    return computeBreakdown(draft, rateBook, defaults)
  }, [draft, rateBook, defaults])

  const gate = useMemo(() => {
    if (!draft || !rateBook) return { ok: false, reason: null }
    return checkSaveGate(draft, rateBook)
  }, [draft, rateBook])

  // ── Mutators ──

  function setDraftPatch(patch: Partial<ComposerDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }
  function setSlot<K extends keyof ComposerDraft['slots']>(key: K, value: ComposerDraft['slots'][K]) {
    setDraft((prev) => (prev ? { ...prev, slots: { ...prev.slots, [key]: value } } : prev))
  }

  function setDefaultsPct(key: 'consumablesPct' | 'wastePct', v: string) {
    const n = parseFloat(v)
    if (!Number.isFinite(n) || n < 0) return
    setDefaults((prev) => (prev ? { ...prev, [key]: n } : prev))
  }

  // Persist the % edit on blur (cheap; doesn't block typing).
  async function persistDefaults() {
    if (!defaults) return
    try {
      await saveSubprojectDefaults(subprojectId, defaults)
    } catch (err) {
      // Non-fatal: breakdown still reflects the value in memory.
      console.warn('persistDefaults', err)
    }
  }

  async function save() {
    if (!draft || !rateBook || !breakdown) return
    if (!gate.ok) {
      setSaveError(gate.reason)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await saveComposerLine({ subprojectId, draft, breakdown, rateBook })
      // Spec: every saved line updates the shop-wide last-used for its
      // product so the next line of the same type carries over.
      await saveLastUsedForProduct(orgId, draft.productId, {
        qty: draft.qty,
        slots: { ...draft.slots },
      })
      resetState()
      onLineSaved()
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save line')
    } finally {
      setSaving(false)
    }
  }

  // ── Add-new material inline card ──

  function openAddNew(slotKey: string, category: AddNewMaterialCategory) {
    setOpenDropdown(null)
    setAddNew({
      slotKey,
      ctx: { category, draftName: '', draftSheetCost: '', draftSheetsPerLf: '' },
    })
  }
  function setAddNewField<K extends keyof AddNewContext>(field: K, value: AddNewContext[K]) {
    setAddNew((prev) => (prev ? { ...prev, ctx: { ...prev.ctx, [field]: value } } : prev))
  }
  async function saveAddNew() {
    if (!addNew || !rateBook || !draft) return
    const { slotKey, ctx } = addNew
    const name = ctx.draftName.trim()
    const sheetCost = parseFloat(ctx.draftSheetCost)
    if (!name) {
      setSaveError('Give the material a name.')
      return
    }
    if (!Number.isFinite(sheetCost) || sheetCost <= 0) {
      setSaveError('Sheet cost needs a positive number.')
      return
    }
    try {
      if (ctx.category === 'carcass') {
        const sheetsPerLf = parseFloat(ctx.draftSheetsPerLf)
        if (!Number.isFinite(sheetsPerLf) || sheetsPerLf <= 0) {
          setSaveError('Sheets per LF needs a positive number.')
          return
        }
        const created = await createCarcassMaterial({
          org_id: orgId,
          name,
          sheet_cost: sheetCost,
          sheets_per_lf: sheetsPerLf,
        })
        if (created) {
          setRateBook({
            ...rateBook,
            carcassMaterials: [
              ...rateBook.carcassMaterials,
              {
                id: created.id,
                name: created.name,
                sheet_cost: Number(created.sheet_cost),
                sheets_per_lf: Number(created.sheets_per_lf),
              },
            ],
          })
          setSlot('carcassMaterial', created.id)
        }
      } else {
        const created = await createExtMaterial({
          org_id: orgId,
          name,
          sheet_cost: sheetCost,
        })
        if (created) {
          setRateBook({
            ...rateBook,
            extMaterials: [
              ...rateBook.extMaterials,
              {
                id: created.id,
                name: created.name,
                sheet_cost: Number(created.sheet_cost),
              },
            ],
          })
          setSlot(slotKey as 'doorMaterial', created.id)
        }
      }
      setAddNew(null)
      setSaveError(null)
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save material')
    }
  }

  // ── Render ──

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[95] bg-[#0F172A]/85 backdrop-blur-sm flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex flex-col items-center p-4 md:p-8">
        <div className="w-full max-w-[1100px] bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl text-[#e5e5e5] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
            <div className="text-[13px] font-semibold text-white">
              {view === 'picker' ? 'Add a line' : PRODUCTS[draft?.productId ?? 'base'].label}
            </div>
            <button
              onClick={handleCancel}
              className="p-1 text-[#6B7280] hover:text-white rounded"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            {loading ? (
              <div className="py-16 text-center text-[#9CA3AF]">Loading rate book…</div>
            ) : loadError ? (
              <div className="py-8 px-4 bg-[#1e1018] border border-[#3b1c24] rounded-xl text-[#fecaca] text-sm">
                {loadError}
              </div>
            ) : !rateBook || !defaults ? null : !rateBook.carcassCalibrated ? (
              <UncalibratedCarcassWarning />
            ) : view === 'picker' ? (
              <ProductPicker onPick={pickProduct} />
            ) : draft ? (
              <Composer
                draft={draft}
                breakdown={breakdown}
                rateBook={rateBook}
                defaults={defaults}
                openDropdown={openDropdown}
                addNew={addNew}
                saving={saving}
                saveError={saveError}
                gateReason={gate.ok ? null : gate.reason}
                canSave={gate.ok && !saving}
                onBack={() => setView('picker')}
                onCancel={handleCancel}
                onSave={save}
                setDraftPatch={setDraftPatch}
                setSlot={setSlot as (k: string, v: any) => void}
                setDefaultsPct={setDefaultsPct}
                persistDefaults={persistDefaults}
                toggleDropdown={(key) =>
                  setOpenDropdown((prev) => (prev === key ? null : key))
                }
                openAddNew={openAddNew}
                cancelAddNew={() => setAddNew(null)}
                setAddNewField={setAddNewField}
                saveAddNew={saveAddNew}
                onDoorUncalibratedPick={openDoorWalkthroughForPick}
                onAddNewDoorStyle={openDoorWalkthroughForNew}
                onOpenFinishWalkthrough={openFinishWalkthrough}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Door walkthrough overlay — sits above the composer modal. */}
      {doorWt && (
        <DoorStyleWalkthrough
          orgId={orgId}
          existingStyle={doorWt.style}
          onCancel={() => setDoorWt(null)}
          onComplete={handleDoorWalkthroughComplete}
        />
      )}

      {/* Finish walkthrough overlay — same layering as the door one. */}
      {finishWtOpen && (
        <FinishWalkthrough
          orgId={orgId}
          onCancel={() => setFinishWtOpen(false)}
          onComplete={handleFinishWalkthroughComplete}
        />
      )}
    </div>
  )
}

// ── Uncalibrated carcass warning (base calibration missing) ──

function UncalibratedCarcassWarning() {
  return (
    <div className="py-4 px-4 bg-[#201a0d] border border-[#3f320e] rounded-xl text-[#fde68a] text-[13px] leading-relaxed">
      <div className="font-semibold text-[14px] text-[#fbbf24] mb-1.5">
        Base cabinet calibration needed
      </div>
      The composer prices every line off your per-department base-cabinet labor.
      Run the base-cabinet walkthrough from Settings before you add a line — once it's
      saved, come back here and everything will light up.
    </div>
  )
}

// ── Product picker ──

function ProductPicker({ onPick }: { onPick: (key: ProductKey) => void }) {
  return (
    <>
      <div className="mb-5 text-[13px] text-[#9CA3AF] max-w-[640px]">
        Pick what you're pricing. Each product has its own slots — the composer
        walks you through them.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PRODUCT_ORDER.map((k) => {
          const p = PRODUCTS[k]
          return <ProductTile key={k} product={p} onPick={() => onPick(k)} />
        })}
      </div>
    </>
  )
}

function ProductTile({ product, onPick }: { product: Product; onPick: () => void }) {
  const isActive = product.active && !product.locked
  const statusText = product.locked ? 'Later' : product.active ? 'Ready' : 'Stub'
  const statusTone = product.locked
    ? 'bg-[#181818] text-[#888]'
    : product.active
    ? 'bg-[#0f1a2a] text-[#93c5fd] border-[#1e3a5c]'
    : 'bg-[#181818] text-[#aaa]'
  return (
    <button
      type="button"
      onClick={isActive ? onPick : undefined}
      disabled={!isActive}
      className={
        'text-left px-5 py-4 bg-[#111] border border-[#1a1a1a] rounded-xl flex items-start justify-between gap-3 transition-colors ' +
        (isActive
          ? 'hover:border-[#3b82f6] hover:bg-[#0f1a2a] cursor-pointer'
          : 'opacity-55 cursor-not-allowed')
      }
    >
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-white mb-1">
          {product.label}
          {product.descriptor && (
            <span className="ml-1.5 text-[#666] font-normal text-[12px]">
              · {product.descriptor}
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-[#666]">per {product.unit}</div>
      </div>
      <span
        className={
          'text-[10px] px-2 py-0.5 rounded-full border border-[#222] uppercase tracking-wider font-semibold ' +
          statusTone
        }
      >
        {statusText}
      </span>
    </button>
  )
}

// ── Composer body ──

function Composer(p: {
  draft: ComposerDraft
  breakdown: ComposerBreakdown | null
  rateBook: ComposerRateBook
  defaults: ComposerDefaults
  openDropdown: string | null
  addNew: { slotKey: string; ctx: AddNewContext } | null
  saving: boolean
  saveError: string | null
  gateReason: string | null
  canSave: boolean
  onBack: () => void
  onCancel: () => void
  onSave: () => void
  setDraftPatch: (patch: Partial<ComposerDraft>) => void
  setSlot: (key: string, value: any) => void
  setDefaultsPct: (key: 'consumablesPct' | 'wastePct', v: string) => void
  persistDefaults: () => void
  toggleDropdown: (key: string) => void
  openAddNew: (slotKey: string, category: AddNewMaterialCategory) => void
  cancelAddNew: () => void
  setAddNewField: <K extends keyof AddNewContext>(field: K, value: AddNewContext[K]) => void
  saveAddNew: () => void
  onDoorUncalibratedPick: (styleId: string) => void
  onAddNewDoorStyle: () => void
  onOpenFinishWalkthrough: () => void
}) {
  const { draft, rateBook, breakdown, defaults } = p

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
      {/* Form */}
      <div>
        <button
          type="button"
          onClick={p.onBack}
          className="text-[12px] text-[#6B7280] hover:text-[#aaa] mb-3 inline-flex items-center gap-1.5"
        >
          ← Back to product
        </button>

        <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-5 space-y-4">
          <Field label="Quantity">
            <Stepper
              value={draft.qty}
              step={0.5}
              onChange={(v) => p.setDraftPatch({ qty: v })}
              unit="LF"
            />
          </Field>

          <Field label="Carcass material" hint="Interior box — sheet stock you cut parts from.">
            {p.addNew?.ctx.category === 'carcass' ? (
              <AddNewCard
                ctx={p.addNew.ctx}
                askSheetsPerLf
                onCancel={p.cancelAddNew}
                onSave={p.saveAddNew}
                onField={p.setAddNewField}
              />
            ) : (
              <Dropdown
                open={p.openDropdown === 'carcassMaterial'}
                value={draft.slots.carcassMaterial}
                options={rateBook.carcassMaterials.map((m) => ({
                  id: m.id,
                  name: m.name,
                  meta: `$${m.sheet_cost}/sht · ${m.sheets_per_lf} sht/LF`,
                }))}
                onToggle={() => p.toggleDropdown('carcassMaterial')}
                onPick={(id) => {
                  p.setSlot('carcassMaterial', id)
                  p.toggleDropdown('carcassMaterial')
                }}
                onAddNew={() => p.openAddNew('carcassMaterial', 'carcass')}
                addNewLabel="+ Add new material"
                placeholder="Choose…"
              />
            )}
          </Field>

          <Field label="Door style" hint="Also applies to drawer fronts.">
            <Dropdown
              open={p.openDropdown === 'doorStyle'}
              value={draft.slots.doorStyle}
              options={rateBook.doorStyles.map((d) => ({
                id: d.id,
                name: d.name + (d.calibrated ? '' : ' · not calibrated'),
              }))}
              onToggle={() => p.toggleDropdown('doorStyle')}
              onPick={(id) => {
                p.toggleDropdown('doorStyle')
                const ds = rateBook.doorStyles.find((d) => d.id === id)
                if (ds && !ds.calibrated) {
                  // Uncalibrated pick — open walkthrough so the user fills
                  // the labor in. Pre-selecting would leave the draft stuck
                  // behind the save gate until calibration completes.
                  p.onDoorUncalibratedPick(id)
                } else {
                  p.setSlot('doorStyle', id)
                }
              }}
              onAddNew={() => p.onAddNewDoorStyle()}
              addNewLabel="+ Add new door style"
              placeholder="Choose…"
            />
            {rateBook.doorStyles.length === 0 && (
              <button
                type="button"
                onClick={p.onAddNewDoorStyle}
                className="mt-2 w-full px-3 py-2.5 bg-[#0f1a2a] border border-dashed border-[#3b82f6]/60 rounded-md text-[12px] text-[#93c5fd] hover:bg-[#152440] hover:border-[#3b82f6] transition-colors"
              >
                + Calibrate your first door style
              </button>
            )}
          </Field>

          <Field label="Door/drawer material" hint="Face material for all doors + drawer fronts.">
            {p.addNew?.ctx.category === 'ext' ? (
              <AddNewCard
                ctx={p.addNew.ctx}
                askSheetsPerLf={false}
                onCancel={p.cancelAddNew}
                onSave={p.saveAddNew}
                onField={p.setAddNewField}
              />
            ) : (
              <Dropdown
                open={p.openDropdown === 'doorMaterial'}
                value={draft.slots.doorMaterial}
                options={rateBook.extMaterials.map((m) => ({
                  id: m.id,
                  name: m.name,
                  meta: `$${m.sheet_cost}/sht`,
                }))}
                onToggle={() => p.toggleDropdown('doorMaterial')}
                onPick={(id) => {
                  p.setSlot('doorMaterial', id)
                  p.toggleDropdown('doorMaterial')
                }}
                onAddNew={() => p.openAddNew('doorMaterial', 'ext')}
                addNewLabel="+ Add new material"
                placeholder="Choose…"
              />
            )}
          </Field>

          <Field label="Interior finish" hint="Usually prefinished — no finish labor.">
            <Dropdown
              open={p.openDropdown === 'interiorFinish'}
              value={draft.slots.interiorFinish}
              options={rateBook.finishes.map((f) => ({ id: f.id, name: f.name }))}
              onToggle={() => p.toggleDropdown('interiorFinish')}
              onPick={(id) => {
                p.setSlot('interiorFinish', id)
                p.toggleDropdown('interiorFinish')
              }}
              onAddNew={p.onOpenFinishWalkthrough}
              addNewLabel="+ Calibrate finishes"
              placeholder="Choose…"
            />
          </Field>

          <Field label="Exterior finish" hint="Applied to doors, drawer fronts, exposed ends.">
            <Dropdown
              open={p.openDropdown === 'exteriorFinish'}
              value={draft.slots.exteriorFinish}
              options={rateBook.finishes.map((f) => ({ id: f.id, name: f.name }))}
              onToggle={() => p.toggleDropdown('exteriorFinish')}
              onPick={(id) => {
                p.setSlot('exteriorFinish', id)
                p.toggleDropdown('exteriorFinish')
              }}
              onAddNew={p.onOpenFinishWalkthrough}
              addNewLabel="+ Calibrate finishes"
              placeholder="Choose…"
            />
            {rateBook.finishes.length === 0 && (
              <button
                type="button"
                onClick={p.onOpenFinishWalkthrough}
                className="mt-2 w-full px-3 py-2.5 bg-[#0f1a2a] border border-dashed border-[#3b82f6]/60 rounded-md text-[12px] text-[#93c5fd] hover:bg-[#152440] hover:border-[#3b82f6] transition-colors"
              >
                + Calibrate your first finish
              </button>
            )}
          </Field>

          <Field label="End panels">
            <Stepper
              value={draft.slots.endPanels}
              step={1}
              onChange={(v) => p.setSlot('endPanels', Math.max(0, Math.round(v)))}
              unit="each"
            />
          </Field>

          <Field label="Filler/scribes">
            <Stepper
              value={draft.slots.fillers}
              step={1}
              onChange={(v) => p.setSlot('fillers', Math.max(0, Math.round(v)))}
              unit="each"
            />
          </Field>

          <Field label="Notes">
            <input
              type="text"
              value={draft.slots.notes}
              onChange={(e) => p.setSlot('notes', e.target.value)}
              placeholder="Anything unusual about this run…"
              className="w-full bg-[#141414] border border-[#1f1f1f] rounded-md px-3 py-2 text-sm text-[#eee] outline-none focus:border-[#3b82f6]"
            />
          </Field>
        </div>

        {p.saveError && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#1e1018] border border-[#3b1c24] rounded-lg text-sm text-[#fecaca]">
            {p.saveError}
          </div>
        )}
        {!p.saveError && p.gateReason && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#201a0d] border border-[#3f320e] rounded-lg text-sm text-[#fde68a]">
            {p.gateReason}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={p.onCancel}
            disabled={p.saving}
            className="px-4 py-2 text-sm text-[#9CA3AF] hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={p.onSave}
            disabled={!p.canSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3B82F6] text-white text-sm font-semibold rounded-lg hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {p.saving ? 'Saving…' : 'Add line'}
          </button>
        </div>
      </div>

      {/* Breakdown */}
      {breakdown && (
        <BreakdownPanel
          breakdown={breakdown}
          defaults={defaults}
          qty={draft.qty}
          productKey={draft.productId}
          onDefaultsPct={p.setDefaultsPct}
          onPersistDefaults={p.persistDefaults}
        />
      )}
    </div>
  )
}

// ── Shared building blocks ──

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
        {label}
        {hint && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-[#666]">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Stepper({
  value,
  step,
  onChange,
  unit,
}: {
  value: number
  step: number
  onChange: (n: number) => void
  unit: string
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, (Number(value) || 0) - step))}
        className="w-7 h-7 rounded-md border border-[#1f1f1f] bg-[#111] text-[#9CA3AF] hover:text-white text-sm"
      >
        −
      </button>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 text-center font-mono text-sm px-2 py-1.5 bg-[#141414] border border-[#1f1f1f] rounded-md text-[#eee] outline-none focus:border-[#3b82f6]"
      />
      <button
        type="button"
        onClick={() => onChange((Number(value) || 0) + step)}
        className="w-7 h-7 rounded-md border border-[#1f1f1f] bg-[#111] text-[#9CA3AF] hover:text-white text-sm"
      >
        +
      </button>
      <span className="text-[11px] text-[#9CA3AF] ml-1">{unit}</span>
    </div>
  )
}

function Dropdown({
  open,
  value,
  options,
  onToggle,
  onPick,
  onAddNew,
  addNewLabel,
  placeholder,
}: {
  open: boolean
  value: string | null
  options: Array<{ id: string; name: string; meta?: string }>
  onToggle: () => void
  onPick: (id: string) => void
  onAddNew?: () => void
  addNewLabel?: string
  placeholder: string
}) {
  const selected = options.find((o) => o.id === value)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={
          'w-full text-left px-3 py-2 bg-[#141414] border border-[#1f1f1f] rounded-md text-sm flex items-center justify-between gap-3 ' +
          (open ? 'border-[#3b82f6]' : 'hover:border-[#2a2a2a]')
        }
      >
        <span className={selected ? 'text-[#eee]' : 'text-[#6B7280]'}>
          {selected ? selected.name : placeholder}
        </span>
        <span className="text-[10px] text-[#6B7280]">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-[#111] border border-[#222] rounded-md shadow-xl z-10 max-h-64 overflow-y-auto">
          {options.length === 0 && !onAddNew && (
            <div className="px-3 py-2 text-[12px] text-[#6B7280] italic">
              Nothing here yet.
            </div>
          )}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={
                'w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-[#1a2033] ' +
                (o.id === value ? 'bg-[#0f1a2a] text-white' : 'text-[#ddd]')
              }
            >
              <span>{o.name}</span>
              {o.meta && <span className="text-[11px] text-[#6B7280]">{o.meta}</span>}
            </button>
          ))}
          {onAddNew && (
            <button
              type="button"
              onClick={onAddNew}
              className="w-full text-left px-3 py-2 text-sm text-[#93c5fd] hover:bg-[#0f1a2a] border-t border-[#1a1a1a]"
            >
              {addNewLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function AddNewCard({
  ctx,
  askSheetsPerLf,
  onCancel,
  onSave,
  onField,
}: {
  ctx: AddNewContext
  askSheetsPerLf: boolean
  onCancel: () => void
  onSave: () => void
  onField: <K extends keyof AddNewContext>(field: K, value: AddNewContext[K]) => void
}) {
  const label = ctx.category === 'carcass' ? 'carcass material' : 'door/drawer material'
  return (
    <div className="p-4 bg-[#0e1522] border border-[#1e3a5c] rounded-md space-y-3">
      <div className="text-[13px] font-semibold text-white">Add a {label}</div>
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] mb-1">
            Name
          </label>
          <input
            type="text"
            value={ctx.draftName}
            onChange={(e) => onField('draftName', e.target.value)}
            placeholder="e.g. Walnut rift veneer"
            className="w-full bg-[#141414] border border-[#1f1f1f] rounded-md px-3 py-1.5 text-sm text-[#eee] outline-none focus:border-[#3b82f6]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] mb-1">
            $ per sheet
          </label>
          <input
            type="number"
            min="0"
            step="1"
            value={ctx.draftSheetCost}
            onChange={(e) => onField('draftSheetCost', e.target.value)}
            className="w-full bg-[#141414] border border-[#1f1f1f] rounded-md px-3 py-1.5 text-sm text-[#eee] outline-none focus:border-[#3b82f6] font-mono"
          />
        </div>
      </div>
      {askSheetsPerLf && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] mb-1">
            Sheets per LF
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={ctx.draftSheetsPerLf}
            onChange={(e) => onField('draftSheetsPerLf', e.target.value)}
            className="w-40 bg-[#141414] border border-[#1f1f1f] rounded-md px-3 py-1.5 text-sm text-[#eee] outline-none focus:border-[#3b82f6] font-mono"
          />
        </div>
      )}
      {!askSheetsPerLf && (
        <p className="text-[11px] text-[#6B7280] leading-snug">
          Sheets per LF is derived from the product — Base uses 1 sheet per 12 LF,
          Upper 1 per 8, Full 1 per 4.
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-[12px] text-[#6B7280] hover:text-white">
          Cancel
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 bg-[#3B82F6] text-white text-[12px] font-semibold rounded-md hover:bg-[#2563EB]"
        >
          Save to rate book
        </button>
      </div>
    </div>
  )
}

function WarnStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 px-3 py-2 bg-[#201a0d] border border-[#3f320e] rounded-md text-[12px] text-[#fde68a]">
      {children}
    </div>
  )
}

function BreakdownPanel({
  breakdown,
  defaults,
  qty,
  productKey,
  onDefaultsPct,
  onPersistDefaults,
}: {
  breakdown: ComposerBreakdown
  defaults: ComposerDefaults
  qty: number
  productKey: ProductKey
  onDefaultsPct: (k: 'consumablesPct' | 'wastePct', v: string) => void
  onPersistDefaults: () => void
}) {
  const label = PRODUCTS[productKey].label
  function money(n: number) {
    return '$' + Math.round(n || 0).toLocaleString()
  }
  function Row({
    label,
    detail,
    value,
    zero = false,
  }: {
    label: string
    detail?: string | null
    value: number
    zero?: boolean
  }) {
    const isZero = zero || !value || Math.abs(value) < 0.01
    return (
      <div
        className={
          'flex items-start justify-between gap-3 py-2 border-b border-[#141414] last:border-b-0 ' +
          (isZero ? 'opacity-55' : '')
        }
      >
        <div className="text-[12px] text-[#ccc]">
          {label}
          {detail && <div className="text-[11px] text-[#6B7280] mt-0.5">{detail}</div>}
        </div>
        <div className="text-[12px] font-mono tabular-nums text-white whitespace-nowrap">
          {money(value)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-4 lg:sticky lg:top-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
        Line breakdown · {qty} LF · {label}
      </div>

      <Row
        label="Carcass labor"
        detail={`${qty} LF × $${Math.round(breakdown.carcassLaborPerLf)}/LF`}
        value={breakdown.carcassLabor}
      />
      <Row
        label="Carcass material"
        detail={breakdown.carcassMaterialDetail}
        value={breakdown.carcassMaterial}
      />

      {breakdown.doorLaborWarn ? (
        <div className="py-2 border-b border-[#141414]">
          <div className="text-[12px] text-[#fde68a]">⚠ Door style needs walkthrough</div>
        </div>
      ) : (
        <Row
          label="Door labor"
          detail={`${qty} LF × $${Math.round(breakdown.doorLaborPerLf)}/LF`}
          value={breakdown.doorLabor}
        />
      )}
      <Row
        label="Door/drawer material"
        detail={breakdown.doorMaterialDetail}
        value={breakdown.doorMaterial}
      />

      <Row
        label="Interior finish"
        detail={breakdown.interiorFinishDetail}
        value={breakdown.interiorFinishLabor + breakdown.interiorFinishMaterial}
      />
      <Row
        label="Exterior finish"
        detail={breakdown.exteriorFinishDetail}
        value={breakdown.exteriorFinishLabor + breakdown.exteriorFinishMaterial}
      />

      <Row
        label="End panels"
        detail={`${breakdown.endPanelsCount} each`}
        value={breakdown.endPanelsLabor + breakdown.endPanelsMaterial}
      />
      <Row
        label="Filler/scribes"
        detail={`${breakdown.fillersCount} each`}
        value={breakdown.fillersLabor + breakdown.fillersMaterial}
      />

      <PctRow
        label="Consumables"
        pctKey="consumablesPct"
        value={defaults.consumablesPct}
        amount={breakdown.consumables}
        onChange={onDefaultsPct}
        onBlur={onPersistDefaults}
      />
      <PctRow
        label="Waste"
        pctKey="wastePct"
        value={defaults.wastePct}
        amount={breakdown.waste}
        onChange={onDefaultsPct}
        onBlur={onPersistDefaults}
      />

      <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-1.5">
        <div className="flex items-center justify-between text-[12px] text-[#93c5fd]">
          <span>Labor</span>
          <span className="font-mono tabular-nums">{money(breakdown.totals.labor)}</span>
        </div>
        <div className="flex items-center justify-between text-[12px] text-[#c4b5fd]">
          <span>Material</span>
          <span className="font-mono tabular-nums">{money(breakdown.totals.material)}</span>
        </div>
        <div className="flex items-center justify-between text-[14px] font-semibold text-white pt-1.5 border-t border-[#1a1a1a]">
          <span>Line total</span>
          <span className="font-mono tabular-nums">{money(breakdown.totals.total)}</span>
        </div>
      </div>
    </div>
  )
}

function PctRow({
  label,
  pctKey,
  value,
  amount,
  onChange,
  onBlur,
}: {
  label: string
  pctKey: 'consumablesPct' | 'wastePct'
  value: number
  amount: number
  onChange: (k: 'consumablesPct' | 'wastePct', v: string) => void
  onBlur: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[#141414]">
      <div className="text-[12px] text-[#ccc]">
        {label}
        <div className="inline-flex items-center gap-1.5 mt-1.5">
          <input
            type="number"
            min="0"
            step="0.5"
            value={value}
            onChange={(e) => onChange(pctKey, e.target.value)}
            onBlur={onBlur}
            className="w-14 bg-[#141414] border border-[#1f1f1f] rounded px-1.5 py-0.5 text-[11px] font-mono text-right text-[#ddd] outline-none focus:border-[#3b82f6]"
          />
          <span className="text-[11px] text-[#6B7280]">% of material</span>
        </div>
      </div>
      <div className="text-[12px] font-mono tabular-nums text-white whitespace-nowrap">
        ${Math.round(amount).toLocaleString()}
      </div>
    </div>
  )
}

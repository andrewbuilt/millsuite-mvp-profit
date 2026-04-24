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
  isFinishUsed,
  prefinishedSentinel,
  PREFINISHED_FINISH_ID,
  type ComposerBreakdown,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerFinish,
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

/** Inject the client-side Prefinished sentinel at the top of the finish
 *  list so the Interior dropdown always has it as a zero-cost option.
 *  Sentinel is not a rate-book row; it lives only in client state. */
function withPrefinishedSentinel(rb: ComposerRateBook): ComposerRateBook {
  const already = rb.finishes.some((f) => f.id === PREFINISHED_FINISH_ID)
  if (already) return rb
  return { ...rb, finishes: [prefinishedSentinel(), ...rb.finishes] }
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
        setRateBook(withPrefinishedSentinel(rb))
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
  // Finish walkthrough overlay — null when closed, otherwise carries
  // the application the user was calibrating for (drives the row-type
  // the walkthrough writes).
  const [finishWtApp, setFinishWtApp] = useState<'interior' | 'exterior' | null>(null)

  function resetState() {
    setView('picker')
    setDraft(null)
    setOpenDropdown(null)
    setAddNew(null)
    setSaveError(null)
    setDoorWt(null)
    setFinishWtApp(null)
  }

  async function refreshRateBook() {
    try {
      const rb = await loadComposerRateBook(orgId)
      setRateBook(withPrefinishedSentinel(rb))
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

  function openFinishWalkthrough(app: 'interior' | 'exterior') {
    setOpenDropdown(null)
    setFinishWtApp(app)
  }
  async function handleFinishWalkthroughComplete() {
    setFinishWtApp(null)
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
      // Prefinished sentinel sits at the top of Interior — that's the
      // sane default. Exterior falls back to the first exterior row
      // (or null if the shop hasn't calibrated any yet).
      const firstExteriorFinish =
        rateBook.finishes.find((f) => f.application === 'exterior')?.id ?? null
      const hardFallback = {
        carcassMaterial: firstCarcass,
        doorStyle: firstDoor,
        doorMaterial: firstExt,
        interiorFinish: PREFINISHED_FINISH_ID,
        exteriorFinish: firstExteriorFinish,
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
        // Sheets-per-LF is derived from the product at compute time
        // (lib/products.ts sheetsPerLfFace — Base 1/12, Upper 1/8, Full 1/4).
        // Store 0 on the row so no stale value shadows the product math if
        // a future consumer reads sheets_per_lf directly.
        const created = await createCarcassMaterial({
          org_id: orgId,
          name,
          sheet_cost: sheetCost,
          sheets_per_lf: 0,
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
      className="fixed inset-0 z-[95] bg-black/40 backdrop-blur-[2px] flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex flex-col items-center p-4 md:p-8">
        <div className="w-full max-w-[1100px] bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
            <div className="text-[13px] font-semibold text-[#111]">
              {view === 'picker' ? 'Add a line' : PRODUCTS[draft?.productId ?? 'base'].label}
            </div>
            <button
              onClick={handleCancel}
              className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
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
              <div className="py-8 px-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[#991B1B] text-sm">
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

      {/* Finish walkthrough overlay — same layering as the door one.
          Carries the application (interior | exterior) of the dropdown
          that opened it so the walkthrough stamps the new combo rows. */}
      {finishWtApp && (
        <FinishWalkthrough
          orgId={orgId}
          application={finishWtApp}
          onCancel={() => setFinishWtApp(null)}
          onComplete={handleFinishWalkthroughComplete}
        />
      )}
    </div>
  )
}

// ── Uncalibrated carcass warning (base calibration missing) ──

function UncalibratedCarcassWarning() {
  return (
    <div className="py-4 px-4 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl text-[#78350F] text-[13px] leading-relaxed">
      <div className="font-semibold text-[14px] text-[#92400E] mb-1.5">
        Base cabinet calibration needed
      </div>
      The composer prices every line off your base-cabinet labor. Run the
      base-cabinet walkthrough from Settings before you add a line. Once
      it's saved, come back here and everything will light up.
    </div>
  )
}

// ── Product picker ──

function ProductPicker({ onPick }: { onPick: (key: ProductKey) => void }) {
  return (
    <>
      <div className="mb-5 text-[13px] text-[#6B7280] max-w-[640px]">
        Pick what you're pricing. Each product has its own slots, and the
        composer walks you through them.
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
    ? 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]'
    : product.active
    ? 'bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]'
    : 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]'
  return (
    <button
      type="button"
      onClick={isActive ? onPick : undefined}
      disabled={!isActive}
      className={
        'text-left px-5 py-4 bg-white border border-[#E5E7EB] rounded-xl flex items-start justify-between gap-3 transition-colors ' +
        (isActive
          ? 'hover:border-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer'
          : 'opacity-60 cursor-not-allowed')
      }
    >
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-[#111] mb-1">
          {product.label}
          {product.descriptor && (
            <span className="ml-1.5 text-[#9CA3AF] font-normal text-[12px]">
              · {product.descriptor}
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-[#9CA3AF]">per {product.unit}</div>
      </div>
      <span
        className={
          'text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-semibold ' +
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
  onOpenFinishWalkthrough: (app: 'interior' | 'exterior') => void
}) {
  const { draft, rateBook, breakdown, defaults } = p

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
      {/* Form */}
      <div>
        <button
          type="button"
          onClick={p.onBack}
          className="text-[12px] text-[#6B7280] hover:text-[#111] mb-3 inline-flex items-center gap-1.5"
        >
          ← Back to product
        </button>

        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-4">
          <Field label="Quantity">
            <Stepper
              value={draft.qty}
              step={0.5}
              onChange={(v) => p.setDraftPatch({ qty: v })}
              unit="LF"
            />
          </Field>

          <Field label="Carcass material" hint="Interior box: sheet stock you cut parts from.">
            {p.addNew?.ctx.category === 'carcass' ? (
              <AddNewCard
                ctx={p.addNew.ctx}
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
                className="mt-2 w-full px-3 py-2.5 bg-[#EFF6FF] border border-dashed border-[#2563EB]/60 rounded-md text-[12px] text-[#1E40AF] hover:bg-[#DBEAFE] hover:border-[#2563EB] transition-colors"
              >
                + Calibrate your first door style
              </button>
            )}
          </Field>

          <Field label="Door/drawer material" hint="Face material for all doors + drawer fronts.">
            {p.addNew?.ctx.category === 'ext' ? (
              <AddNewCard
                ctx={p.addNew.ctx}
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

          <Field label="Interior finish" hint="Usually prefinished, so no finish labor.">
            <Dropdown
              open={p.openDropdown === 'interiorFinish'}
              value={draft.slots.interiorFinish}
              options={rateBook.finishes
                .filter((f) => f.application === 'interior')
                .filter(isFinishUsed)
                .map((f) => ({ id: f.id, name: f.name }))}
              onToggle={() => p.toggleDropdown('interiorFinish')}
              onPick={(id) => {
                p.setSlot('interiorFinish', id)
                p.toggleDropdown('interiorFinish')
              }}
              onAddNew={() => p.onOpenFinishWalkthrough('interior')}
              addNewLabel="+ Calibrate interior finish"
              placeholder="Choose…"
            />
          </Field>

          <Field label="Exterior finish" hint="Applied to doors, drawer fronts, exposed ends.">
            {(() => {
              const extFinishes = rateBook.finishes
                .filter((f) => f.application === 'exterior')
                .filter(isFinishUsed)
              return (
                <>
                  <Dropdown
                    open={p.openDropdown === 'exteriorFinish'}
                    value={draft.slots.exteriorFinish}
                    options={extFinishes.map((f) => ({ id: f.id, name: f.name }))}
                    onToggle={() => p.toggleDropdown('exteriorFinish')}
                    onPick={(id) => {
                      p.setSlot('exteriorFinish', id)
                      p.toggleDropdown('exteriorFinish')
                    }}
                    onAddNew={() => p.onOpenFinishWalkthrough('exterior')}
                    addNewLabel="+ Calibrate exterior finish"
                    placeholder="Choose…"
                  />
                  {extFinishes.length === 0 && (
                    <button
                      type="button"
                      onClick={() => p.onOpenFinishWalkthrough('exterior')}
                      className="mt-2 w-full px-3 py-2.5 bg-[#EFF6FF] border border-dashed border-[#2563EB]/60 rounded-md text-[12px] text-[#1E40AF] hover:bg-[#DBEAFE] hover:border-[#2563EB] transition-colors"
                    >
                      + Calibrate your first exterior finish
                    </button>
                  )}
                </>
              )
            })()}
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
              className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-2 text-sm text-[#111] outline-none focus:border-[#2563EB]"
            />
          </Field>
        </div>

        {p.saveError && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
            {p.saveError}
          </div>
        )}
        {!p.saveError && p.gateReason && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-sm text-[#78350F]">
            {p.gateReason}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={p.onCancel}
            disabled={p.saving}
            className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={p.onSave}
            disabled={!p.canSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
        {label}
        {hint && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-[#9CA3AF]">
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
        className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-sm"
      >
        −
      </button>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 text-center font-mono text-sm px-2 py-1.5 bg-white border border-[#E5E7EB] rounded-md text-[#111] outline-none focus:border-[#2563EB]"
      />
      <button
        type="button"
        onClick={() => onChange((Number(value) || 0) + step)}
        className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-sm"
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
          'w-full text-left px-3 py-2 bg-white border rounded-md text-sm flex items-center justify-between gap-3 ' +
          (open ? 'border-[#2563EB]' : 'border-[#E5E7EB] hover:border-[#9CA3AF]')
        }
      >
        <span className={selected ? 'text-[#111]' : 'text-[#9CA3AF]'}>
          {selected ? selected.name : placeholder}
        </span>
        <span className="text-[10px] text-[#6B7280]">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#E5E7EB] rounded-md shadow-lg z-10 max-h-64 overflow-y-auto">
          {options.length === 0 && !onAddNew && (
            <div className="px-3 py-2 text-[12px] text-[#9CA3AF] italic">
              Nothing here yet.
            </div>
          )}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={
                'w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-[#F3F4F6] ' +
                (o.id === value ? 'bg-[#EFF6FF] text-[#111]' : 'text-[#111]')
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
              className="w-full text-left px-3 py-2 text-sm text-[#2563EB] hover:bg-[#EFF6FF] border-t border-[#E5E7EB] font-medium"
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
  onCancel,
  onSave,
  onField,
}: {
  ctx: AddNewContext
  onCancel: () => void
  onSave: () => void
  onField: <K extends keyof AddNewContext>(field: K, value: AddNewContext[K]) => void
}) {
  const label = ctx.category === 'carcass' ? 'carcass material' : 'door/drawer material'
  return (
    <div className="p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-md space-y-3">
      <div className="text-[13px] font-semibold text-[#111]">Add a {label}</div>
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
            className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-1.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
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
            className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-1.5 text-sm text-[#111] outline-none focus:border-[#2563EB] font-mono"
          />
        </div>
      </div>
      <p className="text-[11px] text-[#6B7280] leading-snug">
        Sheets per LF is derived from the product: Base uses 1 sheet per 12 LF,
        Upper 1 per 8, Full 1 per 4. You never enter it.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-[12px] text-[#6B7280] hover:text-[#111]">
          Cancel
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1.5 bg-[#2563EB] text-white text-[12px] font-semibold rounded-md hover:bg-[#1D4ED8] transition-colors"
        >
          Save to rate book
        </button>
      </div>
    </div>
  )
}

function WarnStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-md text-[12px] text-[#78350F]">
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
          'flex items-start justify-between gap-3 py-2 border-b border-[#F3F4F6] last:border-b-0 ' +
          (isZero ? 'opacity-55' : '')
        }
      >
        <div className="text-[12px] text-[#374151]">
          {label}
          {detail && <div className="text-[11px] text-[#9CA3AF] mt-0.5">{detail}</div>}
        </div>
        <div className="text-[12px] font-mono tabular-nums text-[#111] whitespace-nowrap">
          {money(value)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 lg:sticky lg:top-4">
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
        <div className="py-2 border-b border-[#F3F4F6]">
          <div className="text-[12px] text-[#78350F]">⚠ Door style needs walkthrough</div>
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

      <div className="mt-3 pt-3 border-t border-[#E5E7EB] space-y-1.5">
        <div className="flex items-center justify-between text-[12px] text-[#1E40AF]">
          <span>Labor</span>
          <span className="font-mono tabular-nums">{money(breakdown.totals.labor)}</span>
        </div>
        <div className="flex items-center justify-between text-[12px] text-[#6D28D9]">
          <span>Material</span>
          <span className="font-mono tabular-nums">{money(breakdown.totals.material)}</span>
        </div>
        <div className="flex items-center justify-between text-[14px] font-semibold text-[#111] pt-1.5 border-t border-[#E5E7EB]">
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
    <div className="flex items-start justify-between gap-3 py-2 border-b border-[#F3F4F6]">
      <div className="text-[12px] text-[#374151]">
        {label}
        <div className="inline-flex items-center gap-1.5 mt-1.5">
          <input
            type="number"
            min="0"
            step="0.5"
            value={value}
            onChange={(e) => onChange(pctKey, e.target.value)}
            onBlur={onBlur}
            className="w-14 bg-white border border-[#E5E7EB] rounded px-1.5 py-0.5 text-[11px] font-mono text-right text-[#111] outline-none focus:border-[#2563EB]"
          />
          <span className="text-[11px] text-[#9CA3AF]">% of material</span>
        </div>
      </div>
      <div className="text-[12px] font-mono tabular-nums text-[#111] whitespace-nowrap">
        ${Math.round(amount).toLocaleString()}
      </div>
    </div>
  )
}

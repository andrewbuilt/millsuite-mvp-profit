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
import { supabase } from '@/lib/supabase'
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
  updateComposerLine,
  type LastUsedPerProduct,
} from '@/lib/composer-persist'
import {
  createBackPanelMaterial,
  createCarcassMaterial,
  createExtMaterial,
} from '@/lib/rate-book-materials'
import {
  createDoorTypeMaterial,
  createDoorTypeMaterialFinish,
  indexDoorTypeMaterials,
  indexDoorTypeMaterialFinishes,
  type DoorMaterialCostUnit,
} from '@/lib/door-types'
import {
  computeSolidWoodCost,
  formatThickness,
  loadSolidWoodComponents,
  type SolidWoodComponent,
} from '@/lib/solid-wood'
import SolidWoodWalkthrough from '@/components/walkthroughs/SolidWoodWalkthrough'
import DoorStyleWalkthrough, {
  type DoorStyleWalkthroughExistingStyle,
} from '@/components/walkthroughs/DoorStyleWalkthrough'
import DrawerStyleWalkthrough, {
  type DrawerStyleWalkthroughExistingStyle,
} from '@/components/walkthroughs/DrawerStyleWalkthrough'
import FinishWalkthrough from '@/components/walkthroughs/FinishWalkthrough'

interface Props {
  subprojectId: string
  orgId: string
  /** Current org.consumable_markup_pct — used for the "no subproject
   *  defaults row yet" fallback. */
  orgConsumablePct: number | null
  /** True when the subproject already has at least one saved line. On
   *  the first line of a fresh subproject the composer opens with empty
   *  slots so the operator isn't staring at a pre-priced table before
   *  they've picked anything. Last-used carry-over kicks in on the 2nd+
   *  line. */
  hasExistingLinesInSubproject: boolean
  /** When non-null, opens the composer in EDIT mode for this saved
   *  line: hydrates qty + slots from the existing row, skips the
   *  product picker, and the save button persists via
   *  updateComposerLine instead of saveComposerLine. (Issue 19) */
  editingLineId?: string | null
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

type AddNewMaterialCategory = 'carcass' | 'ext' | 'back_panel'

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
  hasExistingLinesInSubproject,
  editingLineId,
  onLineSaved,
  onCancel,
}: Props) {
  const isEditMode = !!editingLineId
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

        // Edit mode (Issue 19): hydrate qty + slots from the existing
        // estimate_lines row, skip the product picker, drop into the
        // composer view directly. Refuse to edit non-composer lines —
        // the composer doesn't have the math model for legacy lines.
        if (editingLineId) {
          const { data: line, error } = await supabase
            .from('estimate_lines')
            .select('id, product_key, product_slots, quantity, notes')
            .eq('id', editingLineId)
            .single()
          if (cancelled) return
          if (error || !line) {
            setLoadError(error?.message || 'Could not load line for edit')
            return
          }
          if (!line.product_key) {
            setLoadError(
              "This line was created before the composer existed and can't be edited here. Delete and recreate.",
            )
            return
          }
          setDraft({
            productId: line.product_key as ProductKey,
            qty: Number(line.quantity) || 0,
            slots: {
              ...emptySlots(),
              ...(line.product_slots as Partial<ComposerDraft['slots']>),
              notes: (line.product_slots as { notes?: string })?.notes ?? line.notes ?? '',
            },
          })
          setView('composer')
        }
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Failed to load rate book')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, subprojectId, orgConsumablePct, editingLineId])

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
  // Drawer walkthrough overlay — same pattern as the door overlay.
  const [drawerWt, setDrawerWt] = useState<
    | { style: DrawerStyleWalkthroughExistingStyle | null }
    | null
  >(null)
  // Door v2 inline modals — "+ Add material" / "+ Add finish" scoped to a
  // door type / door material respectively. State is { parentId, draft }
  // when open; null when closed.
  const [addMaterialFor, setAddMaterialFor] = useState<string | null>(null)
  const [addFinishFor, setAddFinishFor] = useState<string | null>(null)
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
    setDrawerWt(null)
    setFinishWtApp(null)
    setAddMaterialFor(null)
    setAddFinishFor(null)
  }

  async function refreshRateBook() {
    try {
      const rb = await loadComposerRateBook(orgId)
      setRateBook(withPrefinishedSentinel(rb))
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to refresh rate book')
    }
  }

  function openDoorWalkthroughForPick(typeId: string) {
    if (!rateBook) return
    const dt = rateBook.doorTypes.find((t) => t.id === typeId)
    if (!dt) return
    setOpenDropdown(null)
    setDoorWt({
      style: {
        id: dt.id,
        name: dt.name,
        // Door v2: finish lives on per-finish rows, not the door type.
        // Walkthrough only edits eng/cnc/assembly now.
        labor: {
          eng: dt.labor_hours_eng,
          cnc: dt.labor_hours_cnc,
          assembly: dt.labor_hours_assembly,
        },
      },
    })
  }

  function openDoorWalkthroughForNew() {
    setOpenDropdown(null)
    setDoorWt({ style: null })
  }

  async function handleDoorWalkthroughComplete(typeId: string) {
    setDoorWt(null)
    await refreshRateBook()
    // Select the calibrated (or newly-created) door type on the draft.
    // Picking a new type clears the cascading children.
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            slots: {
              ...prev.slots,
              doorTypeId: typeId,
              doorMaterialId: null,
              doorFinishId: null,
            },
          }
        : prev,
    )
  }

  function openDrawerWalkthroughForPick(styleId: string) {
    if (!rateBook) return
    const drs = rateBook.drawerStyles.find((d) => d.id === styleId)
    if (!drs) return
    setOpenDropdown(null)
    setDrawerWt({
      style: {
        id: drs.id,
        name: drs.name,
        labor: drs.labor,
        hardwareCost: drs.hardwareCost,
      },
    })
  }

  function openDrawerWalkthroughForNew() {
    setOpenDropdown(null)
    setDrawerWt({ style: null })
  }

  async function handleDrawerWalkthroughComplete(styleId: string) {
    setDrawerWt(null)
    await refreshRateBook()
    setDraft((prev) =>
      prev ? { ...prev, slots: { ...prev.slots, drawerStyle: styleId } } : prev,
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

      // First line of a fresh subproject opens empty — no pre-selected
      // materials, no hard fallbacks, no carry-over. Prefinished is still
      // the sane interior default because it's a client-side sentinel
      // that adds zero cost. As soon as the subproject has one saved
      // line, preload from orgs.last_used_slots_by_product on subsequent
      // product picks so the 2nd+ line carries the shop's recent choices.
      const shouldPreload = hasExistingLinesInSubproject
      const carry = shouldPreload ? lastUsed[key] : null

      let slots: ComposerDraft['slots']
      let qty: number

      if (carry) {
        // Door pricing v2: only seed door fields if the legacy carry-over
        // payload happens to carry the new keys. Composer-saved lines
        // before this PR carry the OLD keys (doorStyle / doorMaterial /
        // exteriorFinish) which are gone — operator re-picks under the
        // cascading dropdowns. We don't surface a hard fallback for the
        // door trio because doorMaterial depends on doorType.
        const firstCarcass = rateBook.carcassMaterials[0]?.id ?? null
        const hardFallback = {
          carcassMaterial: firstCarcass,
          interiorFinish: PREFINISHED_FINISH_ID,
          endPanels: 0,
          fillers: 0,
          notes: '',
        }
        slots = {
          ...emptySlots(),
          ...hardFallback,
          ...carry.slots,
          endPanels: 0,
          fillers: 0,
          notes: '',
        }
        qty = carry.qty || 8
      } else {
        slots = { ...emptySlots(), interiorFinish: PREFINISHED_FINISH_ID }
        qty = 8
      }

      setDraft({ productId: key, qty, slots })
      setView('composer')
    },
    [rateBook, lastUsed, hasExistingLinesInSubproject]
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
      if (editingLineId) {
        await updateComposerLine({
          lineId: editingLineId,
          draft,
          breakdown,
          rateBook,
        })
      } else {
        await saveComposerLine({ subprojectId, draft, breakdown, rateBook })
      }
      // Spec: every saved line updates the shop-wide last-used for its
      // product so the next line of the same type carries over.
      // Edit mode counts too — operator's most recent picks win.
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
      } else if (ctx.category === 'back_panel') {
        const created = await createBackPanelMaterial({
          org_id: orgId,
          name,
          sheet_cost: sheetCost,
        })
        if (created) {
          setRateBook({
            ...rateBook,
            backPanelMaterials: [
              ...rateBook.backPanelMaterials,
              {
                id: created.id,
                name: created.name,
                sheet_cost: Number(created.sheet_cost),
              },
            ],
          })
          setSlot('backPanelMaterial', created.id)
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
          // Legacy "ext" Add-new path — only door material used to land
          // here pre-v2; nothing routes through this branch under v2.
          // No-op cast: slotKey is a string from older callers.
          setSlot(slotKey as 'carcassMaterial', created.id)
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
              {view === 'picker'
                ? 'Add a line'
                : isEditMode
                  ? `Edit · ${PRODUCTS[draft?.productId ?? 'base'].label}`
                  : PRODUCTS[draft?.productId ?? 'base'].label}
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
                isEditMode={isEditMode}
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
                onAddDoorMaterial={(typeId) => setAddMaterialFor(typeId)}
                onAddDoorFinish={(matId) => setAddFinishFor(matId)}
                onDrawerUncalibratedPick={openDrawerWalkthroughForPick}
                onAddNewDrawerStyle={openDrawerWalkthroughForNew}
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

      {/* Drawer walkthrough — same layering / pattern as the door one. */}
      {drawerWt && (
        <DrawerStyleWalkthrough
          orgId={orgId}
          existingStyle={drawerWt.style}
          onCancel={() => setDrawerWt(null)}
          onComplete={handleDrawerWalkthroughComplete}
        />
      )}

      {/* Door pricing v2: inline "+ Add material" modal. Scoped to the
          parent door type. On save, refreshes the rate book in place + sets
          the slot. */}
      {addMaterialFor && rateBook && (
        <AddDoorMaterialModal
          orgId={orgId}
          doorTypeId={addMaterialFor}
          onCancel={() => setAddMaterialFor(null)}
          onCreated={(created) => {
            const nextMaterials = [...rateBook.doorTypeMaterials, created]
            setRateBook({
              ...rateBook,
              doorTypeMaterials: nextMaterials,
              doorTypeMaterialsByTypeId: indexDoorTypeMaterials(nextMaterials),
            })
            setSlot('doorMaterialId', created.id)
            setSlot('doorFinishId', null)
            setAddMaterialFor(null)
          }}
        />
      )}

      {/* "+ Add finish" — scoped to the parent door material. */}
      {addFinishFor && rateBook && (
        <AddDoorFinishModal
          orgId={orgId}
          doorMaterialId={addFinishFor}
          onCancel={() => setAddFinishFor(null)}
          onCreated={(created) => {
            const nextFinishes = [...rateBook.doorTypeMaterialFinishes, created]
            setRateBook({
              ...rateBook,
              doorTypeMaterialFinishes: nextFinishes,
              doorFinishesByMaterialId: indexDoorTypeMaterialFinishes(nextFinishes),
            })
            setSlot('doorFinishId', created.id)
            setAddFinishFor(null)
          }}
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
  /** Edit mode hides the "Back to product" link (the user picked a
   *  product when they originally created the line; we don't let them
   *  swap product type mid-edit) and switches the save button label. */
  isEditMode: boolean
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
  /** Door v2: open the inline "+ Add material" form scoped to the
   *  selected door type. Adds a row to door_type_materials. */
  onAddDoorMaterial: (doorTypeId: string) => void
  /** Door v2: open the inline "+ Add finish" form scoped to the
   *  selected door material. Adds a row to door_type_material_finishes. */
  onAddDoorFinish: (doorMaterialId: string) => void
  onDrawerUncalibratedPick: (styleId: string) => void
  onAddNewDrawerStyle: () => void
  onOpenFinishWalkthrough: (app: 'interior' | 'exterior') => void
}) {
  const { draft, rateBook, breakdown, defaults } = p

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
      {/* Form */}
      <div>
        {!p.isEditMode && (
          <button
            type="button"
            onClick={p.onBack}
            className="text-[12px] text-[#6B7280] hover:text-[#111] mb-3 inline-flex items-center gap-1.5"
          >
            ← Back to product
          </button>
        )}

        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-6">
          <QuantityFields
            qty={draft.qty}
            qtyDoors={draft.slots.qty_doors ?? null}
            onQtyChange={(v) => {
              // Carcass-LF change can leave qty_doors above the new
              // ceiling — clamp on the way through so the stored slot
              // never exceeds carcass.
              const dQ = draft.slots.qty_doors
              const clamped =
                dQ != null && dQ > v ? v : dQ
              p.setDraftPatch({
                qty: v,
                slots: { ...draft.slots, qty_doors: clamped ?? null },
              })
            }}
            onQtyDoorsChange={(v) => {
              // null = match carcass (default state). Number = explicit
              // override; clamp at the carcass ceiling.
              const next =
                v == null ? null : Math.max(0, Math.min(Number(v) || 0, draft.qty))
              p.setSlot('qty_doors', next)
            }}
          />

          <section className="space-y-4">
            <SectionHeader>Carcass</SectionHeader>

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
                    meta: `$${m.sheet_cost}/sht`,
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

            <Field label="Back panel material" hint="Cabinet backs (1/4&quot; ply typical). Independent list from face stock.">
              {p.addNew?.slotKey === 'backPanelMaterial' && p.addNew?.ctx.category === 'back_panel' ? (
                <AddNewCard
                  ctx={p.addNew.ctx}
                  onCancel={p.cancelAddNew}
                  onSave={p.saveAddNew}
                  onField={p.setAddNewField}
                />
              ) : (
                <Dropdown
                  open={p.openDropdown === 'backPanelMaterial'}
                  value={draft.slots.backPanelMaterial}
                  options={rateBook.backPanelMaterials.map((m) => ({
                    id: m.id,
                    name: m.name,
                    meta: `$${m.sheet_cost}/sht`,
                  }))}
                  onToggle={() => p.toggleDropdown('backPanelMaterial')}
                  onPick={(id) => {
                    p.setSlot('backPanelMaterial', id)
                    p.toggleDropdown('backPanelMaterial')
                  }}
                  onAddNew={() => p.openAddNew('backPanelMaterial', 'back_panel')}
                  addNewLabel="+ Add new material"
                  placeholder="Choose…"
                />
              )}
            </Field>

            <Field label="Interior finish" hint="Usually prefinished, so no finish labor.">
              {(() => {
                const interiorFinishes = rateBook.finishes
                  .filter((f) => f.application === 'interior')
                  .filter(isFinishUsed)
                const hasCalibratedInterior = interiorFinishes.some(
                  (f) => !f.isPrefinished,
                )
                return (
                  <>
                    <Dropdown
                      open={p.openDropdown === 'interiorFinish'}
                      value={draft.slots.interiorFinish}
                      options={interiorFinishes.map((f) => ({ id: f.id, name: f.name }))}
                      onToggle={() => p.toggleDropdown('interiorFinish')}
                      onPick={(id) => {
                        p.setSlot('interiorFinish', id)
                        p.toggleDropdown('interiorFinish')
                      }}
                      onAddNew={() => p.onOpenFinishWalkthrough('interior')}
                      addNewLabel="+ Calibrate interior finish"
                      placeholder="Choose…"
                    />
                    {!hasCalibratedInterior && (
                      <p className="mt-2 text-[11px] text-[#6B7280] leading-snug">
                        Most shops use prefinished interiors. If yours don't,{' '}
                        <button
                          type="button"
                          onClick={() => p.onOpenFinishWalkthrough('interior')}
                          className="text-[#2563EB] hover:underline"
                        >
                          calibrate an interior finish
                        </button>{' '}
                        to enable per-LF interior finish pricing.
                      </p>
                    )}
                  </>
                )
              })()}
            </Field>
          </section>

          <section className="space-y-4">
            <SectionHeader>Exterior</SectionHeader>

            <Field label="Door type" hint="Labor + hardware live on the door type.">
              <Dropdown
                open={p.openDropdown === 'doorTypeId'}
                value={draft.slots.doorTypeId}
                options={rateBook.doorTypes.map((t) => ({
                  id: t.id,
                  name: t.name + (t.calibrated ? '' : ' · not calibrated'),
                }))}
                onToggle={() => p.toggleDropdown('doorTypeId')}
                onPick={(id) => {
                  p.toggleDropdown('doorTypeId')
                  const dt = rateBook.doorTypes.find((t) => t.id === id)
                  // Picking a new door type clears the cascading children.
                  if (dt && !dt.calibrated) {
                    p.onDoorUncalibratedPick(id)
                  } else {
                    p.setSlot('doorTypeId', id)
                    p.setSlot('doorMaterialId', null)
                    p.setSlot('doorFinishId', null)
                  }
                }}
                onAddNew={() => p.onAddNewDoorStyle()}
                addNewLabel="+ Add new door type"
                placeholder="Choose…"
              />
              {rateBook.doorTypes.length === 0 && (
                <button
                  type="button"
                  onClick={p.onAddNewDoorStyle}
                  className="mt-2 w-full px-3 py-2.5 bg-[#EFF6FF] border border-dashed border-[#2563EB]/60 rounded-md text-[12px] text-[#1E40AF] hover:bg-[#DBEAFE] hover:border-[#2563EB] transition-colors"
                >
                  + Calibrate your first door type
                </button>
              )}
            </Field>

            <Field label="Door material" hint="Picks scoped to the chosen door type.">
              {(() => {
                const dtId = draft.slots.doorTypeId
                const materials = dtId
                  ? rateBook.doorTypeMaterialsByTypeId.get(dtId) ?? []
                  : []
                if (!dtId) {
                  return (
                    <div className="px-3 py-2 text-[12px] text-[#9CA3AF] italic border border-dashed border-[#E5E7EB] rounded-md">
                      Pick a door type first.
                    </div>
                  )
                }
                return (
                  <Dropdown
                    open={p.openDropdown === 'doorMaterialId'}
                    value={draft.slots.doorMaterialId}
                    options={materials.map((m) => ({
                      id: m.id,
                      name: m.material_name,
                      meta: `$${m.cost_value}/${m.cost_unit}`,
                    }))}
                    onToggle={() => p.toggleDropdown('doorMaterialId')}
                    onPick={(id) => {
                      p.setSlot('doorMaterialId', id)
                      // Picking a different material clears the finish.
                      p.setSlot('doorFinishId', null)
                      p.toggleDropdown('doorMaterialId')
                    }}
                    onAddNew={() => p.onAddDoorMaterial(dtId)}
                    addNewLabel="+ Add material"
                    placeholder={
                      materials.length === 0
                        ? 'No materials yet — + Add material'
                        : 'Choose…'
                    }
                  />
                )
              })()}
            </Field>

            <Field label="Door finish" hint="Picks scoped to the chosen door material.">
              {(() => {
                const dmId = draft.slots.doorMaterialId
                const finishes = dmId
                  ? rateBook.doorFinishesByMaterialId.get(dmId) ?? []
                  : []
                if (!dmId) {
                  return (
                    <div className="px-3 py-2 text-[12px] text-[#9CA3AF] italic border border-dashed border-[#E5E7EB] rounded-md">
                      Pick a door material first.
                    </div>
                  )
                }
                return (
                  <Dropdown
                    open={p.openDropdown === 'doorFinishId'}
                    value={draft.slots.doorFinishId}
                    options={finishes.map((f) => ({
                      id: f.id,
                      name: f.finish_name,
                      meta: `${f.labor_hours_per_door}h + $${f.material_per_door}/door`,
                    }))}
                    onToggle={() => p.toggleDropdown('doorFinishId')}
                    onPick={(id) => {
                      p.setSlot('doorFinishId', id)
                      p.toggleDropdown('doorFinishId')
                    }}
                    onAddNew={() => p.onAddDoorFinish(dmId)}
                    addNewLabel="+ Add finish"
                    placeholder={
                      finishes.length === 0
                        ? 'No finishes yet — + Add finish'
                        : 'Choose…'
                    }
                  />
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
              <p className="text-[11px] text-[#9CA3AF] mt-1.5">
                Assumes 24" deep. Price multiple panels if oversized.
              </p>
            </Field>

            <Field label="Filler/scribes">
              <Stepper
                value={draft.slots.fillers}
                step={1}
                onChange={(v) => p.setSlot('fillers', Math.max(0, Math.round(v)))}
                unit="each"
              />
            </Field>
          </section>

          {/* Drawers — Base only. Upper / Full leave drawerCount=0 +
              drawerStyle=null and the section stays hidden. */}
          {draft.productId === 'base' && (
            <section className="space-y-4">
              <SectionHeader>Drawers</SectionHeader>

              <Field label="Quantity">
                <Stepper
                  value={draft.slots.drawerCount}
                  step={1}
                  onChange={(v) => p.setSlot('drawerCount', Math.max(0, Math.round(v)))}
                  unit="each"
                />
              </Field>

              <Field label="Type" hint="Drawer style — calibrated separately from doors.">
                <Dropdown
                  open={p.openDropdown === 'drawerStyle'}
                  value={draft.slots.drawerStyle}
                  options={rateBook.drawerStyles.map((d) => ({
                    id: d.id,
                    name: d.name + (d.calibrated ? '' : ' · not calibrated'),
                  }))}
                  onToggle={() => p.toggleDropdown('drawerStyle')}
                  onPick={(id) => {
                    p.toggleDropdown('drawerStyle')
                    const drs = rateBook.drawerStyles.find((d) => d.id === id)
                    if (drs && !drs.calibrated) {
                      p.onDrawerUncalibratedPick(id)
                    } else {
                      p.setSlot('drawerStyle', id)
                    }
                  }}
                  onAddNew={() => p.onAddNewDrawerStyle()}
                  addNewLabel="+ Add new drawer style"
                  placeholder="Choose…"
                />
                {rateBook.drawerStyles.length === 0 && (
                  <button
                    type="button"
                    onClick={p.onAddNewDrawerStyle}
                    className="mt-2 w-full px-3 py-2.5 bg-[#EFF6FF] border border-dashed border-[#2563EB]/60 rounded-md text-[12px] text-[#1E40AF] hover:bg-[#DBEAFE] hover:border-[#2563EB] transition-colors"
                  >
                    + Calibrate your first drawer style
                  </button>
                )}
              </Field>
            </section>
          )}

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
            {p.saving ? 'Saving…' : p.isEditMode ? 'Save changes' : 'Add line'}
          </button>
        </div>
      </div>

      {/* Breakdown — placeholder when no pricing slot is picked yet,
          live panel once any of carcass / door style / door material /
          exterior finish is chosen. */}
      {breakdown && hasAnyPricingSlotV2(draft.slots) ? (
        <BreakdownPanel
          breakdown={breakdown}
          defaults={defaults}
          qty={draft.qty}
          productKey={draft.productId}
          onDefaultsPct={p.setDefaultsPct}
          onPersistDefaults={p.persistDefaults}
        />
      ) : (
        <BreakdownPlaceholder />
      )}
    </div>
  )
}

function hasAnyPricingSlotV2(s: ComposerDraft['slots']): boolean {
  return !!(s.carcassMaterial || s.doorTypeId || s.doorMaterialId || s.doorFinishId)
}


function BreakdownPlaceholder() {
  return (
    <div className="bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-xl p-6 lg:sticky lg:top-4 text-center mt-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
        Line breakdown
      </div>
      <div className="text-[13px] text-[#6B7280] leading-relaxed">
        Pick materials and a door style to see pricing.
      </div>
    </div>
  )
}

// ── Shared building blocks ──

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#374151] pb-2 border-b border-[#E5E7EB]">
      {children}
    </div>
  )
}

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

/** Two-LF entry for the line — carcass run + (optionally) the door
 *  subset. Default state hides the second field and shows a "+ Add
 *  open sections" toggle so the typical kitchen flow stays one input.
 *  When qty_doors is explicitly set (parser-seeded line, or operator
 *  toggled), both fields render with their own labels. */
function QuantityFields({
  qty,
  qtyDoors,
  onQtyChange,
  onQtyDoorsChange,
}: {
  qty: number
  qtyDoors: number | null
  onQtyChange: (v: number) => void
  onQtyDoorsChange: (v: number | null) => void
}) {
  const split = qtyDoors != null
  return (
    <div className="space-y-3">
      <Field
        label={split ? 'Quantity (carcass)' : 'Quantity'}
        hint={split ? 'Total cabinet box run' : undefined}
      >
        <Stepper
          value={qty}
          step={0.5}
          onChange={onQtyChange}
          unit="LF"
        />
      </Field>
      {split ? (
        <Field
          label="Doors (LF)"
          hint="Run that has doors. Reduce if some sections are open."
        >
          <Stepper
            value={qtyDoors as number}
            step={0.5}
            onChange={onQtyDoorsChange}
            unit="LF"
          />
          <button
            type="button"
            onClick={() => onQtyDoorsChange(null)}
            className="mt-1 text-[11px] text-[#6B7280] hover:text-[#111] hover:underline"
          >
            Match carcass (no open sections)
          </button>
        </Field>
      ) : (
        <button
          type="button"
          onClick={() => onQtyDoorsChange(qty)}
          className="text-[11px] text-[#2563EB] hover:underline"
        >
          + Add open sections (split door LF from carcass)
        </button>
      )}
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
  const label =
    ctx.category === 'carcass'
      ? 'carcass material'
      : ctx.category === 'back_panel'
        ? 'back panel material'
        : 'door/drawer material'
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

/** Append a "$X/door" annotation to a Row detail string. Used by the
 *  door-section rows so the operator can sanity-check the per-door cost
 *  at a glance without doing the divide in their head. Returns the
 *  original detail unchanged when perDoor is 0 / the detail is null. */
function appendPerDoor(detail: string | null, perDoor: number): string | null {
  if (!detail) return detail
  if (!perDoor || Math.abs(perDoor) < 0.01) return detail
  return `${detail} · $${Math.round(perDoor)}/door`
}

/** Section header inside the breakdown panel — mirrors the form-side
 *  SectionHeader styling so the right-rail rolls up the same groups the
 *  modal renders. */
function BreakdownSection({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#374151] pt-3 pb-1.5 border-b border-[#E5E7EB]">
      {label}
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
    <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 lg:sticky lg:top-4 mt-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
        Line breakdown ·{' '}
        {breakdown.qtyDoors !== breakdown.qtyCarcass
          ? `${breakdown.qtyCarcass} LF carcass · ${breakdown.qtyDoors} LF doors`
          : `${breakdown.qtyCarcass} LF`}
        {' · '}
        {label}
      </div>

      <BreakdownSection label="Carcass" />
      <Row
        label="Carcass labor"
        detail={`${breakdown.qtyCarcass} LF × $${Math.round(breakdown.carcassLaborPerLf)}/LF`}
        value={breakdown.carcassLabor}
      />
      <Row
        label="Carcass material"
        detail={breakdown.carcassMaterialDetail}
        value={breakdown.carcassMaterial}
      />
      <Row
        label="Back panel material"
        detail={breakdown.backPanelMaterialDetail}
        value={breakdown.backPanelMaterial}
      />
      <Row
        label="Interior finish"
        detail={breakdown.interiorFinishDetail}
        value={breakdown.interiorFinishLabor + breakdown.interiorFinishMaterial}
      />

      <BreakdownSection label="Exterior" />
      {breakdown.doorLaborWarn ? (
        <div className="py-2 border-b border-[#F3F4F6]">
          <div className="text-[12px] text-[#78350F]">⚠ Door type needs calibration</div>
        </div>
      ) : (
        <Row
          label="Door labor"
          detail={appendPerDoor(
            `${breakdown.qtyDoors} LF × $${Math.round(breakdown.doorLaborPerLf)}/LF`,
            breakdown.doorLaborPerDoor,
          )}
          value={breakdown.doorLabor}
        />
      )}
      {breakdown.doorMaterialMissing ? (
        <div className="py-2 border-b border-[#F3F4F6]">
          <div className="text-[12px] text-[#92400E]">
            Door material: pick one to price
          </div>
        </div>
      ) : (
        <Row
          label="Door material"
          detail={appendPerDoor(breakdown.doorMaterialDetail, breakdown.doorMaterialPerDoor)}
          value={breakdown.doorMaterial}
        />
      )}
      {breakdown.doorFinishMissing ? (
        <div className="py-2 border-b border-[#F3F4F6]">
          <div className="text-[12px] text-[#92400E]">
            Exterior finish: pick one to price
          </div>
        </div>
      ) : (
        <Row
          label="Exterior finish"
          detail={appendPerDoor(
            breakdown.exteriorFinishDetail,
            breakdown.doorFinishLaborPerDoor + breakdown.doorFinishMaterialPerDoor,
          )}
          value={breakdown.exteriorFinishLabor + breakdown.exteriorFinishMaterial}
        />
      )}
      {breakdown.doorHardware > 0 && (
        <Row
          label="Door hardware"
          detail={appendPerDoor(
            `${breakdown.doorsPerLine.toFixed(2)} doors × $${breakdown.doorHardwarePerDoor}/door`,
            breakdown.doorHardwarePerDoor,
          )}
          value={breakdown.doorHardware}
        />
      )}
      {/* Door section roll-up — labor + material + finish + hardware
          summarized as a per-door average. Hidden when no door slot
          contributes (avgPerDoor === 0). */}
      {breakdown.avgPerDoor > 0 && (
        <Row
          label="Avg per door"
          detail={'labor + material + finish + hardware'}
          value={breakdown.avgPerDoor}
        />
      )}
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

      {/* Drawers — Base only. Mirrors the modal section that's only
          rendered for Base on the form side. */}
      {productKey === 'base' && (
        <>
          <BreakdownSection label="Drawers" />
          {breakdown.drawerLaborWarn ? (
            <div className="py-2 border-b border-[#F3F4F6]">
              <div className="text-[12px] text-[#78350F]">
                ⚠ {breakdown.drawerLaborDetail || 'Pick a calibrated drawer style'}
              </div>
            </div>
          ) : (
            <Row
              label="Drawers"
              detail={breakdown.drawerLaborDetail}
              value={
                breakdown.drawerLabor + breakdown.drawerMaterial + breakdown.drawerHardware
              }
              zero={
                breakdown.drawerLabor + breakdown.drawerMaterial + breakdown.drawerHardware === 0
              }
            />
          )}
        </>
      )}

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

// ── Door pricing v2 — inline add modals ──────────────────────────────────

function AddDoorMaterialModal(p: {
  orgId: string
  doorTypeId: string
  onCancel: () => void
  onCreated: (
    row: import('@/lib/door-types').DoorTypeMaterial,
  ) => void
}) {
  type Tab = 'sheet' | 'solid_wood'
  const [tab, setTab] = useState<Tab>('sheet')

  // Sheet-stock fields
  const [name, setName] = useState('')
  const [costValue, setCostValue] = useState('')
  const [costUnit, setCostUnit] = useState<DoorMaterialCostUnit>('sheet')
  const [notes, setNotes] = useState('')

  // Solid-wood fields
  const [woodComponents, setWoodComponents] = useState<SolidWoodComponent[]>([])
  const [woodComponentId, setWoodComponentId] = useState<string>('')
  const [bdftPerDoor, setBdftPerDoor] = useState<string>('')
  const [woodMaterialName, setWoodMaterialName] = useState<string>('')
  const [woodNameDirty, setWoodNameDirty] = useState(false)
  const [solidWoodWtOpen, setSolidWoodWtOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load solid-wood components when the modal opens. Lazy refresh after
  // the inline walkthrough closes auto-picks the new row.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const rows = await loadSolidWoodComponents(p.orgId)
      if (!cancelled) setWoodComponents(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [p.orgId])

  const pickedWood = useMemo(
    () => woodComponents.find((w) => w.id === woodComponentId) || null,
    [woodComponents, woodComponentId],
  )
  const bdftNum = parseFloat(bdftPerDoor)
  const derivedCost =
    pickedWood && Number.isFinite(bdftNum) && bdftNum > 0
      ? computeSolidWoodCost(pickedWood, bdftNum)
      : 0

  // Auto-suggest material name when the picker / bdft inputs change —
  // unless the operator already typed one in. woodNameDirty latches once
  // they edit the name field.
  useEffect(() => {
    if (woodNameDirty) return
    if (!pickedWood) {
      setWoodMaterialName('')
      return
    }
    const bdftLabel =
      Number.isFinite(bdftNum) && bdftNum > 0 ? ` · ${bdftNum} BDFT/door` : ''
    setWoodMaterialName(`${pickedWood.name}${bdftLabel}`)
  }, [pickedWood, bdftNum, woodNameDirty])

  async function save() {
    setError(null)
    setSaving(true)
    try {
      if (tab === 'sheet') {
        if (!name.trim()) {
          setError('Give the material a name.')
          return
        }
        const cv = parseFloat(costValue)
        if (!Number.isFinite(cv) || cv < 0) {
          setError('Cost needs a non-negative number.')
          return
        }
        const created = await createDoorTypeMaterial({
          org_id: p.orgId,
          door_type_id: p.doorTypeId,
          material_name: name.trim(),
          cost_value: cv,
          cost_unit: costUnit,
          notes: notes.trim() || null,
        })
        if (created) p.onCreated(created)
      } else {
        if (!pickedWood) {
          setError('Pick a solid wood component.')
          return
        }
        if (!Number.isFinite(bdftNum) || bdftNum <= 0) {
          setError('BDFT per door needs a positive number.')
          return
        }
        const finalName = woodMaterialName.trim() || pickedWood.name
        const created = await createDoorTypeMaterial({
          org_id: p.orgId,
          door_type_id: p.doorTypeId,
          material_name: finalName,
          cost_value: derivedCost,
          cost_unit: 'ea',
          notes: null,
          solid_wood_component_id: pickedWood.id,
          bdft_per_unit: bdftNum,
        })
        if (created) p.onCreated(created)
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to save material')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={p.onCancel}
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] text-[13px] font-semibold text-[#111]">
          Add door material
        </div>

        {/* Tab strip */}
        <div className="flex border-b border-[#E5E7EB] px-5 pt-3">
          <button
            type="button"
            onClick={() => setTab('sheet')}
            className={
              'px-3 py-2 text-[12.5px] border-b-2 -mb-px transition-colors ' +
              (tab === 'sheet'
                ? 'border-[#2563EB] text-[#111] font-medium'
                : 'border-transparent text-[#6B7280] hover:text-[#374151]')
            }
          >
            Sheet stock
          </button>
          <button
            type="button"
            onClick={() => setTab('solid_wood')}
            className={
              'ml-2 px-3 py-2 text-[12.5px] border-b-2 -mb-px transition-colors ' +
              (tab === 'solid_wood'
                ? 'border-[#2563EB] text-[#111] font-medium'
                : 'border-transparent text-[#6B7280] hover:text-[#374151]')
            }
          >
            Calculate from solid wood
          </button>
        </div>

        <div className="p-5 space-y-3">
          {tab === 'sheet' ? (
            <>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Walnut veneer"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                />
              </label>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Cost</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costValue}
                    onChange={(e) => setCostValue(e.target.value)}
                    placeholder="0"
                    className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Per</span>
                  <select
                    value={costUnit}
                    onChange={(e) => setCostUnit(e.target.value as DoorMaterialCostUnit)}
                    className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                  >
                    <option value="sheet">sheet</option>
                    <option value="lf">lf</option>
                    <option value="bf">bf</option>
                    <option value="ea">each</option>
                    <option value="lump">lump</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Notes (optional)</span>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the next operator should know…"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Solid wood component</span>
                {woodComponents.length === 0 ? (
                  <div className="mt-1 px-3 py-2 text-[12.5px] text-[#6B7280] italic border border-dashed border-[#E5E7EB] rounded-md">
                    No solid wood components yet —{' '}
                    <button
                      type="button"
                      onClick={() => setSolidWoodWtOpen(true)}
                      className="text-[#2563EB] hover:text-[#1D4ED8] underline"
                    >
                      add one
                    </button>
                    .
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <select
                      autoFocus
                      value={woodComponentId}
                      onChange={(e) => setWoodComponentId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                    >
                      <option value="">Choose…</option>
                      {woodComponents.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} · {formatThickness(w.thickness_quarters)} ·
                          {' '}
                          ${w.cost_per_bdft}/bdft
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setSolidWoodWtOpen(true)}
                      className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] whitespace-nowrap"
                    >
                      + Add new
                    </button>
                  </div>
                )}
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">BDFT per door</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={bdftPerDoor}
                  onChange={(e) => setBdftPerDoor(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-32 px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                />
                <span className="ml-2 text-[11px] text-[#6B7280]">
                  Board feet of solid wood per door, including any frame stock.
                </span>
              </label>

              {pickedWood && Number.isFinite(bdftNum) && bdftNum > 0 && (
                <div className="px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded text-[12px] text-[#374151] font-mono tabular-nums leading-relaxed">
                  {bdftNum} BDFT × ${pickedWood.cost_per_bdft}/bdft × (1 +{' '}
                  {pickedWood.waste_pct}%) ={' '}
                  <span className="text-[#111] font-semibold">
                    ${derivedCost.toFixed(2)}/door
                  </span>
                </div>
              )}

              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material name</span>
                <input
                  value={woodMaterialName}
                  onChange={(e) => {
                    setWoodMaterialName(e.target.value)
                    setWoodNameDirty(true)
                  }}
                  placeholder="e.g. 8/4 Walnut · 4 BDFT/door"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                />
              </label>
            </>
          )}

          {error && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded text-xs text-[#991B1B]">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB]">
          <button onClick={p.onCancel} disabled={saving} className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save material'}
          </button>
        </div>

        {solidWoodWtOpen && (
          <SolidWoodWalkthrough
            orgId={p.orgId}
            onCancel={() => setSolidWoodWtOpen(false)}
            onComplete={async (componentId) => {
              setSolidWoodWtOpen(false)
              const fresh = await loadSolidWoodComponents(p.orgId)
              setWoodComponents(fresh)
              setWoodComponentId(componentId)
            }}
          />
        )}
      </div>
    </div>
  )
}

function AddDoorFinishModal(p: {
  orgId: string
  doorMaterialId: string
  onCancel: () => void
  onCreated: (
    row: import('@/lib/door-types').DoorTypeMaterialFinish,
  ) => void
}) {
  const [name, setName] = useState('')
  const [hours, setHours] = useState('')
  const [matCost, setMatCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) {
      setError('Give the finish a name.')
      return
    }
    const h = parseFloat(hours) || 0
    const m = parseFloat(matCost) || 0
    if (h < 0 || m < 0) {
      setError('Hours and material need to be non-negative.')
      return
    }
    setSaving(true)
    try {
      const created = await createDoorTypeMaterialFinish({
        org_id: p.orgId,
        door_type_material_id: p.doorMaterialId,
        finish_name: name.trim(),
        labor_hours_per_door: h,
        material_per_door: m,
      })
      if (created) p.onCreated(created)
    } catch (err: any) {
      setError(err?.message || 'Failed to save finish')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={p.onCancel}
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] text-[13px] font-semibold text-[#111]">
          Add door finish
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Finish name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Matte clear"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Hours / door</span>
              <input
                type="number"
                min="0"
                step="0.05"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">$ / door</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={matCost}
                onChange={(e) => setMatCost(e.target.value)}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
              />
            </label>
          </div>
          {error && (
            <div className="px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded text-xs text-[#991B1B]">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 bg-[#F9FAFB] border-t border-[#E5E7EB]">
          <button onClick={p.onCancel} disabled={saving} className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save finish'}
          </button>
        </div>
      </div>
    </div>
  )
}

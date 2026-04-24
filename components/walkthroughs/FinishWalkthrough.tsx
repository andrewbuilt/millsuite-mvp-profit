'use client'

// ============================================================================
// FinishWalkthrough — per-LF labor + material calibration for finish combos.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 8 + specs/add-line-composer/README.md.
//
// One walkthrough, four collapsible combo rows (stain+clear on slab, paint
// on slab, stain+clear on shaker, paint on shaker). Prefinished is
// implicit-zero and doesn't show a row — we just ensure the rate_book_items
// row exists so the composer's interior-finish default works.
//
// Each combo expands to three cab-height cards: Base 8' / Upper 8' / Full 8'.
// Each card captures:
//   - labor hours for the 8' run (folds to per-LF on save via ÷8)
//   - material $ for the 8' run, broken out by the combo's fields
//     (stain+clear → stain + lacquer; paint → primer + paint).
//
// Partial calibration is a first-class state. Shops calibrate only what
// they sell, one card at a time. Each card has its own Save so the user
// doesn't have to fill every cell before anything goes live.
//
// Fires from the composer's exterior-finish dropdown via "+ Calibrate
// finishes" (or the empty-state hatch when no finishes exist yet).
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type FinishFieldKey = 'primer' | 'paint' | 'stain' | 'lacquer'
type ProductCategory = 'base' | 'upper' | 'full'

interface FinishCombo {
  key: string
  name: string
  fields: readonly FinishFieldKey[]
}

// Fixed combo list per spec. Prefinished is ensured but not rendered as a
// row — its card would be "zero everywhere, already calibrated."
const COMBOS: FinishCombo[] = [
  { key: 'stain-clear-slab',   name: 'Stain + clear on slab',   fields: ['stain', 'lacquer'] },
  { key: 'paint-slab',         name: 'Paint on slab',           fields: ['primer', 'paint'] },
  { key: 'stain-clear-shaker', name: 'Stain + clear on shaker', fields: ['stain', 'lacquer'] },
  { key: 'paint-shaker',       name: 'Paint on shaker',         fields: ['primer', 'paint'] },
]

const FINISHES_CATEGORY_NAME = 'Finishes'

// Prefinished is no longer a rate_book_items row — the composer
// synthesizes it client-side as a sentinel at the top of the Interior
// finish dropdown (see lib/composer.ts prefinishedSentinel).

const PRODUCT_CATEGORIES: Array<{ key: ProductCategory; label: string }> = [
  { key: 'base',  label: 'Base 8\u2032' },
  { key: 'upper', label: 'Upper 8\u2032' },
  { key: 'full',  label: 'Full 8\u2032' },
]

const FIELD_LABEL: Record<FinishFieldKey, string> = {
  primer:  'Primer',
  paint:   'Paint',
  stain:   'Stain',
  lacquer: 'Lacquer',
}

// ── Props ──

interface Props {
  orgId: string
  /** Composer passes this when the user opened the walkthrough from
   *  the Interior or Exterior finish dropdown. Newly-created combo
   *  rows get stamped with this application so they land in the right
   *  dropdown. Defaults to 'exterior' (historical behavior) — Item 8's
   *  rewrite adds a "Duplicate for the other application" affordance
   *  so operators can spin up interior twins when they finish cabinet
   *  interiors. */
  application?: 'interior' | 'exterior'
  onComplete: () => void
  onCancel: () => void
}

// ── Loaded data per combo × product ──

interface CardValues {
  hours: number         // hours for an 8' run (÷8 on save)
  primer: number        // $ for an 8' run (÷8 on save)
  paint: number
  stain: number
  lacquer: number
}

interface ComboData {
  /** rate_book_items.id for this combo (ensured on open). */
  itemId: string
  /** Saved card values per product category, keyed by category. Missing
   *  key = not calibrated for that cab height. */
  byProduct: Record<ProductCategory, CardValues | null>
}

// ── Component ──

export default function FinishWalkthrough({
  orgId,
  application = 'exterior',
  onCancel,
  onComplete,
}: Props) {
  const [data, setData] = useState<Record<string, ComboData> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set([COMBOS[0].key]))
  const [savingCard, setSavingCard] = useState<string | null>(null)
  // Uncommitted draft values per (combo × product). Keyed "combo:product".
  const [drafts, setDrafts] = useState<Record<string, CardValues>>({})
  // "Duplicate for other application" affordance state.
  const otherApp: 'interior' | 'exterior' = application === 'interior' ? 'exterior' : 'interior'
  const [duplicating, setDuplicating] = useState(false)
  const [duplicated, setDuplicated] = useState(false)

  // On open: ensure the 4 combo finish items exist + load breakdown rows.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const next = await ensureAndLoadFinishData(orgId, application)
        if (cancelled) return
        setData(next)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load finishes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  function toggleExpanded(comboKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(comboKey)) next.delete(comboKey)
      else next.add(comboKey)
      return next
    })
  }

  function cardId(comboKey: string, product: ProductCategory) {
    return `${comboKey}:${product}`
  }

  function getDraft(comboKey: string, product: ProductCategory): CardValues {
    const key = cardId(comboKey, product)
    if (drafts[key]) return drafts[key]
    const saved = data?.[comboKey]?.byProduct[product]
    if (saved) {
      // Rehydrate the per-LF stored values back to 8'-run units so the user
      // edits in the same unit they entered.
      return {
        hours: saved.hours * 8,
        primer: saved.primer * 8,
        paint: saved.paint * 8,
        stain: saved.stain * 8,
        lacquer: saved.lacquer * 8,
      }
    }
    return { hours: 0, primer: 0, paint: 0, stain: 0, lacquer: 0 }
  }

  function patchDraft(comboKey: string, product: ProductCategory, patch: Partial<CardValues>) {
    const key = cardId(comboKey, product)
    setDrafts((prev) => {
      const base = prev[key] || getDraft(comboKey, product)
      return { ...prev, [key]: { ...base, ...patch } }
    })
  }

  function isCalibrated(comboKey: string, product: ProductCategory): boolean {
    return !!data?.[comboKey]?.byProduct[product]
  }

  async function saveCard(comboKey: string, product: ProductCategory) {
    if (!data) return
    const itemId = data[comboKey].itemId
    const d = getDraft(comboKey, product)
    const perLf = {
      labor_hr_per_lf:     (d.hours   || 0) / 8,
      primer_cost_per_lf:  (d.primer  || 0) / 8,
      paint_cost_per_lf:   (d.paint   || 0) / 8,
      stain_cost_per_lf:   (d.stain   || 0) / 8,
      lacquer_cost_per_lf: (d.lacquer || 0) / 8,
    }
    setSavingCard(cardId(comboKey, product))
    setError(null)
    try {
      await upsertBreakdown(itemId, product, perLf)
      // Update local data so the card flips to "calibrated".
      setData((prev) => {
        if (!prev) return prev
        const combo = prev[comboKey]
        return {
          ...prev,
          [comboKey]: {
            ...combo,
            byProduct: {
              ...combo.byProduct,
              [product]: {
                hours: perLf.labor_hr_per_lf,
                primer: perLf.primer_cost_per_lf,
                paint: perLf.paint_cost_per_lf,
                stain: perLf.stain_cost_per_lf,
                lacquer: perLf.lacquer_cost_per_lf,
              },
            },
          },
        }
      })
      // Clear the card's draft since it's now committed.
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[cardId(comboKey, product)]
        return next
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to save card')
    } finally {
      setSavingCard(null)
    }
  }

  /** Create blank twin combo rows under the OTHER application so the
   *  operator can calibrate them later in context. Doesn't touch the
   *  current walkthrough's data — just ensures the 4 rate_book_items
   *  rows exist under the other application.
   */
  async function duplicateForOtherApplication() {
    setDuplicating(true)
    setError(null)
    try {
      const categoryId = await ensureFinishCategory(orgId)
      for (const combo of COMBOS) {
        await ensureFinishItem(orgId, categoryId, combo.name, otherApp)
      }
      setDuplicated(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to duplicate combos')
    } finally {
      setDuplicating(false)
    }
  }

  const totalCalibrated = useMemo(() => {
    if (!data) return 0
    let n = 0
    for (const combo of COMBOS) {
      for (const pc of PRODUCT_CATEGORIES) {
        if (data[combo.key]?.byProduct[pc.key]) n++
      }
    }
    return n
  }, [data])

  // ── Render ──

  const appLabel = application === 'interior' ? 'Interior' : 'Exterior'
  const otherAppLabel = otherApp === 'interior' ? 'Interior' : 'Exterior'

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-[2px] flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="max-w-[860px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
            <div>
              <div className="text-[13px] font-semibold text-[#111]">
                {appLabel} finish calibration
              </div>
              <div className="text-[11px] text-[#6B7280] mt-0.5">
                Fill out the combos you sell. Partial calibration is fine.
                Each card saves independently.
              </div>
            </div>
            <button
              onClick={onCancel}
              className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            {loading ? (
              <div className="py-10 text-center text-[#9CA3AF] text-sm">
                Loading finishes…
              </div>
            ) : error ? (
              <div className="px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
                {error}
              </div>
            ) : !data ? null : (
              <div className="space-y-3">
                {COMBOS.map((combo) => (
                  <ComboRow
                    key={combo.key}
                    combo={combo}
                    data={data[combo.key]}
                    expanded={expanded.has(combo.key)}
                    onToggle={() => toggleExpanded(combo.key)}
                    getDraft={(product) => getDraft(combo.key, product)}
                    onPatch={(product, patch) => patchDraft(combo.key, product, patch)}
                    onSaveCard={(product) => saveCard(combo.key, product)}
                    isSaving={(product) => savingCard === cardId(combo.key, product)}
                    isCalibrated={(product) => isCalibrated(combo.key, product)}
                  />
                ))}
              </div>
            )}

            {!loading && !error && data && (
              <div className="mt-5 pt-4 border-t border-[#E5E7EB] flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] text-[#6B7280]">
                  {totalCalibrated} of {COMBOS.length * PRODUCT_CATEGORIES.length} cards calibrated.
                  The rest stay dormant until a line needs them.
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {duplicated ? (
                    <span className="text-[12px] text-[#059669] font-medium">
                      ✓ Blank {otherAppLabel.toLowerCase()} combos created
                    </span>
                  ) : (
                    <button
                      onClick={duplicateForOtherApplication}
                      disabled={duplicating}
                      className="px-3 py-2 text-sm text-[#2563EB] hover:bg-[#EFF6FF] rounded-md border border-[#E5E7EB] hover:border-[#2563EB] transition-colors disabled:opacity-50"
                      title={`Creates four blank ${otherAppLabel.toLowerCase()} combo rows so they show up in the composer's ${otherAppLabel.toLowerCase()} dropdown. You calibrate them later in context.`}
                    >
                      {duplicating ? 'Duplicating…' : `Duplicate as ${otherAppLabel}`}
                    </button>
                  )}
                  <button
                    onClick={onComplete}
                    className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-md hover:bg-[#1D4ED8] transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── One collapsible combo row ──

function ComboRow(p: {
  combo: FinishCombo
  data: ComboData
  expanded: boolean
  onToggle: () => void
  getDraft: (product: ProductCategory) => CardValues
  onPatch: (product: ProductCategory, patch: Partial<CardValues>) => void
  onSaveCard: (product: ProductCategory) => void
  isSaving: (product: ProductCategory) => boolean
  isCalibrated: (product: ProductCategory) => boolean
}) {
  const calibratedCount = PRODUCT_CATEGORIES.filter((pc) => p.isCalibrated(pc.key)).length
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={p.onToggle}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F9FAFB] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {p.expanded ? (
            <ChevronDown className="w-4 h-4 text-[#6B7280] shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[#6B7280] shrink-0" />
          )}
          <div className="text-[14px] font-semibold text-[#111] truncate">{p.combo.name}</div>
        </div>
        <div className="text-[11px] text-[#6B7280] shrink-0">
          {calibratedCount} of {PRODUCT_CATEGORIES.length} calibrated
        </div>
      </button>
      {p.expanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          {PRODUCT_CATEGORIES.map((pc) => (
            <CabHeightCard
              key={pc.key}
              combo={p.combo}
              product={pc.key}
              productLabel={pc.label}
              values={p.getDraft(pc.key)}
              calibrated={p.isCalibrated(pc.key)}
              saving={p.isSaving(pc.key)}
              onPatch={(patch) => p.onPatch(pc.key, patch)}
              onSave={() => p.onSaveCard(pc.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── One cab-height card ──

function CabHeightCard(p: {
  combo: FinishCombo
  product: ProductCategory
  productLabel: string
  values: CardValues
  calibrated: boolean
  saving: boolean
  onPatch: (patch: Partial<CardValues>) => void
  onSave: () => void
}) {
  return (
    <div
      className={
        'bg-white border rounded-lg p-3 ' +
        (p.calibrated ? 'border-[#E5E7EB]' : 'border-[#2563EB]/40')
      }
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-semibold text-[#111]">{p.productLabel}</div>
        <span
          className={
            'text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border ' +
            (p.calibrated
              ? 'bg-[#DCFCE7] text-[#059669] border-[#BBF7D0]'
              : 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]')
          }
        >
          {p.calibrated ? 'Calibrated' : 'Empty'}
        </span>
      </div>

      <div className="space-y-2.5">
        <NumberField
          label="Hours for 8′ run"
          value={p.values.hours}
          step={0.25}
          onChange={(v) => p.onPatch({ hours: v })}
        />
        {p.combo.fields.map((f) => (
          <NumberField
            key={f}
            label={`${FIELD_LABEL[f]} $ (8′ run)`}
            value={p.values[f]}
            step={1}
            onChange={(v) => p.onPatch({ [f]: v } as Partial<CardValues>)}
          />
        ))}
      </div>

      <button
        onClick={p.onSave}
        disabled={p.saving}
        className="mt-3 w-full px-3 py-1.5 bg-[#2563EB] text-white text-[12px] font-semibold rounded-md hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
      >
        {p.saving ? 'Saving…' : p.calibrated ? 'Update' : 'Save'}
      </button>
    </div>
  )
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[#9CA3AF] flex-1 min-w-0 truncate">{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          onChange(Number.isFinite(v) && v >= 0 ? v : 0)
        }}
        className="w-20 text-right font-mono text-[12px] px-2 py-1 bg-white border border-[#E5E7EB] rounded-md text-[#111] outline-none focus:border-[#2563EB]"
      />
    </div>
  )
}

// ── Storage: ensure finish items exist + load existing breakdown ──

async function ensureAndLoadFinishData(
  orgId: string,
  application: 'interior' | 'exterior'
): Promise<Record<string, ComboData>> {
  // 1. Find-or-create the finish category.
  const categoryId = await ensureFinishCategory(orgId)

  // 2. Ensure the 4 combo items exist for this application. Prefinished
  //    is no longer a rate-book row — the composer synthesizes it
  //    client-side for the Interior dropdown.
  const idByComboKey: Record<string, string> = {}
  for (const combo of COMBOS) {
    const id = await ensureFinishItem(orgId, categoryId, combo.name, application)
    idByComboKey[combo.key] = id
  }

  // 3. Load all breakdown rows for this org's finish items in one go.
  const itemIds = Object.values(idByComboKey)
  const { data: rows } = await supabase
    .from('rate_book_finish_breakdown')
    .select(
      'rate_book_item_id, product_category, labor_hr_per_lf, primer_cost_per_lf, paint_cost_per_lf, stain_cost_per_lf, lacquer_cost_per_lf'
    )
    .in('rate_book_item_id', itemIds)

  // 4. Shape into { [comboKey]: { itemId, byProduct: { base?, upper?, full? } } }.
  const out: Record<string, ComboData> = {}
  for (const combo of COMBOS) {
    out[combo.key] = {
      itemId: idByComboKey[combo.key],
      byProduct: { base: null, upper: null, full: null },
    }
  }
  for (const r of (rows || []) as Array<{
    rate_book_item_id: string
    product_category: string
    labor_hr_per_lf: number | null
    primer_cost_per_lf: number | null
    paint_cost_per_lf: number | null
    stain_cost_per_lf: number | null
    lacquer_cost_per_lf: number | null
  }>) {
    const comboKey = Object.entries(idByComboKey).find(([, id]) => id === r.rate_book_item_id)?.[0]
    if (!comboKey) continue
    const pc = r.product_category as ProductCategory
    if (pc !== 'base' && pc !== 'upper' && pc !== 'full') continue
    out[comboKey].byProduct[pc] = {
      hours:   Number(r.labor_hr_per_lf)     || 0,
      primer:  Number(r.primer_cost_per_lf)  || 0,
      paint:   Number(r.paint_cost_per_lf)   || 0,
      stain:   Number(r.stain_cost_per_lf)   || 0,
      lacquer: Number(r.lacquer_cost_per_lf) || 0,
    }
  }
  return out
}

async function ensureFinishCategory(orgId: string): Promise<string> {
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('item_type', 'finish')
    .eq('active', true)
  const rows = (cats || []) as Array<{ id: string; name: string }>
  const named = rows.find((c) => c.name?.toLowerCase() === FINISHES_CATEGORY_NAME.toLowerCase())
  if (named) return named.id
  if (rows.length > 0) return rows[0].id
  const { data: created, error } = await supabase
    .from('rate_book_categories')
    .insert({
      org_id: orgId,
      name: FINISHES_CATEGORY_NAME,
      item_type: 'finish',
      active: true,
      display_order: 0,
    })
    .select('id')
    .single()
  if (error) throw error
  return (created as { id: string }).id
}

async function ensureFinishItem(
  orgId: string,
  categoryId: string,
  name: string,
  application: 'interior' | 'exterior'
): Promise<string> {
  // Match by (name, application) — same recipe on interior vs exterior
  // is two rows. Don't bucket them together by name alone.
  const { data: existing } = await supabase
    .from('rate_book_items')
    .select('id')
    .eq('org_id', orgId)
    .eq('category_id', categoryId)
    .eq('application', application)
    .ilike('name', name)
    .limit(1)
  const row = (existing || [])[0] as { id: string } | undefined
  if (row) return row.id

  const { data: created, error } = await supabase
    .from('rate_book_items')
    .insert({
      org_id: orgId,
      category_id: categoryId,
      name,
      unit: 'lf',
      material_mode: 'none',
      sheets_per_unit: 0,
      sheet_cost: 0,
      linear_cost: 0,
      lump_cost: 0,
      hardware_cost: 0,
      confidence: 'untested',
      active: true,
      application,
    })
    .select('id')
    .single()
  if (error) throw error
  return (created as { id: string }).id
}

async function upsertBreakdown(
  itemId: string,
  product: ProductCategory,
  perLf: {
    labor_hr_per_lf: number
    primer_cost_per_lf: number
    paint_cost_per_lf: number
    stain_cost_per_lf: number
    lacquer_cost_per_lf: number
  }
): Promise<void> {
  const { error } = await supabase
    .from('rate_book_finish_breakdown')
    .upsert(
      {
        rate_book_item_id: itemId,
        product_category: product,
        ...perLf,
        calibrated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'rate_book_item_id,product_category' }
    )
  if (error) throw error
}

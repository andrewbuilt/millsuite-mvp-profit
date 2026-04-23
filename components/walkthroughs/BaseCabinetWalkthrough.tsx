'use client'

// ============================================================================
// BaseCabinetWalkthrough — first-login base-cabinet calibration
// ============================================================================
// Per BUILD-ORDER Phase 12 item 4. One 8' run of base cabinets across 5
// guided inputs (Eng / CNC / Machining / Assembly / Finish). Machining
// folds into Assembly on save — the output stored on the rate book is
// four per-LF dept values. Doors are out of scope here; DoorStyleWalkthrough
// (item 7) owns that calibration.
//
// Why machining is surfaced as its own input even though it folds into
// Assembly: shops under-report assembly time when asked "how long is
// assembly?" — pulling machining out with its own question (jointer,
// planer, shaper, rails & stiles) forces it onto the tape. The fold
// happens on save so the composer math stays clean at four dept buckets.
//
// Save path:
//   divide each hour input by 8 → per-LF
//   machining per-LF + assembly per-LF → combined assembly per-LF
//   find-or-create one rate_book_item per org named "Base cabinet"
//       (category.item_type='cabinet_style', create category if missing)
//   write base_labor_hours_{eng,cnc,assembly,finish} on the item
//   leave base_labor_hours_install at 0 (install has its own subproject)
//   then onComplete()
//
// Embeddable. Props:
//   orgId       — caller resolves (useAuth() in the overlay)
//   onComplete  — fired after the rate_book_item write succeeds
//   onCancel    — optional; shown as a ghost "Back" link when provided
//
// Scope:
//   - No sanity-warning banner yet (the threshold rules in the deferred
//     9-step spec can come with that spec's own V2 lift)
//   - No doors, no interior/exterior material capture — those calibrate
//     elsewhere (door walkthrough; composer's inline "+ Add new material")
// ============================================================================

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  orgId: string
  onComplete: () => void
  onCancel?: () => void
}

type InputKey = 'eng' | 'cnc' | 'machining' | 'assembly' | 'finish'

interface InputConfig {
  key: InputKey
  label: string
  dept: string
  helper: string
}

// Labels borrow phrasing from the 9-step spec (user approval to borrow
// "build-order" phrasing for UX) — an estimator answers concretely about
// real operations rather than abstract dept buckets.
const INPUTS: InputConfig[] = [
  {
    key: 'eng',
    label: 'Shop drawings + CNC program',
    dept: 'Engineering',
    helper: 'Layout, details, nesting for an 8′ run. Often 0 if you cut by hand.',
  },
  {
    key: 'cnc',
    label: 'Cut interior parts',
    dept: 'CNC',
    helper: 'Bottom, sides, dividers, nailers, adjustable shelves. 0 if hand-cut.',
  },
  {
    key: 'machining',
    label: 'Wood machining',
    dept: 'Assembly',
    helper: 'Jointer, planer, shaper, rails & stiles. Folds into Assembly on save — asked separately so it doesn’t get lost.',
  },
  {
    key: 'assembly',
    label: 'Box assembly + final assembly',
    dept: 'Assembly',
    helper: 'Edgebanding, glue-up, sand, square. Hinge plates, shelf pin sleeves, wrap.',
  },
  {
    key: 'finish',
    label: 'Finish',
    dept: 'Finish',
    helper: 'Prep + clear matte lacquer, sanded between coats.',
  },
]

const BASE_CABINET_ITEM_NAME = 'Base cabinet'
const CABINETS_CATEGORY_NAME = 'Cabinets'

export default function BaseCabinetWalkthrough({ orgId, onComplete, onCancel }: Props) {
  const [hours, setHours] = useState<Record<InputKey, number>>({
    eng: 0,
    cnc: 0,
    machining: 0,
    assembly: 0,
    finish: 0,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalHours = INPUTS.reduce((s, i) => s + (hours[i.key] || 0), 0)

  function setHour(key: InputKey, value: string) {
    const v = value === '' ? 0 : Number(value)
    setHours((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }))
  }

  function stepHour(key: InputKey, delta: number) {
    setHours((prev) => {
      const next = (prev[key] || 0) + delta
      return { ...prev, [key]: next < 0 ? 0 : Math.round(next * 100) / 100 }
    })
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      // Fold machining into assembly, divide everything by 8 → per-LF.
      const perLf = {
        eng: (hours.eng || 0) / 8,
        cnc: (hours.cnc || 0) / 8,
        assembly: ((hours.assembly || 0) + (hours.machining || 0)) / 8,
        finish: (hours.finish || 0) / 8,
      }
      await saveBaseCabinetCalibration(orgId, perLf)
      onComplete()
    } catch (err: any) {
      setError(err?.message || 'Failed to save calibration')
    } finally {
      setSaving(false)
    }
  }

  const canSave = totalHours > 0

  return (
    <div className="max-w-[620px] mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1.5">
          Step 2 · Base cabinet
        </div>
        <h2 className="text-[22px] font-semibold text-[#111] tracking-tight mb-2">
          How long does one 8′ run of base cabinets take your shop?
        </h2>
        <p className="text-sm text-[#6B7280] leading-relaxed">
          Answer in hours for a single 8-foot run of base cabinets.
          Quarter-hour or whole-hour increments. Anything can be 0 if you
          don’t do it — doors are a separate walkthrough later.
        </p>
      </div>

      <div className="space-y-2.5 mb-5">
        {INPUTS.map((i) => (
          <div
            key={i.key}
            className="px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg"
          >
            <div className="flex items-center justify-between gap-4 mb-1.5">
              <div className="min-w-0">
                <label htmlFor={`hr-${i.key}`} className="text-sm font-medium text-[#111] block">
                  {i.label}
                </label>
                <div className="text-[11px] text-[#9CA3AF] uppercase tracking-wider">
                  {i.dept}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => stepHour(i.key, -0.25)}
                  disabled={saving || hours[i.key] <= 0}
                  className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                  aria-label={`Decrease ${i.dept} hours`}
                >
                  −
                </button>
                <input
                  id={`hr-${i.key}`}
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min="0"
                  value={hours[i.key] === 0 ? '' : hours[i.key]}
                  placeholder="0"
                  onChange={(e) => setHour(i.key, e.target.value)}
                  disabled={saving}
                  className="w-16 text-center font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => stepHour(i.key, 0.25)}
                  disabled={saving}
                  className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] disabled:opacity-40 text-sm"
                  aria-label={`Increase ${i.dept} hours`}
                >
                  +
                </button>
                <span className="text-[11px] text-[#9CA3AF] ml-1">hr</span>
              </div>
            </div>
            <p className="text-[12px] text-[#6B7280] leading-relaxed">{i.helper}</p>
          </div>
        ))}
      </div>

      {/* Running total — informational, drives canSave at > 0 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#1D4ED8]">
          Total for 8′ run
        </span>
        <span className="font-mono tabular-nums text-sm font-semibold text-[#1E3A8A]">
          {totalHours.toFixed(2)} hr
        </span>
      </div>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || !canSave}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save calibration'}
        </button>
      </div>
    </div>
  )
}

// ── Storage ──

/**
 * Find-or-create the org's "Base cabinet" rate_book_item and write the
 * per-LF dept labor. Separate from updateShopLaborRate because this is the
 * first rate_book_item write for most orgs — we have to ensure a parent
 * cabinet_style category exists first.
 */
async function saveBaseCabinetCalibration(
  orgId: string,
  perLf: { eng: number; cnc: number; assembly: number; finish: number }
): Promise<void> {
  // 1. Find-or-create a cabinet_style category for this org. Prefer one
  //    already named "Cabinets"; otherwise take any cabinet_style category;
  //    otherwise create one. Org might have none on first run.
  let categoryId: string | null = null
  {
    const { data: cats } = await supabase
      .from('rate_book_categories')
      .select('id, name, item_type')
      .eq('org_id', orgId)
      .eq('item_type', 'cabinet_style')
      .eq('active', true)
    const rows = (cats || []) as Array<{ id: string; name: string; item_type: string }>
    const named = rows.find((c) => c.name?.toLowerCase() === CABINETS_CATEGORY_NAME.toLowerCase())
    if (named) categoryId = named.id
    else if (rows.length > 0) categoryId = rows[0].id
    else {
      const { data: created, error } = await supabase
        .from('rate_book_categories')
        .insert({
          org_id: orgId,
          name: CABINETS_CATEGORY_NAME,
          item_type: 'cabinet_style',
          active: true,
          display_order: 0,
        })
        .select('id')
        .single()
      if (error) throw error
      categoryId = (created as { id: string }).id
    }
  }

  // 2. Find-or-create the "Base cabinet" item under that category. Name
  //    match is case-insensitive to avoid re-creating if the user already
  //    typed one in differently.
  const { data: existing } = await supabase
    .from('rate_book_items')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('category_id', categoryId)
    .ilike('name', BASE_CABINET_ITEM_NAME)
    .limit(1)
  const existingRow = (existing || [])[0] as { id: string } | undefined

  const patch = {
    base_labor_hours_eng: perLf.eng,
    base_labor_hours_cnc: perLf.cnc,
    base_labor_hours_assembly: perLf.assembly,
    base_labor_hours_finish: perLf.finish,
    base_labor_hours_install: 0,
    updated_at: new Date().toISOString(),
  }

  if (existingRow) {
    const { error } = await supabase
      .from('rate_book_items')
      .update(patch)
      .eq('id', existingRow.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('rate_book_items').insert({
    org_id: orgId,
    category_id: categoryId,
    name: BASE_CABINET_ITEM_NAME,
    unit: 'lf',
    material_mode: 'sheets',
    sheets_per_unit: 0,
    sheet_cost: 0,
    linear_cost: 0,
    lump_cost: 0,
    hardware_cost: 0,
    confidence: 'untested',
    active: true,
    ...patch,
  })
  if (error) throw error
}

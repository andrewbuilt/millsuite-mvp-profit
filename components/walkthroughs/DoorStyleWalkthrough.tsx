'use client'

// ============================================================================
// DoorStyleWalkthrough — per-door labor calibration for one door style.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 7 + specs/add-line-composer/README.md.
//
// Calibration unit: 4 doors at 24" × 30" (one 8' run of base cabinets).
// Answers divide by 4 on save to yield per-door hours by dept. Wood
// machining is a guided sub-step that folds into Assembly before the
// divide — same contract as BaseCabinetWalkthrough.
//
// Two modes per spec, decided by how many door_labor_hours_* fields are
// empty on the target style:
//
//   - Full modal (5 steps, step-through progress dots) — new style,
//     or an existing style whose labor is ALL zero (gap = 4).
//   - Mini-card (compact all-fields form)              — existing style
//     with 1–3 zeros (a partial gap the user is filling in).
//
// Fires from the composer in three places:
//   (a) Dropdown: user picks an uncalibrated style.
//   (b) Dropdown: user clicks "+ Add new door style" → name + full modal.
//   (c) Empty-state hatch when the org has zero door styles yet.
//
// On complete:
//   - Find-or-create a rate_book_categories row with item_type='door_style'
//     for this org (create "Doors" on first run; otherwise reuse the first
//     door_style category).
//   - For "new style" flow: insert a rate_book_items row under that
//     category, return its id. For existing flow: update in place.
//   - Write door_labor_hours_{eng,cnc,assembly,finish} — per-door
//     (post-fold, post-divide).
//   - Call onComplete(styleId).
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Dept = 'eng' | 'cnc' | 'machining' | 'assembly' | 'finish'

interface StepConfig {
  key: Dept
  heading: string
  bucketLabel: string
  prompt: string
}

const STEPS: StepConfig[] = [
  {
    key: 'eng',
    heading: 'Engineering',
    bucketLabel: 'Engineering',
    prompt: 'CAD / layout time for 4 doors. Zero is normal.',
  },
  {
    key: 'cnc',
    heading: 'CNC',
    bucketLabel: 'CNC',
    prompt: 'CNC time for 4 doors. Zero if you cut them by hand.',
  },
  {
    key: 'machining',
    heading: 'Wood machining',
    bucketLabel: 'Assembly',
    prompt:
      'Rails & stiles, jointer, planer, shaper — for 4 doors. Folds into Assembly on save — asked separately so it doesn\u2019t get lost.',
  },
  {
    key: 'assembly',
    heading: 'Assembly',
    bucketLabel: 'Assembly',
    prompt: 'Glue-up, square, sand — for 4 doors.',
  },
  {
    key: 'finish',
    heading: 'Finish',
    bucketLabel: 'Finish',
    prompt: 'Spray and flip 4 doors.',
  },
]

const DIVIDE_BY = 4 // calibration unit size

// ── Props ──

export interface DoorStyleWalkthroughExistingStyle {
  id: string
  name: string
  /** Per-door labor currently in the DB. Used to populate mini-card inputs
   *  and to decide full-modal-vs-mini-card via the gap count. */
  labor: {
    eng: number
    cnc: number
    assembly: number
    finish: number
  }
}

interface Props {
  orgId: string
  /** Existing style — mini-card mode if labor has any non-zero dept,
   *  full-modal if all zero. Absent = new-style full-modal flow. */
  existingStyle?: DoorStyleWalkthroughExistingStyle | null
  /** Prefill the name input on new-style flow (e.g. user typed it before
   *  clicking "+ Add new door style"). */
  defaultName?: string
  onComplete: (styleId: string) => void
  onCancel: () => void
}

// Internal state: hours entered by step. Machining is a separate bucket
// in the walkthrough; folded into Assembly on save.
type HoursByStep = Record<Dept, number>

export default function DoorStyleWalkthrough({
  orgId,
  existingStyle,
  defaultName,
  onComplete,
  onCancel,
}: Props) {
  // ── Initial hours + mode ──

  const initialHours: HoursByStep = useMemo(() => {
    if (!existingStyle) {
      return { eng: 0, cnc: 0, machining: 0, assembly: 0, finish: 0 }
    }
    // For mini-card mode, pre-fill the per-door existing values back up to
    // "hours for 4 doors" so the user edits in the same unit the
    // walkthrough asks in.
    return {
      eng: existingStyle.labor.eng * DIVIDE_BY,
      cnc: existingStyle.labor.cnc * DIVIDE_BY,
      machining: 0, // machining always starts at 0 — there's no stored
                    // machining value (it was already folded in on last save)
      assembly: existingStyle.labor.assembly * DIVIDE_BY,
      finish: existingStyle.labor.finish * DIVIDE_BY,
    }
  }, [existingStyle])

  const isNewStyle = !existingStyle
  const gapCount = useMemo(() => {
    if (!existingStyle) return 4 // new style = all zeros
    const l = existingStyle.labor
    return [l.eng, l.cnc, l.assembly, l.finish].filter((v) => !v || v <= 0).length
  }, [existingStyle])
  const mode: 'modal' | 'card' = gapCount === 4 ? 'modal' : 'card'

  // ── State ──

  const [name, setName] = useState(existingStyle?.name || defaultName || '')
  const [hours, setHours] = useState<HoursByStep>(initialHours)
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when props change (different style picked).
  useEffect(() => {
    setName(existingStyle?.name || defaultName || '')
    setHours(initialHours)
    setStepIdx(0)
    setError(null)
  }, [existingStyle, defaultName, initialHours])

  // ── Input helpers ──

  function setHour(key: Dept, value: string) {
    const v = value === '' ? 0 : Number(value)
    setHours((prev) => ({ ...prev, [key]: Number.isFinite(v) && v >= 0 ? v : 0 }))
  }
  function stepHour(key: Dept, delta: number) {
    setHours((prev) => {
      const next = Math.max(0, (prev[key] || 0) + delta)
      return { ...prev, [key]: Math.round(next * 100) / 100 }
    })
  }

  // ── Save ──

  async function save() {
    setError(null)
    if (isNewStyle && !name.trim()) {
      setError('Give the door style a name.')
      return
    }
    setSaving(true)
    try {
      // Fold machining into assembly, divide everything by 4 → per-door.
      const foldedAssembly = (hours.assembly || 0) + (hours.machining || 0)
      const perDoor = {
        eng: (hours.eng || 0) / DIVIDE_BY,
        cnc: (hours.cnc || 0) / DIVIDE_BY,
        assembly: foldedAssembly / DIVIDE_BY,
        finish: (hours.finish || 0) / DIVIDE_BY,
      }
      const styleId = await saveDoorStyleCalibration({
        orgId,
        existingStyleId: existingStyle?.id ?? null,
        name: name.trim() || 'Door style',
        perDoor,
      })
      onComplete(styleId)
    } catch (err: any) {
      setError(err?.message || 'Failed to save door style')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] bg-[#0F172A]/85 backdrop-blur-sm flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        {mode === 'modal' ? (
          <FullModal
            name={name}
            isNewStyle={isNewStyle}
            hours={hours}
            stepIdx={stepIdx}
            saving={saving}
            error={error}
            onName={setName}
            onHour={setHour}
            onStep={stepHour}
            onBack={() => setStepIdx((i) => Math.max(0, i - 1))}
            onNext={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
            onCancel={onCancel}
            onSave={save}
          />
        ) : (
          <MiniCard
            name={name}
            hours={hours}
            saving={saving}
            error={error}
            existingLabor={existingStyle!.labor}
            onHour={setHour}
            onStep={stepHour}
            onCancel={onCancel}
            onSave={save}
          />
        )}
      </div>
    </div>
  )
}

// ── Full modal: step-through for a new or all-zero style ──

function FullModal(p: {
  name: string
  isNewStyle: boolean
  hours: HoursByStep
  stepIdx: number
  saving: boolean
  error: string | null
  onName: (v: string) => void
  onHour: (key: Dept, v: string) => void
  onStep: (key: Dept, delta: number) => void
  onBack: () => void
  onNext: () => void
  onCancel: () => void
  onSave: () => void
}) {
  // Step 0 on a new style = name input. Otherwise step 0 = first dept (Eng).
  const showNameAsFirstStep = p.isNewStyle && p.stepIdx === 0
  const displayStepIdx = p.isNewStyle ? Math.max(0, p.stepIdx - 1) : p.stepIdx
  const totalSteps = p.isNewStyle ? STEPS.length + 1 : STEPS.length
  const currentPos = p.isNewStyle ? p.stepIdx : p.stepIdx

  const isLast = showNameAsFirstStep ? false : displayStepIdx === STEPS.length - 1

  return (
    <div className="max-w-[620px] w-full bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl text-[#e5e5e5] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
        <div className="text-[13px] font-semibold text-white">
          {p.isNewStyle ? 'New door style' : p.name || 'Door style'} · calibration
        </div>
        <button
          onClick={p.onCancel}
          className="p-1 text-[#6B7280] hover:text-white rounded"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 px-5 pt-4">
        {Array.from({ length: totalSteps }).map((_, i) => {
          const state =
            i < currentPos ? 'done' : i === currentPos ? 'current' : 'future'
          const cls =
            state === 'current'
              ? 'bg-[#3B82F6]'
              : state === 'done'
              ? 'bg-[#1D4ED8]'
              : 'bg-[#1f1f1f]'
          return <div key={i} className={`h-1 flex-1 rounded-full ${cls}`} />
        })}
      </div>

      <div className="p-5">
        {showNameAsFirstStep ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] mb-1">
              Step 1 of {totalSteps} · Name this door style
            </div>
            <h2 className="text-[20px] font-semibold text-white mb-2">
              What do you call this door style?
            </h2>
            <p className="text-sm text-[#9CA3AF] leading-relaxed mb-5">
              The name appears in the composer dropdown. "Shaker," "Slab,"
              "Reveal-edge slab," anything that reads like what you build.
            </p>
            <input
              type="text"
              value={p.name}
              onChange={(e) => p.onName(e.target.value)}
              placeholder="e.g. Shaker"
              className="w-full bg-[#141414] border border-[#1f1f1f] rounded-md px-3 py-2.5 text-sm text-[#eee] outline-none focus:border-[#3b82f6]"
              autoFocus
            />
          </div>
        ) : (
          <StepContent
            step={STEPS[displayStepIdx]}
            stepNum={p.isNewStyle ? displayStepIdx + 2 : displayStepIdx + 1}
            totalSteps={totalSteps}
            value={p.hours[STEPS[displayStepIdx].key]}
            onChange={(v) => p.onHour(STEPS[displayStepIdx].key, v)}
            onStep={(d) => p.onStep(STEPS[displayStepIdx].key, d)}
          />
        )}

        {p.error && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#1e1018] border border-[#3b1c24] rounded-lg text-sm text-[#fecaca]">
            {p.error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <div>
            {p.stepIdx > 0 && (
              <button
                onClick={p.onBack}
                disabled={p.saving}
                className="text-sm text-[#6B7280] hover:text-white disabled:opacity-50"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={p.onCancel}
              disabled={p.saving}
              className="px-3 py-2 text-sm text-[#6B7280] hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            {isLast ? (
              <button
                onClick={p.onSave}
                disabled={p.saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3B82F6] text-white text-sm font-semibold rounded-lg hover:bg-[#2563EB] disabled:opacity-50"
              >
                {p.saving ? 'Saving…' : 'Save to rate book'}
              </button>
            ) : (
              <button
                onClick={p.onNext}
                disabled={p.saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3B82F6] text-white text-sm font-semibold rounded-lg hover:bg-[#2563EB] disabled:opacity-50"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepContent({
  step,
  stepNum,
  totalSteps,
  value,
  onChange,
  onStep,
}: {
  step: StepConfig
  stepNum: number
  totalSteps: number
  value: number
  onChange: (v: string) => void
  onStep: (delta: number) => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] mb-1">
        Step {stepNum} of {totalSteps} · {step.bucketLabel}
      </div>
      <h2 className="text-[20px] font-semibold text-white mb-2">
        {step.heading} · hours for 4 doors (24" × 30")
      </h2>
      <p className="text-sm text-[#9CA3AF] leading-relaxed mb-5">{step.prompt}</p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onStep(-0.25)}
          className="w-9 h-9 rounded-md border border-[#1f1f1f] bg-[#111] text-[#9CA3AF] hover:text-white text-base"
          aria-label="Decrease"
        >
          −
        </button>
        <input
          type="number"
          min="0"
          step="0.25"
          value={value === 0 ? '' : value}
          placeholder="0"
          onChange={(e) => onChange(e.target.value)}
          className="w-24 text-center font-mono text-base px-3 py-2 bg-[#141414] border border-[#1f1f1f] rounded-md text-[#eee] outline-none focus:border-[#3b82f6]"
          autoFocus
        />
        <button
          onClick={() => onStep(0.25)}
          className="w-9 h-9 rounded-md border border-[#1f1f1f] bg-[#111] text-[#9CA3AF] hover:text-white text-base"
          aria-label="Increase"
        >
          +
        </button>
        <span className="text-sm text-[#6B7280] ml-2">hours · 0 is fine</span>
      </div>
    </div>
  )
}

// ── Mini-card: compact all-fields form for partial gaps ──

function MiniCard(p: {
  name: string
  hours: HoursByStep
  saving: boolean
  error: string | null
  existingLabor: { eng: number; cnc: number; assembly: number; finish: number }
  onHour: (key: Dept, v: string) => void
  onStep: (key: Dept, delta: number) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="max-w-[620px] w-full bg-[#0D0D0D] border border-[#1a1a1a] rounded-2xl text-[#e5e5e5] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
        <div className="text-[13px] font-semibold text-white">
          {p.name || 'Door style'} · fill in the gaps
        </div>
        <button
          onClick={p.onCancel}
          className="p-1 text-[#6B7280] hover:text-white rounded"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5">
        <p className="text-sm text-[#9CA3AF] leading-relaxed mb-5">
          Some departments already have hours from a previous calibration.
          Fill in the missing ones — hours for <b>4 doors at 24" × 30"</b>.
          Machining folds into Assembly on save.
        </p>

        <div className="space-y-3">
          {STEPS.map((step) => {
            const existingValue =
              step.key === 'machining' ? 0 : p.existingLabor[step.key as keyof typeof p.existingLabor] || 0
            const isFilled = existingValue > 0
            return (
              <div
                key={step.key}
                className={
                  'p-3 bg-[#141414] border rounded-lg ' +
                  (isFilled ? 'border-[#1f1f1f] opacity-60' : 'border-[#3b82f6]/40')
                }
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">{step.heading}</div>
                    <div className="text-[10.5px] text-[#6B7280] uppercase tracking-wider">
                      {step.bucketLabel}
                      {isFilled && <span className="ml-1 text-[#4ade80]">· already calibrated</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => p.onStep(step.key, -0.25)}
                      className="w-7 h-7 rounded-md border border-[#1f1f1f] bg-[#0d0d0d] text-[#9CA3AF] hover:text-white text-sm"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="0.25"
                      value={p.hours[step.key] === 0 ? '' : p.hours[step.key]}
                      placeholder="0"
                      onChange={(e) => p.onHour(step.key, e.target.value)}
                      className="w-20 text-center font-mono text-sm px-2 py-1 bg-[#0d0d0d] border border-[#1f1f1f] rounded-md text-[#eee] outline-none focus:border-[#3b82f6]"
                    />
                    <button
                      onClick={() => p.onStep(step.key, 0.25)}
                      className="w-7 h-7 rounded-md border border-[#1f1f1f] bg-[#0d0d0d] text-[#9CA3AF] hover:text-white text-sm"
                    >
                      +
                    </button>
                    <span className="text-[11px] text-[#6B7280] ml-1">hr / 4</span>
                  </div>
                </div>
                <p className="text-[11.5px] text-[#6B7280] leading-snug">{step.prompt}</p>
              </div>
            )
          })}
        </div>

        {p.error && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#1e1018] border border-[#3b1c24] rounded-lg text-sm text-[#fecaca]">
            {p.error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={p.onCancel}
            disabled={p.saving}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={p.onSave}
            disabled={p.saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#3B82F6] text-white text-sm font-semibold rounded-lg hover:bg-[#2563EB] disabled:opacity-50"
          >
            {p.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Storage ──

const DOORS_CATEGORY_NAME = 'Doors'

/**
 * Find-or-create the org's door_style category, then insert or update
 * the named rate_book_item and its per-door labor. Returns the item's
 * id so the composer can select it.
 */
async function saveDoorStyleCalibration(input: {
  orgId: string
  existingStyleId: string | null
  name: string
  perDoor: { eng: number; cnc: number; assembly: number; finish: number }
}): Promise<string> {
  const { orgId, existingStyleId, name, perDoor } = input

  // 1. Find-or-create a door_style category for this org.
  let categoryId: string | null = null
  {
    const { data: cats } = await supabase
      .from('rate_book_categories')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('item_type', 'door_style')
      .eq('active', true)
    const rows = (cats || []) as Array<{ id: string; name: string }>
    const named = rows.find((c) => c.name?.toLowerCase() === DOORS_CATEGORY_NAME.toLowerCase())
    if (named) categoryId = named.id
    else if (rows.length > 0) categoryId = rows[0].id
    else {
      const { data: created, error } = await supabase
        .from('rate_book_categories')
        .insert({
          org_id: orgId,
          name: DOORS_CATEGORY_NAME,
          item_type: 'door_style',
          active: true,
          display_order: 0,
        })
        .select('id')
        .single()
      if (error) throw error
      categoryId = (created as { id: string }).id
    }
  }

  const patch = {
    door_labor_hours_eng: perDoor.eng,
    door_labor_hours_cnc: perDoor.cnc,
    door_labor_hours_assembly: perDoor.assembly,
    door_labor_hours_finish: perDoor.finish,
    updated_at: new Date().toISOString(),
  }

  // 2. Update existing, or insert new.
  if (existingStyleId) {
    const { error } = await supabase
      .from('rate_book_items')
      .update({ ...patch, name })
      .eq('id', existingStyleId)
    if (error) throw error
    return existingStyleId
  }

  const { data, error } = await supabase
    .from('rate_book_items')
    .insert({
      org_id: orgId,
      category_id: categoryId,
      name,
      unit: 'each',
      material_mode: 'none',
      sheets_per_unit: 0,
      sheet_cost: 0,
      linear_cost: 0,
      lump_cost: 0,
      hardware_cost: 0,
      confidence: 'untested',
      active: true,
      ...patch,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

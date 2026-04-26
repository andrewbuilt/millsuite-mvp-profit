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
import { saveDoorTypeCalibration } from '@/lib/door-types'

// Door pricing v2 (PR #74 + cleanup): finish labor + material live on
// door_type_material_finishes (per-finish), not on the door type itself.
// The walkthrough captures only construction labor — Finish step is gone.
type Dept = 'eng' | 'cnc' | 'machining' | 'assembly'

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
    prompt: 'Solid wood processing if applicable. Folds into Assembly on save.',
  },
  {
    key: 'assembly',
    heading: 'Assembly',
    bucketLabel: 'Assembly',
    prompt: 'Glue-up, square, sand. For 4 doors.',
  },
]

const DIVIDE_BY = 4 // calibration unit size

// ── Props ──

export interface DoorStyleWalkthroughExistingStyle {
  id: string
  name: string
  /** Per-door labor currently in the DB. Used to populate mini-card inputs
   *  and to decide full-modal-vs-mini-card via the gap count. The legacy
   *  finish field is preserved on the type for back-compat but ignored
   *  by the walkthrough — finish labor lives on the per-finish row now. */
  labor: {
    eng: number
    cnc: number
    assembly: number
    finish?: number
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
      return { eng: 0, cnc: 0, machining: 0, assembly: 0 }
    }
    return {
      eng: existingStyle.labor.eng * DIVIDE_BY,
      cnc: existingStyle.labor.cnc * DIVIDE_BY,
      machining: 0, // machining always starts at 0 — there's no stored
                    // machining value (it was already folded in on last save)
      assembly: existingStyle.labor.assembly * DIVIDE_BY,
    }
  }, [existingStyle])

  const isNewStyle = !existingStyle
  const gapCount = useMemo(() => {
    // Three calibratable depts now (eng / cnc / assembly). All-zero =
    // full-modal step-through; any non-zero entry = mini-card gap-fill.
    if (!existingStyle) return 3
    const l = existingStyle.labor
    return [l.eng, l.cnc, l.assembly].filter((v) => !v || v <= 0).length
  }, [existingStyle])
  const mode: 'modal' | 'card' = gapCount === 3 ? 'modal' : 'card'

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
      // Finish step is gone (door pricing v2): finish labor lives on the
      // per-finish row, not the door type. perDoor.finish stays 0 in the
      // payload so saveDoorTypeCalibration's NOT NULL DEFAULT 0 column
      // takes the value cleanly. Existing rows that had a non-zero
      // labor_hours_finish are ignored on read by composer-loader.
      const foldedAssembly = (hours.assembly || 0) + (hours.machining || 0)
      const perDoor = {
        eng: (hours.eng || 0) / DIVIDE_BY,
        cnc: (hours.cnc || 0) / DIVIDE_BY,
        assembly: foldedAssembly / DIVIDE_BY,
        finish: 0,
      }
      // Door pricing v2: writes to door_types (not rate_book_items).
      // Hardware $ stays at 0 from this walkthrough — it's edited in the
      // rate-book detail view alongside the materials/finishes.
      const typeId = await saveDoorTypeCalibration({
        orgId,
        existingId: existingStyle?.id ?? null,
        name: name.trim() || 'Door type',
        perDoor,
        hardwareCost: 0,
      })
      onComplete(typeId)
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
      className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-[2px] flex flex-col overflow-y-auto"
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
            onNext={() =>
              setStepIdx((i) =>
                Math.min(isNewStyle ? STEPS.length : STEPS.length - 1, i + 1)
              )
            }
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
    <div className="max-w-[620px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
        <div className="text-[13px] font-semibold text-[#111]">
          {p.isNewStyle ? 'New door style' : p.name || 'Door style'} · calibration
        </div>
        <button
          onClick={p.onCancel}
          className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
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
              ? 'bg-[#2563EB]'
              : state === 'done'
              ? 'bg-[#93C5FD]'
              : 'bg-[#E5E7EB]'
          return <div key={i} className={`h-1 flex-1 rounded-full ${cls}`} />
        })}
      </div>

      <div className="p-5">
        {showNameAsFirstStep ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1">
              Step 1 of {totalSteps} · Name this door style
            </div>
            <h2 className="text-[20px] font-semibold text-[#111] mb-2">
              What do you call this door style?
            </h2>
            <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
              The name appears in the composer dropdown. "Shaker," "Slab,"
              anything that reads like what you build.
            </p>
            <input
              type="text"
              value={p.name}
              onChange={(e) => p.onName(e.target.value)}
              placeholder="e.g. Shaker"
              className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-2.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
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
          <div className="mt-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
            {p.error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <div>
            {p.stepIdx > 0 && (
              <button
                onClick={p.onBack}
                disabled={p.saving}
                className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={p.onCancel}
              disabled={p.saving}
              className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
            >
              Cancel
            </button>
            {isLast ? (
              <button
                onClick={p.onSave}
                disabled={p.saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
              >
                {p.saving ? 'Saving…' : 'Save to rate book'}
              </button>
            ) : (
              <button
                onClick={p.onNext}
                disabled={p.saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1">
        Step {stepNum} of {totalSteps} · {step.bucketLabel}
      </div>
      <h2 className="text-[20px] font-semibold text-[#111] mb-2">
        {step.heading} · hours for 4 doors (24" × 30")
      </h2>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">{step.prompt}</p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onStep(-0.25)}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-base"
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
          className="w-24 text-center font-mono text-base px-3 py-2 bg-white border border-[#E5E7EB] rounded-md text-[#111] outline-none focus:border-[#2563EB]"
          autoFocus
        />
        <button
          onClick={() => onStep(0.25)}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-base"
          aria-label="Increase"
        >
          +
        </button>
        <span className="text-sm text-[#9CA3AF] ml-2">hours · 0 is fine</span>
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
  existingLabor: { eng: number; cnc: number; assembly: number; finish?: number }
  onHour: (key: Dept, v: string) => void
  onStep: (key: Dept, delta: number) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="max-w-[620px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
        <div className="text-[13px] font-semibold text-[#111]">
          {p.name || 'Door style'} · fill in the gaps
        </div>
        <button
          onClick={p.onCancel}
          className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5">
        <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
          Some departments already have hours from a previous calibration.
          Fill in the missing ones. Hours for <b>4 doors at 24" × 30"</b>.
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
                  'p-3 border rounded-lg ' +
                  (isFilled
                    ? 'bg-[#F9FAFB] border-[#E5E7EB] opacity-70'
                    : 'bg-white border-[#2563EB]/40')
                }
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#111]">{step.heading}</div>
                    <div className="text-[10.5px] text-[#6B7280] uppercase tracking-wider">
                      {step.bucketLabel}
                      {isFilled && <span className="ml-1 text-[#059669]">· already calibrated</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => p.onStep(step.key, -0.25)}
                      className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-sm"
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
                      className="w-20 text-center font-mono text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md text-[#111] outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={() => p.onStep(step.key, 0.25)}
                      className="w-7 h-7 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-sm"
                    >
                      +
                    </button>
                    <span className="text-[11px] text-[#9CA3AF] ml-1">hr / 4</span>
                  </div>
                </div>
                <p className="text-[11.5px] text-[#6B7280] leading-snug">{step.prompt}</p>
              </div>
            )
          })}
        </div>

        {p.error && (
          <div className="mt-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
            {p.error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={p.onCancel}
            disabled={p.saving}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={p.onSave}
            disabled={p.saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
          >
            {p.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}


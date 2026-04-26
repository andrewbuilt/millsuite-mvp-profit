'use client'

// ============================================================================
// DrawerStyleWalkthrough — per-drawer labor calibration for one drawer style.
// ============================================================================
// Mirror of DoorStyleWalkthrough: 4-drawer calibration unit (one Base run)
// with hours divided by 4 on save. Wood machining folds into Assembly
// before the divide. Storage matches doors but writes to
// drawer_labor_hours_* columns under a category whose
// item_type='drawer_style'.
//
// Fires from the composer in three places:
//   (a) Dropdown: user picks an uncalibrated drawer style.
//   (b) Dropdown: user clicks "+ Add new drawer style" → name + full modal.
//   (c) Empty-state hatch when the org has zero drawer styles yet.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ensureRateBookCategoryId, upsertRateBookItem } from '@/lib/rate-book'

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
    prompt: 'CAD / layout time for 4 drawers. Zero is normal.',
  },
  {
    key: 'cnc',
    heading: 'CNC',
    bucketLabel: 'CNC',
    prompt: 'CNC time for 4 drawers. Zero if you cut them by hand.',
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
    prompt: 'Box build, slide install, drawer-front attach. For 4 drawers.',
  },
  {
    key: 'finish',
    heading: 'Finish',
    bucketLabel: 'Finish',
    prompt: 'Spray and flip 4 drawer fronts.',
  },
]

const DIVIDE_BY = 4

export interface DrawerStyleWalkthroughExistingStyle {
  id: string
  name: string
  labor: {
    eng: number
    cnc: number
    assembly: number
    finish: number
  }
}

interface Props {
  orgId: string
  existingStyle?: DrawerStyleWalkthroughExistingStyle | null
  defaultName?: string
  onComplete: (styleId: string) => void
  onCancel: () => void
}

type HoursByStep = Record<Dept, number>

export default function DrawerStyleWalkthrough({
  orgId,
  existingStyle,
  defaultName,
  onComplete,
  onCancel,
}: Props) {
  const initialHours: HoursByStep = useMemo(() => {
    if (!existingStyle) {
      return { eng: 0, cnc: 0, machining: 0, assembly: 0, finish: 0 }
    }
    return {
      eng: existingStyle.labor.eng * DIVIDE_BY,
      cnc: existingStyle.labor.cnc * DIVIDE_BY,
      machining: 0,
      assembly: existingStyle.labor.assembly * DIVIDE_BY,
      finish: existingStyle.labor.finish * DIVIDE_BY,
    }
  }, [existingStyle])

  const isNewStyle = !existingStyle
  const gapCount = useMemo(() => {
    if (!existingStyle) return 4
    const l = existingStyle.labor
    return [l.eng, l.cnc, l.assembly, l.finish].filter((v) => !v || v <= 0).length
  }, [existingStyle])
  const mode: 'modal' | 'card' = gapCount === 4 ? 'modal' : 'card'

  const [name, setName] = useState(existingStyle?.name || defaultName || '')
  const [hours, setHours] = useState<HoursByStep>(initialHours)
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(existingStyle?.name || defaultName || '')
    setHours(initialHours)
    setStepIdx(0)
    setError(null)
  }, [existingStyle, defaultName, initialHours])

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

  async function save() {
    setError(null)
    if (isNewStyle && !name.trim()) {
      setError('Give the drawer style a name.')
      return
    }
    setSaving(true)
    try {
      const foldedAssembly = (hours.assembly || 0) + (hours.machining || 0)
      const perDrawer = {
        eng: (hours.eng || 0) / DIVIDE_BY,
        cnc: (hours.cnc || 0) / DIVIDE_BY,
        assembly: foldedAssembly / DIVIDE_BY,
        finish: (hours.finish || 0) / DIVIDE_BY,
      }
      const styleId = await saveDrawerStyleCalibration({
        orgId,
        existingStyleId: existingStyle?.id ?? null,
        name: name.trim() || 'Drawer style',
        perDrawer,
      })
      onComplete(styleId)
    } catch (err: any) {
      setError(err?.message || 'Failed to save drawer style')
    } finally {
      setSaving(false)
    }
  }

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
                Math.min(isNewStyle ? STEPS.length : STEPS.length - 1, i + 1),
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
  const showNameAsFirstStep = p.isNewStyle && p.stepIdx === 0
  const displayStepIdx = p.isNewStyle ? Math.max(0, p.stepIdx - 1) : p.stepIdx
  const totalSteps = p.isNewStyle ? STEPS.length + 1 : STEPS.length
  const currentPos = p.stepIdx
  const isLast = showNameAsFirstStep ? false : displayStepIdx === STEPS.length - 1

  return (
    <div className="max-w-[620px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
        <div className="text-[13px] font-semibold text-[#111]">
          {p.isNewStyle ? 'New drawer style' : p.name || 'Drawer style'} · calibration
        </div>
        <button
          onClick={p.onCancel}
          className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

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
              Step 1 of {totalSteps} · Name this drawer style
            </div>
            <h2 className="text-[20px] font-semibold text-[#111] mb-2">
              What do you call this drawer style?
            </h2>
            <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
              The name appears in the composer dropdown. "Standard," "Dovetail,"
              "Inset," anything that reads like what you build.
            </p>
            <input
              type="text"
              value={p.name}
              onChange={(e) => p.onName(e.target.value)}
              placeholder="e.g. Standard"
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
        {step.heading} · hours for 4 drawers
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
    <div className="max-w-[620px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
        <div className="text-[13px] font-semibold text-[#111]">
          {p.name || 'Drawer style'} · fill in the gaps
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
          Fill in the missing ones. Hours for <b>4 drawers</b>. Machining
          folds into Assembly on save.
        </p>

        <div className="space-y-3">
          {STEPS.map((step) => {
            const existingValue =
              step.key === 'machining'
                ? 0
                : p.existingLabor[step.key as keyof typeof p.existingLabor] || 0
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

const DRAWERS_CATEGORY_NAME = 'Drawers'

async function saveDrawerStyleCalibration(input: {
  orgId: string
  existingStyleId: string | null
  name: string
  perDrawer: { eng: number; cnc: number; assembly: number; finish: number }
}): Promise<string> {
  const { orgId, existingStyleId, name, perDrawer } = input

  const patch = {
    drawer_labor_hours_eng: perDrawer.eng,
    drawer_labor_hours_cnc: perDrawer.cnc,
    drawer_labor_hours_assembly: perDrawer.assembly,
    drawer_labor_hours_finish: perDrawer.finish,
    updated_at: new Date().toISOString(),
  }

  if (existingStyleId) {
    const { error } = await supabase
      .from('rate_book_items')
      .update({ ...patch, name })
      .eq('id', existingStyleId)
    if (error) throw error
    return existingStyleId
  }

  const categoryId = await ensureRateBookCategoryId(
    orgId,
    DRAWERS_CATEGORY_NAME,
    'drawer_style',
  )
  return await upsertRateBookItem({
    orgId,
    categoryId,
    name,
    patch,
    insertDefaults: {
      unit: 'each',
      material_mode: 'none',
      sheets_per_unit: 0,
      sheet_cost: 0,
      linear_cost: 0,
      lump_cost: 0,
      hardware_cost: 0,
      confidence: 'untested',
      active: true,
    },
  })
}

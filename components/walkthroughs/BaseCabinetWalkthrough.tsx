'use client'

// BaseCabinetWalkthrough — 9 operations × 9 screens for one 8' run.
// Canonical UX: mockups/cabinet-tour-mockup.html. 8' run of base cabinets
// with veneer slab doors + clear matte finish.
//
// Output unchanged from prior revisions: four per-LF dept hours written
// to the "Base cabinet" rate_book_item (base_labor_hours_eng/cnc/
// assembly/finish). The 9 ops fold into 4 dept buckets; each bucket
// divided by 8 to land at per-LF.
//
// Props:
//   orgId      — caller resolves (useAuth() in the overlay)
//   onComplete — fired after the rate_book_item write succeeds
//   onCancel   — optional; shown as a ghost "Back" link on the opener

import { useState } from 'react'
import { ensureRateBookCategoryId, upsertRateBookItem } from '@/lib/rate-book'
import { supabase } from '@/lib/supabase'

interface Props {
  orgId: string
  onComplete: () => void
  onCancel?: () => void
}

type Dept = 'Engineering' | 'CNC' | 'Assembly' | 'Finish'

type OpKey =
  | 'engineering'
  | 'cutInterior'
  | 'edgebandInterior'
  | 'boxAssembly'
  | 'cutDoors'
  | 'edgebandDoors'
  | 'hingeCups'
  | 'finish'
  | 'fullAssembly'

interface Operation {
  key: OpKey
  dept: Dept
  heading: string
  prompt: string
}

const OPERATIONS: Operation[] = [
  {
    key: 'engineering',
    dept: 'Engineering',
    heading: 'Shop drawings + CNC program',
    prompt:
      "How long does it take to draw up shop drawings and program the cuts for an 8' base run in your shop?",
  },
  {
    key: 'cutInterior',
    dept: 'CNC',
    heading: 'Cut interior parts',
    prompt:
      "How long does it take to cut the bottom, sides, dividers, nailers, and adjustable shelves for an 8' pre-finished cabinet?",
  },
  {
    key: 'edgebandInterior',
    dept: 'Assembly',
    heading: 'Edgebanding',
    prompt: 'How long does it take to edgeband those parts in your shop?',
  },
  {
    key: 'boxAssembly',
    dept: 'Assembly',
    heading: 'Box assembly',
    prompt: 'How long does it take to screw the boxes together in your shop?',
  },
  {
    key: 'cutDoors',
    dept: 'CNC',
    heading: 'Cut doors',
    prompt:
      "How long does it take to cut an 8' run of veneer slab doors in your shop?",
  },
  {
    key: 'edgebandDoors',
    dept: 'Assembly',
    heading: 'Edgeband doors',
    prompt: 'How long does it take to edgeband the doors in your shop?',
  },
  {
    key: 'hingeCups',
    dept: 'CNC',
    heading: 'Machine hinge cups',
    prompt:
      "How long does it take to drill the hinge cups in your shop? Zero if you're machining doors on your CNC.",
  },
  {
    key: 'finish',
    dept: 'Finish',
    heading: 'Finish the doors',
    prompt:
      'How long does it take to prep and finish the doors (clear matte lacquer, sanded between coats) in your shop?',
  },
  {
    key: 'fullAssembly',
    dept: 'Assembly',
    heading: 'Full assembly',
    prompt:
      "How long does it take to install hinge plates, knock in shelf pin sleeves, mount doors, etc? If you consider a cabinet finished once it's been wrapped, include that time too.",
  },
]

const BASE_CABINET_ITEM_NAME = 'Base cabinet'
const CABINETS_CATEGORY_NAME = 'Cabinets'

// Single opener screen now (the previous HowScreen is folded in) → 9
// operation screens → summary. The 'how' step is gone.
type Step = 'opener' | number | 'summary'

type Answers = Record<OpKey, number | null>

function emptyAnswers(): Answers {
  return OPERATIONS.reduce((acc, op) => {
    acc[op.key] = null
    return acc
  }, {} as Answers)
}

// Two ops groups. Carcass ops write per-LF to the "Base cabinet" row;
// door ops write per-door to a seeded "Slab" door_style row so the
// composer picks up slab-door labor without re-asking via the
// DoorStyleWalkthrough.
const CARCASS_OP_KEYS: OpKey[] = [
  'engineering',
  'cutInterior',
  'edgebandInterior',
  'boxAssembly',
  'fullAssembly',
]
const DOOR_OP_KEYS: OpKey[] = ['cutDoors', 'edgebandDoors', 'hingeCups', 'finish']

function toCarcassPerLfByDept(answers: Answers): {
  eng: number
  cnc: number
  assembly: number
  finish: number
} {
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) {
    if (!CARCASS_OP_KEYS.includes(op.key)) continue
    byDept[op.dept] += answers[op.key] || 0
  }
  return {
    eng: byDept.Engineering / 8,
    cnc: byDept.CNC / 8,
    assembly: byDept.Assembly / 8,
    finish: byDept.Finish / 8,
  }
}

function toDoorPerDoorByDept(answers: Answers): {
  eng: number
  cnc: number
  assembly: number
  finish: number
} {
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) {
    if (!DOOR_OP_KEYS.includes(op.key)) continue
    byDept[op.dept] += answers[op.key] || 0
  }
  // Walkthrough unit is 4 doors per 8' run — divide by 4 to land at per-door.
  return {
    eng: byDept.Engineering / 4,
    cnc: byDept.CNC / 4,
    assembly: byDept.Assembly / 4,
    finish: byDept.Finish / 4,
  }
}

function fmtHr(n: number | null): string {
  if (n == null) return '—'
  if (n === 0) return '0 hr'
  const s = n.toFixed(2).replace(/\.?0+$/, '')
  return `${s} hr`
}

export default function BaseCabinetWalkthrough({ orgId, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>('opener')
  const [answers, setAnswers] = useState<Answers>(emptyAnswers())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runningTotal = OPERATIONS.reduce((s, op) => s + (answers[op.key] || 0), 0)

  function goto(next: Step) {
    setError(null)
    setStep(next)
  }

  function setAnswer(key: OpKey, value: number | null) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await saveBaseCabinetAndDoorStyleCalibration(
        orgId,
        toCarcassPerLfByDept(answers),
        toDoorPerDoorByDept(answers),
      )
      onComplete()
    } catch (err: any) {
      setError(err?.message || 'Failed to save calibration')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[680px] w-full mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-sm">
      {step === 'opener' && (
        <OpenerScreen
          onContinue={() => goto(0)}
          onBack={onCancel}
        />
      )}

      {typeof step === 'number' && (
        <OperationScreen
          opIdx={step}
          answer={answers[OPERATIONS[step].key]}
          onAnswer={(v) => setAnswer(OPERATIONS[step].key, v)}
          onContinue={() => goto(step === OPERATIONS.length - 1 ? 'summary' : step + 1)}
          onBack={() => goto(step === 0 ? 'opener' : step - 1)}
          onSkip={() => {
            setAnswer(OPERATIONS[step].key, null)
            goto(step === OPERATIONS.length - 1 ? 'summary' : step + 1)
          }}
          runningTotal={runningTotal}
        />
      )}

      {step === 'summary' && (
        <SummaryScreen
          answers={answers}
          onEdit={(key, v) => setAnswer(key, v)}
          onBack={() => goto(OPERATIONS.length - 1)}
          onSave={save}
          saving={saving}
          error={error}
        />
      )}
    </div>
  )
}

// ── Screens ──

function OpenerScreen({
  onContinue,
  onBack,
}: {
  onContinue: () => void
  onBack?: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Step 2 · Base cabinets
      </div>
      <h1 className="text-[22px] font-semibold text-[#111] tracking-tight mb-3">
        Let's calibrate your base cabinet labor.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        We'll walk through nine operations on a single 8' base run with
        veneered slab doors and a matte clear finish. By the end, you'll
        have your real per-LF labor hours dialed in. Other configurations
        (different door styles, finishes) calibrate later as you use them.
      </p>
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[#6B7280] hover:text-[#111]"
          >
            ← Back
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] transition-colors"
        >
          Start walkthrough →
        </button>
      </div>
    </div>
  )
}

function OperationScreen({
  opIdx,
  answer,
  onAnswer,
  onContinue,
  onBack,
  onSkip,
  runningTotal,
}: {
  opIdx: number
  answer: number | null
  onAnswer: (v: number | null) => void
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
  runningTotal: number
}) {
  const op = OPERATIONS[opIdx]
  const isLast = opIdx === OPERATIONS.length - 1

  function step(delta: number) {
    const cur = answer ?? 0
    const next = Math.max(0, Math.round((cur + delta) * 4) / 4)
    onAnswer(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB]">
          Step {opIdx + 1} of {OPERATIONS.length} · {op.dept}
        </div>
        <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums">
          So far: {runningTotal.toFixed(2)} hr
        </div>
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        {op.heading}
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">{op.prompt}</p>

      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => step(-0.25)}
          disabled={!answer || answer <= 0}
          aria-label={`Decrease ${op.heading} hours`}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] disabled:opacity-40 text-base"
        >
          −
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          value={answer == null ? '' : answer}
          placeholder="0"
          autoFocus
          onChange={(e) =>
            onAnswer(e.target.value === '' ? null : Number(e.target.value))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') onContinue()
          }}
          className="w-28 text-center font-mono tabular-nums text-lg px-3 py-2 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => step(0.25)}
          aria-label={`Increase ${op.heading} hours`}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] text-base"
        >
          +
        </button>
        <span className="text-sm text-[#9CA3AF]">hours</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-[#6B7280] hover:text-[#111]"
        >
          ← Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-[#6B7280] hover:text-[#111]"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] transition-colors"
        >
          {isLast ? 'See summary →' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

function SummaryScreen({
  answers,
  onEdit,
  onBack,
  onSave,
  saving,
  error,
}: {
  answers: Answers
  onEdit: (key: OpKey, v: number | null) => void
  onBack: () => void
  onSave: () => void
  saving: boolean
  error: string | null
}) {
  const carcassByDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  const doorByDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) {
    const h = answers[op.key] || 0
    if (CARCASS_OP_KEYS.includes(op.key)) carcassByDept[op.dept] += h
    else doorByDept[op.dept] += h
  }
  const carcassPerLf = toCarcassPerLfByDept(answers)
  const doorPerDoor = toDoorPerDoorByDept(answers)
  const carcassTotal = carcassByDept.Engineering + carcassByDept.CNC + carcassByDept.Assembly + carcassByDept.Finish
  const doorTotal = doorByDept.Engineering + doorByDept.CNC + doorByDept.Assembly + doorByDept.Finish
  const total = carcassTotal + doorTotal

  const renderOpRow = (op: Operation) => (
    <tr key={op.key} className="border-t border-[#F3F4F6]">
      <td className="px-3 py-2 text-[#111]">{op.heading}</td>
      <td className="px-3 py-2 text-[#6B7280] text-[12px]">{op.dept}</td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          value={answers[op.key] == null ? '' : (answers[op.key] as number)}
          placeholder="0"
          onChange={(e) =>
            onEdit(op.key, e.target.value === '' ? null : Number(e.target.value))
          }
          disabled={saving}
          className="w-20 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
        />
      </td>
    </tr>
  )

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Summary
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Your 8' run of base cabinets
      </h1>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-1">
        Tune any number inline, then save.
      </p>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        This creates your <strong className="text-[#111]">Base cabinet</strong> row
        AND a <strong className="text-[#111]">Slab</strong> door style. You can
        rename or recalibrate either in the rate book later.
      </p>

      <div className="border border-[#E5E7EB] rounded-lg overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-[#F9FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
            <tr>
              <th className="text-left px-3 py-2">Operation</th>
              <th className="text-left px-3 py-2 w-[110px]">Dept</th>
              <th className="text-right px-3 py-2 w-[120px]">Hours (8')</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#F9FAFB] border-t border-[#E5E7EB]">
              <td
                colSpan={3}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]"
              >
                Base cabinet · per-LF on save
              </td>
            </tr>
            {OPERATIONS.filter((op) => CARCASS_OP_KEYS.includes(op.key)).map(renderOpRow)}
            <tr className="bg-[#F9FAFB] border-t border-[#E5E7EB]">
              <td
                colSpan={3}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]"
              >
                Slab door style · per-door on save (÷ 4)
              </td>
            </tr>
            {OPERATIONS.filter((op) => DOOR_OP_KEYS.includes(op.key)).map(renderOpRow)}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <div className="border border-[#E5E7EB] rounded-lg p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-1.5">
            Base cabinet (per LF)
          </div>
          <div className="grid grid-cols-4 gap-1 text-[11.5px] font-mono tabular-nums text-[#111]">
            <div><span className="text-[#9CA3AF]">Eng</span> {carcassPerLf.eng.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">CNC</span> {carcassPerLf.cnc.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">Asm</span> {carcassPerLf.assembly.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">Fin</span> {carcassPerLf.finish.toFixed(3)}</div>
          </div>
          <div className="text-[10.5px] text-[#9CA3AF] mt-2">
            {fmtHr(carcassTotal)} total for 8' run
          </div>
        </div>
        <div className="border border-[#E5E7EB] rounded-lg p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-1.5">
            Slab door (per door)
          </div>
          <div className="grid grid-cols-4 gap-1 text-[11.5px] font-mono tabular-nums text-[#111]">
            <div><span className="text-[#9CA3AF]">Eng</span> {doorPerDoor.eng.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">CNC</span> {doorPerDoor.cnc.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">Asm</span> {doorPerDoor.assembly.toFixed(3)}</div>
            <div><span className="text-[#9CA3AF]">Fin</span> {doorPerDoor.finish.toFixed(3)}</div>
          </div>
          <div className="text-[10.5px] text-[#9CA3AF] mt-2">
            {fmtHr(doorTotal)} total across 4 doors
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF]">
          8' run total
        </div>
        <div className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">
          {total.toFixed(2)} hr
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
        >
          ← Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSave}
          disabled={saving || total <= 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save calibration'}
        </button>
      </div>
    </div>
  )
}

// ── Storage ──

/**
 * Write two rate_book_items rows from one walkthrough:
 *   1. "Base cabinet" under a cabinet_style category — carcass per-LF.
 *   2. "Slab" under a door_style category — slab-door per-door labor.
 *
 * Walkthrough explicitly calibrates against veneer slab doors (cutDoors
 * / edgebandDoors / hingeCups / finish ops), so we seed a real door
 * style instead of bundling the door labor into the Base cabinet row.
 * Without this split the composer's door dropdown would be empty on
 * first pick and fire DoorStyleWalkthrough for the same calibration
 * work, AND the Base cabinet row would double-count door labor once
 * the operator later runs the door walkthrough.
 *
 * Category + item lookups use the shared helpers in lib/rate-book.ts
 * so this walkthrough and DoorStyleWalkthrough can't drift.
 */
const DOORS_CATEGORY_NAME = 'Doors'
const SLAB_DOOR_STYLE_NAME = 'Slab'

async function saveBaseCabinetAndDoorStyleCalibration(
  orgId: string,
  carcassPerLf: { eng: number; cnc: number; assembly: number; finish: number },
  doorPerDoor: { eng: number; cnc: number; assembly: number; finish: number },
): Promise<void> {
  // 1. Base cabinet (cabinet_style). Per-LF by dept. Always written —
  //    this walkthrough is the canonical entry point for the base-cab
  //    rates.
  const cabinetsCategoryId = await ensureRateBookCategoryId(
    orgId,
    CABINETS_CATEGORY_NAME,
    'cabinet_style',
  )
  await upsertRateBookItem({
    orgId,
    categoryId: cabinetsCategoryId,
    name: BASE_CABINET_ITEM_NAME,
    patch: {
      base_labor_hours_eng: carcassPerLf.eng,
      base_labor_hours_cnc: carcassPerLf.cnc,
      base_labor_hours_assembly: carcassPerLf.assembly,
      base_labor_hours_finish: carcassPerLf.finish,
      base_labor_hours_install: 0,
      updated_at: new Date().toISOString(),
    },
    insertDefaults: {
      unit: 'lf',
      material_mode: 'sheets',
      sheets_per_unit: 0,
      sheet_cost: 0,
      linear_cost: 0,
      lump_cost: 0,
      hardware_cost: 0,
      confidence: 'untested',
      active: true,
    },
  })

  // 2. Slab door style (door_style). Per-door by dept.
  //    First-run only: if the Slab row already has any non-zero
  //    door_labor_hours_*, skip the write. The dedicated
  //    DoorStyleWalkthrough is the canonical entry point for tuning
  //    door rates; if we overwrite here on every BaseCabinet save, any
  //    composer line referencing Slab gets flagged stale on next
  //    reload (its stored breakdown was computed against the previous
  //    door rates). Discovered as the cause of staleness-banner false
  //    positives on freshly-composed lines.
  const doorsCategoryId = await ensureRateBookCategoryId(
    orgId,
    DOORS_CATEGORY_NAME,
    'door_style',
  )
  const { data: existingDoor } = await supabase
    .from('rate_book_items')
    .select(
      'id, door_labor_hours_eng, door_labor_hours_cnc, door_labor_hours_assembly, door_labor_hours_finish',
    )
    .eq('org_id', orgId)
    .eq('category_id', doorsCategoryId)
    .ilike('name', SLAB_DOOR_STYLE_NAME)
    .limit(1)
  const existingRow = (existingDoor || [])[0] as
    | {
        id: string
        door_labor_hours_eng: number | null
        door_labor_hours_cnc: number | null
        door_labor_hours_assembly: number | null
        door_labor_hours_finish: number | null
      }
    | undefined
  const existingTotal =
    (Number(existingRow?.door_labor_hours_eng) || 0) +
    (Number(existingRow?.door_labor_hours_cnc) || 0) +
    (Number(existingRow?.door_labor_hours_assembly) || 0) +
    (Number(existingRow?.door_labor_hours_finish) || 0)

  if (existingRow && existingTotal > 0) {
    // Already calibrated by DoorStyleWalkthrough (or a previous run of
    // this walkthrough). Don't clobber it — the user's intent on
    // recompose is to update base-cab rates, not door-style rates.
    return
  }

  await upsertRateBookItem({
    orgId,
    categoryId: doorsCategoryId,
    name: SLAB_DOOR_STYLE_NAME,
    patch: {
      door_labor_hours_eng: doorPerDoor.eng,
      door_labor_hours_cnc: doorPerDoor.cnc,
      door_labor_hours_assembly: doorPerDoor.assembly,
      door_labor_hours_finish: doorPerDoor.finish,
      updated_at: new Date().toISOString(),
    },
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

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

type Step = 'opener' | 'how' | number | 'summary'

type Answers = Record<OpKey, number | null>

function emptyAnswers(): Answers {
  return OPERATIONS.reduce((acc, op) => {
    acc[op.key] = null
    return acc
  }, {} as Answers)
}

function toPerLfByDept(answers: Answers): {
  eng: number
  cnc: number
  assembly: number
  finish: number
} {
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) byDept[op.dept] += answers[op.key] || 0
  return {
    eng: byDept.Engineering / 8,
    cnc: byDept.CNC / 8,
    assembly: byDept.Assembly / 8,
    finish: byDept.Finish / 8,
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
      await saveBaseCabinetCalibration(orgId, toPerLfByDept(answers))
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
          onContinue={() => goto('how')}
          onBack={onCancel}
        />
      )}

      {step === 'how' && (
        <HowScreen
          onContinue={() => goto(0)}
          onBack={() => goto('opener')}
        />
      )}

      {typeof step === 'number' && (
        <OperationScreen
          opIdx={step}
          answer={answers[OPERATIONS[step].key]}
          onAnswer={(v) => setAnswer(OPERATIONS[step].key, v)}
          onContinue={() => goto(step === OPERATIONS.length - 1 ? 'summary' : step + 1)}
          onBack={() => goto(step === 0 ? 'how' : step - 1)}
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
        Let's run numbers on your base cabinets.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        Every shop is different. Some have CNCs, some tracksaws. Some have
        edgebanders and some are ironing on banding. Let's dial in your
        specific labor hours.
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
          Continue →
        </button>
      </div>
    </div>
  )
}

function HowScreen({
  onContinue,
  onBack,
}: {
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Step 2 · Base cabinets
      </div>
      <h1 className="text-[22px] font-semibold text-[#111] tracking-tight mb-3">
        How this works.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        We're going to think through building an 8' cabinet with veneered
        doors and a matte clear finish. We'll walk you through each step
        and at the end we'll have some good baseline numbers to start
        cranking out estimates.
      </p>
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
  const byDept: Record<Dept, number> = { Engineering: 0, CNC: 0, Assembly: 0, Finish: 0 }
  for (const op of OPERATIONS) byDept[op.dept] += answers[op.key] || 0
  const perLf = toPerLfByDept(answers)
  const total = byDept.Engineering + byDept.CNC + byDept.Assembly + byDept.Finish

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Summary
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Your 8' run of base cabinets
      </h1>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        Tune any number inline, then save. These fold into four per-LF
        dept values on your rate book so every composer line prices off
        them.
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
            {OPERATIONS.map((op) => (
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
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        {(['Engineering', 'CNC', 'Assembly', 'Finish'] as Dept[]).map((d) => (
          <div
            key={d}
            className="flex items-center justify-between px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              {d}
            </span>
            <span className="font-mono tabular-nums text-sm text-[#111]">
              {fmtHr(byDept[d])}
              <span className="text-[#9CA3AF]"> / 8'</span>
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF]">
            Per linear foot on save
          </div>
          <div className="text-[11.5px] text-[#1E3A8A] font-mono">
            Eng {perLf.eng.toFixed(3)} · CNC {perLf.cnc.toFixed(3)} ·
            Assembly {perLf.assembly.toFixed(3)} · Finish {perLf.finish.toFixed(3)}
          </div>
        </div>
        <div className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">
          {total.toFixed(2)} hr / 8'
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
 * Find-or-create the org's "Base cabinet" rate_book_item and write the
 * per-LF dept labor. This is usually the first rate_book_item write for
 * an org, so we ensure the parent cabinet_style category exists first.
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

  // 2. Find-or-create the "Base cabinet" item under that category.
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

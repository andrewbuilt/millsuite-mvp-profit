'use client'

// SolidWoodTopWalkthrough — calibrate per-op labor + edge multipliers +
// default cut method + default material against ONE typical top.
// Composer's solid-wood-top product scales these per-piece hours by BdFt.
//
// Mirrors BaseCabinetWalkthrough's structure: opener → numbered op
// screens → summary, ChevronLeft / ChevronRight nav, last-used preload
// from the existing solid_wood_top_calibrations row.
//
// One row per org — upsert on conflict (org_id).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  SOLID_WOOD_TOP_OPS,
  type SolidWoodTopOpKey,
} from '@/lib/composer'

interface Props {
  orgId: string
  onComplete: () => void
  onCancel?: () => void
}

interface OpDef {
  key: SolidWoodTopOpKey
  dept: 'Engineering' | 'CNC' | 'Assembly' | 'Finish' | 'Install'
  heading: string
  prompt: string
}

// Dept attribution mirrors the slug prefix:
//   eng_*  → Engineering
//   cnc_*  → CNC
//   asy_*  → Assembly
//   fin_*  → Finish
//   ins_*  → Install
const OPERATIONS: OpDef[] = [
  {
    key: 'eng_drawing',
    dept: 'Engineering',
    heading: 'Shop drawings + templating',
    prompt:
      'How long does it take to draw up shop drawings and templates for one typical top in your shop?',
  },
  {
    key: 'asy_wood_selection',
    dept: 'Assembly',
    heading: 'Wood selection',
    prompt:
      'How long does it take to pull the right boards from the rack — color match, grain, defect culling?',
  },
  {
    key: 'asy_jointing',
    dept: 'Assembly',
    heading: 'Jointing',
    prompt: 'How long to joint one face on every board for one top?',
  },
  {
    key: 'asy_planing',
    dept: 'Assembly',
    heading: 'Planing',
    prompt: 'How long to plane to thickness for one top?',
  },
  {
    key: 'asy_ripping',
    dept: 'Assembly',
    heading: 'Ripping',
    prompt: 'How long to rip the boards to width for one top?',
  },
  {
    key: 'asy_chopping',
    dept: 'Assembly',
    heading: 'Chopping',
    prompt: 'How long to crosscut to rough length for one top?',
  },
  {
    key: 'asy_glueup',
    dept: 'Assembly',
    heading: 'Glue-up',
    prompt:
      'How long to glue + clamp one panel? Clamping time spent waiting only counts if a person is tied up.',
  },
  {
    key: 'asy_calib_sanding',
    dept: 'Assembly',
    heading: 'Calibration sanding',
    prompt: 'How long to drum-sand / wide-belt sand one top to flat?',
  },
  // S11 — single screen renders one of these two based on cut-method pick:
  {
    key: 'asy_saw_cut_to_size',
    dept: 'Assembly',
    heading: 'Cut to size (saw)',
    prompt: 'How long to cut to final length + width on the table saw or sliding panel saw?',
  },
  {
    key: 'cnc_cut_to_size',
    dept: 'CNC',
    heading: 'Cut to size (CNC)',
    prompt: 'How long to cut to final length + width on the CNC?',
  },
  {
    key: 'fin_sanding',
    dept: 'Finish',
    heading: 'Final sanding',
    prompt: 'How long to finish-sand one top before applying finish?',
  },
  {
    key: 'fin_apply',
    dept: 'Finish',
    heading: 'Apply finish',
    prompt:
      'How long to apply your typical finish (oil, varnish, or whatever you use most) to one top, including coats and dry time when a person is tied up?',
  },
  {
    key: 'ins_install_on_site',
    dept: 'Install',
    heading: 'Install on site',
    prompt: 'How long to install one top on site, including transport from the shop?',
  },
]

type Step =
  | 'opener'
  | 'size'
  | 'cutMethod'
  | { kind: 'op'; opIdx: number }
  | 'edgeMults'
  | 'defaultMaterial'
  | 'summary'

interface SolidWoodComponentRow {
  id: string
  name: string
}

function fmtHr(n: number | null): string {
  if (n == null) return '—'
  if (n === 0) return '0 hr'
  return `${n.toFixed(2).replace(/\.?0+$/, '')} hr`
}

export default function SolidWoodTopWalkthrough({ orgId, onComplete, onCancel }: Props) {
  // Calibration size — defaults to 96 × 24 × 1.5 per spec.
  const [length, setLength] = useState<number>(96)
  const [width, setWidth] = useState<number>(24)
  const [thickness, setThickness] = useState<number>(1.5)
  // Per-op hours, keyed by slug. Missing keys read 0.
  const [hours, setHours] = useState<Partial<Record<SolidWoodTopOpKey, number>>>({})
  const [cutMethod, setCutMethod] = useState<'saw' | 'cnc'>('saw')
  const [edgePctHand, setEdgePctHand] = useState<number>(15)
  const [edgePctCnc, setEdgePctCnc] = useState<number>(10)
  const [defaultMaterialId, setDefaultMaterialId] = useState<string | null>(null)
  const [components, setComponents] = useState<SolidWoodComponentRow[]>([])

  const [step, setStep] = useState<Step>('opener')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hadPriorCalib, setHadPriorCalib] = useState(false)

  // Load existing calibration + active components on mount. Pre-fill so
  // re-running shows "last time you said" values.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const [{ data: cal }, { data: comps }] = await Promise.all([
        supabase
          .from('solid_wood_top_calibrations')
          .select(
            'calib_length_in, calib_width_in, calib_thickness_in, hours_by_op, edge_mult_hand, edge_mult_cnc, default_cut_method, default_material_id',
          )
          .eq('org_id', orgId)
          .maybeSingle(),
        supabase
          .from('solid_wood_components')
          .select('id, name')
          .eq('org_id', orgId)
          .eq('active', true)
          .order('name'),
      ])
      if (cancelled) return
      if (cal) {
        setHadPriorCalib(true)
        setLength(Number((cal as any).calib_length_in) || 96)
        setWidth(Number((cal as any).calib_width_in) || 24)
        setThickness(Number((cal as any).calib_thickness_in) || 1.5)
        setHours(((cal as any).hours_by_op || {}) as Partial<Record<SolidWoodTopOpKey, number>>)
        setCutMethod((((cal as any).default_cut_method as 'saw' | 'cnc') || 'saw'))
        // Stored as multipliers (1.15, 1.10) — display as percent (15, 10).
        const hm = Number((cal as any).edge_mult_hand)
        const cm = Number((cal as any).edge_mult_cnc)
        if (Number.isFinite(hm) && hm > 0) setEdgePctHand((hm - 1) * 100)
        if (Number.isFinite(cm) && cm > 0) setEdgePctCnc((cm - 1) * 100)
        setDefaultMaterialId((cal as any).default_material_id ?? null)
      }
      setComponents((comps || []) as SolidWoodComponentRow[])
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // The op-screen list filters in/out the cut-method op based on pick.
  const visibleOps = useMemo(() => {
    return OPERATIONS.filter((op) => {
      if (op.key === 'asy_saw_cut_to_size') return cutMethod === 'saw'
      if (op.key === 'cnc_cut_to_size') return cutMethod === 'cnc'
      return true
    })
  }, [cutMethod])

  // Total hours so far (across whatever ops are visible).
  const runningTotal = useMemo(() => {
    return visibleOps.reduce((s, op) => s + (Number(hours[op.key]) || 0), 0)
  }, [visibleOps, hours])

  function setHour(key: SolidWoodTopOpKey, val: number | null) {
    setHours((prev) => ({ ...prev, [key]: val == null ? 0 : Math.max(0, val) }))
  }

  function gotoNext(from: Step) {
    setError(null)
    if (from === 'opener') return setStep('size')
    if (from === 'size') return setStep('cutMethod')
    if (from === 'cutMethod') return setStep({ kind: 'op', opIdx: 0 })
    if (typeof from === 'object' && from.kind === 'op') {
      const next = from.opIdx + 1
      if (next < visibleOps.length) return setStep({ kind: 'op', opIdx: next })
      return setStep('edgeMults')
    }
    if (from === 'edgeMults') return setStep('defaultMaterial')
    if (from === 'defaultMaterial') return setStep('summary')
  }

  function gotoPrev(from: Step) {
    setError(null)
    if (from === 'size') return setStep('opener')
    if (from === 'cutMethod') return setStep('size')
    if (typeof from === 'object' && from.kind === 'op') {
      const prev = from.opIdx - 1
      if (prev >= 0) return setStep({ kind: 'op', opIdx: prev })
      return setStep('cutMethod')
    }
    if (from === 'edgeMults') return setStep({ kind: 'op', opIdx: visibleOps.length - 1 })
    if (from === 'defaultMaterial') return setStep('edgeMults')
    if (from === 'summary') return setStep('defaultMaterial')
  }

  // Build the hours_by_op payload — exclude the inactive cut-method
  // op so it stays at 0 in storage when the operator switches methods.
  function buildHoursPayload(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const k of SOLID_WOOD_TOP_OPS) {
      if (k === 'asy_saw_cut_to_size' && cutMethod === 'cnc') continue
      if (k === 'cnc_cut_to_size' && cutMethod === 'saw') continue
      const v = Number(hours[k]) || 0
      if (v > 0) out[k] = v
    }
    return out
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const payload = {
        org_id: orgId,
        calib_length_in: length,
        calib_width_in: width,
        calib_thickness_in: thickness,
        hours_by_op: buildHoursPayload(),
        edge_mult_hand: 1 + Math.max(0, edgePctHand) / 100,
        edge_mult_cnc: 1 + Math.max(0, edgePctCnc) / 100,
        default_cut_method: cutMethod,
        default_material_id: defaultMaterialId,
        updated_at: new Date().toISOString(),
      }
      const { error: upErr } = await supabase
        .from('solid_wood_top_calibrations')
        .upsert(payload, { onConflict: 'org_id' })
      if (upErr) throw upErr
      onComplete()
    } catch (err: any) {
      setError(err?.message || 'Failed to save calibration')
      setSaving(false)
    }
  }

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="max-w-[680px] w-full bg-white border border-[#E5E7EB] rounded-2xl p-7 shadow-xl max-h-[90vh] overflow-y-auto">
        {step === 'opener' && (
          <Opener
            hadPrior={hadPriorCalib}
            onContinue={() => gotoNext('opener')}
            onBack={onCancel}
          />
        )}

        {step === 'size' && (
          <SizeScreen
            length={length}
            width={width}
            thickness={thickness}
            onLength={setLength}
            onWidth={setWidth}
            onThickness={setThickness}
            onContinue={() => gotoNext('size')}
            onBack={() => gotoPrev('size')}
          />
        )}

        {step === 'cutMethod' && (
          <CutMethodScreen
            value={cutMethod}
            onChange={setCutMethod}
            onContinue={() => gotoNext('cutMethod')}
            onBack={() => gotoPrev('cutMethod')}
          />
        )}

        {typeof step === 'object' && step.kind === 'op' && (
          <OperationScreen
            op={visibleOps[step.opIdx]}
            opIdx={step.opIdx}
            opCount={visibleOps.length}
            value={Number(hours[visibleOps[step.opIdx].key]) || null}
            onChange={(v) => setHour(visibleOps[step.opIdx].key, v)}
            onContinue={() => gotoNext(step)}
            onBack={() => gotoPrev(step)}
            onSkip={() => {
              setHour(visibleOps[step.opIdx].key, 0)
              gotoNext(step)
            }}
            runningTotal={runningTotal}
          />
        )}

        {step === 'edgeMults' && (
          <EdgeMultsScreen
            handPct={edgePctHand}
            cncPct={edgePctCnc}
            onHand={setEdgePctHand}
            onCnc={setEdgePctCnc}
            onContinue={() => gotoNext('edgeMults')}
            onBack={() => gotoPrev('edgeMults')}
          />
        )}

        {step === 'defaultMaterial' && (
          <DefaultMaterialScreen
            value={defaultMaterialId}
            components={components}
            onChange={setDefaultMaterialId}
            onContinue={() => gotoNext('defaultMaterial')}
            onBack={() => gotoPrev('defaultMaterial')}
          />
        )}

        {step === 'summary' && (
          <SummaryScreen
            length={length}
            width={width}
            thickness={thickness}
            hours={hours}
            cutMethod={cutMethod}
            handPct={edgePctHand}
            cncPct={edgePctCnc}
            visibleOps={visibleOps}
            onBack={() => gotoPrev('summary')}
            onSave={save}
            saving={saving}
            error={error}
          />
        )}
      </div>
    </div>
  )
}

// ── Screens ──

function Opener({
  hadPrior,
  onContinue,
  onBack,
}: {
  hadPrior: boolean
  onContinue: () => void
  onBack?: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Solid Wood Top
      </div>
      <h1 className="text-[22px] font-semibold text-[#111] tracking-tight mb-3">
        {hadPrior ? 'Recalibrate your solid wood top labor.' : "Let's calibrate your solid wood top labor."}
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        We'll calibrate your time against ONE typical top of your choosing.
        Every solid-wood-top line you compose later scales up or down on
        BdFt against this one. Cabinet calibration won't help here — solid
        wood has its own ops chain (jointing / planing / glue-up).
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
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8]"
        >
          Start walkthrough →
        </button>
      </div>
    </div>
  )
}

function SizeScreen({
  length,
  width,
  thickness,
  onLength,
  onWidth,
  onThickness,
  onContinue,
  onBack,
}: {
  length: number
  width: number
  thickness: number
  onLength: (n: number) => void
  onWidth: (n: number) => void
  onThickness: (n: number) => void
  onContinue: () => void
  onBack: () => void
}) {
  const bdft = (length * width * thickness) / 144
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Step 1 · Calibration size
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Pick a typical top.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        We'll calibrate your time against one top of this size. We'll scale
        up or down on every line based on its actual dimensions.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <NumberCell label="Length (in)" value={length} onChange={onLength} step={1} />
        <NumberCell label="Width (in)" value={width} onChange={onWidth} step={1} />
        <NumberCell label="Thickness (in)" value={thickness} onChange={onThickness} step={0.25} />
      </div>
      <div className="text-[11px] text-[#6B7280] font-mono tabular-nums mb-6">
        That's {bdft.toFixed(2)} BdFt for one top.
      </div>
      <NavButtons onBack={onBack} onContinue={onContinue} continueLabel="Next →" />
    </div>
  )
}

function CutMethodScreen({
  value,
  onChange,
  onContinue,
  onBack,
}: {
  value: 'saw' | 'cnc'
  onChange: (v: 'saw' | 'cnc') => void
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Step 2 · Cut method
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Most often I cut to size with…
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        We'll only ask for hours on the path you pick. The other op stays at
        zero — you can still override per-line in the composer.
      </p>
      <div className="space-y-2 mb-6">
        <Radio label="Table saw / sliding panel saw" checked={value === 'saw'} onSelect={() => onChange('saw')} />
        <Radio label="CNC" checked={value === 'cnc'} onSelect={() => onChange('cnc')} />
      </div>
      <NavButtons onBack={onBack} onContinue={onContinue} continueLabel="Next →" />
    </div>
  )
}

function OperationScreen({
  op,
  opIdx,
  opCount,
  value,
  onChange,
  onContinue,
  onBack,
  onSkip,
  runningTotal,
}: {
  op: OpDef
  opIdx: number
  opCount: number
  value: number | null
  onChange: (v: number | null) => void
  onContinue: () => void
  onBack: () => void
  onSkip: () => void
  runningTotal: number
}) {
  const isLast = opIdx === opCount - 1
  function step(delta: number) {
    const cur = value ?? 0
    const next = Math.max(0, Math.round((cur + delta) * 4) / 4)
    onChange(next)
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB]">
          Step {opIdx + 3} · {op.dept}
        </div>
        <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums">
          So far: {runningTotal.toFixed(2)} hr
        </div>
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">{op.heading}</h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">{op.prompt}</p>

      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => step(-0.25)}
          disabled={!value || value <= 0}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280] disabled:opacity-40"
        >
          −
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0"
          value={value == null ? '' : value}
          placeholder="0"
          autoFocus
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onContinue()
          }}
          className="w-28 text-center font-mono tabular-nums text-lg px-3 py-2 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => step(0.25)}
          className="w-9 h-9 rounded-md border border-[#E5E7EB] bg-white text-[#6B7280]"
        >
          +
        </button>
        <span className="text-sm text-[#9CA3AF]">hours</span>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm text-[#6B7280] hover:text-[#111]">
          ← Back
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onSkip} className="text-sm text-[#6B7280] hover:text-[#111]">
          Skip
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8]"
        >
          {isLast ? 'Next →' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

function EdgeMultsScreen({
  handPct,
  cncPct,
  onHand,
  onCnc,
  onContinue,
  onBack,
}: {
  handPct: number
  cncPct: number
  onHand: (n: number) => void
  onCnc: (n: number) => void
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Edge profiles
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Edge profile multipliers
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        How much extra labor does an edge profile add? Square edge stays at
        100% (no multiplier).
      </p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <NumberCell label="Hand-routed (% added)" value={handPct} onChange={onHand} step={1} />
        <NumberCell label="CNC-routed (% added)" value={cncPct} onChange={onCnc} step={1} />
      </div>
      <NavButtons onBack={onBack} onContinue={onContinue} continueLabel="Next →" />
    </div>
  )
}

function DefaultMaterialScreen({
  value,
  components,
  onChange,
  onContinue,
  onBack,
}: {
  value: string | null
  components: SolidWoodComponentRow[]
  onChange: (id: string | null) => void
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Default material (optional)
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Pick a default solid-wood component.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        New solid-wood-top lines will pre-pick this material. The operator
        can still pick anything from the dropdown.
      </p>
      {components.length === 0 ? (
        <div className="px-3 py-2.5 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-sm text-[#78350F] mb-6">
          No solid-wood components yet. Add them in the rate book first.
        </div>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-md mb-6 focus:border-[#2563EB] outline-none"
        >
          <option value="">— No default —</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <NavButtons onBack={onBack} onContinue={onContinue} continueLabel="Next →" />
    </div>
  )
}

function SummaryScreen({
  length,
  width,
  thickness,
  hours,
  cutMethod,
  handPct,
  cncPct,
  visibleOps,
  onBack,
  onSave,
  saving,
  error,
}: {
  length: number
  width: number
  thickness: number
  hours: Partial<Record<SolidWoodTopOpKey, number>>
  cutMethod: 'saw' | 'cnc'
  handPct: number
  cncPct: number
  visibleOps: OpDef[]
  onBack: () => void
  onSave: () => void
  saving: boolean
  error: string | null
}) {
  const totalHrs = visibleOps.reduce((s, op) => s + (Number(hours[op.key]) || 0), 0)
  const bdft = (length * width * thickness) / 144
  const byDept: Record<string, number> = {
    Engineering: 0, CNC: 0, Assembly: 0, Finish: 0, Install: 0,
  }
  for (const op of visibleOps) byDept[op.dept] += Number(hours[op.key]) || 0

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Summary
      </div>
      <h1 className="text-[20px] font-semibold text-[#111] tracking-tight mb-3">
        Your typical top
      </h1>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
        {length}" × {width}" × {thickness}" — {bdft.toFixed(2)} BdFt — cut by {cutMethod.toUpperCase()}.
      </p>

      <div className="border border-[#E5E7EB] rounded-lg p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
          Per typical top — by dept
        </div>
        <div className="grid grid-cols-5 gap-2 text-[12px] font-mono tabular-nums">
          {(['Engineering', 'CNC', 'Assembly', 'Finish', 'Install'] as const).map((d) => (
            <div key={d}>
              <div className="text-[#9CA3AF] text-[10px]">{d}</div>
              <div>{byDept[d].toFixed(2)} h</div>
            </div>
          ))}
        </div>
        <div className="text-[10.5px] text-[#9CA3AF] mt-2">
          Total {fmtHr(totalHrs)} for one typical top.
        </div>
      </div>

      <div className="text-[11px] text-[#6B7280] mb-5">
        Edge multipliers: hand +{handPct}% · CNC +{cncPct}%.
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
          disabled={saving || totalHrs <= 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save calibration'}
        </button>
      </div>
    </div>
  )
}

// ── Shared bits ──

function NumberCell({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
        {label}
      </div>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full text-center font-mono tabular-nums text-base px-3 py-2 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] outline-none"
      />
    </div>
  )
}

function Radio({
  label,
  checked,
  onSelect,
}: {
  label: string
  checked: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left rounded-lg border ${
        checked
          ? 'border-[#2563EB] bg-[#EFF6FF] text-[#111]'
          : 'border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]'
      }`}
    >
      <span
        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
          checked ? 'border-[#2563EB]' : 'border-[#D1D5DB]'
        }`}
      >
        {checked && <span className="w-2 h-2 rounded-full bg-[#2563EB]" />}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

function NavButtons({
  onBack,
  onContinue,
  continueLabel,
}: {
  onBack: () => void
  onContinue: () => void
  continueLabel: string
}) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} className="text-sm text-[#6B7280] hover:text-[#111]">
        ← Back
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8]"
      >
        {continueLabel}
      </button>
    </div>
  )
}

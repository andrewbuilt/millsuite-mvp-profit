'use client'

// ============================================================================
// SolidWoodTopStudio — the Solid Wood Top PRODUCT, in one place (2026-10-23)
// ============================================================================
// Opened from the rate-book header ("Solid wood top"). Houses:
//   (a) the typical-top labor calibration (moved here from Materials → Solid
//       wood — the stock table stays there: stock is material, this is the
//       product), and
//   (b) the features list (migration 120): bowties, hand-rubbed finish,
//       mitered / finger-joint corners, cutouts. See lib/swt-features.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { TopCalibrationCard } from '@/components/rate-book/SolidWoodSection'
import {
  ZERO_HOURS,
  archiveSwtFeature,
  createSwtFeature,
  listSwtFeatures,
  updateSwtFeature,
  type SwtFeature,
  type SwtFeatureInput,
  type SwtHours,
  type SwtPricingMode,
  type SwtStep,
} from '@/lib/swt-features'

const MODE_LABEL: Record<SwtPricingMode, string> = {
  each: 'Each',
  sqft: 'Per sq ft',
  length_steps: 'By length (steps)',
}
const MODE_HINT: Record<SwtPricingMode, string> = {
  each: 'Priced per piece — bowties, cutouts.',
  sqft: 'Priced per square foot — hand-rubbed finish. Lines default to one face of the top.',
  length_steps:
    'Each length gets its own price — mitered or finger-jointed corners. Labor isn’t linear: 1′ to 2′ is cheap, 1′ to 4′ isn’t. A length rounds UP to the next step; past the last step, the per-extra-foot numbers add on.',
}
const DEPTS: Array<{ key: keyof SwtHours; label: string }> = [
  { key: 'eng', label: 'Eng' },
  { key: 'cnc', label: 'CNC' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'finish', label: 'Finish' },
]

function blank(mode: SwtPricingMode = 'each'): SwtFeatureInput {
  return {
    name: '',
    pricing_mode: mode,
    hours: { ...ZERO_HOURS },
    material_per_unit: 0,
    steps: mode === 'length_steps' ? [{ up_to_ft: 1, hours: { ...ZERO_HOURS }, material: 0 }] : [],
    extra_ft_hours: { ...ZERO_HOURS },
    extra_ft_material: 0,
  }
}

function toInput(f: SwtFeature): SwtFeatureInput {
  return {
    name: f.name,
    pricing_mode: f.pricing_mode,
    hours: { ...f.hours },
    material_per_unit: f.material_per_unit,
    steps: f.steps.map((s) => ({ ...s, hours: { ...s.hours } })),
    extra_ft_hours: { ...f.extra_ft_hours },
    extra_ft_material: f.extra_ft_material,
  }
}

export default function SolidWoodTopStudio({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-start justify-center z-50 p-6 overflow-y-auto">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl my-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-[14px] font-semibold text-[#111]">Solid wood top</h2>
            <p className="text-[11.5px] text-[#6B7280]">
              The typical-top calibration every top scales from, and the features you add on top of it.
              Lumber prices live in Materials → Solid wood.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-[#9CA3AF] hover:text-[#111]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-6">
          <TopCalibrationCard orgId={orgId} />
          <FeatureList orgId={orgId} />
        </div>
      </div>
    </div>
  )
}

function FeatureList({ orgId }: { orgId: string }) {
  const [features, setFeatures] = useState<SwtFeature[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<{ id: string | null; draft: SwtFeatureInput } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setFeatures(await listSwtFeatures(orgId))
    setLoaded(true)
  }, [orgId])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save() {
    if (!editing) return
    setBusy(true)
    setErr(null)
    try {
      if (editing.id) await updateSwtFeature(editing.id, editing.draft)
      else await createSwtFeature(orgId, editing.draft)
      setEditing(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function archive(f: SwtFeature) {
    if (!window.confirm(`Archive "${f.name}"? Lines that already use it keep their saved price.`)) return
    try {
      await archiveSwtFeature(f.id)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not archive.')
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[13px] font-semibold text-[#111]">Features</h3>
        {!editing && (
          <button
            onClick={() => setEditing({ id: null, draft: blank() })}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-semibold rounded-md bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New feature
          </button>
        )}
      </div>
      <p className="text-[12px] text-[#6B7280] mb-3">
        The craft on a top that board feet can&apos;t see. Bowties and cutouts are <b>each</b>; a hand-rubbed finish is{' '}
        <b>per sq ft</b>; mitered or finger-jointed corners are <b>by length</b>. Thickness variants are their own
        feature (&ldquo;Miter · 8/4&rdquo;). Hours land in their departments, so the schedule sees them.
      </p>
      {err && <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">{err}</div>}

      {editing ? (
        <FeatureEditor
          draft={editing.draft}
          isNew={!editing.id}
          busy={busy}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onCancel={() => {
            setEditing(null)
            setErr(null)
          }}
          onSave={save}
        />
      ) : !loaded ? (
        <div className="text-[12px] text-[#9CA3AF] py-4">Loading…</div>
      ) : features.length === 0 ? (
        <div className="text-[12px] text-[#9CA3AF] py-4">No features yet.</div>
      ) : (
        <div className="border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
          {features.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2">
              <button onClick={() => setEditing({ id: f.id, draft: toInput(f) })} className="flex-1 min-w-0 text-left">
                <div className="text-[13px] font-medium text-[#111] truncate">{f.name}</div>
                <div className="text-[11px] text-[#6B7280]">{summary(f)}</div>
              </button>
              <button onClick={() => archive(f)} className="p-1.5 text-[#D1D5DB] hover:text-[#DC2626]" aria-label={`Archive ${f.name}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function summary(f: SwtFeature): string {
  const h = (x: SwtHours) => (x.eng + x.cnc + x.assembly + x.finish).toFixed(2)
  if (f.pricing_mode === 'length_steps') {
    const steps = f.steps.map((s) => `${s.up_to_ft}′ ${h(s.hours)} h`).join(' · ')
    return `By length · ${steps || 'no steps yet'}`
  }
  const unit = f.pricing_mode === 'each' ? 'each' : 'sq ft'
  return `${MODE_LABEL[f.pricing_mode]} · ${h(f.hours)} h + $${f.material_per_unit.toFixed(2)} per ${unit}`
}

const numCls =
  'w-full bg-white border border-[#E5E7EB] rounded-md px-2 py-1 text-[12.5px] text-[#111] outline-none focus:border-[#2563EB] tabular-nums'

function Num({ value, onChange, step = 0.05 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className={numCls}
    />
  )
}

function HoursRow({ hours, onChange }: { hours: SwtHours; onChange: (h: SwtHours) => void }) {
  return (
    <>
      {DEPTS.map((d) => (
        <Num key={d.key} value={hours[d.key]} onChange={(v) => onChange({ ...hours, [d.key]: v })} />
      ))}
    </>
  )
}

function FeatureEditor({
  draft,
  isNew,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: SwtFeatureInput
  isNew: boolean
  busy: boolean
  onChange: (d: SwtFeatureInput) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = (patch: Partial<SwtFeatureInput>) => onChange({ ...draft, ...patch })
  const setStep = (i: number, patch: Partial<SwtStep>) =>
    set({ steps: draft.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const unit = draft.pricing_mode === 'each' ? 'piece' : 'sq ft'
  const grid = 'grid grid-cols-[1.4fr_repeat(4,1fr)_1.2fr_auto] gap-2 items-center'

  return (
    <div className="border border-[#BFDBFE] bg-[#F8FAFF] rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <label className="text-[11px] text-[#6B7280]">
          Name
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Bowtie, Hand-rubbed finish, Miter · 8/4…"
            className="mt-0.5 w-full bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
          />
        </label>
        <label className="text-[11px] text-[#6B7280]">
          Priced
          <select
            value={draft.pricing_mode}
            onChange={(e) => {
              const mode = e.target.value as SwtPricingMode
              set({
                pricing_mode: mode,
                steps: mode === 'length_steps' && draft.steps.length === 0 ? blank('length_steps').steps : draft.steps,
              })
            }}
            className="mt-0.5 w-full bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
          >
            {(Object.keys(MODE_LABEL) as SwtPricingMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11.5px] text-[#6B7280] -mt-2">{MODE_HINT[draft.pricing_mode]}</p>

      {draft.pricing_mode !== 'length_steps' ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[repeat(4,1fr)_1.2fr] gap-2 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {DEPTS.map((d) => (
              <span key={d.key}>{d.label} h</span>
            ))}
            <span>Material $</span>
          </div>
          <div className="grid grid-cols-[repeat(4,1fr)_1.2fr] gap-2">
            <HoursRow hours={draft.hours} onChange={(hours) => set({ hours })} />
            <Num value={draft.material_per_unit} step={0.5} onChange={(v) => set({ material_per_unit: v })} />
          </div>
          <div className="text-[11px] text-[#9CA3AF]">Per {unit}.</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className={`${grid} text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]`}>
            <span>Up to (ft)</span>
            {DEPTS.map((d) => (
              <span key={d.key}>{d.label} h</span>
            ))}
            <span>Material $</span>
            <span />
          </div>
          {draft.steps.map((st, i) => (
            <div key={i} className={grid}>
              <Num value={st.up_to_ft} step={1} onChange={(v) => setStep(i, { up_to_ft: Math.max(1, Math.round(v)) })} />
              <HoursRow hours={st.hours} onChange={(hours) => setStep(i, { hours })} />
              <Num value={st.material} step={0.5} onChange={(v) => setStep(i, { material: v })} />
              <button
                onClick={() => set({ steps: draft.steps.filter((_, k) => k !== i) })}
                className="p-1 text-[#D1D5DB] hover:text-[#DC2626]"
                aria-label="Remove step"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const last = draft.steps[draft.steps.length - 1]
              set({
                steps: [
                  ...draft.steps,
                  { up_to_ft: (last?.up_to_ft || 0) + 1, hours: { ...(last?.hours || ZERO_HOURS) }, material: last?.material || 0 },
                ],
              })
            }}
            className="text-[12px] font-semibold text-[#2563EB] hover:underline"
          >
            + Add step
          </button>
          <div className={`${grid} pt-2 border-t border-[#E5E7EB]`}>
            <span className="text-[11.5px] text-[#374151]">Each extra ft</span>
            <HoursRow hours={draft.extra_ft_hours} onChange={(extra_ft_hours) => set({ extra_ft_hours })} />
            <Num value={draft.extra_ft_material} step={0.5} onChange={(v) => set({ extra_ft_material: v })} />
            <span />
          </div>
          <div className="text-[11px] text-[#9CA3AF]">
            Each step is the WHOLE price for that length, not a rate. Lengths past the last step add the extra-foot
            numbers per foot.
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-[12px] font-medium rounded-md text-[#374151] hover:bg-[#F3F4F6]">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={busy}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {busy ? 'Saving…' : isNew ? 'Add feature' : 'Save'}
        </button>
      </div>
    </div>
  )
}

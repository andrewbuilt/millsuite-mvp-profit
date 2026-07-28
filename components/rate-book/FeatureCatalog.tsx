'use client'

// ============================================================================
// FeatureCatalog — cabinet features editor (rate-book chunk F).
// ============================================================================
// Generalizes the LED editor. A feature is calibrated per LF (labor by dept +
// material), with a mode: 'runs' (LED — multiple rows on a line) or 'toggle'
// (face frame — per-line on/off). Material = flat $/LF and/or catalog stock ×
// consumption/LF. Mounted in /rate-book behind the "Features" view toggle.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Search } from 'lucide-react'
import {
  listCabinetFeatures,
  createCabinetFeature,
  updateCabinetFeature,
  archiveCabinetFeature,
  featureLaborPerLf,
  type CabinetFeature,
  type FeatureMode,
} from '@/lib/features'
import { listMaterials, type Material } from '@/lib/materials'

const DEPTS = [
  { key: 'labor_hours_eng_per_lf', label: 'Eng' },
  { key: 'labor_hours_cnc_per_lf', label: 'CNC' },
  { key: 'labor_hours_assembly_per_lf', label: 'Assembly' },
  { key: 'labor_hours_finish_per_lf', label: 'Finish' },
] as const

interface Draft {
  name: string
  mode: FeatureMode
  labor_hours_eng_per_lf: string
  labor_hours_cnc_per_lf: string
  labor_hours_assembly_per_lf: string
  labor_hours_finish_per_lf: string
  material_cost_per_lf: string
  material_id: string
  material_consumption_per_lf: string
}

const EMPTY: Draft = {
  name: '',
  mode: 'runs',
  labor_hours_eng_per_lf: '',
  labor_hours_cnc_per_lf: '',
  labor_hours_assembly_per_lf: '',
  labor_hours_finish_per_lf: '',
  material_cost_per_lf: '',
  material_id: '',
  material_consumption_per_lf: '',
}

function toDraft(f: CabinetFeature): Draft {
  return {
    name: f.name,
    mode: f.mode,
    labor_hours_eng_per_lf: String(f.labor_hours_eng_per_lf),
    labor_hours_cnc_per_lf: String(f.labor_hours_cnc_per_lf),
    labor_hours_assembly_per_lf: String(f.labor_hours_assembly_per_lf),
    labor_hours_finish_per_lf: String(f.labor_hours_finish_per_lf),
    material_cost_per_lf: String(f.material_cost_per_lf),
    material_id: f.material_id ?? '',
    material_consumption_per_lf: String(f.material_consumption_per_lf),
  }
}

function draftToInput(d: Draft) {
  return {
    name: d.name.trim(),
    mode: d.mode,
    labor_hours_eng_per_lf: Number(d.labor_hours_eng_per_lf) || 0,
    labor_hours_cnc_per_lf: Number(d.labor_hours_cnc_per_lf) || 0,
    labor_hours_assembly_per_lf: Number(d.labor_hours_assembly_per_lf) || 0,
    labor_hours_finish_per_lf: Number(d.labor_hours_finish_per_lf) || 0,
    material_cost_per_lf: Number(d.material_cost_per_lf) || 0,
    material_id: d.material_id || null,
    material_consumption_per_lf: Number(d.material_consumption_per_lf) || 0,
  }
}

export default function FeatureCatalog({ orgId }: { orgId: string }) {
  const [features, setFeatures] = useState<CabinetFeature[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [fs, mats] = await Promise.all([listCabinetFeatures(orgId), listMaterials(orgId)])
    setFeatures(fs)
    setMaterials(mats)
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  const matName = (id: string | null) => materials.find((m) => m.id === id)?.name

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? features.filter((f) => f.name.toLowerCase().includes(s)) : features
  }, [features, search])

  function reset() {
    setEditingId(null)
    setAdding(false)
    setDraft(EMPTY)
    setAddDraft(EMPTY)
    setConfirmDeleteId(null)
    setError(null)
  }

  async function saveEdit(id: string) {
    const input = draftToInput(draft)
    if (!input.name) return setError('Name is required.')
    setSaving(true)
    setError(null)
    try {
      await updateCabinetFeature(id, input)
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveAdd() {
    const input = draftToInput(addDraft)
    if (!input.name) return setError('Name is required.')
    setSaving(true)
    setError(null)
    try {
      await createCabinetFeature({ org_id: orgId, ...input })
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Add failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setSaving(true)
    try {
      await archiveCabinetFeature(id)
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-[16px] font-semibold text-[#111]">Cabinet features</h1>
          <button
            onClick={() => {
              reset()
              setAdding(true)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New feature
          </button>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[640px]">
          Add-ons for cabinet lines, calibrated per linear foot. A{' '}
          <strong>runs</strong> feature (like LED) adds several rows to a line (type + feet each);
          a <strong>toggle</strong> feature (like a face frame) is a per-line on/off that applies at
          the run's length. Labor flows into the line's dept hours; material is a flat $/LF and/or
          catalog stock it consumes.
        </p>

        <div className="relative mb-3 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#9CA3AF]" />
          <input
            className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            placeholder="Search features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {adding && (
          <div className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
              New feature
            </div>
            <FeatureFields draft={addDraft} setDraft={setAddDraft} materials={materials} />
            <div className="flex items-center gap-2 mt-3">
              <button
                disabled={saving}
                onClick={saveAdd}
                className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add feature'}
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!loaded ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading features…</div>
        ) : filtered.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
            {features.length === 0
              ? 'No features yet. Add one — e.g. Under-cabinet LED (runs) or Face frame (toggle).'
              : 'No features match your search.'}
          </div>
        ) : (
          <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-[#FAFAFA] text-[#6B7280] text-[11px] uppercase tracking-wider">
                  <th className="text-left font-semibold px-3 py-2">Feature</th>
                  <th className="text-left font-semibold px-3 py-2 w-[80px]">Mode</th>
                  <th className="text-left font-semibold px-3 py-2 w-[100px]">Labor / LF</th>
                  <th className="text-left font-semibold px-3 py-2">Material / LF</th>
                  <th className="px-3 py-2 w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  if (editingId === f.id) {
                    return (
                      <tr key={f.id} className="border-t border-[#E5E7EB] bg-[#EFF6FF]">
                        <td colSpan={5} className="px-3 py-3">
                          <FeatureFields draft={draft} setDraft={setDraft} materials={materials} />
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              disabled={saving}
                              onClick={() => saveEdit(f.id)}
                              className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={reset}
                              className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  const totalHr = featureLaborPerLf(f)
                  return (
                    <tr key={f.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFA]">
                      <td className="px-3 py-2">
                        <span className="font-medium text-[#111]">{f.name}</span>
                        {!f.calibrated && (
                          <span className="ml-2 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                            Uncalibrated
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] capitalize">
                          {f.mode}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[#374151] whitespace-nowrap">
                        {totalHr.toFixed(2)} hr
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap">
                        {f.material_cost_per_lf > 0 && (
                          <span className="text-[#2563EB]">${Number(f.material_cost_per_lf).toFixed(2)}</span>
                        )}
                        {f.material_id && (
                          <span className="text-[#6B7280]">
                            {f.material_cost_per_lf > 0 ? ' + ' : ''}
                            {f.material_consumption_per_lf} {matName(f.material_id) || 'stock'}
                          </span>
                        )}
                        {!f.material_cost_per_lf && !f.material_id && (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {confirmDeleteId === f.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              disabled={saving}
                              onClick={() => remove(f.id)}
                              className="px-2 py-1 rounded text-[11px] font-medium bg-[#DC2626] text-white hover:bg-[#B91C1C] disabled:opacity-50"
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded text-[11px] text-[#6B7280] hover:bg-[#F3F4F6]"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <button
                              onClick={() => {
                                reset()
                                setEditingId(f.id)
                                setDraft(toDraft(f))
                              }}
                              className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(f.id)}
                              title="Remove feature"
                              className="p-1 rounded text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureFields({
  draft,
  setDraft,
  materials,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  materials: Material[]
}) {
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v })
  const lbl = 'text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]'
  const input =
    'w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]'
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_160px] gap-2">
        <label className="block">
          <span className={lbl}>Name</span>
          <input
            autoFocus
            className={input}
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Face frame"
          />
        </label>
        <label className="block">
          <span className={lbl}>Mode</span>
          <select
            className={input}
            value={draft.mode}
            onChange={(e) => set('mode', e.target.value as FeatureMode)}
          >
            <option value="runs">Runs (rows)</option>
            <option value="toggle">Toggle (on/off)</option>
          </select>
        </label>
      </div>
      <div>
        <span className={lbl}>Labor hours per LF</span>
        <div className="grid grid-cols-4 gap-2 mt-0.5">
          {DEPTS.map((d) => (
            <label key={d.key} className="block">
              <span className="text-[10px] text-[#9CA3AF]">{d.label}</span>
              <input
                type="number"
                step="0.01"
                className="w-full mt-0.5 px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                value={draft[d.key]}
                onChange={(e) => set(d.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        <span className={lbl}>Material per LF</span>
        <div className="grid grid-cols-[130px_1fr_110px] gap-2 mt-0.5 items-end">
          <label className="block">
            <span className="text-[10px] text-[#9CA3AF]">Flat $ / LF</span>
            <input
              type="number"
              step="0.01"
              className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              value={draft.material_cost_per_lf}
              onChange={(e) => set('material_cost_per_lf', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-[#9CA3AF]">Catalog stock (optional)</span>
            <select
              className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
              value={draft.material_id}
              onChange={(e) => set('material_id', e.target.value)}
            >
              <option value="">— none —</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-[#9CA3AF]">Qty / LF</span>
            <input
              type="number"
              step="0.01"
              disabled={!draft.material_id}
              className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB] disabled:bg-[#F9FAFB]"
              value={draft.material_consumption_per_lf}
              onChange={(e) => set('material_consumption_per_lf', e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

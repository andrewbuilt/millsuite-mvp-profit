'use client'

// ============================================================================
// LedCatalog — LED types editor (rate-book overhaul, chunk D).
// ============================================================================
// Each LED type is calibrated per linear foot: labor hours/LF by dept +
// material $/LF. The composer adds LED rows (type + LF) to cabinet lines and
// prices them from here. Mounted in /rate-book behind the "LEDs" view toggle.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Search } from 'lucide-react'
import {
  listLedTypes,
  createLedType,
  updateLedType,
  archiveLedType,
  ledLaborPerLf,
  type LedType,
} from '@/lib/led'

const DEPTS = [
  { key: 'labor_hours_eng_per_lf', label: 'Eng' },
  { key: 'labor_hours_cnc_per_lf', label: 'CNC' },
  { key: 'labor_hours_assembly_per_lf', label: 'Assembly' },
  { key: 'labor_hours_finish_per_lf', label: 'Finish' },
] as const

interface Draft {
  name: string
  labor_hours_eng_per_lf: string
  labor_hours_cnc_per_lf: string
  labor_hours_assembly_per_lf: string
  labor_hours_finish_per_lf: string
  material_cost_per_lf: string
}

const EMPTY: Draft = {
  name: '',
  labor_hours_eng_per_lf: '',
  labor_hours_cnc_per_lf: '',
  labor_hours_assembly_per_lf: '',
  labor_hours_finish_per_lf: '',
  material_cost_per_lf: '',
}

function toDraft(t: LedType): Draft {
  return {
    name: t.name,
    labor_hours_eng_per_lf: String(t.labor_hours_eng_per_lf),
    labor_hours_cnc_per_lf: String(t.labor_hours_cnc_per_lf),
    labor_hours_assembly_per_lf: String(t.labor_hours_assembly_per_lf),
    labor_hours_finish_per_lf: String(t.labor_hours_finish_per_lf),
    material_cost_per_lf: String(t.material_cost_per_lf),
  }
}

function draftNums(d: Draft) {
  return {
    name: d.name.trim(),
    labor_hours_eng_per_lf: Number(d.labor_hours_eng_per_lf) || 0,
    labor_hours_cnc_per_lf: Number(d.labor_hours_cnc_per_lf) || 0,
    labor_hours_assembly_per_lf: Number(d.labor_hours_assembly_per_lf) || 0,
    labor_hours_finish_per_lf: Number(d.labor_hours_finish_per_lf) || 0,
    material_cost_per_lf: Number(d.material_cost_per_lf) || 0,
  }
}

export default function LedCatalog({ orgId }: { orgId: string }) {
  const [leds, setLeds] = useState<LedType[]>([])
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
    setLeds(await listLedTypes(orgId))
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? leds.filter((l) => l.name.toLowerCase().includes(s)) : leds
  }, [leds, search])

  function reset() {
    setEditingId(null)
    setAdding(false)
    setDraft(EMPTY)
    setAddDraft(EMPTY)
    setConfirmDeleteId(null)
    setError(null)
  }

  async function saveEdit(id: string) {
    const n = draftNums(draft)
    if (!n.name) return setError('Name is required.')
    setSaving(true)
    setError(null)
    try {
      await updateLedType(id, n)
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveAdd() {
    const n = draftNums(addDraft)
    if (!n.name) return setError('Name is required.')
    setSaving(true)
    setError(null)
    try {
      await createLedType({ org_id: orgId, ...n })
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
      await archiveLedType(id)
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
          <h1 className="text-[16px] font-semibold text-[#111]">LED types</h1>
          <button
            onClick={() => {
              reset()
              setAdding(true)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New LED type
          </button>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[600px]">
          Each LED type is calibrated <strong>per linear foot</strong> — labor hours by dept + material
          $/LF. On a cabinet line in the composer you add LED rows (type + how many feet); the hours
          flow into the line's dept hours and the material into its cost.
        </p>

        <div className="relative mb-3 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#9CA3AF]" />
          <input
            className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            placeholder="Search LED types…"
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
              New LED type
            </div>
            <LedFields draft={addDraft} setDraft={setAddDraft} />
            <div className="flex items-center gap-2 mt-3">
              <button
                disabled={saving}
                onClick={saveAdd}
                className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add LED type'}
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
          <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading LED types…</div>
        ) : filtered.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
            {leds.length === 0
              ? 'No LED types yet. Add one (e.g. Under-cabinet, Interior, Toe-kick).'
              : 'No LED types match your search.'}
          </div>
        ) : (
          <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-[#FAFAFA] text-[#6B7280] text-[11px] uppercase tracking-wider">
                  <th className="text-left font-semibold px-3 py-2">LED type</th>
                  <th className="text-left font-semibold px-3 py-2 w-[110px]">Labor / LF</th>
                  <th className="text-left font-semibold px-3 py-2 w-[110px]">Material / LF</th>
                  <th className="px-3 py-2 w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  if (editingId === l.id) {
                    return (
                      <tr key={l.id} className="border-t border-[#E5E7EB] bg-[#EFF6FF]">
                        <td colSpan={4} className="px-3 py-3">
                          <LedFields draft={draft} setDraft={setDraft} />
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              disabled={saving}
                              onClick={() => saveEdit(l.id)}
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
                  const totalHr = ledLaborPerLf(l)
                  return (
                    <tr key={l.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFA]">
                      <td className="px-3 py-2">
                        <span className="font-medium text-[#111]">{l.name}</span>
                        {!l.calibrated && (
                          <span className="ml-2 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                            Uncalibrated
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[#374151] whitespace-nowrap">
                        {totalHr.toFixed(2)} hr
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        <span className="text-[#2563EB] font-medium">
                          ${Number(l.material_cost_per_lf).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {confirmDeleteId === l.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              disabled={saving}
                              onClick={() => remove(l.id)}
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
                                setEditingId(l.id)
                                setDraft(toDraft(l))
                              }}
                              className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(l.id)}
                              title="Remove LED type"
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

function LedFields({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v })
  return (
    <div className="space-y-2.5">
      <label className="block max-w-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Name</span>
        <input
          autoFocus
          className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Under-cabinet"
        />
      </label>
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Labor hours per LF
        </span>
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
      <label className="block w-40">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Material $ / LF
        </span>
        <input
          type="number"
          step="0.01"
          className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
          value={draft.material_cost_per_lf}
          onChange={(e) => set('material_cost_per_lf', e.target.value)}
        />
      </label>
    </div>
  )
}

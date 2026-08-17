'use client'

// ============================================================================
// MaterialsCatalog — the master materials price list (rate-book chunk B/C).
// ============================================================================
// ONE org-scoped catalog behind every composer material slot. Edit a price
// here and every estimate line that references the material reprices (the
// composer sources cost from this table via each pool row's material_id —
// see lib/composer-loader.ts). Consumption (sheets/LF, sheets/door) lives on
// the product, not here — this list is purely price + which slots it shows in.
//
// Mounted in /rate-book behind the "Materials" view toggle.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Search } from 'lucide-react'
import {
  listMaterials,
  createMaterial,
  updateMaterial,
  archiveMaterial,
  type Material,
  type MaterialCostUnit,
} from '@/lib/materials'
import { announce } from '@/lib/tour-events'

const COST_UNITS: { value: MaterialCostUnit; label: string; per: string }[] = [
  { value: 'sheet', label: 'Sheet', per: '/ sheet' },
  { value: 'lf', label: 'Linear ft', per: '/ LF' },
  { value: 'bf', label: 'Board ft', per: '/ BF' },
  { value: 'ea', label: 'Each', per: '/ ea' },
  { value: 'lump', label: 'Lump sum', per: 'lump' },
]
const PER_LABEL: Record<MaterialCostUnit, string> = {
  sheet: '/ sheet',
  lf: '/ LF',
  bf: '/ BF',
  ea: '/ ea',
  lump: 'lump',
}

const SLOT_FLAGS = [
  { key: 'show_in_carcass', label: 'Carcass' },
  { key: 'show_in_door', label: 'Door' },
  { key: 'show_in_back_panel', label: 'Back panel' },
  { key: 'show_in_shelf', label: 'Shelf' },
] as const

type DraftFlags = Pick<
  Material,
  'show_in_carcass' | 'show_in_door' | 'show_in_back_panel' | 'show_in_shelf'
>

interface Draft extends DraftFlags {
  name: string
  cost_value: string
  cost_unit: MaterialCostUnit
  notes: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  cost_value: '',
  cost_unit: 'sheet',
  notes: '',
  show_in_carcass: false,
  show_in_door: false,
  show_in_back_panel: false,
  show_in_shelf: false,
}

function toDraft(m: Material): Draft {
  return {
    name: m.name,
    cost_value: String(m.cost_value ?? ''),
    cost_unit: m.cost_unit,
    notes: m.notes ?? '',
    show_in_carcass: m.show_in_carcass,
    show_in_door: m.show_in_door,
    show_in_back_panel: m.show_in_back_panel,
    show_in_shelf: m.show_in_shelf,
  }
}

export default function MaterialsCatalog({ orgId }: { orgId: string }) {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const rows = await listMaterials(orgId)
    setMaterials(rows)
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return materials
    return materials.filter(
      (m) => m.name.toLowerCase().includes(s) || (m.notes || '').toLowerCase().includes(s),
    )
  }, [materials, search])

  function startEdit(m: Material) {
    setEditingId(m.id)
    setDraft(toDraft(m))
    setConfirmDeleteId(null)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  async function saveEdit(id: string) {
    if (!draft.name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateMaterial(id, {
        name: draft.name.trim(),
        cost_value: Number(draft.cost_value) || 0,
        cost_unit: draft.cost_unit,
        notes: draft.notes.trim() || null,
        show_in_carcass: draft.show_in_carcass,
        show_in_door: draft.show_in_door,
        show_in_back_panel: draft.show_in_back_panel,
        show_in_shelf: draft.show_in_shelf,
      })
      await reload()
      cancelEdit()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveAdd() {
    if (!addDraft.name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createMaterial({
        org_id: orgId,
        name: addDraft.name.trim(),
        cost_value: Number(addDraft.cost_value) || 0,
        cost_unit: addDraft.cost_unit,
        notes: addDraft.notes.trim() || null,
        show_in_carcass: addDraft.show_in_carcass,
        show_in_door: addDraft.show_in_door,
        show_in_back_panel: addDraft.show_in_back_panel,
        show_in_shelf: addDraft.show_in_shelf,
      })
      await reload()
      // After the reload, so the walkthrough's next card shows up with the new
      // row already on screen. Creates only — the lesson teaches the first one.
      announce('ms:material-created')
      setAdding(false)
      setAddDraft(EMPTY_DRAFT)
    } catch (e: any) {
      setError(e?.message || 'Add failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setSaving(true)
    try {
      await archiveMaterial(id)
      await reload()
      setConfirmDeleteId(null)
    } catch (e: any) {
      setError(e?.message || 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-[16px] font-semibold text-[#111]">Materials catalog</h1>
          <button
            onClick={() => {
              setAdding(true)
              setAddDraft(EMPTY_DRAFT)
              setError(null)
            }}
            data-tour="add-material"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New material
          </button>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[560px]">
          One price per material. Edit a price here and every estimate line that uses it
          reprices. "Shows in" controls which composer slots list it as a quick pick, and a
          material can appear in several. How much a product consumes (sheets per foot,
          etc.) lives on the product, not here.
        </p>

        {/* Search */}
        <div className="relative mb-3 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#9CA3AF]" />
          <input
            className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            placeholder="Search materials…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Add row */}
        {adding && (
          /* data-tour: the rate-book lesson rings the WHOLE form — name, price,
             flags AND the Add button — and advances on ms:material-created, so
             the instruction covers the entire action, not one field of it. */
          <div
            data-tour="material-form"
            className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
              New material
            </div>
            <DraftFields draft={addDraft} setDraft={setAddDraft} tourTag="material-show-in" />
            <div className="flex items-center gap-2 mt-3">
              <button
                disabled={saving}
                onClick={saveAdd}
                className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Add material'}
              </button>
              <button
                onClick={() => {
                  setAdding(false)
                  setError(null)
                }}
                className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {!loaded ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading materials…</div>
        ) : filtered.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
            {materials.length === 0
              ? 'No materials yet. Add one, or they appear here as you create them in the composer.'
              : 'No materials match your search.'}
          </div>
        ) : (
          /* data-tour: the lesson's "That's a live price" step points at the
             table right after the first save lands in it. */
          <div data-tour="materials-table" className="border border-[#E5E7EB] rounded-lg overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-[#FAFAFA] text-[#6B7280] text-[11px] uppercase tracking-wider">
                  <th className="text-left font-semibold px-3 py-2">Material</th>
                  <th className="text-left font-semibold px-3 py-2 w-[160px]">Price</th>
                  <th className="text-left font-semibold px-3 py-2">Shows in</th>
                  <th className="px-3 py-2 w-[120px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const isEditing = editingId === m.id
                  if (isEditing) {
                    return (
                      <tr key={m.id} className="border-t border-[#E5E7EB] bg-[#EFF6FF] align-top">
                        <td colSpan={4} className="px-3 py-3">
                          <DraftFields draft={draft} setDraft={setDraft} />
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              disabled={saving}
                              onClick={() => saveEdit(m.id)}
                              className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={m.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFA]">
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#111]">{m.name}</div>
                        {m.notes && <div className="text-[11px] text-[#9CA3AF]">{m.notes}</div>}
                      </td>
                      <td className="px-3 py-2 text-[#374151] whitespace-nowrap">
                        <span className="text-[#2563EB] font-medium">
                          ${Number(m.cost_value).toFixed(2)}
                        </span>{' '}
                        <span className="text-[#9CA3AF]">{PER_LABEL[m.cost_unit]}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {SLOT_FLAGS.filter((f) => m[f.key]).map((f) => (
                            <span
                              key={f.key}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]"
                            >
                              {f.label}
                            </span>
                          ))}
                          {!SLOT_FLAGS.some((f) => m[f.key]) && (
                            <span className="text-[11px] text-[#9CA3AF] italic">
                              browse-all only
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {confirmDeleteId === m.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              disabled={saving}
                              onClick={() => remove(m.id)}
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
                              onClick={() => startEdit(m)}
                              className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(m.id)}
                              title="Remove from catalog"
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

// Shared name/price/unit/flags/notes editor for both add + inline edit.
function DraftFields({
  draft,
  setDraft,
  tourTag,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  /** data-tour hook for the walkthrough's "Where it shows up" step. Passed ONLY
   *  by the add form: this component also renders for every row being edited,
   *  and opening the add form doesn't close an open editor — two elements with
   *  the same data-tour value would leave querySelector picking whichever came
   *  first in the document. */
  tourTag?: string
}) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_120px_130px] gap-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Name
          </span>
          <input
            autoFocus
            className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="e.g. 3/4 Maple Ply"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Price
          </span>
          <input
            type="number"
            step="0.01"
            className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.cost_value}
            onChange={(e) => setDraft({ ...draft, cost_value: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Per
          </span>
          <select
            className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.cost_unit}
            onChange={(e) =>
              setDraft({ ...draft, cost_unit: e.target.value as MaterialCostUnit })
            }
          >
            {COST_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div data-tour={tourTag}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Shows in (quick-pick slots)
        </span>
        <div className="flex flex-wrap gap-3 mt-1">
          {SLOT_FLAGS.map((f) => (
            <label key={f.key} className="inline-flex items-center gap-1.5 text-[12px] text-[#374151]">
              <input
                type="checkbox"
                checked={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Notes (optional)
        </span>
        <input
          className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
    </div>
  )
}

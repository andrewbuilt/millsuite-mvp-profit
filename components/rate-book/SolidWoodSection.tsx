'use client'

// ============================================================================
// SolidWoodSection — solid-wood stock, priced by the board foot.
// ============================================================================
// The DATA MODEL already existed and was complete (migration 039:
// solid_wood_components — species, thickness_quarters, cost_per_bdft,
// waste_pct). Andrew simply couldn't find it: the only UI was a collapsed
// synthetic group at the bottom of the Line items sidebar with a read-only
// detail pane. This section moves it into the Materials tab where anyone
// looking for "what does my stock cost" would actually look.
//
// Its own section rather than extra catalog rows, on purpose — solid wood is
// priced per BOARD FOOT with a waste factor, so it shares no columns with a
// $/sheet catalog material. Grouped by species, one row per thickness, which
// is how a shop thinks about it ("4/4 walnut, 8/4 walnut").
//
// The SolidWoodWalkthrough stays as the guided-create path (it's what the
// composer opens when there's nothing to pick); the add row here is the fast
// path for someone already in the rate book.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  createSolidWoodComponent,
  deleteSolidWoodComponent,
  formatThickness,
  loadSolidWoodComponents,
  updateSolidWoodComponent,
  type SolidWoodComponent,
} from '@/lib/solid-wood'
import { recalculateMaterialsForSolidWood } from '@/lib/door-types'
import { useConfirm } from '@/components/confirm-dialog'

/** The sawmill thicknesses nearly every order uses; anything else is typed in. */
const THICKNESS_PRESETS = [4, 5, 6, 8]

interface Draft {
  species: string
  thickness_quarters: string
  cost_per_bdft: string
  waste_pct: string
  notes: string
}

const EMPTY_DRAFT: Draft = {
  species: '',
  thickness_quarters: '4',
  cost_per_bdft: '',
  waste_pct: '15',
  notes: '',
}

function toDraft(r: SolidWoodComponent): Draft {
  return {
    species: r.species || '',
    thickness_quarters: String(r.thickness_quarters || 4),
    cost_per_bdft: String(r.cost_per_bdft ?? ''),
    waste_pct: String(r.waste_pct ?? 0),
    notes: r.notes ?? '',
  }
}

/** `name` is required by the table and is what the composer's dropdown shows,
 *  but species + thickness are the real identity — so it's derived rather
 *  than being a third thing to keep in sync. */
function nameFor(species: string, quarters: number): string {
  return `${formatThickness(quarters)} ${species.trim()}`.trim()
}

export default function SolidWoodSection({ orgId }: { orgId: string }) {
  const { confirm } = useConfirm()
  const [rows, setRows] = useState<SolidWoodComponent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recalcing, setRecalcing] = useState(false)
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setRows(await loadSolidWoodComponents(orgId))
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  /** Species → its thicknesses, thinnest first. */
  const groups = useMemo(() => {
    const bySpecies = new Map<string, SolidWoodComponent[]>()
    for (const r of rows) {
      const key = (r.species || '').trim() || 'Unspecified'
      const bucket = bySpecies.get(key)
      if (bucket) bucket.push(r)
      else bySpecies.set(key, [r])
    }
    return [...bySpecies.entries()]
      .map(([species, list]) => ({
        species,
        list: [...list].sort((a, b) => a.thickness_quarters - b.thickness_quarters),
      }))
      .sort((a, b) => a.species.localeCompare(b.species))
  }, [rows])

  const speciesOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) {
      const v = (r.species || '').trim()
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [rows])

  function parsed(d: Draft) {
    return {
      species: d.species.trim(),
      quarters: Math.max(1, Math.round(Number(d.thickness_quarters) || 0)),
      cost: Number(d.cost_per_bdft),
      waste: Number(d.waste_pct),
    }
  }

  /** Same guards the walkthrough applies — a negative cost or a 100% waste
   *  factor would quietly poison every line priced off this stock. */
  function validate(d: Draft): string | null {
    const { species, quarters, cost, waste } = parsed(d)
    if (!species) return 'Species is required.'
    if (!Number.isFinite(quarters) || quarters < 1) return 'Thickness needs to be at least 1/4.'
    if (!Number.isFinite(cost) || cost < 0) return 'Cost per board foot needs a non-negative number.'
    if (!Number.isFinite(waste) || waste < 0 || waste >= 100) return 'Waste % needs to be 0–99.'
    return null
  }

  async function saveEdit(id: string) {
    const msg = validate(draft)
    if (msg) return setError(msg)
    setSaving(true)
    setError(null)
    try {
      const { species, quarters, cost, waste } = parsed(draft)
      await updateSolidWoodComponent(id, {
        name: nameFor(species, quarters),
        species,
        thickness_quarters: quarters,
        cost_per_bdft: cost,
        waste_pct: waste,
        notes: draft.notes.trim() || null,
      })
      await reload()
      setEditingId(null)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveAdd() {
    const msg = validate(addDraft)
    if (msg) return setError(msg)
    setSaving(true)
    setError(null)
    try {
      const { species, quarters, cost, waste } = parsed(addDraft)
      await createSolidWoodComponent({
        orgId,
        name: nameFor(species, quarters),
        species,
        thickness_quarters: quarters,
        cost_per_bdft: cost,
        waste_pct: waste,
        notes: addDraft.notes.trim() || null,
      })
      await reload()
      setAdding(false)
      setAddDraft(EMPTY_DRAFT)
    } catch (e: any) {
      setError(e?.message || 'Add failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: SolidWoodComponent) {
    const ok = await confirm({
      title: 'Delete solid wood stock?',
      message: `Delete "${row.name}"? Lines that already reference it stay priced from their saved snapshot.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    setSaving(true)
    try {
      await deleteSolidWoodComponent(row.id)
      await reload()
    } catch (e: any) {
      setError(e?.message || 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  /** Reprice every door material derived from solid wood. Carried over from
   *  the retired detail pane — editing $/BdFt here doesn't reach linked door
   *  materials on its own, and losing this button would strand them. */
  async function recalcAll() {
    if (recalcing || rows.length === 0) return
    setRecalcing(true)
    setRecalcMsg(null)
    try {
      let touched = 0
      for (const r of rows) touched += await recalculateMaterialsForSolidWood(r.id)
      setRecalcMsg(
        touched === 0
          ? 'Nothing linked to recalculate.'
          : `${touched} door material${touched === 1 ? '' : 's'} recalculated.`,
      )
    } catch (e) {
      setRecalcMsg(e instanceof Error ? e.message : 'Recalculation failed.')
    } finally {
      setRecalcing(false)
    }
  }

  return (
    <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-[16px] font-semibold text-[#111]">
          Solid wood <span className="font-normal text-[#9CA3AF]">· by the board foot</span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={recalcAll}
            disabled={recalcing || rows.length === 0}
            title="Reprice door materials that are cut from this stock"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recalcing ? 'animate-spin' : ''}`} />
            {recalcing ? 'Recalculating…' : 'Recalculate all'}
          </button>
          <button
            onClick={() => {
              setAdding(true)
              setAddDraft(EMPTY_DRAFT)
              setError(null)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New stock
          </button>
        </div>
      </div>
      <p className="text-[12px] text-[#6B7280] mb-4 max-w-[560px]">
        Lumber priced per board foot, with a waste factor. A line using it costs
        <span className="font-mono"> BdFt × $/BdFt × (1 + waste%)</span>. Sheet goods and
        anything bought by the piece live in the catalog above.
      </p>

      {error && (
        <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {recalcMsg && (
        <div className="mb-3 text-[12px] text-[#065F46] bg-[#ECFDF5] border border-[#A7F3D0] rounded-md px-3 py-2">
          {recalcMsg}
        </div>
      )}

      {adding && (
        <div className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
            New solid wood stock
          </div>
          <SolidWoodFields draft={addDraft} setDraft={setAddDraft} />
          <div className="flex items-center gap-2 mt-3">
            <button
              disabled={saving}
              onClick={saveAdd}
              className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add stock'}
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

      <datalist id="solid-wood-species-options">
        {speciesOptions.map((sp) => (
          <option key={sp} value={sp} />
        ))}
      </datalist>

      {!loaded ? (
        <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading solid wood…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
          No solid wood yet. Add a species and thickness and it becomes pickable on solid-wood
          lines.
        </div>
      ) : (
        <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#FAFAFA] text-[#6B7280] text-[11px] uppercase tracking-wider">
                <th className="text-left font-semibold px-3 py-2 w-[120px]">Thickness</th>
                <th className="text-left font-semibold px-3 py-2 w-[120px]">$ / BdFt</th>
                <th className="text-left font-semibold px-3 py-2 w-[90px]">Waste</th>
                <th className="text-left font-semibold px-3 py-2">Notes</th>
                <th className="px-3 py-2 w-[120px]" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <SpeciesGroup
                  key={g.species}
                  species={g.species}
                  list={g.list}
                  editingId={editingId}
                  draft={draft}
                  setDraft={setDraft}
                  saving={saving}
                  onStartEdit={(r) => {
                    setEditingId(r.id)
                    setDraft(toDraft(r))
                    setError(null)
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={saveEdit}
                  onRemove={remove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SpeciesGroup({
  species,
  list,
  editingId,
  draft,
  setDraft,
  saving,
  onStartEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: {
  species: string
  list: SolidWoodComponent[]
  editingId: string | null
  draft: Draft
  setDraft: (d: Draft) => void
  saving: boolean
  onStartEdit: (r: SolidWoodComponent) => void
  onCancelEdit: () => void
  onSave: (id: string) => void
  onRemove: (r: SolidWoodComponent) => void
}) {
  return (
    <>
      <tr className="bg-[#F3F4F6] border-t border-[#E5E7EB]">
        <td colSpan={5} className="px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4B5563]">
            {species}
          </span>
          <span className="ml-2 text-[11px] text-[#9CA3AF]">{list.length}</span>
        </td>
      </tr>
      {list.map((r) =>
        editingId === r.id ? (
          <tr key={r.id} className="border-t border-[#E5E7EB] bg-[#EFF6FF] align-top">
            <td colSpan={5} className="px-3 py-3">
              <SolidWoodFields draft={draft} setDraft={setDraft} />
              <div className="flex items-center gap-2 mt-3">
                <button
                  disabled={saving}
                  onClick={() => onSave(r.id)}
                  className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={onCancelEdit}
                  className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                >
                  Cancel
                </button>
              </div>
            </td>
          </tr>
        ) : (
          <tr key={r.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFA]">
            <td className="px-3 py-2 font-medium text-[#111]">
              {formatThickness(r.thickness_quarters)}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <span className="text-[#2563EB] font-medium">
                ${Number(r.cost_per_bdft).toFixed(2)}
              </span>
            </td>
            <td className="px-3 py-2 text-[#374151]">{Number(r.waste_pct)}%</td>
            <td className="px-3 py-2 text-[#6B7280]">{r.notes || '—'}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              <button
                onClick={() => onStartEdit(r)}
                className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
              >
                Edit
              </button>
              <button
                onClick={() => onRemove(r)}
                title="Delete"
                className="p-1 ml-1 rounded text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </td>
          </tr>
        ),
      )}
    </>
  )
}

/** Shared add / edit fields. */
function SolidWoodFields({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_236px_110px_100px] gap-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Species
          </span>
          <input
            autoFocus
            list="solid-wood-species-options"
            className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.species}
            onChange={(e) => setDraft({ ...draft, species: e.target.value })}
            placeholder="e.g. Walnut"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Thickness
          </span>
          <div className="flex gap-1 mt-0.5 items-stretch">
            {THICKNESS_PRESETS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setDraft({ ...draft, thickness_quarters: String(q) })}
                className={`px-1.5 py-1.5 rounded-md text-[12px] border transition-colors ${
                  Number(draft.thickness_quarters) === q
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {formatThickness(q)}
              </button>
            ))}
            <input
              type="number"
              min={1}
              title="Quarters"
              className="w-[52px] px-1.5 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB] shrink-0"
              value={draft.thickness_quarters}
              onChange={(e) => setDraft({ ...draft, thickness_quarters: e.target.value })}
            />
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            $ / BdFt
          </span>
          <input
            type="number"
            step="0.01"
            className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.cost_per_bdft}
            onChange={(e) => setDraft({ ...draft, cost_per_bdft: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Waste %
          </span>
          <input
            type="number"
            step="1"
            className="w-full mt-0.5 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            value={draft.waste_pct}
            onChange={(e) => setDraft({ ...draft, waste_pct: e.target.value })}
          />
        </label>
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

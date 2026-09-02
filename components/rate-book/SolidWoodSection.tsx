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
import { supabase } from '@/lib/supabase'
import SolidWoodTopWalkthrough from '@/components/walkthroughs/SolidWoodTopWalkthrough'
import type { SolidWoodTopOpKey } from '@/lib/composer'

/** The sawmill thicknesses nearly every order uses; anything else is typed in. */
const THICKNESS_PRESETS = [4, 5, 6, 8]

/** Which dept each calibration op bills to. MUST match the buckets in
 *  computeBreakdownSolidWoodTop — this card only summarises what that
 *  function prices, and a mismatch here would misreport real hours.
 *  The two cut ops are exclusive; the card shows whichever the default
 *  cut method selects. */
const OP_DEPT: Record<SolidWoodTopOpKey, 'eng' | 'cnc' | 'assembly' | 'finish'> = {
  eng_drawing: 'eng',
  cnc_cut_to_size: 'cnc',
  asy_wood_selection: 'assembly',
  asy_jointing: 'assembly',
  asy_planing: 'assembly',
  asy_ripping: 'assembly',
  asy_chopping: 'assembly',
  asy_glueup: 'assembly',
  asy_calib_sanding: 'assembly',
  asy_saw_cut_to_size: 'assembly',
  fin_sanding: 'finish',
  fin_apply: 'finish',
}

const DEPT_LABEL: Record<'eng' | 'cnc' | 'assembly' | 'finish', string> = {
  eng: 'Eng',
  cnc: 'CNC',
  assembly: 'Assembly',
  finish: 'Finish',
}

interface TopCalibration {
  calib_length_in: number
  calib_width_in: number
  calib_thickness_in: number
  hours_by_op: Partial<Record<SolidWoodTopOpKey, number>>
  edge_mult_hand: number
  edge_mult_cnc: number
  default_cut_method: 'saw' | 'cnc'
  updated_at: string | null
}

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

      {/* Labor calibration sits above the stock table: it's the other half of
          what a solid-wood line costs, and it used to be on Settings where
          nobody would look for it. */}
      <TopCalibrationCard orgId={orgId} />

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

/**
 * Solid Wood Top LABOR calibration — per-op hours for one typical top, which
 * the composer scales by BdFt on every line.
 *
 * Moved here from Settings (wave-2 item 9). Every other calibration — drawers,
 * doors, features, finishes — lives in the rate book, and this one being on
 * Settings meant nobody found it next to the stock it prices against.
 *
 * Distinct from the stock table below: that's what lumber COSTS, this is what
 * milling it takes.
 */
function TopCalibrationCard({ orgId }: { orgId: string }) {
  const [cal, setCal] = useState<TopCalibration | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('solid_wood_top_calibrations')
      .select(
        'calib_length_in, calib_width_in, calib_thickness_in, hours_by_op, edge_mult_hand, edge_mult_cnc, default_cut_method, updated_at',
      )
      .eq('org_id', orgId)
      .maybeSingle()
    setCal((data as TopCalibration | null) ?? null)
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Per-dept hours for the calibration piece, honouring the exclusive
   *  saw/CNC cut op the same way the pricer does. */
  const byDept = useMemo(() => {
    const out = { eng: 0, cnc: 0, assembly: 0, finish: 0 }
    if (!cal) return out
    const ops = cal.hours_by_op || {}
    for (const [k, v] of Object.entries(ops) as [SolidWoodTopOpKey, number][]) {
      // Only one cut op counts, whichever the default method picks.
      if (k === 'cnc_cut_to_size' && cal.default_cut_method !== 'cnc') continue
      if (k === 'asy_saw_cut_to_size' && cal.default_cut_method !== 'saw') continue
      const dept = OP_DEPT[k]
      if (dept) out[dept] += Number(v) || 0
    }
    return out
  }, [cal])

  const totalHours = byDept.eng + byDept.cnc + byDept.assembly + byDept.finish
  const calBdft = cal
    ? (cal.calib_length_in * cal.calib_width_in * cal.calib_thickness_in) / 144
    : 0

  return (
    <div className="mb-5 border border-[#E5E7EB] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E7EB] bg-[#FAFAFA] flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold text-[#111]">Solid Wood Top labor</div>
          <div className="text-[11.5px] text-[#6B7280] mt-0.5">
            Hours for one typical top. Every line scales from it by board foot.
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loaded && (
            <span className={`text-[11px] font-mono ${cal ? 'text-[#059669]' : 'text-[#9CA3AF]'}`}>
              {cal ? 'Calibrated' : 'Not yet'}
            </span>
          )}
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8]"
          >
            {cal ? 'Recalibrate' : 'Calibrate'}
          </button>
        </div>
      </div>

      {!loaded ? (
        <div className="px-4 py-3 text-[12px] text-[#9CA3AF] italic">Loading calibration…</div>
      ) : !cal ? (
        <div className="px-4 py-3 text-[12px] text-[#6B7280]">
          Not calibrated yet — Solid Wood Top lines can't price their labor until this is set.
          It's one pass: the size of a typical top and how long each operation takes on it.
        </div>
      ) : (
        <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-3 text-[12px]">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Calibration piece
            </div>
            <div className="text-[#111] font-mono tabular-nums mt-0.5">
              {cal.calib_length_in}″ × {cal.calib_width_in}″ × {cal.calib_thickness_in}″ rough
            </div>
            <div className="text-[11px] text-[#9CA3AF] font-mono">
              {calBdft.toFixed(2)} BdFt
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Hours on that piece
            </div>
            <div className="text-[#111] mt-0.5 flex flex-wrap gap-x-3 font-mono tabular-nums">
              {(['eng', 'cnc', 'assembly', 'finish'] as const)
                .filter((d) => byDept[d] > 0)
                .map((d) => (
                  <span key={d}>
                    <span className="text-[#6B7280]">{DEPT_LABEL[d]}</span> {byDept[d].toFixed(2)}
                  </span>
                ))}
              {totalHours === 0 && <span className="text-[#9CA3AF]">none set</span>}
            </div>
            {totalHours > 0 && (
              <div className="text-[11px] text-[#9CA3AF] font-mono">
                {totalHours.toFixed(2)} hr total
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Defaults
            </div>
            <div className="text-[#111] mt-0.5">
              Cut: {cal.default_cut_method === 'cnc' ? 'CNC' : 'Saw'}
            </div>
            <div className="text-[11px] text-[#9CA3AF] font-mono">
              Edge ×{Number(cal.edge_mult_hand).toFixed(2)} hand · ×
              {Number(cal.edge_mult_cnc).toFixed(2)} CNC
            </div>
          </div>
          {cal.updated_at && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Updated
              </div>
              <div className="text-[#6B7280] mt-0.5">
                {new Date(cal.updated_at).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>
      )}

      {open && (
        <SolidWoodTopWalkthrough
          orgId={orgId}
          onCancel={() => setOpen(false)}
          onComplete={async () => {
            setOpen(false)
            await refresh()
          }}
        />
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
  const q = Number(draft.thickness_quarters)
  /** True when the value isn't one of the quick picks — drives both the
   *  highlight on the custom box and whether it shows a number at all. */
  const isCustomThickness =
    draft.thickness_quarters.trim() !== '' && !THICKNESS_PRESETS.includes(q)
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
            {/* Anything the presets don't cover — 10/4, 12/4 on a thick slab.
                Shows EMPTY while a preset is selected: mirroring the preset's
                value in here made it read as a stray "4" with no label, which
                is exactly how it got questioned. The "/4" suffix is what says
                "this is quarters". */}
            <div
              className={`flex items-center gap-0.5 pl-1.5 pr-1 rounded-md border shrink-0 transition-colors ${
                isCustomThickness
                  ? 'bg-[#2563EB] border-[#2563EB]'
                  : 'bg-white border-[#E5E7EB]'
              }`}
              title="Other thickness, in quarters — 10 for 10/4"
            >
              <input
                type="number"
                min={1}
                placeholder="10"
                aria-label="Other thickness in quarters"
                className={`w-[28px] py-1.5 text-[12px] bg-transparent outline-none ${
                  isCustomThickness
                    ? 'text-white placeholder:text-white/60'
                    : 'text-[#4B5563] placeholder:text-[#9CA3AF]'
                }`}
                value={isCustomThickness ? draft.thickness_quarters : ''}
                onChange={(e) => setDraft({ ...draft, thickness_quarters: e.target.value })}
              />
              <span
                className={`text-[12px] ${isCustomThickness ? 'text-white/70' : 'text-[#9CA3AF]'}`}
              >
                /4
              </span>
            </div>
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

'use client'

// ============================================================================
// DoorCatalog — door types → materials → finishes editor (rate-book chunk C).
// ============================================================================
// Doors are a 1:N:N model (migration 038):
//   door type  →  door materials  →  finishes
// Door LABOR + hardware live on the type; material PRICE lives in the master
// catalog (a door material points at a catalog row via material_id); a FINISH
// carries per-door labor + per-door material cost.
//
// Before this page, materials/finishes could only be added via the composer's
// "+ Add new" — there was no way to EDIT them from the rate book. This is that
// surface. Mounted in /rate-book behind the "Doors" view toggle.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  listDoorTypes,
  listDoorTypeMaterials,
  listDoorTypeMaterialFinishes,
  indexDoorTypeMaterials,
  indexDoorTypeMaterialFinishes,
  saveDoorTypeCalibration,
  archiveDoorType,
  createDoorTypeMaterial,
  updateDoorTypeMaterial,
  archiveDoorTypeMaterial,
  createDoorTypeMaterialFinish,
  updateDoorTypeMaterialFinish,
  archiveDoorTypeMaterialFinish,
  type DoorType,
  type DoorTypeMaterial,
  type DoorTypeMaterialFinish,
  type DoorMaterialCostUnit,
} from '@/lib/door-types'
import { listMaterials, indexMaterialsById } from '@/lib/materials'

const UNITS: DoorMaterialCostUnit[] = ['sheet', 'lf', 'bf', 'ea', 'lump']
const UNIT_ABBR: Record<DoorMaterialCostUnit, string> = {
  sheet: 'sht',
  lf: 'LF',
  bf: 'BF',
  ea: 'ea',
  lump: 'lump',
}

type Editing =
  | { kind: 'type'; id: string }
  | { kind: 'material'; id: string }
  | { kind: 'finish'; id: string }
  | null

type Adding =
  | { kind: 'type' }
  | { kind: 'material'; doorTypeId: string }
  | { kind: 'finish'; materialId: string }
  | null

export default function DoorCatalog({ orgId }: { orgId: string }) {
  const [doorTypes, setDoorTypes] = useState<DoorType[]>([])
  const [matsByType, setMatsByType] = useState<Map<string, DoorTypeMaterial[]>>(new Map())
  const [finsByMat, setFinsByMat] = useState<Map<string, DoorTypeMaterialFinish[]>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [adding, setAdding] = useState<Adding>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [types, mats, fins, catalog] = await Promise.all([
      listDoorTypes(orgId),
      listDoorTypeMaterials(orgId),
      listDoorTypeMaterialFinishes(orgId),
      listMaterials(orgId),
    ])
    // Overlay the catalog price so a price edited in the Materials tab shows
    // here too (door material cost lives in the catalog via material_id).
    const catById = indexMaterialsById(catalog)
    const priced = mats.map((m) => {
      const c = m.material_id ? catById.get(m.material_id) : undefined
      return c ? { ...m, cost_value: c.cost_value, cost_unit: c.cost_unit } : m
    })
    setDoorTypes(types)
    setMatsByType(indexDoorTypeMaterials(priced))
    setFinsByMat(indexDoorTypeMaterialFinishes(fins))
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  function reset() {
    setEditing(null)
    setAdding(null)
    setDraft({})
    setError(null)
  }

  const num = (k: string) => Number(draft[k]) || 0

  // ── Door type save (create or edit) ──
  async function saveType(existingId: string | null) {
    if (!draft.name?.trim()) return setError('Door type needs a name.')
    setSaving(true)
    setError(null)
    try {
      await saveDoorTypeCalibration({
        orgId,
        existingId,
        name: draft.name.trim(),
        perDoor: { eng: num('eng'), cnc: num('cnc'), assembly: num('assembly'), finish: num('finish') },
        hardwareCost: num('hardware'),
      })
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Door material save (create or edit) ──
  async function saveMaterial(existingId: string | null, doorTypeId?: string) {
    if (!draft.material_name?.trim()) return setError('Material needs a name.')
    setSaving(true)
    setError(null)
    try {
      if (existingId) {
        await updateDoorTypeMaterial(existingId, {
          material_name: draft.material_name.trim(),
          cost_value: num('cost_value'),
          cost_unit: (draft.cost_unit as DoorMaterialCostUnit) || 'sheet',
        })
      } else if (doorTypeId) {
        await createDoorTypeMaterial({
          org_id: orgId,
          door_type_id: doorTypeId,
          material_name: draft.material_name.trim(),
          cost_value: num('cost_value'),
          cost_unit: (draft.cost_unit as DoorMaterialCostUnit) || 'sheet',
        })
      }
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Finish save (create or edit) ──
  async function saveFinish(existingId: string | null, materialId?: string) {
    if (!draft.finish_name?.trim()) return setError('Finish needs a name.')
    setSaving(true)
    setError(null)
    try {
      if (existingId) {
        await updateDoorTypeMaterialFinish(existingId, {
          finish_name: draft.finish_name.trim(),
          labor_hours_per_door: num('labor'),
          material_per_door: num('material'),
        })
      } else if (materialId) {
        await createDoorTypeMaterialFinish({
          org_id: orgId,
          door_type_material_id: materialId,
          finish_name: draft.finish_name.trim(),
          labor_hours_per_door: num('labor'),
          material_per_door: num('material'),
        })
      }
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function doArchive(fn: () => Promise<void>) {
    setSaving(true)
    try {
      await fn()
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
          <h1 className="text-[16px] font-semibold text-[#111]">Door types</h1>
          <button
            onClick={() => {
              reset()
              setAdding({ kind: 'type' })
              setDraft({ name: '', eng: '', cnc: '', assembly: '', finish: '', hardware: '' })
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
          >
            <Plus className="w-3.5 h-3.5" /> New door type
          </button>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[600px]">
          Each door type carries its <strong>labor</strong> (hours per door) and hardware. Under it,
          the <strong>materials</strong> it can be built from (priced from the materials catalog) and,
          per material, the <strong>finishes</strong> (labor + material per door). Prices flow into
          the composer's door slots.
        </p>

        {error && (
          <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Add door type form */}
        {adding?.kind === 'type' && (
          <div className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
              New door type
            </div>
            <TypeFields draft={draft} setDraft={setDraft} />
            <SaveCancel saving={saving} onSave={() => saveType(null)} onCancel={reset} saveLabel="Add door type" />
          </div>
        )}

        {!loaded ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading door types…</div>
        ) : doorTypes.length === 0 && adding?.kind !== 'type' ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
            No door types yet. Add one, or calibrate a door style from the composer.
          </div>
        ) : (
          <div className="space-y-3">
            {doorTypes.map((dt) => {
              const mats = matsByType.get(dt.id) || []
              const totalHrs =
                dt.labor_hours_eng + dt.labor_hours_cnc + dt.labor_hours_assembly + dt.labor_hours_finish
              const isEditingType = editing?.kind === 'type' && editing.id === dt.id
              return (
                <div key={dt.id} className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                  {/* Door type header */}
                  <div className="px-4 py-3 bg-[#FAFAFA] border-b border-[#E5E7EB]">
                    {isEditingType ? (
                      <>
                        <TypeFields draft={draft} setDraft={setDraft} />
                        <SaveCancel
                          saving={saving}
                          onSave={() => saveType(dt.id)}
                          onCancel={reset}
                          extra={
                            <button
                              onClick={() =>
                                doArchive(() => archiveDoorType(dt.id))
                              }
                              className="px-2 py-1.5 rounded-md text-[12px] text-[#DC2626] hover:bg-[#FEF2F2]"
                            >
                              Delete door type
                            </button>
                          }
                        />
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-[#111] text-[14px]">
                            {dt.name}
                            {!dt.calibrated && (
                              <span className="ml-2 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                                Uncalibrated
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-[#6B7280] mt-0.5 font-mono">
                            {totalHrs.toFixed(2)} hr/door
                            {dt.hardware_cost > 0 && (
                              <span> · ${dt.hardware_cost.toFixed(2)} hardware/door</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            reset()
                            setEditing({ kind: 'type', id: dt.id })
                            setDraft({
                              name: dt.name,
                              eng: String(dt.labor_hours_eng),
                              cnc: String(dt.labor_hours_cnc),
                              assembly: String(dt.labor_hours_assembly),
                              finish: String(dt.labor_hours_finish),
                              hardware: String(dt.hardware_cost),
                            })
                          }}
                          className="px-2.5 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF] shrink-0"
                        >
                          Edit labor
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Materials */}
                  <div className="p-3 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#166534]">
                      Materials
                    </div>
                    {mats.length === 0 && adding?.kind !== 'material' && (
                      <div className="text-[11.5px] text-[#9CA3AF] italic">No materials yet.</div>
                    )}
                    {mats.map((m) => {
                      const fins = finsByMat.get(m.id) || []
                      const isEditingMat = editing?.kind === 'material' && editing.id === m.id
                      return (
                        <div key={m.id} className="border border-[#E5E7EB] rounded-md">
                          <div className="px-3 py-2 flex items-center justify-between gap-3 bg-white">
                            {isEditingMat ? (
                              <div className="flex-1">
                                <MaterialFields draft={draft} setDraft={setDraft} />
                                <SaveCancel
                                  saving={saving}
                                  onSave={() => saveMaterial(m.id)}
                                  onCancel={reset}
                                  extra={
                                    <button
                                      onClick={() => doArchive(() => archiveDoorTypeMaterial(m.id))}
                                      className="px-2 py-1.5 rounded-md text-[12px] text-[#DC2626] hover:bg-[#FEF2F2]"
                                    >
                                      Delete material
                                    </button>
                                  }
                                />
                              </div>
                            ) : (
                              <>
                                <div className="text-[13px]">
                                  <span className="font-medium text-[#111]">{m.material_name}</span>
                                  <span className="text-[#9CA3AF] ml-2 font-mono text-[12px]">
                                    ${Number(m.cost_value).toFixed(2)}/{UNIT_ABBR[m.cost_unit]}
                                  </span>
                                </div>
                                <button
                                  onClick={() => {
                                    reset()
                                    setEditing({ kind: 'material', id: m.id })
                                    setDraft({
                                      material_name: m.material_name,
                                      cost_value: String(m.cost_value),
                                      cost_unit: m.cost_unit,
                                    })
                                  }}
                                  className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF] shrink-0"
                                >
                                  Edit
                                </button>
                              </>
                            )}
                          </div>

                          {/* Finishes under this material */}
                          <div className="px-3 py-2 border-t border-[#F3F4F6] bg-[#FAFAFA] space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                              Finishes
                            </div>
                            {fins.length === 0 &&
                              !(adding?.kind === 'finish' && adding.materialId === m.id) && (
                                <div className="text-[11px] text-[#9CA3AF] italic">
                                  None — prefinished / no finish labor.
                                </div>
                              )}
                            {fins.map((f) => {
                              const isEditingFin = editing?.kind === 'finish' && editing.id === f.id
                              return isEditingFin ? (
                                <div key={f.id} className="bg-white border border-[#E5E7EB] rounded p-2">
                                  <FinishFields draft={draft} setDraft={setDraft} />
                                  <SaveCancel
                                    saving={saving}
                                    onSave={() => saveFinish(f.id)}
                                    onCancel={reset}
                                    extra={
                                      <button
                                        onClick={() =>
                                          doArchive(() => archiveDoorTypeMaterialFinish(f.id))
                                        }
                                        className="px-2 py-1.5 rounded-md text-[12px] text-[#DC2626] hover:bg-[#FEF2F2]"
                                      >
                                        Delete finish
                                      </button>
                                    }
                                  />
                                </div>
                              ) : (
                                <div
                                  key={f.id}
                                  className="flex items-center justify-between gap-3 text-[12px]"
                                >
                                  <span className="text-[#374151]">
                                    {f.finish_name}
                                    <span className="text-[#9CA3AF] ml-2 font-mono">
                                      {f.labor_hours_per_door.toFixed(2)} hr/door · $
                                      {f.material_per_door.toFixed(2)}/door
                                    </span>
                                  </span>
                                  <button
                                    onClick={() => {
                                      reset()
                                      setEditing({ kind: 'finish', id: f.id })
                                      setDraft({
                                        finish_name: f.finish_name,
                                        labor: String(f.labor_hours_per_door),
                                        material: String(f.material_per_door),
                                      })
                                    }}
                                    className="px-2 py-0.5 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF] shrink-0"
                                  >
                                    Edit
                                  </button>
                                </div>
                              )
                            })}
                            {adding?.kind === 'finish' && adding.materialId === m.id ? (
                              <div className="bg-white border border-[#BFDBFE] rounded p-2">
                                <FinishFields draft={draft} setDraft={setDraft} />
                                <SaveCancel
                                  saving={saving}
                                  onSave={() => saveFinish(null, m.id)}
                                  onCancel={reset}
                                  saveLabel="Add finish"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => {
                                  reset()
                                  setAdding({ kind: 'finish', materialId: m.id })
                                  setDraft({ finish_name: '', labor: '', material: '' })
                                }}
                                className="text-[11px] font-medium text-[#2563EB] hover:underline"
                              >
                                + Add finish
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Add material */}
                    {adding?.kind === 'material' && adding.doorTypeId === dt.id ? (
                      <div className="border border-[#BFDBFE] bg-[#EFF6FF] rounded-md p-2">
                        <MaterialFields draft={draft} setDraft={setDraft} />
                        <SaveCancel
                          saving={saving}
                          onSave={() => saveMaterial(null, dt.id)}
                          onCancel={reset}
                          saveLabel="Add material"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          reset()
                          setAdding({ kind: 'material', doorTypeId: dt.id })
                          setDraft({ material_name: '', cost_value: '', cost_unit: 'sheet' })
                        }}
                        className="text-[11.5px] font-medium text-[#2563EB] hover:underline"
                      >
                        + Add material
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Field groups ──

function TypeFields({
  draft,
  setDraft,
}: {
  draft: Record<string, string>
  setDraft: (d: Record<string, string>) => void
}) {
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v })
  return (
    <div className="space-y-2.5">
      <LabeledInput label="Name" value={draft.name || ''} onChange={(v) => set('name', v)} placeholder="e.g. Shaker" autoFocus />
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Labor hours per door
        </span>
        <div className="grid grid-cols-4 gap-2 mt-0.5">
          {(['eng', 'cnc', 'assembly', 'finish'] as const).map((k) => (
            <LabeledInput
              key={k}
              label={k === 'eng' ? 'Eng' : k === 'cnc' ? 'CNC' : k === 'assembly' ? 'Assembly' : 'Finish'}
              type="number"
              value={draft[k] || ''}
              onChange={(v) => set(k, v)}
              small
            />
          ))}
        </div>
      </div>
      <div className="w-40">
        <LabeledInput
          label="Hardware $ / door"
          type="number"
          value={draft.hardware || ''}
          onChange={(v) => set('hardware', v)}
        />
      </div>
    </div>
  )
}

function MaterialFields({
  draft,
  setDraft,
}: {
  draft: Record<string, string>
  setDraft: (d: Record<string, string>) => void
}) {
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v })
  return (
    <div className="grid grid-cols-[1fr_110px_110px] gap-2">
      <LabeledInput label="Material" value={draft.material_name || ''} onChange={(v) => set('material_name', v)} placeholder="e.g. Paint-grade MDF" autoFocus />
      <LabeledInput label="Cost" type="number" value={draft.cost_value || ''} onChange={(v) => set('cost_value', v)} />
      <label className="block">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Per</span>
        <select
          className="w-full mt-0.5 px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
          value={draft.cost_unit || 'sheet'}
          onChange={(e) => set('cost_unit', e.target.value)}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u === 'sheet' ? 'Sheet' : u === 'lf' ? 'LF' : u === 'bf' ? 'BF' : u === 'ea' ? 'Each' : 'Lump'}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function FinishFields({
  draft,
  setDraft,
}: {
  draft: Record<string, string>
  setDraft: (d: Record<string, string>) => void
}) {
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v })
  return (
    <div className="grid grid-cols-[1fr_120px_120px] gap-2">
      <LabeledInput label="Finish" value={draft.finish_name || ''} onChange={(v) => set('finish_name', v)} placeholder="e.g. Painted" autoFocus />
      <LabeledInput label="Hr / door" type="number" value={draft.labor || ''} onChange={(v) => set('labor', v)} />
      <LabeledInput label="$ / door" type="number" value={draft.material || ''} onChange={(v) => set('material', v)} />
    </div>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoFocus,
  small,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoFocus?: boolean
  small?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</span>
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={`w-full mt-0.5 px-2.5 py-1.5 ${small ? 'text-[12px]' : 'text-[13px]'} border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function SaveCancel({
  saving,
  onSave,
  onCancel,
  saveLabel = 'Save',
  extra,
}: {
  saving: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel?: string
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 mt-2.5">
      <button
        disabled={saving}
        onClick={onSave}
        className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
      >
        Cancel
      </button>
      <div className="flex-1" />
      {extra}
    </div>
  )
}

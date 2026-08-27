'use client'

// ============================================================================
// DoorCatalog — door types + their finishes (rate-book chunk C; 074 flatten).
// ============================================================================
// Post-074, door MATERIALS are just catalog materials flagged "Door" (managed
// in the Materials tab). A door type carries its LABOR + hardware and its
// FINISHES (per-door labor + material). This page edits door types + finishes.
// Mounted in /rate-book behind the "Doors" view toggle.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  listDoorTypes,
  listDoorTypeMaterialFinishes,
  indexDoorTypeMaterialFinishes,
  saveDoorTypeCalibration,
  archiveDoorType,
  createDoorTypeMaterialFinish,
  updateDoorTypeMaterialFinish,
  archiveDoorTypeMaterialFinish,
  type DoorType,
  type DoorTypeMaterialFinish,
} from '@/lib/door-types'
import { announce } from '@/lib/tour-events'

type Editing = { kind: 'type'; id: string } | { kind: 'finish'; id: string } | null
type Adding = { kind: 'type' } | { kind: 'finish'; doorTypeId: string } | null

// Door labor is CALIBRATED on an 8' run, like features and custom products —
// "how long to build 8 feet of this door" is a question a shop can answer
// from memory; per-door decimals aren't. Storage stays per door: 8' at 0.5
// doors/LF (lib/products doorsPerLf) is 4 doors, so the form divides by 4 on
// save and multiplies by 4 when hydrating an edit.
const DOOR_RUN_FEET = 8
const DOORS_PER_RUN = 4
const round3 = (n: number) => Math.round(n * 1000) / 1000

export default function DoorCatalog({ orgId }: { orgId: string }) {
  const [doorTypes, setDoorTypes] = useState<DoorType[]>([])
  const [finsByType, setFinsByType] = useState<Map<string, DoorTypeMaterialFinish[]>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [adding, setAdding] = useState<Adding>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [types, fins] = await Promise.all([
      listDoorTypes(orgId),
      listDoorTypeMaterialFinishes(orgId),
    ])
    setDoorTypes(types)
    setFinsByType(indexDoorTypeMaterialFinishes(fins))
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

  async function saveType(existingId: string | null) {
    if (!draft.name?.trim()) return setError('Door type needs a name.')
    setSaving(true)
    setError(null)
    try {
      await saveDoorTypeCalibration({
        orgId,
        existingId,
        name: draft.name.trim(),
        // Form speaks in hours per 8' run; storage is per door.
        perDoor: {
          eng: num('eng') / DOORS_PER_RUN,
          cnc: num('cnc') / DOORS_PER_RUN,
          assembly: num('assembly') / DOORS_PER_RUN,
          finish: num('finish') / DOORS_PER_RUN,
        },
        hardwareCost: num('hardware'),
      })
      await reload()
      // Creates only, after the reload — the walkthrough waits on the style
      // actually existing, not on the button press.
      if (!existingId) announce('ms:door-type-created')
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveFinish(existingId: string | null, doorTypeId?: string) {
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
      } else if (doorTypeId) {
        await createDoorTypeMaterialFinish({
          org_id: orgId,
          door_type_id: doorTypeId,
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
            data-tour="add-door-type"
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
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[620px]">
          Each door type is calibrated on an <strong>8&prime; run</strong>: enter the hours to
          build 8 feet of that door and MillSuite stores it per door. Hardware and{' '}
          <strong>finishes</strong> (labor + material per door) live here too. Door{' '}
          <strong>materials</strong> are in the <strong>Materials</strong> tab. Flag a material
          "Door" and it shows up in the composer's door-material dropdown.
        </p>

        {error && (
          <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {adding?.kind === 'type' && (
          /* data-tour: the lesson rings the whole form — name, the four hour
             fields, hardware AND the Add button — and advances on
             ms:door-type-created. Only the add form carries the hook; an open
             row editor renders the same fields and must not double-tag. */
          <div
            data-tour="door-form"
            className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-3"
          >
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
              const fins = finsByType.get(dt.id) || []
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
                              onClick={() => doArchive(() => archiveDoorType(dt.id))}
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
                            {totalHrs.toFixed(2)} hr/door · {(totalHrs * DOORS_PER_RUN).toFixed(1)} hr
                            per {DOOR_RUN_FEET}&prime; run
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
                              // Stored per door, edited per 8' run.
                              eng: String(round3(dt.labor_hours_eng * DOORS_PER_RUN)),
                              cnc: String(round3(dt.labor_hours_cnc * DOORS_PER_RUN)),
                              assembly: String(round3(dt.labor_hours_assembly * DOORS_PER_RUN)),
                              finish: String(round3(dt.labor_hours_finish * DOORS_PER_RUN)),
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

                  {/* Door finishes — priced PER DOOR, scoped to this door
                      type + material. Named explicitly because the rate book
                      also has an "Interior finishes" tab, which prices the
                      inside of the box per LF; the two used to share one
                      concept pre-038 and reliably got mixed up. */}
                  <div className="p-3 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[#166534]">
                      Door finishes <span className="normal-case tracking-normal font-normal text-[#9CA3AF]">· per door</span>
                    </div>
                    {fins.length === 0 && !(adding?.kind === 'finish' && adding.doorTypeId === dt.id) && (
                      <div className="text-[11.5px] text-[#9CA3AF] italic">
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
                                onClick={() => doArchive(() => archiveDoorTypeMaterialFinish(f.id))}
                                className="px-2 py-1.5 rounded-md text-[12px] text-[#DC2626] hover:bg-[#FEF2F2]"
                              >
                                Delete finish
                              </button>
                            }
                          />
                        </div>
                      ) : (
                        <div key={f.id} className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="text-[#374151]">
                            {f.finish_name}
                            <span className="text-[#9CA3AF] ml-2 font-mono">
                              {f.labor_hours_per_door.toFixed(2)} hr/door · ${f.material_per_door.toFixed(2)}/door
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
                    {adding?.kind === 'finish' && adding.doorTypeId === dt.id ? (
                      <div className="bg-white border border-[#BFDBFE] rounded p-2">
                        <FinishFields draft={draft} setDraft={setDraft} />
                        <SaveCancel
                          saving={saving}
                          onSave={() => saveFinish(null, dt.id)}
                          onCancel={reset}
                          saveLabel="Add finish"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          reset()
                          setAdding({ kind: 'finish', doorTypeId: dt.id })
                          setDraft({ finish_name: '', labor: '', material: '' })
                        }}
                        className="text-[11.5px] font-medium text-[#2563EB] hover:underline"
                      >
                        + Add finish
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
          Labor hours per {DOOR_RUN_FEET}&prime; run
          <span className="normal-case tracking-normal font-normal text-[#9CA3AF]">
            {' '}(about {DOORS_PER_RUN} doors)
          </span>
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

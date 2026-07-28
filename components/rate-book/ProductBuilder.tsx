'use client'

// ============================================================================
// ProductBuilder — define custom calibrated products (rate-book chunk E).
// ============================================================================
// A custom product = labor hours/unit by dept + material slots (each picks a
// catalog material at line time, consumed per unit) + optional LED/hardware.
// Once defined it shows up in the composer's "Add a line" picker and prices
// like the built-ins. Mounted in /rate-book behind the "Products" view toggle.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  listCustomProducts,
  createCustomProduct,
  updateCustomProduct,
  archiveCustomProduct,
  customLaborPerUnit,
  type CustomProduct,
  type CustomProductUnit,
  type MaterialSlotShowIn,
} from '@/lib/custom-products'

const UNITS: { value: CustomProductUnit; label: string }[] = [
  { value: 'lf', label: 'Linear ft' },
  { value: 'each', label: 'Each' },
  { value: 'sqft', label: 'Sq ft' },
]
const SHOW_IN: { value: MaterialSlotShowIn; label: string }[] = [
  { value: 'shelf', label: 'Shelf' },
  { value: 'carcass', label: 'Carcass' },
  { value: 'door', label: 'Door' },
  { value: 'back_panel', label: 'Back panel' },
  { value: 'any', label: 'Any (whole catalog)' },
]
const DEPTS = [
  { key: 'eng', label: 'Eng' },
  { key: 'cnc', label: 'CNC' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'finish', label: 'Finish' },
] as const

interface SlotDraft {
  key: string
  label: string
  show_in: MaterialSlotShowIn
  consumption_per_unit: string
}
interface Draft {
  name: string
  unit: CustomProductUnit
  eng: string
  cnc: string
  assembly: string
  finish: string
  hardware: string
  led_enabled: boolean
  slots: SlotDraft[]
}

const EMPTY: Draft = {
  name: '',
  unit: 'lf',
  eng: '',
  cnc: '',
  assembly: '',
  finish: '',
  hardware: '',
  led_enabled: false,
  slots: [],
}

// LF products calibrate on a typical 8' run (the drawer-wizard feel): the
// operator enters BOTH labor hours and material consumption for an 8' run and
// we store per-LF (÷8) — shops estimate "what does this take on an 8-footer",
// not per inch. Each/sqft enter per unit directly (basis 1).
const LF_RUN_FEET = 8
function laborBasisFor(unit: CustomProductUnit): number {
  return unit === 'lf' ? LF_RUN_FEET : 1
}
/** Human label for the calibration basis. */
function laborBasisLabel(unit: CustomProductUnit): string {
  return unit === 'lf' ? `8' run` : unit
}

function toDraft(p: CustomProduct): Draft {
  // Stored per-unit → shown per calibration basis (× basis).
  const b = laborBasisFor(p.unit)
  return {
    name: p.name,
    unit: p.unit,
    eng: String(p.labor_hours_eng_per_unit * b),
    cnc: String(p.labor_hours_cnc_per_unit * b),
    assembly: String(p.labor_hours_assembly_per_unit * b),
    finish: String(p.labor_hours_finish_per_unit * b),
    hardware: String(p.hardware_cost_per_unit),
    led_enabled: p.led_enabled,
    slots: p.material_slots.map((s) => ({
      key: s.key,
      label: s.label,
      show_in: s.show_in,
      // Material consumption uses the same basis as labor (per 8' run on LF).
      consumption_per_unit: String(Number((s.consumption_per_unit * b).toFixed(4))),
    })),
  }
}

function draftToInput(d: Draft) {
  // Labor entered per calibration basis → stored per-unit (÷ basis).
  const b = laborBasisFor(d.unit)
  return {
    name: d.name.trim(),
    unit: d.unit,
    labor_hours_eng_per_unit: (Number(d.eng) || 0) / b,
    labor_hours_cnc_per_unit: (Number(d.cnc) || 0) / b,
    labor_hours_assembly_per_unit: (Number(d.assembly) || 0) / b,
    labor_hours_finish_per_unit: (Number(d.finish) || 0) / b,
    hardware_cost_per_unit: Number(d.hardware) || 0,
    led_enabled: d.led_enabled,
    material_slots: d.slots.map((s) => ({
      key: s.key,
      label: s.label.trim() || s.key,
      show_in: s.show_in,
      // Entered per calibration basis → stored per-unit (÷ basis), same as labor.
      consumption_per_unit: (Number(s.consumption_per_unit) || 0) / b,
    })),
  }
}

export default function ProductBuilder({ orgId }: { orgId: string }) {
  const [products, setProducts] = useState<CustomProduct[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const slotCounter = useRef(1)

  const reload = useCallback(async () => {
    setProducts(await listCustomProducts(orgId))
    setLoaded(true)
  }, [orgId])

  useEffect(() => {
    reload()
  }, [reload])

  function reset() {
    setEditingId(null)
    setDraft(EMPTY)
    setConfirmDeleteId(null)
    setError(null)
  }

  function addSlot() {
    const key = `slot_${slotCounter.current++}`
    setDraft((d) => ({
      ...d,
      slots: [...d.slots, { key, label: '', show_in: 'shelf', consumption_per_unit: '' }],
    }))
  }

  async function save() {
    const input = draftToInput(draft)
    if (!input.name) return setError('Name is required.')
    setSaving(true)
    setError(null)
    try {
      if (editingId === 'new') {
        await createCustomProduct({ org_id: orgId, ...input })
      } else if (editingId) {
        await updateCustomProduct(editingId, input)
      }
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setSaving(true)
    try {
      await archiveCustomProduct(id)
      await reload()
      reset()
    } catch (e: any) {
      setError(e?.message || 'Remove failed')
    } finally {
      setSaving(false)
    }
  }

  const editorOpen = editingId !== null

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-[16px] font-semibold text-[#111]">Custom products</h1>
          {!editorOpen && (
            <button
              onClick={() => {
                setError(null)
                setDraft(EMPTY)
                setEditingId('new')
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8]"
            >
              <Plus className="w-3.5 h-3.5" /> New product
            </button>
          )}
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 max-w-[620px]">
          Build a product once — labor hours per unit, the materials it uses (picked from the
          catalog at line time, consumed per unit), and optional LED/hardware. It then shows up in
          the composer's "Add a line" picker and prices like the built-in cabinet runs. Example:
          floating shelf = finish labor/LF + a shelf material + LED per LF.
        </p>

        {error && (
          <div className="mb-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {editorOpen && (
          <div className="mb-4 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-4 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF]">
              {editingId === 'new' ? 'New product' : 'Edit product'}
            </div>

            <div className="grid grid-cols-[1fr_160px] gap-2">
              <Field label="Name">
                <input
                  autoFocus
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Floating shelf"
                />
              </Field>
              <Field label="Unit">
                <select
                  className={inputCls}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value as CustomProductUnit })}
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Labor hours per {laborBasisLabel(draft.unit)}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {DEPTS.map((d) => (
                  <Field key={d.key} label={d.label}>
                    <input
                      type="number"
                      step="0.01"
                      className={inputCls}
                      value={draft[d.key]}
                      onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
              {draft.unit === 'lf' && (
                <div className="text-[10.5px] text-[#9CA3AF] mt-1">
                  Enter labor for a typical 8&apos; run — priced per foot on the line (÷8).
                </div>
              )}
            </div>

            {/* Material slots */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                Material slots
              </div>
              <div className="space-y-2">
                {draft.slots.map((s, i) => (
                  <div key={s.key} className="flex items-end gap-2">
                    <Field label="Label" className="flex-1">
                      <input
                        className={inputCls}
                        value={s.label}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                          })
                        }
                        placeholder="e.g. Shelf material"
                      />
                    </Field>
                    <Field label="Catalog list" className="w-40">
                      <select
                        className={inputCls}
                        value={s.show_in}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map((x, j) =>
                              j === i ? { ...x, show_in: e.target.value as MaterialSlotShowIn } : x,
                            ),
                          })
                        }
                      >
                        {SHOW_IN.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Qty / ${laborBasisLabel(draft.unit)}`} className="w-24">
                      <input
                        type="number"
                        step="0.01"
                        className={inputCls}
                        value={s.consumption_per_unit}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            slots: draft.slots.map((x, j) =>
                              j === i ? { ...x, consumption_per_unit: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <button
                      onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })}
                      className="h-9 w-9 rounded-md border border-[#E5E7EB] text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
                      title="Remove slot"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button onClick={addSlot} className="text-[12px] font-medium text-[#2563EB] hover:underline">
                  + Add material slot
                </button>
                <div className="text-[10.5px] text-[#9CA3AF]">
                  "Qty / {laborBasisLabel(draft.unit)}" = how much of the material's cost-unit it
                  eats
                  {draft.unit === 'lf'
                    ? ` on a typical ${LF_RUN_FEET}' run (e.g. 1 sheet per 8' → stored as 0.125/LF)`
                    : ` per ${draft.unit} (e.g. 0.1 sheet)`}
                  . The operator picks the actual material on the line.
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="grid grid-cols-[160px_1fr] gap-2 items-end">
              <Field label={`Hardware $ / ${draft.unit}`}>
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  value={draft.hardware}
                  onChange={(e) => setDraft({ ...draft, hardware: e.target.value })}
                />
              </Field>
              <label className="inline-flex items-center gap-2 text-[12px] text-[#374151] pb-2">
                <input
                  type="checkbox"
                  checked={draft.led_enabled}
                  onChange={(e) => setDraft({ ...draft, led_enabled: e.target.checked })}
                />
                Show the LED section on this product's lines
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                disabled={saving}
                onClick={save}
                className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId === 'new' ? 'Create product' : 'Save'}
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
          <div className="text-[12px] text-[#9CA3AF] italic p-4">Loading products…</div>
        ) : products.length === 0 && !editorOpen ? (
          <div className="text-[12px] text-[#9CA3AF] italic p-4 border border-dashed border-[#E5E7EB] rounded-lg text-center">
            No custom products yet. Build one — e.g. a floating shelf.
          </div>
        ) : (
          <div className="space-y-2">
            {products.map((p) => {
              const hrs = customLaborPerUnit(p)
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 border border-[#E5E7EB] rounded-lg px-4 py-3"
                >
                  <div>
                    <div className="font-medium text-[#111] text-[13.5px]">
                      {p.name}
                      <span className="text-[#9CA3AF] font-normal"> · per {p.unit}</span>
                      {!p.calibrated && (
                        <span className="ml-2 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                          Uncalibrated
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-[#6B7280] mt-0.5 font-mono">
                      {hrs.toFixed(2)} hr/{p.unit} · {p.material_slots.length} material
                      {p.material_slots.length === 1 ? '' : 's'}
                      {p.led_enabled && ' · LED'}
                      {p.hardware_cost_per_unit > 0 && ` · $${p.hardware_cost_per_unit}/hw`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {confirmDeleteId === p.id ? (
                      <>
                        <button
                          disabled={saving}
                          onClick={() => remove(p.id)}
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
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setError(null)
                            setDraft(toDraft(p))
                            setEditingId(p.id)
                          }}
                          className="px-2 py-1 rounded text-[11px] font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(p.id)}
                          title="Remove product"
                          className="p-1 rounded text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
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

const inputCls =
  'w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]'

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

'use client'

// ============================================================================
// FinishBreakdown — the real finish rates, shown and editable (small-fixes
// wave, item 5).
// ============================================================================
// The Finishes tab used to display the item's `base_labor_hours_*` columns,
// which the composer ignores for finish pricing. The numbers that actually
// price a finish live in `rate_book_finish_breakdown` — one row per product
// category (base / upper / full) holding labor hr/LF and four material $/LF
// buckets. This panel shows those rows and edits them in place, writing
// through the same `saveFinishBreakdown` the calibration wizard uses.
//
// The wizard is still the calibration path (it thinks in an 8' run and
// divides by 8); this is the correction path, in the units actually stored.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  EMPTY_PER_LF,
  FINISH_MATERIAL_FIELDS,
  FINISH_PRODUCT_CATEGORIES,
  FINISH_PRODUCT_LABEL,
  finishMaterialPerLf,
  loadFinishBreakdown,
  saveFinishBreakdown,
  type FinishPerLf,
  type FinishProductCategory,
} from '@/lib/finish-breakdown'

const fmt$ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

type Rows = Record<FinishProductCategory, FinishPerLf>

function emptyRows(): Rows {
  return {
    base: { ...EMPTY_PER_LF },
    upper: { ...EMPTY_PER_LF },
    full: { ...EMPTY_PER_LF },
  }
}

export default function FinishBreakdown({
  itemId,
  shopRate,
}: {
  itemId: string
  shopRate: number
}) {
  const [rows, setRows] = useState<Rows>(emptyRows)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<FinishProductCategory | null>(null)
  const [draft, setDraft] = useState<FinishPerLf>(EMPTY_PER_LF)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoaded(false)
    const byProduct = await loadFinishBreakdown(itemId)
    const next = emptyRows()
    for (const pc of FINISH_PRODUCT_CATEGORIES) {
      if (byProduct[pc]) next[pc] = byProduct[pc] as FinishPerLf
    }
    setRows(next)
    setLoaded(true)
  }, [itemId])

  useEffect(() => {
    setEditing(null)
    reload()
  }, [reload])

  async function save(pc: FinishProductCategory) {
    setSaving(true)
    setError(null)
    try {
      await saveFinishBreakdown(itemId, pc, draft)
      await reload()
      setEditing(null)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const rate = Number(shopRate) || 0
  const costPerLf = (r: FinishPerLf) =>
    (Number(r.labor_hr_per_lf) || 0) * rate + finishMaterialPerLf(r)
  const anyCalibrated = FINISH_PRODUCT_CATEGORIES.some(
    (pc) => costPerLf(rows[pc]) > 0,
  )

  return (
    <div className="space-y-4">
      <section className="border border-[#E5E7EB] rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-[#E5E7EB] bg-[#EFF6FF] flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-[#1E40AF]">
            Rates by cabinet type
          </span>
          <span className="text-[10px] text-[#6B7280]">per linear foot</span>
        </div>

        {!loaded ? (
          <div className="px-4 py-3 text-[12px] text-[#9CA3AF] italic">Loading rates…</div>
        ) : (
          <div className="divide-y divide-[#F3F4F6]">
            {FINISH_PRODUCT_CATEGORIES.map((pc) => {
              const r = rows[pc]
              const material = finishMaterialPerLf(r)
              const total = costPerLf(r)
              const isEditing = editing === pc

              if (isEditing) {
                return (
                  <div key={pc} className="px-4 py-3 bg-[#EFF6FF]">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1E40AF] mb-2">
                      {FINISH_PRODUCT_LABEL[pc]}
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <NumField
                        label="Labor hr"
                        value={draft.labor_hr_per_lf}
                        onChange={(v) => setDraft({ ...draft, labor_hr_per_lf: v })}
                      />
                      {FINISH_MATERIAL_FIELDS.map((f) => (
                        <NumField
                          key={f.key}
                          label={`${f.label} $`}
                          value={draft[f.key]}
                          onChange={(v) => setDraft({ ...draft, [f.key]: v })}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        disabled={saving}
                        onClick={() => save(pc)}
                        className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={pc}
                  className="grid grid-cols-[90px_1fr_auto_auto] gap-3 px-4 py-2.5 items-center font-mono text-[12.5px]"
                >
                  <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">
                    {FINISH_PRODUCT_LABEL[pc]}
                  </span>
                  {total === 0 ? (
                    <span className="text-[#9CA3AF] italic text-[11.5px] font-sans">
                      Not calibrated for this cabinet type
                    </span>
                  ) : (
                    <span className="text-[#374151]">
                      {Number(r.labor_hr_per_lf).toFixed(3)} hr ×{' '}
                      <span className="text-[#2563EB]">${rate}</span>/hr
                      {material > 0 && (
                        <span className="text-[#9CA3AF]"> · {fmt$(material)} material</span>
                      )}
                    </span>
                  )}
                  <span className="text-[#111] font-semibold">{fmt$(total)}</span>
                  <button
                    onClick={() => {
                      setDraft({ ...r })
                      setEditing(pc)
                      setError(null)
                    }}
                    className="px-2 py-1 rounded text-[11px] font-medium font-sans text-[#2563EB] hover:bg-[#EFF6FF]"
                  >
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {error && (
        <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loaded && !anyCalibrated && (
        <div className="text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2 leading-snug">
          No rates yet for this finish. Run the finish walkthrough from the composer to
          calibrate it from a real 8' run, or type the per-foot numbers in directly above.
        </div>
      )}

      <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2 text-[11.5px] text-[#6B7280] leading-snug">
        These are the cabinet-run finish rates the composer prices from. Finishes applied
        to <strong>doors</strong> are priced separately, per door type and material — edit
        those on the <strong>Doors</strong> tab.
      </div>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
        {label}
      </div>
      <input
        type="number"
        step="0.001"
        className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

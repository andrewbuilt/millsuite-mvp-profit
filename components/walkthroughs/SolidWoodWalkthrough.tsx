'use client'

// ============================================================================
// SolidWoodWalkthrough — capture / edit a solid-wood rate-book row.
// ============================================================================
// Mirrors the modal-with-progress-dots shape used by DoorStyleWalkthrough.
// Five steps for new (Name → Species → Thickness → Cost → Waste %) or
// four for editing (skips the Name step). Final step persists to
// solid_wood_components and onComplete fires with the row id.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  createSolidWoodComponent,
  getSolidWoodComponent,
  updateSolidWoodComponent,
} from '@/lib/solid-wood'

const COMMON_QUARTERS = [3, 4, 5, 6, 8, 10, 12]

interface Props {
  orgId: string
  /** When set, opens in edit mode — Name step is skipped, all fields
   *  pre-filled from the existing row. */
  existingId?: string | null
  /** Prefill the Name input on new-component flow. */
  defaultName?: string
  onComplete: (componentId: string) => void
  onCancel: () => void
}

interface Draft {
  name: string
  species: string
  thicknessQuarters: number
  costPerBdft: string
  wastePct: string
  notes: string
}

function emptyDraft(defaultName: string): Draft {
  return {
    name: defaultName,
    species: '',
    thicknessQuarters: 4,
    costPerBdft: '',
    wastePct: '15',
    notes: '',
  }
}

export default function SolidWoodWalkthrough({
  orgId,
  existingId,
  defaultName = '',
  onComplete,
  onCancel,
}: Props) {
  const isEdit = !!existingId
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultName))
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [hydrating, setHydrating] = useState(isEdit)
  const [error, setError] = useState<string | null>(null)
  const [thicknessMode, setThicknessMode] = useState<'common' | 'custom'>('common')

  // The Name step lives at index 0 on new-component flow only. Edit flow
  // starts at the Species step (index 0 in its own sequence) and never
  // returns to the name input.
  const stepKeys = isEdit
    ? (['species', 'thickness', 'cost', 'waste'] as const)
    : (['name', 'species', 'thickness', 'cost', 'waste'] as const)
  const totalSteps = stepKeys.length
  const currentKey = stepKeys[stepIdx]

  // Hydrate when editing.
  useEffect(() => {
    if (!isEdit || !existingId) return
    let cancelled = false
    ;(async () => {
      const row = await getSolidWoodComponent(existingId)
      if (cancelled || !row) {
        if (!cancelled) setHydrating(false)
        return
      }
      setDraft({
        name: row.name,
        species: row.species,
        thicknessQuarters: row.thickness_quarters,
        costPerBdft: String(row.cost_per_bdft),
        wastePct: String(row.waste_pct),
        notes: row.notes ?? '',
      })
      setThicknessMode(
        COMMON_QUARTERS.includes(row.thickness_quarters) ? 'common' : 'custom',
      )
      setHydrating(false)
    })()
    return () => {
      cancelled = true
    }
  }, [isEdit, existingId])

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  // Step-level "is this answer good enough to advance?" checks. Save (the
  // last step) does its own full validation in save().
  function canAdvance(): boolean {
    switch (currentKey) {
      case 'name':
        return draft.name.trim().length > 0
      case 'species':
        return draft.species.trim().length > 0
      case 'thickness':
        return draft.thicknessQuarters > 0
      case 'cost':
        return parseFloat(draft.costPerBdft) >= 0 && draft.costPerBdft !== ''
      case 'waste':
        return parseFloat(draft.wastePct) >= 0 && parseFloat(draft.wastePct) < 100
    }
  }

  const isLast = stepIdx === stepKeys.length - 1

  async function save() {
    setError(null)
    const cost = parseFloat(draft.costPerBdft)
    const waste = parseFloat(draft.wastePct)
    if (!isEdit && !draft.name.trim()) {
      setError('Give the stock a name.')
      return
    }
    if (!draft.species.trim()) {
      setError('Pick a species.')
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Cost per board foot needs a non-negative number.')
      return
    }
    if (!Number.isFinite(waste) || waste < 0 || waste >= 100) {
      setError('Waste % needs to be 0–99.')
      return
    }
    setSaving(true)
    try {
      if (isEdit && existingId) {
        await updateSolidWoodComponent(existingId, {
          name: draft.name.trim(),
          species: draft.species.trim(),
          thickness_quarters: draft.thicknessQuarters,
          cost_per_bdft: cost,
          waste_pct: waste,
          notes: draft.notes.trim() || null,
        })
        onComplete(existingId)
      } else {
        const created = await createSolidWoodComponent({
          orgId,
          name: draft.name.trim(),
          species: draft.species.trim(),
          thickness_quarters: draft.thicknessQuarters,
          cost_per_bdft: cost,
          waste_pct: waste,
          notes: draft.notes.trim() || null,
        })
        onComplete(created.id)
      }
    } catch (err: any) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Step header copy
  const stepHeader = useMemo(() => {
    switch (currentKey) {
      case 'name':
        return {
          eyebrow: `Step ${stepIdx + 1} of ${totalSteps} · Name`,
          title: 'What do you call this stock?',
          body: "Operators will see this in pickers — make it specific.",
        }
      case 'species':
        return {
          eyebrow: `Step ${stepIdx + 1} of ${totalSteps} · Species`,
          title: 'What species is it?',
          body: 'Free text — Walnut, White oak, Maple, anything.',
        }
      case 'thickness':
        return {
          eyebrow: `Step ${stepIdx + 1} of ${totalSteps} · Thickness`,
          title: 'How thick?',
          body: 'Quarters — 4/4 = 1 inch, 8/4 = 2 inches. Pick a common value or enter a custom one.',
        }
      case 'cost':
        return {
          eyebrow: `Step ${stepIdx + 1} of ${totalSteps} · Cost`,
          title: '$ per board foot?',
          body: "What you pay your supplier.",
        }
      case 'waste':
        return {
          eyebrow: `Step ${stepIdx + 1} of ${totalSteps} · Waste %`,
          title: 'Typical waste?',
          body: 'Hardwood typically runs 12–20% depending on grade — adjust to what your shop sees.',
        }
    }
  }, [currentKey, stepIdx, totalSteps])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-[2px] flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex items-center justify-center p-4 md:p-8">
        <div className="max-w-[620px] w-full bg-white border border-[#E5E7EB] rounded-2xl text-[#111] shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
            <div className="text-[13px] font-semibold text-[#111]">
              {isEdit ? `${draft.name || 'Solid wood'} · edit` : 'New solid wood'}
            </div>
            <button
              onClick={onCancel}
              className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 px-5 pt-4">
            {Array.from({ length: totalSteps }).map((_, i) => {
              const cls =
                i < stepIdx
                  ? 'bg-[#93C5FD]'
                  : i === stepIdx
                    ? 'bg-[#2563EB]'
                    : 'bg-[#E5E7EB]'
              return <div key={i} className={`h-1 flex-1 rounded-full ${cls}`} />
            })}
          </div>

          <div className="p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-1">
              {stepHeader.eyebrow}
            </div>
            <h2 className="text-[20px] font-semibold text-[#111] mb-2">
              {stepHeader.title}
            </h2>
            <p className="text-sm text-[#6B7280] leading-relaxed mb-5">
              {stepHeader.body}
            </p>

            {hydrating ? (
              <div className="text-sm text-[#9CA3AF] italic py-6">
                Loading current values…
              </div>
            ) : (
              <>
                {currentKey === 'name' && (
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => patch('name', e.target.value)}
                    placeholder="e.g. 8/4 Walnut, 4/4 Rift White Oak"
                    autoFocus
                    className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-2.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
                  />
                )}
                {currentKey === 'species' && (
                  <input
                    type="text"
                    value={draft.species}
                    onChange={(e) => patch('species', e.target.value)}
                    placeholder="Walnut"
                    autoFocus
                    className="w-full bg-white border border-[#E5E7EB] rounded-md px-3 py-2.5 text-sm text-[#111] outline-none focus:border-[#2563EB]"
                  />
                )}
                {currentKey === 'thickness' && (
                  <div className="space-y-3">
                    {thicknessMode === 'common' ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={draft.thicknessQuarters}
                          onChange={(e) =>
                            patch('thicknessQuarters', parseInt(e.target.value, 10))
                          }
                          className="px-3 py-2.5 text-sm border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                        >
                          {COMMON_QUARTERS.map((q) => (
                            <option key={q} value={q}>
                              {q}/4 ({(q / 4).toFixed(2).replace(/\.?0+$/, '')} in)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setThicknessMode('custom')}
                          className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8]"
                        >
                          Custom
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={draft.thicknessQuarters}
                          onChange={(e) =>
                            patch('thicknessQuarters', Math.max(1, parseInt(e.target.value, 10) || 1))
                          }
                          className="w-24 px-3 py-2.5 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                        />
                        <span className="text-sm text-[#6B7280]">/ 4</span>
                        <button
                          type="button"
                          onClick={() => setThicknessMode('common')}
                          className="text-[12px] text-[#6B7280] hover:text-[#111] ml-2"
                        >
                          Use common values
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {currentKey === 'cost' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6B7280]">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.costPerBdft}
                      onChange={(e) => patch('costPerBdft', e.target.value)}
                      placeholder="0.00"
                      autoFocus
                      className="w-32 px-3 py-2.5 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                    />
                    <span className="text-sm text-[#9CA3AF]">/ board foot</span>
                  </div>
                )}
                {currentKey === 'waste' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      step={1}
                      value={draft.wastePct}
                      onChange={(e) => patch('wastePct', e.target.value)}
                      autoFocus
                      className="w-24 px-3 py-2.5 text-sm font-mono tabular-nums border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                    />
                    <span className="text-sm text-[#9CA3AF]">%</span>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="mt-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
                {error}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <div>
                {stepIdx > 0 && (
                  <button
                    type="button"
                    onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                    disabled={saving}
                    className="text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
                  >
                    ← Back
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] disabled:opacity-50"
                >
                  Cancel
                </button>
                {isLast ? (
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !canAdvance()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save to rate book'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setStepIdx((i) => Math.min(totalSteps - 1, i + 1))}
                    disabled={!canAdvance() || saving}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                  >
                    Next →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

// Pre-Production workspace — the "get to scheduling" checklist.
// Lists every selection on the project grouped by category, lets the shop
// walk each one from unconfirmed → pending_review → confirmed, and shows the
// client sign-off state that the portal writes to. Gated on `pre-production`.

import { useState, useEffect, use as usePromise } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Pencil,
} from 'lucide-react'
import type { Selection, SelectionStatus } from '@/lib/types'
import {
  SELECTION_CATEGORIES,
  STATUS_LABELS,
  STATUS_COLORS,
  getSelections,
  createSelection,
  updateSelection,
  setSelectionStatus,
  deleteSelection,
  selectionSummary,
} from '@/lib/selections'

interface ProjectSummary {
  id: string
  name: string
  client_name: string | null
  status: string
  production_phase: string | null
  selections_confirmed: boolean | null
  ready_for_production: boolean | null
}

export default function PreProductionPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  const resolved = usePromise(Promise.resolve(params))
  const projectId = resolved.id

  return (
    <PlanGate requires="pre-production">
      <PreProductionInner projectId={projectId} />
    </PlanGate>
  )
}

function PreProductionInner({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [selections, setSelections] = useState<Selection[]>([])
  const [loading, setLoading] = useState(true)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSpec, setEditSpec] = useState('')

  useEffect(() => {
    load()
  }, [projectId])

  async function load() {
    setLoading(true)
    const [projRes, sels] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, client_name, status, production_phase, selections_confirmed, ready_for_production')
        .eq('id', projectId)
        .single(),
      getSelections(projectId).catch(() => [] as Selection[]),
    ])
    setProject((projRes.data as ProjectSummary) || null)
    setSelections(sels)
    setLoading(false)
  }

  async function handleAdd(category: string) {
    if (!newLabel.trim()) return
    try {
      const created = await createSelection({
        project_id: projectId,
        category,
        label: newLabel.trim(),
        spec_value: newSpec.trim() || null,
        display_order: selections.filter(s => s.category === category).length,
      })
      setSelections(prev => [...prev, created])
      setNewLabel('')
      setNewSpec('')
      setAddingFor(null)
    } catch (err: any) {
      alert(err?.message || 'Failed to add selection')
    }
  }

  async function handleStatusChange(id: string, status: SelectionStatus) {
    try {
      const updated = await setSelectionStatus(id, status, { actor: 'shop' })
      setSelections(prev => prev.map(s => (s.id === id ? updated : s)))
    } catch (err: any) {
      alert(err?.message || 'Failed to update status')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this selection?')) return
    try {
      await deleteSelection(id)
      setSelections(prev => prev.filter(s => s.id !== id))
    } catch (err: any) {
      alert(err?.message || 'Failed to delete')
    }
  }

  function startEdit(sel: Selection) {
    setEditingId(sel.id)
    setEditLabel(sel.label)
    setEditSpec(sel.spec_value || '')
  }

  async function saveEdit() {
    if (!editingId) return
    try {
      const updated = await updateSelection(editingId, {
        label: editLabel.trim(),
        spec_value: editSpec.trim() || null,
      })
      setSelections(prev => prev.map(s => (s.id === editingId ? updated : s)))
      setEditingId(null)
    } catch (err: any) {
      alert(err?.message || 'Failed to save')
    }
  }

  async function markAllConfirmedReady() {
    const summary = selectionSummary(selections)
    const allConfirmed = summary.active > 0 && summary.confirmed === summary.active
    const patch: Record<string, any> = {
      selections_confirmed: allConfirmed,
      selections_confirmed_date: allConfirmed ? new Date().toISOString() : null,
    }
    await supabase.from('projects').update(patch).eq('id', projectId)
    setProject(prev => (prev ? { ...prev, selections_confirmed: allConfirmed } : prev))

    // Ask the phase engine to check whether we should advance to scheduling.
    // Idempotent — if conditions aren't met it's a no-op.
    if (allConfirmed) {
      try {
        const res = await fetch(`/api/projects/${projectId}/advance-phase`, { method: 'POST' })
        if (res.ok) {
          const json = await res.json()
          if (json.production_phase && json.production_phase !== project?.production_phase) {
            setProject(prev => (prev ? { ...prev, production_phase: json.production_phase } : prev))
          }
        }
      } catch {
        // Swallow — selections are already saved; advance can be retried.
      }
    }
  }

  // Recompute selections_confirmed whenever selection statuses change
  useEffect(() => {
    if (loading) return
    markAllConfirmedReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections.map(s => s.status).join('|')])

  const summary = selectionSummary(selections)

  return (
    <>
      <Nav />
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111] mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to project
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#111]">
              Pre-Production
            </h1>
            {project && (
              <p className="text-sm text-[#6B7280] mt-1">
                {project.name}
                {project.client_name && <span className="text-[#9CA3AF]"> · {project.client_name}</span>}
              </p>
            )}
          </div>
          <ReadinessBadge
            total={summary.active}
            confirmed={summary.confirmed}
            pct={summary.pctConfirmed}
          />
        </div>

        {/* Summary bar */}
        {!loading && summary.total > 0 && (
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 mb-6">
            <div className="flex items-center gap-6 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[#9CA3AF]">
                  Confirmed
                </div>
                <div className="text-lg font-mono tabular-nums text-[#059669]">
                  {summary.confirmed}/{summary.active}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[#9CA3AF]">
                  Pending Review
                </div>
                <div className="text-lg font-mono tabular-nums text-[#2563EB]">
                  {summary.pending}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[#9CA3AF]">
                  Unconfirmed
                </div>
                <div className="text-lg font-mono tabular-nums text-[#D97706]">
                  {summary.unconfirmed}
                </div>
              </div>
              <div className="flex-1">
                <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden mt-3">
                  <div
                    className="h-full bg-[#059669] transition-all"
                    style={{ width: `${summary.pctConfirmed}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-16 text-[#9CA3AF] text-sm">Loading selections...</div>
        )}

        {/* Category sections */}
        {!loading && SELECTION_CATEGORIES.map(cat => {
          const items = selections.filter(s => s.category === cat.value)
          const isAdding = addingFor === cat.value

          return (
            <div key={cat.value} className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-[#111] uppercase tracking-wider">
                  {cat.label}
                  <span className="ml-2 text-xs font-mono text-[#9CA3AF] normal-case tracking-normal">
                    {items.length}
                  </span>
                </h2>
                {!isAdding && (
                  <button
                    onClick={() => {
                      setAddingFor(cat.value)
                      setNewLabel('')
                      setNewSpec('')
                    }}
                    className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                )}
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                {items.length === 0 && !isAdding && (
                  <div className="text-center py-6 text-xs text-[#9CA3AF]">
                    No {cat.label.toLowerCase()} selections yet.
                  </div>
                )}

                {items.map((sel, idx) => (
                  <div
                    key={sel.id}
                    className={`flex items-center gap-3 px-4 py-3 ${
                      idx !== items.length - 1 ? 'border-b border-[#F3F4F6]' : ''
                    }`}
                  >
                    <StatusDot status={sel.status} />

                    <div className="flex-1 min-w-0">
                      {editingId === sel.id ? (
                        <div className="flex gap-2">
                          <input
                            value={editLabel}
                            onChange={e => setEditLabel(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEdit()}
                            placeholder="Label"
                            className="flex-1 px-2 py-1 text-sm border border-[#E5E7EB] rounded"
                            autoFocus
                          />
                          <input
                            value={editSpec}
                            onChange={e => setEditSpec(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveEdit()}
                            placeholder="Spec value (e.g. White Oak, rift sawn)"
                            className="flex-1 px-2 py-1 text-sm border border-[#E5E7EB] rounded"
                          />
                          <button
                            onClick={saveEdit}
                            className="text-xs text-[#2563EB] font-medium px-2"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs text-[#6B7280] px-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-[#111] truncate">
                            {sel.label}
                          </div>
                          {sel.spec_value && (
                            <div className="text-xs text-[#6B7280] truncate mt-0.5">
                              {sel.spec_value}
                            </div>
                          )}
                          {sel.client_signed_off_at && (
                            <div className="text-[10px] text-[#059669] font-medium mt-0.5">
                              Client signed off · {new Date(sel.client_signed_off_at).toLocaleDateString()}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {editingId !== sel.id && (
                      <>
                        <StatusPicker
                          current={sel.status}
                          onChange={status => handleStatusChange(sel.id, status)}
                        />
                        <button
                          onClick={() => startEdit(sel)}
                          className="p-1.5 text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] rounded transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(sel.id)}
                          className="p-1.5 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}

                {isAdding && (
                  <div className="flex items-center gap-2 px-4 py-3 bg-[#F9FAFB] border-t border-[#F3F4F6]">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#D97706] flex-shrink-0" />
                    <input
                      value={newLabel}
                      onChange={e => setNewLabel(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAdd(cat.value)
                        if (e.key === 'Escape') setAddingFor(null)
                      }}
                      placeholder="e.g. Wall cabinets"
                      autoFocus
                      className="flex-1 px-2 py-1 text-sm border border-[#E5E7EB] rounded outline-none focus:border-[#2563EB]"
                    />
                    <input
                      value={newSpec}
                      onChange={e => setNewSpec(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAdd(cat.value)
                        if (e.key === 'Escape') setAddingFor(null)
                      }}
                      placeholder="Spec (optional)"
                      className="flex-1 px-2 py-1 text-sm border border-[#E5E7EB] rounded outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={() => handleAdd(cat.value)}
                      disabled={!newLabel.trim()}
                      className="px-3 py-1 bg-[#2563EB] text-white text-xs font-medium rounded disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setAddingFor(null)}
                      className="px-2 py-1 text-xs text-[#6B7280]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Sub-components ──

function StatusDot({ status }: { status: SelectionStatus }) {
  const c = STATUS_COLORS[status]
  if (status === 'confirmed') {
    return <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: c.dot }} />
  }
  if (status === 'pending_review') {
    return <Clock className="w-4 h-4 flex-shrink-0" style={{ color: c.dot }} />
  }
  if (status === 'voided') {
    return <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: c.dot }} />
  }
  return <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: c.dot }} />
}

function StatusPicker({
  current,
  onChange,
}: {
  current: SelectionStatus
  onChange: (status: SelectionStatus) => void
}) {
  const c = STATUS_COLORS[current]
  return (
    <select
      value={current}
      onChange={e => onChange(e.target.value as SelectionStatus)}
      className="text-xs font-medium px-2 py-1 rounded border-0 cursor-pointer outline-none"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <option value="unconfirmed">Unconfirmed</option>
      <option value="pending_review">Pending Review</option>
      <option value="confirmed">Confirmed</option>
      <option value="voided">Voided</option>
    </select>
  )
}

function ReadinessBadge({
  total,
  confirmed,
  pct,
}: {
  total: number
  confirmed: number
  pct: number
}) {
  if (total === 0) {
    return (
      <span className="text-xs text-[#9CA3AF] font-medium px-3 py-1.5 bg-[#F3F4F6] rounded-full">
        No selections yet
      </span>
    )
  }
  if (confirmed === total) {
    return (
      <span className="text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
        <CheckCircle2 className="w-3.5 h-3.5" />
        Ready for scheduling
      </span>
    )
  }
  return (
    <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
      {pct}% confirmed
    </span>
  )
}

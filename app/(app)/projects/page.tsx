'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { SubprojectStatus, loadSubprojectStatusMap } from '@/lib/subproject-status'
import { CheckCircle2, AlertCircle } from 'lucide-react'

// ── Types ──

type ProjectStatus = 'bidding' | 'active' | 'complete' | 'archived'
type ProductionPhase = 'pre_production' | 'scheduling' | 'in_production' | null

interface Project {
  id: string
  org_id: string | null
  name: string
  client_name: string | null
  status: ProjectStatus
  production_phase: ProductionPhase
  bid_total: number
  actual_total: number
  sold_at: string | null
  completed_at: string | null
}

interface Subproject {
  id: string
  project_id: string
  name: string
  labor_hours: number
}

interface TimeEntry {
  id: string
  subproject_id: string | null
  project_id: string
  duration_minutes: number
}

// Columns are keyed by a composite id. Starter uses status only.
// Pro splits 'active' into three phase sub-columns.
type ColumnKey =
  | 'bidding'
  | 'active'
  | 'active:pre_production'
  | 'active:scheduling'
  | 'active:in_production'
  | 'complete'
  | 'archived'

interface ColumnDef {
  key: ColumnKey
  label: string
  status: ProjectStatus
  phase: ProductionPhase | undefined // undefined = phase-agnostic (Starter), null = explicitly null
}

const STARTER_COLUMNS: ColumnDef[] = [
  { key: 'bidding', label: 'Bidding', status: 'bidding', phase: undefined },
  { key: 'active', label: 'Active', status: 'active', phase: undefined },
  { key: 'complete', label: 'Complete', status: 'complete', phase: undefined },
  { key: 'archived', label: 'Archived', status: 'archived', phase: undefined },
]

const PRO_COLUMNS: ColumnDef[] = [
  { key: 'bidding', label: 'Bidding', status: 'bidding', phase: undefined },
  { key: 'active:pre_production', label: 'Pre-Production', status: 'active', phase: 'pre_production' },
  { key: 'active:scheduling', label: 'Scheduling', status: 'active', phase: 'scheduling' },
  { key: 'active:in_production', label: 'In Production', status: 'active', phase: 'in_production' },
  { key: 'complete', label: 'Complete', status: 'complete', phase: undefined },
  { key: 'archived', label: 'Archived', status: 'archived', phase: undefined },
]

// ── Helpers ──

function fmtMoney(n: number) {
  return n < 0
    ? `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function profitPct(project: Project): number | null {
  if (project.status === 'bidding') return null
  if (!project.bid_total || project.bid_total === 0) return null
  return ((project.bid_total - (project.actual_total || 0)) / project.bid_total) * 100
}

// Aggregate the scheduling gate across all subprojects on a project.
interface ProjectGate {
  totalSubs: number
  readySubs: number
  ready: boolean // true when every sub is ready
}

function aggregateProjectGate(
  subs: Subproject[],
  statusMap: Record<string, SubprojectStatus>
): ProjectGate {
  let ready = 0
  for (const s of subs) {
    if (statusMap[s.id]?.ready_for_scheduling) ready += 1
  }
  return { totalSubs: subs.length, readySubs: ready, ready: subs.length > 0 && ready === subs.length }
}

// ── Main Page ──

export default function ProjectsPage() {
  const router = useRouter()
  const { org } = useAuth()
  const plan = org?.plan || 'starter'
  const hasPreProd = hasAccess(plan, 'pre-production')
  const COLUMNS: ColumnDef[] = hasPreProd ? PRO_COLUMNS : STARTER_COLUMNS

  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [subStatusMap, setSubStatusMap] = useState<Record<string, SubprojectStatus>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState('')
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<ColumnKey | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // ── Load Projects ──

  useEffect(() => {
    loadProjects()
  }, [org?.id])

  async function loadProjects() {
    setLoading(true)
    if (!org?.id) return
    const [projectsRes, subprojectsRes, timeEntriesRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id, org_id, name, client_name, status, production_phase, bid_total, actual_total, sold_at, completed_at')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('subprojects')
        .select('id, project_id, name, labor_hours')
        .eq('org_id', org.id),
      supabase
        .from('time_entries')
        .select('id, subproject_id, project_id, duration_minutes')
        .eq('org_id', org.id),
    ])
    setProjects(projectsRes.data || [])
    setSubprojects(subprojectsRes.data || [])
    setTimeEntries(timeEntriesRes.data || [])

    // Load scheduling-gate status for all subprojects (Pro tier only).
    if (hasPreProd && (subprojectsRes.data || []).length > 0) {
      const ids = (subprojectsRes.data || []).map((s: Subproject) => s.id)
      const statusMap = await loadSubprojectStatusMap(ids)
      setSubStatusMap(statusMap)
    }

    setLoading(false)
  }

  // ── Create Project ──

  async function createProject() {
    if (!newName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({
        org_id: org?.id,
        name: newName.trim(),
        client_name: newClient.trim() || null,
        status: 'bidding',
        production_phase: null,
        bid_total: 0,
        actual_total: 0,
      })
      .select()
      .single()
    if (error) {
      console.error('Create project error:', error)
      alert(error.message)
    } else if (data) {
      setProjects(prev => [data, ...prev])
    }
    setNewName('')
    setNewClient('')
    setShowForm(false)
    setCreating(false)
  }

  // ── Drag & Drop ──

  function handleDragStart(e: React.DragEvent, projectId: string) {
    setDragId(projectId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', projectId)
  }

  function handleDragOver(e: React.DragEvent, key: ColumnKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(key)
  }

  function handleDragLeave() {
    setDragOver(null)
  }

  async function handleDrop(e: React.DragEvent, targetCol: ColumnDef) {
    e.preventDefault()
    setDragOver(null)
    const projectId = e.dataTransfer.getData('text/plain')
    if (!projectId) return

    const project = projects.find(p => p.id === projectId)
    if (!project) {
      setDragId(null)
      return
    }

    const targetStatus = targetCol.status
    // Resolve target phase: Pro columns carry explicit phase; Starter columns use undefined.
    // - Dropping onto Starter 'active' keeps whatever phase project already had (or null).
    // - Dropping onto Pro 'active:*' sets explicit phase.
    // - Dropping onto non-active columns always clears phase to null.
    let targetPhase: ProductionPhase
    if (targetStatus !== 'active') {
      targetPhase = null
    } else if (targetCol.phase !== undefined) {
      targetPhase = targetCol.phase
    } else {
      // Starter 'active' column — preserve existing phase, or default to null
      targetPhase = project.production_phase ?? null
    }

    // No-op if status + phase are already aligned
    if (project.status === targetStatus && project.production_phase === targetPhase) {
      setDragId(null)
      return
    }

    // Phase 3 gate: block advancing to Scheduling or In Production if any
    // subproject isn't ready_for_scheduling. Pro tier only. Non-blocking
    // confirm — user can override, but has to acknowledge.
    if (
      hasPreProd &&
      targetStatus === 'active' &&
      (targetPhase === 'scheduling' || targetPhase === 'in_production') &&
      !(project.status === 'active' && project.production_phase === 'in_production') // don't re-gate on in_production → in_production (no-op above) or scheduling → in_production
    ) {
      const projSubs = subprojects.filter((s) => s.project_id === projectId)
      const gate = aggregateProjectGate(projSubs, subStatusMap)
      if (!gate.ready) {
        const ok = window.confirm(
          `${project.name} isn't ready for scheduling yet — ${gate.readySubs} of ${gate.totalSubs} subprojects have all approvals + drawings signed off.\n\nMove anyway?`
        )
        if (!ok) {
          setDragId(null)
          return
        }
      }
    }

    // Build the update payload
    const updates: Partial<Project> & { status: string } = {
      status: targetStatus,
      production_phase: targetPhase,
    }

    // Set sold_at when moving to active (from bidding)
    if (targetStatus === 'active' && project.status === 'bidding') {
      updates.sold_at = new Date().toISOString()
    }

    // Set completed_at when moving to complete
    if (targetStatus === 'complete') {
      updates.completed_at = new Date().toISOString()
    }

    // If moving back from complete, clear completed_at
    if (targetStatus !== 'complete' && project.status === 'complete') {
      updates.completed_at = null
    }

    // If moving back from active to bidding, clear sold_at
    if (targetStatus === 'bidding' && project.status !== 'bidding') {
      updates.sold_at = null
      updates.completed_at = null
    }

    // Optimistic update
    setProjects(prev =>
      prev.map(p => (p.id === projectId ? { ...p, ...updates } as Project : p))
    )
    setDragId(null)

    // Persist to Supabase
    await supabase.from('projects').update(updates).eq('id', projectId)
  }

  function handleDragEnd() {
    setDragId(null)
    setDragOver(null)
  }

  // ── Grouped projects ──

  function projectsForColumn(col: ColumnDef): Project[] {
    return projects.filter(p => {
      if (p.status !== col.status) return false
      if (col.phase === undefined) return true
      // Pro active sub-columns: treat null phase as pre_production (legacy pre-conversion projects)
      const effective: ProductionPhase = p.production_phase ?? 'pre_production'
      return effective === col.phase
    })
  }

  const isEmpty = !loading && projects.length === 0 && !showForm

  // ── Render ──

  return (
    <>
      <Nav />
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <button
            onClick={() => {
              setShowForm(true)
              setTimeout(() => nameInputRef.current?.focus(), 0)
            }}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors"
          >
            + New Project
          </button>
        </div>

        {/* Inline Create Form */}
        {showForm && (
          <div className="bg-white border border-[#2563EB] rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Project Name
                </label>
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createProject()
                    if (e.key === 'Escape') {
                      setShowForm(false)
                      setNewName('')
                      setNewClient('')
                    }
                  }}
                  placeholder="e.g. Kitchen Cabinets"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Client Name
                </label>
                <input
                  value={newClient}
                  onChange={e => setNewClient(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createProject()
                    if (e.key === 'Escape') {
                      setShowForm(false)
                      setNewName('')
                      setNewClient('')
                    }
                  }}
                  placeholder="e.g. Smith Residence"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <button
                onClick={createProject}
                disabled={creating || !newName.trim()}
                className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false)
                  setNewName('')
                  setNewClient('')
                }}
                className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {isEmpty && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#F3F4F6] mb-4">
              <svg className="w-7 h-7 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <p className="text-[#6B7280] text-sm">Create your first project to start tracking profit</p>
            <button
              onClick={() => {
                setShowForm(true)
                setTimeout(() => nameInputRef.current?.focus(), 0)
              }}
              className="mt-4 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors"
            >
              + New Project
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-[#9CA3AF] text-sm">Loading projects...</div>
        )}

        {/* Kanban Board */}
        {!loading && projects.length > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))` }}
          >
            {COLUMNS.map(col => {
              const colProjects = projectsForColumn(col)
              const isOver = dragOver === col.key

              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      {col.label}
                    </span>
                    <span className="text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {colProjects.length}
                    </span>
                  </div>
                  <div
                    onDragOver={e => handleDragOver(e, col.key)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, col)}
                    className={`rounded-xl p-2 min-h-[400px] transition-colors ${
                      isOver
                        ? 'bg-[#EFF6FF] border-2 border-dashed border-[#2563EB]'
                        : 'bg-[#F3F4F6] border-2 border-transparent'
                    }`}
                  >
                    {colProjects.length === 0 && (
                      <p className="text-xs text-[#9CA3AF] text-center py-8">
                        {dragId ? 'Drop here' : 'No projects'}
                      </p>
                    )}
                    <div className="space-y-2">
                      {colProjects.map(project => {
                        const pct = profitPct(project)
                        const isDragging = dragId === project.id
                        const isArchived = project.status === 'archived'

                        return (
                          <div
                            key={project.id}
                            draggable
                            onDragStart={e => handleDragStart(e, project.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => router.push(`/projects/${project.id}`)}
                            className={`bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 cursor-pointer hover:shadow-sm hover:border-[#D1D5DB] transition-all select-none ${
                              isDragging ? 'opacity-40' : 'opacity-100'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className={`text-sm font-medium truncate ${isArchived ? 'text-[#9CA3AF]' : 'text-[#111]'}`}>
                                  {project.name}
                                </div>
                                {project.client_name && (
                                  <div className={`text-xs truncate mt-0.5 ${isArchived ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
                                    {project.client_name}
                                  </div>
                                )}
                              </div>
                              {pct !== null && (
                                <span
                                  className={`text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${
                                    isArchived ? 'text-[#9CA3AF]' : pct >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'
                                  }`}
                                >
                                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                                </span>
                              )}
                            </div>
                            {project.bid_total > 0 && (
                              <div className={`text-xs font-mono tabular-nums mt-2 ${isArchived ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
                                {fmtMoney(project.bid_total)}
                              </div>
                            )}
                            {/* Phase 3 gate summary (Pro, pre_production/scheduling) */}
                            {hasPreProd && project.status === 'active' && (project.production_phase === 'pre_production' || project.production_phase === 'scheduling') && (() => {
                              const projSubs = subprojects.filter(s => s.project_id === project.id)
                              if (projSubs.length === 0) return null
                              const gate = aggregateProjectGate(projSubs, subStatusMap)
                              if (gate.totalSubs === 0) return null
                              const Icon = gate.ready ? CheckCircle2 : AlertCircle
                              const tone = gate.ready
                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                : 'text-amber-700 bg-amber-50 border-amber-200'
                              return (
                                <div className={`mt-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${tone}`}>
                                  <Icon className="w-2.5 h-2.5" />
                                  <span>
                                    {gate.ready
                                      ? 'Ready for scheduling'
                                      : `${gate.readySubs} of ${gate.totalSubs} ready`}
                                  </span>
                                </div>
                              )
                            })()}
                            {/* Subproject mini dashboard for active/complete */}
                            {(project.status === 'active' || project.status === 'complete') && (() => {
                              const projSubs = subprojects.filter(s => s.project_id === project.id)
                              if (projSubs.length === 0) return null
                              return (
                                <div className="mt-2 pt-2 border-t border-[#F3F4F6] space-y-1.5">
                                  {projSubs.map(sub => {
                                    const actualMinutes = timeEntries
                                      .filter(t => t.subproject_id === sub.id)
                                      .reduce((sum, t) => sum + t.duration_minutes, 0)
                                    const actualHrs = actualMinutes / 60
                                    const estHrs = sub.labor_hours || 0
                                    const pctUsed = estHrs > 0 ? (actualHrs / estHrs) * 100 : 0
                                    const barColor = pctUsed >= 90 ? 'bg-[#DC2626]' : pctUsed >= 70 ? 'bg-[#D97706]' : 'bg-[#2563EB]'
                                    const barWidth = Math.min(pctUsed, 100)

                                    return (
                                      <div key={sub.id}>
                                        <div className="flex items-center justify-between text-[10px] text-[#6B7280]">
                                          <span className="truncate mr-2">{sub.name}</span>
                                          <span className="whitespace-nowrap font-mono tabular-nums">
                                            {actualHrs.toFixed(1)}/{estHrs.toFixed(1)}h
                                          </span>
                                        </div>
                                        <div className="h-1.5 bg-[#E5E7EB] rounded-full mt-0.5 overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${barColor}`}
                                            style={{ width: `${barWidth}%` }}
                                          />
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

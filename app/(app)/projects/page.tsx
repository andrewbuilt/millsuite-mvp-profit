'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

// ── Types ──

interface Project {
  id: string
  org_id: string | null
  name: string
  client_name: string | null
  status: 'bidding' | 'active' | 'complete' | 'archived'
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

type ColumnStatus = 'bidding' | 'active' | 'complete' | 'archived'

const COLUMNS: { status: ColumnStatus; label: string }[] = [
  { status: 'bidding', label: 'Bidding' },
  { status: 'active', label: 'Active' },
  { status: 'complete', label: 'Complete' },
  { status: 'archived', label: 'Archived' },
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

// ── Main Page ──

export default function ProjectsPage() {
  const router = useRouter()
  const { org } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState('')
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<ColumnStatus | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // ── Load Projects ──

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    const [projectsRes, subprojectsRes, timeEntriesRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id, org_id, name, client_name, status, bid_total, actual_total, sold_at, completed_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('subprojects')
        .select('id, project_id, name, labor_hours'),
      supabase
        .from('time_entries')
        .select('id, subproject_id, project_id, duration_minutes'),
    ])
    setProjects(projectsRes.data || [])
    setSubprojects(subprojectsRes.data || [])
    setTimeEntries(timeEntriesRes.data || [])
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

  function handleDragOver(e: React.DragEvent, status: ColumnStatus) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(status)
  }

  function handleDragLeave() {
    setDragOver(null)
  }

  async function handleDrop(e: React.DragEvent, targetStatus: ColumnStatus) {
    e.preventDefault()
    setDragOver(null)
    const projectId = e.dataTransfer.getData('text/plain')
    if (!projectId) return

    const project = projects.find(p => p.id === projectId)
    if (!project || project.status === targetStatus) {
      setDragId(null)
      return
    }

    // Build the update payload
    const updates: Partial<Project> & { status: string } = { status: targetStatus }

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

  function projectsByStatus(status: ColumnStatus): Project[] {
    return projects.filter(p => p.status === status)
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
          <div className="grid grid-cols-4 gap-4">
            {COLUMNS.map(col => {
              const colProjects = projectsByStatus(col.status)
              const isOver = dragOver === col.status

              return (
                <div key={col.status}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      {col.label}
                    </span>
                    <span className="text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {colProjects.length}
                    </span>
                  </div>
                  <div
                    onDragOver={e => handleDragOver(e, col.status)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, col.status)}
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
                        const isArchived = col.status === 'archived'

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

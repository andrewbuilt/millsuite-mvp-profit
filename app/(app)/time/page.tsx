'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { Play, Square, Trash2, Pencil, Check, X, Clock, BookOpen } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────
interface Project {
  id: string
  name: string
  status: string
}

interface Subproject {
  id: string
  project_id: string
  name: string
}

interface TimeEntry {
  id: string
  project_id: string
  subproject_id: string | null
  duration_minutes: number
  notes: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  project?: Project
  subproject?: Subproject
}

interface TimerState {
  projectId: string
  subprojectId: string
  startedAt: string // ISO string
  notes: string
}

const TIMER_KEY = 'millsuite_timer'

// ─── Helpers ──────────────────────────────────────────────────────────
function formatHours(minutes: number): string {
  const h = (minutes / 60).toFixed(1)
  return `${h} hrs`
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDate(entries: TimeEntry[]): Record<string, TimeEntry[]> {
  const groups: Record<string, TimeEntry[]> = {}
  for (const e of entries) {
    const key = (e.started_at || e.created_at).slice(0, 10)
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  }
  return groups
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function TimePage() {
  const { org, user } = useAuth()
  // Shared data
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojectsMap, setSubprojectsMap] = useState<Record<string, Subproject[]>>({})
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Timer state
  const [timerActive, setTimerActive] = useState(false)
  const [timerProjectId, setTimerProjectId] = useState('')
  const [timerSubprojectId, setTimerSubprojectId] = useState('')
  const [timerNotes, setTimerNotes] = useState('')
  const [timerStartedAt, setTimerStartedAt] = useState<Date | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [saved, setSaved] = useState(false)

  // Manual entry state
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [manualProjectId, setManualProjectId] = useState('')
  const [manualSubprojectId, setManualSubprojectId] = useState('')
  const [manualHours, setManualHours] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editHours, setEditHours] = useState('')

  // ── Fetch projects ────────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    if (!org?.id) return
    const { data } = await supabase
      .from('projects')
      .select('id, name, status')
      .eq('org_id', org.id)
      .order('name')
    if (data) setProjects(data)
  }, [org?.id])

  // ── Fetch subprojects for a project (cached) ─────────────────────
  const fetchSubprojects = useCallback(async (projectId: string) => {
    if (!projectId) return
    if (subprojectsMap[projectId]) return
    const { data } = await supabase
      .from('subprojects')
      .select('id, project_id, name')
      .eq('project_id', projectId)
      .order('name')
    if (data) {
      setSubprojectsMap(prev => ({ ...prev, [projectId]: data }))
    }
  }, [subprojectsMap])

  // ── Fetch recent time entries ─────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    if (!org?.id) return
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data } = await supabase
      .from('time_entries')
      .select('*, project:projects(id, name, status), subproject:subprojects(id, project_id, name)')
      .eq('org_id', org.id)
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })

    if (data) setEntries(data as TimeEntry[])
  }, [])

  // ── Restore timer from localStorage ───────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem(TIMER_KEY)
    if (raw) {
      try {
        const state: TimerState = JSON.parse(raw)
        setTimerProjectId(state.projectId)
        setTimerSubprojectId(state.subprojectId)
        setTimerNotes(state.notes || '')
        setTimerStartedAt(new Date(state.startedAt))
        setTimerActive(true)
        if (state.projectId) fetchSubprojects(state.projectId)
      } catch {
        localStorage.removeItem(TIMER_KEY)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tick the timer ────────────────────────────────────────────────
  useEffect(() => {
    if (timerActive && timerStartedAt) {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - timerStartedAt.getTime()) / 1000))
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } else {
      setElapsed(0)
    }
  }, [timerActive, timerStartedAt])

  // ── Init data ─────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchProjects(), fetchEntries()]).then(() => setLoading(false))
  }, [fetchProjects, fetchEntries])

  // ── Timer project change → load subs ──────────────────────────────
  useEffect(() => {
    if (timerProjectId) fetchSubprojects(timerProjectId)
  }, [timerProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (manualProjectId) fetchSubprojects(manualProjectId)
  }, [manualProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start timer ───────────────────────────────────────────────────
  function handleStart() {
    if (!timerProjectId) return
    const now = new Date()
    setTimerStartedAt(now)
    setTimerActive(true)
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      projectId: timerProjectId,
      subprojectId: timerSubprojectId,
      startedAt: now.toISOString(),
      notes: timerNotes,
    } as TimerState))
  }

  // ── Stop timer ────────────────────────────────────────────────────
  async function handleStop() {
    if (!timerStartedAt) return
    const ended = new Date()
    const durationMinutes = Math.round((ended.getTime() - timerStartedAt.getTime()) / 60000)

    await supabase.from('time_entries').insert({
      org_id: org?.id,
      user_id: user?.id,
      project_id: timerProjectId,
      subproject_id: timerSubprojectId || null,
      duration_minutes: Math.max(durationMinutes, 1),
      notes: timerNotes || null,
      started_at: timerStartedAt.toISOString(),
      ended_at: ended.toISOString(),
    })

    // Reset
    setTimerActive(false)
    setTimerStartedAt(null)
    setTimerNotes('')
    setElapsed(0)
    localStorage.removeItem(TIMER_KEY)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
    fetchEntries()
  }

  // ── Manual save ───────────────────────────────────────────────────
  async function handleManualSave() {
    if (!manualProjectId || !manualHours) return
    setManualSaving(true)

    const durationMinutes = Math.round(parseFloat(manualHours) * 60)
    const startedAt = new Date(manualDate + 'T09:00:00')

    await supabase.from('time_entries').insert({
      org_id: org?.id,
      user_id: user?.id,
      project_id: manualProjectId,
      subproject_id: manualSubprojectId || null,
      duration_minutes: durationMinutes,
      notes: manualNotes || null,
      started_at: startedAt.toISOString(),
      ended_at: new Date(startedAt.getTime() + durationMinutes * 60000).toISOString(),
    })

    setManualHours('')
    setManualNotes('')
    setManualSaving(false)
    fetchEntries()
  }

  // ── Inline edit hours ─────────────────────────────────────────────
  async function handleEditSave(id: string) {
    const durationMinutes = Math.round(parseFloat(editHours) * 60)
    if (isNaN(durationMinutes) || durationMinutes <= 0) return

    await supabase.from('time_entries').update({ duration_minutes: durationMinutes }).eq('id', id)
    setEditingId(null)
    fetchEntries()
  }

  // ── Delete entry ──────────────────────────────────────────────────
  async function handleDelete(id: string) {
    await supabase.from('time_entries').delete().eq('id', id)
    fetchEntries()
  }

  // ── Persist timer notes to localStorage ───────────────────────────
  useEffect(() => {
    if (timerActive) {
      const raw = localStorage.getItem(TIMER_KEY)
      if (raw) {
        try {
          const state: TimerState = JSON.parse(raw)
          state.notes = timerNotes
          localStorage.setItem(TIMER_KEY, JSON.stringify(state))
        } catch { /* noop */ }
      }
    }
  }, [timerNotes, timerActive])

  // ── Shared styles ─────────────────────────────────────────────────
  const selectClass =
    'w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl bg-white text-[#111] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors'
  const inputClass = selectClass
  const btnPrimary =
    'px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const grouped = groupByDate(entries)
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const projectName = projects.find(p => p.id === timerProjectId)?.name
  const timerSubs = subprojectsMap[timerProjectId] || []

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      <Nav />

      {/* ═══════ MOBILE TIMER VIEW ═══════ */}
      <div className="md:hidden min-h-[calc(100vh-3.5rem)] bg-[#F9FAFB] flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          {/* Timer display */}
          <div className="text-6xl font-mono tabular-nums font-bold text-[#111] mb-8">
            {formatElapsed(elapsed)}
          </div>

          {timerActive && (
            <div className="flex items-center gap-2 mb-6">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-sm text-[#6B7280]">{projectName}</span>
            </div>
          )}

          {saved && (
            <div className="mb-6 px-4 py-2 bg-[#ECFDF5] text-[#059669] text-sm font-medium rounded-xl">
              Time saved!
            </div>
          )}

          {/* Controls — shown when stopped */}
          {!timerActive && (
            <div className="w-full max-w-xs space-y-3 mb-8">
              <select
                value={timerProjectId}
                onChange={e => { setTimerProjectId(e.target.value); setTimerSubprojectId('') }}
                className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
              >
                <option value="">Select project...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {timerSubs.length > 0 && (
                <select
                  value={timerSubprojectId}
                  onChange={e => setTimerSubprojectId(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
                >
                  <option value="">Subproject (optional)</option>
                  {timerSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <input
                type="text"
                value={timerNotes}
                onChange={e => setTimerNotes(e.target.value)}
                placeholder="What are you working on?"
                className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
              />
            </div>
          )}

          {/* Big button */}
          <button
            onClick={timerActive ? handleStop : handleStart}
            disabled={!timerActive && !timerProjectId}
            className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 ${
              timerActive
                ? 'bg-red-500 text-white'
                : timerProjectId
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#E5E7EB] text-[#9CA3AF]'
            }`}
          >
            {timerActive ? <Square className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
          </button>

          <p className="text-xs text-[#9CA3AF] mt-4">
            {timerActive ? 'Tap to stop' : timerProjectId ? 'Tap to start' : 'Select a project'}
          </p>
        </div>

        {/* Mobile history — compact */}
        {entries.length > 0 && (
          <div className="border-t border-[#E5E7EB] bg-white px-4 py-4">
            <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">Recent</h3>
            <div className="space-y-2">
              {entries.slice(0, 5).map(entry => (
                <div key={entry.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#111] truncate">
                      {(entry.project as any)?.name || 'Unknown'}
                    </div>
                    {entry.notes && (
                      <div className="text-xs text-[#9CA3AF] truncate">{entry.notes}</div>
                    )}
                  </div>
                  <span className="text-sm font-mono text-[#6B7280] ml-3 flex-shrink-0">
                    {formatHours(entry.duration_minutes)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ DESKTOP VIEW ═══════ */}
      <div className="hidden md:block max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Time Tracking</h1>
        </div>

        {/* ────────── TIMER SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Clock className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider">Timer</h2>
          </div>

          {/* Selects row */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Project</label>
              <select
                className={selectClass}
                value={timerProjectId}
                onChange={e => {
                  setTimerProjectId(e.target.value)
                  setTimerSubprojectId('')
                }}
                disabled={timerActive}
              >
                <option value="">Select project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Subproject</label>
              <select
                className={selectClass}
                value={timerSubprojectId}
                onChange={e => setTimerSubprojectId(e.target.value)}
                disabled={timerActive || !timerProjectId}
              >
                <option value="">None</option>
                {timerSubs.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Notes (optional)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="What are you working on?"
              value={timerNotes}
              onChange={e => setTimerNotes(e.target.value)}
            />
          </div>

          {/* Timer display + button */}
          <div className="flex items-center gap-6">
            <button
              onClick={timerActive ? handleStop : handleStart}
              disabled={!timerActive && !timerProjectId}
              className={`flex items-center justify-center w-14 h-14 rounded-full transition-colors ${
                timerActive
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {timerActive ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <div className="font-mono text-4xl font-semibold tracking-tight text-[#111] tabular-nums">
              {formatElapsed(elapsed)}
            </div>

            {timerActive && (
              <div className="ml-auto flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-xs font-medium text-red-500">Recording</span>
              </div>
            )}
          </div>
        </div>

        {/* ────────── MANUAL ENTRY SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <BookOpen className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider">Log Hours Manually</h2>
          </div>

          <div className="grid grid-cols-5 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Date</label>
              <input
                type="date"
                className={inputClass}
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Project</label>
              <select
                className={selectClass}
                value={manualProjectId}
                onChange={e => {
                  setManualProjectId(e.target.value)
                  setManualSubprojectId('')
                }}
              >
                <option value="">Select project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Subproject</label>
              <select
                className={selectClass}
                value={manualSubprojectId}
                onChange={e => setManualSubprojectId(e.target.value)}
                disabled={!manualProjectId}
              >
                <option value="">None</option>
                {(subprojectsMap[manualProjectId] || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Hours</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                className={inputClass}
                placeholder="e.g. 2.5"
                value={manualHours}
                onChange={e => setManualHours(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Notes</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Optional"
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
              />
            </div>
          </div>

          <button
            className={btnPrimary}
            disabled={!manualProjectId || !manualHours || manualSaving}
            onClick={handleManualSave}
          >
            {manualSaving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>

        {/* ────────── HISTORY SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider mb-5">Last 7 Days</h2>

          {loading ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">No time entries yet. Start the timer or log hours manually.</p>
          ) : (
            <div className="space-y-6">
              {sortedDates.map(date => {
                const dayEntries = grouped[date]
                const dayTotal = dayEntries.reduce((sum, e) => sum + e.duration_minutes, 0)
                return (
                  <div key={date}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-[#111]">
                        {dateLabel(date + 'T12:00:00')}
                      </span>
                      <span className="text-xs font-medium text-[#6B7280] font-mono">
                        {formatHours(dayTotal)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {dayEntries.map(entry => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-4 px-4 py-3 bg-[#F9FAFB] rounded-xl group"
                        >
                          {/* Project / subproject */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111] truncate">
                              {(entry.project as any)?.name || 'Unknown Project'}
                              {(entry.subproject as any)?.name && (
                                <span className="text-[#9CA3AF] font-normal"> / {(entry.subproject as any).name}</span>
                              )}
                            </div>
                            {entry.notes && (
                              <div className="text-xs text-[#9CA3AF] truncate mt-0.5">{entry.notes}</div>
                            )}
                          </div>

                          {/* Hours (editable) */}
                          <div className="flex items-center gap-1.5">
                            {editingId === entry.id ? (
                              <>
                                <input
                                  type="number"
                                  step="0.25"
                                  min="0.25"
                                  className="w-20 px-2 py-1 text-sm font-mono border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                                  value={editHours}
                                  onChange={e => setEditHours(e.target.value)}
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleEditSave(entry.id)
                                    if (e.key === 'Escape') setEditingId(null)
                                  }}
                                />
                                <button
                                  onClick={() => handleEditSave(entry.id)}
                                  className="p-1 rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="p-1 rounded-lg text-[#9CA3AF] hover:bg-[#F3F4F6] transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="text-sm font-mono font-medium text-[#111] min-w-[60px] text-right">
                                  {formatHours(entry.duration_minutes)}
                                </span>
                                <button
                                  onClick={() => {
                                    setEditingId(entry.id)
                                    setEditHours((entry.duration_minutes / 60).toFixed(2))
                                  }}
                                  className="p-1 rounded-lg text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] opacity-0 group-hover:opacity-100 transition-all"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1 rounded-lg text-[#9CA3AF] hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

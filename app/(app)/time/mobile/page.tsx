'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { MLogo } from '@/components/logo'
import { Play, Square } from 'lucide-react'

interface Project { id: string; name: string }
interface Subproject { id: string; project_id: string; name: string }
interface Department { id: string; name: string; display_order: number }

const TIMER_KEY = 'millsuite_timer'

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

export default function MobileTimerPage() {
  const { org, user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [departments, setDepartments] = useState<Department[]>([])

  const [timerActive, setTimerActive] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [subprojectId, setSubprojectId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [notes, setNotes] = useState('')
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [saved, setSaved] = useState(false)

  // Load projects + departments (Phase 8: crew needs to pick a dept too)
  useEffect(() => {
    if (!org?.id) return
    supabase.from('projects').select('id, name').eq('org_id', org.id).in('status', ['active', 'bidding']).order('name').then(({ data }) => {
      if (data) setProjects(data)
    })
    supabase.from('departments').select('id, name, display_order').eq('org_id', org.id).eq('active', true).order('display_order').then(({ data }) => {
      if (data) setDepartments(data.filter(d => !d.name.toLowerCase().includes('management')))
    })
  }, [org?.id])

  // Load subprojects when project changes
  useEffect(() => {
    if (!projectId) { setSubprojects([]); return }
    supabase.from('subprojects').select('id, project_id, name').eq('project_id', projectId).order('name').then(({ data }) => {
      if (data) setSubprojects(data)
    })
  }, [projectId])

  // Restore timer
  useEffect(() => {
    const raw = localStorage.getItem(TIMER_KEY)
    if (raw) {
      try {
        const state = JSON.parse(raw)
        setProjectId(state.projectId)
        setSubprojectId(state.subprojectId)
        setDepartmentId(state.departmentId || '')
        setNotes(state.notes || '')
        setStartedAt(new Date(state.startedAt))
        setTimerActive(true)
      } catch { localStorage.removeItem(TIMER_KEY) }
    }
  }, [])

  // Tick
  useEffect(() => {
    if (timerActive && startedAt) {
      const tick = () => setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
      tick()
      intervalRef.current = setInterval(tick, 1000)
      return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
    } else { setElapsed(0) }
  }, [timerActive, startedAt])

  function handleStart() {
    if (!projectId) return
    const now = new Date()
    setStartedAt(now)
    setTimerActive(true)
    localStorage.setItem(TIMER_KEY, JSON.stringify({ projectId, subprojectId, departmentId, startedAt: now.toISOString(), notes }))
  }

  async function handleStop() {
    if (!startedAt) return
    const ended = new Date()
    const durationMinutes = Math.round((ended.getTime() - startedAt.getTime()) / 60000)

    await supabase.from('time_entries').insert({
      org_id: org?.id,
      user_id: user?.id,
      project_id: projectId,
      subproject_id: subprojectId || null,
      department_id: departmentId || null,
      duration_minutes: Math.max(durationMinutes, 1),
      notes: notes || null,
      started_at: startedAt.toISOString(),
      ended_at: ended.toISOString(),
    })

    if (projectId) {
      fetch(`/api/projects/${projectId}/rollup`, { method: 'POST' }).catch(() => {})
      fetch(`/api/projects/${projectId}/advance-phase`, { method: 'POST' }).catch(() => {})
    }

    setTimerActive(false)
    setStartedAt(null)
    setNotes('')
    setDepartmentId('')
    setElapsed(0)
    localStorage.removeItem(TIMER_KEY)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const projectName = projects.find(p => p.id === projectId)?.name

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      {/* Mini header */}
      <div className="bg-white border-b border-[#E5E7EB] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MLogo size={18} color="#111" />
          <span className="text-sm font-semibold text-[#111]">MillSuite</span>
        </div>
        <Link href="/time" className="text-xs text-[#2563EB]">Full view →</Link>
      </div>

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

        {/* Controls */}
        {!timerActive && (
          <div className="w-full max-w-xs space-y-3 mb-8">
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); setSubprojectId('') }}
              className="w-full px-4 py-3 text-sm border border-[#E5E7EB] rounded-xl bg-white"
            >
              <option value="">Select project...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {subprojects.length > 0 && (
              <select
                value={subprojectId}
                onChange={e => setSubprojectId(e.target.value)}
                className="w-full px-4 py-3 text-sm border border-[#E5E7EB] rounded-xl bg-white"
              >
                <option value="">Subproject (optional)</option>
                {subprojects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {departments.length > 0 && (
              <select
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                className="w-full px-4 py-3 text-sm border border-[#E5E7EB] rounded-xl bg-white"
              >
                <option value="">Department (optional)</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What are you working on?"
              className="w-full px-4 py-3 text-sm border border-[#E5E7EB] rounded-xl bg-white"
            />
          </div>
        )}

        {/* Big button */}
        <button
          onClick={timerActive ? handleStop : handleStart}
          disabled={!timerActive && !projectId}
          className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 ${
            timerActive
              ? 'bg-red-500 text-white'
              : projectId
              ? 'bg-[#2563EB] text-white'
              : 'bg-[#E5E7EB] text-[#9CA3AF]'
          }`}
        >
          {timerActive ? <Square className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
        </button>

        <p className="text-xs text-[#9CA3AF] mt-4">
          {timerActive ? 'Tap to stop' : projectId ? 'Tap to start' : 'Select a project'}
        </p>
      </div>
    </div>
  )
}

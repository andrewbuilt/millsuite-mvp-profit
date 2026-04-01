'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

import {
  DEPT_ORDER, DEPT_SHORT, PROJECT_COLORS,
  autoPlace, buildBlocks, computeAlerts, sortProjects, cascadeMove,
  buildDeptConfig, deptConfigToCapacity, blockDays,
  toDateKey, parseDate, addWorkDays, genWorkDays, getMonday,
  type ScheduleProject, type ScheduleSub, type Allocation,
  type PlacedBlock, type DeptCapacity, type DeptKey, type ScheduleAlert, type DeptConfig,
} from '@/lib/schedule-engine'

import Timeline from '@/components/schedule/Timeline'
import type { ZoomLevel } from '@/components/schedule/Timeline'
import ProjectSidebar from '@/components/schedule/ProjectSidebar'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface DeptInfo {
  key: DeptKey; name: string; color: string; id: string
}

// ═══════════════════════════════════════════════════════════════════
// BLOCK EDIT POPOVER
// ═══════════════════════════════════════════════════════════════════

function BlockEditPopover({ block, rect, deptInfos, capacity, deptConfig, memberCountByDept, blocks, allocations, subs, onUpdate, onMoveProject, onClose }: {
  block: PlacedBlock; rect: DOMRect; deptInfos: DeptInfo[]; capacity: DeptCapacity; deptConfig: DeptConfig
  memberCountByDept: Record<string, number>
  blocks: PlacedBlock[]
  allocations: Allocation[]
  subs: ScheduleSub[]
  onUpdate: (allocationId: string, updates: { estimated_hours?: number; crew_size?: number; scheduled_days?: number }) => void
  onMoveProject: (projectId: string, anchorBlockStartDate: string, newStartDate: string) => void
  onClose: () => void
}) {
  const [hours, setHours] = useState(String(block.hours))
  const [crew, setCrew] = useState(block.crewSize)
  const [days, setDays] = useState(String(block.days))
  const [moveDate, setMoveDate] = useState('')
  const popRef = useRef<HTMLDivElement>(null)
  const dept = deptInfos.find(d => d.key === block.dept)
  const maxCrew = memberCountByDept[dept?.id || ''] || 5

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Recalculate days when hours or crew change
  const computedDays = Math.ceil((parseFloat(hours) || block.hours) / (crew * 8))

  function handleCrewChange(newCrew: number) {
    const clamped = Math.max(1, Math.min(maxCrew, newCrew))
    setCrew(clamped)
    const h = parseFloat(hours) || block.hours
    setDays(String(Math.ceil(h / (clamped * 8))))
  }

  function handleApply() {
    const h = parseFloat(hours) || block.hours
    const d = parseInt(days) || computedDays
    onUpdate(block.allocationId, {
      estimated_hours: h,
      crew_size: crew,
      scheduled_days: d,
    })
  }

  function handleMoveAll() {
    if (!moveDate) return
    onMoveProject(block.projectId, block.startDate, moveDate)
  }

  const top = Math.min(rect.bottom + 4, window.innerHeight - 400)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 290))

  return (
    <div ref={popRef} className="fixed z-50" style={{ top, left, width: 280, background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 14 }}>
      <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: `1px solid ${dept?.color || '#E5E7EB'}20` }}>
        <div className="w-1 h-4 rounded-sm" style={{ background: dept?.color || '#94A3B8' }} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-[#111] truncate">{block.subName}</div>
          <div className="text-[9px] text-[#9CA3AF]">{dept?.name} · {block.projectName}</div>
        </div>
      </div>

      {/* Current stats */}
      <div className="flex gap-1.5 mb-3">
        {[{ label: 'Hours', value: block.hours, suffix: 'h' }, { label: 'Crew', value: block.crewSize, suffix: '' }, { label: 'Days', value: block.days, suffix: 'd' }, { label: 'Done', value: block.progress, suffix: '%' }].map(s => (
          <div key={s.label} className="flex-1 bg-[#F9FAFB] rounded-lg p-1.5 text-center">
            <div className="text-[9px] text-[#9CA3AF] font-semibold uppercase tracking-wider">{s.label}</div>
            <div className="text-[11px] font-mono font-semibold text-[#111]">{s.value}{s.suffix}</div>
          </div>
        ))}
      </div>

      {/* Edit fields */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-[#6B7280] font-medium">Hours</label>
          <input value={hours} onChange={e => { setHours(e.target.value); setDays(String(Math.ceil((parseFloat(e.target.value) || 1) / (crew * 8)))) }}
            className="w-20 px-2 py-1 text-xs font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]" />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-[#6B7280] font-medium">Crew</label>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleCrewChange(crew - 1)}
              disabled={crew <= 1}
              className="w-7 h-7 text-sm font-medium rounded-lg transition-colors bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB] disabled:opacity-30 disabled:cursor-not-allowed"
            >-</button>
            <input
              type="number"
              value={crew}
              min={1}
              max={maxCrew}
              onChange={e => handleCrewChange(parseInt(e.target.value) || 1)}
              className="w-12 px-1 py-1 text-xs font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
            />
            <button
              onClick={() => handleCrewChange(crew + 1)}
              disabled={crew >= maxCrew}
              className="w-7 h-7 text-sm font-medium rounded-lg transition-colors bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB] disabled:opacity-30 disabled:cursor-not-allowed"
            >+</button>
            <span className="text-[9px] text-[#9CA3AF] whitespace-nowrap">of {maxCrew} available</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-[#6B7280] font-medium">Days</label>
          <input value={days} onChange={e => setDays(e.target.value)}
            className="w-20 px-2 py-1 text-xs font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]" />
        </div>
      </div>

      {/* Move entire project */}
      <div className="mb-3 pt-2" style={{ borderTop: '1px solid #F3F4F6' }}>
        <label className="text-[10px] text-[#6B7280] font-medium block mb-1.5">Move entire project</label>
        <div className="flex gap-1.5">
          <input
            type="date"
            value={moveDate}
            onChange={e => setMoveDate(e.target.value)}
            className="flex-1 px-2 py-1.5 text-xs font-mono border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
          />
          <button
            onClick={handleMoveAll}
            disabled={!moveDate}
            className="px-3 py-1.5 text-[10px] font-medium bg-[#7C3AED] text-white rounded-lg hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed"
          >Move</button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button onClick={onClose} className="flex-1 px-3 py-1.5 text-[10px] font-medium text-[#6B7280] bg-[#F3F4F6] rounded-lg hover:bg-[#E5E7EB]">Cancel</button>
        <button onClick={handleApply} className="flex-1 px-3 py-1.5 bg-[#2563EB] text-white text-[10px] font-medium rounded-lg hover:bg-[#1D4ED8]">Apply</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DEPARTMENT EDIT MODAL
// ═══════════════════════════════════════════════════════════════════

function DeptEditModal({ dept, headcount, hoursPerDay, defaultCrewSize, onSave, onClose }: {
  dept: { key: DeptKey; name: string; color: string; id: string }
  headcount: number
  hoursPerDay: number
  defaultCrewSize: number
  onSave: (deptId: string, updates: { hours_per_day?: number; default_crew_size?: number }) => void
  onClose: () => void
}) {
  const [hpd, setHpd] = useState(String(hoursPerDay))
  const [dcs, setDcs] = useState(String(defaultCrewSize))
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  function handleSave() {
    onSave(dept.id, {
      hours_per_day: parseFloat(hpd) || 8,
      default_crew_size: parseInt(dcs) || 1,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.2)' }}>
      <div ref={popRef} style={{ width: 280, background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 14 }}>
        <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: `1px solid ${dept.color}20` }}>
          <div className="w-1.5 h-4 rounded-sm" style={{ background: dept.color }} />
          <div className="text-[12px] font-semibold text-[#111]">{dept.name}</div>
        </div>

        <div className="space-y-2.5 mb-3">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-[#6B7280] font-medium">Headcount</label>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-semibold text-[#111]">{headcount}</span>
              <a href="/team" className="text-[9px] text-[#2563EB] hover:text-[#1D4ED8]">change in Team</a>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-[#6B7280] font-medium">Hours per day</label>
            <input value={hpd} onChange={e => setHpd(e.target.value)}
              type="number" min={1} max={24}
              className="w-16 px-2 py-1 text-xs font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-[#6B7280] font-medium">Default crew size</label>
            <input value={dcs} onChange={e => setDcs(e.target.value)}
              type="number" min={1} max={headcount || 10}
              className="w-16 px-2 py-1 text-xs font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]" />
          </div>
        </div>

        <div className="flex gap-1.5">
          <button onClick={onClose} className="flex-1 px-3 py-1.5 text-[10px] font-medium text-[#6B7280] bg-[#F3F4F6] rounded-lg hover:bg-[#E5E7EB]">Cancel</button>
          <button onClick={handleSave} className="flex-1 px-3 py-1.5 bg-[#2563EB] text-white text-[10px] font-medium rounded-lg hover:bg-[#1D4ED8]">Save</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DAILY DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════

function DailyDetailPanel({ date, blocks, deptInfos, capacity, onClose }: {
  date: Date
  blocks: PlacedBlock[]
  deptInfos: DeptInfo[]
  capacity: DeptCapacity
  onClose: () => void
}) {
  const dateKey = toDateKey(date)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)

  // Find blocks that span this date
  const dayBlocks = useMemo(() => {
    return blocks.filter(b => {
      const start = parseDate(b.startDate)
      const end = addWorkDays(start, b.days)
      const d = parseDate(dateKey)
      return d >= start && d < end
    })
  }, [blocks, dateKey])

  const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Group by department
  const byDept = useMemo(() => {
    const map = new Map<DeptKey, PlacedBlock[]>()
    for (const b of dayBlocks) {
      const arr = map.get(b.dept) || []
      arr.push(b)
      map.set(b.dept, arr)
    }
    return map
  }, [dayBlocks])

  function toggleConfirmed(allocId: string) {
    setConfirmed(prev => {
      const n = new Set(prev)
      if (n.has(allocId)) n.delete(allocId)
      else n.add(allocId)
      return n
    })
  }

  return (
    <div className="border-t border-[#E5E7EB] bg-white flex-shrink-0" style={{ maxHeight: 320, overflowY: 'auto' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#F3F4F6] sticky top-0 bg-white z-10">
        <div className="text-[12px] font-semibold text-[#111]">{dayLabel}</div>
        <button onClick={onClose} className="text-[10px] text-[#9CA3AF] hover:text-[#6B7280]">Close</button>
      </div>

      {dayBlocks.length === 0 && (
        <div className="px-4 py-6 text-center text-[11px] text-[#9CA3AF]">No work scheduled for this day</div>
      )}

      <div className="px-4 py-2 space-y-3">
        {DEPT_ORDER.map(deptKey => {
          const deptBlocks = byDept.get(deptKey)
          if (!deptBlocks || deptBlocks.length === 0) return null
          const di = deptInfos.find(d => d.key === deptKey)
          const capHours = capacity[deptKey] || 0
          const usedHours = deptBlocks.reduce((sum, b) => sum + (b.hours / b.days) * b.crewSize, 0)
          const utilPct = capHours > 0 ? Math.round((usedHours / capHours) * 100) : 0

          return (
            <div key={deptKey}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-sm" style={{ background: di?.color || '#94A3B8' }} />
                  <span className="text-[10px] font-semibold text-[#111]">{di?.name || deptKey}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-[#9CA3AF]">{Math.round(usedHours)}h / {capHours}h</span>
                  <span className="text-[9px] font-mono font-semibold" style={{
                    color: utilPct > 100 ? '#DC2626' : utilPct > 85 ? '#D97706' : '#6B7280'
                  }}>{utilPct}%</span>
                </div>
              </div>
              <div className="space-y-1">
                {deptBlocks.map(b => {
                  const isConf = confirmed.has(b.allocationId)
                  return (
                    <div key={b.allocationId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#F9FAFB]">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-[#111] truncate">{b.projectName}</div>
                        <div className="text-[9px] text-[#9CA3AF] truncate">{b.subName}</div>
                      </div>
                      <div className="text-[9px] font-mono text-[#6B7280] shrink-0">{b.hours}h · {b.crewSize}c</div>
                      <button
                        onClick={() => toggleConfirmed(b.allocationId)}
                        className="shrink-0 w-5 h-5 rounded-md border transition-colors flex items-center justify-center"
                        style={{
                          background: isConf ? '#10B981' : '#fff',
                          borderColor: isConf ? '#10B981' : '#D1D5DB',
                        }}
                        title={isConf ? 'Confirmed' : 'Tentative'}
                      >
                        {isConf && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function SchedulePage() {
  return (
    <>
      <Nav />
      <PlanGate requires="schedule">
        <ScheduleContent />
      </PlanGate>
    </>
  )
}

function ScheduleContent() {
  const { org } = useAuth()
  const [loading, setLoading] = useState(true)

  // Raw data
  const [rawDepts, setRawDepts] = useState<any[]>([])
  const [projects, setProjects] = useState<ScheduleProject[]>([])
  const [subs, setSubs] = useState<ScheduleSub[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [teamMembers, setTeamMembers] = useState<any[]>([])
  const [deptMemberCounts, setDeptMemberCounts] = useState<Record<string, number>>({})

  // View state
  const [zoom, setZoom] = useState<ZoomLevel>('medium')
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editingBlock, setEditingBlock] = useState<{ block: PlacedBlock; rect: DOMRect } | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [editingDept, setEditingDept] = useState<DeptInfo | null>(null)

  // ═══════════════════════════════════════════════════════════════
  // DERIVED
  // ═══════════════════════════════════════════════════════════════

  const deptInfos: DeptInfo[] = useMemo(() => {
    return DEPT_ORDER.map(key => {
      const dept = (rawDepts || []).find((d: any) => d.name.toLowerCase() === key)
      return {
        key, name: dept?.name || key.charAt(0).toUpperCase() + key.slice(1),
        color: dept?.color || '#94A3B8', id: dept?.id || key,
      }
    })
  }, [rawDepts])

  const deptConfig: DeptConfig = useMemo(() => {
    const deptData = DEPT_ORDER.map(key => {
      const dept = (rawDepts || []).find((d: any) => d.name.toLowerCase() === key)
      const defaultCrewSize = dept?.default_crew_size || ((key === 'engineering' || key === 'cnc') ? 1 : 2)
      let headcount = 0
      const deptId = dept?.id
      for (const m of teamMembers) {
        if (m.primary_department_id === deptId) headcount++
      }
      return { key, defaultCrewSize, headcount: Math.max(1, headcount), hoursPerPerson: dept?.hours_per_day || 8 }
    })
    return buildDeptConfig(deptData)
  }, [rawDepts, teamMembers])

  const capacity: DeptCapacity = useMemo(() => deptConfigToCapacity(deptConfig), [deptConfig])

  const blocks: PlacedBlock[] = useMemo(
    () => buildBlocks(allocations, projects, subs, capacity, deptConfig),
    [allocations, projects, subs, capacity, deptConfig],
  )

  const unscheduledProjectIds = useMemo(() => {
    const ids = new Set<string>()
    const subToProject = new Map<string, string>()
    subs.forEach(s => subToProject.set(s.id, s.project_id))
    for (const a of allocations) {
      const pid = subToProject.get(a.subproject_id)
      if (pid && !a.scheduled_date && !a.completed && a.estimated_hours > 0) ids.add(pid)
    }
    return ids
  }, [allocations, subs])

  // ═══════════════════════════════════════════════════════════════
  // LOAD DATA
  // ═══════════════════════════════════════════════════════════════

  const loadData = useCallback(async () => {
    if (!org?.id) return
    try {
      const { data: depts } = await supabase.from('departments').select('*').eq('org_id', org.id).eq('active', true).order('display_order')
      setRawDepts(depts || [])

      const deptIdToName: Record<string, string> = {}
      ;(depts || []).forEach((d: any) => { deptIdToName[d.id] = d.name.toLowerCase() })

      const { data: projs } = await supabase
        .from('projects')
        .select('id, name, client_name, status, bid_total, due_date')
        .eq('org_id', org.id)
        .in('status', ['active', 'bidding'])
        .order('name')

      const projectList: ScheduleProject[] = []
      const subList: ScheduleSub[] = []
      const allSubIds: string[] = []

      for (const [i, p] of (projs || []).entries()) {
        projectList.push({
          id: p.id, name: p.name, client: p.client_name || '',
          color: PROJECT_COLORS[i % PROJECT_COLORS.length],
          priority: 'medium', due: (p as any).due_date || null, status: p.status,
        })

        const { data: subData } = await supabase
          .from('subprojects')
          .select('id, name')
          .eq('project_id', p.id)
          .order('sort_order')

        for (const s of (subData || [])) {
          subList.push({ id: s.id, name: s.name, project_id: p.id, sub_due_date: null, schedule_order: 0 })
          allSubIds.push(s.id)
        }
      }

      setProjects(projectList)
      setSubs(subList)

      if (allSubIds.length > 0) {
        const { data: allocs } = await supabase
          .from('department_allocations')
          .select('id, subproject_id, department_id, scheduled_date, scheduled_days, estimated_hours, actual_hours, completed, crew_size')
          .in('subproject_id', allSubIds)

        setAllocations((allocs || []).map((a: any) => ({
          id: a.id, subproject_id: a.subproject_id, department_id: a.department_id,
          dept_key: (deptIdToName[a.department_id] || 'assembly') as DeptKey,
          scheduled_date: a.scheduled_date || null, scheduled_days: a.scheduled_days || null,
          estimated_hours: a.estimated_hours || 0, actual_hours: a.actual_hours || 0,
          completed: a.completed || false, crew_size: a.crew_size || null,
        })))
      } else { setAllocations([]) }

      // Load team members for headcount
      const { data: members } = await supabase.from('users')
        .select('id, name, hourly_cost, is_billable')
        .eq('org_id', org.id)

      // Map department_members to get primary_department_id
      const { data: deptMembers } = await supabase.from('department_members')
        .select('user_id, department_id, is_primary')
        .eq('org_id', org.id)

      const primaryDeptMap: Record<string, string> = {}
      for (const dm of (deptMembers || [])) {
        if (dm.is_primary || !primaryDeptMap[dm.user_id]) {
          primaryDeptMap[dm.user_id] = dm.department_id
        }
      }

      setTeamMembers((members || []).map((m: any) => ({
        ...m, primary_department_id: primaryDeptMap[m.id] || null,
      })))

      // Count members per department
      const counts: Record<string, number> = {}
      for (const dm of (deptMembers || [])) {
        counts[dm.department_id] = (counts[dm.department_id] || 0) + 1
      }
      setDeptMemberCounts(counts)

      setLoading(false)
    } catch (err) {
      console.error('Schedule load error:', err)
      setLoading(false)
    }
  }, [org?.id])

  useEffect(() => { loadData() }, [loadData])

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════

  async function handleBlockDrop(allocationId: string, newStartDate: string) {
    const alloc = allocations.find(a => a.id === allocationId)
    if (!alloc) return

    await supabase.from('department_allocations').update({
      scheduled_date: newStartDate,
    }).eq('id', allocationId)

    setAllocations(prev => prev.map(a => a.id === allocationId ? { ...a, scheduled_date: newStartDate } : a))
  }

  async function handleBlockUpdate(allocationId: string, updates: { estimated_hours?: number; crew_size?: number; scheduled_days?: number }) {
    await supabase.from('department_allocations').update(updates).eq('id', allocationId)
    setEditingBlock(null)
    loadData()
  }

  // Move entire project by offset
  async function handleMoveProject(projectId: string, anchorStartDate: string, newStartDate: string) {
    const anchorDate = parseDate(anchorStartDate)
    const targetDate = parseDate(newStartDate)

    // Calculate offset in calendar days
    const offsetMs = targetDate.getTime() - anchorDate.getTime()
    const offsetDays = Math.round(offsetMs / (1000 * 60 * 60 * 24))

    // Find all blocks for this project
    const projBlocks = blocks.filter(b => b.projectId === projectId)

    for (const block of projBlocks) {
      const blockStart = parseDate(block.startDate)
      const newBlockStart = new Date(blockStart)
      newBlockStart.setDate(newBlockStart.getDate() + offsetDays)
      // Snap to workday (skip weekends forward)
      while (newBlockStart.getDay() === 0 || newBlockStart.getDay() === 6) {
        newBlockStart.setDate(newBlockStart.getDate() + 1)
      }
      const newDateKey = toDateKey(newBlockStart)
      await supabase.from('department_allocations').update({
        scheduled_date: newDateKey,
      }).eq('id', block.allocationId)
    }

    setEditingBlock(null)
    loadData()
  }

  // Smarter scheduling: respect department dependency chain per subproject
  async function handleScheduleProject(projectId: string) {
    const projSubs = subs.filter(s => s.project_id === projectId)
    const today = toDateKey(new Date())
    const deptSequence: DeptKey[] = ['engineering', 'cnc', 'assembly', 'finish', 'install']

    // For each subproject, schedule departments sequentially (eng -> cnc -> asm -> fin -> ins)
    // Different subprojects can run in parallel
    for (const sub of projSubs) {
      let prevEndDate: Date | null = null

      for (const deptKey of deptSequence) {
        const dept = rawDepts.find((d: any) => d.name.toLowerCase() === deptKey)
        if (!dept) continue

        const alloc = allocations.find(a =>
          a.subproject_id === sub.id && a.department_id === dept.id && !a.completed
        )
        if (!alloc || alloc.estimated_hours <= 0) continue

        // If already scheduled, track its end date and continue
        if (alloc.scheduled_date) {
          const start = parseDate(alloc.scheduled_date)
          const days = alloc.scheduled_days || Math.ceil(alloc.estimated_hours / ((alloc.crew_size || deptConfig[deptKey]?.defaultCrewSize || 1) * (deptConfig[deptKey]?.hoursPerPerson || 8)))
          prevEndDate = addWorkDays(start, days)
          continue
        }

        // Calculate crew and days
        const crewSize = alloc.crew_size || deptConfig[deptKey]?.defaultCrewSize || 1
        const hpd = deptConfig[deptKey]?.hoursPerPerson || 8
        const days = Math.ceil(alloc.estimated_hours / (crewSize * hpd))

        // Start date: day after previous department ends, or today
        let startDate: Date
        if (prevEndDate) {
          startDate = addWorkDays(prevEndDate, 0) // start the next workday after previous ends
          // If prevEndDate is already a workday, start the day after
          const prevEndKey = toDateKey(prevEndDate)
          startDate = addWorkDays(prevEndDate, 1)
        } else {
          startDate = parseDate(today)
        }

        const startDateKey = toDateKey(startDate)

        await supabase.from('department_allocations').update({
          scheduled_date: startDateKey,
          scheduled_days: days,
          crew_size: crewSize,
        }).eq('id', alloc.id)

        // Track end date for dependency chain
        prevEndDate = addWorkDays(startDate, days)
      }
    }

    loadData()
  }

  async function handleUpdateDue(projectId: string, newDue: string) {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, due: newDue || null } : p))
    await supabase.from('projects').update({ due_date: newDue || null }).eq('id', projectId)
  }

  async function handleUpdatePriority(projectId: string, newPriority: 'high' | 'medium' | 'low') {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, priority: newPriority } : p))
  }

  async function handleDeptSave(deptId: string, updates: { hours_per_day?: number; default_crew_size?: number }) {
    await supabase.from('departments').update(updates).eq('id', deptId)
    setEditingDept(null)
    loadData()
  }

  function handleDeptClick(deptInfo: DeptInfo) {
    setEditingDept(deptInfo)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-sm text-[#9CA3AF]">Loading schedule...</div>
  }

  if (rawDepts.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-[#9CA3AF] mb-3">Set up departments and assign team members first</p>
        <a href="/team" className="text-sm text-[#2563EB] hover:text-[#1D4ED8] font-medium">Go to Team →</a>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <div className="w-[260px] border-r border-[#E5E7EB] bg-white flex-shrink-0 overflow-y-auto">
        <ProjectSidebar
          projects={projects}
          subs={subs}
          blocks={blocks}
          unscheduledProjectIds={unscheduledProjectIds}
          deptInfos={deptInfos}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onScheduleProject={handleScheduleProject}
          onUpdateDue={handleUpdateDue}
          onUpdatePriority={handleUpdatePriority}
        />
      </div>

      {/* Main timeline area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#E5E7EB] bg-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-[#111]">Production Schedule</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setScrollTrigger(t => t + 1)}
              className="px-2.5 py-1 text-[10px] font-medium text-[#2563EB] bg-[#EFF6FF] rounded-md hover:bg-[#DBEAFE] transition-colors">
              Today
            </button>
            <div className="flex border border-[#E5E7EB] rounded-md overflow-hidden">
              {(['tight', 'medium', 'long'] as ZoomLevel[]).map(z => (
                <button key={z} onClick={() => setZoom(z)}
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${zoom === z ? 'bg-[#2563EB] text-white' : 'text-[#6B7280] hover:bg-[#F3F4F6]'}`}>
                  {z === 'tight' ? 'Day' : z === 'medium' ? 'Week' : 'Month'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <Timeline
          blocks={blocks}
          projects={projects}
          subs={subs}
          capacity={capacity}
          deptInfos={deptInfos}
          zoom={zoom}
          scrollTrigger={scrollTrigger}
          selectedProjectId={selectedProjectId}
          collapsed={collapsed}
          onToggleCollapse={id => setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })}
          onBlockClick={(block, rect) => setEditingBlock({ block, rect })}
          onDateClick={date => setSelectedDate(date)}
          onBlockDrop={handleBlockDrop}
          onDeptLabelClick={handleDeptClick}
        />

        {/* Daily detail panel */}
        {selectedDate && (
          <DailyDetailPanel
            date={selectedDate}
            blocks={blocks}
            deptInfos={deptInfos}
            capacity={capacity}
            onClose={() => setSelectedDate(null)}
          />
        )}
      </div>

      {/* Block edit popover */}
      {editingBlock && (
        <BlockEditPopover
          block={editingBlock.block}
          rect={editingBlock.rect}
          deptInfos={deptInfos}
          capacity={capacity}
          deptConfig={deptConfig}
          memberCountByDept={deptMemberCounts}
          blocks={blocks}
          allocations={allocations}
          subs={subs}
          onUpdate={handleBlockUpdate}
          onMoveProject={handleMoveProject}
          onClose={() => setEditingBlock(null)}
        />
      )}

      {/* Department edit modal */}
      {editingDept && (
        <DeptEditModal
          dept={editingDept}
          headcount={deptMemberCounts[editingDept.id] || 0}
          hoursPerDay={rawDepts.find((d: any) => d.id === editingDept.id)?.hours_per_day || 8}
          defaultCrewSize={rawDepts.find((d: any) => d.id === editingDept.id)?.default_crew_size || (editingDept.key === 'engineering' || editingDept.key === 'cnc' ? 1 : 2)}
          onSave={handleDeptSave}
          onClose={() => setEditingDept(null)}
        />
      )}
    </div>
  )
}

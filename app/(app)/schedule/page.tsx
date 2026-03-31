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
  toDateKey, parseDate,
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

function BlockEditPopover({ block, rect, deptInfos, capacity, deptConfig, onUpdate, onClose }: {
  block: PlacedBlock; rect: DOMRect; deptInfos: DeptInfo[]; capacity: DeptCapacity; deptConfig: DeptConfig
  onUpdate: (allocationId: string, field: 'hours' | 'addDays' | 'crew', value: number) => void; onClose: () => void
}) {
  const [mode, setMode] = useState<'hours' | 'days' | 'crew'>('hours')
  const [val, setVal] = useState(String(block.hours))
  const popRef = useRef<HTMLDivElement>(null)
  const dept = deptInfos.find(d => d.key === block.dept)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleApply = () => { const num = parseInt(val) || 0; if (num > 0) onUpdate(block.allocationId, mode === 'hours' ? 'hours' : mode === 'crew' ? 'crew' : 'addDays', num) }
  const top = Math.min(rect.bottom + 4, window.innerHeight - 300)
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 240))

  return (
    <div ref={popRef} className="fixed z-50" style={{ top, left, width: 228, background: '#fff', borderRadius: 14, border: '1px solid #E5E7EB', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: 14 }}>
      <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: `1px solid ${dept?.color || '#E5E7EB'}20` }}>
        <div className="w-1 h-4 rounded-sm" style={{ background: dept?.color || '#94A3B8' }} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-[#111] truncate">{block.subName}</div>
          <div className="text-[9px] text-[#9CA3AF]">{dept?.name} · {block.projectName}</div>
        </div>
      </div>
      <div className="flex gap-1.5 mb-3">
        {[{ label: 'Hours', value: block.hours, suffix: 'h' }, { label: 'Crew', value: block.crewSize, suffix: '' }, { label: 'Days', value: block.days, suffix: 'd' }, { label: 'Done', value: block.progress, suffix: '%' }].map(s => (
          <div key={s.label} className="flex-1 bg-[#F9FAFB] rounded-lg p-1.5 text-center">
            <div className="text-[9px] text-[#9CA3AF] font-semibold uppercase tracking-wider">{s.label}</div>
            <div className="text-[11px] font-mono font-semibold text-[#111]">{s.value}{s.suffix}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mb-2">
        {(['hours', 'crew', 'days'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setVal(String(m === 'hours' ? block.hours : m === 'crew' ? block.crewSize : block.days)) }}
            className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-colors ${mode === m ? 'bg-[#2563EB] text-white' : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]'}`}>
            {m === 'hours' ? 'Set Hours' : m === 'crew' ? 'Set Crew' : 'Add Days'}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleApply() }}
          className="flex-1 px-2.5 py-1.5 text-sm font-mono text-center border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]" autoFocus />
        <button onClick={handleApply} className="px-3 py-1.5 bg-[#2563EB] text-white text-[10px] font-medium rounded-lg hover:bg-[#1D4ED8]">Apply</button>
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

  // View state
  const [zoom, setZoom] = useState<ZoomLevel>('medium')
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editingBlock, setEditingBlock] = useState<{ block: PlacedBlock; rect: DOMRect } | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

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
      const defaultCrewSize = (key === 'engineering' || key === 'cnc') ? 1 : 2
      let headcount = 0
      const deptId = dept?.id
      for (const m of teamMembers) {
        if (m.primary_department_id === deptId) headcount++
      }
      return { key, defaultCrewSize, headcount: Math.max(1, headcount), hoursPerPerson: 8 }
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
        .select('id, name, client_name, status, bid_total')
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
          priority: 'medium', due: null, status: p.status,
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

  async function handleBlockUpdate(allocationId: string, field: 'hours' | 'addDays' | 'crew', value: number) {
    const alloc = allocations.find(a => a.id === allocationId)
    if (!alloc) return

    const updates: Record<string, any> = {}
    if (field === 'hours') {
      updates.estimated_hours = value
    } else if (field === 'crew') {
      updates.crew_size = value
    } else if (field === 'addDays') {
      updates.scheduled_days = (alloc.scheduled_days || blockDays(alloc.estimated_hours, alloc.crew_size || 1, 8)) + value
    }

    await supabase.from('department_allocations').update(updates).eq('id', allocationId)
    setEditingBlock(null)
    loadData()
  }

  async function handleScheduleProject(projectId: string) {
    // Auto-place all unscheduled allocations for this project
    const projSubs = subs.filter(s => s.project_id === projectId)
    const projAllocIds = allocations
      .filter(a => projSubs.some(s => s.id === a.subproject_id) && !a.scheduled_date && !a.completed)
      .map(a => a.id)

    if (projAllocIds.length === 0) return

    // Use autoPlace from engine
    const newAllocations = autoPlace(allocations, projects, subs, deptConfig, capacity)
    const updates = newAllocations.filter(a => projAllocIds.includes(a.id) && a.scheduled_date)

    for (const alloc of updates) {
      await supabase.from('department_allocations').update({
        scheduled_date: alloc.scheduled_date,
        scheduled_days: alloc.scheduled_days,
        crew_size: alloc.crew_size,
      }).eq('id', alloc.id)
    }

    loadData()
  }

  async function handleUpdateDue(projectId: string, newDue: string) {
    // Not storing due dates in MVP — placeholder
  }

  async function handleUpdatePriority(projectId: string, newPriority: 'high' | 'medium' | 'low') {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, priority: newPriority } : p))
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
        />
      </div>

      {/* Block edit popover */}
      {editingBlock && (
        <BlockEditPopover
          block={editingBlock.block}
          rect={editingBlock.rect}
          deptInfos={deptInfos}
          capacity={capacity}
          deptConfig={deptConfig}
          onUpdate={handleBlockUpdate}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </div>
  )
}

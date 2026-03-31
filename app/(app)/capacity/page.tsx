'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface Department { id: string; name: string; color: string; hours_per_day: number }
interface DeptMember { department_id: string; user_id: string }
interface Project { id: string; name: string; client_name: string | null; status: string; bid_total: number }
interface Subproject { id: string; project_id: string; name: string; labor_hours: number }
interface DeptAllocation { id: string; subproject_id: string; department_id: string; estimated_hours: number }
interface MonthAllocation { id: string; project_id: string; month_date: string; hours_allocated: number; department_hours: Record<string, number> | null; display_order: number }

type ZoomLevel = 'quarter' | 'half' | 'year'

function fmtMoney(n: number) { return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }

export default function CapacityPage() {
  return (
    <>
      <Nav />
      <PlanGate requires="capacity">
        <CapacityContent />
      </PlanGate>
    </>
  )
}

function CapacityContent() {
  const { org } = useAuth()
  const router = useRouter()
  const [year, setYear] = useState(new Date().getFullYear())
  const [departments, setDepartments] = useState<Department[]>([])
  const [deptMembers, setDeptMembers] = useState<DeptMember[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [deptAllocations, setDeptAllocations] = useState<DeptAllocation[]>([])
  const [monthAllocations, setMonthAllocations] = useState<MonthAllocation[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<ZoomLevel>('year')

  // Drag state: source can be 'unscheduled' or 'month' (moving between months)
  const [dragProjectId, setDragProjectId] = useState<string | null>(null)
  const [dragSourceAllocationId, setDragSourceAllocationId] = useState<string | null>(null)
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null)

  useEffect(() => { if (org?.id) loadData() }, [org?.id, year])

  async function loadData() {
    setLoading(true)
    const [
      { data: depts },
      { data: dm },
      { data: projs },
      { data: subs },
      { data: allocs },
      { data: monthAllocs },
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('org_id', org!.id).eq('active', true).order('display_order'),
      supabase.from('department_members').select('department_id, user_id').eq('org_id', org!.id),
      supabase.from('projects').select('id, name, client_name, status, bid_total').eq('org_id', org!.id).in('status', ['active', 'bidding']),
      supabase.from('subprojects').select('id, project_id, name, labor_hours').eq('org_id', org!.id),
      supabase.from('department_allocations').select('id, subproject_id, department_id, estimated_hours').eq('org_id', org!.id),
      supabase.from('project_month_allocations').select('*').eq('org_id', org!.id).gte('month_date', `${year}-01-01`).lte('month_date', `${year}-12-31`),
    ])
    setDepartments(depts || [])
    setDeptMembers(dm || [])
    setProjects(projs || [])
    setSubprojects(subs || [])
    setDeptAllocations(allocs || [])
    setMonthAllocations(monthAllocs || [])
    setLoading(false)
  }

  // Build department hours for a project
  function buildDeptHours(projectId: string): Record<string, number> {
    const projSubs = subprojects.filter(s => s.project_id === projectId)
    const deptHours: Record<string, number> = {}
    for (const sub of projSubs) {
      const allocs = deptAllocations.filter(a => a.subproject_id === sub.id)
      for (const alloc of allocs) {
        deptHours[alloc.department_id] = (deptHours[alloc.department_id] || 0) + alloc.estimated_hours
      }
    }
    return deptHours
  }

  // Capacity per department per month
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`
      const label = new Date(year, i).toLocaleDateString('en-US', { month: 'short' })
      const longLabel = new Date(year, i).toLocaleDateString('en-US', { month: 'long' })
      const workingDays = 21

      const deptCapacity: Record<string, number> = {}
      let totalCapacity = 0
      for (const dept of departments) {
        const memberCount = deptMembers.filter(dm => dm.department_id === dept.id).length
        const cap = memberCount * dept.hours_per_day * workingDays
        deptCapacity[dept.id] = cap
        totalCapacity += cap
      }

      const monthAllocs = monthAllocations.filter(a => a.month_date.startsWith(month))
      let totalAllocated = 0
      const deptAllocated: Record<string, number> = {}
      for (const alloc of monthAllocs) {
        totalAllocated += alloc.hours_allocated
        if (alloc.department_hours) {
          for (const [deptId, hrs] of Object.entries(alloc.department_hours)) {
            deptAllocated[deptId] = (deptAllocated[deptId] || 0) + (hrs as number)
          }
        }
      }

      const utilization = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0
      const projectCards = monthAllocs.map(a => {
        const proj = projects.find(p => p.id === a.project_id)
        return proj ? { ...proj, allocationId: a.id, hours: a.hours_allocated, departmentHours: a.department_hours } : null
      }).filter(Boolean) as (Project & { allocationId: string; hours: number; departmentHours: Record<string, number> | null })[]

      return { month, label, longLabel, totalCapacity, totalAllocated, utilization, deptCapacity, deptAllocated, projectCards }
    })
  }, [departments, deptMembers, monthAllocations, projects, year])

  // Unscheduled projects (not in any month)
  const scheduledProjectIds = new Set(monthAllocations.map(a => a.project_id))
  const unscheduled = projects.filter(p => !scheduledProjectIds.has(p.id))

  // Drop handler — works for both unscheduled and month-to-month moves
  async function handleDrop(targetMonth: string) {
    if (!dragProjectId || !org?.id) return
    setDragOverMonth(null)

    if (dragSourceAllocationId) {
      // Moving from one month to another — delete old, create new
      const oldAlloc = monthAllocations.find(a => a.id === dragSourceAllocationId)
      if (!oldAlloc) return
      // Don't do anything if dropped on the same month
      if (oldAlloc.month_date.startsWith(targetMonth)) {
        setDragProjectId(null)
        setDragSourceAllocationId(null)
        return
      }
      await supabase.from('project_month_allocations').delete().eq('id', dragSourceAllocationId)
      await supabase.from('project_month_allocations').insert({
        org_id: org.id,
        project_id: dragProjectId,
        month_date: `${targetMonth}-01`,
        hours_allocated: oldAlloc.hours_allocated,
        department_hours: oldAlloc.department_hours,
      })
    } else {
      // New allocation from unscheduled
      const projSubs = subprojects.filter(s => s.project_id === dragProjectId)
      const totalHours = projSubs.reduce((sum, s) => sum + (s.labor_hours || 0), 0)
      const deptHours = buildDeptHours(dragProjectId)

      await supabase.from('project_month_allocations').insert({
        org_id: org.id,
        project_id: dragProjectId,
        month_date: `${targetMonth}-01`,
        hours_allocated: totalHours,
        department_hours: Object.keys(deptHours).length > 0 ? deptHours : null,
      })
    }

    setDragProjectId(null)
    setDragSourceAllocationId(null)
    loadData()
  }

  async function removeFromMonth(e: React.MouseEvent, allocationId: string) {
    e.stopPropagation()
    await supabase.from('project_month_allocations').delete().eq('id', allocationId)
    loadData()
  }

  // Grid config per zoom level
  const gridConfig = {
    quarter: { cols: 'grid-cols-3', monthCount: 3 },
    half: { cols: 'grid-cols-6', monthCount: 6 },
    year: { cols: 'grid-cols-12', monthCount: 12 },
  }

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
  }

  const zoomButtons: { key: ZoomLevel; label: string }[] = [
    { key: 'quarter', label: 'Quarter' },
    { key: 'half', label: 'Half' },
    { key: 'year', label: 'Year' },
  ]

  return (
    <div className="max-w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Capacity</h1>
        <div className="flex items-center gap-4">
          {/* Zoom buttons */}
          <div className="flex items-center bg-[#F3F4F6] rounded-lg p-0.5">
            {zoomButtons.map(z => (
              <button
                key={z.key}
                onClick={() => setZoom(z.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  zoom === z.key
                    ? 'bg-white text-[#111] shadow-sm'
                    : 'text-[#6B7280] hover:text-[#111]'
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
          {/* Year nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-[#111] min-w-[48px] text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {departments.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center">
          <p className="text-sm text-[#9CA3AF] mb-3">Set up departments and assign team members first</p>
          <button onClick={() => router.push('/team')} className="text-sm text-[#2563EB] hover:text-[#1D4ED8] font-medium">
            Go to Team →
          </button>
        </div>
      ) : (
        <>
          {/* Month columns */}
          <div className={`overflow-x-auto pb-2`}>
            <div className={`grid ${gridConfig[zoom].cols} gap-2 mb-6`} style={{ minWidth: zoom === 'year' ? '1200px' : zoom === 'half' ? '900px' : undefined }}>
              {months.map(m => {
                const isOver = dragOverMonth === m.month
                const isCurrentMonth = m.month === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
                return (
                  <div
                    key={m.month}
                    onDragOver={e => { e.preventDefault(); setDragOverMonth(m.month) }}
                    onDragLeave={() => setDragOverMonth(null)}
                    onDrop={e => { e.preventDefault(); handleDrop(m.month) }}
                    className={`rounded-xl border-2 transition-colors ${
                      zoom === 'year' ? 'min-h-[300px]' : zoom === 'half' ? 'min-h-[360px]' : 'min-h-[420px]'
                    } ${
                      isOver ? 'border-[#2563EB] bg-[#EFF6FF]' :
                      isCurrentMonth ? 'border-[#D4956A]/30 bg-[#FFF7ED]/30' :
                      'border-transparent bg-[#F9FAFB]'
                    }`}
                  >
                    {/* Month header */}
                    <div className={`text-center ${zoom === 'quarter' ? 'px-4 py-3' : 'px-2 py-2'}`}>
                      <div className={`font-semibold text-[#111] ${zoom === 'quarter' ? 'text-sm' : 'text-xs'}`}>
                        {zoom === 'quarter' ? m.longLabel : m.label}
                      </div>
                      <div className={`text-[#9CA3AF] font-mono tabular-nums ${zoom === 'quarter' ? 'text-xs mt-0.5' : 'text-[9px]'}`}>
                        {Math.round(m.totalAllocated)}/{Math.round(m.totalCapacity)}h
                      </div>
                      {/* Utilization bar */}
                      <div className={`bg-[#E5E7EB] rounded-full overflow-hidden ${zoom === 'quarter' ? 'h-2 mt-2' : 'h-1 mt-1'}`}>
                        <div
                          className={`h-full rounded-full ${m.utilization > 100 ? 'bg-[#DC2626]' : m.utilization > 80 ? 'bg-[#F59E0B]' : 'bg-[#2563EB]'}`}
                          style={{ width: `${Math.min(m.utilization, 100)}%` }}
                        />
                      </div>
                      <div className={`font-mono tabular-nums font-medium mt-0.5 ${
                        zoom === 'quarter' ? 'text-xs' : 'text-[9px]'
                      } ${
                        m.utilization > 100 ? 'text-[#DC2626]' : m.utilization > 80 ? 'text-[#F59E0B]' : 'text-[#6B7280]'
                      }`}>{Math.round(m.utilization)}%</div>
                    </div>

                    {/* Department breakdown */}
                    <div className={`space-y-0.5 mb-2 ${zoom === 'quarter' ? 'px-3' : 'px-1.5'}`}>
                      {departments.map(dept => {
                        const cap = m.deptCapacity[dept.id] || 0
                        const alloc = m.deptAllocated[dept.id] || 0
                        const pct = cap > 0 ? (alloc / cap) * 100 : 0
                        return (
                          <div key={dept.id} className="flex items-center gap-1">
                            <div className={`rounded-sm flex-shrink-0 ${zoom === 'quarter' ? 'w-2 h-2' : 'w-1 h-1'}`} style={{ background: dept.color }} />
                            {zoom === 'quarter' && (
                              <span className="text-[10px] text-[#6B7280] w-16 truncate">{dept.name}</span>
                            )}
                            <div className={`flex-1 bg-[#E5E7EB] rounded-full overflow-hidden ${zoom === 'quarter' ? 'h-1.5' : 'h-1'}`}>
                              <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: dept.color }} />
                            </div>
                            <span className={`font-mono tabular-nums text-[#9CA3AF] text-right ${
                              zoom === 'quarter' ? 'text-[10px] w-16' : zoom === 'half' ? 'text-[8px] w-10' : 'text-[7px] w-8'
                            }`}>
                              {Math.round(alloc)}/{Math.round(cap)}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Project cards in this month */}
                    <div className={`space-y-1 ${zoom === 'quarter' ? 'px-3' : 'px-1.5'}`}>
                      {m.projectCards.map(card => (
                        <ProjectCard
                          key={card.allocationId}
                          card={card}
                          zoom={zoom}
                          departments={departments}
                          onNavigate={() => router.push(`/projects/${card.id}`)}
                          onRemove={(e) => removeFromMonth(e, card.allocationId)}
                          onDragStart={() => {
                            setDragProjectId(card.id)
                            setDragSourceAllocationId(card.allocationId)
                          }}
                          onDragEnd={() => {
                            setDragProjectId(null)
                            setDragSourceAllocationId(null)
                            setDragOverMonth(null)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Unscheduled projects */}
          {unscheduled.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-[#111] mb-2">Unscheduled ({unscheduled.length})</h2>
              <div className="flex flex-wrap gap-2">
                {unscheduled.map(proj => (
                  <div
                    key={proj.id}
                    draggable
                    onDragStart={() => { setDragProjectId(proj.id); setDragSourceAllocationId(null) }}
                    onDragEnd={() => { setDragProjectId(null); setDragSourceAllocationId(null); setDragOverMonth(null) }}
                    className="bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing hover:border-[#2563EB] transition-colors"
                  >
                    <div className="text-xs font-medium text-[#111]">{proj.name}</div>
                    {proj.client_name && <div className="text-[10px] text-[#9CA3AF]">{proj.client_name}</div>}
                    <div className="text-[10px] font-mono tabular-nums text-[#6B7280]">{fmtMoney(proj.bid_total)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// --------------------------------------------------
// Project card component — adapts display to zoom level
// --------------------------------------------------
function ProjectCard({
  card,
  zoom,
  departments,
  onNavigate,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  card: Project & { allocationId: string; hours: number; departmentHours: Record<string, number> | null }
  zoom: ZoomLevel
  departments: Department[]
  onNavigate: () => void
  onRemove: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  if (zoom === 'year') {
    // Compact: just name, truncated
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
        onClick={onNavigate}
      >
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2 h-2 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className="text-[10px] font-medium text-[#111] truncate">{card.name}</div>
      </div>
    )
  }

  if (zoom === 'half') {
    // Medium: name + hours
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
        onClick={onNavigate}
      >
        <button
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className="text-[10px] font-medium text-[#111] truncate">{card.name}</div>
        <div className="text-[9px] font-mono tabular-nums text-[#6B7280]">{card.hours}h</div>
      </div>
    )
  }

  // Quarter: full detail — name, client, hours, bid total, dept breakdown
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
      onClick={onNavigate}
    >
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
      >
        <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
      </button>
      <div className="text-xs font-medium text-[#111] truncate">{card.name}</div>
      {card.client_name && <div className="text-[10px] text-[#9CA3AF] truncate">{card.client_name}</div>}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] font-mono tabular-nums text-[#6B7280]">{card.hours}h</span>
        <span className="text-[10px] font-mono tabular-nums text-[#9CA3AF]">{fmtMoney(card.bid_total)}</span>
      </div>
      {/* Department hour breakdown */}
      {card.departmentHours && Object.keys(card.departmentHours).length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
          {departments.map(dept => {
            const hrs = card.departmentHours?.[dept.id]
            if (!hrs) return null
            return (
              <div key={dept.id} className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-sm" style={{ background: dept.color }} />
                <span className="text-[9px] font-mono tabular-nums text-[#9CA3AF]">{Math.round(hrs)}h</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

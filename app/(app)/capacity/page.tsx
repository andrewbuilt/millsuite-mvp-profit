'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Department { id: string; name: string; color: string; hours_per_day: number }
interface DeptMember { department_id: string; user_id: string }
interface Project { id: string; name: string; client_name: string | null; status: string; bid_total: number }
interface Subproject { id: string; project_id: string; name: string; labor_hours: number }
interface DeptAllocation { id: string; subproject_id: string; department_id: string; estimated_hours: number }
interface MonthAllocation { id: string; project_id: string; month_date: string; hours_allocated: number; department_hours: Record<string, number> | null; display_order: number }

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

  // Capacity per department per month
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`
      const label = new Date(year, i).toLocaleDateString('en-US', { month: 'short' })
      const workingDays = 21 // simplified — could account for holidays

      // Capacity = members × hours_per_day × working days
      const deptCapacity: Record<string, number> = {}
      let totalCapacity = 0
      for (const dept of departments) {
        const memberCount = deptMembers.filter(dm => dm.department_id === dept.id).length
        const cap = memberCount * dept.hours_per_day * workingDays
        deptCapacity[dept.id] = cap
        totalCapacity += cap
      }

      // Allocated hours this month
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
        return proj ? { ...proj, allocationId: a.id, hours: a.hours_allocated } : null
      }).filter(Boolean)

      return { month, label, totalCapacity, totalAllocated, utilization, deptCapacity, deptAllocated, projectCards }
    })
  }, [departments, deptMembers, monthAllocations, projects, year])

  // Unscheduled projects (not in any month)
  const scheduledProjectIds = new Set(monthAllocations.map(a => a.project_id))
  const unscheduled = projects.filter(p => !scheduledProjectIds.has(p.id))

  // Drag and drop
  const [dragProjectId, setDragProjectId] = useState<string | null>(null)
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null)

  async function handleDrop(month: string) {
    if (!dragProjectId || !org?.id) return
    setDragOverMonth(null)

    // Get total hours for this project from subproject allocations or labor_hours
    const projSubs = subprojects.filter(s => s.project_id === dragProjectId)
    const totalHours = projSubs.reduce((sum, s) => sum + (s.labor_hours || 0), 0)

    // Build department hours from allocations
    const deptHours: Record<string, number> = {}
    for (const sub of projSubs) {
      const allocs = deptAllocations.filter(a => a.subproject_id === sub.id)
      for (const alloc of allocs) {
        deptHours[alloc.department_id] = (deptHours[alloc.department_id] || 0) + alloc.estimated_hours
      }
    }

    await supabase.from('project_month_allocations').insert({
      org_id: org.id,
      project_id: dragProjectId,
      month_date: `${month}-01`,
      hours_allocated: totalHours,
      department_hours: Object.keys(deptHours).length > 0 ? deptHours : null,
    })

    setDragProjectId(null)
    loadData()
  }

  async function removeFromMonth(allocationId: string) {
    await supabase.from('project_month_allocations').delete().eq('id', allocationId)
    loadData()
  }

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
  }

  return (
    <div className="max-w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Capacity</h1>
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
          <div className="grid grid-cols-12 gap-2 mb-6 overflow-x-auto">
            {months.map(m => {
              const isOver = dragOverMonth === m.month
              const isCurrentMonth = m.month === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
              return (
                <div
                  key={m.month}
                  onDragOver={e => { e.preventDefault(); setDragOverMonth(m.month) }}
                  onDragLeave={() => setDragOverMonth(null)}
                  onDrop={e => { e.preventDefault(); handleDrop(m.month) }}
                  className={`min-h-[300px] rounded-xl border-2 transition-colors ${
                    isOver ? 'border-[#2563EB] bg-[#EFF6FF]' :
                    isCurrentMonth ? 'border-[#D4956A]/30 bg-[#FFF7ED]/30' :
                    'border-transparent bg-[#F9FAFB]'
                  }`}
                >
                  {/* Month header */}
                  <div className="px-2 py-2 text-center">
                    <div className="text-xs font-semibold text-[#111]">{m.label}</div>
                    <div className="text-[9px] text-[#9CA3AF] font-mono">{Math.round(m.totalAllocated)}/{Math.round(m.totalCapacity)}h</div>
                    {/* Utilization bar */}
                    <div className="h-1 bg-[#E5E7EB] rounded-full mt-1 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.utilization > 100 ? 'bg-[#DC2626]' : m.utilization > 80 ? 'bg-[#F59E0B]' : 'bg-[#2563EB]'}`}
                        style={{ width: `${Math.min(m.utilization, 100)}%` }}
                      />
                    </div>
                    <div className={`text-[9px] font-mono font-medium mt-0.5 ${
                      m.utilization > 100 ? 'text-[#DC2626]' : m.utilization > 80 ? 'text-[#F59E0B]' : 'text-[#6B7280]'
                    }`}>{Math.round(m.utilization)}%</div>
                  </div>

                  {/* Department breakdown */}
                  <div className="px-1.5 space-y-0.5 mb-2">
                    {departments.map(dept => {
                      const cap = m.deptCapacity[dept.id] || 0
                      const alloc = m.deptAllocated[dept.id] || 0
                      const pct = cap > 0 ? (alloc / cap) * 100 : 0
                      return (
                        <div key={dept.id} className="flex items-center gap-1">
                          <div className="w-1 h-1 rounded-sm flex-shrink-0" style={{ background: dept.color }} />
                          <div className="flex-1 h-1 bg-[#E5E7EB] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: dept.color }} />
                          </div>
                          <span className="text-[7px] font-mono text-[#9CA3AF] w-8 text-right">{Math.round(alloc)}/{Math.round(cap)}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Project cards in this month */}
                  <div className="px-1.5 space-y-1">
                    {(m.projectCards as any[]).map((card: any) => (
                      <div key={card.allocationId}
                        className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 cursor-pointer hover:border-[#D1D5DB] transition-colors group"
                        onClick={() => router.push(`/projects/${card.id}`)}
                      >
                        <div className="text-[10px] font-medium text-[#111] truncate">{card.name}</div>
                        {card.client_name && <div className="text-[8px] text-[#9CA3AF] truncate">{card.client_name}</div>}
                        <div className="text-[8px] font-mono text-[#6B7280]">{card.hours}h</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
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
                    onDragStart={() => setDragProjectId(proj.id)}
                    onDragEnd={() => { setDragProjectId(null); setDragOverMonth(null) }}
                    className="bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing hover:border-[#2563EB] transition-colors"
                  >
                    <div className="text-xs font-medium text-[#111]">{proj.name}</div>
                    {proj.client_name && <div className="text-[10px] text-[#9CA3AF]">{proj.client_name}</div>}
                    <div className="text-[10px] font-mono text-[#6B7280]">{fmtMoney(proj.bid_total)}</div>
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

'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { loadProjectDeptHours } from '@/lib/project-hours'

interface Department { id: string; name: string; color: string; hours_per_day: number }
interface DeptMember { department_id: string; user_id: string }
interface Project { id: string; name: string; client_name: string | null; status: string; bid_total: number }
interface Subproject { id: string; project_id: string; name: string }
interface DeptAllocation { id: string; subproject_id: string; department_id: string; estimated_hours: number }
interface MonthAllocation { id: string; project_id: string; month_date: string; hours_allocated: number; department_hours: Record<string, number> | null; display_order: number; split_index?: number; split_total?: number; split_group_id?: string }
// capacity_overrides row shape — see db/migrations/045_capacity_overrides.sql
// team_member_id NULL = company holiday; non-null = individual PTO.
// hours_reduction = 0 falls back to the team member's default day length
// (8h until per-member day length lands).
interface CapacityOverride {
  id: string
  override_date: string
  team_member_id: string | null
  department_id: string | null
  reason: string
  hours_reduction: number
}

// Default day length used when a PTO row carries hours_reduction=0. Matches
// the seed default in app/api/auth/setup/route.ts. Per-member day length is
// not yet stored on orgs.team_members jsonb.
const DEFAULT_DAY_HOURS = 8

// Count Mon–Fri days in a given calendar month.
function weekdaysInMonth(year: number, month0: number): number {
  let count = 0
  const last = new Date(year, month0 + 1, 0).getDate()
  for (let d = 1; d <= last; d++) {
    const dow = new Date(year, month0, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

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
  const [capacityOverrides, setCapacityOverrides] = useState<CapacityOverride[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<ZoomLevel>('year')

  // Drag state: source can be 'unscheduled' or 'month' (moving between months)
  const [dragProjectId, setDragProjectId] = useState<string | null>(null)
  const [dragSourceAllocationId, setDragSourceAllocationId] = useState<string | null>(null)
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null)

  // Split modal state
  const [splitModal, setSplitModal] = useState<{ projectId: string; allocationId: string; currentHours: number; projectName: string } | null>(null)

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
      { data: overrides },
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('org_id', org!.id).eq('active', true).order('display_order'),
      supabase.from('department_members').select('department_id, user_id').eq('org_id', org!.id),
      supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total')
        .eq('org_id', org!.id)
        .in('stage', ['new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'production', 'installed']),
      supabase.from('subprojects').select('id, project_id, name').eq('org_id', org!.id),
      supabase.from('department_allocations').select('id, subproject_id, department_id, estimated_hours').eq('org_id', org!.id),
      supabase.from('project_month_allocations').select('*').eq('org_id', org!.id).gte('month_date', `${year}-01-01`).lte('month_date', `${year}-12-31`),
      supabase
        .from('capacity_overrides')
        .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
        .eq('org_id', org!.id)
        .gte('override_date', `${year}-01-01`)
        .lte('override_date', `${year}-12-31`),
    ])
    setDepartments(depts || [])
    setDeptMembers(dm || [])
    setProjects(projs || [])
    setSubprojects(subs || [])
    setDeptAllocations(allocs || [])
    setMonthAllocations(monthAllocs || [])
    setCapacityOverrides((overrides || []) as CapacityOverride[])
    setLoading(false)
  }

  // Hours per project come from estimate_lines via loadProjectDeptHours
  // (lib/project-hours.ts). The legacy sources (the subprojects hours
  // column + department_allocations) are stage-locked and silently zero
  // for sold projects, so any drop-from-unscheduled wrote 0h.

  // Capacity per department per month
  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`
      const label = new Date(year, i).toLocaleDateString('en-US', { month: 'short' })
      const longLabel = new Date(year, i).toLocaleDateString('en-US', { month: 'long' })
      const workingDays = weekdaysInMonth(year, i)

      // Holidays + PTO for this month — partition by team_member_id.
      // NULL team_member_id = company-wide holiday; non-null = individual PTO.
      // Department-scoped holidays only knock days off that one dept; the
      // common case (company-wide) has department_id NULL.
      const monthOverrides = capacityOverrides.filter((o) => o.override_date.startsWith(month))
      const holidays = monthOverrides.filter((o) => o.team_member_id == null)
      const ptos = monthOverrides.filter((o) => o.team_member_id != null)

      const deptCapacity: Record<string, number> = {}
      let totalCapacity = 0
      for (const dept of departments) {
        const memberCount = deptMembers.filter((dm) => dm.department_id === dept.id).length
        const deptHolidayCount = holidays.filter(
          (h) => h.department_id == null || h.department_id === dept.id,
        ).length
        const effectiveDays = Math.max(0, workingDays - deptHolidayCount)
        const cap = memberCount * dept.hours_per_day * effectiveDays
        deptCapacity[dept.id] = cap
        totalCapacity += cap
      }

      // PTO subtracts from the shop-wide total. Per-dept attribution would
      // require knowing each member's primary dept; deferred to PR-B.
      const ptoHours = ptos.reduce((sum, p) => {
        const h = Number(p.hours_reduction) || 0
        return sum + (h > 0 ? h : DEFAULT_DAY_HOURS)
      }, 0)
      totalCapacity = Math.max(0, totalCapacity - ptoHours)

      // Surfaced on the month card header.
      const holidayCount = holidays.length
      const ptoDayCount = new Set(ptos.map((p) => p.override_date)).size
      const ptoPersonCount = new Set(ptos.map((p) => p.team_member_id)).size
      const effectiveWorkingDays = Math.max(0, workingDays - holidayCount)

      const monthAllocs = monthAllocations.filter((a) => a.month_date.startsWith(month))
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
      const projectCards = monthAllocs.map((a) => {
        const proj = projects.find((p) => p.id === a.project_id)
        return proj ? { ...proj, allocationId: a.id, hours: a.hours_allocated, departmentHours: a.department_hours, splitIndex: a.split_index || 0, splitTotal: a.split_total || 0, splitGroupId: a.split_group_id || null } : null
      }).filter(Boolean) as (Project & { allocationId: string; hours: number; departmentHours: Record<string, number> | null; splitIndex: number; splitTotal: number; splitGroupId: string | null })[]

      return {
        month, label, longLabel,
        totalCapacity, totalAllocated, utilization,
        deptCapacity, deptAllocated, projectCards,
        holidayCount, ptoHours, ptoDayCount, ptoPersonCount,
        workingDays, effectiveWorkingDays,
      }
    })
  }, [departments, deptMembers, monthAllocations, capacityOverrides, projects, year])

  // Unscheduled projects (not in any month)
  const scheduledProjectIds = new Set(monthAllocations.map(a => a.project_id))
  const unscheduled = projects.filter(p => !scheduledProjectIds.has(p.id))

  // Drop handler — works for both unscheduled and month-to-month moves
  // When dragging a split card, ALL cards in the same split_group_id move together
  async function handleDrop(targetMonth: string) {
    if (!dragProjectId || !org?.id) return
    setDragOverMonth(null)

    if (dragSourceAllocationId) {
      const oldAlloc = monthAllocations.find(a => a.id === dragSourceAllocationId)
      if (!oldAlloc) return
      if (oldAlloc.month_date.startsWith(targetMonth)) {
        setDragProjectId(null)
        setDragSourceAllocationId(null)
        return
      }

      // Calculate month offset
      const oldDate = new Date(oldAlloc.month_date + 'T00:00:00')
      const targetDate = new Date(`${targetMonth}-01T00:00:00`)
      const monthOffset = (targetDate.getFullYear() - oldDate.getFullYear()) * 12 + (targetDate.getMonth() - oldDate.getMonth())

      // Check if this allocation belongs to a split group
      if (oldAlloc.split_group_id && (oldAlloc.split_total || 1) > 1) {
        // Move ALL allocations in the same split group by the same
        // month offset. Per-month hours / dept_hours are an intentional
        // distribution from the split — preserve them.
        const groupAllocs = monthAllocations.filter(a => a.split_group_id === oldAlloc.split_group_id)
        for (const alloc of groupAllocs) {
          const allocDate = new Date(alloc.month_date + 'T00:00:00')
          const newMonth = new Date(allocDate.getFullYear(), allocDate.getMonth() + monthOffset, 1)
          const newMonthStr = `${newMonth.getFullYear()}-${String(newMonth.getMonth() + 1).padStart(2, '0')}-01`
          await supabase.from('project_month_allocations').update({ month_date: newMonthStr }).eq('id', alloc.id)
        }
      } else {
        // Single allocation move — refresh hours from estimate_lines so
        // moving doesn't propagate a stale zero from an older drop.
        const fresh = await loadProjectDeptHours(org.id, dragProjectId)
        await supabase.from('project_month_allocations').delete().eq('id', dragSourceAllocationId)
        await supabase.from('project_month_allocations').insert({
          org_id: org.id,
          project_id: dragProjectId,
          month_date: `${targetMonth}-01`,
          hours_allocated: fresh.totalHours,
          department_hours:
            Object.keys(fresh.deptHours).length > 0 ? fresh.deptHours : null,
        })
      }
    } else {
      // New allocation from unscheduled — pull hours from estimate_lines.
      const fresh = await loadProjectDeptHours(org.id, dragProjectId)

      await supabase.from('project_month_allocations').insert({
        org_id: org.id,
        project_id: dragProjectId,
        month_date: `${targetMonth}-01`,
        hours_allocated: fresh.totalHours,
        department_hours:
          Object.keys(fresh.deptHours).length > 0 ? fresh.deptHours : null,
      })
    }

    setDragProjectId(null)
    setDragSourceAllocationId(null)
    loadData()
  }

  // Split handler: creates N evenly-divided allocations
  async function handleSplit(numMonths: number) {
    if (!splitModal || !org?.id) return
    const { projectId, allocationId, currentHours } = splitModal
    const oldAlloc = monthAllocations.find(a => a.id === allocationId)
    if (!oldAlloc) return

    const hoursPerMonth = Math.round(currentHours / numMonths)
    const groupId = crypto.randomUUID()
    const startDate = new Date(oldAlloc.month_date + 'T00:00:00')

    // Delete the current allocation
    await supabase.from('project_month_allocations').delete().eq('id', allocationId)

    // Create N new allocations
    for (let i = 0; i < numMonths; i++) {
      const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
      const hrs = i === numMonths - 1 ? currentHours - hoursPerMonth * (numMonths - 1) : hoursPerMonth
      await supabase.from('project_month_allocations').insert({
        org_id: org.id,
        project_id: projectId,
        month_date: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`,
        hours_allocated: hrs,
        department_hours: oldAlloc.department_hours,
        split_group_id: groupId,
        split_index: i + 1,
        split_total: numMonths,
      })
    }

    setSplitModal(null)
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

                      {/* Holiday + PTO badges. Hidden when both are zero so
                          the month header doesn't grow with empty rows. */}
                      {(m.holidayCount > 0 || m.ptoHours > 0) && (
                        <div className={`flex items-center justify-center flex-wrap gap-1 mt-1 ${zoom === 'quarter' ? 'text-[10px]' : 'text-[9px]'}`}>
                          {m.holidayCount > 0 && (
                            <span
                              title={`${m.holidayCount} company holiday${m.holidayCount === 1 ? '' : 's'} this month`}
                              className="inline-flex items-center gap-0.5 font-mono tabular-nums text-[#DC2626]"
                            >
                              <span aria-hidden>🏛</span> {m.holidayCount}d
                            </span>
                          )}
                          {m.ptoHours > 0 && (
                            <span
                              title={`${m.ptoDayCount} PTO day${m.ptoDayCount === 1 ? '' : 's'} across ${m.ptoPersonCount} ${m.ptoPersonCount === 1 ? 'person' : 'people'} (${Math.round(m.ptoHours)}h)`}
                              className="inline-flex items-center gap-0.5 font-mono tabular-nums text-[#92400E]"
                            >
                              <span aria-hidden>🏖</span>
                              {m.ptoDayCount}d · {m.ptoPersonCount}p · {Math.round(m.ptoHours)}h
                            </span>
                          )}
                        </div>
                      )}
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
                          subprojectNames={subprojects.filter(s => s.project_id === card.id).map(s => s.name)}
                          onRemove={(e) => removeFromMonth(e, card.allocationId)}
                          onSplit={(e) => {
                            e.stopPropagation()
                            setSplitModal({ projectId: card.id, allocationId: card.allocationId, currentHours: card.hours, projectName: card.name })
                          }}
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

      {/* Split modal */}
      {splitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-xl p-6 w-[340px]">
            <h3 className="text-sm font-semibold text-[#111] mb-1">Split across months</h3>
            <p className="text-xs text-[#6B7280] mb-1">{splitModal.projectName}</p>
            <p className="text-xs font-mono text-[#9CA3AF] mb-4">{splitModal.currentHours} hours total</p>
            <div className="flex flex-col gap-2 mb-4">
              {[2, 3, 4].map(n => (
                <button
                  key={n}
                  onClick={() => handleSplit(n)}
                  className="w-full px-4 py-2.5 text-sm font-medium text-[#111] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg hover:bg-[#EFF6FF] hover:border-[#2563EB] transition-colors text-left"
                >
                  <span className="font-semibold">{n} months</span>
                  <span className="text-[#9CA3AF] ml-2 font-mono text-xs">
                    ~{Math.round(splitModal.currentHours / n)}h each
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setSplitModal(null)}
              className="w-full px-4 py-2 text-xs font-medium text-[#6B7280] bg-[#F3F4F6] rounded-lg hover:bg-[#E5E7EB] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
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
  subprojectNames,
  onRemove,
  onSplit,
  onDragStart,
  onDragEnd,
}: {
  card: Project & { allocationId: string; hours: number; departmentHours: Record<string, number> | null; splitIndex: number; splitTotal: number; splitGroupId: string | null }
  zoom: ZoomLevel
  departments: Department[]
  subprojectNames: string[]
  onRemove: (e: React.MouseEvent) => void
  onSplit: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const isSplit = card.splitTotal > 1
  const splitLabel = isSplit ? `Part ${card.splitIndex} of ${card.splitTotal}` : null

  if (zoom === 'year') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
        onClick={onSplit}
      >
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2 h-2 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className="text-[10px] font-medium text-[#111] truncate">{card.name}</div>
        {subprojectNames.length > 0 && <div className="text-[8px] text-[#9CA3AF] truncate">{subprojectNames.join(', ')}</div>}
        {splitLabel && <div className="text-[8px] font-mono text-[#9CA3AF]">{splitLabel}</div>}
      </div>
    )
  }

  if (zoom === 'half') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
        onClick={onSplit}
      >
        <button
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className="text-[10px] font-medium text-[#111] truncate">{card.name}</div>
        {subprojectNames.length > 0 && <div className="text-[8px] text-[#9CA3AF] truncate">{subprojectNames.join(', ')}</div>}
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-mono tabular-nums text-[#6B7280]">{card.hours}h</span>
          {splitLabel && <span className="text-[8px] font-mono text-[#9CA3AF]">{splitLabel}</span>}
        </div>
      </div>
    )
  }

  // Quarter: full detail
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative"
      onClick={onSplit}
    >
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
      >
        <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
      </button>
      <div className="text-xs font-medium text-[#111] truncate">{card.name}</div>
      {subprojectNames.length > 0 && (
        <div className="text-[10px] text-[#6B7280] mt-0.5">{subprojectNames.join(' · ')}</div>
      )}
      {card.client_name && <div className="text-[9px] text-[#9CA3AF] truncate">{card.client_name}</div>}
      {splitLabel && <div className="text-[9px] font-mono text-[#2563EB] mt-0.5">{splitLabel}</div>}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] font-mono tabular-nums text-[#6B7280]">{card.hours}h</span>
        <span className="text-[10px] font-mono tabular-nums text-[#9CA3AF]">{fmtMoney(card.bid_total)}</span>
      </div>
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
      {!isSplit && (
        <button
          onClick={onSplit}
          className="mt-1.5 text-[9px] text-[#2563EB] hover:text-[#1D4ED8] font-medium transition-colors hidden group-hover:block"
        >
          Split across months
        </button>
      )}
    </div>
  )
}

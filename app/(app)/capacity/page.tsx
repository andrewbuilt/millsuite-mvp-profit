'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight, X, RefreshCw, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { loadProjectDeptHours } from '@/lib/project-hours'
import { loadShopRateSetup, type TeamMember } from '@/lib/shop-rate-setup'
import {
  STAGE_WEIGHT,
  isPipelineStage,
  pipelinePercent,
} from '@/lib/pipeline-weights'
import type { ProjectStage } from '@/lib/types'

interface Department { id: string; name: string; color: string; hours_per_day: number }
interface DeptMember { department_id: string; user_id: string }
interface Project { id: string; name: string; client_name: string | null; stage: ProjectStage; bid_total: number }
interface Subproject { id: string; project_id: string; name: string }
interface DeptAllocation { id: string; subproject_id: string; department_id: string; estimated_hours: number }
interface MonthAllocation { id: string; project_id: string; month_date: string; hours_allocated: number; department_hours: Record<string, number> | null; display_order: number; split_index?: number; split_total?: number; split_group_id?: string; hours_refreshed_at?: string | null; source?: 'auto' | 'manual' }
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
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<ZoomLevel>('year')

  // Drag state: source can be 'unscheduled' or 'month' (moving between months)
  const [dragProjectId, setDragProjectId] = useState<string | null>(null)
  const [dragSourceAllocationId, setDragSourceAllocationId] = useState<string | null>(null)
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null)

  // Side pane state — replaces the legacy split-modal flow. Clicking a
  // project card sets selectedCard; the right-rail pane reads everything
  // it needs off the current monthAllocations array to stay live across
  // loadData() refreshes.
  const [selectedCard, setSelectedCard] = useState<{ projectId: string; allocationId: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Pipeline overlay toggle. ON by default; sticky across reloads via
  // localStorage. Hidden state is local to this page — pipeline weights
  // never persist back into the DB; they're a render-time annotation.
  const [showPipeline, setShowPipeline] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('capacity.showPipeline')
    if (v === '0') setShowPipeline(false)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('capacity.showPipeline', showPipeline ? '1' : '0')
  }, [showPipeline])

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
      shopRateSetup,
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
      // Team roster — needed to resolve PTO names in the per-day flag
      // strip tooltips. orgs.team_members jsonb is the canonical source.
      loadShopRateSetup(org!.id),
    ])
    setDepartments(depts || [])
    setDeptMembers(dm || [])
    setProjects(projs || [])
    setSubprojects(subs || [])
    setDeptAllocations(allocs || [])
    setMonthAllocations(monthAllocs || [])
    setCapacityOverrides((overrides || []) as CapacityOverride[])
    setTeam(shopRateSetup.team)
    setLoading(false)
  }

  // Hours per project come from estimate_lines via loadProjectDeptHours
  // (lib/project-hours.ts). The legacy sources (the subprojects hours
  // column + department_allocations) are stage-locked and silently zero
  // for sold projects, so any drop-from-unscheduled wrote 0h.

  // Member-id → name lookup for the per-day PTO tooltips.
  const memberNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of team) m[t.id] = t.name || 'Team member'
    return m
  }, [team])

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

      // Per-day rollup for the flag strip. Keyed by the YYYY-MM-DD date
      // (override_date is already a date), with the holiday flag + a list
      // of PTO entries (name, hours, reason). Render order is calendar
      // order so the strip reads left-to-right with the month.
      const dayMap = new Map<
        string,
        {
          date: string
          isHoliday: boolean
          holidayReason: string | null
          ptoEntries: Array<{ teamMemberId: string; name: string; hours: number; reason: string }>
        }
      >()
      for (const h of holidays) {
        dayMap.set(h.override_date, {
          date: h.override_date,
          isHoliday: true,
          holidayReason: h.reason || null,
          ptoEntries: dayMap.get(h.override_date)?.ptoEntries || [],
        })
      }
      for (const p of ptos) {
        const cur = dayMap.get(p.override_date) ?? {
          date: p.override_date,
          isHoliday: false,
          holidayReason: null,
          ptoEntries: [],
        }
        const hr = Number(p.hours_reduction) || 0
        cur.ptoEntries.push({
          teamMemberId: p.team_member_id!,
          name: memberNameById[p.team_member_id!] || 'Team member',
          hours: hr > 0 ? hr : DEFAULT_DAY_HOURS,
          reason: p.reason || '',
        })
        dayMap.set(p.override_date, cur)
      }
      const daySummaries = Array.from(dayMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      )

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

      // Pipeline-aware roll-up. Each month tracks two parallel totals:
      //   sold    — hours from sold/production/installed projects (1.0×)
      //   pipeline — raw hours from pipeline projects, plus a weighted
      //              version that scales by STAGE_WEIGHT.
      // The header bar renders sold as the solid utilization, and stacks
      // the weighted-pipeline number on top as a translucent / dashed
      // extension. Lost projects fall through both at weight=0.
      let soldHours = 0
      let pipelineHours = 0
      let weightedPipelineHours = 0
      const deptAllocatedSold: Record<string, number> = {}
      const deptWeightedPipeline: Record<string, number> = {}
      for (const alloc of monthAllocs) {
        const proj = projects.find((p) => p.id === alloc.project_id)
        const stage = (proj?.stage ?? 'sold') as ProjectStage
        const weight = STAGE_WEIGHT[stage] ?? 1
        const isPipe = isPipelineStage(stage)
        const h = Number(alloc.hours_allocated) || 0
        if (isPipe) {
          pipelineHours += h
          weightedPipelineHours += h * weight
          if (alloc.department_hours) {
            for (const [deptId, hrs] of Object.entries(alloc.department_hours)) {
              deptWeightedPipeline[deptId] =
                (deptWeightedPipeline[deptId] || 0) + (hrs as number) * weight
            }
          }
        } else {
          soldHours += h * weight
          if (alloc.department_hours) {
            for (const [deptId, hrs] of Object.entries(alloc.department_hours)) {
              deptAllocatedSold[deptId] =
                (deptAllocatedSold[deptId] || 0) + (hrs as number) * weight
            }
          }
        }
      }

      // Header reads sold-only ("X/Y h · N%") regardless of toggle. When
      // pipeline is on, a "+pipeline N%" line appears beneath. The dept-
      // stacked bar mirrors deptAllocated (sold by default; pipeline
      // overlay rendered as a translucent extension when the toggle is
      // on).
      const totalAllocated = soldHours
      const deptAllocated: Record<string, number> = { ...deptAllocatedSold }

      const utilization = totalCapacity > 0 ? (totalAllocated / totalCapacity) * 100 : 0
      const utilSold = utilization
      const utilWeightedPipelineDelta =
        showPipeline && totalCapacity > 0
          ? (weightedPipelineHours / totalCapacity) * 100
          : 0

      const projectCards = monthAllocs.map((a) => {
        const proj = projects.find((p) => p.id === a.project_id)
        if (!proj) return null
        const stage = (proj.stage ?? 'sold') as ProjectStage
        const weight = STAGE_WEIGHT[stage] ?? 1
        return {
          ...proj,
          allocationId: a.id,
          hours: a.hours_allocated,
          weightedHours: a.hours_allocated * weight,
          stage,
          isPipeline: isPipelineStage(stage),
          stageWeight: weight,
          departmentHours: a.department_hours,
          splitIndex: a.split_index || 0,
          splitTotal: a.split_total || 0,
          splitGroupId: a.split_group_id || null,
          source: (a.source ?? 'manual') as 'auto' | 'manual',
        }
      }).filter(Boolean) as (Project & { allocationId: string; hours: number; weightedHours: number; stage: ProjectStage; isPipeline: boolean; stageWeight: number; departmentHours: Record<string, number> | null; splitIndex: number; splitTotal: number; splitGroupId: string | null; source: 'auto' | 'manual' })[]

      // Pipeline cards hide entirely when the overlay is off (still
      // available in the Unscheduled rail as faded entries).
      const visibleProjectCards = showPipeline
        ? projectCards
        : projectCards.filter((c) => !c.isPipeline)

      return {
        month, label, longLabel,
        totalCapacity, totalAllocated, utilization,
        soldHours, pipelineHours, weightedPipelineHours,
        utilSold, utilWeightedPipelineDelta,
        deptCapacity, deptAllocated, projectCards: visibleProjectCards,
        holidayCount, ptoHours, ptoDayCount, ptoPersonCount,
        workingDays, effectiveWorkingDays,
        daySummaries,
      }
    })
  }, [departments, deptMembers, monthAllocations, capacityOverrides, projects, year, memberNameById, showPipeline])

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
        // distribution from the split — preserve them. Source flips to
        // 'manual' so the auto-seed treats the new placement as pinned.
        const groupAllocs = monthAllocations.filter(a => a.split_group_id === oldAlloc.split_group_id)
        for (const alloc of groupAllocs) {
          const allocDate = new Date(alloc.month_date + 'T00:00:00')
          const newMonth = new Date(allocDate.getFullYear(), allocDate.getMonth() + monthOffset, 1)
          const newMonthStr = `${newMonth.getFullYear()}-${String(newMonth.getMonth() + 1).padStart(2, '0')}-01`
          await supabase
            .from('project_month_allocations')
            .update({ month_date: newMonthStr, source: 'manual' })
            .eq('id', alloc.id)
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
          source: 'manual',
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
        source: 'manual',
      })
    }

    setDragProjectId(null)
    setDragSourceAllocationId(null)
    loadData()
  }

  // Split handler: creates N evenly-divided allocations starting from the
  // current allocation's month. Existing dept_hours distribution is
  // copied across — operator can refresh per-row from estimate via the
  // side pane.
  async function handleSplit(allocationId: string, numMonths: number) {
    if (!org?.id) return
    const oldAlloc = monthAllocations.find((a) => a.id === allocationId)
    if (!oldAlloc) return

    const currentHours = oldAlloc.hours_allocated
    const hoursPerMonth = Math.round(currentHours / numMonths)
    const groupId = crypto.randomUUID()
    const startDate = new Date(oldAlloc.month_date + 'T00:00:00')

    await supabase.from('project_month_allocations').delete().eq('id', allocationId)

    let firstNewId: string | null = null
    for (let i = 0; i < numMonths; i++) {
      const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
      const hrs = i === numMonths - 1 ? currentHours - hoursPerMonth * (numMonths - 1) : hoursPerMonth
      const { data } = await supabase
        .from('project_month_allocations')
        .insert({
          org_id: org.id,
          project_id: oldAlloc.project_id,
          month_date: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`,
          hours_allocated: hrs,
          department_hours: oldAlloc.department_hours,
          split_group_id: groupId,
          split_index: i + 1,
          split_total: numMonths,
          source: 'manual',
        })
        .select('id')
        .single()
      if (i === 0 && data?.id) firstNewId = data.id
    }

    // Re-target the side pane onto the first new row so the operator
    // can immediately edit the split they just created.
    if (firstNewId) {
      setSelectedCard({ projectId: oldAlloc.project_id, allocationId: firstNewId })
    }
    await loadData()
  }

  // Collapse a split group back to a single allocation in the EARLIEST
  // month of the group. Sums the group's hours_allocated, keeps the
  // earliest month_date, deletes the others. Mirrors the schedule's
  // "Merge with adjacent" affordance from PR #95.
  async function handleRemoveSplit(allocationId: string) {
    if (!org?.id) return
    const alloc = monthAllocations.find((a) => a.id === allocationId)
    if (!alloc?.split_group_id) return
    const groupAllocs = monthAllocations
      .filter((a) => a.split_group_id === alloc.split_group_id)
      .sort((a, b) => a.month_date.localeCompare(b.month_date))
    if (groupAllocs.length < 2) return
    const survivor = groupAllocs[0]
    const totalHours = groupAllocs.reduce((s, a) => s + (a.hours_allocated || 0), 0)
    await supabase
      .from('project_month_allocations')
      .update({
        hours_allocated: totalHours,
        split_group_id: null,
        split_index: null,
        split_total: null,
        source: 'manual',
      })
      .eq('id', survivor.id)
    const toDelete = groupAllocs.filter((a) => a.id !== survivor.id).map((a) => a.id)
    if (toDelete.length > 0) {
      await supabase.from('project_month_allocations').delete().in('id', toDelete)
    }
    setSelectedCard({ projectId: alloc.project_id, allocationId: survivor.id })
    await loadData()
  }

  // Flip an auto row to manual without changing its placement. Used
  // from the side pane's "Pin to this month" button to declare an
  // operator's intent that this row should not be re-rolled by the
  // auto-seed pass.
  async function pinAllocation(allocationId: string) {
    if (!org?.id) return
    await supabase
      .from('project_month_allocations')
      .update({ source: 'manual' })
      .eq('id', allocationId)
    await loadData()
  }

  // Pull current hours from estimate_lines (canonical truth) and push
  // them onto this allocation row. Stamps hours_refreshed_at so the
  // side pane can show "Last refreshed: X". Useful when the estimate
  // changes after a project was placed and the operator wants to bring
  // the calendar in line without re-dropping.
  async function refreshAllocationHours(allocationId: string, projectId: string) {
    if (!org?.id) return
    setRefreshing(true)
    try {
      const fresh = await loadProjectDeptHours(org.id, projectId)
      await supabase
        .from('project_month_allocations')
        .update({
          hours_allocated: fresh.totalHours,
          department_hours:
            Object.keys(fresh.deptHours).length > 0 ? fresh.deptHours : null,
          hours_refreshed_at: new Date().toISOString(),
        })
        .eq('id', allocationId)
      await loadData()
    } finally {
      setRefreshing(false)
    }
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
          {/* Pipeline overlay toggle. Default ON; sticky via localStorage.
              When OFF, pipeline cards hide from the calendar and the
              utilization math reverts to sold-only. */}
          <button
            onClick={() => setShowPipeline((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              showPipeline
                ? 'bg-[#EDE9FE] text-[#5B21B6] border border-[#C4B5FD]'
                : 'bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]'
            }`}
            title="Toggle the pipeline overlay (probability-weighted hours from new_lead / 50/50 / 90% projects)"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${showPipeline ? 'bg-[#7C3AED]' : 'bg-[#9CA3AF]'}`} />
            Pipeline {showPipeline ? 'on' : 'off'}
          </button>
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
                      {/* Utilization bar — solid sold portion + dashed
                          weighted-pipeline extension. The extension only
                          renders when the toggle is on AND there's pipeline
                          to show; total visible width clamps at 100%. */}
                      <div className={`bg-[#E5E7EB] rounded-full overflow-hidden flex ${zoom === 'quarter' ? 'h-2 mt-2' : 'h-1 mt-1'}`}>
                        <div
                          className={`h-full ${m.utilization > 100 ? 'bg-[#DC2626]' : m.utilization > 80 ? 'bg-[#F59E0B]' : 'bg-[#2563EB]'}`}
                          style={{ width: `${Math.min(m.utilization, 100)}%` }}
                        />
                        {m.utilWeightedPipelineDelta > 0 && (
                          <div
                            className={`h-full ${
                              m.utilSold + m.utilWeightedPipelineDelta > 100
                                ? 'bg-[#DC2626]/40'
                                : m.utilSold + m.utilWeightedPipelineDelta > 80
                                  ? 'bg-[#F59E0B]/40'
                                  : 'bg-[#2563EB]/40'
                            }`}
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(m.utilWeightedPipelineDelta, 100 - Math.min(m.utilSold, 100)),
                              )}%`,
                              backgroundImage:
                                'repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 4px)',
                            }}
                          />
                        )}
                      </div>
                      <div className={`font-mono tabular-nums font-medium mt-0.5 ${
                        zoom === 'quarter' ? 'text-xs' : 'text-[9px]'
                      } ${
                        m.utilization > 100 ? 'text-[#DC2626]' : m.utilization > 80 ? 'text-[#F59E0B]' : 'text-[#6B7280]'
                      }`}>{Math.round(m.utilization)}%</div>

                      {/* +pipeline N% — additional weighted utilization
                          if the pipeline projects in this month land. */}
                      {m.utilWeightedPipelineDelta > 0 && (
                        <div
                          title={`${Math.round(m.weightedPipelineHours)}h weighted pipeline (${Math.round(m.pipelineHours)}h raw). Total weighted util: ${Math.round(m.utilSold + m.utilWeightedPipelineDelta)}%.`}
                          className={`font-mono tabular-nums mt-0.5 ${zoom === 'quarter' ? 'text-[11px]' : 'text-[9px]'} ${
                            m.utilSold + m.utilWeightedPipelineDelta > 100
                              ? 'text-[#F87171]'
                              : m.utilSold + m.utilWeightedPipelineDelta > 80
                                ? 'text-[#FBBF24]'
                                : 'text-[#7C3AED]'
                          }`}
                        >
                          +pipeline {Math.round(m.utilWeightedPipelineDelta)}%
                        </div>
                      )}

                      {/* Holiday + PTO summary chips. Compact rollup that
                          stays even at year zoom. The per-day flag strip
                          below carries the granular detail. */}
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

                    {/* Per-day flag strip — one chip per day in the month
                        with a holiday or PTO override. */}
                    <MonthOverrideFlags
                      daySummaries={m.daySummaries}
                      zoom={zoom}
                    />

                    {/* Dept-stacked bar — visualizes how this month's
                        sold hours split across departments. Hidden when
                        nothing is allocated yet. */}
                    <DeptStackedBar
                      deptHours={m.deptAllocated}
                      totalHours={m.totalAllocated}
                      departments={departments}
                      zoom={zoom}
                    />

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
                          onSelect={() =>
                            setSelectedCard({ projectId: card.id, allocationId: card.allocationId })
                          }
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

      {/* Side pane — replaces the legacy split-modal flow. Slides in from
          the right; backdrop click dismisses. Renders nothing when no
          card is selected so the rest of the layout stays untouched. */}
      {selectedCard && (() => {
        const alloc = monthAllocations.find((a) => a.id === selectedCard.allocationId)
        const proj = projects.find((p) => p.id === selectedCard.projectId)
        if (!alloc || !proj) return null
        const groupAllocs = alloc.split_group_id
          ? monthAllocations
              .filter((a) => a.split_group_id === alloc.split_group_id)
              .sort((a, b) => a.month_date.localeCompare(b.month_date))
          : null
        return (
          <ProjectSidePane
            project={proj}
            allocation={alloc}
            groupAllocations={groupAllocs}
            departments={departments}
            refreshing={refreshing}
            onClose={() => setSelectedCard(null)}
            onSplit={(n) => handleSplit(alloc.id, n)}
            onRemoveSplit={() => handleRemoveSplit(alloc.id)}
            onRefresh={() => refreshAllocationHours(alloc.id, alloc.project_id)}
            onPin={() => pinAllocation(alloc.id)}
          />
        )
      })()}
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
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  card: Project & { allocationId: string; hours: number; weightedHours: number; stage: ProjectStage; isPipeline: boolean; stageWeight: number; departmentHours: Record<string, number> | null; splitIndex: number; splitTotal: number; splitGroupId: string | null; source: 'auto' | 'manual' }
  zoom: ZoomLevel
  departments: Department[]
  subprojectNames: string[]
  onRemove: (e: React.MouseEvent) => void
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const isSplit = card.splitTotal > 1
  const splitLabel = isSplit ? `Part ${card.splitIndex} of ${card.splitTotal}` : null

  const isAuto = card.source === 'auto'
  const autoBadge = isAuto ? (
    <span
      title="Placed automatically from schedule. Drag or pin to override."
      className="absolute top-0.5 left-0.5 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-[#1E40AF] bg-[#DBEAFE] border border-[#BFDBFE] rounded"
    >
      auto
    </span>
  ) : null

  // Pipeline visual layer — dashed border + reduced opacity + a stage
  // pill in the top-right showing the close-probability percent. Sold /
  // production / installed cards get the today's solid look.
  const isPipeline = card.isPipeline
  const stagePct = pipelinePercent(card.stage)
  const cardBorderClass = isPipeline
    ? 'border-2 border-dashed border-[#9CA3AF]'
    : 'border border-[#E5E7EB]'
  const cardOpacityClass = isPipeline ? 'opacity-90' : ''
  const pipelineBadge =
    isPipeline && stagePct != null ? (
      <span
        title={`Pipeline · weighted at ${stagePct}%`}
        className="absolute top-0.5 right-0.5 px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-[#5B21B6] bg-[#EDE9FE] border border-[#C4B5FD] rounded font-mono tabular-nums"
      >
        {stagePct}%
      </span>
    ) : null
  const weightedHoursLine = isPipeline
    ? `${Math.round(card.hours)}h · ${Math.round(card.weightedHours)}h weighted (${stagePct}%)`
    : `${Math.round(card.hours)}h`
  const namePadRight = isPipeline ? 'pr-9' : ''

  if (zoom === 'year') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`bg-white ${cardBorderClass} ${cardOpacityClass} rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative`}
        onClick={onSelect}
      >
        {autoBadge}
        {pipelineBadge}
        <button
          onClick={onRemove}
          className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2 h-2 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className={`text-[10px] font-medium text-[#111] truncate ${isAuto ? 'pl-7' : ''} ${namePadRight}`}>{card.name}</div>
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
        className={`bg-white ${cardBorderClass} ${cardOpacityClass} rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative`}
        onClick={onSelect}
      >
        {autoBadge}
        {pipelineBadge}
        <button
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
        >
          <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
        </button>
        <div className={`text-[10px] font-medium text-[#111] truncate ${isAuto ? 'pl-7' : ''} ${namePadRight}`}>{card.name}</div>
        {subprojectNames.length > 0 && <div className="text-[8px] text-[#9CA3AF] truncate">{subprojectNames.join(', ')}</div>}
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-mono tabular-nums text-[#6B7280]">{weightedHoursLine}</span>
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
      className={`bg-white ${cardBorderClass} ${cardOpacityClass} rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing hover:border-[#D1D5DB] transition-colors group relative`}
      onClick={onSelect}
    >
      {autoBadge}
      {pipelineBadge}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
      >
        <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
      </button>
      <div className={`text-xs font-medium text-[#111] truncate ${isAuto ? 'pl-8' : ''} ${namePadRight}`}>{card.name}</div>
      {subprojectNames.length > 0 && (
        <div className="text-[10px] text-[#6B7280] mt-0.5">{subprojectNames.join(' · ')}</div>
      )}
      {card.client_name && <div className="text-[9px] text-[#9CA3AF] truncate">{card.client_name}</div>}
      {splitLabel && <div className="text-[9px] font-mono text-[#2563EB] mt-0.5">{splitLabel}</div>}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] font-mono tabular-nums text-[#6B7280]">{weightedHoursLine}</span>
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
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
          className="mt-1.5 text-[9px] text-[#2563EB] hover:text-[#1D4ED8] font-medium transition-colors hidden group-hover:block"
        >
          Open details
        </button>
      )}
    </div>
  )
}

// --------------------------------------------------
// MonthOverrideFlags — per-day chip strip
// --------------------------------------------------
// One chip per day with a holiday or PTO override. Holidays render with a
// red bg/border + 🏛; PTO days render amber + 🏖 with an ×N count when
// multiple people are off. Tooltip surfaces the day's reason and the
// people on PTO. Renders nothing when daySummaries is empty so the month
// card stays compact for clear months.
function MonthOverrideFlags({
  daySummaries,
  zoom,
}: {
  daySummaries: Array<{
    date: string
    isHoliday: boolean
    holidayReason: string | null
    ptoEntries: Array<{ teamMemberId: string; name: string; hours: number; reason: string }>
  }>
  zoom: ZoomLevel
}) {
  if (daySummaries.length === 0) return null
  const dayNum = (iso: string) => Number(iso.slice(8, 10))
  return (
    <div className={`flex flex-wrap gap-1 ${zoom === 'quarter' ? 'px-3 mb-2' : 'px-1.5 mb-1.5'}`}>
      {daySummaries.map((d) => {
        if (d.isHoliday) {
          return (
            <span
              key={d.date}
              title={`Company holiday — ${d.holidayReason || d.date}`}
              className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-[#FEE2E2] border border-[#FCA5A5] text-[#991B1B] text-[9px] font-mono tabular-nums whitespace-nowrap"
            >
              <span aria-hidden>🏛</span>
              <span>{dayNum(d.date)}</span>
            </span>
          )
        }
        const count = d.ptoEntries.length
        const namesPreview = d.ptoEntries
          .slice(0, 4)
          .map((e) => e.name)
          .join(', ')
        const more = count > 4 ? ` +${count - 4}` : ''
        const title = `${count} on PTO: ${namesPreview}${more}`
        return (
          <span
            key={d.date}
            title={title}
            className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] text-[9px] font-mono tabular-nums whitespace-nowrap"
          >
            <span aria-hidden>🏖</span>
            <span>{dayNum(d.date)}</span>
            {count > 1 && <span className="text-[#B45309]">×{count}</span>}
          </span>
        )
      })}
    </div>
  )
}

// --------------------------------------------------
// DeptStackedBar — proportional dept-color split
// --------------------------------------------------
// 3px-tall bar showing how the month's sold hours split across depts.
// Each segment widthed by hours/totalHours, colored by dept.color. Hidden
// when totalHours === 0. Sits between the per-day flag strip and the
// dept progress rows; gives a one-glance read of the dept mix.
function DeptStackedBar({
  deptHours,
  totalHours,
  departments,
  zoom,
}: {
  deptHours: Record<string, number>
  totalHours: number
  departments: Department[]
  zoom: ZoomLevel
}) {
  if (totalHours <= 0) return null
  return (
    <div
      className={`flex h-[3px] rounded-full overflow-hidden bg-[#E5E7EB] ${
        zoom === 'quarter' ? 'mx-3 mb-2' : 'mx-1.5 mb-1.5'
      }`}
      title={`${Math.round(totalHours)}h allocated this month`}
    >
      {departments.map((d) => {
        const hrs = deptHours[d.id] || 0
        if (hrs <= 0) return null
        const pct = (hrs / totalHours) * 100
        return (
          <div
            key={d.id}
            style={{ width: `${pct}%`, background: d.color }}
            title={`${d.name}: ${Math.round(hrs)}h`}
          />
        )
      })}
    </div>
  )
}

// --------------------------------------------------
// ProjectSidePane — right-rail allocation editor
// --------------------------------------------------
// Replaces the legacy split-modal flow with a richer pane: project
// context, per-dept hour breakdown, current placement, and four actions
// (split N months / remove split / refresh hours / open project). Slides
// in from the right; backdrop click dismisses.
function ProjectSidePane({
  project,
  allocation,
  groupAllocations,
  departments,
  refreshing,
  onClose,
  onSplit,
  onRemoveSplit,
  onRefresh,
  onPin,
}: {
  project: Project
  allocation: MonthAllocation
  groupAllocations: MonthAllocation[] | null
  departments: Department[]
  refreshing: boolean
  onClose: () => void
  onSplit: (n: number) => void
  onRemoveSplit: () => void
  onRefresh: () => void
  onPin: () => void
}) {
  const isSplit = !!groupAllocations && groupAllocations.length > 1
  const isAuto = (allocation.source ?? 'manual') === 'auto'
  const stage = (project.stage ?? 'sold') as ProjectStage
  const isPipe = isPipelineStage(stage)
  const stagePct = pipelinePercent(stage)
  const hours = allocation.hours_allocated
  const monthLabel = (iso: string) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  const placement = isSplit
    ? (() => {
        const first = monthLabel(groupAllocations![0].month_date)
        const last = monthLabel(groupAllocations![groupAllocations!.length - 1].month_date)
        return `${first.replace(' ' + new Date().getFullYear(), '')} – ${last} (split into ${groupAllocations!.length})`
      })()
    : monthLabel(allocation.month_date)
  const refreshedLabel = allocation.hours_refreshed_at
    ? new Date(allocation.hours_refreshed_at).toLocaleString()
    : null
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.18)' }}
        onClick={onClose}
      />
      {/* Pane */}
      <div className="fixed top-0 right-0 z-50 h-full w-[380px] bg-white border-l border-[#E5E7EB] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">
              Project allocation
            </div>
            <div className="text-base font-semibold text-[#111] truncate">{project.name}</div>
            {project.client_name && (
              <div className="text-xs text-[#6B7280] truncate">{project.client_name}</div>
            )}
            <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
              {fmtMoney(project.bid_total)} bid
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#9CA3AF] hover:text-[#111] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Hours rollup */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                Hours allocated
              </div>
              <div className="text-sm font-semibold font-mono tabular-nums text-[#111]">
                {Math.round(hours)}h
              </div>
            </div>
            {allocation.department_hours &&
              Object.keys(allocation.department_hours).length > 0 && (
                <div className="space-y-1.5">
                  {departments.map((d) => {
                    const hrs = allocation.department_hours?.[d.id] ?? 0
                    if (!hrs) return null
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 text-[12px] text-[#374151]"
                      >
                        <div
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: d.color }}
                        />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="font-mono tabular-nums text-[#6B7280]">
                          {Math.round(hrs)}h
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            {isPipe && stagePct != null && (
              <div className="mt-2 px-2.5 py-1.5 bg-[#EDE9FE] border border-[#C4B5FD] rounded-md text-[11px] text-[#5B21B6]">
                Pipeline · weighted at {stagePct}% (
                {Math.round(hours * (stagePct / 100))}h counts toward util)
              </div>
            )}
          </div>

          {/* Placement */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
              Placement
            </div>
            <div className="text-sm text-[#111]">{placement}</div>
            {isSplit && (
              <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                Part {allocation.split_index} of {allocation.split_total}
              </div>
            )}
          </div>

          {/* Auto-placement note + pin */}
          {isAuto && (
            <div className="px-3 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-md">
              <div className="text-[11px] font-semibold text-[#1E40AF] mb-0.5">
                Placed automatically from schedule
              </div>
              <p className="text-[11px] text-[#374151] leading-snug mb-2">
                The schedule timeline drives this row. Re-scheduling this
                project will rewrite it. Pin to keep it where it is.
              </p>
              <button
                onClick={onPin}
                className="px-2.5 py-1 text-[11.5px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8]"
              >
                Pin to this month
              </button>
            </div>
          )}

          {/* Split */}
          {!isSplit && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
                Split across months
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => onSplit(n)}
                    className="px-2 py-2 text-[12px] font-medium text-[#111] bg-[#F9FAFB] border border-[#E5E7EB] rounded-md hover:bg-[#EFF6FF] hover:border-[#2563EB] transition-colors"
                  >
                    <div className="font-semibold">{n} months</div>
                    <div className="text-[10px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
                      ~{Math.round(hours / n)}h/mo
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Remove split */}
          {isSplit && (
            <div>
              <button
                onClick={onRemoveSplit}
                className="w-full px-3 py-2 text-[12px] font-medium text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-md hover:bg-[#FEE2E2] transition-colors"
              >
                Remove split
              </button>
              <div className="text-[10px] text-[#9CA3AF] mt-1.5 leading-snug">
                Collapses all parts back to the earliest month with summed
                hours.
              </div>
            </div>
          )}

          {/* Refresh hours */}
          <div>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium text-[#1E40AF] bg-[#EFF6FF] border border-[#DBEAFE] rounded-md hover:bg-[#DBEAFE] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh hours from estimate'}
            </button>
            {refreshedLabel ? (
              <div className="text-[10px] text-[#9CA3AF] mt-1.5">
                Last refreshed: {refreshedLabel}
              </div>
            ) : (
              <div className="text-[10px] text-[#9CA3AF] mt-1.5 leading-snug">
                Hours froze at drop-time. Refresh to pull current estimate
                totals from estimate_lines.
              </div>
            )}
          </div>

          {/* Open project */}
          <div className="pt-3 border-t border-[#F3F4F6]">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#2563EB] hover:text-[#1D4ED8]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open project
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

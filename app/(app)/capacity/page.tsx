'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight, X, RefreshCw, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { loadProjectDeptHours } from '@/lib/project-hours'
import { loadShopRateSetup, deptDailyHoursByTeam, type TeamMember } from '@/lib/shop-rate-setup'

interface Department { id: string; name: string; color: string; hours_per_day: number }
interface Project { id: string; name: string; client_name: string | null; stage: string; bid_total: number }
interface Subproject { id: string; project_id: string; name: string }
interface DeptAllocation { id: string; subproject_id: string; department_id: string; estimated_hours: number }
interface MonthAllocation { id: string; project_id: string; month_date: string; hours_allocated: number; department_hours: Record<string, number> | null; display_order: number; split_index?: number; split_total?: number; split_group_id?: string; hours_refreshed_at?: string | null }
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

// Production sequence used by "Smart" split (ported from Built OS). Each phase
// groups sequential trades so a split month carries a coherent stage of the
// build (Eng+CNC → Assembly+Finish → Install) instead of an even hours slice.
// Departments are matched by normalized name; department_hours on
// project_month_allocations is keyed by dept id, so handleSplit maps these
// names → ids at split time. Falls back to the 2-part sequence for any part
// count not listed.
const SMART_SPLIT_SEQUENCE: Record<number, string[][]> = {
  2: [['engineering', 'cnc', 'assembly'], ['finish', 'install']],
  3: [['engineering', 'cnc'], ['assembly', 'finish'], ['install']],
  4: [['engineering'], ['cnc', 'assembly'], ['finish'], ['install']],
}

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

function fmtMoney(n: number) { return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }

// Rolling-window helpers. The window is 12 fixed-width month columns; the
// leftmost is `windowStart` (a first-of-month Date) and it runs that month
// + the next 11. Arrows page ±1 month.
const WINDOW_MONTHS = 12
function firstOfThisMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

// Pre-sale pipeline stages. Everything else the page loads (sold /
// production / installed) is "sold" work. The toggle decides whether
// pipeline rows count toward the calendar.
const PIPELINE_STAGES = ['new_lead', 'fifty_fifty', 'ninety_percent']
function isPipelineStage(stage: string): boolean {
  return PIPELINE_STAGES.includes(stage)
}
function pipelineStageLabel(stage: string): string {
  if (stage === 'new_lead') return 'Lead'
  if (stage === 'fifty_fifty') return '50/50'
  if (stage === 'ninety_percent') return '90%'
  return stage
}

// Sentinel utilization for a month with allocated hours but zero capacity —
// keeps it firmly in the "over" band instead of a healthy-looking 0%.
const OVER_UTIL = 999

// Utilization heat color: green <80% / amber 80–100% / red >100%.
function utilColor(util: number): string {
  if (util > 100) return '#DC2626'
  if (util >= 80) return '#F59E0B'
  return '#16A34A'
}

// Heat color that accounts for the no-capacity case: a month with no
// configured capacity is neutral gray when empty (not a healthy green) and
// red once anything is allocated against it.
function monthHeatColor(hasCapacity: boolean, allocated: number, util: number): string {
  if (!hasCapacity) return allocated > 0 ? '#DC2626' : '#D1D5DB'
  return utilColor(util)
}

// Tooltip for the quiet PTO/holiday line: one dated row per override day,
// listing the holiday name or the people on PTO.
function overrideTooltip(
  daySummaries: Array<{
    date: string
    isHoliday: boolean
    holidayReason: string | null
    ptoEntries: Array<{ name: string }>
  }>,
): string {
  const fmt = (iso: string) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const lines: string[] = []
  for (const d of daySummaries) {
    if (d.isHoliday) lines.push(`${fmt(d.date)} — ${d.holidayReason || 'Holiday'}`)
    if (d.ptoEntries.length > 0)
      lines.push(`${fmt(d.date)} — ${d.ptoEntries.map((e) => e.name).join(', ')} (PTO)`)
  }
  return lines.join('\n')
}

export default function CapacityPage() {
  return (
    <>
      <PlanGate requires="capacity">
        <CapacityContent />
      </PlanGate>
    </>
  )
}

function CapacityContent() {
  const { org } = useAuth()
  const router = useRouter()
  const [windowStart, setWindowStart] = useState<Date>(() => firstOfThisMonth())
  // Pipeline toggle: false = "Sold only" (default), true = "Sold + pipeline".
  const [showPipeline, setShowPipeline] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [deptAllocations, setDeptAllocations] = useState<DeptAllocation[]>([])
  const [monthAllocations, setMonthAllocations] = useState<MonthAllocation[]>([])
  const [capacityOverrides, setCapacityOverrides] = useState<CapacityOverride[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  // Org default hrs/week — members without an explicit hours_per_week
  // inherit it for the per-dept capacity math.
  const [orgHrsPerWeek, setOrgHrsPerWeek] = useState(40)
  const [loading, setLoading] = useState(true)

  // Drag state: source can be 'unscheduled' or 'month' (moving between months)
  const [dragProjectId, setDragProjectId] = useState<string | null>(null)
  const [dragSourceAllocationId, setDragSourceAllocationId] = useState<string | null>(null)
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null)
  const [dragOverTray, setDragOverTray] = useState(false)

  // Side pane state — replaces the legacy split-modal flow. Clicking a
  // project card sets selectedCard; the right-rail pane reads everything
  // it needs off the current monthAllocations array to stay live across
  // loadData() refreshes.
  const [selectedCard, setSelectedCard] = useState<{ projectId: string; allocationId: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { if (org?.id) loadData() }, [org?.id, windowStart])

  async function loadData() {
    setLoading(true)
    // Rolling window bounds: leftmost month through the 12th month. Month
    // allocation rows are always first-of-month, so lte the last month's
    // first day catches it; overrides can fall on any day, so bound them
    // by the last calendar day of the final month.
    const startISO = `${ymOf(windowStart)}-01`
    const endMonth = addMonths(windowStart, WINDOW_MONTHS - 1)
    const endMonthFirstISO = `${ymOf(endMonth)}-01`
    const lastDay = new Date(endMonth.getFullYear(), endMonth.getMonth() + 1, 0).getDate()
    const endMonthLastISO = `${ymOf(endMonth)}-${String(lastDay).padStart(2, '0')}`
    const [
      { data: depts },
      { data: projs },
      { data: subs },
      { data: allocs },
      { data: monthAllocs },
      { data: overrides },
      shopRateSetup,
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('org_id', org!.id).eq('active', true).order('display_order'),
      supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total')
        .eq('org_id', org!.id)
        .in('stage', ['new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'production', 'installed']),
      supabase.from('subprojects').select('id, project_id, name').eq('org_id', org!.id),
      supabase.from('department_allocations').select('id, subproject_id, department_id, estimated_hours').eq('org_id', org!.id),
      supabase.from('project_month_allocations').select('*').eq('org_id', org!.id).gte('month_date', startISO).lte('month_date', endMonthFirstISO),
      supabase
        .from('capacity_overrides')
        .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
        .eq('org_id', org!.id)
        .gte('override_date', startISO)
        .lte('override_date', endMonthLastISO),
      // Team roster — the canonical source (orgs.team_members jsonb) for
      // both PTO-name tooltips and per-dept headcount (dept_assignments).
      loadShopRateSetup(org!.id),
    ])
    setDepartments(depts || [])
    setProjects(projs || [])
    setSubprojects(subs || [])
    setDeptAllocations(allocs || [])
    setMonthAllocations(monthAllocs || [])
    setCapacityOverrides((overrides || []) as CapacityOverride[])
    setTeam(shopRateSetup.team)
    setOrgHrsPerWeek(Number(shopRateSetup.billable?.hrs_per_week) || 40)
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

  // Per-dept daily capacity hours from orgs.team_members (the single source
  // shared with /team + /schedule). Each active billable member contributes
  // their per-day hours (hours_per_week / 5, inheriting the org default) to
  // every dept in their dept_assignments. Replaces the legacy dept-members
  // join table, which /team stopped writing in the shop-rate PR — reading
  // it left every month at 0h capacity.
  const dailyHoursByDept = useMemo(
    () => deptDailyHoursByTeam(team, orgHrsPerWeek),
    [team, orgHrsPerWeek],
  )

  // Capacity per department per month — one entry per column in the rolling
  // 12-month window, starting at windowStart (spans the year boundary).
  const months = useMemo(() => {
    return Array.from({ length: WINDOW_MONTHS }, (_, i) => {
      const d = addMonths(windowStart, i)
      const y = d.getFullYear()
      const mIdx = d.getMonth()
      const month = ymOf(d)
      const label = d.toLocaleDateString('en-US', { month: 'short' })
      const longLabel = d.toLocaleDateString('en-US', { month: 'long' })
      const showYear = mIdx === 0 || i === 0
      const workingDays = weekdaysInMonth(y, mIdx)

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
        // Per-day capacity hours contributed by the dept's members
        // (hours_per_week / 5 each). Supersedes the old
        // headcount × dept.hours_per_day; a 40h/wk member = 8h/day, so
        // seeded 8h/day depts are unchanged.
        const deptDailyHours = dailyHoursByDept[dept.id] || 0
        const deptHolidayCount = holidays.filter(
          (h) => h.department_id == null || h.department_id === dept.id,
        ).length
        const effectiveDays = Math.max(0, workingDays - deptHolidayCount)
        const cap = deptDailyHours * effectiveDays
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

      // Allocations for this month, joined to their project so we can
      // partition sold vs pipeline. When the pipeline toggle is off,
      // pipeline rows are dropped from every read (hours, bars, cards) —
      // the DB rows persist, they just don't count.
      const monthAllocs = monthAllocations
        .filter((a) => a.month_date.startsWith(month))
        .map((a) => ({ alloc: a, proj: projects.find((p) => p.id === a.project_id) }))
        .filter((x) => !!x.proj) as Array<{ alloc: MonthAllocation; proj: Project }>

      const visibleAllocs = monthAllocs.filter(
        (x) => showPipeline || !isPipelineStage(x.proj.stage),
      )

      // Sold vs pipeline hour totals — feed the two-segment utilization bar.
      let soldAllocated = 0
      let pipelineAllocated = 0
      const deptAllocated: Record<string, number> = {}
      for (const { alloc, proj } of visibleAllocs) {
        if (isPipelineStage(proj.stage)) pipelineAllocated += alloc.hours_allocated
        else soldAllocated += alloc.hours_allocated
        if (alloc.department_hours) {
          for (const [deptId, hrs] of Object.entries(alloc.department_hours)) {
            deptAllocated[deptId] = (deptAllocated[deptId] || 0) + (hrs as number)
          }
        }
      }
      const totalAllocated = soldAllocated + pipelineAllocated
      const hasCapacity = totalCapacity > 0

      // With zero capacity, a naive ratio would read 0% (looks healthy).
      // Instead: any allocated hours against no capacity is "over" (OVER_UTIL
      // sentinel) so the heat strip, staffing signal, and next-opening all
      // treat it as a red month; no hours = 0 (a genuinely empty month).
      const utilFor = (hrs: number) =>
        hasCapacity ? (hrs / totalCapacity) * 100 : hrs > 0 ? OVER_UTIL : 0
      const utilization = utilFor(totalAllocated)
      const soldUtil = utilFor(soldAllocated)
      const pipelineUtil = utilFor(pipelineAllocated)

      const projectCards = visibleAllocs.map(({ alloc: a, proj }) => ({
        ...proj,
        allocationId: a.id,
        hours: a.hours_allocated,
        departmentHours: a.department_hours,
        splitIndex: a.split_index || 0,
        splitTotal: a.split_total || 0,
        splitGroupId: a.split_group_id || null,
      }))

      return {
        month, label, longLabel, showYear, year: y,
        totalCapacity, totalAllocated, utilization, hasCapacity,
        soldAllocated, pipelineAllocated, soldUtil, pipelineUtil,
        deptCapacity, deptAllocated, projectCards,
        holidayCount, ptoHours, ptoDayCount, ptoPersonCount,
        workingDays, effectiveWorkingDays,
        daySummaries,
      }
    })
  }, [departments, dailyHoursByDept, monthAllocations, capacityOverrides, projects, windowStart, showPipeline, memberNameById])

  // Unscheduled projects (not in any month). Pipeline-stage projects only
  // appear in the tray when the toggle is on — so they're only draggable
  // onto months while pipeline is being counted.
  const scheduledProjectIds = new Set(monthAllocations.map(a => a.project_id))
  const unscheduled = projects.filter(
    p => !scheduledProjectIds.has(p.id) && (showPipeline || !isPipelineStage(p.stage)),
  )

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
          await supabase
            .from('project_month_allocations')
            .update({ month_date: newMonthStr })
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

  // Split handler: creates N evenly-divided allocations starting from the
  // current allocation's month. Existing dept_hours distribution is
  // copied across — operator can refresh per-row from estimate via the
  // side pane.
  async function handleSplit(
    allocationId: string,
    numMonths: number,
    mode: 'even' | 'smart' = 'even',
  ) {
    if (!org?.id) return
    const oldAlloc = monthAllocations.find((a) => a.id === allocationId)
    if (!oldAlloc) return

    const currentHours = oldAlloc.hours_allocated
    const hoursPerMonth = Math.round(currentHours / numMonths)
    const groupId = crypto.randomUUID()
    const startDate = new Date(oldAlloc.month_date + 'T00:00:00')

    // Smart mode partitions the project by production sequence: each split
    // month gets a coherent phase of departments instead of an even hours
    // slice. Needs a per-dept breakdown to partition; falls back to even
    // when department_hours is absent.
    const deptHours = oldAlloc.department_hours
    const useSmart =
      mode === 'smart' && !!deptHours && Object.keys(deptHours).length > 0

    // Normalized dept name → dept id, so the name-keyed sequence can address
    // the id-keyed department_hours map.
    const idByName: Record<string, string> = {}
    for (const d of departments) idByName[d.name.trim().toLowerCase()] = d.id

    let smartPhases: Array<{ hours: number; deptHours: Record<string, number> }> = []
    if (useSmart) {
      const sequence = SMART_SPLIT_SEQUENCE[numMonths] || SMART_SPLIT_SEQUENCE[2]
      const assigned = new Set<string>()
      smartPhases = sequence.map((phaseNames) => {
        const ph: Record<string, number> = {}
        let total = 0
        for (const name of phaseNames) {
          const id = idByName[name]
          if (!id) continue
          const h = Number(deptHours![id]) || 0
          if (h > 0) {
            ph[id] = Math.round(h)
            total += h
            assigned.add(id)
          }
        }
        return { hours: Math.round(total), deptHours: ph }
      })
      // Fold any dept hours not covered by the sequence (non-standard dept
      // names) into the last phase so no hours are lost.
      const leftover = Object.entries(deptHours!).filter(([id]) => !assigned.has(id))
      if (leftover.length > 0 && smartPhases.length > 0) {
        const last = smartPhases[smartPhases.length - 1]
        for (const [id, h] of leftover) {
          const hr = Math.round(Number(h) || 0)
          if (hr > 0) {
            last.deptHours[id] = (last.deptHours[id] || 0) + hr
            last.hours += hr
          }
        }
      }
    }

    await supabase.from('project_month_allocations').delete().eq('id', allocationId)

    let firstNewId: string | null = null
    for (let i = 0; i < numMonths; i++) {
      const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
      const evenHrs =
        i === numMonths - 1 ? currentHours - hoursPerMonth * (numMonths - 1) : hoursPerMonth
      const hrs = useSmart ? smartPhases[i]?.hours ?? 0 : evenHrs
      const deptHrs = useSmart ? smartPhases[i]?.deptHours ?? {} : oldAlloc.department_hours
      const { data } = await supabase
        .from('project_month_allocations')
        .insert({
          org_id: org.id,
          project_id: oldAlloc.project_id,
          month_date: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`,
          hours_allocated: hrs,
          department_hours: deptHrs,
          split_group_id: groupId,
          split_index: i + 1,
          split_total: numMonths,
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
      })
      .eq('id', survivor.id)
    const toDelete = groupAllocs.filter((a) => a.id !== survivor.id).map((a) => a.id)
    if (toDelete.length > 0) {
      await supabase.from('project_month_allocations').delete().in('id', toDelete)
    }
    setSelectedCard({ projectId: alloc.project_id, allocationId: survivor.id })
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

  // Drop onto the unscheduled tray = unschedule. Only acts on cards dragged
  // out of a month (dragSourceAllocationId set); tray-origin drags no-op.
  async function handleDropToTray() {
    setDragOverTray(false)
    if (dragSourceAllocationId) {
      await supabase.from('project_month_allocations').delete().eq('id', dragSourceAllocationId)
      if (selectedCard?.allocationId === dragSourceAllocationId) setSelectedCard(null)
      loadData()
    }
    setDragProjectId(null)
    setDragSourceAllocationId(null)
  }

  // Scroll a month column into view when its heat cell is clicked.
  function scrollToMonth(month: string) {
    if (typeof document === 'undefined') return
    document
      .getElementById(`cap-col-${month}`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
  }

  // Header planning stats, derived from the rolling window.
  const totalCap12 = months.reduce((s, m) => s + m.totalCapacity, 0)
  // Booked = committed (sold) hours only, so it's a stable read regardless
  // of the pipeline toggle. Next opening / staffing use utilization, which
  // does fold in pipeline when the toggle is on.
  const totalSold12 = months.reduce((s, m) => s + m.soldAllocated, 0)
  const bookedPct = totalCap12 > 0 ? Math.round((totalSold12 / totalCap12) * 100) : 0
  // No capacity anywhere in the window = team not assigned to departments.
  // Every downstream stat is meaningless in this state, so it drives a
  // dedicated banner + staffing message instead of the normal reads.
  const noCapacityConfigured = totalCap12 <= 0
  // Next opening = first month under 80% util (only meaningful with capacity;
  // a no-capacity month is "over", so it's correctly skipped).
  const nextOpeningIdx = months.findIndex((m) => m.hasCapacity && m.utilization < 80)
  const nextOpening = nextOpeningIdx >= 0 ? months[nextOpeningIdx] : null
  // Over-capacity months feed the staffing signal.
  const overMonths = months.filter((m) => m.utilization > 100)

  const windowLabel = `${months[0].label} ${months[0].year} – ${months[WINDOW_MONTHS - 1].label} ${months[WINDOW_MONTHS - 1].year}`

  return (
    <div className="max-w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Capacity</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">Birdseye planning — sold work against team capacity.</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {/* Sold-only vs Sold + pipeline toggle */}
          <div className="flex items-center bg-[#F3F4F6] rounded-lg p-0.5">
            {([
              { on: false, label: 'Sold only' },
              { on: true, label: 'Sold + pipeline' },
            ] as const).map((opt) => (
              <button
                key={opt.label}
                onClick={() => setShowPipeline(opt.on)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  showPipeline === opt.on
                    ? 'bg-white text-[#111] shadow-sm'
                    : 'text-[#6B7280] hover:text-[#111]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Rolling-window nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => setWindowStart(d => addMonths(d, -1))} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]" title="Back one month">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-[#111] min-w-[150px] text-center tabular-nums">{windowLabel}</span>
            <button onClick={() => setWindowStart(d => addMonths(d, 1))} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]" title="Forward one month">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setWindowStart(firstOfThisMonth())} className="ml-1 px-2.5 py-1 text-xs font-medium text-[#6B7280] hover:text-[#111] rounded-lg hover:bg-[#F3F4F6]" title="Jump to this month">
              Today
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
          {/* No team assigned to any department → capacity is 0 everywhere.
              Warn instead of silently reading healthy. Doesn't gate the page. */}
          {noCapacityConfigured && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3">
              <div className="text-sm text-[#92400E]">
                <span className="font-semibold">No team capacity configured.</span>{' '}
                Assign team members to departments to see real utilization.
              </div>
              <button
                onClick={() => router.push('/team')}
                className="flex-shrink-0 text-sm font-medium text-[#92400E] hover:text-[#78350F] underline"
              >
                Go to Team →
              </button>
            </div>
          )}

          {/* Header stats — the three planning reads. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">Next opening</div>
              {nextOpening ? (
                <div className="text-sm font-semibold text-[#111]">
                  {nextOpening.label} {nextOpening.year}
                  <span className="ml-1.5 text-xs font-normal text-[#6B7280]">~{nextOpeningIdx} mo lead time</span>
                </div>
              ) : (
                <div className="text-sm font-semibold text-[#DC2626]">Fully booked · 12 mo</div>
              )}
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">Booked</div>
              <div className="text-sm font-semibold text-[#111]">
                {bookedPct}%
                <span className="ml-1.5 text-xs font-normal text-[#6B7280] font-mono tabular-nums">{Math.round(totalSold12)}/{Math.round(totalCap12)}h sold · 12 mo</span>
              </div>
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">Staffing signal</div>
              {noCapacityConfigured ? (
                <button
                  onClick={() => router.push('/team')}
                  className="text-sm font-semibold text-[#92400E] hover:text-[#78350F]"
                >
                  No team capacity set up →
                </button>
              ) : overMonths.length === 0 ? (
                <div className="text-sm font-semibold text-[#16A34A]">No months over capacity</div>
              ) : (
                <div className="text-sm font-semibold text-[#DC2626] leading-snug">
                  {overMonths
                    .map((m) => `${m.label} over by ${Math.round(m.totalAllocated - m.totalCapacity)}h`)
                    .join(' · ')}
                </div>
              )}
            </div>
          </div>

          {/* Utilization heat strip — one cell per window month; click to scroll. */}
          <div className="flex gap-1 mb-4">
            {months.map((m) => (
              <button
                key={m.month}
                onClick={() => scrollToMonth(m.month)}
                title={
                  m.hasCapacity
                    ? `${m.longLabel} ${m.year} — ${Math.round(m.utilization)}% utilized`
                    : `${m.longLabel} ${m.year} — no capacity configured${m.totalAllocated > 0 ? ` (${Math.round(m.totalAllocated)}h allocated)` : ''}`
                }
                className="flex-1 group"
              >
                <div
                  className="h-6 rounded transition-transform group-hover:scale-y-125"
                  style={{ background: monthHeatColor(m.hasCapacity, m.totalAllocated, m.utilization) }}
                />
                <div className="text-[9px] text-center text-[#9CA3AF] mt-0.5 tabular-nums">{m.label.slice(0, 1)}</div>
              </button>
            ))}
          </div>

          {/* Unscheduled tray — above the months so drag distance stays short.
              Drop a scheduled card here to unschedule it. */}
          <div
            onDragOver={(e) => { if (dragSourceAllocationId) { e.preventDefault(); setDragOverTray(true) } }}
            onDragLeave={() => setDragOverTray(false)}
            onDrop={(e) => { e.preventDefault(); handleDropToTray() }}
            className={`mb-5 rounded-xl border-2 border-dashed transition-colors px-3 py-2.5 ${
              dragOverTray ? 'border-[#DC2626] bg-[#FEF2F2]' : 'border-[#E5E7EB] bg-[#F9FAFB]'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Unscheduled ({unscheduled.length})</h2>
              {dragSourceAllocationId && (
                <span className="text-[10px] text-[#DC2626] font-medium">Drop here to unschedule</span>
              )}
            </div>
            {unscheduled.length === 0 ? (
              <div className="text-[11px] text-[#9CA3AF] py-1">Everything is scheduled. Drag a month card here to pull it back.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {unscheduled.map(proj => {
                  const isPipe = isPipelineStage(proj.stage)
                  return (
                    <div
                      key={proj.id}
                      draggable
                      onDragStart={() => { setDragProjectId(proj.id); setDragSourceAllocationId(null) }}
                      onDragEnd={() => { setDragProjectId(null); setDragSourceAllocationId(null); setDragOverMonth(null); setDragOverTray(false) }}
                      className={`rounded-lg px-3 py-1.5 cursor-grab active:cursor-grabbing transition-colors ${
                        isPipe
                          ? 'bg-[#FaFaF9] border border-dashed border-[#D1D5DB] hover:border-[#9CA3AF]'
                          : 'bg-white border border-[#E5E7EB] hover:border-[#2563EB]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isPipe && (
                          <span className="px-1 py-px text-[7px] font-semibold uppercase tracking-wider text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] rounded">
                            {pipelineStageLabel(proj.stage)}
                          </span>
                        )}
                        <span className="text-xs font-medium text-[#111]">{proj.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {proj.client_name && <span className="text-[10px] text-[#9CA3AF] truncate max-w-[120px]">{proj.client_name}</span>}
                        <span className="text-[10px] font-mono tabular-nums text-[#6B7280]">{fmtMoney(proj.bid_total)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Month columns — fixed width, one horizontally scrollable row. */}
          <div className="overflow-x-auto pb-3">
            <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
              {months.map(m => {
                const isOver = dragOverMonth === m.month
                const isCurrentMonth = m.month === ymOf(firstOfThisMonth())
                const overBy = m.totalAllocated - m.totalCapacity
                return (
                  <div
                    id={`cap-col-${m.month}`}
                    key={m.month}
                    onDragOver={e => { e.preventDefault(); setDragOverMonth(m.month) }}
                    onDragLeave={() => setDragOverMonth(null)}
                    onDrop={e => { e.preventDefault(); handleDrop(m.month) }}
                    className={`flex-shrink-0 w-[184px] min-h-[300px] rounded-xl border-2 transition-colors ${
                      isOver ? 'border-[#2563EB] bg-[#EFF6FF]' :
                      isCurrentMonth ? 'border-[#D4956A]/40 bg-[#FFF7ED]/40' :
                      'border-transparent bg-[#F9FAFB]'
                    }`}
                  >
                    {/* Month header */}
                    <div className="px-3 pt-3 pb-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm font-semibold text-[#111]">{m.label}</span>
                        {m.showYear && <span className="text-[10px] text-[#9CA3AF] tabular-nums">{m.year}</span>}
                      </div>
                      <div className="text-[10px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
                        {Math.round(m.totalAllocated)}/{Math.round(m.totalCapacity)}h
                      </div>
                      {/* Utilization bar — sold solid, pipeline a lighter
                          second segment stacked after it (toggle on only). */}
                      <div className="bg-[#E5E7EB] rounded-full overflow-hidden h-1.5 mt-1.5 flex">
                        <div
                          className="h-full"
                          style={{ width: `${Math.min(m.soldUtil, 100)}%`, background: utilColor(m.utilization) }}
                        />
                        {showPipeline && m.pipelineUtil > 0 && (
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.min(m.pipelineUtil, Math.max(0, 100 - m.soldUtil))}%`,
                              background: utilColor(m.utilization),
                              opacity: 0.4,
                            }}
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span
                          className="text-[10px] font-mono tabular-nums font-medium"
                          style={{ color: monthHeatColor(m.hasCapacity, m.totalAllocated, m.utilization) }}
                        >
                          {m.hasCapacity ? `${Math.round(m.utilization)}%` : m.totalAllocated > 0 ? 'over' : 'no cap'}
                        </span>
                        {overBy > 0 && (
                          <span className="text-[10px] font-mono tabular-nums font-medium text-[#DC2626]">
                            over by {Math.round(overBy)}h
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tiny dept-stacked bar — dept mix at a glance for hiring. */}
                    <DeptStackedBar
                      deptHours={m.deptAllocated}
                      totalHours={m.totalAllocated}
                      departments={departments}
                    />

                    {/* Holiday + PTO — one quiet line; tooltip carries dates + names. */}
                    {(m.holidayCount > 0 || m.ptoDayCount > 0) && (
                      <div
                        className="px-3 mb-1.5 text-[10px] text-[#9CA3AF] truncate"
                        title={overrideTooltip(m.daySummaries)}
                      >
                        {[
                          m.holidayCount > 0 ? `${m.holidayCount} holiday${m.holidayCount === 1 ? '' : 's'}` : null,
                          m.ptoDayCount > 0 ? `${m.ptoDayCount} PTO day${m.ptoDayCount === 1 ? '' : 's'}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}

                    {/* Project cards in this month */}
                    <div className="space-y-1 px-2 pb-2">
                      {m.projectCards.map(card => (
                        <ProjectCard
                          key={card.allocationId}
                          card={card}
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
                            setDragOverTray(false)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
            onSplit={(n, mode) => handleSplit(alloc.id, n, mode)}
            onRemoveSplit={() => handleRemoveSplit(alloc.id)}
            onRefresh={() => refreshAllocationHours(alloc.id, alloc.project_id)}
          />
        )
      })()}
    </div>
  )
}

// --------------------------------------------------
// Project card component — one compact card sized for a fixed month column
// --------------------------------------------------
function ProjectCard({
  card,
  departments,
  subprojectNames,
  onRemove,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  card: Project & { allocationId: string; hours: number; departmentHours: Record<string, number> | null; splitIndex: number; splitTotal: number; splitGroupId: string | null }
  departments: Department[]
  subprojectNames: string[]
  onRemove: (e: React.MouseEvent) => void
  onSelect: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const isSplit = card.splitTotal > 1
  const splitLabel = isSplit ? `Part ${card.splitIndex} of ${card.splitTotal}` : null
  const isPipeline = isPipelineStage(card.stage)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg px-2 py-1.5 cursor-grab active:cursor-grabbing transition-colors group relative ${
        isPipeline
          ? 'bg-[#FaFaF9] border border-dashed border-[#D1D5DB] hover:border-[#9CA3AF]'
          : 'bg-white border border-[#E5E7EB] hover:border-[#D1D5DB]'
      }`}
      onClick={onSelect}
    >
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border border-[#E5E7EB] rounded-full items-center justify-center hidden group-hover:flex hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors"
      >
        <X className="w-2.5 h-2.5 text-[#6B7280] hover:text-[#DC2626]" />
      </button>
      {isPipeline && (
        <span className="inline-block mb-0.5 px-1 py-px text-[7px] font-semibold uppercase tracking-wider text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] rounded">
          {pipelineStageLabel(card.stage)}
        </span>
      )}
      <div className="text-[11px] font-medium text-[#111] truncate">{card.name}</div>
      {subprojectNames.length > 0 && (
        <div className="text-[8px] text-[#9CA3AF] truncate">{subprojectNames.join(', ')}</div>
      )}
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-[9px] font-mono tabular-nums text-[#6B7280]">{Math.round(card.hours)}h</span>
        {splitLabel && <span className="text-[8px] font-mono text-[#2563EB]">{splitLabel}</span>}
      </div>
      {card.departmentHours && Object.keys(card.departmentHours).length > 0 && (
        <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 mt-1">
          {departments.map(dept => {
            const hrs = card.departmentHours?.[dept.id]
            if (!hrs) return null
            return (
              <div key={dept.id} className="flex items-center gap-0.5" title={`${dept.name}: ${Math.round(hrs)}h`}>
                <div className="w-1.5 h-1.5 rounded-sm" style={{ background: dept.color }} />
                <span className="text-[8px] font-mono tabular-nums text-[#9CA3AF]">{Math.round(hrs)}h</span>
              </div>
            )
          })}
        </div>
      )}
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
}: {
  deptHours: Record<string, number>
  totalHours: number
  departments: Department[]
}) {
  if (totalHours <= 0) return null
  return (
    <div
      className="flex h-[3px] rounded-full overflow-hidden bg-[#E5E7EB] mx-3 mb-1.5"
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
}: {
  project: Project
  allocation: MonthAllocation
  groupAllocations: MonthAllocation[] | null
  departments: Department[]
  refreshing: boolean
  onClose: () => void
  onSplit: (n: number, mode: 'even' | 'smart') => void
  onRemoveSplit: () => void
  onRefresh: () => void
}) {
  const [splitMode, setSplitMode] = useState<'even' | 'smart'>('even')
  const isSplit = !!groupAllocations && groupAllocations.length > 1
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

          {/* Split */}
          {!isSplit && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
                Split across months
              </div>
              {/* Even vs Smart mode */}
              <div className="flex items-center bg-[#F3F4F6] rounded-lg p-0.5 mb-2">
                {(['even', 'smart'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSplitMode(m)}
                    className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md capitalize transition-colors ${
                      splitMode === m
                        ? 'bg-white text-[#111] shadow-sm'
                        : 'text-[#6B7280] hover:text-[#111]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => onSplit(n, splitMode)}
                    className="px-2 py-2 text-[12px] font-medium text-[#111] bg-[#F9FAFB] border border-[#E5E7EB] rounded-md hover:bg-[#EFF6FF] hover:border-[#2563EB] transition-colors"
                  >
                    <div className="font-semibold">{n} months</div>
                    <div className="text-[10px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
                      {splitMode === 'even' ? `~${Math.round(hours / n)}h/mo` : 'by phase'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-[#9CA3AF] mt-1.5 leading-snug">
                {splitMode === 'even'
                  ? 'Divides hours equally across consecutive months.'
                  : 'Groups departments by production sequence (Eng+CNC → Assembly+Finish → Install). Needs a per-department hours breakdown.'}
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

'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { ChevronLeft, ChevronRight, Calendar, ZoomIn, ZoomOut } from 'lucide-react'
import {
  buildBlocks, toDateKey, parseDate, getMonday, addWorkDays, generateWorkDays, isWorkDay,
  type ScheduleBlock,
} from '@/lib/schedule-engine'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface Department { id: string; name: string; color: string; display_order: number; hours_per_day: number }
interface DeptMember { department_id: string; user_id: string }
interface Project { id: string; name: string; client_name: string | null; status: string }
interface Subproject { id: string; project_id: string; name: string }
interface Allocation {
  id: string; subproject_id: string; department_id: string
  estimated_hours: number; actual_hours: number
  scheduled_date: string | null; scheduled_days: number | null; completed: boolean
}

type Zoom = 'day' | 'week'

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const DAY_W = { day: 60, week: 160 }
const ROW_H = 48
const LABEL_W = 160
const TODAY = toDateKey(new Date())

// ═══════════════════════════════════════════════════════════════════
// PAGE
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
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [departments, setDepartments] = useState<Department[]>([])
  const [deptMembers, setDeptMembers] = useState<DeptMember[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<Zoom>('day')

  // Drag state
  const [draggingBlock, setDraggingBlock] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [dragOverDept, setDragOverDept] = useState<string | null>(null)

  useEffect(() => { if (org?.id) loadData() }, [org?.id])

  async function loadData() {
    setLoading(true)
    const [
      { data: depts },
      { data: dm },
      { data: projs },
      { data: subs },
      { data: allocs },
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('org_id', org!.id).eq('active', true).order('display_order'),
      supabase.from('department_members').select('department_id, user_id').eq('org_id', org!.id),
      supabase.from('projects').select('id, name, client_name, status').eq('org_id', org!.id).in('status', ['active', 'bidding']),
      supabase.from('subprojects').select('id, project_id, name').eq('org_id', org!.id),
      supabase.from('department_allocations').select('*').eq('org_id', org!.id),
    ])
    setDepartments(depts || [])
    setDeptMembers(dm || [])
    setProjects(projs || [])
    setSubprojects(subs || [])
    setAllocations(allocs || [])
    setLoading(false)
  }

  // Build blocks from allocations
  const blocks = useMemo(() => buildBlocks({
    allocations, subprojects, projects, departments,
  }), [allocations, subprojects, projects, departments])

  // Generate dates — 6 weeks centered on today
  const dates = useMemo(() => {
    const start = getMonday(new Date())
    // Go back 1 week
    const adjustedStart = new Date(start)
    adjustedStart.setDate(adjustedStart.getDate() - 7)
    return generateWorkDays(adjustedStart, 7 * 4 * 6) // ~6 weeks of work days
  }, [])

  const dateKeys = useMemo(() => dates.map(d => toDateKey(d)), [dates])

  // Week groupings for header
  const weeks = useMemo(() => {
    const wks: { label: string; start: string; days: string[] }[] = []
    let currentWeek: string[] = []
    let weekStart = ''

    for (const d of dates) {
      const dk = toDateKey(d)
      if (d.getDay() === 1 || currentWeek.length === 0) {
        if (currentWeek.length > 0) {
          wks.push({ label: getWeekLabel(weekStart), start: weekStart, days: currentWeek })
        }
        currentWeek = [dk]
        weekStart = dk
      } else {
        currentWeek.push(dk)
      }
    }
    if (currentWeek.length > 0) {
      wks.push({ label: getWeekLabel(weekStart), start: weekStart, days: currentWeek })
    }
    return wks
  }, [dates])

  function getWeekLabel(dk: string): string {
    const d = parseDate(dk)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Member count per department
  const memberCountByDept = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const dm of deptMembers) {
      counts[dm.department_id] = (counts[dm.department_id] || 0) + 1
    }
    return counts
  }, [deptMembers])

  // Scroll to today on mount
  useEffect(() => {
    if (!scrollRef.current || dates.length === 0) return
    const todayIdx = dateKeys.indexOf(TODAY)
    if (todayIdx >= 0) {
      const cw = DAY_W[zoom]
      scrollRef.current.scrollLeft = Math.max(0, todayIdx * cw - 200)
    }
  }, [loading, zoom])

  // Drag handlers
  async function handleDrop(dateKey: string, deptId: string) {
    if (!draggingBlock) return

    await supabase.from('department_allocations').update({
      scheduled_date: dateKey,
      department_id: deptId,
    }).eq('id', draggingBlock)

    setDraggingBlock(null)
    setDragOverDate(null)
    setDragOverDept(null)
    loadData()
  }

  // Get blocks for a department on a specific date
  function getBlocksAt(deptId: string, dateKey: string): ScheduleBlock[] {
    return blocks.filter(b => {
      if (b.departmentId !== deptId) return false
      const start = parseDate(b.startDate)
      const end = addWorkDays(start, b.days)
      const check = parseDate(dateKey)
      return check >= start && check < end
    })
  }

  // Is this the start date of a block?
  function isBlockStart(block: ScheduleBlock, dateKey: string): boolean {
    return block.startDate === dateKey
  }

  // Unscheduled allocations
  const unscheduled = allocations.filter(a => !a.scheduled_date)
  const unscheduledBySub = useMemo(() => {
    const map = new Map<string, Allocation[]>()
    for (const a of unscheduled) {
      const list = map.get(a.subproject_id) || []
      list.push(a)
      map.set(a.subproject_id, list)
    }
    return map
  }, [unscheduled])

  const cw = DAY_W[zoom]
  const gridW = dates.length * cw

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
  }

  if (departments.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <Calendar className="w-8 h-8 text-[#9CA3AF] mx-auto mb-3" />
        <p className="text-sm text-[#9CA3AF] mb-3">Set up departments and assign team members first</p>
        <button onClick={() => router.push('/team')} className="text-sm text-[#2563EB] hover:text-[#1D4ED8] font-medium">
          Go to Team →
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#E5E7EB] bg-white flex-shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">Production Schedule</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (scrollRef.current) {
                const todayIdx = dateKeys.indexOf(TODAY)
                if (todayIdx >= 0) scrollRef.current.scrollTo({ left: Math.max(0, todayIdx * cw - 200), behavior: 'smooth' })
              }
            }}
            className="px-3 py-1.5 text-xs font-medium text-[#2563EB] bg-[#EFF6FF] rounded-lg hover:bg-[#DBEAFE] transition-colors"
          >
            Today
          </button>
          <div className="flex border border-[#E5E7EB] rounded-lg overflow-hidden">
            <button onClick={() => setZoom('day')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${zoom === 'day' ? 'bg-[#2563EB] text-white' : 'text-[#6B7280] hover:bg-[#F3F4F6]'}`}>
              Day
            </button>
            <button onClick={() => setZoom('week')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${zoom === 'week' ? 'bg-[#2563EB] text-white' : 'text-[#6B7280] hover:bg-[#F3F4F6]'}`}>
              Week
            </button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-[#FAFAFA]">
        <div style={{ width: gridW + LABEL_W, minHeight: '100%' }}>

          {/* Date header */}
          <div className="flex sticky top-0 z-20 bg-white border-b border-[#E5E7EB]">
            <div className="flex-shrink-0 border-r border-[#E5E7EB] bg-white" style={{ width: LABEL_W, position: 'sticky', left: 0, zIndex: 30 }}>
              <div className="h-10 flex items-center px-3">
                <span className="text-[9px] font-medium text-[#9CA3AF] uppercase tracking-wide">Department</span>
              </div>
            </div>
            {dates.map((date, i) => {
              const dk = toDateKey(date)
              const isToday = dk === TODAY
              const isMon = date.getDay() === 1
              return (
                <div key={dk} className="flex-shrink-0 text-center border-r border-[#F3F4F6] relative"
                  style={{ width: cw, borderLeft: isMon ? '2px solid #E5E7EB' : undefined }}>
                  {isToday && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#2563EB]" />}
                  <div className="h-10 flex flex-col items-center justify-center">
                    <div className="text-[8px] text-[#9CA3AF] uppercase">
                      {date.toLocaleDateString('en-US', { weekday: zoom === 'day' ? 'short' : 'narrow' })}
                    </div>
                    <div className={`text-[10px] font-mono ${isToday ? 'font-bold text-[#2563EB]' : 'text-[#6B7280]'}`}>
                      {date.getDate()}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Department rows */}
          {departments.map((dept, deptIdx) => {
            const memberCount = memberCountByDept[dept.id] || 0
            return (
              <div key={dept.id} className="flex border-b border-[#E5E7EB]">
                {/* Department label */}
                <div className="flex-shrink-0 border-r border-[#E5E7EB] bg-white flex items-center px-3 gap-2"
                  style={{ width: LABEL_W, height: ROW_H, position: 'sticky', left: 0, zIndex: 10 }}>
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: dept.color }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#111] truncate">{dept.name}</div>
                    <div className="text-[9px] text-[#9CA3AF]">{memberCount} people</div>
                  </div>
                </div>

                {/* Day cells */}
                {dates.map((date, dayIdx) => {
                  const dk = toDateKey(date)
                  const isToday = dk === TODAY
                  const isMon = date.getDay() === 1
                  const blocksHere = getBlocksAt(dept.id, dk)
                  const isOver = dragOverDate === dk && dragOverDept === dept.id

                  return (
                    <div
                      key={dk}
                      className={`flex-shrink-0 relative ${isOver ? 'bg-[#EFF6FF]' : isToday ? 'bg-[#FAFCFF]' : ''}`}
                      style={{
                        width: cw, height: ROW_H,
                        borderRight: '1px solid #F3F4F6',
                        borderLeft: isMon ? '2px solid #E5E7EB' : undefined,
                      }}
                      onDragOver={e => { e.preventDefault(); setDragOverDate(dk); setDragOverDept(dept.id) }}
                      onDragLeave={() => { setDragOverDate(null); setDragOverDept(null) }}
                      onDrop={e => { e.preventDefault(); handleDrop(dk, dept.id) }}
                    >
                      {isToday && <div className="absolute top-0 bottom-0 left-0 w-0.5 bg-[#2563EB]" />}

                      {/* Render blocks that START on this date */}
                      {blocksHere.filter(b => isBlockStart(b, dk)).map(block => (
                        <div
                          key={block.allocationId}
                          draggable
                          onDragStart={() => setDraggingBlock(block.allocationId)}
                          onDragEnd={() => { setDraggingBlock(null); setDragOverDate(null); setDragOverDept(null) }}
                          className="absolute top-1 left-0.5 cursor-grab active:cursor-grabbing group"
                          style={{
                            width: block.days * cw - 4,
                            height: ROW_H - 8,
                            borderRadius: 6,
                            background: block.projectColor,
                            opacity: draggingBlock === block.allocationId ? 0.4 : 1,
                            zIndex: 5,
                          }}
                          title={`${block.projectName} — ${block.subprojectName}\n${block.hours}h estimated, ${block.days} days`}
                        >
                          <div className="px-2 py-1 h-full flex flex-col justify-center overflow-hidden">
                            <div className="text-[10px] font-medium text-white truncate leading-tight">
                              {block.subprojectName}
                            </div>
                            {cw * block.days > 80 && (
                              <div className="text-[8px] text-white/70 truncate">
                                {block.projectName} · {block.hours}h
                              </div>
                            )}
                            {/* Progress bar */}
                            {block.progress > 0 && (
                              <div className="h-0.5 bg-white/20 rounded-full mt-0.5 overflow-hidden">
                                <div className="h-full bg-white/60 rounded-full" style={{ width: `${block.progress}%` }} />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Unscheduled allocations */}
      {unscheduled.length > 0 && (
        <div className="border-t border-[#E5E7EB] bg-white px-4 sm:px-6 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">Unscheduled</span>
            <span className="text-[10px] bg-[#F3F4F6] text-[#6B7280] px-1.5 py-0.5 rounded-full">{unscheduled.length}</span>
          </div>
          <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
            {Array.from(unscheduledBySub.entries()).map(([subId, allocs]) => {
              const sub = subprojects.find(s => s.id === subId)
              const proj = sub ? projects.find(p => p.id === sub.project_id) : null
              if (!sub || !proj) return null
              return allocs.map(alloc => {
                const dept = departments.find(d => d.id === alloc.department_id)
                return (
                  <div
                    key={alloc.id}
                    draggable
                    onDragStart={() => setDraggingBlock(alloc.id)}
                    onDragEnd={() => { setDraggingBlock(null); setDragOverDate(null); setDragOverDept(null) }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg cursor-grab active:cursor-grabbing hover:border-[#2563EB] transition-colors text-xs"
                  >
                    {dept && <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: dept.color }} />}
                    <span className="font-medium text-[#111]">{sub.name}</span>
                    <span className="text-[#9CA3AF]">·</span>
                    <span className="text-[#6B7280]">{dept?.name}</span>
                    <span className="text-[#9CA3AF] font-mono">{alloc.estimated_hours}h</span>
                  </div>
                )
              })
            })}
          </div>
        </div>
      )}
    </div>
  )
}

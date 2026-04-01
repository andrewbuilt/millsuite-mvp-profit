// components/schedule/Timeline.tsx
'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import type {
  ScheduleProject, ScheduleSub, PlacedBlock, DeptKey, DeptCapacity, CapacityMap,
  HeadcountOverrides,
} from '@/lib/schedule-engine'
import {
  DEPT_ORDER, DEPT_SHORT, toDateKey, parseDate, isWorkDay, genWorkDays,
  getMonday, addWorkDays, buildCapacityMap,
} from '@/lib/schedule-engine'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface DeptInfo {
  key: DeptKey
  name: string
  color: string
  id?: string
}

export type ZoomLevel = 'tight' | 'medium' | 'long'

interface Props {
  blocks: PlacedBlock[]
  projects: ScheduleProject[]
  subs: ScheduleSub[]
  capacity: DeptCapacity
  deptInfos: DeptInfo[]
  zoom: ZoomLevel
  scrollTrigger?: number
  selectedProjectId: string | null
  collapsed: Set<string>
  onToggleCollapse: (projectId: string) => void
  onBlockClick: (block: PlacedBlock, rect: DOMRect) => void
  onDateClick: (date: Date) => void
  onBlockDrop: (allocationId: string, newStartDate: string) => void
  onDeptLabelClick?: (deptInfo: DeptInfo) => void
  headcountOverrides?: HeadcountOverrides
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const ZOOM_CW: Record<ZoomLevel, number> = {
  tight: 52,
  medium: 32,
  long: 20,
}

const LEAD_WEEKS = 2
const TRAIL_WEEKS = 26

const LABEL_W = 140
const ROW_H = 28
const BLOCK_H = 18
const TODAY_KEY = toDateKey(new Date())

function sumValues(obj: Record<string, number> | null | undefined): number {
  if (!obj || typeof obj !== 'object') return 0
  return Object.values(obj).reduce((a, b) => a + (b || 0), 0)
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function Timeline({
  blocks, projects, subs, capacity, deptInfos,
  zoom, scrollTrigger, selectedProjectId, collapsed,
  onToggleCollapse, onBlockClick, onDateClick, onBlockDrop,
  onDeptLabelClick,
  headcountOverrides = {},
}: Props) {
  const CW = ZOOM_CW[zoom]
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasScrolledToToday = useRef(false)

  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null)

  // ─── Generate dates from block range ───
  const dates = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0)
    const todayMonday = getMonday(today)

    if (blocks.length === 0) {
      return genWorkDays(todayMonday, (LEAD_WEEKS + TRAIL_WEEKS + 4) * 5)
    }

    let earliest = new Date(today)
    let latest = new Date(today)

    for (const b of blocks) {
      const start = parseDate(b.startDate)
      if (isNaN(start.getTime())) continue
      if (start < earliest) earliest = start
      const end = addWorkDays(start, b.days)
      if (end > latest) latest = end
    }

    const rangeStart = getMonday(addWorkDays(earliest, -LEAD_WEEKS * 5))
    const rangeEnd = addWorkDays(latest, TRAIL_WEEKS * 5)

    const effectiveStart = rangeStart < todayMonday
      ? rangeStart
      : addWorkDays(todayMonday, -LEAD_WEEKS * 5)

    let count = 0
    const d = new Date(effectiveStart); d.setHours(12, 0, 0, 0)
    while (d <= rangeEnd) {
      if (isWorkDay(d)) count++
      d.setDate(d.getDate() + 1)
    }

    return genWorkDays(effectiveStart, Math.max(count, 20))
  }, [blocks])

  const gridW = dates.length * CW
  const capMap = useMemo(() => buildCapacityMap(blocks, capacity), [blocks, capacity])

  const sortedProjects = useMemo(() => {
    const pw: Record<string, number> = { high: 0, medium: 1, low: 2 }
    return [...projects].sort(
      (a, b) => (pw[a.priority] ?? 1) - (pw[b.priority] ?? 1)
        || (a.due || '2099').localeCompare(b.due || '2099'),
    )
  }, [projects])

  const dateIdx = useMemo(() => {
    const map = new Map<string, number>()
    dates.forEach((d, i) => map.set(toDateKey(d), i))
    return map
  }, [dates])

  // ─── PTO / Holiday flag lookup ───
  // Returns { isHoliday, hasPto } for a given dateKey
  const getDayFlag = useCallback((dk: string): { isHoliday: boolean; hasPto: boolean } => {
    if (!headcountOverrides || Object.keys(headcountOverrides).length === 0) {
      return { isHoliday: false, hasPto: false }
    }
    let isHoliday = false
    let hasPto = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overridesAny = headcountOverrides as any as Record<string, Record<string, { reduction?: number; isHoliday?: boolean }>>
    for (const deptOverrides of Object.values(overridesAny)) {
      const dayOverride = deptOverrides[dk]
      if (!dayOverride) continue
      if (dayOverride.isHoliday) { isHoliday = true; break }
      if ((dayOverride.reduction || 0) > 0) hasPto = true
    }
    return { isHoliday, hasPto }
  }, [headcountOverrides])

  // ─── Scroll to today ───
  const todayIdx = dateIdx.get(TODAY_KEY) ?? -1

  useEffect(() => {
    if (todayIdx >= 0 && scrollRef.current) {
      const viewportW = scrollRef.current.clientWidth - LABEL_W
      const todayPx = todayIdx * CW
      const scrollX = Math.max(0, todayPx - viewportW * 0.2)
      scrollRef.current.scrollLeft = scrollX
      hasScrolledToToday.current = true
    }
  }, [zoom])

  useEffect(() => {
    if (!hasScrolledToToday.current && todayIdx >= 0 && scrollRef.current) {
      const viewportW = scrollRef.current.clientWidth - LABEL_W
      const todayPx = todayIdx * CW
      scrollRef.current.scrollLeft = Math.max(0, todayPx - viewportW * 0.2)
      hasScrolledToToday.current = true
    }
  }, [todayIdx, CW])

  useEffect(() => {
    if (scrollTrigger && scrollTrigger > 0 && todayIdx >= 0 && scrollRef.current) {
      const viewportW = scrollRef.current.clientWidth - LABEL_W
      const todayPx = todayIdx * CW
      scrollRef.current.scrollTo({ left: Math.max(0, todayPx - viewportW * 0.2), behavior: 'smooth' })
    }
  }, [scrollTrigger, todayIdx, CW])

  const scrollToToday = useCallback(() => {
    if (todayIdx >= 0 && scrollRef.current) {
      const viewportW = scrollRef.current.clientWidth - LABEL_W
      const todayPx = todayIdx * CW
      scrollRef.current.scrollTo({ left: Math.max(0, todayPx - viewportW * 0.2), behavior: 'smooth' })
    }
  }, [todayIdx, CW])

  // ─── Drag handlers ───
  const handleDragStart = useCallback((e: React.DragEvent, block: PlacedBlock) => {
    e.dataTransfer.setData('text/plain', block.allocationId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingBlockId(block.allocationId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggingBlockId(null)
    setDragOverDate(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDate(dateKey)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverDate(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault()
    const allocationId = e.dataTransfer.getData('text/plain')
    if (allocationId && dateKey) {
      onBlockDrop(allocationId, dateKey)
    }
    setDragOverDate(null)
    setDraggingBlockId(null)
  }, [onBlockDrop])

  const headerH = zoom === 'tight' ? 56 : zoom === 'medium' ? 42 : 32

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto">
      <div style={{ width: gridW + LABEL_W, minHeight: '100%' }}>

        {/* ═══ DATE HEADER ═══ */}
        <div
          className="flex border-b border-[#E5E7EB]"
          style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff' }}
        >
          <div
            className="shrink-0 border-r border-[#F3F4F6] flex items-end px-3 pb-1"
            style={{ width: LABEL_W, position: 'sticky', left: 0, zIndex: 11, background: '#fff' }}
          >
            <span className="text-[9px] font-medium text-[#9CA3AF] uppercase tracking-wide">
              project / sub
            </span>
          </div>
          {dates.map((date, i) => {
            const dk = toDateKey(date)
            const isToday = dk === TODAY_KEY
            const isMon = date.getDay() === 1
            const totalCap = sumValues(capacity)
            const totalUsed = sumValues(capMap[dk])
            const util = totalCap > 0 ? totalUsed / totalCap : 0

            // PTO / holiday flag for this date
            const { isHoliday, hasPto } = getDayFlag(dk)
            const hasflag = isHoliday || hasPto

            return (
              <div
                key={dk}
                onClick={() => onDateClick(date)}
                className="text-center cursor-pointer shrink-0 relative"
                style={{
                  width: CW, padding: '4px 1px',
                  borderRight: i < dates.length - 1 ? '1px solid #F3F4F6' : 'none',
                  borderLeft: isMon && i > 0 ? '1px solid #E5E7EB' : 'none',
                  background: isToday
                    ? '#EFF6FF'
                    : isHoliday
                      ? 'rgba(254,242,242,0.6)'
                      : hasPto
                        ? 'rgba(255,251,235,0.5)'
                        : 'transparent',
                }}
              >
                {isToday && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#2563EB]" />}
                {/* Holiday / PTO top border stripe */}
                {!isToday && isHoliday && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#DC2626]" style={{ opacity: 0.5 }} />
                )}
                {!isToday && !isHoliday && hasPto && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#F59E0B]" style={{ opacity: 0.5 }} />
                )}
                {zoom === 'tight' && (
                  <div className="text-[8px] text-[#9CA3AF] uppercase">
                    {date.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                )}
                {zoom === 'medium' && (
                  <div className="text-[8px] text-[#9CA3AF] uppercase">
                    {date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                  </div>
                )}
                <div className="font-mono" style={{
                  fontSize: zoom === 'tight' ? 11 : zoom === 'medium' ? 9 : 8,
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#2563EB' : isHoliday ? '#DC2626' : hasPto ? '#D97706' : '#111',
                }}>{date.getDate()}</div>
                {zoom === 'tight' && (
                  <div className="text-[8px]" style={{ color: isHoliday ? '#DC2626' : hasPto ? '#D97706' : '#9CA3AF' }}>
                    {date.toLocaleDateString('en-US', { month: 'short' })}
                  </div>
                )}
                {zoom !== 'tight' && isMon && (
                  <div className="text-[7px] text-[#9CA3AF]">
                    {date.toLocaleDateString('en-US', { month: 'short' })}
                  </div>
                )}
                {/* Capacity dot + PTO/Holiday dot */}
                <div className="flex items-center justify-center gap-0.5 mt-0.5">
                  {util > 0 && (
                    <div className="rounded-full" style={{
                      width: 4, height: 4,
                      background: util > 1 ? '#EF4444' : util > 0.85 ? '#F59E0B' : util > 0.5 ? '#3B82F6' : '#D1D5DB',
                    }} />
                  )}
                  {isHoliday && (
                    <div
                      className="rounded-full"
                      style={{ width: 4, height: 4, background: '#DC2626' }}
                      title="Company holiday"
                    />
                  )}
                  {!isHoliday && hasPto && (
                    <div
                      className="rounded-full"
                      style={{ width: 4, height: 4, background: '#F59E0B' }}
                      title="PTO — reduced headcount"
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* ═══ CAPACITY ROW ═══ */}
        <div
          className="flex border-b border-[#E5E7EB] bg-[#FAFAFA]"
          style={{ position: 'sticky', top: headerH, zIndex: 9 }}
        >
          <div className="shrink-0 border-r border-[#F3F4F6] flex items-center px-3 gap-1"
            style={{ width: LABEL_W, position: 'sticky', left: 0, zIndex: 10, background: '#FAFAFA' }}>
            {deptInfos.map(d => (
              <div key={d.key} className="flex items-center gap-0.5 cursor-pointer hover:opacity-70 transition-opacity"
                onClick={e => { e.stopPropagation(); onDeptLabelClick?.(d) }}>
                <div className="w-1.5 h-1.5 rounded-sm" style={{ background: d.color }} />
                <span className="text-[8px] text-[#9CA3AF]">{DEPT_SHORT[d.key]}</span>
              </div>
            ))}
          </div>
          {dates.map((date, i) => {
            const dk = toDateKey(date)
            const totalCap = sumValues(capacity)
            const totalUsed = sumValues(capMap[dk])
            const pct = totalCap > 0 ? Math.round(totalUsed / totalCap * 100) : 0
            const { isHoliday, hasPto } = getDayFlag(dk)
            return (
              <div key={dk} className="flex items-center justify-center shrink-0"
                style={{
                  width: CW, height: 18,
                  borderRight: i < dates.length - 1 ? '1px solid #F3F4F6' : 'none',
                  borderLeft: date.getDay() === 1 && i > 0 ? '1px solid #E5E7EB' : 'none',
                  background: isHoliday ? 'rgba(254,242,242,0.4)' : hasPto ? 'rgba(255,251,235,0.4)' : 'transparent',
                }}>
                {/* Show holiday/PTO indicator in capacity row when no utilization */}
                {totalUsed === 0 && isHoliday && zoom !== 'long' && (
                  <span className="text-[7px]" title="Holiday">🏛</span>
                )}
                {totalUsed === 0 && !isHoliday && hasPto && zoom !== 'long' && (
                  <span className="text-[7px]" title="PTO">🏖</span>
                )}
                {totalUsed > 0 && zoom !== 'long' && (
                  <span className="font-mono" style={{
                    fontSize: 8, fontWeight: pct > 85 ? 600 : 400,
                    color: pct > 100 ? '#DC2626' : pct > 85 ? '#D97706' : pct > 50 ? '#6B7280' : '#D1D5DB',
                  }}>{pct}%</span>
                )}
                {totalUsed > 0 && zoom === 'long' && (
                  <div className="mx-auto rounded-full" style={{
                    width: 6, height: 3, borderRadius: 1,
                    background: pct > 100 ? '#DC2626' : pct > 85 ? '#F59E0B' : pct > 50 ? '#3B82F6' : '#E5E7EB',
                  }} />
                )}
              </div>
            )
          })}
        </div>

        {/* ═══ PROJECT / SUB ROWS ═══ */}
        {sortedProjects.map(project => {
          const isHL = !selectedProjectId || selectedProjectId === project.id
          const isColl = collapsed.has(project.id)
          const pBlocks = blocks.filter(b => b.projectId === project.id)
          const projSubs = subs
            .filter(s => s.project_id === project.id)
            .sort((a, b) => (a.schedule_order ?? 0) - (b.schedule_order ?? 0))
          const totalHrs = pBlocks.reduce((s, b) => s + b.hours, 0)

          return (
            <div key={project.id} className="border-b border-[#F3F4F6]"
              style={{ opacity: isHL ? 1 : 0.15, transition: 'opacity 0.2s' }}>

              {/* Project header row */}
              <div
                onClick={() => onToggleCollapse(project.id)}
                className="flex items-center cursor-pointer bg-[#FAFAFA] hover:bg-[#F3F4F6] transition-colors"
                style={{ height: ROW_H }}
              >
                <div className="px-2 flex items-center gap-1.5 border-r border-[#F3F4F6] h-full shrink-0"
                  style={{ width: LABEL_W, position: 'sticky', left: 0, zIndex: 5, background: '#FAFAFA' }}>
                  <svg width="8" height="8" viewBox="0 0 8 8"
                    style={{ transform: isColl ? 'rotate(-90deg)' : '', transition: 'transform 0.12s', flexShrink: 0 }}>
                    <path d="M1 2.5L4 5.5L7 2.5" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: project.color }} />
                  <span className="text-[10px] font-semibold truncate flex-1 text-[#111]">{project.name}</span>
                  <span className="text-[8px] font-mono text-[#9CA3AF] shrink-0">{totalHrs}h</span>
                </div>
                <div style={{ width: gridW, position: 'relative', height: '100%' }}>
                  {isColl && pBlocks.length > 0 && (() => {
                    const starts = pBlocks.map(b => dateIdx.get(b.startDate) ?? 0)
                    const ends = pBlocks.map(b => (dateIdx.get(b.startDate) ?? 0) + b.days)
                    const mn = Math.min(...starts); const mx = Math.max(...ends)
                    return <div className="absolute rounded-sm" style={{
                      left: mn * CW, width: (mx - mn) * CW, height: 5,
                      top: '50%', transform: 'translateY(-50%)',
                      background: project.color, opacity: 0.35,
                    }} />
                  })()}
                </div>
              </div>

              {/* Subproject rows */}
              {!isColl && projSubs.map(sub => {
                const sBlocks = pBlocks.filter(b => b.subId === sub.id)
                return (
                  <div key={sub.id} className="flex items-center" style={{ height: ROW_H }}>
                    <div className="flex items-center border-r border-[#F3F4F6] h-full shrink-0"
                      style={{ width: LABEL_W, paddingLeft: 28, position: 'sticky', left: 0, zIndex: 5, background: '#fff' }}>
                      <span className="text-[9px] text-[#6B7280] truncate pr-2">{sub.name}</span>
                    </div>

                    <div className="relative" style={{ width: gridW, height: '100%' }}>
                      {/* Drop zone cells */}
                      {dates.map((date, i) => {
                        const dk = toDateKey(date)
                        const isMon = date.getDay() === 1
                        const isToday = dk === TODAY_KEY
                        const isDragTarget = dragOverDate === dk && draggingBlockId !== null
                        const { isHoliday: cellHoliday, hasPto: cellPto } = getDayFlag(dk)

                        const totalCap = sumValues(capacity)
                        const totalUsed = sumValues(capMap[dk])
                        const util = totalCap > 0 ? totalUsed / totalCap : 0
                        let cellBg = 'transparent'
                        if (isDragTarget) cellBg = 'rgba(37,99,235,0.08)'
                        else if (cellHoliday) cellBg = 'rgba(254,242,242,0.35)'
                        else if (cellPto) cellBg = 'rgba(255,251,235,0.35)'
                        else if (util > 1) cellBg = 'rgba(239,68,68,0.04)'
                        else if (util > 0.85) cellBg = 'rgba(245,158,11,0.03)'

                        return (
                          <div
                            key={dk}
                            className="absolute top-0 bottom-0"
                            style={{
                              left: i * CW, width: CW, zIndex: 0,
                              borderRight: i < dates.length - 1 ? '1px solid #F9FAFB' : 'none',
                              borderLeft: isMon && i > 0 ? '1px solid #F3F4F6' : 'none',
                              background: isToday ? 'rgba(37,99,235,0.03)' : cellBg,
                            }}
                            onDragOver={e => handleDragOver(e, dk)}
                            onDragLeave={handleDragLeave}
                            onDrop={e => handleDrop(e, dk)}
                          />
                        )
                      })}

                      {/* Blocks */}
                      {sBlocks.map(block => {
                        const di = deptInfos.find(d => d.key === block.dept)
                        const colI = dateIdx.get(block.startDate)
                        if (colI === undefined) return null
                        const left = colI * CW
                        const w = Math.max(block.days * CW, CW * 0.6)
                        const isDragging = draggingBlockId === block.allocationId

                        return (
                          <div
                            key={block.allocationId}
                            draggable={!block.completed}
                            onDragStart={e => handleDragStart(e, block)}
                            onDragEnd={handleDragEnd}
                            onClick={e => {
                              e.stopPropagation()
                              onBlockClick(block, (e.currentTarget as HTMLElement).getBoundingClientRect())
                            }}
                            title={`${di?.name}: ${block.hours}h · ${block.crewSize} crew · ${block.days}d — ${block.progress}% · Drag to move`}
                            className="absolute transition-opacity"
                            style={{
                              left, width: w, height: BLOCK_H,
                              top: (ROW_H - BLOCK_H) / 2,
                              borderRadius: 4,
                              background: di?.color || '#94A3B8',
                              opacity: isDragging ? 0.4 : block.completed ? 0.3 : 0.8,
                              zIndex: 2,
                              cursor: block.completed ? 'default' : 'grab',
                            }}
                          >
                            {w > CW * 1.2 && (
                              <span className="text-[7px] text-white font-semibold px-1 block truncate"
                                style={{ lineHeight: `${BLOCK_H}px` }}>
                                {DEPT_SHORT[block.dept]} {block.hours}h
                              </span>
                            )}
                            {block.progress > 0 && block.progress < 100 && (
                              <div className="absolute bottom-0 left-0 h-0.5 rounded-b"
                                style={{ width: `${block.progress}%`, background: 'rgba(255,255,255,0.5)' }} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {sortedProjects.length === 0 && (
          <div className="flex items-center justify-center py-20 text-sm text-[#9CA3AF]">
            No scheduled projects. Use the sidebar to schedule a project.
          </div>
        )}
      </div>
    </div>
  )
}
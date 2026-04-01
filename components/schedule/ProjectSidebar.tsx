// components/schedule/ProjectSidebar.tsx
'use client'

import { useState, useMemo } from 'react'
import type {
  ScheduleProject, ScheduleSub, PlacedBlock, DeptKey,
} from '@/lib/schedule-engine'
import {
  DEPT_ORDER, DEPT_SHORT, sortProjects, projectEndDate, parseDate, toDateKey,
  workDaysBetween,
} from '@/lib/schedule-engine'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface DeptInfo {
  key: DeptKey
  name: string
  color: string
}

interface Props {
  projects: ScheduleProject[]
  subs: ScheduleSub[]
  blocks: PlacedBlock[]
  /** Projects that have allocations but none are scheduled yet */
  unscheduledProjectIds: Set<string>
  deptInfos: DeptInfo[]
  selectedProjectId: string | null
  independentSubs: Set<string>
  onSelectProject: (id: string | null) => void
  onScheduleProject: (projectId: string) => void
  onUpdateDue: (projectId: string, newDue: string) => void
  onUpdatePriority: (projectId: string, newPriority: 'high' | 'medium' | 'low') => void
  onToggleIndependentSub: (subId: string) => void
}

const PRIORITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: '#FEE2E2', text: '#DC2626', label: 'High' },
  medium: { bg: '#F3F4F6', text: '#6B7280', label: 'Med' },
  low: { bg: '#EFF6FF', text: '#2563EB', label: 'Low' },
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function ProjectSidebar({
  projects, subs, blocks, unscheduledProjectIds, deptInfos,
  selectedProjectId, independentSubs,
  onSelectProject, onScheduleProject, onUpdateDue, onUpdatePriority,
  onToggleIndependentSub,
}: Props) {
  const [filter, setFilter] = useState('')
  const [editingDue, setEditingDue] = useState<string | null>(null)

  const sorted = useMemo(() => sortProjects(projects), [projects])
  const filtered = useMemo(() => {
    if (!filter) return sorted
    const q = filter.toLowerCase()
    return sorted.filter(p =>
      p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
    )
  }, [sorted, filter])

  const today = new Date(); today.setHours(0, 0, 0, 0)

  return (
    <div className="w-[260px] border-r border-[#E5E7EB] flex flex-col shrink-0 bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E5E7EB]">
        <div className="text-sm font-semibold tracking-tight text-[#111]">Projects</div>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search..."
          className="mt-2 w-full px-3 py-1.5 text-xs bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg
                     placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] transition-colors"
        />
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.map(project => {
          const isSelected = selectedProjectId === project.id
          const isUnscheduled = unscheduledProjectIds.has(project.id)
          const pri = PRIORITY_BADGE[project.priority] || PRIORITY_BADGE.medium
          const pBlocks = blocks.filter(b => b.projectId === project.id)
          const projSubs = subs.filter(s => s.project_id === project.id)

          // Progress
          const totalHrs = pBlocks.reduce((s, b) => s + b.hours, 0)
          const completedHrs = pBlocks.reduce((s, b) => s + b.hours * b.progress / 100, 0)
          const pct = totalHrs > 0 ? Math.round(completedHrs / totalHrs * 100) : 0

          // Due date display
          const dueDate = project.due ? parseDate(project.due) : null
          const endDate = projectEndDate(pBlocks, project.id)
          const daysLeft = dueDate ? workDaysBetween(today, dueDate) : null
          const isOverdue = dueDate ? dueDate < today : false
          const isTight = daysLeft !== null && daysLeft >= 0 && daysLeft <= 5
          const isEditingThis = editingDue === project.id

          return (
            <div
              key={project.id}
              className="border-b border-[#F3F4F6] transition-colors cursor-pointer"
              style={{
                background: isSelected ? '#EFF6FF' : 'transparent',
                borderLeft: isSelected ? '3px solid #2563EB' : '3px solid transparent',
              }}
              onClick={() => onSelectProject(isSelected ? null : project.id)}
            >
              <div className="px-3 py-2.5">
                {/* Row 1: name + priority + progress */}
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: project.color }}
                  />
                  <span className="text-xs font-semibold text-[#111] flex-1 truncate">
                    {project.name}
                  </span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      const next = project.priority === 'high' ? 'medium'
                        : project.priority === 'medium' ? 'low' : 'high'
                      onUpdatePriority(project.id, next as 'high' | 'medium' | 'low')
                    }}
                    className="text-[9px] font-semibold px-1.5 py-px rounded-md border-none cursor-pointer shrink-0"
                    style={{ background: pri.bg, color: pri.text }}
                    title="Click to cycle priority"
                  >
                    {pri.label}
                  </button>
                </div>

                {/* Row 2: client, hours, due date */}
                <div className="flex items-center gap-1.5 mt-1 ml-3.5">
                  <span className="text-[10px] text-[#6B7280]">{project.client}</span>
                  <span className="text-[10px] text-[#D1D5DB]">·</span>
                  <span className="text-[10px] font-mono text-[#6B7280]">
                    {totalHrs > 0 ? `${totalHrs}h` : '—'}
                  </span>
                  <span className="text-[10px] text-[#D1D5DB]">·</span>

                  {isEditingThis ? (
                    <input
                      type="date"
                      autoFocus
                      defaultValue={project.due || ''}
                      onClick={e => e.stopPropagation()}
                      onBlur={e => {
                        if (e.target.value && e.target.value !== project.due) {
                          onUpdateDue(project.id, e.target.value)
                        }
                        setEditingDue(null)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setEditingDue(null)
                      }}
                      className="text-[10px] font-mono border border-[#2563EB] rounded px-1 py-px
                                 bg-[#EFF6FF] text-[#111] outline-none w-[100px]"
                    />
                  ) : (
                    <span
                      onClick={e => { e.stopPropagation(); setEditingDue(project.id) }}
                      className="text-[10px] font-semibold font-mono cursor-pointer px-1 py-px rounded
                                 border border-dashed border-transparent hover:border-[#D1D5DB]
                                 hover:bg-[#F9FAFB] transition-all"
                      style={{
                        color: isOverdue ? '#DC2626' : isTight ? '#D97706' : '#6B7280',
                      }}
                      title="Click to edit due date"
                    >
                      {dueDate
                        ? dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : 'No due'}
                    </span>
                  )}

                  {daysLeft !== null && !isEditingThis && (
                    <span
                      className="text-[8px] font-semibold font-mono px-1 py-px rounded-md"
                      style={{
                        background: isOverdue ? '#FEE2E2' : isTight ? '#FFFBEB' : 'transparent',
                        color: isOverdue ? '#DC2626' : isTight ? '#D97706' : '#9CA3AF',
                      }}
                    >
                      {isOverdue ? `${Math.abs(daysLeft)}d over` : `${daysLeft}d`}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {pct > 0 && (
                  <div className="mt-1.5 ml-3.5 h-1 bg-[#F3F4F6] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct === 100 ? '#059669' : project.color,
                      }}
                    />
                  </div>
                )}

                {/* Unscheduled: show + Schedule button */}
                {isUnscheduled && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onScheduleProject(project.id)
                    }}
                    className="mt-2 ml-3.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg
                               border-none cursor-pointer transition-colors
                               bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                  >
                    {pBlocks.length > 0 ? '+ Schedule Remaining' : '+ Schedule'}
                  </button>
                )}

                {/* Expanded: sub list when selected */}
                {isSelected && projSubs.length > 0 && (
                  <div className="mt-2 ml-3.5 flex flex-col gap-1">
                    {[...projSubs]
                      .sort((a, b) => (a.schedule_order ?? 0) - (b.schedule_order ?? 0))
                      .map(sub => {
                        const subBlocks = pBlocks.filter(b => b.subId === sub.id)
                        const subHrs = subBlocks.reduce((s, b) => s + b.hours, 0)
                        const subDone = subBlocks.reduce(
                          (s, b) => s + b.hours * b.progress / 100, 0,
                        )
                        const subPct = subHrs > 0 ? Math.round(subDone / subHrs * 100) : 0

                        return (
                          <div key={sub.id} className="py-1 border-b border-[#F9FAFB] last:border-none">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-[#111] flex-1 truncate">
                                {sub.name}
                              </span>
                              <span className="text-[9px] font-mono text-[#6B7280]">
                                {subPct}%
                              </span>
                            </div>
                            <label
                              className="flex items-center gap-1 mt-0.5 cursor-pointer"
                              onClick={e => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={independentSubs.has(sub.id)}
                                onChange={() => onToggleIndependentSub(sub.id)}
                                className="w-3 h-3 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] focus:ring-offset-0 cursor-pointer"
                              />
                              <span className="text-[9px] text-[#9CA3AF]">Move independently</span>
                            </label>
                            {/* Dept progress mini-bars */}
                            <div className="flex gap-px mt-0.5">
                              {deptInfos.map(d => {
                                const db = subBlocks.find(b => b.dept === d.key)
                                if (!db) return null
                                return (
                                  <div
                                    key={d.key}
                                    className="h-[3px] bg-[#F3F4F6] rounded-sm overflow-hidden"
                                    style={{ flex: db.hours }}
                                  >
                                    <div
                                      className="h-full rounded-sm"
                                      style={{
                                        width: `${db.progress}%`,
                                        background: d.color,
                                      }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
            No projects match
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-4 py-2 border-t border-[#E5E7EB] bg-[#F9FAFB]">
        <div className="text-[9px] font-mono text-[#9CA3AF]">
          {projects.length} projects · {blocks.length} blocks ·{' '}
          {blocks.reduce((s, b) => s + b.hours, 0).toLocaleString()}h
        </div>
      </div>
    </div>
  )
}
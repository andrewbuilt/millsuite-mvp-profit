'use client'

// Nav trigger for the task panel. Andrew 2026-11-25: text buttons the same
// size as the nav's own ("Settings"), no icon, no round badges:
//   · RED  "N critical" — my open Critical tasks. Stays until they're done or
//     un-flagged, seen or not.
//   · BLUE "N tasks"    — my tasks I haven't opened yet, plus completions
//     waiting on my close-out. Opening a task's detail clears it.
//   · Neither → a plain "Tasks" button, styled like the rest of the nav.
// Each opens the panel. Deliberately NOT given a `data-tour` hook: the guided
// walkthroughs point at nav items by stable identifiers, and adding one here
// risks colliding with an existing value. If a tour ever needs to ring this,
// add the hook and re-run scripts/check-tour-targets.mjs.

import { useTasksOptional } from './TasksProvider'

const BASE = 'px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap'

export default function TasksNavButton() {
  const ctx = useTasksOptional()
  if (!ctx || !ctx.enabled) return null

  const { unseenCount, criticalCount, openPanel, panelOpen } = ctx
  const n = (x: number) => (x > 99 ? '99+' : String(x))

  if (criticalCount === 0 && unseenCount === 0) {
    return (
      <button
        onClick={() => openPanel()}
        className={`${BASE} ${panelOpen ? 'bg-[#F3F4F6] text-[#111]' : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'}`}
      >
        Tasks
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      {criticalCount > 0 && (
        <button
          onClick={() => openPanel()}
          title={`${criticalCount} critical ${criticalCount === 1 ? 'task' : 'tasks'}`}
          className={`${BASE} bg-[#DC2626] text-white hover:bg-[#B91C1C]`}
        >
          {n(criticalCount)} critical
        </button>
      )}
      {unseenCount > 0 && (
        <button
          onClick={() => openPanel()}
          title={`${unseenCount} new ${unseenCount === 1 ? 'task' : 'tasks'}`}
          className={`${BASE} bg-[#2563EB] text-white hover:bg-[#1D4ED8]`}
        >
          {n(unseenCount)} {unseenCount === 1 ? 'task' : 'tasks'}
        </button>
      )}
    </div>
  )
}

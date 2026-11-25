'use client'

// Nav trigger for the task panel — icon + up to two badges (133, Andrew
// 2026-11-12: "we don't need to see how many tasks we have"):
//   · BLUE (top-right) — how many of MY tasks I haven't opened yet, plus
//     completions waiting on my close-out. Opening a task's detail clears it.
//   · RED (bottom-right) — I have an open Critical task. Stays lit until the
//     Critical task is done or un-flagged, seen or not.
// No badge = nothing new and nothing critical. The old "count of my open
// tasks" badge is gone — it was always lit, so it signalled nothing.
// Deliberately NOT given a `data-tour` hook: the guided walkthroughs point at
// nav items by stable identifiers, and adding one here risks colliding with
// an existing value. If a tour ever needs to ring this, add the hook and
// re-run scripts/check-tour-targets.mjs.

import { ListChecks } from 'lucide-react'
import { useTasksOptional } from './TasksProvider'

export default function TasksNavButton() {
  const ctx = useTasksOptional()
  if (!ctx || !ctx.enabled) return null

  const { unseenCount, criticalCount, openPanel, panelOpen } = ctx
  const label = [
    criticalCount > 0 ? `${criticalCount} critical` : '',
    unseenCount > 0 ? `${unseenCount} new` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      onClick={() => openPanel()}
      title={label ? `Tasks — ${label}` : 'Tasks'}
      aria-label={label ? `Tasks, ${label}` : 'Tasks'}
      className={`relative p-1.5 rounded-lg transition-colors flex items-center justify-center ${
        panelOpen ? 'bg-[#F3F4F6] text-[#111]' : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      <ListChecks className="w-6 h-6" />
      {criticalCount > 0 && (
        <span className="absolute -bottom-1 -right-1 w-[17px] h-[17px] rounded-full bg-[#DC2626] text-white text-[11px] font-bold leading-[17px] text-center ring-2 ring-white">
          !
        </span>
      )}
      {unseenCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-[#2563EB] text-white text-[11px] font-semibold leading-[19px] text-center ring-2 ring-white">
          {unseenCount > 99 ? '99+' : unseenCount}
        </span>
      )}
    </button>
  )
}

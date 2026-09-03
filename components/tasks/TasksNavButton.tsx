'use client'

// Nav trigger for the task panel — icon + a badge counting MY open tasks.
// The badge is personal on purpose (Andrew, 2026-09-03): counting the org's
// open tasks left it permanently lit, so it signalled nothing. `openCount`
// comes from the provider and already handles the unlinked-login fallback.
// Deliberately NOT given a `data-tour` hook: the guided walkthroughs point at
// nav items by stable identifiers, and adding one here risks colliding with
// an existing value. If a tour ever needs to ring this, add the hook and
// re-run scripts/check-tour-targets.mjs.

import { ListChecks } from 'lucide-react'
import { useTasksOptional } from './TasksProvider'

export default function TasksNavButton() {
  const ctx = useTasksOptional()
  if (!ctx || !ctx.enabled) return null

  const { openCount, openPanel, panelOpen } = ctx
  return (
    <button
      onClick={() => openPanel()}
      title="Tasks"
      aria-label={openCount > 0 ? `Tasks, ${openCount} for you` : 'Tasks'}
      className={`relative p-1.5 rounded-lg transition-colors ${
        panelOpen ? 'bg-[#F3F4F6] text-[#111]' : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      <ListChecks className="w-[18px] h-[18px]" />
      {openCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#2563EB] text-white text-[9px] font-semibold leading-[15px] text-center">
          {openCount > 99 ? '99+' : openCount}
        </span>
      )}
    </button>
  )
}

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

  const { openCount, completedForMe, openPanel, panelOpen } = ctx
  // The badge is "what's owed YOUR attention": your open tasks plus
  // completions waiting on your close-out (114). Both live in the panel this
  // button opens, so the count and the destination agree.
  const attention = openCount + completedForMe.length
  return (
    <button
      onClick={() => openPanel()}
      title={
        completedForMe.length > 0
          ? `Tasks — ${completedForMe.length} completed for you`
          : 'Tasks'
      }
      aria-label={attention > 0 ? `Tasks, ${attention} for you` : 'Tasks'}
      className={`relative p-1.5 rounded-lg transition-colors ${
        panelOpen ? 'bg-[#F3F4F6] text-[#111]' : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      <ListChecks className="w-[18px] h-[18px]" />
      {attention > 0 && (
        <span
          className={`absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-white text-[9px] font-semibold leading-[15px] text-center ${
            // Green when a close-out is waiting — good news reads differently
            // from a to-do pile.
            completedForMe.length > 0 ? 'bg-[#059669]' : 'bg-[#2563EB]'
          }`}
        >
          {attention > 99 ? '99+' : attention}
        </span>
      )}
    </button>
  )
}

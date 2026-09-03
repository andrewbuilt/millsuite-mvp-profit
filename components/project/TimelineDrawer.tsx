'use client'

// ============================================================================
// TimelineDrawer — "what happened to this job", hidden until asked for.
// ============================================================================
// Wave-3 item 6. Deliberately behind an icon rather than on the page: the
// cover is already dense, and a history log is something you go looking for
// when a question comes up ("when did we send that estimate?"), not something
// you need in view while working.
//
// Renders recorded events (project_events, migration 094) merged with derived
// pseudo-events reconstructed from columns the project already carries. See
// lib/project-events for why the derived half exists — without it every
// project that predates 094 opens an empty drawer.
// ============================================================================

import { useEffect, useState } from 'react'
import { History, X } from 'lucide-react'
import {
  listProjectEvents,
  derivedProjectEvents,
  mergeProjectEvents,
  type ProjectEvent,
} from '@/lib/project-events'

export interface TimelineProject {
  id: string
  created_at?: string | null
  imported_at?: string | null
  estimate_sent_at?: string | null
  sold_at?: string | null
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function TimelineDrawer({
  project,
  nameByUserId,
}: {
  project: TimelineProject
  /** users.id → display name, for the "who". Absent names simply render
   *  nothing rather than a raw uuid. */
  nameByUserId?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<ProjectEvent[] | null>(null)

  // Loaded only when opened — the whole point of hiding it is that most page
  // views never need this query.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const recorded = await listProjectEvents(project.id)
      if (cancelled) return
      setEvents(mergeProjectEvents(recorded, derivedProjectEvents(project)))
    })()
    return () => {
      cancelled = true
    }
  }, [open, project])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Project history"
        aria-label="Project history"
        className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
      >
        <History className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/20"
            onClick={() => setOpen(false)}
          />
          <aside
            aria-label="Project history"
            className="fixed right-0 top-0 bottom-0 z-[61] w-full sm:w-[380px] bg-white border-l border-[#E5E7EB] shadow-xl flex flex-col"
          >
            <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
              <div>
                <div className="text-[15px] font-semibold text-[#111]">History</div>
                <div className="text-[11px] text-[#9CA3AF]">Newest first</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {events === null ? (
                <div className="text-sm text-[#9CA3AF] py-8 text-center">Loading…</div>
              ) : events.length === 0 ? (
                <div className="text-sm text-[#9CA3AF] py-8 text-center">
                  Nothing recorded yet.
                </div>
              ) : (
                <ol className="space-y-3">
                  {events.map((e) => {
                    const who = e.actor_user_id ? nameByUserId?.[e.actor_user_id] : null
                    return (
                      <li key={e.id} className="flex gap-2.5">
                        <div className="mt-[5px] flex-shrink-0">
                          {/* Derived rows read as reconstructions, not records
                              — hollow dot, muted text. */}
                          <div
                            className={
                              'w-1.5 h-1.5 rounded-full ' +
                              (e.derived
                                ? 'border border-[#D1D5DB] bg-white'
                                : 'bg-[#2563EB]')
                            }
                          />
                        </div>
                        <div className="min-w-0">
                          <div
                            className={
                              'text-[13px] ' + (e.derived ? 'text-[#6B7280]' : 'text-[#111]')
                            }
                          >
                            {e.label}
                          </div>
                          <div className="text-[11px] text-[#9CA3AF]">
                            {fmtWhen(e.created_at)}
                            {who ? ` · ${who}` : ''}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}

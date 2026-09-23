'use client'

// ============================================================================
// CompletedForYou — "someone finished your task; you get the final say."
// ============================================================================
// The close-the-loop strip (migration 114, Andrew 2026-09-23): tasks YOU
// created that someone ELSE completed, each with a Close out button. Until
// closed out they sit here — completion notifies, acknowledgment archives the
// alert. Self-completed tasks never appear (no self-alerts), enforced in the
// query (lib/tasks.listCompletedForMe), not here.
//
// ONE component mounted on BOTH surfaces (/pm and the task panel) so the
// wording and the rule can't drift. Reads the provider directly — the strip
// is provider state so completing a task from any surface updates the other.
// Renders nothing when empty: an empty "nothing to acknowledge" box is noise
// on the exact page (/pm) that must stay quiet on day one.
// ============================================================================

import { CheckCheck } from 'lucide-react'
import { useState } from 'react'
import { formatDoneAt } from '@/lib/tasks'
import { useTasks } from './TasksProvider'
import { taskFirstName } from './TaskRow'

export default function CompletedForYou({ variant }: { variant: 'page' | 'panel' }) {
  const { completedForMe, closeOut, nameByUserId } = useTasks()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (completedForMe.length === 0) return null

  async function handleClose(taskId: string) {
    setBusyId(taskId)
    setError(null)
    try {
      await closeOut(taskId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close that out.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section
      className={
        variant === 'page'
          ? 'bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl overflow-hidden'
          : 'mx-4 mt-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg overflow-hidden'
      }
    >
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-[#A7F3D0]/60">
        <CheckCheck className="w-4 h-4 text-[#059669] flex-shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#047857]">
          Completed for you
        </span>
        <span className="text-[11px] text-[#059669]">{completedForMe.length}</span>
      </div>

      {error && (
        <div className="mx-4 mt-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}

      <div className="divide-y divide-[#A7F3D0]/40">
        {completedForMe.map((t) => {
          const who = t.completed_by ? nameByUserId.get(t.completed_by) ?? null : null
          return (
            <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-[#065F46] leading-snug">{t.title}</div>
                <div className="text-[10.5px] text-[#059669] mt-0.5">
                  {/* An unlinked login can't be named client-side (see the
                      two-name-spaces rule) — "Someone" beats a wrong guess. */}
                  {who ? taskFirstName(who) : 'Someone'} finished it
                  {t.done_at ? ` · ${formatDoneAt(t.done_at)}` : ''}
                </div>
              </div>
              <button
                onClick={() => void handleClose(t.id)}
                disabled={busyId === t.id}
                className="flex-shrink-0 px-2.5 py-1 rounded-md border border-[#059669] text-[#047857] bg-white text-[11px] font-medium hover:bg-[#D1FAE5] disabled:opacity-50 transition-colors"
              >
                {busyId === t.id ? 'Closing…' : 'Close out'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

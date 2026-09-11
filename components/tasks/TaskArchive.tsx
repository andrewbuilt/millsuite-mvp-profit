'use client'

// ============================================================================
// TaskArchive — completed work, kept forever, collapsed by default.
// ============================================================================
// This replaces the old "Done" section, which showed the last seven days and
// then dropped things on the floor. Two consequences worth knowing:
//
//   · COMPLETED TASKS ARE NO LONGER LOADED WITH THE LIST. The open list is a
//     few dozen rows; the archive grows forever, and fetching a shop's whole
//     history on every page load to render a COLLAPSED section would be
//     absurd. It loads when someone opens it (`onOpen`).
//
//   · IT RESPECTS THE PERSON FILTER. The caller passes tasks already filtered,
//     so "Hunter + Archive" is Hunter's archive — that's the feature Andrew
//     asked for, and it's why this doesn't do its own filtering.
//
// Grouped by month once it's long enough to need it, newest first. Restoring
// is the same checkbox action as anywhere else: clearing `done_at` moves the
// row back into its bucket.
// ============================================================================

import { useMemo } from 'react'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { ARCHIVE_PAGE_SIZE, archiveMonthLabel, formatDoneAt, type Task, type TaskTag } from '@/lib/tasks'
import { TaskTagChip } from './TaskTagChip'

/** Past this many rows the flat list stops being scannable and we group. */
const GROUP_THRESHOLD = 12

export function TaskArchive({
  tasks,
  open,
  onToggle,
  loading,
  loaded,
  truncated,
  onRestore,
  taskTags,
  /** 'panel' is the 420px rail; 'page' is the full-width /tasks layout. */
  variant = 'panel',
}: {
  tasks: Task[]
  open: boolean
  onToggle: () => void
  loading: boolean
  loaded: boolean
  truncated: boolean
  onRestore: (task: Task) => void
  taskTags: TaskTag[]
  variant?: 'panel' | 'page'
}) {
  const groups = useMemo(() => {
    if (tasks.length <= GROUP_THRESHOLD) return [{ label: '', tasks }]
    const out: Array<{ label: string; tasks: Task[] }> = []
    for (const t of tasks) {
      const label = archiveMonthLabel(t.done_at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.tasks.push(t)
      else out.push({ label, tasks: [t] })
    }
    return out
  }, [tasks])

  const wrapper =
    variant === 'page'
      ? 'mt-6 bg-white border border-[#E5E7EB] rounded-xl p-3'
      : 'mt-2 border-t border-[#F3F4F6] pt-3'

  return (
    <section className={wrapper}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] hover:text-[#6B7280]"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {/* No count until it's loaded — a "0" that means "not fetched yet"
            reads as "you've never finished anything". */}
        Archive{loaded ? ` · ${tasks.length}` : ''}
      </button>

      {open && (
        <div className="mt-2">
          {loading && !loaded ? (
            <div className="text-[11.5px] text-[#9CA3AF] italic py-1">Loading archive…</div>
          ) : tasks.length === 0 ? (
            <div className="text-[11.5px] text-[#D1D5DB] italic py-1">
              Nothing completed yet.
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.label || 'all'} className="mb-2">
                  {g.label && (
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#D1D5DB] mt-2 mb-0.5">
                      {g.label}
                    </div>
                  )}
                  <div
                    className={
                      variant === 'page'
                        ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4'
                        : ''
                    }
                  >
                    {g.tasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-start gap-2 py-1.5 text-[13px] text-[#9CA3AF] min-w-0"
                      >
                        <button
                          onClick={() => onRestore(t)}
                          title="Restore"
                          className="mt-0.5 w-4 h-4 rounded border border-[#A7F3D0] bg-[#ECFDF5] text-[#059669] flex items-center justify-center flex-shrink-0"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="line-through truncate">{t.title}</div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {/* When it was finished — the point of keeping it. */}
                            <span className="text-[10px] text-[#C9CED6]">
                              {formatDoneAt(t.done_at)}
                            </span>
                            {t.tags.map((tag) => (
                              <TaskTagChip
                                key={tag}
                                name={tag}
                                registry={taskTags}
                                size="xs"
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* No silent caps: if the archive is longer than we loaded, say
                  so, or it reads as "that's everything". */}
              {truncated && (
                <div className="text-[10.5px] text-[#9CA3AF] italic mt-1">
                  Showing the {ARCHIVE_PAGE_SIZE.toLocaleString()} most recently
                  completed tasks.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

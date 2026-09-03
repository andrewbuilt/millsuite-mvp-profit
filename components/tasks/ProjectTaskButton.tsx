'use client'

// ============================================================================
// ProjectTaskButton — "+ Task" + "Tasks · N" for a project page header.
// ============================================================================
// Quick-create pre-linked to THIS project: title, bucket, assignees, in a
// small popover. Deliberately not the full drawer — the whole point is to
// capture a thought without leaving the project. Anything more (comments,
// re-linking, delete) is one click away in the panel, which the "Tasks · N"
// affordance opens pre-filtered to this project.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { BUCKET_LABEL, TASK_BUCKETS, createTask, type TaskBucket } from '@/lib/tasks'
import { useTasksOptional } from './TasksProvider'

export default function ProjectTaskButton({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const ctx = useTasksOptional()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [bucket, setBucket] = useState<TaskBucket>('today')
  const [assignees, setAssignees] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Click-away. Same pattern as the kanban's kebab menu.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!ctx || !ctx.enabled) return null
  const openCount = ctx.openCountByProject[projectId] || 0

  async function save() {
    const t = title.trim()
    if (!t || !user || saving) return
    setSaving(true)
    setError(null)
    try {
      await createTask({
        orgId: user.org_id,
        title: t,
        bucket,
        projectId,
        assigneeIds: assignees,
        createdBy: user.id,
      })
      await ctx!.refresh()
      setTitle('')
      setAssignees([])
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the task.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-2">
      {openCount > 0 && (
        <button
          onClick={() => ctx.openPanel({ projectId })}
          title="Open this project's tasks"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111] transition-colors"
        >
          <ListChecks className="w-3.5 h-3.5" />
          Tasks · {openCount}
        </button>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2563EB] bg-white border border-[#2563EB] rounded-lg hover:bg-[#EFF6FF] transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Task
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-[300px] bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-2">
            New task on this project
          </div>
          {error && (
            <div className="mb-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1.5">
              {error}
            </div>
          )}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="What needs doing?"
            className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
          />
          <div className="flex items-center gap-1 flex-wrap mt-2">
            {TASK_BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                  bucket === b
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {BUCKET_LABEL[b]}
              </button>
            ))}
          </div>
          {ctx.assignees.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-2">
              {ctx.assignees.map((a) => {
                const on = assignees.includes(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      setAssignees((prev) =>
                        on ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                      )
                    }
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      on
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {(a.name || '').trim().split(/\s+/)[0] || a.name}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              disabled={saving || !title.trim()}
              onClick={() => void save()}
              className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add task'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

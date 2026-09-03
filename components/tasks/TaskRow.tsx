'use client'

// ============================================================================
// TaskRow — one task, shared by the drawer and /tasks.
// ============================================================================
// Extracted so the two surfaces can't drift: a task that renders one way in
// the panel and another on the page is how "why does it say something
// different over there" starts. Collapsed = checkbox, title, project chip,
// assignee chips. Expanded = edit title / bucket / project / assignees plus
// the comments thread.
// ============================================================================

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  BUCKET_LABEL,
  TASK_BUCKETS,
  addComment,
  deleteTask,
  listComments,
  setTaskDone,
  updateTask,
  type Task,
  type TaskComment,
} from '@/lib/tasks'
import type { TaskProjectRef } from './TasksProvider'

/** Chips are tight — a first name is enough to tell people apart in a shop. */
export function taskFirstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || full
}

const firstName = taskFirstName

export function TaskRow({
  task,
  project,
  projects,
  assignees,
  nameById,
  expanded,
  onToggleExpand,
  onRun,
  busy,
  orgId,
  userId,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task
  project: TaskProjectRef | null
  projects: TaskProjectRef[]
  assignees: { id: string; name: string }[]
  nameById: Map<string, string>
  expanded: boolean
  onToggleExpand: () => void
  onRun: (fn: () => Promise<unknown>) => Promise<void>
  busy: boolean
  orgId: string | undefined
  userId: string | null
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const [title, setTitle] = useState(task.title)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [loadedComments, setLoadedComments] = useState(false)

  // Comments load lazily — a list of forty tasks shouldn't fetch forty
  // threads nobody opened.
  useEffect(() => {
    if (!expanded || loadedComments) return
    void (async () => {
      setComments(await listComments(task.id))
      setLoadedComments(true)
    })()
  }, [expanded, loadedComments, task.id])

  useEffect(() => setTitle(task.title), [task.title])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-transparent hover:border-[#E5E7EB] hover:bg-[#FAFCFF] transition-colors ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start gap-2 px-1.5 py-1.5">
        <button
          onClick={() => void onRun(() => setTaskDone(task.id, true, orgId))}
          disabled={busy}
          title="Mark done"
          className="mt-0.5 w-4 h-4 rounded border border-[#D1D5DB] hover:border-[#059669] hover:bg-[#ECFDF5] flex-shrink-0 transition-colors"
        />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          <div className="text-[13px] text-[#111] leading-snug">{task.title}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {project ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF] max-w-[160px] truncate">
                {project.name}
              </span>
            ) : (
              // The sheet's plain TASK rows — no job attached, and that's fine.
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
                Task
              </span>
            )}
            {task.assignee_ids.map((id) => (
              <span
                key={id}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563]"
              >
                {firstName(nameById.get(id) || 'Unknown')}
              </span>
            ))}
          </div>
        </button>
      </div>

      {expanded && (
        <div className="px-1.5 pb-2.5 pt-1 border-t border-[#F3F4F6] mt-1 space-y-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== task.title) {
                void onRun(() => updateTask(task.id, { title }, orgId))
              }
            }}
            className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
          />

          <div className="flex items-center gap-1.5 flex-wrap">
            {TASK_BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => void onRun(() => updateTask(task.id, { bucket: b }, orgId))}
                className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                  task.bucket === b
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {BUCKET_LABEL[b]}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Project
            </span>
            <select
              value={task.project_id ?? ''}
              onChange={(e) =>
                void onRun(() =>
                  updateTask(task.id, { project_id: e.target.value || null }, orgId),
                )
              }
              className="w-full mt-0.5 px-2 py-1.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Assigned to
            </span>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {assignees.map((a) => {
                const on = task.assignee_ids.includes(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      void onRun(() =>
                        updateTask(
                          task.id,
                          {
                            assignee_ids: on
                              ? task.assignee_ids.filter((x) => x !== a.id)
                              : [...task.assignee_ids, a.id],
                          },
                          orgId,
                        ),
                      )
                    }
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      on
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {firstName(a.name)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Comments — the sheet's Notes column, but as a running thread so
              "Ordered, ETA 9/3" doesn't overwrite last week's note. */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Updates
            </span>
            <div className="mt-1 space-y-1.5">
              {comments.map((c) => (
                <div key={c.id} className="text-[12px] text-[#374151] leading-snug">
                  <span className="text-[#9CA3AF]">
                    {firstName(nameById.get(c.author_user_id || '') || 'Someone')} ·{' '}
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                  <div>{c.body}</div>
                </div>
              ))}
              {loadedComments && comments.length === 0 && (
                <div className="text-[11.5px] text-[#D1D5DB] italic">No updates yet.</div>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <input
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !commentBody.trim() || !orgId) return
                  const body = commentBody
                  setCommentBody('')
                  void (async () => {
                    const c = await addComment({
                      orgId,
                      taskId: task.id,
                      body,
                      authorUserId: userId,
                    })
                    setComments((prev) => [...prev, c])
                  })()
                }}
                placeholder="Add an update…"
                className="flex-1 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <button
            onClick={() => void onRun(() => deleteTask(task.id, orgId))}
            className="inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#DC2626]"
          >
            <Trash2 className="w-3 h-3" /> Delete task
          </button>
        </div>
      )}
    </div>
  )
}

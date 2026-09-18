'use client'

// ============================================================================
// TaskRow — one task, shared by the drawer and /tasks.
// ============================================================================
// Extracted so the two surfaces can't drift: a task that renders one way in
// the panel and another on the page is how "why does it say something
// different over there" starts. Collapsed = checkbox, title, project chip,
// tags, assignee chips. Expanded = edit everything, plus links and the
// comments thread.
//
// ⛔ THE COLLAPSED ROW IS NOT ONE BUTTON ANY MORE. It used to wrap the title
// AND the chip row in a single <button onClick={expand}>, which made the
// project chip unlinkable — an <a> inside a <button> is invalid HTML and
// browsers disagree about what to do with it, so `stopPropagation` alone
// wouldn't have fixed it. The title is now the expand affordance and the chip
// row is its sibling, which also means the project chip is a REAL link:
// cmd-click and middle-click open the project in a new tab, which a div with
// an onClick could never do.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Link2, Plus, Trash2, X } from 'lucide-react'
import {
  BUCKET_LABEL,
  TASK_BUCKETS,
  addComment,
  deleteTask,
  formatDoneAt,
  listComments,
  pastDueDays,
  setTaskDone,
  updateTask,
  type Task,
  type TaskComment,
  type TaskLink,
  type TaskTag,
} from '@/lib/tasks'
import { linkDisplayText, linkifyParts, normalizeLinkUrl } from '@/lib/task-links'
import type { TaskProjectRef } from './TasksProvider'
import { TaskTagChip } from './TaskTagChip'

/** Chips are tight — a first name is enough to tell people apart in a shop. */
export function taskFirstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || full
}

const firstName = taskFirstName

/** Comment bodies render with bare URLs turned into links. DISPLAY ONLY —
 *  `linkifyParts` never rewrites what was stored, and every href it returns
 *  has been through the scheme allowlist. */
function CommentBody({ body }: { body: string }) {
  return (
    <div className="break-words">
      {linkifyParts(body).map((p, i) =>
        p.kind === 'link' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2563EB] hover:underline break-all"
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  )
}

export function TaskRow({
  task,
  project,
  projects,
  assignees,
  nameById,
  nameByUserId,
  taskTags,
  onAddTag,
  extrasAvailable,
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
  /** ROSTER id → name (assignees). */
  nameById: Map<string, string>
  /** LOGIN id → name (created_by, comment authors). A different id space —
   *  see the header of lib/tasks. */
  nameByUserId: Map<string, string>
  taskTags: TaskTag[]
  /** Create a tag in the org registry and return it, so the row can apply a
   *  brand-new tag in one gesture. */
  onAddTag: (name: string) => Promise<void>
  /** False on a pre-098 database: links and tags hide entirely rather than
   *  offering a control whose every save would throw. */
  extrasAvailable: boolean
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
  const [newLink, setNewLink] = useState('')
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [addingLink, setAddingLink] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)

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

  /** Who added this task. Resolvable only for logins linked to a roster row —
   *  we render nothing rather than "Unknown", which would otherwise appear on
   *  every task in a shop that hasn't done the /team linking pass. */
  const addedBy = task.created_by ? nameByUserId.get(task.created_by) ?? null : null

  const doneLabel = useMemo(() => formatDoneAt(task.done_at), [task.done_at])

  /** "Past due · Nd" — a not-done Today task that entered the bucket on a
   *  previous day (migration 112). One computation here covers all three
   *  surfaces that render this row: the drawer, /tasks and /pm's Today card.
   *  0 everywhere it doesn't apply — other buckets, done, or no stamp. */
  const pastDue = pastDueDays(task)

  async function saveLinks(next: TaskLink[]) {
    await onRun(() => updateTask(task.id, { links: next }, orgId))
  }

  function handleAddLink() {
    const url = normalizeLinkUrl(newLink)
    if (!url) {
      setLinkError('That doesn’t look like a web address.')
      return
    }
    setLinkError(null)
    const label = newLinkLabel.trim()
    setNewLink('')
    setNewLinkLabel('')
    setAddingLink(false)
    void saveLinks([...task.links, label ? { url, label } : { url }])
  }

  function toggleTag(name: string) {
    const on = task.tags.some((t) => t.toLowerCase() === name.toLowerCase())
    const next = on
      ? task.tags.filter((t) => t.toLowerCase() !== name.toLowerCase())
      : [...task.tags, name]
    void onRun(() => updateTask(task.id, { tags: next }, orgId))
  }

  function handleCreateTag() {
    const name = newTag.trim()
    if (!name) return
    setNewTag('')
    setAddingTag(false)
    // ⛔ BOTH HALVES GO THROUGH onRun. The org write (onAddTag → updateOrgChecked)
    // used to sit outside it, so an RLS or network failure there surfaced as an
    // unhandled rejection: no error banner, no busy state, and the tag input
    // just vanished as though it had worked.
    void onRun(async () => {
      await onAddTag(name)
      if (!task.tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
        await updateTask(task.id, { tags: [...task.tags, name] }, orgId)
      }
    })
  }

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
          onClick={() => void onRun(() => setTaskDone(task.id, !task.done_at, orgId))}
          disabled={busy}
          title={task.done_at ? 'Restore' : 'Mark done'}
          className="mt-0.5 w-4 h-4 rounded border border-[#D1D5DB] hover:border-[#059669] hover:bg-[#ECFDF5] flex-shrink-0 transition-colors"
        />
        {/* Title expands; the chips below are siblings so the project chip can
            be a real anchor. See the header. */}
        <div className="flex-1 min-w-0">
          <button
            onClick={onToggleExpand}
            className="w-full text-left cursor-pointer text-[13px] text-[#111] leading-snug"
          >
            {task.title}
          </button>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {pastDue > 0 && (
              <span
                title={
                  task.bucket_changed_at
                    ? `In Today since ${new Date(task.bucket_changed_at).toLocaleDateString()}`
                    : undefined
                }
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] font-medium whitespace-nowrap"
              >
                Past due · {pastDue}d
              </span>
            )}
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                // The row is draggable and the title toggles — neither should
                // fire because someone clicked through to the job.
                onClick={(e) => e.stopPropagation()}
                draggable={false}
                title={`Open ${project.name}`}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF] max-w-[160px] truncate hover:bg-[#DBEAFE] hover:underline"
              >
                {project.name}
              </Link>
            ) : (
              // The sheet's plain TASK rows — no job attached, and that's fine.
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
                Task
              </span>
            )}
            {task.tags.map((t) => (
              <TaskTagChip key={t} name={t} registry={taskTags} size="xs" />
            ))}
            {task.links.length > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-[#9CA3AF]"
                title={`${task.links.length} link${task.links.length === 1 ? '' : 's'}`}
              >
                <Link2 className="w-2.5 h-2.5" />
                {task.links.length}
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
        </div>
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

          {/* Who put this on the list.
              ⚠️ The "Done" half is defensive, not live: `tasks` is open-only
              now, so a TaskRow's `done_at` is always null and the completion
              stamp is rendered by TaskArchive instead. It stays because this
              row is the one place a task is described in full, and the day an
              archive row becomes expandable it must not quietly lack it. */}
          {(addedBy || doneLabel) && (
            <div className="text-[10.5px] text-[#9CA3AF] flex items-center gap-2 flex-wrap">
              {addedBy && <span>Added by {addedBy}</span>}
              {addedBy && doneLabel && <span aria-hidden>·</span>}
              {doneLabel && <span>Done {doneLabel}</span>}
            </div>
          )}

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

          {/* Tags and links only exist once 098 has run. Hiding them beats
              showing a control that throws on every save. */}
          {extrasAvailable && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Tags
              </span>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                {taskTags.map((t) => {
                  const on = task.tags.some((x) => x.toLowerCase() === t.name.toLowerCase())
                  return (
                    <button key={t.name} onClick={() => toggleTag(t.name)}>
                      <span className={on ? '' : 'opacity-40 grayscale'}>
                        <TaskTagChip name={t.name} registry={taskTags} />
                      </span>
                    </button>
                  )
                })}
                {/* A tag on this task that's no longer in the registry — still
                    shown, and still removable. */}
                {task.tags
                  .filter((t) => !taskTags.some((r) => r.name.toLowerCase() === t.toLowerCase()))
                  .map((t) => (
                    <TaskTagChip
                      key={t}
                      name={t}
                      registry={taskTags}
                      onRemove={() => toggleTag(t)}
                    />
                  ))}
                {addingTag ? (
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateTag()
                      if (e.key === 'Escape') {
                        setAddingTag(false)
                        setNewTag('')
                      }
                    }}
                    onBlur={() => {
                      setAddingTag(false)
                      setNewTag('')
                    }}
                    placeholder="Tag name…"
                    className="text-[11px] px-2 py-0.5 w-[110px] border border-[#E5E7EB] rounded-full focus:outline-none focus:border-[#2563EB]"
                  />
                ) : (
                  <button
                    onClick={() => setAddingTag(true)}
                    className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[#D1D5DB] text-[#9CA3AF] hover:border-[#2563EB] hover:text-[#2563EB]"
                  >
                    <Plus className="w-2.5 h-2.5" /> Tag
                  </button>
                )}
              </div>
            </div>
          )}

          {extrasAvailable && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Links
              </span>
              <div className="mt-1 space-y-1">
                {task.links.map((l, i) => (
                  <div key={`${l.url}-${i}`} className="flex items-center gap-1.5">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 inline-flex items-center gap-1 text-[12px] text-[#2563EB] hover:underline truncate"
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{l.label || linkDisplayText(l.url)}</span>
                    </a>
                    <button
                      onClick={() => void saveLinks(task.links.filter((_, j) => j !== i))}
                      aria-label="Remove link"
                      className="p-0.5 text-[#D1D5DB] hover:text-[#DC2626] flex-shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {task.links.length === 0 && !addingLink && (
                  <div className="text-[11.5px] text-[#D1D5DB] italic">No links.</div>
                )}
              </div>
              {addingLink ? (
                <div className="mt-1.5 space-y-1.5">
                  <input
                    autoFocus
                    value={newLink}
                    onChange={(e) => {
                      setNewLink(e.target.value)
                      setLinkError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddLink()
                      if (e.key === 'Escape') {
                        setAddingLink(false)
                        setNewLink('')
                        setLinkError(null)
                      }
                    }}
                    placeholder="Paste a link…"
                    className="w-full px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                  />
                  <input
                    value={newLinkLabel}
                    onChange={(e) => setNewLinkLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddLink()
                    }}
                    placeholder="Label (optional)"
                    className="w-full px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                  />
                  {linkError && (
                    <div className="text-[11px] text-[#B91C1C]">{linkError}</div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleAddLink}
                      className="px-2 py-0.5 rounded-md bg-[#2563EB] text-white text-[11.5px] hover:bg-[#1D4ED8]"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingLink(false)
                        setNewLink('')
                        setNewLinkLabel('')
                        setLinkError(null)
                      }}
                      className="px-2 py-0.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[11.5px] hover:bg-[#F9FAFB]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingLink(true)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#2563EB]"
                >
                  <Plus className="w-3 h-3" /> Add link
                </button>
              )}
            </div>
          )}

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
                    {/* ⛔ nameByUserId, NOT nameById. This used to look a LOGIN
                        id up in the ROSTER map, so it never matched and every
                        comment in the system was attributed to "Someone". */}
                    {firstName(nameByUserId.get(c.author_user_id || '') || 'Someone')} ·{' '}
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                  <CommentBody body={c.body} />
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

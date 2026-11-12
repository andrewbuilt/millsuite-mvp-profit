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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { AlertTriangle, AlignLeft, CalendarDays, Check, ExternalLink, GripVertical, Link2, Plus, Trash2, X } from 'lucide-react'
import {
  addComment,
  deleteTask,
  formatDoneAt,
  formatNeedBy,
  isUnseenBy,
  listComments,
  localISO,
  taskGroup,
  pastDueDays,
  setTaskDone,
  updateTask,
  type Task,
  type TaskComment,
  type TaskLink,
  type TaskTag,
} from '@/lib/tasks'
import { linkDisplayText, linkifyParts, normalizeLinkUrl } from '@/lib/task-links'
import NeedByPicker from './NeedByPicker'
import { pickableProjects, useTasksOptional, type TaskProjectRef } from './TasksProvider'
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
  const [description, setDescription] = useState(task.description ?? '')
  useEffect(() => setDescription(task.description ?? ''), [task.description])
  const descRef = useRef<HTMLTextAreaElement>(null)
  // Autogrow, same as the title.
  useLayoutEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`
  }, [description, expanded])
  const ctx = useTasksOptional()
  const myAssigneeId = ctx?.myAssigneeId ?? null
  const markSeen = ctx?.markSeen
  /** 133: mine and never opened — bold + blue dot here, blue nav badge. */
  const unseen = isUnseenBy(task, myAssigneeId)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Opening the detail = "seen" (clears the blue badge for this task).
  useEffect(() => {
    if (expanded && unseen && markSeen) markSeen(task)
  }, [expanded, unseen, markSeen, task])

  // The modal: Escape closes, and the page behind doesn't scroll.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleExpand()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [expanded, onToggleExpand])
  // ⛔ DRAG STARTS FROM THE HANDLE ONLY (Nov batch 2 #3). The whole row used
  // to be `draggable`, so trying to select the title text — collapsed or in
  // the edit field — picked up the card instead. The row is draggable only
  // while the grip is held down.
  const [dragArmed, setDragArmed] = useState(false)
  useEffect(() => {
    if (!dragArmed) return
    // Released without dragging (anywhere on the page) → disarm, or the row
    // would stay draggable and swallow the next text selection.
    const off = () => setDragArmed(false)
    window.addEventListener('mouseup', off)
    return () => window.removeEventListener('mouseup', off)
  }, [dragArmed])
  const titleRef = useRef<HTMLTextAreaElement>(null)
  // Autogrow: the edit field wraps and grows with the title instead of being
  // an endless one-line input.
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title, expanded])
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

  const sectionLabel = 'text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]'

  return (
    <div
      draggable={dragArmed}
      onDragStart={(e) => {
        if (!dragArmed) {
          e.preventDefault()
          return
        }
        onDragStart()
      }}
      onDragEnd={() => {
        setDragArmed(false)
        onDragEnd()
      }}
      className={`relative rounded-lg border transition-colors ${
        expanded
          ? 'border-[#BFDBFE] bg-[#EFF6FF]'
          : task.critical
            ? 'border-[#FECACA] bg-[#FFF7F7] hover:bg-[#FEF2F2]'
            : 'border-transparent hover:border-[#E5E7EB] hover:bg-[#FAFCFF]'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="group flex items-start gap-2 px-1.5 py-1.5">
        <span
          onMouseDown={() => setDragArmed(true)}
          title="Drag to move"
          className="-ml-1 -mr-1.5 mt-0.5 text-[#D1D5DB] opacity-0 group-hover:opacity-100 hover:text-[#6B7280] cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>
        <button
          // `userId` = who's clicking — stamps completed_by for the creator's
          // "Completed for you" strip (114).
          onClick={() => void onRun(() => setTaskDone(task.id, !task.done_at, orgId, userId))}
          disabled={busy}
          title={task.done_at ? 'Restore' : 'Mark done'}
          className="mt-0.5 w-4 h-4 rounded border border-[#D1D5DB] hover:border-[#059669] hover:bg-[#ECFDF5] flex-shrink-0 transition-colors"
        />
        {/* Title opens the detail modal; the chips below are siblings so the
            project chip can be a real anchor. See the header. */}
        <div className="flex-1 min-w-0">
          <div
            role="button"
            tabIndex={0}
            // A click opens; a drag-select (text highlighted) doesn't, so
            // the title can be copied without opening the task.
            onClick={() => {
              if (window.getSelection()?.toString()) return
              onToggleExpand()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggleExpand()
              }
            }}
            // Wraps, never truncates (October batch item 6): the full title
            // always reads. `whitespace-normal` + overflow-wrap so a pasted
            // URL or long part number breaks instead of running off the row.
            className={`w-full text-left cursor-pointer select-text text-[13px] text-[#111] leading-snug whitespace-normal [overflow-wrap:anywhere] ${
              unseen ? 'font-semibold' : ''
            }`}
          >
            {unseen && (
              <span
                title="New — you haven't opened this yet"
                className="inline-block w-1.5 h-1.5 rounded-full bg-[#2563EB] mr-1.5 align-middle -mt-0.5"
              />
            )}
            {task.title}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {task.critical && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#DC2626] text-white font-semibold whitespace-nowrap">
                <AlertTriangle className="w-2.5 h-2.5" /> Critical
              </span>
            )}
            {/* Overdue = need_by < today; the count is days past it (132 —
                one truth, the old bucket clock is retired). Otherwise the
                date chip, except in the groups whose name already says it. */}
            {pastDue > 0 ? (
              <span
                title={`Needed by ${formatNeedBy(task.need_by)}`}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] font-medium whitespace-nowrap"
              >
                Overdue · {pastDue}d
              </span>
            ) : task.need_by && !['today'].includes(taskGroup(task.need_by, localISO())) ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#4B5563] whitespace-nowrap">
                {formatNeedBy(task.need_by)}
              </span>
            ) : null}
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                // The row is draggable and the title opens — neither should
                // fire because someone clicked through to the job.
                onClick={(e) => e.stopPropagation()}
                draggable={false}
                title={`Open ${project.name}`}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF] max-w-full whitespace-normal [overflow-wrap:anywhere] text-left hover:bg-[#DBEAFE] hover:underline"
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
            {task.description && (
              <span className="inline-flex text-[#9CA3AF]" title="Has a description">
                <AlignLeft className="w-3 h-3" />
              </span>
            )}
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

      {/* ⛔ THE DETAIL IS A MODAL NOW (Andrew, 2026-11-12: "open a modal for
          this task so you can focus on it"). It used to unfold inline under
          the row, which in a 230px kanban column or the drawer meant editing
          in a slot. Portaled to <body> so it sits above the drawer (z-61)
          and isn't clipped by any column's overflow. `expanded` /
          onToggleExpand are unchanged, so every surface got this for free. */}
      {expanded &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-0 sm:p-6 bg-[#0F172A]/40 backdrop-blur-[2px]"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) onToggleExpand()
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={task.title}
              className="relative w-full sm:max-w-[680px] h-full sm:h-auto sm:max-h-[88vh] bg-white sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >

              {/* Header — complete, title, close */}
              <div className="flex items-start gap-3 px-5 sm:px-6 pt-5 pb-3 flex-shrink-0">
                <button
                  onClick={() => void onRun(() => setTaskDone(task.id, !task.done_at, orgId, userId))}
                  disabled={busy}
                  title={task.done_at ? 'Restore' : 'Mark done'}
                  className="mt-1.5 w-5 h-5 rounded-md border-2 border-[#D1D5DB] hover:border-[#059669] hover:bg-[#ECFDF5] flex-shrink-0 transition-colors"
                />
                <div className="flex-1 min-w-0">
                  <textarea
                    ref={titleRef}
                    rows={1}
                    value={title}
                    // A title is one line of meaning: Enter saves rather than
                    // adding a newline, and pasted newlines fold to spaces.
                    onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, ' '))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                      }
                    }}
                    onBlur={() => {
                      if (title.trim() && title !== task.title) {
                        void onRun(() => updateTask(task.id, { title }, orgId))
                      }
                    }}
                    className="w-full -mx-1.5 px-1.5 py-0.5 text-[19px] font-semibold text-[#111] leading-snug border border-transparent rounded-md resize-none overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere] hover:border-[#E5E7EB] focus:outline-none focus:border-[#2563EB]"
                  />
                  <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[11.5px] text-[#6B7280]">
                    {task.critical && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#DC2626] text-white font-semibold text-[10.5px]">
                        <AlertTriangle className="w-3 h-3" /> Critical
                      </span>
                    )}
                    {pastDue > 0 ? (
                      <span className="px-1.5 py-0.5 rounded bg-[#FEF2F2] text-[#B91C1C] font-medium">
                        Overdue · {pastDue}d
                      </span>
                    ) : task.need_by ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="w-3.5 h-3.5" /> Needed {formatNeedBy(task.need_by)}
                      </span>
                    ) : null}
                    {project && (
                      <Link
                        href={`/projects/${project.id}`}
                        className="px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF] hover:bg-[#DBEAFE] hover:underline"
                      >
                        {project.name}
                      </Link>
                    )}
                    {/* Who put this on the list. ⚠️ The "Done" half is
                        defensive: `tasks` is open-only, so done_at is null
                        here; it stays so a future expandable archive row
                        doesn't quietly lack it. */}
                    {addedBy && <span>Added by {addedBy}</span>}
                    {doneLabel && <span>Done {doneLabel}</span>}
                  </div>
                </div>
                <button
                  onClick={onToggleExpand}
                  aria-label="Close"
                  className="p-1.5 -mr-1.5 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 pb-5 space-y-5 border-t border-[#F3F4F6] pt-4">
                {/* Description (134) — free text, saved on blur. */}
                <div>
                  <div className={`${sectionLabel} mb-1.5`}>Description</div>
                  <textarea
                    ref={descRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => {
                      if ((description.trim() || null) !== (task.description?.trim() || null)) {
                        void onRun(() => updateTask(task.id, { description }, orgId))
                      }
                    }}
                    placeholder="Add details, specs, who to call…"
                    className="w-full px-3 py-2 text-[13.5px] leading-relaxed text-[#111] border border-[#E5E7EB] rounded-lg resize-none overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
                  />
                </div>

                <div className="grid sm:grid-cols-[110px_1fr] gap-x-4 gap-y-4 items-start">
                  <span className={`${sectionLabel} sm:pt-1.5`}>Needed by</span>
                  <NeedByPicker
                    size="md"
                    value={task.need_by}
                    critical={task.critical}
                    onChange={(d, critical) =>
                      void onRun(() => updateTask(task.id, { need_by: d, critical }, orgId))
                    }
                  />

                  <span className={`${sectionLabel} sm:pt-2`}>Project</span>
                  <select
                    value={task.project_id ?? ''}
                    onChange={(e) =>
                      void onRun(() =>
                        updateTask(task.id, { project_id: e.target.value || null }, orgId),
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="">No project</option>
                    {pickableProjects(projects, task.project_id).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <span className={`${sectionLabel} sm:pt-1.5`}>Assigned to</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
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
                          className={`text-[12.5px] px-2.5 py-1 rounded-full border transition-colors ${
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

                  {/* Tags and links only exist once 098 has run. Hiding them
                      beats showing a control that throws on every save. */}
                  {extrasAvailable && (
                    <>
                      <span className={`${sectionLabel} sm:pt-1.5`}>Tags</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
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
                        {/* A tag on this task that's no longer in the registry —
                            still shown, and still removable. */}
                        {task.tags
                          .filter((t) => !taskTags.some((r) => r.name.toLowerCase() === t.toLowerCase()))
                          .map((t) => (
                            <TaskTagChip key={t} name={t} registry={taskTags} onRemove={() => toggleTag(t)} />
                          ))}
                        {addingTag ? (
                          <input
                            autoFocus
                            value={newTag}
                            onChange={(e) => setNewTag(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCreateTag()
                              if (e.key === 'Escape') {
                                e.stopPropagation()
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

                      <span className={`${sectionLabel} sm:pt-1`}>Links</span>
                      <div>
                        <div className="space-y-1">
                          {task.links.map((l, i) => (
                            <div key={`${l.url}-${i}`} className="flex items-center gap-1.5">
                              <a
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 min-w-0 inline-flex items-center gap-1 text-[13px] text-[#2563EB] hover:underline truncate"
                              >
                                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{l.label || linkDisplayText(l.url)}</span>
                              </a>
                              <button
                                onClick={() => void saveLinks(task.links.filter((_, j) => j !== i))}
                                aria-label="Remove link"
                                className="p-0.5 text-[#D1D5DB] hover:text-[#DC2626] flex-shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
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
                                  e.stopPropagation()
                                  setAddingLink(false)
                                  setNewLink('')
                                  setLinkError(null)
                                }
                              }}
                              placeholder="Paste a link…"
                              className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
                            />
                            <input
                              value={newLinkLabel}
                              onChange={(e) => setNewLinkLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddLink()
                              }}
                              placeholder="Label (optional)"
                              className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
                            />
                            {linkError && <div className="text-[11.5px] text-[#B91C1C]">{linkError}</div>}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={handleAddLink}
                                className="px-2.5 py-1 rounded-md bg-[#2563EB] text-white text-[12px] hover:bg-[#1D4ED8]"
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
                                className="px-2.5 py-1 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingLink(true)}
                            className={`${task.links.length ? 'mt-1.5' : ''} inline-flex items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#2563EB]`}
                          >
                            <Plus className="w-3.5 h-3.5" /> Add link
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Updates — the sheet's Notes column, but as a running thread
                    so "Ordered, ETA 9/3" doesn't overwrite last week's note. */}
                <div className="rounded-xl bg-[#F9FAFB] border border-[#F3F4F6] p-3.5">
                  <div className={`${sectionLabel} mb-2`}>Updates</div>
                  <div className="space-y-2.5">
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-white border border-[#E5E7EB] text-[10px] font-semibold text-[#6B7280] flex items-center justify-center flex-shrink-0">
                          {/* ⛔ nameByUserId, NOT nameById. This used to look
                              a LOGIN id up in the ROSTER map, so it never
                              matched and every comment in the system was
                              attributed to "Someone". */}
                          {firstName(nameByUserId.get(c.author_user_id || '') || 'Someone').slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1 text-[13px] text-[#374151] leading-snug">
                          <div className="text-[11px] text-[#9CA3AF]">
                            {firstName(nameByUserId.get(c.author_user_id || '') || 'Someone')} ·{' '}
                            {new Date(c.created_at).toLocaleDateString()}
                          </div>
                          <CommentBody body={c.body} />
                        </div>
                      </div>
                    ))}
                    {loadedComments && comments.length === 0 && (
                      <div className="text-[12px] text-[#9CA3AF] italic">No updates yet.</div>
                    )}
                  </div>
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
                    placeholder="Add an update… (Enter to post)"
                    className="w-full mt-3 px-3 py-2 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 px-5 sm:px-6 py-3 border-t border-[#F3F4F6] bg-white flex-shrink-0">
                <button
                  onClick={() => void onRun(() => deleteTask(task.id, orgId))}
                  className="inline-flex items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#DC2626]"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete task
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onToggleExpand}
                    className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[12.5px] text-[#374151] hover:bg-[#F9FAFB]"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => void onRun(() => setTaskDone(task.id, !task.done_at, orgId, userId))}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#059669] text-white text-[12.5px] font-medium hover:bg-[#047857] disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> {task.done_at ? 'Restore' : 'Mark done'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

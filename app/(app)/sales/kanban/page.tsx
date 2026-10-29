'use client'

// ============================================================================
// /sales/kanban — sales pipeline Kanban
// ============================================================================
// Five columns driven by projects.stage: new_lead / fifty_fifty /
// ninety_percent / sold / lost. Dragging a card writes the stage.
// Post-sold stages (production / installed / complete) don't show here —
// they all roll up to 'Sold' in the sales view; those projects are the
// shop's problem and live on the project cover.
//
// 2026-10-29 — one board language: the column + card shells are shared with
// /projects (components/kanban). Pipeline cards wear the ATTENTION RING
// (lib/attention); every column is NEWEST AT TOP, keyed on the clock, so a
// column literally darkens downward. Sold groups by progress (new sale →
// pre-prod → production → installed → complete), newest-first within; sold
// and lost cards never age here.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import {
  SALES_STAGES,
  STAGE_LABEL,
  SalesProject,
  SalesStage,
  addProjectNote,
  deleteProject,
  loadSalesProjects,
  updateProjectStage,
} from '@/lib/sales'
import { useConfirm } from '@/components/confirm-dialog'
import NewProjectModal from '@/components/sales/NewProjectModal'
import { announce } from '@/lib/tour-events'
import Link from 'next/link'
import { StickyNote, ArrowRight, Trash2, Plus, Search, X, Copy, Archive, Handshake } from 'lucide-react'
import { confirmAndArchive } from '@/lib/project-archive'
import { DuplicateProjectModal } from '@/components/project/DuplicateProjectModal'
import { setProjectLostReason } from '@/lib/lead-sources'
import { matchesProjectSearch, normalizeQuery } from '@/lib/project-search'
import { coverStageOf, COVER_STAGE_LABEL, STAGE_COLORS } from '@/components/project/StagePill'
import type { ProjectStage } from '@/lib/types'
import PracticeBadge from '@/components/practice-badge'
import { usePracticeProjects } from '@/hooks/usePracticeProjects'
import { useTours } from '@/components/walkthroughs/TourProvider'
import KanbanColumn from '@/components/kanban/KanbanColumn'
import KanbanCard from '@/components/kanban/KanbanCard'
import TouchedBaseModal from '@/components/kanban/TouchedBaseModal'
import { ageAttention, boardOrder, newestFirst, type AgeAttention } from '@/lib/attention'
import { loadProjectTouches, type ProjectTouches } from '@/lib/attention-data'

/** What a SOLD card's badge says. Reuses the project page's cover-stage
 *  mapping, so "Pre-Production / In Production / Installed / Complete" stay
 *  worded identically in both places. */
function soldStageLabel(stage: ProjectStage): string {
  const cover = coverStageOf(stage)
  return cover === 'lost' ? 'Lost' : COVER_STAGE_LABEL[cover]
}

/** Chip colours for a sold card, from the one shared map.
 *  ⚠️ A sold-and-ready job shows pre-production amber here and green on the
 *  projects page — the board has no approval data on a card, so it can't tell
 *  them apart. Data gap, not a colour bug. */
function soldStageColors(stage: ProjectStage): { backgroundColor: string; color: string } {
  const c = STAGE_COLORS[coverStageOf(stage)]
  return { backgroundColor: c.bg, color: c.fg }
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const WEEK_MS = 7 * 86400000

/** In the current LOCAL calendar month. */
function inThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

/** Sold-column progress groups, in board order (Andrew 2026-10-29). */
function soldGroup(p: SalesProject, now: number): number {
  if (p.project_stage === 'sold') {
    const t = p.sold_at ? new Date(p.sold_at).getTime() : NaN
    return Number.isFinite(t) && now - t < WEEK_MS ? 0 : 1
  }
  return { production: 2, installed: 3, complete: 4 }[p.project_stage as string] ?? 5
}

const COLUMN_HINT: Record<SalesStage, string> = {
  new_lead: 'Just came in',
  fifty_fifty: 'Could go either way',
  ninety_percent: 'About to close',
  sold: 'Sold this month',
  lost: "Didn't happen",
}

export default function SalesKanbanPage() {
  return (
    <PlanGate requires="sales">
      <KanbanInner />
    </PlanGate>
  )
}

function KanbanInner() {
  const router = useRouter()
  const { org, user } = useAuth()
  const practiceIds = usePracticeProjects(org?.id)
  const { tourProjectId } = useTours()
  const { confirm } = useConfirm()

  const [projects, setProjects] = useState<SalesProject[]>([])
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<SalesStage | null>(null)
  const [noteFor, setNoteFor] = useState<SalesProject | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [dupFor, setDupFor] = useState<SalesProject | null>(null)
  const [lostReasonFor, setLostReasonFor] = useState<SalesProject | null>(null)
  const [lostReason, setLostReason] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [touches, setTouches] = useState<Record<string, ProjectTouches>>({})
  const [touchFor, setTouchFor] = useState<SalesProject | null>(null)

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const [{ projects }, t] = await Promise.all([loadSalesProjects(org.id), loadProjectTouches(org.id)])
      setProjects(projects)
      setTouches(t)
      setLoading(false)
    })()
  }, [org?.id])

  /** Pipeline cards only — sold and lost never age on this board. Keyed off
   *  the RAW stage, so a card dragged mid-session re-derives its clock. */
  const attention = useMemo(() => {
    const out: Record<string, AgeAttention | null> = {}
    const now = Date.now()
    for (const p of projects) {
      if (p.stage === 'sold' || p.stage === 'lost') continue
      out[p.id] = ageAttention(
        { stage: p.stage, created_at: p.created_at, estimate_sent_at: p.estimate_sent_at, lastTouch: touches[p.id]?.touch },
        now,
      )
    }
    return out
  }, [projects, touches])

  // Search filters ACROSS every column — the question "where is the Smith job?"
  // is exactly the one you can't answer by eye on a five-column board.
  // No debounce: this filters an array already in memory, so there's nothing to
  // wait for and a delay would just feel like lag.
  const columns = useMemo(() => {
    const out: Record<SalesStage, SalesProject[]> = {
      new_lead: [],
      fifty_fifty: [],
      ninety_percent: [],
      sold: [],
      lost: [],
    }
    const q = normalizeQuery(query)
    for (const p of projects) {
      if (!matchesProjectSearch(p, q)) continue
      // SOLD and LOST show THIS CALENDAR MONTH only (Andrew 2026-10-29): sold
      // work is tracked on the /projects board, lost lives in /archive. On
      // the 1st both columns start empty. A null date (pre-094 / pre-116) is
      // never "this month", so those cards leave too — they're still on
      // /projects or in the archive.
      if (p.stage === 'sold' && !inThisMonth(p.sold_at)) continue
      if (p.stage === 'lost' && !inThisMonth(p.lost_at)) continue
      out[p.stage]?.push(p)
    }
    // Newest at top, keyed on the attention clock (Andrew 2026-10-29) — the
    // oldest, reddest cards sink to the bottom where the eye lands last but
    // the colour still catches it.
    const now = Date.now()
    for (const s of ['new_lead', 'fifty_fifty', 'ninety_percent'] as const) {
      out[s].sort((a, b) =>
        boardOrder(
          { attention: attention[a.id], key: attention[a.id]?.since ?? a.created_at },
          { attention: attention[b.id], key: attention[b.id]?.since ?? b.created_at },
        ),
      )
    }
    const soldKey = (p: SalesProject) =>
      p.project_stage === 'sold' ? p.sold_at ?? null : touches[p.id]?.stageAt ?? p.updated_at
    out.sold.sort((a, b) => soldGroup(a, now) - soldGroup(b, now) || newestFirst(soldKey(a), soldKey(b)))
    out.lost.sort((a, b) => newestFirst(a.lost_at, b.lost_at))
    return out
  }, [projects, query, attention, touches])

  /** Total across the board, so an empty result reads as "nothing matched"
   *  rather than five empty columns that look like a broken page. */
  const matchCount = useMemo(
    () => SALES_STAGES.reduce((n, s) => n + columns[s].length, 0),
    [columns],
  )

  async function handleDrop(targetStage: SalesStage) {
    if (!dragId) return
    const project = projects.find((p) => p.id === dragId)
    setDragId(null)
    setDragOver(null)
    if (!project || project.stage === targetStage) return

    // Projects that are already post-sold (showing as 'sold' here but living
    // at production / installed / complete downstream) shouldn't be dragged
    // back into the pipeline — that would clobber the in-shop stage.
    if (project.stage === 'sold' && targetStage !== 'sold' && targetStage !== 'lost') {
      const ok = await confirm({
        title: 'Move this back into the pipeline?',
        message: `"${project.name}" is already sold or further along. Moving it back to ${STAGE_LABEL[targetStage]} will reset the stage.`,
        confirmLabel: 'Move anyway',
        variant: 'danger',
      })
      if (!ok) return
    }

    // Both stages move together. `stage` picks the column; `project_stage`
    // is what a sold card's badge reads — leave it stale and a card dragged
    // to Sold would announce itself as "Bidding" until the next reload.
    // targetStage is a SalesStage, which is a subset of ProjectStage, so
    // this is the correct raw value for every column the board offers.
    setProjects((prev) =>
      prev.map((p) =>
        p.id === project.id
          ? {
              ...p,
              stage: targetStage,
              project_stage: targetStage as ProjectStage,
              // Mirror the stamps updateProjectStage writes, so a card dragged
              // into Sold / Lost stays in the this-month column.
              sold_at: targetStage === 'sold' ? p.sold_at ?? new Date().toISOString() : p.sold_at,
              lost_at: targetStage === 'lost' ? new Date().toISOString() : null,
            }
          : p,
      ),
    )
    try {
      await updateProjectStage(project.id, targetStage)
      // The sell-it guide waits on the card actually landing in Sold.
      if (targetStage === 'sold') announce('ms:project-sold')
      // Why did it die? Asked AFTER the stage write succeeds — capture must
      // never block the drag (the spec's one hard rule). Skippable.
      if (targetStage === 'lost') setLostReasonFor(project)
    } catch (err) {
      console.error('updateProjectStage failed', err)
      // Reload to resync on failure.
      if (org?.id) {
        const { projects: fresh } = await loadSalesProjects(org.id)
        setProjects(fresh)
      }
    }
  }

  return (
    <>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#111]">Sales pipeline</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Drag between columns to advance the stage. Moving to Sold flips the project to active
              and opens the pre-production workflow.
            </p>
          </div>
          {/* Same control, same wording as the projects dashboard — one search
              box people learn once. */}
          <div className="relative flex-1 min-w-[200px] max-w-[320px] ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects or clients…"
              className="w-full pl-9 pr-9 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#111]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setNewOpen(true)}
            data-tour="kanban-new-project"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New project
          </button>
        </div>

        {/* An all-empty board is ambiguous — say which it is. */}
        {query && matchCount === 0 && !loading && (
          <div className="mb-3 text-sm text-[#6B7280]">
            No projects match “{query}”.
          </div>
        )}

        {loading ? (
          <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading…</div>
        ) : (
          <div className="grid grid-cols-5 gap-3" data-tour="kanban-board">
            {SALES_STAGES.map((stage) => {
              const cards = columns[stage]
              // The header sum: the card's own value (bid_total, falling back
              // to estimated_price) over the cards ACTUALLY IN THE COLUMN, so a
              // search narrows it with the board. Lost gets no sum (Andrew's
              // spec): totalling dead deals under a live pipeline reads as money.
              const columnSum =
                stage === 'lost' ? 0 : cards.reduce((s, p) => s + (p.bid_total || p.estimated_price || 0), 0)
              return (
                <KanbanColumn
                  key={stage}
                  title={STAGE_LABEL[stage]}
                  count={cards.length}
                  sum={columnSum}
                  hint={
                    stage === 'sold' ? (
                      <>
                        {COLUMN_HINT.sold} ·{' '}
                        <Link href="/projects" className="text-[#2563EB] hover:underline">
                          Projects →
                        </Link>
                      </>
                    ) : stage === 'lost' ? (
                      <Link href="/archive" className="text-[#2563EB] hover:underline">
                        Archive →
                      </Link>
                    ) : (
                      COLUMN_HINT[stage]
                    )
                  }
                  isOver={dragOver === stage}
                  onDragOver={() => setDragOver(stage)}
                  onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
                  onDrop={() => handleDrop(stage)}
                >
                  {cards.map((p) => (
                    <SalesCard
                      key={p.id}
                      project={p}
                      attention={attention[p.id] ?? null}
                      isPractice={practiceIds.has(p.id)}
                      isTourProject={p.id === tourProjectId}
                      onOpen={() => router.push(`/projects/${p.id}`)}
                      onQuickNote={() => { setNoteFor(p); setNoteBody('') }}
                      onTouchedBase={() => setTouchFor(p)}
                      onDuplicate={() => setDupFor(p)}
                      // Every card can be archived (Andrew 2026-10-22), not
                      // just lost ones; sold work warns with what's unpaid.
                      onArchive={async () => {
                        try {
                          if (await confirmAndArchive(p))
                            setProjects((prev) => prev.filter((x) => x.id !== p.id))
                        } catch (err) {
                          window.alert(err instanceof Error ? err.message : 'Could not archive.')
                        }
                      }}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: 'Delete this project?',
                          message: `Permanently delete "${p.name}"? Subprojects, estimate lines, and notes go with it. This can't be undone.`,
                          confirmLabel: 'Delete',
                          variant: 'danger',
                        })
                        if (!ok) return
                        try {
                          await deleteProject(p.id)
                          setProjects((prev) => prev.filter((x) => x.id !== p.id))
                        } catch (err) {
                          console.error('deleteProject', err)
                        }
                      }}
                      onDragStart={() => setDragId(p.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null) }}
                      isDragging={dragId === p.id}
                    />
                  ))}
                </KanbanColumn>
              )
            })}
          </div>
        )}
      </div>

      {touchFor && org?.id && (
        <TouchedBaseModal
          orgId={org.id}
          userId={user?.id}
          project={touchFor}
          onClose={() => setTouchFor(null)}
          onDone={(touch) => {
            const id = touchFor.id
            setTouchFor(null)
            setTouches((prev) => ({ ...prev, [id]: { touch, stageAt: prev[id]?.stageAt ?? null } }))
          }}
        />
      )}

      {noteFor && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setNoteFor(null)}
        >
          <div
            className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Quick note
            </div>
            <div className="text-base font-semibold text-[#111] truncate">{noteFor.name}</div>
            <textarea
              autoFocus
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && noteBody.trim() && !savingNote) {
                  setSavingNote(true)
                  if (org?.id && noteFor) {
                    await addProjectNote({ org_id: org.id, project_id: noteFor.id, body: noteBody.trim(), created_by: user?.id })
                  }
                  setSavingNote(false)
                  setNoteFor(null)
                }
              }}
              rows={4}
              placeholder="Left a VM. Sent revised quote on materials."
              className="mt-3 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] resize-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setNoteFor(null)}
                className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!noteBody.trim() || savingNote) return
                  setSavingNote(true)
                  if (org?.id && noteFor) {
                    await addProjectNote({ org_id: org.id, project_id: noteFor.id, body: noteBody.trim(), created_by: user?.id })
                  }
                  setSavingNote(false)
                  setNoteFor(null)
                }}
                disabled={!noteBody.trim() || savingNote}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {savingNote ? 'Saving…' : 'Save note (⌘↩)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lostReasonFor && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => { setLostReasonFor(null); setLostReason('') }}
        >
          <div
            className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Marked lost
            </div>
            <div className="text-base font-semibold text-[#111] truncate">{lostReasonFor.name}</div>
            <div className="mt-1 text-[12px] text-[#6B7280]">
              Why did it die? Optional — feeds the lost archive and the sales report.
            </div>
            <textarea
              autoFocus
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setLostReasonFor(null); setLostReason('') }
              }}
              rows={3}
              placeholder="Went with another shop on price. Project shelved. Never answered."
              className="mt-3 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] resize-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setLostReasonFor(null); setLostReason('') }}
                className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
              >
                Skip
              </button>
              <button
                onClick={async () => {
                  const p = lostReasonFor
                  const reason = lostReason.trim()
                  setLostReasonFor(null)
                  setLostReason('')
                  if (p && reason) {
                    try {
                      await setProjectLostReason(p.id, reason)
                    } catch (err) {
                      console.error('setProjectLostReason', err)
                    }
                  }
                }}
                disabled={!lostReason.trim()}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                Save reason
              </button>
            </div>
          </div>
        </div>
      )}

      {dupFor && (
        <DuplicateProjectModal
          project={dupFor}
          onClose={() => setDupFor(null)}
          onDone={async (newId) => {
            setDupFor(null)
            // Reload rather than hand-rolling a SalesProject — the copy's
            // card must carry exactly what loadSalesProjects computes (LF,
            // badges), and duplicating that shaping here would drift.
            if (org?.id) {
              const { projects: fresh } = await loadSalesProjects(org.id)
              setProjects(fresh)
            }
            void newId
          }}
        />
      )}

      {newOpen && org?.id && (
        <NewProjectModal
          orgId={org.id}
          onClose={() => setNewOpen(false)}
          onCreated={(p) => {
            setNewOpen(false)
            setProjects((prev) => [p, ...prev])
          }}
        />
      )}
    </>
  )
}

function SalesCard({
  project,
  attention,
  isPractice,
  isTourProject,
  onOpen,
  onQuickNote,
  onTouchedBase,
  onDuplicate,
  onArchive,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  project: SalesProject
  attention: AgeAttention | null
  isPractice: boolean
  /** The walkthrough's last step points at the card the user just made. */
  isTourProject: boolean
  onOpen: () => void
  onQuickNote: () => void
  onTouchedBase: () => void
  onDuplicate: () => void
  /** Archive (119) — offered on every card. */
  onArchive: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const icon = 'w-3.5 h-3.5 text-[#9CA3AF]'
  return (
    <KanbanCard
      title={project.name}
      titleBadges={
        <>
          {isPractice && <PracticeBadge />}
        </>
      }
      subtitle={project.client_name}
      dataTour={isTourProject ? 'tour-project-card' : undefined}
      // The tour draws its own ring on this card — the attention ring yields.
      attention={attention}
      suppressRing={isTourProject}
      onOpen={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      isDragging={isDragging}
      menu={[
        { label: 'Add a note', icon: <StickyNote className={icon} />, onClick: onQuickNote },
        ...(project.stage === 'lost' || project.stage === 'sold'
          ? []
          : [{ label: 'Touched base', icon: <Handshake className={icon} />, onClick: onTouchedBase }]),
        { label: 'Open project', icon: <ArrowRight className={icon} />, onClick: onOpen },
        { label: 'Duplicate', icon: <Copy className={icon} />, onClick: onDuplicate },
        { label: 'Archive', icon: <Archive className={icon} />, onClick: onArchive },
        { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: onDelete, danger: true, dividerBefore: true },
      ]}
    >
      <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF] mt-2">
        {fmtMoney(project.bid_total || project.estimated_price)}
      </div>
      {/* Chip gets its OWN row. Sharing a line with the price meant a big
          number and a long label ($438,506 + ESTIMATE SENT) couldn't both fit
          in a five-column board, and the chip clipped mid-word.

          Sold cards show where the JOB actually is, from the shared cover-stage
          mapping in components/project/StagePill so the board and the project
          page can't drift apart; don't re-map it here. On a sold card this
          replaces the estimate-sent chip: once it's won, the estimate's
          history isn't the headline any more. */}
      {project.stage === 'sold' ? (
        <div className="mt-1.5">
          {/* ⛔ Colour comes from the shared STAGE_COLORS, not a class here. */}
          <span
            className="inline-block text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider"
            style={soldStageColors(project.project_stage)}
          >
            {soldStageLabel(project.project_stage)}
          </span>
        </div>
      ) : project.estimate_sent_at ? (
        <div className="mt-1.5">
          <span
            title={`Estimate sent ${new Date(project.estimate_sent_at).toLocaleDateString()}`}
            className="inline-block text-[9px] px-1.5 py-0.5 bg-[#EFF6FF] text-[#1E40AF] rounded font-semibold uppercase tracking-wider"
          >
            Estimate sent
          </span>
        </div>
      ) : null}
    </KanbanCard>
  )
}

'use client'

// ============================================================================
// /sales/kanban — sales pipeline Kanban
// ============================================================================
// Five columns driven by projects.stage: new_lead / fifty_fifty /
// ninety_percent / sold / lost. Dragging a card writes the stage.
// Post-sold stages (production / installed / complete) don't show here —
// they all roll up to 'Sold' in the sales view; those projects are the
// shop's problem and live on the project cover.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import {
  SALES_STAGES,
  STAGE_LABEL,
  SalesProject,
  SalesStage,
  addProjectNote,
  loadSalesProjects,
  updateProjectStage,
} from '@/lib/sales'
import { useConfirm } from '@/components/confirm-dialog'
import Link from 'next/link'
import { ArrowLeft, MoreHorizontal, StickyNote, ArrowRight } from 'lucide-react'

function fmtMoney(n: number | null | undefined) {
  if (n == null || n === 0) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const COLUMN_HINT: Record<SalesStage, string> = {
  new_lead: 'Just came in',
  fifty_fifty: 'Could go either way',
  ninety_percent: 'About to close',
  sold: 'Becomes a project',
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
  const { confirm } = useConfirm()

  const [projects, setProjects] = useState<SalesProject[]>([])
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<SalesStage | null>(null)
  const [noteFor, setNoteFor] = useState<SalesProject | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const { projects } = await loadSalesProjects(org.id)
      setProjects(projects)
      setLoading(false)
    })()
  }, [org?.id])

  const columns = useMemo(() => {
    const out: Record<SalesStage, SalesProject[]> = {
      new_lead: [],
      fifty_fifty: [],
      ninety_percent: [],
      sold: [],
      lost: [],
    }
    for (const p of projects) out[p.stage]?.push(p)
    return out
  }, [projects])

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

    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, stage: targetStage } : p))
    )
    try {
      await updateProjectStage(project.id, targetStage)
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
      <Nav />
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-5">
          <Link
            href="/sales"
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#111]">Sales pipeline</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Drag between columns to advance the stage. Moving to Sold flips the project to active
              and opens the pre-production workflow.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading…</div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {SALES_STAGES.map((stage) => {
              const isOver = dragOver === stage
              const cards = columns[stage]
              return (
                <div
                  key={stage}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(stage) }}
                  onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
                  onDrop={() => handleDrop(stage)}
                  className={`rounded-xl border transition-colors min-h-[60vh] ${
                    isOver ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB] bg-[#F9FAFB]'
                  }`}
                >
                  <div className="px-3 pt-3 pb-2 border-b border-[#E5E7EB]">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest">
                        {STAGE_LABEL[stage]}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF]">
                        {cards.length}
                      </div>
                    </div>
                    <div className="text-[10px] text-[#9CA3AF] mt-0.5">{COLUMN_HINT[stage]}</div>
                  </div>

                  <div className="p-2 space-y-2">
                    {cards.length === 0 ? (
                      <div className="text-[11px] text-[#D1D5DB] text-center py-6 italic">
                        Drop here
                      </div>
                    ) : (
                      cards.map((p) => (
                        <KanbanCard
                          key={p.id}
                          project={p}
                          onOpen={() => router.push(`/projects/${p.id}`)}
                          onQuickNote={() => { setNoteFor(p); setNoteBody('') }}
                          onDragStart={() => setDragId(p.id)}
                          onDragEnd={() => { setDragId(null); setDragOver(null) }}
                          isDragging={dragId === p.id}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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
    </>
  )
}

function KanbanCard({
  project,
  onOpen,
  onQuickNote,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  project: SalesProject
  onOpen: () => void
  onQuickNote: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        // Don't open when clicking the kebab.
        if ((e.target as HTMLElement).closest('[data-kebab]')) return
        onOpen()
      }}
      className={`relative bg-white border border-[#E5E7EB] rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-[#9CA3AF] transition-all ${
        isDragging ? 'opacity-40 scale-95' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#111] truncate">{project.name}</div>
          {project.client_name && (
            <div className="text-[11px] text-[#6B7280] truncate mt-0.5">{project.client_name}</div>
          )}
        </div>
        <button
          data-kebab
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="p-0.5 text-[#9CA3AF] hover:text-[#111] rounded flex-shrink-0"
          aria-label="More actions"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF] mt-2 flex items-center justify-between">
        <span>{fmtMoney(project.bid_total || project.estimated_price)}</span>
        {project.stage === 'sold' && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#ECFDF5] text-[#059669] rounded font-semibold uppercase tracking-wider">
            Live
          </span>
        )}
      </div>

      {menuOpen && (
        <>
          <div
            data-kebab
            className="fixed inset-0 z-10"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }}
          />
          <div
            data-kebab
            className="absolute right-2 top-8 z-20 w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setMenuOpen(false); onQuickNote() }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#111] hover:bg-[#F3F4F6] inline-flex items-center gap-2"
            >
              <StickyNote className="w-3.5 h-3.5 text-[#9CA3AF]" />
              Add a note
            </button>
            <button
              onClick={() => { setMenuOpen(false); onOpen() }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#111] hover:bg-[#F3F4F6] inline-flex items-center gap-2"
            >
              <ArrowRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
              Open project
            </button>
          </div>
        </>
      )}
    </div>
  )
}

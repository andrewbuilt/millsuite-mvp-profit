'use client'

// ============================================================================
// /sales/kanban — sales pipeline Kanban (Phase 5)
// ============================================================================
// Replaces /leads. Five columns driven by projects.stage. Dragging a card
// updates stage on the project (no lead→project conversion — the project
// already exists). Dragging to 'Sold' also flips status to 'active' and
// production_phase to 'pre_production' so the project enters the in-shop
// lifecycle (see lib/sales.ts updateProjectStage).
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
  loadSalesProjects,
  updateProjectStage,
} from '@/lib/sales'
import { useConfirm } from '@/components/confirm-dialog'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

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
    <PlanGate requires="leads">
      <KanbanInner />
    </PlanGate>
  )
}

function KanbanInner() {
  const router = useRouter()
  const { org } = useAuth()
  const { confirm } = useConfirm()

  const [projects, setProjects] = useState<SalesProject[]>([])
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<SalesStage | null>(null)

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

    // Warn when moving a project that's already been sold back into a pre-sold
    // bucket — it'll flip status back to 'bidding', which may clobber in-shop
    // state.
    if (
      (project.status === 'active' || project.status === 'completed') &&
      targetStage !== 'sold' &&
      targetStage !== 'lost'
    ) {
      const ok = await confirm({
        title: 'Move this back into the pipeline?',
        message: `"${project.name}" is already a live project. Moving it back to ${STAGE_LABEL[targetStage]} will flip it back to bidding status.`,
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
    </>
  )
}

function KanbanCard({
  project,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  project: SalesProject
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`bg-white border border-[#E5E7EB] rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-[#9CA3AF] transition-all ${
        isDragging ? 'opacity-40 scale-95' : ''
      }`}
    >
      <div className="text-sm font-semibold text-[#111] truncate">{project.name}</div>
      {project.client_name && (
        <div className="text-[11px] text-[#6B7280] truncate mt-0.5">{project.client_name}</div>
      )}
      <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF] mt-2 flex items-center justify-between">
        <span>{fmtMoney(project.bid_total || project.estimated_price)}</span>
        {project.status === 'active' && (
          <span className="text-[9px] px-1.5 py-0.5 bg-[#ECFDF5] text-[#059669] rounded font-semibold uppercase tracking-wider">
            Live
          </span>
        )}
      </div>
    </div>
  )
}

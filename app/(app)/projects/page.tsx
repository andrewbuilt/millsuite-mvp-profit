'use client'

// ============================================================================
// /projects — all projects, grouped by stage
// ============================================================================
// Shop-facing overview across the full pipeline — one card per project,
// bucketed by stage. Pre-sold stages (new_lead / fifty_fifty / ninety_percent)
// also live on /sales + /sales/kanban; this page adds the post-sold buckets
// (sold / production / installed / complete) and a lost lane.
//
// No drag-drop here — stage transitions happen on the project cover action
// bar (or on the sales kanban for pre-sold drags). This page is a browse
// + jump-to surface, plus a delete action behind a confirm on each card.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { deleteProject } from '@/lib/sales'
import { Trash2 } from 'lucide-react'
import {
  PROJECT_STAGE_LABEL,
  type ProjectStage,
} from '@/lib/types'

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number
  actual_total: number
  updated_at: string
}

// Column order on the page. Lost sits at the end so it stays out of the main
// flow but is still reachable.
const COLUMNS: ProjectStage[] = [
  'new_lead',
  'fifty_fifty',
  'ninety_percent',
  'sold',
  'production',
  'installed',
  'complete',
  'lost',
]

function fmtMoney(n: number) {
  if (!n) return '—'
  return n < 0
    ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function ProjectsPage() {
  const router = useRouter()
  const { org } = useAuth()
  const { confirm } = useConfirm()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total, actual_total, updated_at')
        .eq('org_id', org.id)
        .order('updated_at', { ascending: false })
      setProjects((data || []) as ProjectRow[])
      setLoading(false)
    })()
  }, [org?.id])

  const grouped = useMemo(() => {
    const out: Record<ProjectStage, ProjectRow[]> = {
      new_lead: [],
      fifty_fifty: [],
      ninety_percent: [],
      sold: [],
      production: [],
      installed: [],
      complete: [],
      lost: [],
    }
    for (const p of projects) out[p.stage]?.push(p)
    return out
  }, [projects])

  async function handleDelete(p: ProjectRow) {
    const ok = await confirm({
      title: 'Delete project?',
      message: `Delete "${p.name}"? This removes all subprojects, estimate lines, time entries, invoices, and milestones for the project. This can't be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteProject(p.id)
      setProjects((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err: any) {
      alert(`Failed to delete: ${err?.message || 'unknown error'}`)
    }
  }

  return (
    <>
      <Nav />
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#111]">Projects</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Every project your shop is touching, grouped by stage. Click any
            card to open the project cover.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">
            No projects yet. Drop a PDF on the Sales dashboard to start one.
          </div>
        ) : (
          <div className="space-y-6">
            {COLUMNS.map((stage) => {
              const rows = grouped[stage]
              if (rows.length === 0) return null
              return (
                <section key={stage}>
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      {PROJECT_STAGE_LABEL[stage]}
                    </h2>
                    <span className="text-xs text-[#9CA3AF] font-mono">
                      {rows.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {rows.map((p) => (
                      <div
                        key={p.id}
                        className="relative group bg-white border border-[#E5E7EB] rounded-xl p-4 hover:border-[#2563EB] hover:shadow-sm transition-all"
                      >
                        <button
                          onClick={() => router.push(`/projects/${p.id}`)}
                          className="block text-left w-full pr-8"
                        >
                          <div className="font-semibold text-[#111] text-[14px]">
                            {p.name}
                          </div>
                          <div className="text-[12px] text-[#6B7280] mt-1">
                            {p.client_name || '—'}
                          </div>
                          <div className="mt-3 flex items-center justify-between text-[12px]">
                            <span className="font-mono tabular-nums text-[#111]">
                              {fmtMoney(p.bid_total)}
                            </span>
                            <span className="text-[#9CA3AF]">
                              {new Date(p.updated_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(p)
                          }}
                          title="Delete project"
                          aria-label="Delete project"
                          className="absolute top-3 right-3 p-1.5 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

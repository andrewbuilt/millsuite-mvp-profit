'use client'

// ============================================================================
// /projects/[id]/pre-production — sold-project approvals + drawings + COs
// ============================================================================
// Per preprod-approval-mockup.html. Once a project is sold the shop has one
// more gate before scheduling: every estimate-line callout becomes an
// approval item (a material + finish decision) that needs client sign-off,
// and every subproject needs at least one approved latest drawing revision.
// This page is where those decisions get tracked.
//
// Composition:
//   - Gate banner — overall project readiness ("2 of 3 subs ready")
//   - Per subproject: ApprovalSlots (material/finish decisions + sample
//     history timeline + ball-in-court chips + linked slots) side-by-side
//     with DrawingsTrack (revisions + approval)
//   - ChangeOrders panel at the bottom — any material swap past sold drafts
//     a CO as an estimate-line diff with net-change $
//   - Explainer footer matching the mockup's "what stays manual for V1"
//     copy — no portal, no auto-QB, client approval is a status field
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Circle, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import ApprovalSlots from '@/components/approval-slots'
import DrawingsTrack from '@/components/drawings-track'
import ChangeOrders from '@/components/change-orders'
import GateChip from '@/components/gate-chip'
import { loadSubprojectStatusMap, type SubprojectStatus } from '@/lib/subproject-status'
import type { PricingInputs } from '@/lib/change-orders'
import type { ProjectStage } from '@/lib/types'

interface Project {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
}

interface Subproject {
  id: string
  name: string
  sort_order: number
}

function coverStageIsPostsold(stage: ProjectStage): boolean {
  return (
    stage === 'sold' ||
    stage === 'production' ||
    stage === 'installed' ||
    stage === 'complete'
  )
}

export default function PreProductionPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org, user } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [subs, setSubs] = useState<Subproject[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, SubprojectStatus>>({})
  const [loading, setLoading] = useState(true)

  async function reload() {
    if (!projectId || !org?.id) return
    setLoading(true)
    const [projRes, subsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, client_name, stage')
        .eq('id', projectId)
        .single(),
      supabase
        .from('subprojects')
        .select('id, name, sort_order')
        .eq('project_id', projectId)
        .order('sort_order'),
    ])
    const subList = (subsRes.data || []) as Subproject[]
    const subIds = subList.map((s) => s.id)
    const statuses = subIds.length > 0 ? await loadSubprojectStatusMap(subIds) : {}
    setProject((projRes.data as Project) || null)
    setSubs(subList)
    setStatusMap(statuses)
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, org?.id])

  if (loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading pre-production…
      </div>
    )
  }

  if (!coverStageIsPostsold(project.stage)) {
    return (
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="max-w-[820px] mx-auto px-8 py-16 text-center">
          <h1 className="text-xl font-semibold text-[#111] mb-2">Pre-production isn't open yet</h1>
          <p className="text-sm text-[#6B7280] mb-5">
            Mark the project as sold first. Approval items generate from estimate callouts during handoff.
          </p>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to project
          </Link>
        </div>
      </div>
    )
  }

  const readySubs = subs.filter((s) => statusMap[s.id]?.ready_for_scheduling).length
  const allReady = readySubs === subs.length && subs.length > 0

  const pricing: PricingInputs = {
    shopRate: org?.shop_rate ?? 75,
    consumableMarkupPct: org?.consumable_markup_pct ?? 10,
    profitMarginPct: org?.profit_margin_pct ?? 35,
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to project
        </button>
        <div className="text-xs text-[#9CA3AF]">
          <span className="font-medium text-[#6B7280]">{project.name}</span>
          <span className="mx-2 text-[#D1D5DB]">·</span>
          Pre-production
        </div>
      </div>

      {/* Gate banner */}
      <div
        className={
          'px-8 py-4 border-b ' +
          (allReady
            ? 'bg-[#F0FDF4] border-[#BBF7D0]'
            : 'bg-[#FFFBEB] border-[#FDE68A]')
        }
      >
        <div className="max-w-[1180px] mx-auto flex items-center gap-4">
          {allReady ? (
            <CheckCircle2 className="w-6 h-6 text-[#059669] shrink-0" />
          ) : (
            <AlertCircle className="w-6 h-6 text-[#D97706] shrink-0" />
          )}
          <div className="flex-1">
            <div
              className={
                'text-[11px] font-semibold uppercase tracking-wider ' +
                (allReady ? 'text-[#15803D]' : 'text-[#92400E]')
              }
            >
              {allReady ? 'Production gate · Ready' : 'Production gate · Blocked'}
            </div>
            <div className="text-sm text-[#111] mt-1">
              {subs.length === 0
                ? 'No subprojects on this project yet.'
                : `${readySubs} of ${subs.length} subproject${
                    subs.length === 1 ? '' : 's'
                  } ready for scheduling.`}{' '}
              <span className="text-[#6B7280]">
                Nothing moves to scheduling until every approval item AND drawings on a subproject read approved.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Subproject sections */}
      <div className="px-8 py-6">
        <div className="max-w-[1180px] mx-auto space-y-5">
          {subs.length === 0 && (
            <div className="p-6 bg-white border border-[#E5E7EB] rounded-xl text-center text-sm text-[#9CA3AF]">
              This project has no subprojects yet.
            </div>
          )}

          {subs.map((sub) => {
            const status = statusMap[sub.id]
            return (
              <section
                key={sub.id}
                className="bg-white border border-[#E5E7EB] rounded-xl p-5"
              >
                <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3 mb-4 gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="text-[15px] font-semibold text-[#111]">
                      {sub.name}
                    </div>
                    <GateChip status={status} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                  <ApprovalSlots
                    subprojectId={sub.id}
                    projectId={projectId}
                    actorUserId={user?.id}
                  />
                  <div>
                    <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                      Drawings
                    </div>
                    <DrawingsTrack
                      subprojectId={sub.id}
                      actorUserId={user?.id}
                    />
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>

      {/* Change orders */}
      {subs.length > 0 && (
        <div className="px-8 pb-8">
          <div className="max-w-[1180px] mx-auto bg-white border border-[#E5E7EB] rounded-xl p-5">
            <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
              Change orders
            </div>
            <ChangeOrders
              projectId={projectId}
              projectName={project.name}
              pricing={pricing}
              subprojects={subs.map((s) => ({ id: s.id, name: s.name }))}
              onChange={reload}
            />
          </div>
        </div>
      )}

      {/* Explainer (matches mockup's "what stays manual for V1" copy) */}
      <div className="px-8 pb-12">
        <div className="max-w-[1180px] mx-auto bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-5">
          <h4 className="text-[13px] font-semibold text-[#0369A1] mb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#E0F2FE] text-[#0369A1] flex items-center justify-center text-[11px] font-bold">
              i
            </span>
            What this page is — and what stays manual for V1
          </h4>
          <p className="text-[12.5px] text-[#075985] leading-relaxed mb-2">
            <b>Approval items come from estimate-line callouts.</b> Each one is a single decision —
            what material + what finish. Construction details (door style, edge profile, drawer joinery,
            dimensions, hardware quantities) live on the production drawing, not here.
          </p>
          <p className="text-[12.5px] text-[#075985] leading-relaxed mb-2">
            A subproject can't move to scheduling until every item AND its drawings are marked approved.
            When a client picks a different material, a change order is drafted as an estimate-line
            diff — original on the left, proposed on the right, edit the spec to reprice.
          </p>
          <p className="text-[12.5px] text-[#075985] leading-relaxed">
            <b>Everything else stays manual.</b> No portal signing. No email automation. No auto-push
            to QuickBooks — client approval is a status field you mark by hand after talking to them,
            and QB reconciliation is a manual step in QB.
          </p>
        </div>
      </div>
    </div>
  )
}

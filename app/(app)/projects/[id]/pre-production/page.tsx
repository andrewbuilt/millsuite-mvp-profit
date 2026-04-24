'use client'

// ============================================================================
// /projects/[id]/pre-production — sold-project approvals + drawings + COs
// ============================================================================
// Layout mirrors preprod-approval-mockup.html:
//
//   Project strip     — name, sold date, install target, total, stage
//   Gate banner       — one banner across the top with approved / in-review /
//                       pending counts on the right, and "blocked" vs "ready"
//                       tone on the left
//   Per subproject    — header (icon + name + LF + status pill) + two-column
//                       tracks: approval items on the left, drawings on the
//                       right. Click any slot to expand — sample history +
//                       material/finish cells + action buttons live inside.
//   Change orders     — one panel per project at the bottom, drafted when a
//                       material change triggers a CO on a slot
//   Explainer         — matches the "what stays manual for V1" block
//
// The slot cards + drawing cards themselves come from ApprovalSlots and
// DrawingsTrack; those components already render the mockup's row layout.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, AlertCircle, Circle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import ApprovalSlots from '@/components/approval-slots'
import DrawingsTrack from '@/components/drawings-track'
import ChangeOrders from '@/components/change-orders'
import { loadSubprojectStatusMap, type SubprojectStatus } from '@/lib/subproject-status'
import { loadApprovalItemsForSubproject, type ApprovalItem } from '@/lib/approvals'
import type { PricingInputs } from '@/lib/change-orders'
import type { ProjectStage } from '@/lib/types'

interface Project {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number
  sold_at: string | null
  target_start_date: string | null
}

interface Subproject {
  id: string
  name: string
  sort_order: number
  linear_feet: number | null
  activity_type: string | null
}

function isPostsold(stage: ProjectStage): boolean {
  return (
    stage === 'sold' ||
    stage === 'production' ||
    stage === 'installed' ||
    stage === 'complete'
  )
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n: number): string {
  if (!n) return '$0'
  return `$${Math.round(n).toLocaleString()}`
}

export default function PreProductionPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org, user } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [subs, setSubs] = useState<Subproject[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, SubprojectStatus>>({})
  // Project-wide counts are cheap enough to fetch all items for — most
  // projects have well under 100 slots across every sub.
  const [allItems, setAllItems] = useState<ApprovalItem[]>([])
  // `loading` gates only the very first render. Once `project` is populated,
  // background reloads (triggered by CO state changes, slot approvals, etc.)
  // don't blank the page — they just swap in fresher data. Blanking on every
  // reload was making ChangeOrders + ApprovalSlots remount, which re-fired
  // their mount effects, which caused a render loop.
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!projectId || !org?.id) return
    const [projRes, subsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total, sold_at, target_start_date')
        .eq('id', projectId)
        .single(),
      supabase
        .from('subprojects')
        .select('id, name, sort_order, linear_feet, activity_type')
        .eq('project_id', projectId)
        .order('sort_order'),
    ])
    const subList = (subsRes.data || []) as Subproject[]
    const subIds = subList.map((s) => s.id)
    const [statuses, itemsBySub] = await Promise.all([
      subIds.length > 0 ? loadSubprojectStatusMap(subIds) : Promise.resolve({}),
      Promise.all(subIds.map((id) => loadApprovalItemsForSubproject(id))),
    ])
    const flatItems: ApprovalItem[] = itemsBySub.flat()
    setProject((projRes.data as Project) || null)
    setSubs(subList)
    setStatusMap(statuses)
    setAllItems(flatItems)
    setLoading(false)
  }, [projectId, org?.id])

  useEffect(() => {
    reload()
  }, [reload])

  // Pre-computed counts — one pass across the project's approval items.
  const counts = useMemo(() => {
    const approved = allItems.filter((i) => i.state === 'approved').length
    const inReview = allItems.filter((i) => i.state === 'in_review').length
    const pending = allItems.filter((i) => i.state === 'pending').length
    return { approved, inReview, pending, total: allItems.length }
  }, [allItems])

  if (loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading pre-production…
      </div>
    )
  }

  if (!isPostsold(project.stage)) {
    return (
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="max-w-[820px] mx-auto px-8 py-16 text-center">
          <h1 className="text-xl font-semibold text-[#111] mb-2">Pre-production isn't open yet</h1>
          <p className="text-sm text-[#6B7280] mb-5">
            Mark the project as sold first. Specs generate from estimate lines during handoff.
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
    shopRate: org?.shop_rate ?? 0,
    consumableMarkupPct: org?.consumable_markup_pct ?? 10,
    profitMarginPct: org?.profit_margin_pct ?? 35,
  }

  const soldDate = fmtDate(project.sold_at)
  const installTarget = fmtDate(project.target_start_date)

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
          <span className="font-medium text-[#6B7280]">Pre-production</span>
        </div>
      </div>

      <div className="max-w-[1180px] mx-auto px-8 py-6 space-y-5">
        {/* Project strip */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-[15px] font-semibold text-[#111]">{project.name}</div>
            <div className="text-xs text-[#6B7280] mt-0.5">
              {[
                soldDate ? `Sold ${soldDate}` : null,
                installTarget ? `Install ${installTarget}` : null,
                `${subs.length} subproject${subs.length === 1 ? '' : 's'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold text-[#111] font-mono tabular-nums">
              {fmtMoney(project.bid_total)}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mt-0.5">
              {project.stage === 'sold' ? 'Pre-production' : project.stage}
            </div>
          </div>
        </div>

        {/* Gate banner */}
        <div
          className={
            'rounded-xl px-5 py-4 flex items-center gap-5 flex-wrap border ' +
            (allReady
              ? 'bg-gradient-to-b from-[#F0FDF4] to-[#ECFDF5] border-[#BBF7D0]'
              : 'bg-gradient-to-b from-[#FFFBEB] to-[#FEF3C7] border-[#FDE68A]')
          }
        >
          <div
            className={
              'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ' +
              (allReady ? 'bg-[#D1FAE5] text-[#059669]' : 'bg-[#FEF3C7] text-[#D97706]')
            }
          >
            {allReady ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-[220px]">
            <div
              className={
                'text-[10px] font-semibold uppercase tracking-[0.12em] ' +
                (allReady ? 'text-[#15803D]' : 'text-[#92400E]')
              }
            >
              Production gate · {allReady ? 'Ready' : 'Blocked'}
            </div>
            <div className="text-[14px] font-semibold text-[#111] mt-0.5">
              {subs.length === 0
                ? 'No subprojects on this project.'
                : allReady
                ? `All ${subs.length} subproject${subs.length === 1 ? '' : 's'} ready to schedule.`
                : `${readySubs} of ${subs.length} subproject${subs.length === 1 ? '' : 's'} ready for scheduling.`}
            </div>
            <div className="text-[12px] text-[#6B7280] mt-1">
              Nothing moves to scheduling until every approval item AND drawings on a subproject read <b>approved</b>.
            </div>
          </div>
          <div className="flex gap-6 pl-5 border-l border-[#E5E7EB]">
            <CountBox label="Approved" n={counts.approved} tone="green" />
            <CountBox label="In review" n={counts.inReview} tone="amber" />
            <CountBox label="Pending" n={counts.pending} tone="gray" />
          </div>
        </div>

        {/* Subproject sections */}
        {subs.length === 0 && (
          <div className="p-6 bg-white border border-[#E5E7EB] rounded-xl text-center text-sm text-[#9CA3AF]">
            This project has no subprojects yet.
          </div>
        )}

        {subs.map((sub) => {
          const status = statusMap[sub.id]
          const subReady = status?.ready_for_scheduling
          return (
            <section
              key={sub.id}
              className="bg-white border border-[#E5E7EB] rounded-xl p-5"
            >
              {/* Subproject header */}
              <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-3 mb-4 gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] flex items-center justify-center text-[#6B7280] text-sm font-bold">
                    {sub.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-[#111]">{sub.name}</div>
                    <div className="text-[11px] text-[#6B7280] mt-0.5">
                      {[
                        sub.linear_feet ? `${sub.linear_feet} LF` : null,
                        sub.activity_type,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'no LF set'}
                    </div>
                  </div>
                </div>
                <SubStatusPill status={status} />
              </div>

              {/* Two-track layout */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                <div>
                  <ApprovalSlots
                    subprojectId={sub.id}
                    projectId={projectId}
                    actorUserId={user?.id}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.1em] mb-2">
                    Drawings
                  </div>
                  <DrawingsTrack subprojectId={sub.id} actorUserId={user?.id} />
                </div>
              </div>
            </section>
          )
        })}

        {/* Change orders */}
        {subs.length > 0 && (
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
            <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.1em] mb-3">
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
        )}

        {/* Explainer footer */}
        <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl p-5">
          <h4 className="text-[13px] font-semibold text-[#0369A1] mb-2 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#E0F2FE] text-[#0369A1] flex items-center justify-center text-[11px] font-bold font-serif italic">
              i
            </span>
            What this page is — and what stays manual for V1
          </h4>
          <p className="text-[12.5px] text-[#075985] leading-relaxed mb-2">
            <b>Specs come from estimate-line finish specs.</b> Each one is a single decision — what
            material + what finish. Construction details (door style, edge profile, drawer joinery,
            dimensions, hardware quantities) live on the production drawing, not here.
          </p>
          <p className="text-[12.5px] text-[#075985] leading-relaxed mb-2">
            A subproject can't move to scheduling until every item AND its drawings are marked approved.
            When a client picks a different material, a change order is drafted as an estimate-line diff
            — original on the left, proposed on the right, edit the spec to reprice.
          </p>
          <p className="text-[12.5px] text-[#075985] leading-relaxed">
            <b>Everything else stays manual.</b> No portal signing. No email automation. No auto-push to
            QuickBooks — client approval is a status field you mark by hand after talking to them, and QB
            reconciliation is a manual step in QB.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Small building blocks ──

function CountBox({
  label,
  n,
  tone,
}: {
  label: string
  n: number
  tone: 'green' | 'amber' | 'gray'
}) {
  const fg = tone === 'green' ? 'text-[#059669]' : tone === 'amber' ? 'text-[#D97706]' : 'text-[#6B7280]'
  return (
    <div className="text-center">
      <div className={`text-[22px] font-bold font-mono tabular-nums ${fg}`}>{n}</div>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mt-0.5">
        {label}
      </div>
    </div>
  )
}

function SubStatusPill({ status }: { status: SubprojectStatus | undefined }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-[#F3F4F6] border-[#E5E7EB] text-[#6B7280] text-[10.5px] font-semibold uppercase tracking-wider">
        <Circle className="w-3 h-3" />
        No status
      </span>
    )
  }
  const ready = status.ready_for_scheduling
  const openItems = status.slots_total - status.slots_approved
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10.5px] font-semibold uppercase tracking-wider ' +
        (ready
          ? 'bg-[#D1FAE5] border-[#A7F3D0] text-[#065F46]'
          : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]')
      }
    >
      {ready ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
      {ready
        ? 'Ready for scheduling'
        : openItems > 0
        ? `Blocked · ${openItems} item${openItems === 1 ? '' : 's'} open`
        : 'Blocked · drawings pending'}
    </span>
  )
}

'use client'

// ============================================================================
// Sold handoff — "mark as sold" preflight review
// ============================================================================
// Translates sold-handoff-mockup.html into the MillSuite visual language.
// This is the confirmation surface the user walks through before flipping a
// project from 90%-bid to committed production work.
//
// Three preview panels + a lock/unlock summary:
//   1. Preproduction — every estimate_line × callout becomes an approval_item.
//      Cards are grouped by a heuristic owner (client decision / shop-ready /
//      vendor PO) derived from the callout label.
//   2. Schedule — summed department hours + a stub "next clean window"
//      calculation. The real capacity engine still lives behind the Adjust
//      slot link (not wired yet).
//   3. Invoice — 30/40/20/10 deposit cascade preview, editable per-line via
//      the rollup's QB modal. This panel is a read-only summary here.
//
// What the Confirm button actually does:
//   · Calls createApprovalItemsFromProposals() to insert one approval_items
//     row per effective callout, across every subproject on the project.
//   · Calls updateProjectStage(projectId, 'sold') — writes the single stage
//     field; there's no longer a status or production_phase to mirror.
//   · Redirects the user back to the project page, which now shows the
//     post-sold UI (approval track + drawings gate + CO workflow).
//
// Deferred until later phases / real integrations:
//   · QB deposit invoice fire — stubbed toast.
//   · Schedule slot commit — stubbed toast; capacity engine is out of scope.
//   · Explicit "estimate lock" column — we rely on stage='sold' as the lock
//     signal, matching what subproject-status.ts already reads.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Lock,
  Unlock,
  Calendar,
  DollarSign,
  Wrench,
  Package,
  User,
  FileText as FileLock,
  AlertCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import {
  loadRateBook,
  loadEstimateLines,
  computeSubprojectRollup,
  type EstimateLine,
  type PricingContext,
  type SubprojectRollup,
} from '@/lib/estimate-lines'
import type { RateBookItemRow, RateBookOptionRow } from '@/lib/rate-book-v2'
import type { LaborDept } from '@/lib/rate-book-seed'
import {
  proposeSlotsForLine,
  createApprovalItemsFromProposals,
  type ProposedApprovalSlot,
} from '@/lib/approvals'
import { updateProjectStage } from '@/lib/sales'
import {
  loadMilestones,
  TRIGGER_LABEL,
  sumMilestonePct,
  type ProjectMilestone,
} from '@/lib/milestones'
import type { ProjectStage } from '@/lib/types'
import PlanGate from '@/components/plan-gate'

// ── Types ──

interface Project {
  id: string
  name: string
  client_name: string | null
  delivery_address: string | null
  stage: ProjectStage
  bid_total: number
}

interface Subproject {
  id: string
  project_id: string
  name: string
  sort_order: number
  activity_type: string | null
  material_finish: string | null
  linear_feet: number | null
  consumable_markup_pct: number | null
  profit_margin_pct: number | null
}

// ── Helpers ──

function money(n: number): string {
  const r = Math.round(n || 0)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

function hoursFmt(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)} hrs`
}

// Milestones are loaded from loadMilestones() — no hardcoded cascade. The
// rollup page is where the user composes them; handoff is strictly preview.

// Suggest a production window N business weeks out. Purely cosmetic — the
// real capacity engine lives on /schedule and isn't wired into handoff yet.
function suggestWindow(totalHours: number): { start: Date; end: Date } {
  const start = new Date()
  // Skip ahead ~3 weeks + 1 week per 50h of work as a ballpark.
  const weeksAhead = 3 + Math.ceil(totalHours / 50)
  start.setDate(start.getDate() + weeksAhead * 7)
  // Snap to next Monday.
  while (start.getDay() !== 1) start.setDate(start.getDate() + 1)
  const durationDays = Math.max(7, Math.ceil((totalHours / 40) * 5))
  const end = new Date(start)
  end.setDate(end.getDate() + durationDays)
  return { start, end }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDateYear(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Page ──

function HandoffPageInner() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()

  const shopRate = org?.shop_rate ?? 0

  const pricingCtx: PricingContext = useMemo(
    () => ({
      shopRate,
      consumableMarkupPct: org?.consumable_markup_pct ?? 10,
      profitMarginPct: org?.profit_margin_pct ?? 35,
    }),
    [shopRate, org?.consumable_markup_pct, org?.profit_margin_pct]
  )

  const [project, setProject] = useState<Project | null>(null)
  const [subs, setSubs] = useState<Subproject[]>([])
  const [lineBySub, setLineBySub] = useState<
    Record<string, EstimateLine[]>
  >({})
  const [rollupBySub, setRollupBySub] = useState<
    Record<string, SubprojectRollup>
  >({})
  const [rateBook, setRateBook] = useState<{
    items: RateBookItemRow[]
    itemsById: Map<string, RateBookItemRow>
  }>({ items: [], itemsById: new Map() })
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])

  // ── Load ──

  useEffect(() => {
    if (!projectId || !org?.id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [projRes, subsRes, rb] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase
          .from('subprojects')
          .select('*')
          .eq('project_id', projectId)
          .order('sort_order'),
        loadRateBook(org!.id),
      ])
      if (cancelled) return
      const subList = (subsRes.data || []) as Subproject[]

      const linesBySub: Record<string, EstimateLine[]> = {}
      const rbSub: Record<string, SubprojectRollup> = {}
      await Promise.all(
        subList.map(async (sub) => {
          const lines = await loadEstimateLines(sub.id)
          linesBySub[sub.id] = lines
          const perSubCtx: PricingContext = {
            shopRate,
            consumableMarkupPct:
              sub.consumable_markup_pct ?? (org?.consumable_markup_pct ?? 10),
            profitMarginPct:
              sub.profit_margin_pct ?? (org?.profit_margin_pct ?? 35),
          }
          // No per-line options loaded here — handoff rollup uses the base buildup.
          rbSub[sub.id] = computeSubprojectRollup(lines, rb.itemsById, new Map(), perSubCtx)
        })
      )
      // Milestones composed on the rollup page — preview panel below reads
      // from this; if empty, the user gets a go-back-and-compose nudge.
      const ms = await loadMilestones(projectId)
      if (cancelled) return

      setProject(projRes.data as Project)
      setSubs(subList)
      setLineBySub(linesBySub)
      setRollupBySub(rbSub)
      setRateBook(rb)
      setMilestones(ms)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, org?.id, org?.consumable_markup_pct, org?.profit_margin_pct])

  // ── Derived: proposed approval slots (one per effective callout) ──

  const proposals: ProposedApprovalSlot[] = useMemo(() => {
    const all: ProposedApprovalSlot[] = []
    const itemById = rateBook.itemsById
    for (const sub of subs) {
      const lines = lineBySub[sub.id] || []
      for (const line of lines) {
        const item = line.rate_book_item_id
          ? itemById.get(line.rate_book_item_id) ?? null
          : null
        // Phase 2 finish specs replace the variant concept; build a display
        // name from the first finish spec so approval proposals still have
        // a material hint.
        const firstFinish = (line.finish_specs || [])[0]
        const variantName =
          firstFinish?.material
            ? [firstFinish.material, firstFinish.finish].filter(Boolean).join(' / ')
            : null
        all.push(
          ...proposeSlotsForLine(line as any, {
            subproject_name: sub.name,
            item_default_callouts: null,
            variant_name: variantName,
          })
        )
      }
    }
    return all
  }, [subs, lineBySub, rateBook])

  const grouped = useMemo(() => {
    return {
      client: proposals.filter((p) => p.owner === 'client'),
      shop: proposals.filter((p) => p.owner === 'shop'),
      vendor: proposals.filter((p) => p.owner === 'vendor'),
    }
  }, [proposals])

  // ── Project-level totals ──

  const projectTotals = useMemo(() => {
    const acc = {
      total: 0,
      hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      totalHours: 0,
      subCount: subs.length,
      linearFeet: 0,
      marginPct: 0,
      subtotal: 0,
    }
    for (const sub of subs) {
      const r = rollupBySub[sub.id]
      acc.linearFeet += Number(sub.linear_feet) || 0
      if (!r) continue
      acc.total += r.total
      acc.subtotal += r.subtotal
      acc.hoursByDept.eng += r.hoursByDept.eng
      acc.hoursByDept.cnc += r.hoursByDept.cnc
      acc.hoursByDept.assembly += r.hoursByDept.assembly
      acc.hoursByDept.finish += r.hoursByDept.finish
      acc.hoursByDept.install += r.hoursByDept.install
      acc.totalHours += r.totalHours
    }
    acc.marginPct =
      acc.total > 0 ? ((acc.total - acc.subtotal) / acc.total) * 100 : 0
    return acc
  }, [subs, rollupBySub])

  const suggested = useMemo(
    () => suggestWindow(projectTotals.totalHours),
    [projectTotals.totalHours]
  )
  const installWindow = useMemo(() => {
    const start = new Date(suggested.end)
    start.setDate(start.getDate() + 14) // 2 week gap → install
    while (start.getDay() !== 1) start.setDate(start.getDate() + 1)
    return start
  }, [suggested.end])

  // ── Actions ──

  async function handleConfirm() {
    if (!project) return
    if (confirming) return
    setConfirming(true)
    try {
      // Order matters. Approvals first — if that fails, the project stays
      // 90%-bid and the user can retry. Only once approvals are in do we
      // flip stage=sold, which is the lock signal + unlock trigger for the
      // rest of the system. Milestones don't need an activation call: they
      // were persisted as status='projected' on the rollup, and Phase 9's
      // QB watcher advances them to 'received' as payments arrive.
      const created = await createApprovalItemsFromProposals(proposals)
      await updateProjectStage(project.id, 'sold')
      const mParts =
        milestones.length > 0
          ? ` · ${milestones.length} milestone${
              milestones.length === 1 ? '' : 's'
            } active (watching QB)`
          : ''
      showToast(
        `Project sold. ${created} approval card${
          created === 1 ? '' : 's'
        } in pre-production · estimate locked${mParts}.`
      )
      setTimeout(() => {
        router.push(`/projects/${project.id}`)
      }, 1400)
    } catch (err) {
      console.error(err)
      showToast('Could not commit the handoff. Check console for details.')
      setConfirming(false)
    }
  }

  function handleSaveDraft() {
    // "Draft" isn't a persisted state in our schema — the only persistence
    // we can promise is the handoff review surface itself, which is driven
    // off live estimate data. Make that explicit in a toast.
    showToast(
      'Nothing to save — this preview is computed live from the estimate. ' +
        'Exit without committing keeps the project at its current stage.'
    )
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3400)
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B7280]">
        Loading handoff preview…
      </div>
    )
  }
  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B7280]">
        Project not found.
      </div>
    )
  }

  // Anything past the sold gate (sold itself or further along in production /
  // installed / complete) counts as already-sold for this page's warning.
  const alreadySold =
    project.stage === 'sold' ||
    project.stage === 'production' ||
    project.stage === 'installed' ||
    project.stage === 'complete'

  const milestonePctSum = sumMilestonePct(milestones)
  const milestonesBalanced = Math.abs(milestonePctSum - 100) < 0.01
  const depositMilestone = milestones[0]
  const depositAmount = depositMilestone
    ? Math.round((projectTotals.total * depositMilestone.pct) / 100)
    : 0

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Breadcrumb bar */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#6B7280]">
          <Link href="/projects" className="hover:text-[#111]">
            Projects
          </Link>
          <ChevronRight className="w-3 h-3 text-[#D1D5DB]" />
          <Link
            href={`/projects/${project.id}`}
            className="hover:text-[#111]"
          >
            {project.name}
          </Link>
          <ChevronRight className="w-3 h-3 text-[#D1D5DB]" />
          <span className="text-[#111] font-medium">Handoff</span>
        </div>
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Exit without committing
        </Link>
      </div>

      <div className="max-w-[1120px] mx-auto px-6 py-8">
        {/* Project strip */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 flex items-center justify-between mb-6">
          <div>
            <div className="text-base font-semibold text-[#111]">
              {project.name}
            </div>
            <div className="text-xs text-[#6B7280] mt-0.5">
              {project.client_name || '—'}
              {project.delivery_address ? ` · ${project.delivery_address}` : ''}
              {' · '}
              {projectTotals.subCount} subproject
              {projectTotals.subCount === 1 ? '' : 's'}
              {' · '}
              {hoursFmt(projectTotals.totalHours)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-[#111] tabular-nums">
              {money(projectTotals.total)}
            </div>
            <div className="text-xs text-[#059669] tabular-nums">
              {projectTotals.marginPct.toFixed(0)}% margin
            </div>
          </div>
        </div>

        {/* Banner */}
        {alreadySold ? (
          <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-6 py-5 mb-6 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#059669] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-[#111] mb-1">
                Already sold
              </div>
              <div className="text-sm text-[#374151] leading-relaxed">
                This project was marked as sold previously. The handoff
                surfaces below are read-only previews — pre-production is
                already live on the project page.
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-b from-[#EFF6FF] to-white border border-[#DBEAFE] rounded-xl px-6 py-5 mb-6">
            <div className="text-xs font-semibold uppercase tracking-wider text-[#2563EB] mb-2">
              Sales → Production
            </div>
            <h1 className="text-xl font-semibold text-[#111] mb-2">
              Mark this project as sold?
            </h1>
            <div className="text-sm text-[#374151] leading-relaxed max-w-2xl">
              When you confirm, this stops being an estimate and becomes a{' '}
              <b>committed production job</b>. Approval cards spawn into
              pre-production, the estimate locks (future edits become change
              orders), a best-case schedule slot is suggested, and your
              milestones activate — MillSuite watches QuickBooks and flips
              each milestone to &ldquo;received&rdquo; when the payment lands.
              Review each section below, then confirm.
            </div>
          </div>
        )}

        {/* ESTIMATE LOCK SNAPSHOT PANEL */}
        <Panel
          title={`Estimate snapshot · ${subs.length} subproject${
            subs.length === 1 ? '' : 's'
          }, ${money(projectTotals.total)}`}
          subtitle="This is what locks. Any edits after sold go through a change order."
          icon={<FileLock className="w-4 h-4 text-[#7C3AED]" />}
          iconBg="bg-[#F3E8FF]"
          rightAction={
            <Link
              href={`/projects/${project.id}`}
              className="text-xs text-[#2563EB] hover:text-[#1D4ED8]"
            >
              Review in rollup →
            </Link>
          }
        >
          {subs.length === 0 ? (
            <div className="text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-lg px-4 py-6 text-center">
              No subprojects on this project yet — nothing to lock.
            </div>
          ) : (
            <div className="space-y-1">
              {/* header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <div>Subproject</div>
                <div className="text-right">Lines</div>
                <div className="text-right">Finish specs</div>
                <div className="text-right">Total</div>
              </div>
              {subs.map((sub) => {
                const lines = lineBySub[sub.id] || []
                const specCount = lines.reduce(
                  (s, l) => s + ((l.finish_specs || []).length || 0),
                  0
                )
                const r = rollupBySub[sub.id]
                return (
                  <div
                    key={sub.id}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-1 py-2 border-b border-[#F3F4F6] last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#111] truncate">
                        {sub.name}
                      </div>
                      {(sub.activity_type || sub.material_finish) && (
                        <div className="text-[11px] text-[#6B7280] truncate">
                          {[sub.activity_type, sub.material_finish]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs font-mono text-[#374151]">
                      {lines.length}
                    </div>
                    <div className="text-right text-xs font-mono text-[#374151]">
                      {specCount}
                    </div>
                    <div className="text-right text-sm font-mono font-semibold text-[#111] tabular-nums">
                      {money(r?.total || 0)}
                    </div>
                  </div>
                )
              })}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-1 pt-3 mt-1 border-t-2 border-[#111]">
                <div className="text-sm font-semibold text-[#111]">
                  Project total
                </div>
                <div />
                <div />
                <div className="text-base font-bold text-[#111] font-mono tabular-nums">
                  {money(projectTotals.total)}
                </div>
              </div>
              <div className="text-[11px] text-[#6B7280] mt-3 bg-[#F9FAFB] border border-[#F3F4F6] rounded px-2.5 py-2 leading-relaxed">
                <b className="text-[#111]">What locks on confirm:</b> line
                items, per-project rate overrides, finish specs, subproject
                scope, and this project total. <b className="text-[#111]">
                  What stays editable:
                </b>{' '}
                notes, approval status, schedule, and change orders.
              </div>
            </div>
          )}
        </Panel>

        {/* PREPRODUCTION PANEL */}
        <Panel
          title={`Pre-production · ${proposals.length} approval card${
            proposals.length === 1 ? '' : 's'
          }`}
          subtitle="Each estimate-line finish spec becomes one approval card. Specs travel unchanged."
          icon={<Wrench className="w-4 h-4 text-[#2563EB]" />}
          iconBg="bg-[#EFF6FF]"
        >
          {proposals.length === 0 ? (
            <div className="text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-lg px-4 py-6 text-center">
              No specs on any estimate line yet. Either every line is
              locked from the estimate (nothing for the client to select), or
              the estimate hasn&apos;t been fleshed out. Add specs on
              individual lines via the subproject editor — you can revisit
              this handoff once that&apos;s done.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="text-xs text-[#2563EB] bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg px-3 py-2 leading-relaxed">
                <b>What&apos;s happening here.</b> The spec you quoted is the
                spec your shop builds. Line items from the estimate carry
                their specs into pre-production as selection cards. Client
                decisions, shop-ready specs, and vendor POs are grouped by
                what still needs to happen.
              </div>

              <SlotGroup
                title="Needs client input"
                count={grouped.client.length}
                tint="amber"
                slots={grouped.client}
              />
              <SlotGroup
                title="Shop-ready"
                count={grouped.shop.length}
                tint="green"
                slots={grouped.shop}
                countSuffix=" · locked from estimate"
              />
              <SlotGroup
                title="Vendor orders"
                count={grouped.vendor.length}
                tint="violet"
                slots={grouped.vendor}
                countSuffix=" · purchase orders"
              />
            </div>
          )}
        </Panel>

        {/* SCHEDULE PANEL */}
        <Panel
          title="Schedule · slot placement"
          subtitle="Summed department hours + a suggested production window."
          icon={<Calendar className="w-4 h-4 text-[#D97706]" />}
          iconBg="bg-[#FEF3C7]"
          rightAction={
            <Link
              href="/schedule"
              className="text-xs text-[#2563EB] hover:text-[#1D4ED8]"
            >
              Adjust slot →
            </Link>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <SchedBox
              label="Production window"
              value={`${fmtDate(suggested.start)} – ${fmtDate(suggested.end)}`}
              detail={`CNC → Assembly → Finish · ${Math.ceil(
                (suggested.end.getTime() - suggested.start.getTime()) /
                  (1000 * 60 * 60 * 24 * 7)
              )} week${
                Math.ceil(
                  (suggested.end.getTime() - suggested.start.getTime()) /
                    (1000 * 60 * 60 * 24 * 7)
                ) === 1
                  ? ''
                  : 's'
              }`}
            />
            <SchedBox
              label="Install target"
              value={`Week of ${fmtDate(installWindow)}`}
              detail={`${Math.max(
                1,
                Math.ceil(projectTotals.hoursByDept.install / 8)
              )} day${
                Math.max(
                  1,
                  Math.ceil(projectTotals.hoursByDept.install / 8)
                ) === 1
                  ? ''
                  : 's'
              } on-site`}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-3 border-t border-[#F3F4F6]">
            <DeptChip label="Engineering" hrs={projectTotals.hoursByDept.eng} />
            <DeptChip label="CNC" hrs={projectTotals.hoursByDept.cnc} />
            <DeptChip
              label="Assembly"
              hrs={projectTotals.hoursByDept.assembly}
            />
            <DeptChip label="Finish" hrs={projectTotals.hoursByDept.finish} />
            <DeptChip label="Install" hrs={projectTotals.hoursByDept.install} />
          </div>

          <div className="mt-4 text-xs text-[#6B7280] leading-relaxed">
            The window above is a rough estimate based on department hours — the
            capacity engine on{' '}
            <Link href="/schedule" className="text-[#2563EB] hover:underline">
              /schedule
            </Link>{' '}
            places the real slot once the subprojects are ready for scheduling
            (approvals + drawings approved).
          </div>
        </Panel>

        {/* MILESTONE ACTIVATION PANEL */}
        <Panel
          title={
            milestones.length > 0
              ? `Milestones · ${milestones.length} payment${
                  milestones.length === 1 ? '' : 's'
                } activate`
              : 'Milestones · not composed yet'
          }
          subtitle="MillSuite watches QuickBooks and flips each milestone when the payment lands. We never push to QB."
          icon={<DollarSign className="w-4 h-4 text-[#059669]" />}
          iconBg="bg-[#DCFCE7]"
          rightAction={
            <Link
              href={`/projects/${project.id}`}
              className="text-xs text-[#2563EB] hover:text-[#1D4ED8]"
            >
              Edit in rollup →
            </Link>
          }
        >
          {milestones.length === 0 ? (
            <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-lg px-3 py-3 flex items-start gap-2 text-[12.5px] text-[#92400E]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                No payment milestones composed for this project. The handoff
                will still confirm, but there&apos;ll be nothing for the QB
                watcher to match payments against.{' '}
                <Link
                  href={`/projects/${project.id}`}
                  className="underline hover:text-[#78350F]"
                >
                  Compose them in the rollup
                </Link>
                {' '}before confirming — or proceed and add them after.
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {milestones.map((m, i) => {
                  const amount = Math.round((projectTotals.total * m.pct) / 100)
                  const isDeposit = i === 0
                  return (
                    <div
                      key={m.id}
                      className={
                        isDeposit
                          ? 'flex items-center justify-between rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-3 mb-2'
                          : 'flex items-center justify-between px-3 py-2.5 border-b border-[#F3F4F6] last:border-0'
                      }
                    >
                      <div>
                        <div
                          className={
                            isDeposit
                              ? 'text-sm font-semibold text-[#111]'
                              : 'text-sm text-[#374151]'
                          }
                        >
                          {m.label} · {m.pct.toFixed(0)}%
                        </div>
                        <div className="text-xs text-[#6B7280] mt-0.5">
                          Activates on:{' '}
                          <span className="font-medium text-[#374151]">
                            {TRIGGER_LABEL[m.trigger]}
                          </span>
                          {isDeposit
                            ? ' · watcher flips this to "received" when QB shows the deposit'
                            : ''}
                        </div>
                      </div>
                      <div
                        className={
                          isDeposit
                            ? 'text-base font-bold text-[#059669] tabular-nums'
                            : 'text-sm font-semibold text-[#111] tabular-nums'
                        }
                      >
                        {money(amount)}
                      </div>
                    </div>
                  )
                })}
              </div>

              {!milestonesBalanced && (
                <div className="mt-3 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg px-3 py-2 flex items-start gap-2 text-[11.5px] text-[#92400E]">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Milestones total {milestonePctSum.toFixed(0)}% — fix in the
                    rollup so the percentages add to 100 before confirming.
                  </span>
                </div>
              )}

              <div className="mt-4 text-xs text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2 leading-relaxed">
                <b className="text-[#111]">Goes to:</b>{' '}
                {project.client_name || 'the client on file'}. <br />
                <b className="text-[#111]">How this works:</b> you invoice
                through QuickBooks as normal. MillSuite watches QB for
                deposit/payment events that match this project (Phase 9) and
                flips each milestone to &ldquo;received&rdquo; automatically —
                nothing is pushed from MillSuite to QB.
              </div>
            </>
          )}
        </Panel>

        {/* LOCK PANEL */}
        <Panel
          title="What locks & what unlocks"
          subtitle="After handoff, the project enters production mode."
          icon={<Lock className="w-4 h-4 text-[#7C3AED]" />}
          iconBg="bg-[#F3E8FF]"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <LockBox
              tone="locks"
              title="Locks"
              icon={<Lock className="w-3.5 h-3.5 text-[#D97706]" />}
              items={[
                'Estimate line items — edits require a change order',
                'Pricing and rate overrides for this project',
                'Subproject scope (add/remove via change order only)',
                'Finish specs — travel unchanged into approval cards',
              ]}
            />
            <LockBox
              tone="unlocks"
              title="Unlocks"
              icon={<Unlock className="w-3.5 h-3.5 text-[#059669]" />}
              items={[
                'Pre-production approval cards (finish specs + drawings)',
                'Best-case schedule slot (movable — never auto-committed)',
                'Time tracking against this project’s subprojects',
                'Change-order workflow + QB milestone watcher listening',
              ]}
            />
          </div>
        </Panel>

        {/* ACTIONS BAR */}
        {!alreadySold && (
          <div className="sticky bottom-4 bg-white/95 backdrop-blur border border-[#E5E7EB] rounded-xl px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shadow-sm">
            <div className="text-xs text-[#6B7280]">
              You can still exit without committing. Nothing fires until you
              confirm.
            </div>
            <div className="flex gap-2 flex-wrap">
              <Link
                href={`/projects/${project.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors border border-transparent"
              >
                Exit without committing
              </Link>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[#374151] bg-white hover:bg-[#F9FAFB] border border-[#E5E7EB] transition-colors"
              >
                Save handoff as draft
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  confirming ||
                  (proposals.length === 0 && subs.length === 0) ||
                  // If milestones exist but don't balance, block. If none
                  // exist, allow — user can add later (warning is already
                  // shown in the milestone panel).
                  (milestones.length > 0 && !milestonesBalanced)
                }
                title={
                  milestones.length > 0 && !milestonesBalanced
                    ? 'Fix milestone percentages in the rollup first.'
                    : undefined
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#059669] hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                {confirming ? 'Committing…' : 'Confirm & mark as sold'}
              </button>
            </div>
          </div>
        )}

        {alreadySold && (
          <div className="sticky bottom-4 bg-white/95 backdrop-blur border border-[#E5E7EB] rounded-xl px-5 py-4 flex items-center justify-between shadow-sm">
            <div className="text-xs text-[#6B7280]">
              This project is sold — pre-production is already live.
            </div>
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
            >
              Open project page
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111] text-white text-xs px-4 py-2.5 rounded-lg shadow-lg z-50 max-w-[560px]">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Subcomponents ──

function Panel({
  title,
  subtitle,
  icon,
  iconBg,
  rightAction,
  children,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  iconBg: string
  rightAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}
          >
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold text-[#111]">{title}</div>
            <div className="text-xs text-[#6B7280] mt-0.5">{subtitle}</div>
          </div>
        </div>
        {rightAction}
      </div>
      {children}
    </section>
  )
}

function SlotGroup({
  title,
  count,
  tint,
  slots,
  countSuffix = '',
}: {
  title: string
  count: number
  tint: 'amber' | 'green' | 'violet'
  slots: ProposedApprovalSlot[]
  countSuffix?: string
}) {
  const palette =
    tint === 'amber'
      ? {
          badge: 'bg-[#FEF3C7] text-[#92400E]',
          dot: 'bg-[#F59E0B]',
          owner: 'bg-[#FEF3C7] text-[#92400E]',
          icon: <User className="w-3 h-3" />,
        }
      : tint === 'green'
      ? {
          badge: 'bg-[#DCFCE7] text-[#166534]',
          dot: 'bg-[#22C55E]',
          owner: 'bg-[#F3F4F6] text-[#374151]',
          icon: <Wrench className="w-3 h-3" />,
        }
      : {
          badge: 'bg-[#EDE9FE] text-[#6D28D9]',
          dot: 'bg-[#8B5CF6]',
          owner: 'bg-[#EDE9FE] text-[#6D28D9]',
          icon: <Package className="w-3 h-3" />,
        }

  if (count === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${palette.dot}`} />
          {title}
        </span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${palette.badge}`}
        >
          {count} card{count === 1 ? '' : 's'}
          {countSuffix}
        </span>
      </div>

      <div className="space-y-2">
        {slots.map((s, idx) => (
          <div
            key={`${s.source_estimate_line_id}-${idx}`}
            className="grid grid-cols-[auto_1fr_auto] gap-3 items-start p-3 bg-[#F9FAFB] border border-[#F3F4F6] rounded-lg"
          >
            <span className={`w-2 h-2 rounded-full ${palette.dot} mt-1.5`} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#111] truncate">
                {s.label}
              </div>
              <div className="text-xs text-[#6B7280] mt-0.5">
                {s.material ? `Material: ${s.material}` : 'Spec per estimate'}
              </div>
              <div className="text-[11px] text-[#9CA3AF] mt-1 font-mono truncate">
                from {s.subproject_name} · {s.source_line_description}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide inline-flex items-center gap-1 ${palette.owner}`}
              >
                {palette.icon}
                {s.owner}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SchedBox({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="bg-[#F9FAFB] border border-[#F3F4F6] rounded-lg px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold text-[#111]">{value}</div>
      <div className="text-xs text-[#6B7280] mt-0.5">{detail}</div>
    </div>
  )
}

function DeptChip({ label, hrs }: { label: string; hrs: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F9FAFB] border border-[#F3F4F6] text-xs text-[#6B7280] font-mono">
      {label}{' '}
      <b className="text-[#111] font-semibold">
        {hrs > 0 ? hoursFmt(hrs) : '0 hrs'}
      </b>
    </span>
  )
}

function LockBox({
  tone,
  title,
  icon,
  items,
}: {
  tone: 'locks' | 'unlocks'
  title: string
  icon: React.ReactNode
  items: string[]
}) {
  return (
    <div
      className={
        tone === 'locks'
          ? 'bg-[#FFFBEB] border border-[#FEF3C7] rounded-lg p-3'
          : 'bg-[#F0FDF4] border border-[#DCFCE7] rounded-lg p-3'
      }
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold text-[#111] mb-2">
        {icon}
        {title}
      </div>
      <ul className="space-y-1.5 text-xs text-[#374151]">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 leading-relaxed">
            <span
              className={
                tone === 'locks' ? 'text-[#D97706]' : 'text-[#059669]'
              }
            >
              {tone === 'locks' ? '🔒' : '↑'}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Default export (plan-gated) ──

export default function HandoffPage() {
  return (
    <PlanGate requires="rate-book">
      <HandoffPageInner />
    </PlanGate>
  )
}

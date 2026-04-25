'use client'

// ============================================================================
// /projects/[id] — the project cover
// ============================================================================
// One stage-aware surface that travels with the project from bidding through
// complete. Combines the rollup view (subproject cards + sticky financial
// panel + QB preview + editable milestones) with a stage strip, attention
// strip, and a stage-specific action bar across the bottom.
//
// Stage machinery lives in the small section labeled "Stage-aware layer"
// below — strip + attention + action bar. Everything under "Data flow" is
// the rollup content that was at /projects/[id]/rollup before.
//
// Stages (projects.stage):
//   new_lead → fifty_fifty → ninety_percent → sold → production →
//   installed → complete; terminal 'lost' from any pre-sold stage.
// The visible stage strip collapses the three pre-sold variants into one
// "Bidding" node so the shop sees the 5-node pipeline from the mockup:
//   Bidding → Sold → Production → Installed → Complete
//
// Data flow:
//   1. Load project + subprojects + estimate_lines for every sub + rate_book
//   2. Per-subproject rollup via computeSubprojectRollup from lib/estimate-lines
//   3. Sum those rollups into a project-level snapshot (labor by dept, material,
//      consumables, hardware, install subtotal)
//   4. Render cards + panel; maintain editable QB-export copy in local state
//
// Deferred until there's a real integration story / user ask:
//   · Persistence for the QB-export descriptions / specs / terms
//     (currently live-only in component state)
//   · Historical-comparison backing data — stubbed with the three most
//     recently-sold sibling projects by the same org, no similarity scoring
//   · Actual Send-to-QuickBooks handoff — stubbed with a toast
//   · Client proposal toggle + send-proposal button — hidden until the
//     proposal engine lands
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  Pencil,
  Plus,
  Copy,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import {
  loadRateBook,
  loadEstimateLines,
  computeSubprojectRollup,
  type EstimateLine,
  type SubprojectRollup,
  type PricingContext,
} from '@/lib/estimate-lines'
import type { LaborDept } from '@/lib/rate-book-seed'
import {
  loadSubprojectActualHours,
  fmtActualHours,
  type SubActualsMap,
} from '@/lib/actual-hours'
import {
  loadMilestones,
  saveMilestones,
  sumMilestonePct,
  TRIGGER_LABEL,
  TRIGGER_ORDER,
  type MilestoneTrigger,
  type ProjectMilestone,
} from '@/lib/milestones'
import { Trash2, AlertCircle } from 'lucide-react'
import { updateProjectStage } from '@/lib/sales'
import { computeInstallCost, computeInstallHours } from '@/lib/install-prefill'
import { countFinishSpecsFromSlots } from '@/lib/composer'

// ── Types ──

import { isPresold, type ProjectStage } from '@/lib/types'

interface Project {
  id: string
  name: string
  client_name: string | null
  delivery_address: string | null
  stage: ProjectStage
  bid_total: number
  notes: string | null
  created_at: string
  updated_at: string
  // Phase 12 dogfood-2 Issue 12 — pinned target margin override
  // (NULL = inherit org default).
  target_margin_pct: number | null
}

interface Subproject {
  id: string
  project_id: string
  name: string
  sort_order: number
  activity_type: string | null
  material_finish: string | null
  dimensions: string | null
  linear_feet: number | null
  consumable_markup_pct: number | null
  profit_margin_pct: number | null
  ready_for_production: boolean | null
  // Phase 12 item 9 — install prefill columns. Compute install cost at
  // display time so a shop-rate change in ShopRateWalkthrough flows in.
  install_guys: number | null
  install_days: number | null
  install_complexity_pct: number | null
}

// The mockup distinguishes install-type subprojects (dashed border + purple
// tag). We don't have a first-class is_install column on subprojects yet, so
// we heuristic it from activity_type / name. Safe because it's purely visual.
function isInstallSub(sub: Subproject): boolean {
  const a = (sub.activity_type || '').toLowerCase()
  const n = (sub.name || '').toLowerCase()
  return a.includes('install') || n === 'install' || n.startsWith('install ')
}

// Per-subproject card data + its computed rollup.
interface SubCardData {
  sub: Subproject
  rollup: SubprojectRollup
  lineCount: number
  finishSpecCount: number
  /** Phase 12 item 9 — subproject-level install prefill cost. Computed
   *  off the install_* columns + the shop install rate. Added on top of
   *  rollup.total for the displayed subproject + project totals. */
  installPrefillCost: number
  /** Hours implied by the install prefill (guys × days × 8). Folds into
   *  the project rollup's hoursByDept.install + totalHours so the
   *  breakdown's labor row reflects on-site install time. */
  installPrefillHours: number
}

// Aggregate project-level rollup.
//
// Pricing-architecture cleanup: every cost bucket is at COST. Margin is
// applied exactly once at the project total and is exposed as three
// fields:
//   costTotal    — sum of all cost buckets (no markup)
//   marginAmount — priceTotal - costTotal
//   priceTotal   — costTotal × markup (customer-facing)
// `total` and `subtotal` are deprecated aliases kept for downstream
// readers that haven't migrated yet (most should use priceTotal /
// costTotal explicitly).
interface ProjectRollup {
  total: number          // alias for priceTotal — DEPRECATED
  subtotal: number       // alias for costTotal — DEPRECATED
  marginPct: number      // = effective project target margin (input)
  costTotal: number
  marginAmount: number
  priceTotal: number
  hoursByDept: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  installCost: number
  consumablesCost: number
  optionsCost: number
  installSubprojectTotal: number
  finishSpecCount: number
  // Phase 8: actuals summed across every subproject's time_entries.
  actualMinutes: number
  actualByDept: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  actualUnmappedMinutes: number
}

// QB export line — editable, client-facing copy. Lives in component state only.
interface QbLine {
  subId: string
  desc: string
  spec: string
  qty: string
  rate: number
  amount: number
}

// ── Helpers ──

function money(n: number): string {
  if (!n && n !== 0) return '$0'
  const rounded = Math.round(n)
  return rounded < 0
    ? `-$${Math.abs(rounded).toLocaleString()}`
    : `$${rounded.toLocaleString()}`
}

function hoursFmt(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}h`
}

// Cover stage collapses the three pre-sold stages (new_lead / fifty_fifty /
// ninety_percent) into the single 'bidding' node on the 5-node strip. 'lost'
// is shown as a pill instead of occupying a strip node.
type CoverStage = 'bidding' | 'sold' | 'production' | 'installed' | 'complete'
const COVER_STAGE_ORDER: CoverStage[] = ['bidding', 'sold', 'production', 'installed', 'complete']
const COVER_STAGE_LABEL: Record<CoverStage, string> = {
  bidding: 'Bidding',
  sold: 'Sold',
  production: 'Production',
  installed: 'Installed',
  complete: 'Complete',
}
function coverStageOf(stage: ProjectStage): CoverStage | 'lost' {
  if (stage === 'lost') return 'lost'
  if (stage === 'new_lead' || stage === 'fifty_fifty' || stage === 'ninety_percent') return 'bidding'
  return stage
}

// ── Page ──

export default function ProjectCoverPage() {
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
  // Phase 12 dogfood-2 Issue 12: per-project target margin overrides
  // org default. NULL = inherit. Applied uniformly to every cost bucket
  // at the project rollup; subproject rollups stay at cost so the
  // editor UI reads raw numbers.
  const marginTarget =
    project?.target_margin_pct ?? org?.profit_margin_pct ?? 35
  const [cards, setCards] = useState<SubCardData[]>([])
  // Phase 8: actuals come from time_entries and are surfaced next to every
  // estimated-hours number on this page.
  const [subActuals, setSubActuals] = useState<SubActualsMap>({})
  // Map department_id → canonical LaborDept key (by matching on departments.name).
  // Needed because hoursByDept is keyed by LaborDept but time_entries.department_id
  // is a UUID. Falls back to null for custom / unmapped departments.
  const [deptKeyById, setDeptKeyById] = useState<Record<string, LaborDept>>({})
  const [loading, setLoading] = useState(true)
  const [historicalOpen, setHistoricalOpen] = useState(false)
  const [qbOpen, setQbOpen] = useState(false)
  const [qbLines, setQbLines] = useState<QbLine[]>([])
  const [qbTerms, setQbTerms] = useState(
    'Estimate valid for 30 days. 30% deposit due at contract signing. ' +
      'Remaining balance billed per production milestones. Lead time quoted ' +
      'separately. Change orders in writing only.'
  )
  const [toast, setToast] = useState<string | null>(null)
  const [historical, setHistorical] = useState<
    { id: string; name: string; client: string | null; meta: string; total: number }[]
  >([])
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [milestonesDirty, setMilestonesDirty] = useState(false)
  const [milestonesSaving, setMilestonesSaving] = useState(false)

  // ── Load ──

  useEffect(() => {
    if (!projectId || !org?.id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [projRes, subsRes, rateBook, deptRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase
          .from('subprojects')
          .select('*')
          .eq('project_id', projectId)
          .order('sort_order'),
        loadRateBook(org!.id),
        supabase
          .from('departments')
          .select('id, name')
          .eq('org_id', org!.id),
      ])
      if (cancelled) return
      const subs = (subsRes.data || []) as Subproject[]

      // Load estimate lines for every subproject in parallel, then roll each up.
      const linesBySub = await Promise.all(
        subs.map(async (sub) => {
          const lines = await loadEstimateLines(sub.id)
          return { subId: sub.id, lines }
        })
      )
      if (cancelled) return

      const cardData: SubCardData[] = subs.map((sub) => {
        const subLines =
          linesBySub.find((x) => x.subId === sub.id)?.lines || ([] as EstimateLine[])
        const perSubCtx: PricingContext = {
          shopRate,
          consumableMarkupPct:
            sub.consumable_markup_pct ?? (org?.consumable_markup_pct ?? 10),
          // Subproject rollups always run at COST. Margin is applied
          // exactly once at the project total below.
          profitMarginPct: 0,
        }
        const rollup = computeSubprojectRollup(subLines, rateBook.itemsById, new Map(), perSubCtx)
        // Finish-spec count comes from composer slots, not the legacy
        // line.finish_specs column. Each composer line contributes:
        //   +1 carcassMaterial set, +1 doorMaterial set, +1 exteriorFinish
        //   set (excluding the Prefinished sentinel). Freeform / rate-book
        //   lines contribute 0 — they're outside the composer spec model.
        const finishSpecCount = subLines.reduce(
          (s, l) => s + countFinishSpecsFromSlots(l.product_slots as any),
          0
        )
        const installPrefill = {
          guys: sub.install_guys,
          days: sub.install_days,
          complexityPct: sub.install_complexity_pct,
        }
        const installPrefillCost = computeInstallCost(installPrefill, shopRate)
        const installPrefillHours = computeInstallHours(installPrefill)
        return {
          sub,
          rollup,
          lineCount: subLines.length,
          finishSpecCount,
          installPrefillCost,
          installPrefillHours,
        }
      })

      // Phase 8 actuals: load time_entries totals per subproject + build a
      // deptId → LaborDept key map so the per-dept drawer can show actuals
      // alongside estimates. Matches by departments.name (case-insensitive)
      // against the canonical LaborDept labels; custom depts stay unmapped.
      const subIds = subs.map((s) => s.id)
      const actuals = subIds.length > 0
        ? await loadSubprojectActualHours(subIds)
        : ({} as SubActualsMap)
      const deptKeyMap: Record<string, LaborDept> = {}
      for (const d of (deptRes.data || []) as Array<{ id: string; name: string }>) {
        const n = (d.name || '').toLowerCase()
        if (n.includes('eng')) deptKeyMap[d.id] = 'eng'
        else if (n.includes('cnc')) deptKeyMap[d.id] = 'cnc'
        else if (n.includes('assembly') || n.includes('bench')) deptKeyMap[d.id] = 'assembly'
        else if (n.includes('finish') || n.includes('paint') || n.includes('sand')) deptKeyMap[d.id] = 'finish'
        else if (n.includes('install')) deptKeyMap[d.id] = 'install'
      }

      // Historical: three most-recently-sold projects by the same org, other
      // than this one. Good enough for "similar past projects" MVP.
      const { data: histData } = await supabase
        .from('projects')
        .select('id, name, client_name, bid_total, updated_at, stage')
        .eq('org_id', org!.id)
        .eq('stage', 'sold')
        .neq('id', projectId)
        .order('updated_at', { ascending: false })
        .limit(3)

      // Milestones.
      const ms = await loadMilestones(projectId)

      if (cancelled) return
      setProject(projRes.data as Project)
      setCards(cardData)
      setSubActuals(actuals)
      setDeptKeyById(deptKeyMap)
      setMilestones(ms)
      setMilestonesDirty(false)
      setHistorical(
        (histData || []).map((h: any) => ({
          id: h.id,
          name: h.name,
          client: h.client_name,
          meta: new Date(h.updated_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          total: Number(h.bid_total) || 0,
        }))
      )

      // Seed QB lines from the computed per-subproject totals. Descriptions
      // start as "<Name> — custom millwork" (the mockup convention) but the
      // user is expected to edit each one before sending.
      // Pricing-architecture cleanup: subproject rollups are at COST now, so
      // we apply the project-level markup here to surface customer-facing
      // prices on each QB line. Install prefill cost gets marked up too.
      const qbMarginPct =
        (projRes.data as Project | null)?.target_margin_pct ??
        org?.profit_margin_pct ??
        35
      const qbMarginFrac = Math.min(Math.max(qbMarginPct / 100, 0), 0.99)
      const qbMarkup = qbMarginFrac > 0 ? 1 / (1 - qbMarginFrac) : 1
      setQbLines(
        cardData.map(({ sub, rollup, installPrefillCost }) => {
          const price = Math.round((rollup.subtotal + installPrefillCost) * qbMarkup)
          return {
            subId: sub.id,
            desc: isInstallSub(sub)
              ? 'Installation'
              : `${sub.name} — custom millwork`,
            spec: buildDefaultSpec(sub),
            qty: '1',
            rate: price,
            amount: price,
          }
        })
      )

      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, org?.id, org?.consumable_markup_pct, org?.profit_margin_pct])

  // ── Project-level rollup (summed across subs) ──

  const proj: ProjectRollup = useMemo(() => {
    // Cost buckets stay at COST. Project markup is applied exactly once
    // at the project total, surfacing as marginAmount + priceTotal.
    // Subproject views display the same cost numbers — no double-markup,
    // no surprise discrepancies between subproject card and breakdown.
    const acc: ProjectRollup = {
      total: 0,
      subtotal: 0,
      marginPct: 0,
      costTotal: 0,
      marginAmount: 0,
      priceTotal: 0,
      hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      totalHours: 0,
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      installCost: 0,
      consumablesCost: 0,
      optionsCost: 0,
      installSubprojectTotal: 0,
      finishSpecCount: 0,
      actualMinutes: 0,
      actualByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      actualUnmappedMinutes: 0,
    }
    for (const {
      sub,
      rollup,
      finishSpecCount,
      installPrefillCost,
      installPrefillHours,
    } of cards) {
      // Cost buckets — install prefill cost lands in installCost.
      acc.laborCost += rollup.laborCost
      acc.materialCost += rollup.materialCost
      acc.hardwareCost += rollup.hardwareCost
      acc.installCost += rollup.installCost + installPrefillCost
      acc.consumablesCost += rollup.consumablesCost
      acc.optionsCost += rollup.optionsCost

      // Hours — install prefill hours land ONLY on hoursByDept.install,
      // not in totalHours (dogfood3 invariant 17b). Install hours
      // surface on the Install breakdown row alongside their $; Labor
      // row reflects line-driven labor only.
      acc.hoursByDept.eng += rollup.hoursByDept.eng
      acc.hoursByDept.cnc += rollup.hoursByDept.cnc
      acc.hoursByDept.assembly += rollup.hoursByDept.assembly
      acc.hoursByDept.finish += rollup.hoursByDept.finish
      acc.hoursByDept.install += rollup.hoursByDept.install + installPrefillHours
      acc.totalHours += rollup.totalHours

      acc.finishSpecCount += finishSpecCount
      // installSubprojectTotal is at COST now (subproject rollups run
      // at cost). Kept for any downstream reader; can drop in follow-up.
      if (isInstallSub(sub))
        acc.installSubprojectTotal += rollup.total + installPrefillCost

      // Phase 8: fold in actuals for this sub.
      const a = subActuals[sub.id]
      if (a) {
        acc.actualMinutes += a.totalMinutes
        for (const [deptId, mins] of Object.entries(a.byDeptMinutes)) {
          const key = deptKeyById[deptId]
          if (key) acc.actualByDept[key] += mins
          else acc.actualUnmappedMinutes += mins
        }
      }
    }

    acc.costTotal =
      acc.laborCost +
      acc.materialCost +
      acc.hardwareCost +
      acc.installCost +
      acc.consumablesCost +
      acc.optionsCost

    const marginFraction = Math.min(Math.max(marginTarget / 100, 0), 0.99)
    const markup = marginFraction > 0 ? 1 / (1 - marginFraction) : 1
    acc.priceTotal = acc.costTotal * markup
    acc.marginAmount = acc.priceTotal - acc.costTotal
    acc.marginPct = marginTarget

    // Deprecated aliases kept for downstream readers.
    acc.subtotal = acc.costTotal
    acc.total = acc.priceTotal

    return acc
  }, [cards, subActuals, deptKeyById, marginTarget])

  // ── Actions ──

  // The actual sold commit lives on /projects/[id]/handoff, which walks the
  // user through pre-prod + schedule + invoice + lock review before flipping
  // the stage. This button just routes there — no confirm-dialog surprise.
  function handleMarkSold() {
    if (!project) return
    router.push(`/projects/${project.id}/handoff`)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  function updateQbLine(subId: string, patch: Partial<QbLine>) {
    setQbLines((prev) =>
      prev.map((l) => (l.subId === subId ? { ...l, ...patch } : l))
    )
  }

  const qbTotal = qbLines.reduce((s, l) => s + (l.amount || 0), 0)

  // ── Render states ──

  if (loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading rollup…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push(`/projects`)}
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to projects
        </button>
        <StagePill stage={project.stage} />
      </div>

      {/* Project header */}
      <div className="px-8 py-6 bg-white border-b border-[#E5E7EB]">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <h1 className="text-[22px] font-semibold text-[#111] tracking-tight mb-2">
              {project.name}
            </h1>
            <div className="flex gap-2.5 flex-wrap items-center text-xs text-[#6B7280]">
              {project.client_name && (
                <span className="px-2.5 py-1 bg-[#F3F4F6] rounded-full text-[#374151]">
                  {project.client_name}
                </span>
              )}
              {project.delivery_address && (
                <span className="px-2.5 py-1 bg-[#F3F4F6] rounded-full text-[#374151]">
                  {project.delivery_address}
                </span>
              )}
              <span className="text-[#9CA3AF]">·</span>
              <span className="text-[#9CA3AF]">
                Created{' '}
                {new Date(project.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                {' · Updated '}
                {new Date(project.updated_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[28px] font-semibold text-[#111] font-mono tabular-nums tracking-tight">
              {money(proj.priceTotal)}
            </div>
            <div className="text-xs font-semibold mt-1 text-[#059669] font-mono tabular-nums">
              {marginTarget.toFixed(0)}% margin · {money(proj.marginAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Stage-aware layer: 5-node stage strip + attention strip */}
      <StageStrip stage={project.stage} />
      <AttentionStrip stage={project.stage} cards={cards} milestones={milestones} />

      {!isPresold(project.stage) && <SoldLockBanner projectId={projectId} />}
      {org && org.shop_rate == null && <ShopRateNotConfiguredBanner />}

      {/* Main grid */}
      <div className="px-8 py-6">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          {/* LEFT — subproject cards */}
          <div>
            <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
              Subprojects · click any to {isPresold(project.stage) ? 'edit' : 'view'}
            </div>
            <div className="space-y-2.5">
              {cards.length === 0 && (
                <div className="p-6 bg-white border border-[#E5E7EB] rounded-xl text-center text-sm text-[#9CA3AF]">
                  No subprojects yet.
                </div>
              )}
              {cards.map(({ sub, rollup, lineCount, finishSpecCount, installPrefillCost }) => {
                const install = isInstallSub(sub)
                const statusReady = !!sub.ready_for_production
                const subTotalWithInstall = rollup.total + installPrefillCost
                // Phase 8 actuals for this sub (may be undefined briefly on first paint).
                const actual = subActuals[sub.id]
                const actualHrs = (actual?.totalMinutes || 0) / 60
                const hasActuals = actualHrs > 0
                const actualPctOfEst =
                  rollup.totalHours > 0 ? (actualHrs / rollup.totalHours) * 100 : 0
                return (
                  <Link
                    key={sub.id}
                    href={`/projects/${projectId}/subprojects/${sub.id}`}
                    className={`block bg-white border rounded-xl px-5 py-4 transition-all hover:border-[#2563EB] hover:shadow-sm ${
                      install
                        ? 'border-dashed border-[#D1D5DB]'
                        : 'border-[#E5E7EB]'
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto] gap-5 items-center">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 mb-1">
                          <div className="text-[15px] font-semibold text-[#111] truncate">
                            {sub.name}
                          </div>
                          {install && (
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-[#EDE9FE] text-[#6D28D9]">
                              install
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#6B7280] mb-2">
                          {[
                            sub.activity_type,
                            sub.material_finish,
                            sub.linear_feet ? `${sub.linear_feet} LF` : null,
                            sub.dimensions,
                          ]
                            .filter(Boolean)
                            .join(' · ') || (
                            <span className="italic text-[#9CA3AF]">
                              No scope yet — click to add lines
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 text-xs text-[#6B7280]">
                          <span>
                            <span className="font-mono text-[#111] mr-1">
                              {lineCount}
                            </span>
                            lines
                          </span>
                          <span
                            title={
                              hasActuals
                                ? `${fmtActualHours(actual!.totalMinutes)} clocked against ${hoursFmt(rollup.totalHours)} estimated (${actualPctOfEst.toFixed(0)}% of estimate)`
                                : 'No time clocked yet'
                            }
                          >
                            <span className="font-mono text-[#111] mr-1">
                              {hoursFmt(rollup.totalHours)}
                            </span>
                            est
                            {hasActuals && (
                              <>
                                <span className="mx-1 text-[#D1D5DB]">·</span>
                                <span
                                  className={`font-mono mr-1 ${
                                    actualPctOfEst > 100
                                      ? 'text-[#DC2626]'
                                      : 'text-[#059669]'
                                  }`}
                                >
                                  {fmtActualHours(actual!.totalMinutes)}
                                </span>
                                actual
                              </>
                            )}
                          </span>
                          <span>
                            <span className="font-mono text-[#111] mr-1">
                              {finishSpecCount}
                            </span>
                            finish{finishSpecCount === 1 ? ' spec' : ' specs'}
                          </span>
                        </div>
                        {/* dept-hour mini-strip: small bars per dept so the
                            user can eyeball the labor mix without opening
                            the sub */}
                        <div className="mt-2 flex gap-1 text-[10px] font-mono tabular-nums text-[#6B7280]">
                          {(
                            [
                              ['Eng', 'eng'],
                              ['CNC', 'cnc'],
                              ['Asm', 'assembly'],
                              ['Fin', 'finish'],
                              ['Ins', 'install'],
                            ] as const
                          ).map(([label, key]) => {
                            const h = rollup.hoursByDept[key]
                            if (h <= 0) return null
                            return (
                              <span
                                key={key}
                                className="px-1.5 py-0.5 bg-[#F3F4F6] rounded"
                              >
                                {label}{' '}
                                <span className="text-[#111]">{hoursFmt(h)}</span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[18px] font-semibold text-[#111] font-mono tabular-nums">
                          {money(subTotalWithInstall)}
                        </div>
                        {installPrefillCost > 0 && (
                          <div className="text-[10px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
                            + {money(installPrefillCost)} install
                          </div>
                        )}
                        <div
                          className={`text-[10px] mt-1.5 uppercase tracking-wider font-medium flex items-center gap-1 justify-end ${
                            statusReady ? 'text-[#059669]' : 'text-[#D97706]'
                          }`}
                        >
                          {statusReady ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5" /> Complete
                            </>
                          ) : (
                            <>
                              <Circle className="w-2.5 h-2.5" /> Draft
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
              {/* Add subproject — jumps into the new-subproject form, which
                  persists and routes to the editor on save. Hidden post-sold
                  (stage strip locks the estimate; CO is the only edit path). */}
              {isPresold(project.stage) && (
                <Link
                  href={`/projects/${projectId}/subprojects/new`}
                  className="block border border-dashed border-[#D1D5DB] rounded-xl px-4 py-3.5 text-center text-sm text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 inline mr-1" />
                  Add subproject
                </Link>
              )}
            </div>
          </div>

          {/* RIGHT — financial panel */}
          {/* Pricing-architecture cleanup: contractor-style cost-plus quote.
              Header shows final PRICE + margin amount. Breakdown rows show
              COST (not marked up) so they reconcile with subproject cards.
              Margin is applied exactly ONCE at the end — explicit row,
              then PROJECT PRICE. */}
          <div>
            <div className="sticky top-[72px] bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
              <div className="pb-4 border-b border-[#F3F4F6]">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                  Project total
                </div>
                <div className="text-[32px] font-semibold text-[#111] font-mono tabular-nums tracking-tight leading-none">
                  {money(proj.priceTotal)}
                </div>
                <div className="text-xs text-[#6B7280] mt-1.5 font-mono tabular-nums">
                  {marginTarget.toFixed(0)}% margin ·{' '}
                  <span className="text-[#059669]">
                    {money(proj.marginAmount)}
                  </span>
                </div>
                <TargetMarginEditor
                  projectId={projectId}
                  pinnedTarget={project.target_margin_pct}
                  orgDefault={org?.profit_margin_pct ?? null}
                  locked={!isPresold(project.stage)}
                  onPinnedChange={(next) =>
                    setProject((prev) =>
                      prev ? { ...prev, target_margin_pct: next } : prev,
                    )
                  }
                />
              </div>

              <div className="pt-4">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                  Cost breakdown
                </div>

                <FinRow
                  label="Labor"
                  hours={proj.totalHours}
                  value={money(proj.laborCost)}
                />
                <FinRow label="Material" value={money(proj.materialCost)} />
                <FinRow
                  label={
                    <>
                      Consumables
                      <span className="text-[10px] text-[#9CA3AF] ml-1">
                        ({(pricingCtx.consumableMarkupPct).toFixed(0)}% of material)
                      </span>
                    </>
                  }
                  value={money(proj.consumablesCost)}
                />
                <FinRow label="Specialty hardware" value={money(proj.hardwareCost)} />
                <FinRow label="Options" value={money(proj.optionsCost)} />
                <FinRow
                  label="Install"
                  hours={proj.hoursByDept.install}
                  value={money(proj.installCost)}
                />

                {/* Cost-plus summary: cost, margin, price. */}
                <div className="mt-3 pt-3 border-t border-[#E5E7EB] space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#374151]">Project cost</span>
                    <span className="font-mono text-[#111] tabular-nums">
                      {money(proj.costTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#374151]">
                      Project margin
                      <span className="text-[10px] text-[#9CA3AF] ml-1">
                        ({marginTarget.toFixed(0)}%)
                      </span>
                    </span>
                    <span className="font-mono text-[#059669] tabular-nums">
                      + {money(proj.marginAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#E5E7EB]">
                    <span className="text-[11px] font-semibold text-[#111] uppercase tracking-wider">
                      Project price
                    </span>
                    <span className="text-[18px] font-semibold font-mono text-[#111] tabular-nums">
                      {money(proj.priceTotal)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Milestones — per-project builder */}
              <MilestoneBuilder
                milestones={milestones}
                total={proj.priceTotal}
                onChange={(next) => {
                  setMilestones(next)
                  setMilestonesDirty(true)
                }}
                onSave={async () => {
                  if (!org?.id) return
                  setMilestonesSaving(true)
                  const ok = await saveMilestones({
                    org_id: org.id,
                    project_id: projectId,
                    project_total: proj.priceTotal,
                    milestones: milestones.map((m) => ({
                      label: m.label,
                      pct: m.pct,
                      trigger: m.trigger,
                      expected_date: m.expected_date,
                    })),
                  })
                  setMilestonesSaving(false)
                  if (ok) {
                    setMilestonesDirty(false)
                    showToast('Milestones saved.')
                    // Reload to pick up server-assigned ids.
                    const fresh = await loadMilestones(projectId)
                    setMilestones(fresh)
                  }
                }}
                dirty={milestonesDirty}
                saving={milestonesSaving}
              />
            </div>
          </div>
        </div>

        {/* Historical */}
        <div className="max-w-[1240px] mx-auto mt-6">
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
            <button
              onClick={() => setHistoricalOpen((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <div className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider flex items-center gap-1.5">
                <ChevronRight
                  className={`w-3.5 h-3.5 transition-transform ${
                    historicalOpen ? 'rotate-90' : ''
                  }`}
                />
                How this project compares to past work
              </div>
              {!historicalOpen && historical.length > 0 && (
                <div className="text-xs text-[#059669] font-medium">
                  ✓ {historical.length} similar past project
                  {historical.length === 1 ? '' : 's'} to compare
                </div>
              )}
            </button>

            {historicalOpen && (
              <div className="mt-4">
                {historical.length === 0 ? (
                  <div className="text-xs text-[#9CA3AF] italic py-4 text-center">
                    No sold projects yet to compare against. As you close
                    projects, they'll show up here.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      {historical.map((h) => (
                        <div
                          key={h.id}
                          className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3.5 py-3"
                        >
                          <div className="text-[12.5px] font-semibold text-[#111] mb-1 truncate">
                            {h.name}
                          </div>
                          <div className="text-[11px] text-[#9CA3AF] mb-2">
                            {h.client ? `${h.client} · ` : ''}
                            {h.meta}
                          </div>
                          <div className="text-xs font-mono text-[#374151]">
                            <span className="text-[#9CA3AF] mr-1">Total</span>
                            <span className="font-semibold">
                              {money(h.total)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] mt-3 italic">
                      Showing most recent sold projects. Similarity scoring
                      arrives once we have per-line historical data.
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stage-aware action bar */}
        <StageActionBar
          stage={project.stage}
          projectId={projectId}
          canSell={cards.length > 0}
          onPreviewQb={() => setQbOpen(true)}
          onMarkSold={handleMarkSold}
          onAdvance={async (toStage) => {
            await updateProjectStage(projectId, toStage)
            setProject((p) => (p ? { ...p, stage: toStage } : p))
            showToast(`Moved to ${toStage.replace('_', ' ')}.`)
          }}
        />
      </div>

      {/* QB Preview Modal */}
      {qbOpen && (
        <QbPreviewModal
          lines={qbLines}
          terms={qbTerms}
          total={qbTotal}
          milestones={milestones}
          projectName={project.name}
          clientName={project.client_name}
          onClose={() => setQbOpen(false)}
          onUpdateLine={updateQbLine}
          onUpdateTerms={setQbTerms}
          onCopied={() => {
            showToast(
              'Copied for QuickBooks. Paste into a new estimate — descriptions, specs, and terms are all there.'
            )
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1E40AF] text-white text-sm rounded-lg shadow-lg max-w-md text-center">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Small presentational subcomponents ──

function FinRow({
  label,
  value,
  hours,
}: {
  label: React.ReactNode
  value: string
  /** Optional hours readout. Renders next to the $ as
   *  "X.Xh · $Y". Used on the Install row so install
   *  hours don't have to ride on the Labor row. */
  hours?: number
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 py-2 text-sm border-b border-[#F3F4F6]">
      <span className="text-[#374151]">{label}</span>
      <div className="flex items-center gap-2.5">
        {hours != null && hours > 0 && (
          <span className="text-[11px] font-mono text-[#9CA3AF]">
            {hours.toFixed(1)}h
          </span>
        )}
        <span className="font-mono text-[#111] tabular-nums">{value}</span>
      </div>
    </div>
  )
}

// ── Target margin editor ──
// Editable input in the project total card. Writes
// projects.target_margin_pct. NULL = inherit org default; non-NULL = pin.
// Reset button clears the pin so it falls back to the org default again.
function TargetMarginEditor({
  projectId,
  pinnedTarget,
  orgDefault,
  locked,
  onPinnedChange,
}: {
  projectId: string
  pinnedTarget: number | null
  orgDefault: number | null
  /** When true, render the value read-only with a "(locked)" hint —
   *  no input, no Reset link. Set whenever the project is past
   *  bidding (stage !== bidding); the estimate is frozen at that point
   *  and margin changes belong to a CO, not a free-form input. */
  locked: boolean
  onPinnedChange: (next: number | null) => void
}) {
  const effective = pinnedTarget ?? orgDefault ?? 35
  const [draft, setDraft] = useState<string>(
    pinnedTarget == null ? '' : String(pinnedTarget),
  )
  const [saving, setSaving] = useState(false)

  // Keep the input in sync if the pinned value changes from elsewhere.
  useEffect(() => {
    setDraft(pinnedTarget == null ? '' : String(pinnedTarget))
  }, [pinnedTarget])

  async function commit() {
    const trimmed = draft.trim()
    let next: number | null
    if (trimmed === '') {
      next = null
    } else {
      const n = Number(trimmed)
      if (!Number.isFinite(n) || n < 0 || n >= 100) return
      next = Math.round(n * 100) / 100
    }
    if (next === pinnedTarget) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ target_margin_pct: next })
      .eq('id', projectId)
    setSaving(false)
    if (error) {
      console.error('target_margin_pct update', error)
      return
    }
    onPinnedChange(next)
  }

  async function reset() {
    if (pinnedTarget == null) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ target_margin_pct: null })
      .eq('id', projectId)
    setSaving(false)
    if (error) {
      console.error('target_margin_pct reset', error)
      return
    }
    setDraft('')
    onPinnedChange(null)
  }

  const inheritedHint =
    pinnedTarget == null
      ? `Inherited from org default (${orgDefault ?? 35}%)`
      : null

  if (locked) {
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9CA3AF]">
            Target margin
          </span>
          <div className="ml-auto flex items-baseline gap-1.5 font-mono tabular-nums text-[#111]">
            <span className="text-sm font-semibold">
              {effective.toFixed(0)}%
            </span>
            <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
              locked
            </span>
          </div>
        </div>
        <div className="text-[10.5px] text-[#9CA3AF] leading-tight">
          Margin is locked once the project is sold. Use a change order on a
          line to adjust pricing.
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
        <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9CA3AF]">
          Target margin
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="number"
            min="0"
            max="99"
            step="0.5"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder={String(orgDefault ?? 35)}
            disabled={saving}
            className="w-16 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
            aria-label="Target margin percent"
          />
          <span className="text-[12px] text-[#6B7280]">%</span>
        </div>
      </div>
      {inheritedHint && (
        <div className="text-[10.5px] text-[#9CA3AF]">{inheritedHint}</div>
      )}
      {pinnedTarget != null && (
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="text-[10.5px] text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
        >
          Reset to org default ({orgDefault ?? 35}%)
        </button>
      )}
      <div className="flex items-center gap-2 pt-1">
        <span
          className={`text-[12px] font-mono tabular-nums ${
            Math.round(effective) <= 0
              ? 'text-[#9CA3AF]'
              : 'text-[#111] font-semibold'
          }`}
        >
          {effective.toFixed(0)}%
        </span>
        <span className="text-[10.5px] text-[#9CA3AF] leading-tight">
          applied to every cost bucket. Subproject views show cost; this
          number is the markup at the project level.
        </span>
      </div>
    </div>
  )
}

// ── Milestone builder ──
// Per-project list of {label, pct, trigger}. Validates total pct = 100
// before allowing save. No default is shipped — users compose their own
// (50/25/25 or 30/10/10/10/10 etc.). Rows persist as cash_flow_receivables
// with status='projected'.

function MilestoneBuilder({
  milestones,
  total,
  onChange,
  onSave,
  dirty,
  saving,
}: {
  milestones: ProjectMilestone[]
  total: number
  onChange: (next: ProjectMilestone[]) => void
  onSave: () => void
  dirty: boolean
  saving: boolean
}) {
  const sum = sumMilestonePct(milestones)
  const balanced = Math.abs(sum - 100) < 0.01
  const empty = milestones.length === 0

  function updateOne(idx: number, patch: Partial<ProjectMilestone>) {
    const next = milestones.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  function remove(idx: number) {
    const next = milestones.slice()
    next.splice(idx, 1)
    onChange(next)
  }
  function addRow() {
    const next = milestones.slice()
    // Seed new rows with whatever slack is left so the sum auto-balances.
    const slack = Math.max(0, 100 - sum)
    next.push({
      id: `new-${Math.random().toString(36).slice(2, 8)}`,
      project_id: milestones[0]?.project_id || '',
      label: next.length === 0 ? 'Deposit' : `Milestone ${next.length + 1}`,
      pct: slack > 0 ? slack : 0,
      trigger: next.length === 0 ? 'signing' : 'manual',
      amount: Math.round((total * (slack > 0 ? slack : 0)) / 100),
      status: 'projected',
      expected_date: null,
      sort_order: next.length,
    })
    onChange(next)
  }
  function seedPreset(preset: 'half_quarter_quarter' | 'standard' | 'half_half') {
    let template: Array<Pick<ProjectMilestone, 'label' | 'pct' | 'trigger'>>
    switch (preset) {
      case 'half_quarter_quarter':
        template = [
          { label: 'Deposit', pct: 50, trigger: 'signing' },
          { label: 'Production kickoff', pct: 25, trigger: 'production' },
          { label: 'Final', pct: 25, trigger: 'punchout' },
        ]
        break
      case 'standard':
        template = [
          { label: 'Deposit', pct: 30, trigger: 'signing' },
          { label: 'Rough-in', pct: 40, trigger: 'production' },
          { label: 'Install start', pct: 20, trigger: 'install_start' },
          { label: 'Final punchout', pct: 10, trigger: 'punchout' },
        ]
        break
      case 'half_half':
        template = [
          { label: 'Deposit', pct: 50, trigger: 'signing' },
          { label: 'On delivery', pct: 50, trigger: 'delivery' },
        ]
        break
    }
    onChange(
      template.map((t, i) => ({
        id: `new-${i}`,
        project_id: milestones[0]?.project_id || '',
        label: t.label,
        pct: t.pct,
        trigger: t.trigger,
        amount: Math.round((total * t.pct) / 100),
        status: 'projected',
        expected_date: null,
        sort_order: i,
      }))
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          Payment milestones
        </div>
        <div className="text-[11px] text-[#9CA3AF]">
          {empty ? (
            <span>No milestones yet</span>
          ) : (
            <>
              Sum:{' '}
              <span
                className={`font-mono font-semibold ${
                  balanced ? 'text-[#059669]' : 'text-[#D97706]'
                }`}
              >
                {sum.toFixed(0)}%
              </span>
            </>
          )}
        </div>
      </div>

      {empty && (
        <div className="px-3 py-3 bg-[#F9FAFB] border border-dashed border-[#E5E7EB] rounded-lg mb-2 text-xs text-[#6B7280]">
          Compose the payment schedule for this project. Examples:
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              onClick={() => seedPreset('half_quarter_quarter')}
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
            >
              50 / 25 / 25
            </button>
            <button
              onClick={() => seedPreset('standard')}
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
            >
              30 / 40 / 20 / 10
            </button>
            <button
              onClick={() => seedPreset('half_half')}
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
            >
              50 / 50
            </button>
            <button
              onClick={addRow}
              className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded hover:border-[#2563EB]"
            >
              Start empty
            </button>
          </div>
        </div>
      )}

      {milestones.map((m, i) => (
        <div
          key={m.id}
          className="flex items-center gap-1.5 py-1.5 border-b border-[#F3F4F6] last:border-b-0"
        >
          <input
            value={m.label}
            onChange={(e) => updateOne(i, { label: e.target.value })}
            placeholder="Milestone name"
            className="flex-1 min-w-0 text-xs bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none text-[#111]"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={m.pct}
            onChange={(e) =>
              updateOne(i, {
                pct: Number(e.target.value) || 0,
                amount: Math.round((total * (Number(e.target.value) || 0)) / 100),
              })
            }
            className="w-[54px] flex-shrink-0 text-xs font-mono bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none text-right text-[#111]"
          />
          <select
            value={m.trigger}
            onChange={(e) => updateOne(i, { trigger: e.target.value as MilestoneTrigger })}
            className="flex-shrink-0 max-w-[130px] text-[11px] bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1 py-1 outline-none text-[#6B7280] truncate"
          >
            {TRIGGER_ORDER.map((t) => (
              <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>
            ))}
          </select>
          <button
            onClick={() => remove(i)}
            className="flex-shrink-0 p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded"
            title="Remove milestone"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {!empty && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={addRow}
            className="text-[11px] text-[#2563EB] hover:underline"
          >
            + Add milestone
          </button>
          <div className="flex-1" />
          {dirty && (
            <button
              onClick={onSave}
              disabled={!balanced || saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#2563EB] text-white rounded hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : balanced ? 'Save' : 'Must total 100%'}
            </button>
          )}
          {!dirty && !empty && (
            <span className="text-[10px] text-[#9CA3AF]">Saved</span>
          )}
        </div>
      )}

      {!empty && !balanced && (
        <div className="mt-2 px-2 py-1.5 bg-[#FEF3C7] border border-[#FDE68A] rounded text-[10.5px] text-[#92400E] flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Milestones total {sum.toFixed(0)}% — must equal 100% before saving.
          </span>
        </div>
      )}

      <div className="text-[10.5px] text-[#9CA3AF] mt-2.5 leading-relaxed">
        These become the payment plan. QB payments matched by the watcher flip
        each milestone to &ldquo;received&rdquo;.
      </div>
    </div>
  )
}

// ── QB preview modal ──

function QbPreviewModal({
  lines,
  terms,
  total,
  milestones,
  projectName,
  clientName,
  onClose,
  onUpdateLine,
  onUpdateTerms,
  onCopied,
}: {
  lines: QbLine[]
  terms: string
  total: number
  /** Saved payment milestones — drive the deposit/payment rows in the
   *  preview + clipboard text. Empty array → 30% default fallback. */
  milestones: ProjectMilestone[]
  projectName: string
  clientName: string | null
  onClose: () => void
  onUpdateLine: (subId: string, patch: Partial<QbLine>) => void
  onUpdateTerms: (v: string) => void
  onCopied: () => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

  // Build a plain-text block optimised for pasting into a fresh QuickBooks
  // estimate. One paragraph per line item (description → specs → qty/rate/
  // amount), then payment schedule, total, and terms. No markdown — QB is
  // plain text.
  function buildClipboardText(): string {
    const lead = [
      `Estimate — ${projectName}`,
      clientName ? `Client: ${clientName}` : null,
      `Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n')

    const items = lines
      .map((l) => {
        const spec = (l.spec || '').trim()
        const body = [
          l.desc,
          spec ? spec.split('\n').map((s) => `  ${s}`).join('\n') : null,
          `  Qty ${l.qty} × ${money(l.rate)} = ${money(l.amount)}`,
        ]
          .filter(Boolean)
          .join('\n')
        return body
      })
      .join('\n\n')

    const depositBlock =
      milestones.length === 0
        ? [
            '',
            `Deposit (30%): ${money(Math.round(total * 0.3))}`,
            '  Default — no payment milestones composed yet.',
          ].join('\n')
        : [
            '',
            'Payment schedule',
            ...milestones.map((m) => {
              const amt = Math.round((total * m.pct) / 100)
              return `  ${m.label} (${m.pct.toFixed(0)}%): ${money(amt)} — ${TRIGGER_LABEL[m.trigger]}`
            }),
          ].join('\n')

    const totalBlock = ['', `ESTIMATE TOTAL: ${money(total)}`].join('\n')

    const termsBlock = [
      '',
      'Terms & Conditions',
      terms,
    ].join('\n')

    return [lead, items, depositBlock, totalBlock, termsBlock].join('\n')
  }

  async function handleCopy() {
    const text = buildClipboardText()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback — old browsers / non-secure contexts.
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopyState('copied')
      onCopied()
      setTimeout(() => setCopyState('idle'), 2400)
    } catch (err) {
      console.error('QB copy failed', err)
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 3000)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#111] flex items-center gap-2">
            QuickBooks estimate preview
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#15803D] font-bold uppercase tracking-wider">
              QBO
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="text-[12.5px] text-[#6B7280] mb-1 leading-relaxed">
            This is the client-facing version of your estimate. Edit any
            description or spec, then <b>copy</b> to paste into a fresh
            QuickBooks estimate. We don't push to QB — the watcher flips your
            milestones to &ldquo;received&rdquo; when payments land.
          </div>
          <div className="text-[10.5px] text-[#9CA3AF] italic mb-3">
            Click any description or spec to edit. Changes here don't alter
            your internal line items.
          </div>

          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-2 border-b border-[#E5E7EB] text-[10px] text-[#9CA3AF] uppercase tracking-wider font-semibold">
            <div>Item / Description / Exclusions</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Amount</div>
          </div>

          {lines.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#9CA3AF] italic">
              No subprojects yet. Add lines before previewing the QB export.
            </div>
          ) : (
            lines.map((l) => (
              <div
                key={l.subId}
                className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-3 border-b border-[#F3F4F6] items-start"
              >
                <div>
                  <input
                    className="w-full bg-transparent border border-transparent hover:border-[#E5E7EB] hover:bg-[#F9FAFB] focus:border-[#2563EB] focus:bg-white focus:outline-none rounded px-1.5 py-1 text-sm font-medium text-[#111]"
                    value={l.desc}
                    onChange={(e) =>
                      onUpdateLine(l.subId, { desc: e.target.value })
                    }
                  />
                  <textarea
                    className="w-full bg-transparent border border-transparent hover:border-[#E5E7EB] hover:bg-[#F9FAFB] focus:border-[#2563EB] focus:bg-white focus:outline-none rounded px-1.5 py-1 text-[11.5px] text-[#6B7280] mt-1 resize-none leading-relaxed"
                    rows={Math.max(3, l.spec.split('\n').length + 1)}
                    value={l.spec}
                    onChange={(e) =>
                      onUpdateLine(l.subId, { spec: e.target.value })
                    }
                  />
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                  {l.qty}
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                  {money(l.rate)}
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#111] font-semibold pt-1.5">
                  {money(l.amount)}
                </div>
              </div>
            ))
          )}

          {/* Payment milestones — one row per saved milestone, or a 30%
              default deposit row when none have been composed yet. */}
          {lines.length > 0 && milestones.length === 0 && (
            <div className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-3 border-b border-[#F3F4F6] items-start">
              <div>
                <div className="text-sm font-medium text-[#111] px-1.5">
                  Deposit (30%)
                </div>
                <div className="text-[11.5px] text-[#9CA3AF] italic mt-1 px-1.5">
                  Default — no payment milestones composed yet.
                </div>
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                1
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                {money(Math.round(total * 0.3))}
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#059669] font-semibold pt-1.5">
                {money(Math.round(total * 0.3))}
              </div>
            </div>
          )}
          {lines.length > 0 &&
            milestones.length > 0 &&
            milestones.map((m) => {
              const amt = Math.round((total * m.pct) / 100)
              return (
                <div
                  key={m.id}
                  className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-3 border-b border-[#F3F4F6] items-start"
                >
                  <div>
                    <div className="text-sm font-medium text-[#111] px-1.5">
                      {m.label} ({m.pct.toFixed(0)}%)
                    </div>
                    <div className="text-[11.5px] text-[#6B7280] mt-1 px-1.5">
                      {TRIGGER_LABEL[m.trigger]}
                    </div>
                  </div>
                  <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                    1
                  </div>
                  <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                    {money(amt)}
                  </div>
                  <div className="text-right text-sm font-mono tabular-nums text-[#059669] font-semibold pt-1.5">
                    {money(amt)}
                  </div>
                </div>
              )
            })}

          {/* Total */}
          <div className="grid grid-cols-[1fr_auto] px-1 py-3 mt-2 border-t border-[#111] text-base font-semibold text-[#111]">
            <span>Estimate total</span>
            <span className="font-mono tabular-nums">{money(total)}</span>
          </div>

          {/* Terms */}
          <div className="mt-5 p-4 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
            <div className="text-[10.5px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
              Terms & conditions
            </div>
            <textarea
              className="w-full min-h-[72px] bg-white border border-[#E5E7EB] rounded-md px-3 py-2 text-[11.5px] leading-relaxed text-[#374151] focus:outline-none focus:border-[#2563EB] resize-vertical"
              value={terms}
              onChange={(e) => onUpdateTerms(e.target.value)}
            />
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex items-center justify-between gap-2">
          <div className="text-[10.5px] text-[#9CA3AF] italic">
            Paste into a new QuickBooks estimate. We watch QB for payments —
            we don't push to it.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border border-[#E5E7EB] transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleCopy}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                copyState === 'copied'
                  ? 'bg-[#15803D]'
                  : copyState === 'error'
                  ? 'bg-[#DC2626]'
                  : 'bg-[#059669] hover:bg-[#047857]'
              }`}
            >
              {copyState === 'copied' ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Copied
                </>
              ) : copyState === 'error' ? (
                <>Copy failed — try again</>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy for QuickBooks
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Default client-facing spec seed ──
// Pulls whatever structural facts we already have on the subproject + a
// generic exclusions list. Users overwrite this in the modal before sending.
function buildDefaultSpec(sub: Subproject): string {
  const parts: string[] = []
  if (sub.linear_feet) parts.push(`${sub.linear_feet} LF`)
  if (sub.activity_type) parts.push(sub.activity_type)
  if (sub.material_finish) parts.push(sub.material_finish)
  const lead = parts.length
    ? parts.join(' · ') + '.'
    : 'Scope per attached drawings.'
  const exclusions = isInstallSub(sub)
    ? '\nExcludes: electrical, plumbing, drywall repair, disposal of existing cabinetry.'
    : '\nExcludes: appliances, plumbing, countertops, backsplash, paint touch-up after install.'
  return lead + exclusions
}

// ── Shop-rate-not-configured banner ──
// Surfaces the NULL state of orgs.shop_rate so the operator understands
// why the project's labor / install / breakdown numbers are zero. Links
// to /settings where they can finish the walkthrough or set a rate.
// Banner shown post-sold on the project + subproject pages. Direct
// edit affordances (add/edit/delete) hide once the estimate locks; the
// only legitimate post-sold change path is a CO, which lives on the
// pre-production page. Link points there.
// Note signature kept ({ projectId }) so the call site doesn't have to
// change; the prop is unused now that the CTA was removed.
function SoldLockBanner(_props: { projectId: string }) {
  return (
    <div className="px-8 pt-4">
      <div className="max-w-[1240px] mx-auto px-4 py-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl">
        <div className="text-[13px] font-semibold text-[#1E40AF]">
          Locked — sold
        </div>
        <div className="text-[12px] text-[#1E3A8A] mt-0.5">
          The estimate is locked. Use change orders to modify scope, lines,
          or pricing — open a subproject and click <b>CO</b> on any line row.
        </div>
      </div>
    </div>
  )
}

function ShopRateNotConfiguredBanner() {
  return (
    <div className="px-8 pt-4">
      <div className="max-w-[1240px] mx-auto px-4 py-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#92400E]">
            Shop rate not configured
          </div>
          <div className="text-[12px] text-[#78350F] mt-0.5">
            Labor and install costs render as $0 until you finish the shop
            rate walkthrough or set a rate manually in Settings.
          </div>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#D97706] rounded-md hover:bg-[#B45309] transition-colors"
        >
          Open settings →
        </Link>
      </div>
    </div>
  )
}

// ── Stage-aware layer components ──

function StagePill({ stage }: { stage: ProjectStage }) {
  const cover = coverStageOf(stage)
  const palette: Record<CoverStage | 'lost', { bg: string; fg: string; border: string }> = {
    bidding:    { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
    sold:       { bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
    production: { bg: '#EDE9FE', fg: '#5B21B6', border: '#DDD6FE' },
    installed:  { bg: '#D1FAE5', fg: '#065F46', border: '#A7F3D0' },
    complete:   { bg: '#E5E7EB', fg: '#374151', border: '#D1D5DB' },
    lost:       { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' },
  }
  const c = palette[cover]
  const label = cover === 'lost' ? 'Lost' : COVER_STAGE_LABEL[cover]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide border"
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.border }}
    >
      {label}
    </span>
  )
}

function StageStrip({ stage }: { stage: ProjectStage }) {
  const cover = coverStageOf(stage)
  if (cover === 'lost') {
    return (
      <div className="px-8 py-4 bg-[#FEF2F2] border-b border-[#FECACA] text-center text-sm text-[#991B1B]">
        This project was marked lost. It stays on the pipeline for history but no further actions apply.
      </div>
    )
  }
  const currentIdx = COVER_STAGE_ORDER.indexOf(cover)
  return (
    <div className="px-8 py-4 bg-white border-b border-[#E5E7EB]">
      <div className="max-w-[1240px] mx-auto flex items-center gap-3">
        {COVER_STAGE_ORDER.map((s, i) => {
          const isDone = i < currentIdx
          const isCurrent = i === currentIdx
          return (
            <div key={s} className="flex items-center gap-3 flex-1 last:flex-none">
              <div className="flex items-center gap-2.5">
                <div
                  className={
                    'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center text-[10px] font-bold ' +
                    (isCurrent
                      ? 'border-[#2563EB] bg-[#DBEAFE] text-[#1E40AF]'
                      : isDone
                      ? 'border-[#059669] bg-[#D1FAE5] text-[#065F46]'
                      : 'border-[#D1D5DB] bg-white text-[#9CA3AF]')
                  }
                >
                  {isDone ? '✓' : i + 1}
                </div>
                <div
                  className={
                    'text-xs ' +
                    (isCurrent
                      ? 'text-[#111] font-semibold'
                      : isDone
                      ? 'text-[#059669]'
                      : 'text-[#9CA3AF]')
                  }
                >
                  {COVER_STAGE_LABEL[s]}
                </div>
              </div>
              {i < COVER_STAGE_ORDER.length - 1 && (
                <div
                  className={
                    'flex-1 h-[2px] ' +
                    (i < currentIdx ? 'bg-[#059669]' : 'bg-[#E5E7EB]')
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AttentionStrip({
  stage,
  cards,
  milestones,
}: {
  stage: ProjectStage
  cards: SubCardData[]
  milestones: ProjectMilestone[]
}) {
  // Per-stage issues that need attention. Short, actionable strings.
  const items: string[] = []
  const cover = coverStageOf(stage)

  if (cover === 'bidding') {
    const emptySubs = cards.filter((c) => c.lineCount === 0).length
    if (emptySubs > 0) {
      items.push(
        `${emptySubs} subproject${emptySubs === 1 ? '' : 's'} ${
          emptySubs === 1 ? 'has' : 'have'
        } no lines yet`
      )
    }
    const pct = milestones.reduce((s, m) => s + (m.pct || 0), 0)
    if (milestones.length > 0 && Math.abs(pct - 100) > 0.01) {
      items.push(`Milestones total ${pct.toFixed(0)}% — should sum to 100% before sold`)
    }
  } else if (cover === 'sold') {
    items.push('Pre-production approvals pending — finish drawings + selections to advance to Production')
  } else if (cover === 'production') {
    items.push('Log time against this project from /time — shop hours feed the actual vs. estimate rollup')
  } else if (cover === 'installed') {
    items.push('Final invoice + punchout — complete when all milestones are received and no open clock-ins')
  }

  if (items.length === 0) return null
  return (
    <div className="px-8 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A]">
      <div className="max-w-[1240px] mx-auto flex items-center gap-3 flex-wrap text-sm">
        <AlertCircle className="w-4 h-4 text-[#D97706]" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[#92400E]">
          Needs attention
        </span>
        <div className="flex gap-5 flex-wrap text-[#78350F]">
          {items.map((it, i) => (
            <span key={i}>{it}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function StageActionBar({
  stage,
  projectId,
  canSell,
  onPreviewQb,
  onMarkSold,
  onAdvance,
}: {
  stage: ProjectStage
  projectId: string
  canSell: boolean
  onPreviewQb: () => void
  onMarkSold: () => void
  onAdvance: (toStage: ProjectStage) => Promise<void>
}) {
  const cover = coverStageOf(stage)

  const secondary =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors border border-[#E5E7EB]'
  const primary =
    'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

  return (
    <div className="max-w-[1240px] mx-auto mt-6 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="flex gap-2 flex-wrap">
        <button onClick={onPreviewQb} className={secondary}>
          <Pencil className="w-4 h-4" />
          Preview QB export
        </button>
        {(cover === 'sold' || cover === 'production' || cover === 'installed' || cover === 'complete') && (
          <Link href={`/projects/${projectId}/pre-production`} className={secondary}>
            <CheckCircle2 className="w-4 h-4" />
            Pre-production
          </Link>
        )}
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        {cover === 'bidding' && (
          <button
            onClick={onMarkSold}
            disabled={!canSell}
            className={primary}
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark as sold
          </button>
        )}
        {cover === 'sold' && (
          <button onClick={() => onAdvance('production')} className={primary}>
            Start production
          </button>
        )}
        {cover === 'production' && (
          <button onClick={() => onAdvance('installed')} className={primary}>
            Mark installed
          </button>
        )}
        {cover === 'installed' && (
          <button onClick={() => onAdvance('complete')} className={primary}>
            Mark complete
          </button>
        )}
        {cover === 'complete' && (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#DCFCE7] text-[#15803D]">
            <CheckCircle2 className="w-4 h-4" />
            Complete
          </span>
        )}
      </div>
    </div>
  )
}

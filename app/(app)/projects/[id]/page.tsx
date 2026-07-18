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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  FileText,
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
import {
  computeBucketedPrice,
  resolveBucketMargins,
  type CostBuckets,
  type BucketMargins,
} from '@/lib/pricing'
import type { LaborDept } from '@/lib/rate-book-seed'
import {
  loadSubprojectActualHours,
  fmtActualHours,
  type SubActualsMap,
} from '@/lib/actual-hours'
import {
  loadMilestones,
  markMilestoneReceived,
  saveMilestones,
  sumMilestonePct,
  TRIGGER_LABEL,
  TRIGGER_ORDER,
  type MilestoneTrigger,
  type ProjectMilestone,
} from '@/lib/milestones'
import {
  loadInvoicesForProject,
  createInvoice,
  isOverdue as isInvoiceOverdue,
  type InvoiceStatus,
} from '@/lib/invoices'
import CreateInvoiceModal from '@/components/invoices/CreateInvoiceModal'
import QbPushModal from '@/components/QbPushModal'
import { invoicingMode } from '@/lib/org-settings'
import { type EstimatePdfPayload } from '@/lib/estimate-pdf'
import SendEstimateModal from '@/components/estimates/SendEstimateModal'
import ReparseModal from '@/components/reparse/ReparseModal'
import { Trash2, AlertCircle } from 'lucide-react'
import { updateProjectStage } from '@/lib/sales'
import { computeInstallCost, computeInstallHours } from '@/lib/install-prefill'
import { countFinishSpecsFromSlots } from '@/lib/composer'
import {
  loadSubprojectStatusMap,
  type SubprojectStatus,
} from '@/lib/subproject-status'
import ClientPicker from '@/components/project/ClientPicker'
import NewSubprojectModal from '@/components/project/NewSubprojectModal'
import { useConfirm } from '@/components/confirm-dialog'
import { isReadyForProduction, startProduction } from '@/lib/project-stage'

// ── Types ──

import { isPresold, type ProjectStage } from '@/lib/types'

interface Project {
  id: string
  name: string
  client_id: string | null
  client_name: string | null
  delivery_address: string | null
  stage: ProjectStage
  bid_total: number
  notes: string | null
  created_at: string
  updated_at: string
  // Phase 12 dogfood-2 Issue 12 — pinned target margin override
  // (NULL = inherit org default). Legacy single-knob field; kept as a
  // fallback. The live model is the three per-bucket pins below (052).
  target_margin_pct: number | null
  // Per-bucket margin pins (migration 052). NULL = inherit org default.
  labor_margin_pct: number | null
  material_margin_pct: number | null
  consumable_margin_pct: number | null
}

interface Subproject {
  id: string
  project_id: string
  name: string
  sort_order: number
  description: string | null
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
  marginPct: number      // = blended (effective) margin across the project
  costTotal: number
  marginAmount: number
  priceTotal: number
  // Per-bucket group costs + prices (migration 052) for the transparent
  // breakdown. labor group = labor+install; material group = material+
  // hardware+options; consumable group = consumables.
  laborGroupCost: number
  materialGroupCost: number
  consumableGroupCost: number
  laborPrice: number
  materialPrice: number
  consumablePrice: number
  blendedMarginPct: number
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
  sold: 'Pre-Production',
  production: 'In Production',
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
  // Migration 052: three per-bucket margins (labor / material / consumables).
  // Each resolves project pin → org default → 35. Subproject rollups stay
  // at cost; margin is applied once at the project rollup via
  // computeBucketedPrice so the editor UI reads raw cost numbers.
  const margins: BucketMargins = useMemo(
    () => resolveBucketMargins(project, org),
    [
      project?.labor_margin_pct,
      project?.material_margin_pct,
      project?.consumable_margin_pct,
      org?.labor_margin_pct,
      org?.material_margin_pct,
      org?.consumable_margin_pct,
    ],
  )
  const [cards, setCards] = useState<SubCardData[]>([])
  // Item 1 of post-sale-2: per-sub readiness map from
  // subproject_approval_status. Drives the AttentionStrip banner +
  // the subproject card badge so they don't lie about "approvals
  // pending" once the pre-prod page already says "ready".
  const [subStatusMap, setSubStatusMap] = useState<Record<string, SubprojectStatus>>({})
  // Phase 8: actuals come from time_entries and are surfaced next to every
  // estimated-hours number on this page.
  const [subActuals, setSubActuals] = useState<SubActualsMap>({})
  // Map department_id → canonical LaborDept key (by matching on departments.name).
  // Needed because hoursByDept is keyed by LaborDept but time_entries.department_id
  // is a UUID. Falls back to null for custom / unmapped departments.
  const [deptKeyById, setDeptKeyById] = useState<Record<string, LaborDept>>({})
  const [loading, setLoading] = useState(true)
  const [historicalOpen, setHistoricalOpen] = useState(false)
  const [qbLines, setQbLines] = useState<QbLine[]>([])
  const [qbTerms] = useState(
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

  // Derived "ready for production" gate (computed async by the effect
  // below) + the in-flight flag for the manual Start production action.
  const [readyForProduction, setReadyForProduction] = useState(false)
  const [startingProduction, setStartingProduction] = useState(false)
  const [newSubOpen, setNewSubOpen] = useState(false)
  // Milestone id → linked-invoice summary. Drives both the "Generate
  // invoice" button hiding and the read-only status pill that mirrors
  // the invoice's status (PR: invoice-milestone-sync). Void invoices
  // are excluded so a voided invoice releases the milestone back to
  // its manual mark-received affordance.
  const [milestoneInvoiceMap, setMilestoneInvoiceMap] = useState<
    Map<string, { id: string; status: InvoiceStatus; invoice_number: string; due_date: string }>
  >(new Map())
  // One project invoice = the contract. QB mode pushes it to QB
  // (projectInvoiceOpen); internal mode builds it via the ad-hoc modal.
  // Replaces per-milestone invoicing.
  const [projectInvoiceOpen, setProjectInvoiceOpen] = useState(false)
  const [adHocInvoiceOpen, setAdHocInvoiceOpen] = useState(false)
  // Send-estimate modal (MillSuite-native PDF).
  const [sendEstimateOpen, setSendEstimateOpen] = useState(false)
  // Re-parse drawings modal. Opens when the operator clicks the
  // action-bar button; reads source_pdf_paths from intake_context,
  // re-runs the parser, and surfaces a diff against current scope.
  const [reparseOpen, setReparseOpen] = useState(false)

  // ── Load ──

  // Refactored to a useCallback so the page can reload itself on focus
  // change. Pre-prod approve clicks happen on a different page; without a
  // refresh hook the project page banner / subproject card would still
  // read stale subproject_approval_status data when the user navigates
  // back here. (Item 1 of the post-sale-2 cleanup.)
  const reload = useCallback(async () => {
    if (!projectId || !org?.id) return
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
    const subs = (subsRes.data || []) as Subproject[]

    // Load estimate lines for every subproject in parallel, then roll each up.
    const linesBySub = await Promise.all(
      subs.map(async (sub) => {
        const lines = await loadEstimateLines(sub.id)
        return { subId: sub.id, lines }
      })
    )

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
      // Finish-spec count comes from:
      //   - composer slots (carcassMaterial / doorMaterial / exteriorFinish
      //     ≠ Prefinished sentinel) on each composer line, AND
      //   - freeform lines that opted into the approval flow via
      //     spec_label (migration 034) — one spec per such line.
      // Lines with neither contribute 0 — they're back-of-house cost
      // items with no client-facing decision.
      const finishSpecCount = subLines.reduce((s, l) => {
        if (l.product_key && l.product_slots) {
          return s + countFinishSpecsFromSlots(l.product_slots as any)
        }
        if (l.spec_label && l.spec_label.trim().length > 0) {
          return s + 1
        }
        return s
      }, 0)
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

    // Item 1: subproject_approval_status for the live banner + card badges.
    // Only matters post-sold (the view returns rows for every sub regardless,
    // but pre-sold UI doesn't read it). Always loaded so the focus refresh
    // path doesn't need to branch on stage.
    const statuses = subIds.length > 0
      ? await loadSubprojectStatusMap(subIds)
      : ({} as Record<string, SubprojectStatus>)

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
    // Invoices for this project — used to (a) hide the "Generate
    // invoice" button on milestones that already have a non-void
    // invoice, and (b) lock the milestone's status pill to mirror
    // the linked invoice's status. Void invoices are excluded so the
    // milestone reverts to its normal manual toggle.
    const invs = await loadInvoicesForProject(projectId)
    const milestoneMap = new Map<
      string,
      { id: string; status: InvoiceStatus; invoice_number: string; due_date: string }
    >()
    for (const i of invs) {
      if (i.status === 'void' || !i.linked_milestone_id) continue
      // If multiple non-void invoices reference the same milestone
      // (rare — would mean an old draft + a new active), keep the
      // first one we hit (loadInvoicesForProject orders by date desc,
      // so this is the latest).
      if (!milestoneMap.has(i.linked_milestone_id)) {
        milestoneMap.set(i.linked_milestone_id, {
          id: i.id,
          status: i.status,
          invoice_number: i.invoice_number,
          due_date: i.due_date,
        })
      }
    }
    setMilestoneInvoiceMap(milestoneMap)

    setProject(projRes.data as Project)
    setCards(cardData)
    setSubActuals(actuals)
    setDeptKeyById(deptKeyMap)
    setSubStatusMap(statuses)
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
    // we apply the per-bucket margins here (migration 052) to surface
    // customer-facing prices on each QB line. Because computeBucketedPrice
    // is linear per bucket, the sum of the QB line prices equals the
    // project total. Install prefill cost rides in the install bucket.
    const qbMargins = resolveBucketMargins(projRes.data as Project | null, org)
    setQbLines(
      cardData.map(({ sub, rollup, installPrefillCost }) => {
        const price = Math.round(
          computeBucketedPrice(
            {
              laborCost: rollup.laborCost,
              materialCost: rollup.materialCost,
              hardwareCost: rollup.hardwareCost,
              consumablesCost: rollup.consumablesCost,
              installCost: rollup.installCost + installPrefillCost,
              optionsCost: rollup.optionsCost,
            },
            qbMargins,
          ).priceTotal,
        )
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
  }, [projectId, org?.id, org?.consumable_markup_pct, org?.profit_margin_pct, shopRate])

  useEffect(() => {
    reload()
  }, [reload])

  // Recompute the derived "ready for production" gate whenever the project
  // or its approval / deposit inputs change. Read-only — production starts
  // manually via the Start production button (no auto-advance).
  useEffect(() => {
    if (!project || project.stage !== 'sold') {
      setReadyForProduction(false)
      return
    }
    let cancelled = false
    isReadyForProduction(projectId).then((ready) => {
      if (!cancelled) setReadyForProduction(ready)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project?.stage, subStatusMap, milestones])

  // Operator-driven sold → production transition — the only writer. Guards
  // on the readiness gate, flips the stage, and seeds schedule allocations
  // (the seeding the old auto-advance used to do).
  async function handleStartProduction() {
    if (startingProduction) return
    setStartingProduction(true)
    try {
      const ok = await startProduction(projectId)
      if (!ok) {
        showToast('Not ready for production yet — check approvals and deposit.')
        return
      }
      setProject((p) => (p ? { ...p, stage: 'production' } : p))
      showToast('Production started. Schedule allocations seeded.')
      reload()
    } finally {
      setStartingProduction(false)
    }
  }

  // Item 1: refresh on tab focus / page-show. Pre-prod approve clicks
  // happen on a different page; without this hook the banner + status
  // pills would show stale "approvals pending" until a hard reload.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onFocus() {
      reload()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') reload()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reload])

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
      laborGroupCost: 0,
      materialGroupCost: 0,
      consumableGroupCost: 0,
      laborPrice: 0,
      materialPrice: 0,
      consumablePrice: 0,
      blendedMarginPct: 0,
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

    // Migration 052: apply the three per-bucket margins via the shared
    // helper (same code path as lib/project-totals.ts — no divergence).
    const buckets: CostBuckets = {
      laborCost: acc.laborCost,
      materialCost: acc.materialCost,
      hardwareCost: acc.hardwareCost,
      consumablesCost: acc.consumablesCost,
      installCost: acc.installCost,
      optionsCost: acc.optionsCost,
    }
    const priced = computeBucketedPrice(buckets, margins)
    acc.costTotal = priced.costTotal
    acc.priceTotal = priced.priceTotal
    acc.marginAmount = priced.marginAmount
    acc.marginPct = priced.blendedMarginPct
    acc.blendedMarginPct = priced.blendedMarginPct
    acc.laborGroupCost = priced.laborGroupCost
    acc.materialGroupCost = priced.materialGroupCost
    acc.consumableGroupCost = priced.consumableGroupCost
    acc.laborPrice = priced.laborPrice
    acc.materialPrice = priced.materialPrice
    acc.consumablePrice = priced.consumablePrice

    // Deprecated aliases kept for downstream readers.
    acc.subtotal = acc.costTotal
    acc.total = acc.priceTotal

    return acc
  }, [cards, subActuals, deptKeyById, margins])

  // Item 6 + dashboard fix: keep projects.bid_total in sync with the live
  // priceTotal so every list surface that reads it (sales card, kanban,
  // /projects card, dashboard report, pre-prod header) stays current. We
  // only write when the diff is > $1 to avoid a churning update loop on
  // floating-point rounding noise. Best-effort — failures here log and
  // don't block render.
  useEffect(() => {
    if (!project) return
    if (proj.priceTotal <= 0) return
    const stored = Number(project.bid_total) || 0
    if (Math.abs(stored - proj.priceTotal) <= 1) return
    const next = Math.round(proj.priceTotal)
    ;(async () => {
      const { error } = await supabase
        .from('projects')
        .update({ bid_total: next, updated_at: new Date().toISOString() })
        .eq('id', project.id)
      if (error) {
        console.error('bid_total writeback', error)
        return
      }
      setProject((prev) => (prev ? { ...prev, bid_total: next } : prev))
    })()
  }, [project?.id, project?.bid_total, proj.priceTotal])

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

  const qbTotal = qbLines.reduce((s, l) => s + (l.amount || 0), 0)

  // ── Estimate PDF (MillSuite-native; available in both modes) ──
  // Builds the same computed lines shown on screen so the PDF total reconciles
  // with the project price. Consumed by SendEstimateModal (download + email).
  function buildEstimatePayload(): EstimatePdfPayload {
    const taxPct = Number((org as any)?.default_tax_pct) || 0
    const subtotal = qbTotal
    const taxAmount = Math.round(subtotal * (taxPct / 100))
    return {
      lineItems: qbLines.map((l) => ({
        description: [l.desc, (l.spec || '').trim()].filter(Boolean).join('\n'),
        quantity: Number(l.qty) || 1,
        unit: null,
        unit_price: l.rate,
        amount: l.amount,
      })),
      schedule: milestones.map((m) => ({
        label: m.label,
        pct: m.pct,
        trigger: TRIGGER_LABEL[m.trigger] ?? m.trigger,
        amount: Math.round((subtotal * m.pct) / 100),
      })),
      totals: { subtotal, taxPct, taxAmount, total: subtotal + taxAmount },
      terms: qbTerms,
    }
  }

  // ── QuickBooks push (only when the org's invoicing backend is QuickBooks) ──
  const qbMode = invoicingMode(org) === 'quickbooks'

  async function qbPost(path: string, payload: unknown) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'QuickBooks push failed')
    return data
  }

  async function pushProjectInvoiceToQb() {
    if (!org?.id) return
    const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
    const scheduleNote = milestones
      .map(
        (m) =>
          `${m.label} (${m.pct.toFixed(0)}%): ${fmt((qbTotal * m.pct) / 100)} — ${TRIGGER_LABEL[m.trigger]}`,
      )
      .join('\n')
    // 1. Push to QB first — if it fails, we don't leave an orphan MillSuite invoice.
    const data = await qbPost('/api/qb/push-invoice', {
      projectId,
      customerName: project?.client_name,
      lineItems: qbLines.map((l) => ({
        description: [l.desc, (l.spec || '').trim()].filter(Boolean).join('\n'),
        amount: l.amount,
        qty: Number(l.qty) || 1,
        unitPrice: l.rate,
      })),
      memo: scheduleNote || undefined,
    })
    // 2. Record the MillSuite invoice (the contract), linked to the QB invoice,
    //    so AR/balance/draws track it and the watcher can apply payments.
    const inv = await createInvoice({
      invoice: {
        org_id: org.id,
        project_id: projectId,
        client_id: project?.client_id ?? null,
        invoice_date: new Date().toISOString().slice(0, 10),
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        tax_pct: Number((org as any)?.default_tax_pct) || 0,
        notes: scheduleNote || null,
      },
      lineItems: qbLines.map((l, i) => ({
        sort_order: i,
        description: [l.desc, (l.spec || '').trim()].filter(Boolean).join('\n'),
        quantity: Number(l.qty) || 1,
        unit: null,
        unit_price: l.rate,
        amount: l.amount,
        source_type: 'subproject',
        source_id: l.subId,
      })),
      markSent: true,
    })
    if (data?.qbInvoiceId) {
      await supabase
        .from('client_invoices')
        .update({ qbo_invoice_id: data.qbInvoiceId })
        .eq('id', inv.id)
    }
    setProjectInvoiceOpen(false)
    showToast(
      `Invoice ${inv.invoice_number} pushed to QuickBooks${data.docNumber ? ` (QB #${data.docNumber})` : ''}.`,
    )
    await reload()
  }

  // ── Render states ──

  if (loading || !project) {
    return (
      <>
        <div className="min-h-[60vh] flex items-center justify-center text-sm text-[#9CA3AF]">
          Loading rollup…
        </div>
      </>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-[#F9FAFB]">
        {/* Project sub-bar — sticks below the global Nav (Nav is sticky
            top-0 z-50). top-14 = 56px = the Nav's natural height. */}
        <div className="sticky top-14 z-30 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
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
              {proj.blendedMarginPct.toFixed(0)}% margin · {money(proj.marginAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Stage-aware layer: 5-node stage strip + attention strip */}
      <StageStrip stage={project.stage} soldGateMet={readyForProduction} />
      <AttentionStrip
        projectId={projectId}
        stage={project.stage}
        cards={cards}
        milestones={milestones}
        subStatusMap={subStatusMap}
        readyForProduction={readyForProduction}
        onStartProduction={handleStartProduction}
        starting={startingProduction}
      />

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
                const subTotalWithInstall = rollup.total + installPrefillCost
                // Item 3 of post-sale-2: badge depends on stage + live
                // approval-status readiness, not the legacy
                // subprojects.ready_for_production column.
                //   pre-sold      → "DRAFT"
                //   post-sold     → "X / Y approved" (or "READY" when both
                //                   slots and drawings are 100%)
                const status = subStatusMap[sub.id]
                const presold = isPresold(project.stage)
                const slotsApproved = status?.slots_approved ?? 0
                const slotsTotal = status?.slots_total ?? 0
                const allReady = !!status?.ready_for_scheduling
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
                            .join(' · ') ||
                          /* Item 2 of post-sale-2: only show the empty-state
                              prompt when the sub genuinely has nothing — if
                              there's at least one line, the scope row
                              suppresses entirely so the dept-hour strip and
                              line count carry the message. */
                          lineCount > 0 ? null : (
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
                            presold
                              ? 'text-[#9CA3AF]'
                              : allReady
                              ? 'text-[#059669]'
                              : 'text-[#D97706]'
                          }`}
                        >
                          {presold ? (
                            <>
                              <Circle className="w-2.5 h-2.5" /> Draft
                            </>
                          ) : allReady ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5" /> Ready
                            </>
                          ) : (
                            <span className="font-mono tabular-nums">
                              {slotsApproved} / {slotsTotal} approved
                            </span>
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
                <button
                  onClick={() => setNewSubOpen(true)}
                  className="block w-full border border-dashed border-[#D1D5DB] rounded-xl px-4 py-3.5 text-center text-sm text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 inline mr-1" />
                  Add subproject
                </button>
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
                  {proj.blendedMarginPct.toFixed(0)}% blended margin ·{' '}
                  <span className="text-[#059669]">
                    {money(proj.marginAmount)}
                  </span>
                </div>
                <BucketMarginEditor
                  projectId={projectId}
                  pins={{
                    labor: project.labor_margin_pct,
                    material: project.material_margin_pct,
                    consumable: project.consumable_margin_pct,
                  }}
                  orgDefaults={{
                    labor: org?.labor_margin_pct ?? null,
                    material: org?.material_margin_pct ?? null,
                    consumable: org?.consumable_margin_pct ?? null,
                  }}
                  locked={!isPresold(project.stage)}
                  onChange={(field, next) =>
                    setProject((prev) =>
                      prev ? { ...prev, [field]: next } : prev,
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

                {/* Cost-plus summary (migration 052): cost, then each
                    bucket group's margin contribution shown transparently,
                    then the blended total + price. */}
                <div className="mt-3 pt-3 border-t border-[#E5E7EB] space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#374151]">Project cost</span>
                    <span className="font-mono text-[#111] tabular-nums">
                      {money(proj.costTotal)}
                    </span>
                  </div>
                  <MarginGroupRow
                    label="Labor + install"
                    pct={margins.laborMarginPct}
                    amount={proj.laborPrice - proj.laborGroupCost}
                  />
                  <MarginGroupRow
                    label="Material + hardware"
                    pct={margins.materialMarginPct}
                    amount={proj.materialPrice - proj.materialGroupCost}
                  />
                  <MarginGroupRow
                    label="Consumables"
                    pct={margins.consumableMarginPct}
                    amount={proj.consumablePrice - proj.consumableGroupCost}
                  />
                  <div className="flex items-center justify-between text-sm pt-1.5 border-t border-[#F3F4F6]">
                    <span className="text-[#374151]">
                      Total margin
                      <span className="text-[10px] text-[#9CA3AF] ml-1">
                        ({proj.blendedMarginPct.toFixed(0)}% blended)
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

              {/* Hours rollup — surfaces the time-clock actuals that
                  proj.actualByDept already aggregates. Per-dept est vs
                  actual with thresholded %, plus a totals line. Empty
                  state routes the operator to the time clock pre-filled
                  with this project. */}
              <ProjectHoursSection
                est={proj.hoursByDept}
                actualMinutes={proj.actualByDept}
                totalEst={proj.totalHours}
                totalActualMinutes={proj.actualMinutes}
                projectId={projectId}
              />

              {/* One project invoice = the contract. QB mode pushes it to QB;
                  internal mode opens the invoice builder. */}
              <div className="mt-4 pt-4 border-t border-[#F3F4F6] flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => (qbMode ? setProjectInvoiceOpen(true) : setAdHocInvoiceOpen(true))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] text-[#2563EB] hover:bg-[#EFF6FF] rounded-md"
                >
                  + Create project invoice
                </button>
              </div>

              {/* Milestones — per-project builder */}
              <MilestoneBuilder
                milestones={milestones}
                total={proj.priceTotal}
                milestoneInvoiceMap={milestoneInvoiceMap}
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
                onReceived={async (id) => {
                  await markMilestoneReceived(id)
                  // Optimistic local update — keep the list in place,
                  // just flip status + stamp received_date so the pill
                  // turns green immediately.
                  const today = new Date().toISOString().slice(0, 10)
                  setMilestones((prev) =>
                    prev.map((m) =>
                      m.id === id
                        ? { ...m, status: 'received', expected_date: m.expected_date || today }
                        : m,
                    ),
                  )
                  showToast('Milestone marked received.')
                }}
                dirty={milestonesDirty}
                saving={milestonesSaving}
              />

              {/* Item 4 of post-sale-2: Client picker. Pre-sold = full
                  picker + add. Post-sold = read-only display so the
                  estimate's client locks alongside everything else. */}
              {org?.id && (
                <div className="mt-4">
                  <ClientPicker
                    projectId={projectId}
                    orgId={org.id}
                    clientId={project.client_id}
                    clientName={project.client_name}
                    readOnly={!isPresold(project.stage)}
                    onChange={(next) =>
                      setProject((prev) =>
                        prev
                          ? {
                              ...prev,
                              client_id: next?.id ?? null,
                              client_name: next?.name ?? null,
                            }
                          : prev,
                      )
                    }
                  />
                </div>
              )}
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
          canStartProduction={readyForProduction}
          hasReparseable={
            Array.isArray(((project as any).intake_context as any)?.source_pdf_paths) &&
            (((project as any).intake_context as any).source_pdf_paths as string[]).length > 0
          }
          onReparse={() => setReparseOpen(true)}
          onDownloadEstimate={() => setSendEstimateOpen(true)}
          onMarkSold={handleMarkSold}
          onAdvance={async (toStage) => {
            if (toStage === 'production') {
              await handleStartProduction()
              return
            }
            await updateProjectStage(projectId, toStage)
            setProject((p) => (p ? { ...p, stage: toStage } : p))
            showToast(`Moved to ${toStage.replace('_', ' ')}.`)
          }}
        />
      </div>

      {/* Send estimate (MillSuite-native PDF — both modes) */}
      {sendEstimateOpen && (
        <SendEstimateModal
          projectId={projectId}
          payload={buildEstimatePayload()}
          clientName={project.client_name}
          projectName={project.name}
          total={qbTotal}
          orgName={org?.name ?? 'Your Company'}
          onClose={() => setSendEstimateOpen(false)}
        />
      )}


      {/* Project invoice push (QuickBooks mode — one invoice = the contract) */}
      {projectInvoiceOpen && (
        <QbPushModal
          kind="invoice"
          projectName={project.name}
          clientName={project.client_name}
          lines={qbLines.map((l) => ({
            desc: l.desc,
            spec: l.spec,
            qty: Number(l.qty) || 1,
            rate: l.rate,
            amount: l.amount,
          }))}
          scheduleRows={milestones.map((m) => ({
            label: `${m.label} (${m.pct.toFixed(0)}%)`,
            sublabel: TRIGGER_LABEL[m.trigger],
            amount: Math.round((qbTotal * m.pct) / 100),
          }))}
          total={qbTotal}
          onPush={pushProjectInvoiceToQb}
          onClose={() => setProjectInvoiceOpen(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1E40AF] text-white text-sm rounded-lg shadow-lg max-w-md text-center">
          {toast}
        </div>
      )}

      {newSubOpen && org?.id && (
        <NewSubprojectModal
          projectId={projectId}
          orgId={org.id}
          orgConsumablePct={org.consumable_markup_pct ?? null}
          onClose={() => setNewSubOpen(false)}
        />
      )}

      {adHocInvoiceOpen && org?.id && (
        <CreateInvoiceModal
          mode="ad_hoc"
          projectId={projectId}
          orgId={org.id}
          onClose={() => setAdHocInvoiceOpen(false)}
          onCreated={async (inv, action) => {
            setAdHocInvoiceOpen(false)
            showToast(
              action === 'sent'
                ? `Invoice ${inv.invoice_number} sent.`
                : `Invoice ${inv.invoice_number} saved as draft.`,
            )
            await reload()
          }}
        />
      )}

      {reparseOpen && org?.id && (
        <ReparseModal
          projectId={projectId}
          orgId={org.id}
          onClose={() => setReparseOpen(false)}
          onApplied={async (count) => {
            setReparseOpen(false)
            showToast(
              count === 0
                ? 'No changes applied.'
                : `Re-parse applied: ${count} change${count === 1 ? '' : 's'}.`,
            )
            await reload()
          }}
        />
      )}
      </div>
    </>
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

// ── Project-wide Hours rollup ──
// Five-dept est-vs-actual grid + total row. Renders below COST BREAKDOWN
// in the project total panel. Source: proj.hoursByDept (est) and
// proj.actualByDept (actual minutes). Empty state when no time has been
// clocked yet routes the operator to /time pre-filled with this project.
const HOURS_DEPTS: Array<{
  key: 'eng' | 'cnc' | 'assembly' | 'finish' | 'install'
  label: string
}> = [
  { key: 'eng', label: 'Engineering' },
  { key: 'cnc', label: 'CNC' },
  { key: 'assembly', label: 'Assembly' },
  { key: 'finish', label: 'Finish' },
  { key: 'install', label: 'Install' },
]

function pctColor(pct: number | null): string {
  if (pct == null) return '#9CA3AF'
  if (pct > 100) return '#EF4444'
  if (pct > 85) return '#F59E0B'
  return '#6B7280'
}

function HoursRow({ label, est, actual, bold }: {
  label: string
  est: number
  actual: number
  bold?: boolean
}) {
  const pct = est > 0 ? Math.round((actual / est) * 100) : null
  const color = pctColor(pct)
  const overBold = pct != null && pct > 100
  return (
    <div className={`flex items-center justify-between gap-2 py-1.5 text-[12.5px] ${bold ? 'font-semibold text-[#111]' : 'text-[#374151]'}`}>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="w-12 text-right font-mono tabular-nums text-[#6B7280]">{est.toFixed(0)}h</span>
      <span className="w-12 text-right font-mono tabular-nums text-[#374151]">{actual.toFixed(0)}h</span>
      <span
        className={`w-10 text-right font-mono tabular-nums ${overBold ? 'font-bold' : ''}`}
        style={{ color }}
      >
        {pct == null ? '—' : `${pct}%`}
      </span>
    </div>
  )
}

function ProjectHoursSection({
  est,
  actualMinutes,
  totalEst,
  totalActualMinutes,
  projectId,
}: {
  est: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  actualMinutes: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  totalEst: number
  totalActualMinutes: number
  projectId: string
}) {
  const hasActuals = totalActualMinutes > 0
  return (
    <div className="pt-4 mt-4 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          Hours
        </div>
        {hasActuals && (
          <div className="flex items-center gap-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
            <span className="w-12 text-right">Est</span>
            <span className="w-12 text-right">Actual</span>
            <span className="w-10 text-right">%</span>
          </div>
        )}
      </div>

      {hasActuals ? (
        <>
          {HOURS_DEPTS.map((d) => (
            <HoursRow
              key={d.key}
              label={d.label}
              est={est[d.key]}
              actual={(actualMinutes[d.key] || 0) / 60}
            />
          ))}
          <div className="border-t border-[#E5E7EB] mt-1 pt-1">
            <HoursRow
              label="Total"
              est={totalEst}
              actual={totalActualMinutes / 60}
              bold
            />
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2 py-2 text-[12.5px] text-[#6B7280]">
          <span>No time clocked yet</span>
          <Link
            href={`/time?project=${projectId}`}
            className="text-[#2563EB] hover:underline"
          >
            Start tracking →
          </Link>
        </div>
      )}
    </div>
  )
}

// ── Margin group summary row ──
// Read-only line in the cost-plus summary: one bucket group's margin %
// and the dollar markup it contributes to the price.
function MarginGroupRow({
  label,
  pct,
  amount,
}: {
  label: string
  pct: number
  amount: number
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#374151]">
        {label}
        <span className="text-[10px] text-[#9CA3AF] ml-1">
          ({pct.toFixed(0)}% margin)
        </span>
      </span>
      <span className="font-mono text-[#059669] tabular-nums">
        + {money(amount)}
      </span>
    </div>
  )
}

// ── Per-bucket margin editor ──
// Three pinnable TRUE gross-margin knobs (migration 052): labor+install,
// material+hardware+options, consumables. Each writes its own
// projects.*_margin_pct column. Blank = inherit the org default; a value
// pins the project. Read-only once the project leaves bidding — margin
// changes then belong to a change order.
type MarginField =
  | 'labor_margin_pct'
  | 'material_margin_pct'
  | 'consumable_margin_pct'

function BucketMarginEditor({
  projectId,
  pins,
  orgDefaults,
  locked,
  onChange,
}: {
  projectId: string
  pins: { labor: number | null; material: number | null; consumable: number | null }
  orgDefaults: {
    labor: number | null
    material: number | null
    consumable: number | null
  }
  locked: boolean
  onChange: (field: MarginField, next: number | null) => void
}) {
  const rows: {
    key: MarginField
    label: string
    pin: number | null
    orgDefault: number | null
  }[] = [
    {
      key: 'labor_margin_pct',
      label: 'Labor + install',
      pin: pins.labor,
      orgDefault: orgDefaults.labor,
    },
    {
      key: 'material_margin_pct',
      label: 'Material + hardware',
      pin: pins.material,
      orgDefault: orgDefaults.material,
    },
    {
      key: 'consumable_margin_pct',
      label: 'Consumables',
      pin: pins.consumable,
      orgDefault: orgDefaults.consumable,
    },
  ]

  return (
    <div className="mt-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-[10px] text-[#9CA3AF]">
          Margins
        </span>
        {locked && (
          <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
            locked
          </span>
        )}
      </div>
      {rows.map((r) => (
        <MarginKnob
          key={r.key}
          projectId={projectId}
          field={r.key}
          label={r.label}
          pin={r.pin}
          orgDefault={r.orgDefault}
          locked={locked}
          onCommit={(next) => onChange(r.key, next)}
        />
      ))}
      {!locked && (
        <div className="text-[10.5px] text-[#9CA3AF] leading-tight">
          True gross margin per bucket — price = cost ÷ (1 − margin). Blank
          inherits the org default. Subproject views show cost only.
        </div>
      )}
    </div>
  )
}

// One margin knob. Writes a single projects.*_margin_pct column.
function MarginKnob({
  projectId,
  field,
  label,
  pin,
  orgDefault,
  locked,
  onCommit,
}: {
  projectId: string
  field: MarginField
  label: string
  pin: number | null
  orgDefault: number | null
  locked: boolean
  onCommit: (next: number | null) => void
}) {
  const effective = pin ?? orgDefault ?? 35
  const [draft, setDraft] = useState<string>(pin == null ? '' : String(pin))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(pin == null ? '' : String(pin))
  }, [pin])

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
    if (next === pin) return
    setSaving(true)
    const { error } = await supabase
      .from('projects')
      .update({ [field]: next })
      .eq('id', projectId)
    setSaving(false)
    if (error) {
      console.error(`${field} update`, error)
      return
    }
    onCommit(next)
  }

  if (locked) {
    return (
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-[#6B7280]">{label}</span>
        <span className="font-mono tabular-nums text-sm font-semibold text-[#111]">
          {effective.toFixed(0)}%
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-[#6B7280]">{label}</span>
      <div className="flex items-center gap-1">
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
          aria-label={`${label} margin percent`}
        />
        <span className="text-[12px] text-[#6B7280]">%</span>
      </div>
    </div>
  )
}

// ── Milestone invoice pill ──
// Read-only badge that mirrors the linked invoice's status. Replaces
// the manual mark-received toggle on milestone rows that have a non-
// void invoice attached, since the invoice is now the source of
// truth for cash status. Click → invoice detail page where payments
// get recorded.

function MilestoneInvoicePill({
  invoiceId,
  invoiceNumber,
  invoiceStatus,
  isOverdue,
}: {
  invoiceId: string
  invoiceNumber: string
  invoiceStatus: InvoiceStatus
  isOverdue: boolean
}) {
  // Map invoice status → milestone-pill label + tone. Overdue
  // overrides the 'sent' label so the operator sees the warning at
  // the milestone level, not just on the invoice.
  let label: string
  let bg: string
  let fg: string
  if (isOverdue) {
    label = 'Overdue'
    bg = '#FEE2E2'
    fg = '#991B1B'
  } else {
    switch (invoiceStatus) {
      case 'draft':
        label = 'Invoice draft'
        bg = '#F3F4F6'
        fg = '#374151'
        break
      case 'sent':
        label = 'Invoiced'
        bg = '#DBEAFE'
        fg = '#1E40AF'
        break
      case 'partial':
        label = 'Partial'
        bg = '#FEF3C7'
        fg = '#92400E'
        break
      case 'paid':
        label = 'Received'
        bg = '#D1FAE5'
        fg = '#065F46'
        break
      default:
        // 'overdue' / 'void' shouldn't reach here (overdue handled
        // above; void milestones are unmapped by the parent loader).
        label = 'Invoiced'
        bg = '#DBEAFE'
        fg = '#1E40AF'
    }
  }
  return (
    <Link
      href={`/invoices/${invoiceId}`}
      className="flex-shrink-0 inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full hover:opacity-90 transition-opacity"
      style={{ backgroundColor: bg, color: fg }}
      title={`Status follows invoice ${invoiceNumber}. Record payment on the invoice.`}
    >
      {label}
    </Link>
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
  milestoneInvoiceMap,
  onGenerateInvoice,
  onChange,
  onSave,
  onReceived,
  dirty,
  saving,
}: {
  milestones: ProjectMilestone[]
  total: number
  /** Per-milestone linked-invoice summary. When a milestone is in
   *  this map, its row shows a read-only invoice-status pill instead
   *  of the manual mark-received toggle, and clicking the pill
   *  routes to the invoice detail page where payment recording
   *  happens. Void invoices are excluded by the parent loader. */
  milestoneInvoiceMap?: Map<
    string,
    { id: string; status: InvoiceStatus; invoice_number: string; due_date: string }
  >
  /** Open the create-invoice modal seeded from this milestone. The
   *  parent owns the modal state. */
  onGenerateInvoice?: (milestoneId: string) => void
  onChange: (next: ProjectMilestone[]) => void
  onSave: () => void
  /** Manual mark-received fallback for shops without QB connected. The
   *  parent flips status='received' optimistically and persists via
   *  lib/milestones.markMilestoneReceived. Reverse-syncs to any
   *  linked invoice as a side effect. */
  onReceived?: (id: string) => Promise<void>
  dirty: boolean
  saving: boolean
}) {
  const { confirm, alert } = useConfirm()
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

      {milestones.map((m, i) => {
        const amount = Math.round((total * (Number(m.pct) || 0)) / 100)
        const isReceived = m.status === 'received'
        const isPersisted = !m.id.startsWith('new-')
        return (
          <div
            key={m.id}
            className="flex items-center gap-1.5 py-1.5 border-b border-[#F3F4F6] last:border-b-0"
          >
            <input
              value={m.label}
              onChange={(e) => updateOne(i, { label: e.target.value })}
              placeholder="Milestone name"
              disabled={isReceived}
              className="flex-1 min-w-0 text-xs bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none text-[#111] disabled:opacity-60"
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
              disabled={isReceived}
              className="w-[54px] flex-shrink-0 text-xs font-mono bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none text-right text-[#111] disabled:opacity-60"
            />
            <select
              value={m.trigger}
              onChange={(e) => updateOne(i, { trigger: e.target.value as MilestoneTrigger })}
              disabled={isReceived}
              className="flex-shrink-0 max-w-[110px] text-[11px] bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1 py-1 outline-none text-[#6B7280] truncate disabled:opacity-60"
            >
              {TRIGGER_ORDER.map((t) => (
                <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>
              ))}
            </select>
            {/* Pill stack — when a non-void invoice is linked, the
                pill is read-only and mirrors the invoice's status,
                clicking routes to the invoice detail page. Otherwise
                falls back to the manual mark-received toggle (or a
                "New" placeholder for unsaved rows). */}
            {(() => {
              const linkedInvoice = milestoneInvoiceMap?.get(m.id)
              if (linkedInvoice) {
                return (
                  <MilestoneInvoicePill
                    invoiceId={linkedInvoice.id}
                    invoiceNumber={linkedInvoice.invoice_number}
                    invoiceStatus={linkedInvoice.status}
                    isOverdue={isInvoiceOverdue({
                      status: linkedInvoice.status,
                      due_date: linkedInvoice.due_date,
                    })}
                  />
                )
              }
              return (
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  {isPersisted && m.status === 'projected' && onGenerateInvoice && (
                    <button
                      onClick={() => onGenerateInvoice(m.id)}
                      className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[#DBEAFE] text-[#1E40AF] hover:bg-[#BFDBFE] transition-colors"
                      title="Generate an invoice from this milestone"
                    >
                      Invoice
                    </button>
                  )}
                  {isReceived ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[#D1FAE5] text-[#065F46]"
                      title="Marked received — flip via QB watcher or manual button"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Received
                    </span>
                  ) : isPersisted && onReceived ? (
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Mark milestone as received?',
                          message: `Records ${money(amount)} (${m.label || 'this milestone'}) received on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Use this when you've taken the payment outside QB or want to override the watcher.`,
                          confirmLabel: 'Mark received',
                        })
                        if (!ok) return
                        try {
                          await onReceived(m.id)
                        } catch {
                          await alert({
                            title: 'Couldn’t mark received',
                            message:
                              'Something went wrong saving the change. Open the browser console for the full error and try again.',
                          })
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[#F3F4F6] text-[#6B7280] hover:bg-[#DBEAFE] hover:text-[#1E40AF] transition-colors"
                      title="Mark this milestone as received (manual fallback for non-QB shops)"
                    >
                      Projected
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[#F3F4F6] text-[#9CA3AF]">
                      New
                    </span>
                  )}
                </div>
              )
            })()}
            <button
              onClick={() => remove(i)}
              disabled={isReceived}
              className="flex-shrink-0 p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded disabled:opacity-40 disabled:hover:text-[#9CA3AF]"
              title={isReceived ? 'Received milestones can\'t be removed — refund via QB instead' : 'Remove milestone'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}

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
  // Prefer the subproject's real description (migrated from Built OS or entered
  // by hand) — it carries material, dimensions, details, and exclusions, and is
  // exactly what should show on the QuickBooks line item. Use it verbatim; only
  // fall back to a generated spec when there's no description.
  const desc = (sub.description || '').trim()
  if (desc) return desc
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

function StageStrip({
  stage,
  soldGateMet,
}: {
  stage: ProjectStage
  /** When true AND the current cover stage is 'sold', the Sold pip
   *  renders with a green check + emerald tone (same treatment as
   *  completed stages) instead of the active blue. The actual stage
   *  doesn't change — it stays 'sold' until the operator advances —
   *  this is a purely visual "you're cleared to move to Production"
   *  signal. Connector to the next pip is unchanged. */
  soldGateMet?: boolean
}) {
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
          // Sold pip green-checks when the gate clears, even though the
          // stage hasn't advanced. Treat it as "done-styled, current"
          // for the dot; keep the connector logic alone so Production
          // doesn't look active.
          const isGateGreen = !!soldGateMet && s === 'sold' && isCurrent
          return (
            <div key={s} className="flex items-center gap-3 flex-1 last:flex-none">
              <div className="flex items-center gap-2.5">
                <div
                  className={
                    'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center text-[10px] font-bold ' +
                    (isGateGreen
                      ? 'border-[#059669] bg-[#D1FAE5] text-[#065F46]'
                      : isCurrent
                      ? 'border-[#2563EB] bg-[#DBEAFE] text-[#1E40AF]'
                      : isDone
                      ? 'border-[#059669] bg-[#D1FAE5] text-[#065F46]'
                      : 'border-[#D1D5DB] bg-white text-[#9CA3AF]')
                  }
                >
                  {isDone || isGateGreen ? '✓' : i + 1}
                </div>
                <div
                  className={
                    'text-xs ' +
                    (isGateGreen
                      ? 'text-[#059669] font-semibold'
                      : isCurrent
                      ? 'text-[#111] font-semibold'
                      : isDone
                      ? 'text-[#059669]'
                      : 'text-[#9CA3AF]')
                  }
                >
                  {COVER_STAGE_LABEL[s]}
                  {isGateGreen && (
                    <span className="ml-1.5 text-[10px] font-normal text-[#059669]">
                      · ready
                    </span>
                  )}
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

interface AttentionItem {
  text: string
  /** Optional CTA rendered on the right side of the banner. */
  cta?: { label: string; href: string }
}

function AttentionStrip({
  projectId,
  stage,
  cards,
  milestones,
  subStatusMap,
  readyForProduction,
  onStartProduction,
  starting,
}: {
  projectId: string
  stage: ProjectStage
  cards: SubCardData[]
  milestones: ProjectMilestone[]
  /** subproject_approval_status rows keyed by subproject_id — the
   *  authoritative readiness signal for the post-sold banner. Empty
   *  when not yet loaded; the banner falls back to a pending message
   *  until the first load completes. */
  subStatusMap: Record<string, SubprojectStatus>
  /** Derived readiness gate (every sub approved AND the deposit in). When
   *  true on a sold project, the green Ready banner + Start button shows. */
  readyForProduction: boolean
  onStartProduction: () => void
  starting: boolean
}) {
  // Per-stage issues that need attention. Short, actionable strings,
  // each optionally with a CTA on the right.
  const items: AttentionItem[] = []
  const cover = coverStageOf(stage)

  // Ready for production: green banner + Start button, overriding the amber
  // needs-attention treatment. readyForProduction already requires every sub
  // approved AND the deposit received, so this only fires on a sold project.
  if (cover === 'sold' && readyForProduction) {
    return (
      <div className="px-8 py-2.5 bg-[#ECFDF5] border-b border-[#A7F3D0]">
        <div className="max-w-[1240px] mx-auto flex items-center gap-3 flex-wrap text-sm">
          <CheckCircle2 className="w-4 h-4 text-[#059669]" />
          <span className="text-[12px] font-semibold uppercase tracking-wider text-[#065F46]">
            Ready for production
          </span>
          <div className="flex-1 min-w-0 text-[12px] text-[#065F46]">
            All approvals complete · deposit received
          </div>
          <button
            onClick={onStartProduction}
            disabled={starting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#059669] rounded-md hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {starting ? 'Starting…' : 'Start production'}
          </button>
        </div>
      </div>
    )
  }

  if (cover === 'bidding') {
    const emptySubs = cards.filter((c) => c.lineCount === 0).length
    if (emptySubs > 0) {
      items.push({
        text: `${emptySubs} subproject${emptySubs === 1 ? '' : 's'} ${
          emptySubs === 1 ? 'has' : 'have'
        } no lines yet`,
      })
    }
    const pct = milestones.reduce((s, m) => s + (m.pct || 0), 0)
    if (milestones.length > 0 && Math.abs(pct - 100) > 0.01) {
      items.push({
        text: `Milestones total ${pct.toFixed(0)}% — should sum to 100% before sold`,
      })
    }
  } else if (cover === 'sold') {
    // Item 1: read live readiness from subproject_approval_status. Banner
    // shows "approvals pending" only when at least one sub isn't ready;
    // suppresses entirely when every sub reads ready_for_scheduling.
    const subIds = cards.map((c) => c.sub.id)
    const statuses = subIds.map((id) => subStatusMap[id]).filter(Boolean)
    const ready = statuses.filter((s) => s.ready_for_scheduling).length
    const total = subIds.length
    if (total > 0 && statuses.length === total && ready === total) {
      // Every sub is approved but the gate isn't green (readyForProduction
      // was false above) → the deposit is the only thing left.
      items.push({
        text: 'All approvals complete · awaiting deposit before production can start',
      })
    } else {
      const remaining = Math.max(0, total - ready)
      items.push({
        text: `Pre-production approvals pending · ${ready} of ${total} subproject${
          total === 1 ? '' : 's'
        } ready · ${remaining} blocked on specs or drawings`,
        cta: {
          label: 'Open pre-production',
          href: `/projects/${projectId}/pre-production`,
        },
      })
    }
  } else if (cover === 'production') {
    items.push({
      text: 'Log time against this project from /time — shop hours feed the actual vs. estimate rollup',
    })
  } else if (cover === 'installed') {
    items.push({
      text: 'Final invoice + punchout — complete when all milestones are received and no open clock-ins',
    })
  }

  if (items.length === 0) return null
  return (
    <div className="px-8 py-2.5 bg-[#FFFBEB] border-b border-[#FDE68A]">
      <div className="max-w-[1240px] mx-auto flex items-center gap-3 flex-wrap text-sm">
        <AlertCircle className="w-4 h-4 text-[#D97706]" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[#92400E]">
          Needs attention
        </span>
        <div className="flex gap-5 flex-wrap text-[#78350F] flex-1 min-w-0">
          {items.map((it, i) => (
            <span key={i}>{it.text}</span>
          ))}
        </div>
        {/* CTA from the first item that carries one. Items with their
            own CTA are rare (today: only the post-sold approvals
            banner), so a single right-side button keeps the layout
            tight. */}
        {(() => {
          const cta = items.find((it) => it.cta)?.cta
          if (!cta) return null
          return (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#D97706] rounded-md hover:bg-[#B45309] transition-colors flex-shrink-0"
            >
              {cta.label} →
            </Link>
          )
        })()}
      </div>
    </div>
  )
}

function StageActionBar({
  stage,
  projectId,
  canSell,
  canStartProduction,
  hasReparseable,
  onReparse,
  onDownloadEstimate,
  onMarkSold,
  onAdvance,
}: {
  stage: ProjectStage
  projectId: string
  canSell: boolean
  /** Gates the Start production button — only shown when the project has
   *  cleared the readiness gate (all approvals + deposit). */
  canStartProduction: boolean
  hasReparseable: boolean
  onReparse: () => void
  onDownloadEstimate: () => void
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
        <button onClick={onDownloadEstimate} className={secondary}>
          <FileText className="w-4 h-4" />
          Send estimate
        </button>
        {hasReparseable && (
          <button
            onClick={onReparse}
            className={secondary}
            title="Re-run the parser against the original drawings and review what changed"
          >
            <FileText className="w-4 h-4" />
            Re-parse drawings
          </button>
        )}
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
        {cover === 'sold' && canStartProduction && (
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

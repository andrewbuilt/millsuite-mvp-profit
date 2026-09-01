'use client'

// ============================================================================
// /projects/[id]/pre-production — sold-project approvals + drawings + COs
// ============================================================================
// Built to mockups/preprod-redesign-mockup.html (approved 2026-09-01). The
// point of the reskin was to make this feel like the project page rather than
// a separate tool:
//
//   Sticky subbar     — Back to project + StagePill (same as the project page)
//   Project header    — white block, name + Pre-production chip, client /
//                       address pills, big mono bid total + deposit line
//   Gate strip        — "N approvals to go" + count boxes + progress bar
//   Main grid         — subproject cards (Approvals | Drawings) beside a
//                       sticky "What's left" punch list
//   Change orders     — single-row card
//   Explainer         — muted paragraph
//
// The slot + drawing cards still come from ApprovalSlots / DrawingsTrack; the
// approval WORKFLOW is untouched, this is presentation plus one derived panel.
//
// ⚠️ The sell-it guide rings this page. `approvals-page`, `back-to-project`,
// `spec-list` and `drawings-approve` must each keep resolving to exactly ONE
// element — run `node scripts/check-tour-targets.mjs` after touching it.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, AlertCircle, Circle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import ApprovalSlots from '@/components/approval-slots'
import DrawingsTrack from '@/components/drawings-track'
import ChangeOrders, {
  CreateCoModal,
  type CreateCoModalSeed,
} from '@/components/change-orders'
import { loadSubprojectStatusMap, type SubprojectStatus } from '@/lib/subproject-status'
import StagePill from '@/components/project/StagePill'
import { isDepositReceived, isReadyForProduction, startProduction } from '@/lib/project-stage'
import {
  loadApprovalItemsForSubproject,
  seedApprovalItemsFromEstimate,
  type ApprovalItem,
} from '@/lib/approvals'
import type { PricingInputs } from '@/lib/change-orders'
import { resolveBucketMargins } from '@/lib/pricing'
import type { ProjectStage } from '@/lib/types'
import { loadComposerRateBook } from '@/lib/composer-loader'
import {
  initialSubprojectDefaults,
  loadSubprojectDefaults,
} from '@/lib/composer-persist'
import { productLabelForLine, type ComposerRateBook, type ComposerDefaults, type ComposerSlots } from '@/lib/composer'
import type { ProductKey } from '@/lib/products'

interface Project {
  id: string
  name: string
  client_name: string | null
  delivery_address: string | null
  stage: ProjectStage
  bid_total: number
  sold_at: string | null
  target_start_date: string | null
  labor_margin_pct: number | null
  material_margin_pct: number | null
  consumable_margin_pct: number | null
}

/** One open thing standing between this project and production. Derived
 *  entirely from data the page already loads — no new queries. */
interface PunchItem {
  key: string
  /** Where clicking scrolls to. Slot rows carry `id="slot-<itemId>"`;
   *  subproject cards carry `id="sub-<subId>"`. */
  anchorId: string
  /** Set for approval slots so the card can be expanded, not just scrolled. */
  approvalItemId?: string
  label: string
  who: string
  tone: 'pending' | 'review'
  done?: boolean
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
  const [toast, setToast] = useState<string | null>(null)
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
  // Spec-CO modal: when a SlotCard's "+ CO" is clicked we resolve the
  // underlying composer line + build a seed, then mount CreateCoModal
  // here once. composerRateBook is loaded lazily on first open.
  const [composerRateBook, setComposerRateBook] = useState<ComposerRateBook | null>(null)
  const [coSeed, setCoSeed] = useState<CreateCoModalSeed | null>(null)
  const [coDefaults, setCoDefaults] = useState<ComposerDefaults | null>(null)
  // Deposit + readiness feed the header line and the sidebar's Start button.
  // Both are async gates, so they land after the first paint.
  const [depositIn, setDepositIn] = useState(false)
  const [readyForProduction, setReadyForProduction] = useState(false)
  const [startingProduction, setStartingProduction] = useState(false)
  /** Slot the punch list asked to open, handed to ApprovalSlots so clicking a
   *  sidebar row expands the card rather than just scrolling near it. */
  const [focusItemId, setFocusItemId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectId || !org?.id) return
    // Self-heal: seed approval_items from estimate lines (composer slots
    // first, then legacy finish_specs/callouts) before reading. Idempotent
    // via dedupe in createApprovalItemsFromProposals — repeated calls become
    // a no-op once every (sub, label, material, finish) is covered. This is
    // what produces the "3 spec rows from one composer line" Andrew expects
    // on a sold project whose original handoff didn't see composer slots.
    try {
      await seedApprovalItemsFromEstimate(projectId, org.id)
    } catch (err) {
      console.error('seedApprovalItemsFromEstimate', err)
    }

    const [projRes, subsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, client_name, delivery_address, stage, bid_total, sold_at, target_start_date, labor_margin_pct, material_margin_pct, consumable_margin_pct')
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

    // Gates last — they're independent reads, and the page is useful without
    // them. Errors here must not blank a page full of approvals.
    try {
      const [dep, ready] = await Promise.all([
        isDepositReceived(projectId),
        isReadyForProduction(projectId),
      ])
      setDepositIn(dep)
      setReadyForProduction(ready)
    } catch (err) {
      console.error('pre-production gates', err)
    }
  }, [projectId, org?.id])

  useEffect(() => {
    reload()
  }, [reload])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  // Map an approval-item label to a composer slot key. Mirrors the
  // built-in mapping in lib/approvals.proposeSlotsFromComposerLine.
  // Door pricing v2: door material now lives on doorMaterialId; the
  // exterior-finish slot is now doorFinishId. The approval-card labels
  // didn't change — only the lookup target moved.
  function slotKeyForLabel(label: string): string | null {
    if (label === 'Carcass material') return 'carcassMaterial'
    if (label === 'Door/drawer material') return 'doorMaterialId'
    if (label === 'Exterior finish') return 'doorFinishId'
    return null
  }

  // Spec-CO entry: ApprovalSlots calls into here when a "+ CO" button
  // is clicked. We resolve the underlying composer line off the
  // approval_item, lazy-load the composer rate book + per-sub defaults
  // (cached after the first call), then build a CreateCoModalSeed
  // pre-scoped to the slot. The modal mount below handles the rest.
  async function openSpecCo(
    approvalItemId: string,
    subprojectId: string,
    subprojectName: string,
  ) {
    if (!org?.id) return
    try {
      // 1. Resolve the source composer line.
      const { data: itemRaw } = await supabase
        .from('approval_items')
        .select('id, label, source_estimate_line_id')
        .eq('id', approvalItemId)
        .maybeSingle()
      const item = itemRaw as
        | { id: string; label: string; source_estimate_line_id: string | null }
        | null
      if (!item) return
      const slotKey = slotKeyForLabel(item.label)
      if (!slotKey || !item.source_estimate_line_id) return

      const { data: lineRaw } = await supabase
        .from('estimate_lines')
        .select('id, description, quantity, product_key, product_slots')
        .eq('id', item.source_estimate_line_id)
        .maybeSingle()
      const line = lineRaw as
        | {
            id: string
            description: string
            quantity: number
            product_key: ProductKey | null
            product_slots: ComposerSlots | null
          }
        | null
      if (!line || !line.product_key || !line.product_slots) return

      // 2. Lazy-load the composer rate book (one fetch per session)
      //    and the subproject's composer defaults (one fetch per
      //    subproject per modal open — small enough to skip caching).
      let rb = composerRateBook
      if (!rb) {
        rb = await loadComposerRateBook(org.id)
        setComposerRateBook(rb)
      }
      const defaults =
        (await loadSubprojectDefaults(subprojectId)) ||
        initialSubprojectDefaults(org?.consumable_markup_pct ?? null)
      setCoDefaults(defaults)

      // 3. Build the seed.
      setCoSeed({
        subprojectId,
        subprojectName,
        lineId: line.id,
        productKey: line.product_key,
        productSlots: line.product_slots,
        qty: Number(line.quantity) || 0,
        productLabel: productLabelForLine(line.product_key, line.description) ?? line.product_key,
        description: line.description || '',
        source: 'spec',
        approvalItemId,
        preSelectedSlot: slotKey as
          | 'carcassMaterial'
          | 'doorMaterialId'
          | 'doorFinishId',
      })
    } catch (err) {
      console.error('openSpecCo', err)
    }
  }

  // Pre-computed counts — one pass across the project's approval items.
  const counts = useMemo(() => {
    const approved = allItems.filter((i) => i.state === 'approved').length
    const inReview = allItems.filter((i) => i.state === 'in_review').length
    const pending = allItems.filter((i) => i.state === 'pending').length
    return { approved, inReview, pending, total: allItems.length }
  }, [allItems])

  const subNameById = useMemo(
    () => Object.fromEntries(subs.map((s) => [s.id, s.name])),
    [subs],
  )

  /** The "What's left" list. Every row is derived from data already on the
   *  page — unapproved slots, unapproved drawings, and the deposit — so the
   *  sidebar can never disagree with the cards beside it. */
  const punchList = useMemo<PunchItem[]>(() => {
    const open: PunchItem[] = []
    const done: PunchItem[] = []

    for (const it of allItems) {
      const subName = subNameById[it.subproject_id] || 'Subproject'
      if (it.state === 'approved') continue
      open.push({
        key: `slot-${it.id}`,
        anchorId: `slot-${it.id}`,
        approvalItemId: it.id,
        label: `${subName} · ${it.label}`,
        who: it.ball_in_court === 'client' ? 'client' : 'shop',
        tone: it.state === 'in_review' ? 'review' : 'pending',
      })
    }

    // Drawings come from the status view's counts rather than loading every
    // revision — the card beside it already shows the detail.
    for (const s of subs) {
      const st = statusMap[s.id]
      if (!st) continue
      const openRevs = st.latest_drawing_revisions - st.latest_drawings_approved
      if (openRevs > 0) {
        open.push({
          key: `draw-${s.id}`,
          anchorId: `sub-${s.id}`,
          label: `${s.name} · drawings`,
          who: 'shop',
          tone: 'review',
        })
      }
    }

    if (depositIn) {
      done.push({ key: 'deposit', anchorId: '', label: 'Deposit received', who: '', tone: 'pending', done: true })
    } else {
      open.push({ key: 'deposit', anchorId: '', label: 'Deposit', who: 'client', tone: 'pending' })
    }

    // Fully-cleared subprojects get one struck-through line each, so the list
    // shows progress rather than only what's wrong.
    for (const s of subs) {
      const st = statusMap[s.id]
      if (st?.ready_for_scheduling) {
        done.push({
          key: `done-${s.id}`,
          anchorId: `sub-${s.id}`,
          label: `${s.name} · all approvals`,
          who: '',
          tone: 'pending',
          done: true,
        })
      }
    }

    return [...open, ...done]
  }, [allItems, subs, statusMap, subNameById, depositIn])

  const openCount = punchList.filter((p) => !p.done).length

  /** Sidebar row → the card it refers to. Expands the slot as well as
   *  scrolling, so the operator lands on the thing itself, open. */
  function focusPunchItem(p: PunchItem) {
    if (p.approvalItemId) setFocusItemId(p.approvalItemId)
    if (!p.anchorId) return
    // Let the expand render before measuring the scroll target.
    requestAnimationFrame(() => {
      document.getElementById(p.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  async function handleStartProduction() {
    if (!readyForProduction || startingProduction) return
    setStartingProduction(true)
    try {
      // Same readiness-gated writer the project page uses — lib/project-stage
      // stays the only thing that flips the stage and seeds allocations.
      const ok = await startProduction(projectId)
      if (ok) router.push(`/projects/${projectId}`)
      else showToast('Not ready for production yet.')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start production.')
    } finally {
      setStartingProduction(false)
    }
  }

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

  // Drawing totals for the gate strip, summed off the same status view the
  // punch list uses so the two can't disagree.
  const drawingsTotal = subs.reduce((n, s) => n + (statusMap[s.id]?.latest_drawing_revisions || 0), 0)
  const drawingsApproved = subs.reduce((n, s) => n + (statusMap[s.id]?.latest_drawings_approved || 0), 0)

  const pricing: PricingInputs = {
    shopRate: org?.shop_rate ?? 0,
    consumableMarkupPct: org?.consumable_markup_pct ?? 10,
    profitMarginPct: org?.profit_margin_pct ?? 35,
    // Per-bucket margins (052) so CO repricing matches the project total.
    margins: resolveBucketMargins(project, org),
  }

  const soldDate = fmtDate(project.sold_at)
  const installTarget = fmtDate(project.target_start_date)

  return (
    /* data-tour: the sell-it guide's approvals step lands here; the page-sized
       target renders the card centered, which is right for a look-around. It
       also doubles as the appears-signal for "Click Pre-production". */
    <div data-tour="approvals-page" className="min-h-screen bg-[#F9FAFB]">
      {/* Sticky subbar — same pattern as the project page, now with the stage
          pill this page never had. */}
      <div className="sticky top-0 z-30 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          data-tour="back-to-project"
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to project
        </button>
        <StagePill stage={project.stage} />
      </div>

      {/* Project header */}
      <div className="px-8 py-6 bg-white border-b border-[#E5E7EB]">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <h1 className="text-[22px] font-semibold text-[#111] tracking-tight mb-2 flex items-center gap-2.5 flex-wrap">
              {project.name}
              <span className="text-[12px] font-semibold text-[#1E40AF] bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-[3px] rounded-full tracking-normal">
                Pre-production
              </span>
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
              {(soldDate || installTarget) && (
                <>
                  <span className="text-[#9CA3AF]">·</span>
                  <span className="text-[#9CA3AF]">
                    {[soldDate ? `Sold ${soldDate}` : null, installTarget ? `Install target ${installTarget}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[28px] font-semibold text-[#111] font-mono tabular-nums tracking-tight">
              {fmtMoney(project.bid_total)}
            </div>
            <div
              className={
                'text-[12px] font-semibold font-mono mt-1 ' +
                (depositIn ? 'text-[#059669]' : 'text-[#B45309]')
              }
            >
              {depositIn ? 'Deposit received' : 'Deposit pending'}
            </div>
          </div>
        </div>
      </div>

      {/* Gate strip */}
      {/* data-tour: the sell-it guide's "Get approved" step. */}
      <div
        data-tour="approval-gate"
        className={
          'px-8 py-4 border-b ' +
          (allReady
            ? 'bg-gradient-to-r from-[#F0FDF4] to-[#ECFDF5] border-[#BBF7D0]'
            : 'bg-gradient-to-r from-[#FFFBEB] to-[#FEF3C7] border-[#FDE68A]')
        }
      >
        <div className="max-w-[1240px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={
                'w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0 text-white ' +
                (allReady ? 'bg-[#059669]' : 'bg-[#F59E0B]')
              }
            >
              {allReady ? <CheckCircle2 className="w-[18px] h-[18px]" /> : <AlertCircle className="w-[18px] h-[18px]" />}
            </div>
            <div>
              <div className={'text-[14px] font-semibold ' + (allReady ? 'text-[#065F46]' : 'text-[#92400E]')}>
                {/* "item", not "approval" — the punch list also counts the
                    deposit and open drawings, and on a project with no specs
                    yet this read "1 approval to go" about a payment. */}
                {subs.length === 0
                  ? 'No subprojects on this project.'
                  : allReady
                    ? 'Everything approved — ready for production'
                    : `${openCount} item${openCount === 1 ? '' : 's'} to go before production`}
              </div>
              <div className={'text-[12px] mt-0.5 ' + (allReady ? 'text-[#047857]' : 'text-[#B45309]')}>
                Everything green-lights the Start production button.
              </div>
            </div>
          </div>
          {/* Wraps — three fixed-width boxes and a headline can't share one
              row on a laptop, and without this the Deposit box ran off the
              right edge. */}
          <div className="flex gap-2.5 flex-wrap shrink-0">
            <GateStat label="Materials" value={`${counts.approved} / ${counts.total}`} ok={counts.total > 0 && counts.approved === counts.total} />
            <GateStat label="Drawings" value={`${drawingsApproved} / ${drawingsTotal}`} ok={drawingsTotal > 0 && drawingsApproved === drawingsTotal} />
            <GateStat label="Deposit" value={depositIn ? '✓' : '—'} ok={depositIn} />
          </div>
        </div>
        {/* Progress bar — approved slots ÷ total. */}
        <div className={'h-1 rounded-full max-w-[1240px] mx-auto mt-3 overflow-hidden ' + (allReady ? 'bg-[#A7F3D0]' : 'bg-[#FDE68A]')}>
          <div
            className={'h-full rounded-full transition-[width] duration-300 ' + (allReady ? 'bg-[#059669]' : 'bg-[#F59E0B]')}
            style={{ width: `${counts.total === 0 ? 0 : Math.round((counts.approved / counts.total) * 100)}%` }}
          />
        </div>
      </div>

      {/* Main grid — cards beside the sticky punch list */}
      <div className="max-w-[1240px] mx-auto px-8 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div>
          {subs.length === 0 && (
            <div className="p-6 bg-white border border-[#E5E7EB] rounded-xl text-center text-sm text-[#9CA3AF]">
              This project has no subprojects yet.
            </div>
          )}

          {subs.map((sub, subIndex) => {
            const status = statusMap[sub.id]
            const ready = status?.ready_for_scheduling
            const approvedHere = allItems.filter((i) => i.subproject_id === sub.id && i.state === 'approved').length
            const totalHere = allItems.filter((i) => i.subproject_id === sub.id).length
            return (
              <section
                key={sub.id}
                id={`sub-${sub.id}`}
                className="bg-white border border-[#E5E7EB] rounded-2xl mb-4 overflow-hidden transition-colors hover:border-[#93C5FD] scroll-mt-24"
              >
                {/* Card header */}
                <div className="flex items-center justify-between gap-4 flex-wrap px-[18px] py-3.5 border-b border-[#F3F4F6]">
                  {/* No letter avatar — the mockup had one, Andrew didn't want
                      it once it was on real subproject names. */}
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-[#111]">{sub.name}</div>
                    <div className="text-[12px] text-[#9CA3AF] mt-px">
                      {[sub.linear_feet ? `${sub.linear_feet} LF` : null, sub.activity_type]
                        .filter(Boolean)
                        .join(' · ') || 'no LF set'}
                    </div>
                  </div>
                  <span
                    className={
                      'text-[11px] font-semibold px-2.5 py-1 rounded-full border ' +
                      (ready
                        ? 'text-[#065F46] bg-[#ECFDF5] border-[#A7F3D0]'
                        : 'text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]')
                    }
                  >
                    {ready ? 'Ready ✓' : `${approvedHere} / ${totalHere} approved`}
                  </span>
                </div>

                {/* Two columns: approvals | drawings.
                    Drawings gets 320px and only splits at xl — its header row
                    carries two action buttons ("Mark approved manually" /
                    "Upload revision"), and at the mockup's 260px on lg they
                    were clipped. Below xl the two tracks stack full-width. */}
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px]">
                  <div className="xl:border-r border-[#F3F4F6] border-b xl:border-b-0 pb-3">
                    <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em] px-[18px] pt-3 pb-1.5">
                      Approvals
                    </div>
                    <div className="px-3">
                      <ApprovalSlots
                        subprojectId={sub.id}
                        actorUserId={user?.id}
                        onChange={reload}
                        onCreateSpecCo={(approvalItemId) =>
                          void openSpecCo(approvalItemId, sub.id, sub.name)
                        }
                        focusItemId={focusItemId}
                        hideHeader
                        // First subproject only — a data-tour value must resolve
                        // to exactly one element (the guide rings the spec LIST).
                        tourTag={subIndex === 0 ? 'spec-list' : undefined}
                      />
                    </div>
                  </div>
                  <div className="pb-3">
                    <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em] px-[18px] pt-3 pb-1.5">
                      Drawings
                    </div>
                    <div className="px-3">
                      <DrawingsTrack
                        subprojectId={sub.id}
                        actorUserId={user?.id}
                        onChange={reload}
                        hideHeader
                        tourTag={subIndex === 0 ? 'drawings-approve' : undefined}
                      />
                    </div>
                  </div>
                </div>
              </section>
            )
          })}

          {/* Change orders */}
          {subs.length > 0 && (
            <div className="bg-white border border-[#E5E7EB] rounded-2xl px-[18px] py-3.5">
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em] mb-3">
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

          {/* Explainer — muted paragraph rather than the old blue panel. */}
          <p className="text-[12px] text-[#9CA3AF] leading-relaxed max-w-[640px] mt-[18px]">
            Materials and drawings get approved here, per subproject. When every slot is green and
            the deposit is in, production can start. Approved slots lock — changes after approval go
            through a change order. Client approval is a status you mark by hand after talking to
            them; nothing here emails or pushes to QuickBooks on its own.
          </p>
        </div>

        {/* Sticky punch list. Stacks below the cards under lg. */}
        <div className="lg:sticky lg:top-[64px]">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl px-[18px] py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] mb-3">
              What's left
            </h3>
            {punchList.length === 0 ? (
              <div className="text-[13px] text-[#9CA3AF] italic py-2">Nothing outstanding.</div>
            ) : (
              punchList.map((p) =>
                p.done ? (
                  <div key={p.key} className="flex items-center gap-2.5 py-[7px] text-[13px] text-[#9CA3AF] line-through">
                    <PunchDot tone="approved" />
                    {p.label}
                  </div>
                ) : (
                  <button
                    key={p.key}
                    onClick={() => focusPunchItem(p)}
                    className="w-full flex items-center gap-2.5 py-[7px] text-[13px] text-left border-b border-[#F9FAFB] last:border-0 hover:text-[#1E40AF] transition-colors"
                  >
                    <PunchDot tone={p.tone} />
                    <span className="flex-1 min-w-0 truncate">{p.label}</span>
                    {p.who && <span className="text-[11px] text-[#9CA3AF] shrink-0">{p.who}</span>}
                  </button>
                ),
              )
            )}
            <button
              onClick={handleStartProduction}
              disabled={!readyForProduction || startingProduction}
              className={
                'w-full mt-2.5 py-2.5 rounded-[10px] text-[13px] font-semibold transition-colors ' +
                (readyForProduction
                  ? 'bg-[#059669] text-white hover:bg-[#047857] cursor-pointer'
                  : 'bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed')
              }
            >
              {startingProduction
                ? 'Starting…'
                : readyForProduction
                  ? 'Start production'
                  : `Start production — ${openCount} to go`}

            </button>
            <div className="text-[11px] text-[#9CA3AF] text-center mt-2">
              {readyForProduction ? 'Everything is approved.' : 'Turns green when the last approval lands.'}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#111] text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Spec-CO modal — single mount, opens whenever coSeed is set
          via openSpecCo from a SlotCard's "+ CO" click. */}
      {coSeed && composerRateBook && coDefaults && (
        <CreateCoModal
          projectId={projectId}
          pricing={pricing}
          subprojects={subs.map((s) => ({ id: s.id, name: s.name }))}
          seed={coSeed}
          composerRateBook={composerRateBook}
          composerDefaults={coDefaults}
          onClose={() => setCoSeed(null)}
          onCreated={async () => {
            setCoSeed(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

// ── Small building blocks ──

/** One count box in the gate strip. */
function GateStat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="bg-white/75 border border-[#FDE68A] rounded-[10px] px-3.5 py-2 text-center min-w-[92px]">
      <div className={'text-[15px] font-semibold font-mono tabular-nums ' + (ok ? 'text-[#059669]' : 'text-[#111]')}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-[0.06em] text-[#92400E] mt-0.5">{label}</div>
    </div>
  )
}

/** State dot in the punch list — mirrors the slot-card dot colours. */
function PunchDot({ tone }: { tone: 'pending' | 'review' | 'approved' }) {
  const bg = tone === 'approved' ? '#059669' : tone === 'review' ? '#F59E0B' : '#D1D5DB'
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bg }} />
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

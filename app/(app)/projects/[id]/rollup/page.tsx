'use client'

// ============================================================================
// Project rollup + QB preview — the "is this project ready to sell?" view.
// ============================================================================
// Translates project-rollup-mockup.html into the MillSuite visual language.
// Shows every subproject as a clickable card, a sticky financial panel on the
// right, a historical-comparison block, and an action bar that hosts the
// QuickBooks preview modal and "mark as sold" flow.
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
  FileText,
  Send,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import {
  loadRateBook,
  loadEstimateLines,
  computeSubprojectRollup,
  type EstimateLine,
  type SubprojectRollup,
  type PricingDefaults,
} from '@/lib/estimate-lines'
// Mark-as-sold now routes to /projects/[id]/handoff instead of flipping the
// stage inline — import intentionally dropped.

// ── Types ──

interface Project {
  id: string
  name: string
  client_name: string | null
  delivery_address: string | null
  stage: string | null
  status: string
  bid_total: number
  notes: string | null
  created_at: string
  updated_at: string
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
}

// Aggregate project-level rollup.
interface ProjectRollup {
  total: number
  subtotal: number
  marginPct: number
  hoursByDept: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  totalHours: number
  laborCost: number
  materialCost: number
  hardwareCost: number
  sheetCost: number
  consumables: number
  installSubprojectTotal: number
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

function marginColor(margin: number, target: number): string {
  if (margin >= target) return 'text-[#059669]'
  if (margin >= target - 5) return 'text-[#D97706]'
  return 'text-[#DC2626]'
}

// ── Page ──

export default function ProjectRollupPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()

  const shopRate = org?.shop_rate || 75
  const marginTarget = org?.profit_margin_pct ?? 32
  const pricingDefaults: PricingDefaults = useMemo(
    () => ({
      shopRate,
      consumableMarkupPct: org?.consumable_markup_pct ?? 15,
      profitMarginPct: org?.profit_margin_pct ?? 35,
    }),
    [shopRate, org?.consumable_markup_pct, org?.profit_margin_pct]
  )

  const [project, setProject] = useState<Project | null>(null)
  const [cards, setCards] = useState<SubCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [deptOpen, setDeptOpen] = useState(false)
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

  // ── Load ──

  useEffect(() => {
    if (!projectId || !org?.id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [projRes, subsRes, rateBook] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase
          .from('subprojects')
          .select('*')
          .eq('project_id', projectId)
          .order('sort_order'),
        loadRateBook(org!.id),
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
        const perSubDefaults: PricingDefaults = {
          ...pricingDefaults,
          consumableMarkupPct:
            sub.consumable_markup_pct ?? pricingDefaults.consumableMarkupPct,
          profitMarginPct:
            sub.profit_margin_pct ?? pricingDefaults.profitMarginPct,
        }
        const rollup = computeSubprojectRollup(subLines, rateBook, perSubDefaults)
        return { sub, rollup, lineCount: subLines.length }
      })

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

      if (cancelled) return
      setProject(projRes.data as Project)
      setCards(cardData)
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
      setQbLines(
        cardData.map(({ sub, rollup }) => ({
          subId: sub.id,
          desc: isInstallSub(sub)
            ? 'Installation'
            : `${sub.name} — custom millwork`,
          spec: buildDefaultSpec(sub),
          qty: '1',
          rate: Math.round(rollup.total),
          amount: Math.round(rollup.total),
        }))
      )

      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, org?.id, pricingDefaults])

  // ── Project-level rollup (summed across subs) ──

  const proj: ProjectRollup = useMemo(() => {
    const acc: ProjectRollup = {
      total: 0,
      subtotal: 0,
      marginPct: 0,
      hoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
      totalHours: 0,
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      sheetCost: 0,
      consumables: 0,
      installSubprojectTotal: 0,
    }
    for (const { sub, rollup } of cards) {
      acc.total += rollup.total
      acc.subtotal += rollup.subtotal
      acc.hoursByDept.eng += rollup.hoursByDept.eng
      acc.hoursByDept.cnc += rollup.hoursByDept.cnc
      acc.hoursByDept.assembly += rollup.hoursByDept.assembly
      acc.hoursByDept.finish += rollup.hoursByDept.finish
      acc.hoursByDept.install += rollup.hoursByDept.install
      acc.totalHours += rollup.totalHours
      acc.laborCost += rollup.laborCost
      acc.materialCost += rollup.materialCost
      acc.hardwareCost += rollup.hardwareCost
      acc.sheetCost += rollup.sheetCost
      acc.consumables += rollup.consumables
      if (isInstallSub(sub)) acc.installSubprojectTotal += rollup.total
    }
    acc.marginPct =
      acc.total > 0 ? ((acc.total - acc.subtotal) / acc.total) * 100 : 0
    return acc
  }, [cards])

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
  const depositAmount = Math.round(qbTotal * 0.3)

  // ── Render states ──

  if (loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading rollup…
      </div>
    )
  }

  const isSold = project.stage === 'sold'

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
        <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
          <span className="font-medium text-[#6B7280]">Project rollup</span>
          {isSold && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] text-[11px] font-semibold uppercase tracking-wide">
              <CheckCircle2 className="w-3 h-3" /> Sold
            </span>
          )}
        </div>
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
              {money(proj.total)}
            </div>
            <div
              className={`text-xs font-semibold mt-1 ${marginColor(
                proj.marginPct,
                marginTarget
              )}`}
            >
              {proj.marginPct.toFixed(0)}% margin
              {proj.marginPct >= marginTarget
                ? ` · above ${marginTarget}% target`
                : ` · ${(marginTarget - proj.marginPct).toFixed(0)}% under target`}
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="px-8 py-6">
        <div className="max-w-[1240px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          {/* LEFT — subproject cards */}
          <div>
            <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
              Subprojects · click any to edit
            </div>
            <div className="space-y-2.5">
              {cards.length === 0 && (
                <div className="p-6 bg-white border border-[#E5E7EB] rounded-xl text-center text-sm text-[#9CA3AF]">
                  No subprojects yet.
                </div>
              )}
              {cards.map(({ sub, rollup, lineCount }) => {
                const mCls = marginColor(rollup.marginPct, marginTarget)
                const install = isInstallSub(sub)
                const statusReady = !!sub.ready_for_production
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
                          <span>
                            <span className="font-mono text-[#111] mr-1">
                              {hoursFmt(rollup.totalHours)}
                            </span>
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[18px] font-semibold text-[#111] font-mono tabular-nums">
                          {money(rollup.total)}
                        </div>
                        <div className={`text-xs font-semibold mt-0.5 ${mCls}`}>
                          {rollup.marginPct.toFixed(0)}% margin
                        </div>
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
              {/* Add subproject — routes back to the project page where the
                  subproject creation UI lives. Keeps this page focused on
                  rollup/review rather than CRUD. */}
              <Link
                href={`/projects/${projectId}`}
                className="block border border-dashed border-[#D1D5DB] rounded-xl px-4 py-3.5 text-center text-sm text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add subproject (blank, clone, or parse from drawings)
              </Link>
            </div>
          </div>

          {/* RIGHT — financial panel */}
          <div>
            <div className="sticky top-[72px] bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
              <div className="pb-4 border-b border-[#F3F4F6]">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                  Project total
                </div>
                <div className="text-[32px] font-semibold text-[#111] font-mono tabular-nums tracking-tight leading-none">
                  {money(proj.total)}
                </div>
                <div className="flex items-center gap-2.5 mt-3">
                  <div
                    className={`text-lg font-bold font-mono tabular-nums ${marginColor(
                      proj.marginPct,
                      marginTarget
                    )}`}
                  >
                    {proj.marginPct.toFixed(0)}%
                  </div>
                  <div className="text-[11.5px] text-[#6B7280] leading-tight">
                    margin · target {marginTarget}%
                    <br />
                    {proj.marginPct >= marginTarget
                      ? "You're above target."
                      : `You're ${(marginTarget - proj.marginPct).toFixed(
                          0
                        )}% below target.`}
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                  Breakdown
                </div>

                {/* Labor (expandable) */}
                <button
                  onClick={() => setDeptOpen((v) => !v)}
                  className="w-full grid grid-cols-[1fr_auto_auto] gap-2.5 items-center py-2 text-sm border-b border-[#F3F4F6] hover:bg-[#F9FAFB] -mx-2 px-2 rounded transition-colors"
                >
                  <span className="text-[#374151] text-left flex items-center gap-1.5">
                    <ChevronRight
                      className={`w-3 h-3 text-[#9CA3AF] transition-transform ${
                        deptOpen ? 'rotate-90' : ''
                      }`}
                    />
                    Labor
                  </span>
                  <span className="text-[11px] font-mono text-[#9CA3AF]">
                    {hoursFmt(proj.totalHours)}
                  </span>
                  <span className="font-mono text-[#111] tabular-nums">
                    {money(proj.laborCost)}
                  </span>
                </button>
                {deptOpen && (
                  <div className="pl-4 ml-1 border-l border-[#DBEAFE] py-1 mb-1 space-y-1">
                    {(
                      [
                        ['Engineering', 'eng'],
                        ['CNC', 'cnc'],
                        ['Assembly', 'assembly'],
                        ['Finish', 'finish'],
                        ['Install', 'install'],
                      ] as const
                    ).map(([label, key]) => {
                      const hrs = proj.hoursByDept[key]
                      const cost = hrs * shopRate
                      if (hrs <= 0) return null
                      return (
                        <div
                          key={key}
                          className="grid grid-cols-[1fr_auto_auto] gap-2.5 py-0.5 text-[11.5px] text-[#6B7280]"
                        >
                          <span>{label}</span>
                          <span className="font-mono">{hoursFmt(hrs)}</span>
                          <span className="font-mono text-[#374151]">
                            {money(cost)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <FinRow label="Material" value={money(proj.materialCost + proj.sheetCost)} />
                <FinRow
                  label={
                    <>
                      Consumables
                      <span className="text-[10px] text-[#9CA3AF] ml-1">
                        ({(pricingDefaults.consumableMarkupPct).toFixed(0)}% of material)
                      </span>
                    </>
                  }
                  value={money(proj.consumables)}
                />
                <FinRow label="Specialty hardware" value={money(proj.hardwareCost)} />
                <FinRow
                  label="Install (subproject)"
                  value={money(proj.installSubprojectTotal)}
                />
              </div>

              {/* Cash flow */}
              <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                  Cash flow · QB-linked
                </div>
                <CfRow
                  label="Deposit at signing"
                  pct="30%"
                  amt={money(proj.total * 0.3)}
                  accent
                />
                <CfRow
                  label="Progress at rough-in"
                  pct="40%"
                  amt={money(proj.total * 0.4)}
                />
                <CfRow
                  label="Progress at install start"
                  pct="20%"
                  amt={money(proj.total * 0.2)}
                />
                <CfRow
                  label="Final at punchout"
                  pct="10%"
                  amt={money(proj.total * 0.1)}
                />
                <div className="text-[11px] text-[#9CA3AF] mt-2.5 leading-relaxed">
                  Payment milestones become QB invoices when the project is
                  marked sold.
                </div>
              </div>
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

        {/* Actions bar */}
        <div className="max-w-[1240px] mx-auto mt-6 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/projects/${projectId}/estimate`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors border border-[#E5E7EB]"
              title="Open the printable estimate"
            >
              <FileText className="w-4 h-4" />
              Printable estimate
            </Link>
            <button
              onClick={() => setQbOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors border border-[#E5E7EB]"
            >
              <Pencil className="w-4 h-4" />
              Preview QB export
            </button>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => setQbOpen(true)}
              disabled={cards.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#059669] text-white hover:bg-[#047857] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
              Send to QB as estimate
            </button>
            {!isSold ? (
              <button
                onClick={handleMarkSold}
                disabled={cards.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Mark as sold
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#DCFCE7] text-[#15803D]">
                <CheckCircle2 className="w-4 h-4" />
                Already sold
              </span>
            )}
          </div>
        </div>
      </div>

      {/* QB Preview Modal */}
      {qbOpen && (
        <QbPreviewModal
          lines={qbLines}
          terms={qbTerms}
          total={qbTotal}
          deposit={depositAmount}
          onClose={() => setQbOpen(false)}
          onUpdateLine={updateQbLine}
          onUpdateTerms={setQbTerms}
          onSend={() => {
            showToast(
              'Estimate staged for QuickBooks. (Integration stub — no request sent.)'
            )
            setQbOpen(false)
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
}: {
  label: React.ReactNode
  value: string
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2.5 items-center py-2 text-sm border-b border-[#F3F4F6]">
      <span className="text-[#374151]">{label}</span>
      <span className="font-mono text-[#111] tabular-nums">{value}</span>
    </div>
  )
}

function CfRow({
  label,
  pct,
  amt,
  accent,
}: {
  label: string
  pct: string
  amt: string
  accent?: boolean
}) {
  return (
    <div className="grid grid-cols-[1fr_60px_auto] gap-2.5 py-1.5 text-sm border-b border-[#F3F4F6] last:border-b-0">
      <span className="text-[#374151]">{label}</span>
      <span className="text-[11px] font-mono text-[#9CA3AF]">{pct}</span>
      <span
        className={`font-mono tabular-nums text-right ${
          accent ? 'text-[#059669] font-semibold' : 'text-[#111]'
        }`}
      >
        {amt}
      </span>
    </div>
  )
}

// ── QB preview modal ──

function QbPreviewModal({
  lines,
  terms,
  total,
  deposit,
  onClose,
  onUpdateLine,
  onUpdateTerms,
  onSend,
}: {
  lines: QbLine[]
  terms: string
  total: number
  deposit: number
  onClose: () => void
  onUpdateLine: (subId: string, patch: Partial<QbLine>) => void
  onUpdateTerms: (v: string) => void
  onSend: () => void
}) {
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
            This is how the estimate will appear in QuickBooks. Descriptions are
            client-facing — edit anything before sending. Specs, exclusions,
            and terms travel with the estimate <b>and into preproduction</b> so
            your team builds exactly what was quoted.
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

          {/* Deposit row */}
          {lines.length > 0 && (
            <div className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-3 border-b border-[#F3F4F6] items-start">
              <div>
                <div className="text-sm font-medium text-[#111] px-1.5">
                  Deposit (30%)
                </div>
                <div className="text-[11.5px] text-[#6B7280] mt-1 px-1.5">
                  Due at contract signing. Balance billed at production
                  milestones.
                </div>
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                1
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                {money(deposit)}
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#059669] font-semibold pt-1.5">
                {money(deposit)}
              </div>
            </div>
          )}

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

        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border border-[#E5E7EB] transition-colors"
          >
            Back
          </button>
          <button
            onClick={onSend}
            className="px-3.5 py-2 rounded-lg text-sm font-medium bg-[#059669] text-white hover:bg-[#047857] transition-colors"
          >
            Send to QuickBooks
          </button>
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

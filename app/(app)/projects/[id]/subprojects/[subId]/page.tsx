'use client'

// ============================================================================
// /projects/[id]/subprojects/[subId] — Phase 2 subproject editor
// ============================================================================
// Per BUILD-ORDER Phase 2 + subproject-editor-mockup.html.
//
//   - Line table: qty, item/desc, unit, hours, total, finish summary, notes.
//   - Autocomplete grouped by category with confidence badge + times-used.
//   - Freeform lines first-class (any unit, any dept-hours, lump material).
//   - Right panel: buildup + options hooks + finish specs + install mode.
//   - Clone from past subproject (V1 minimal, modal).
//   - Keyboard: `/` add, ↑↓ navigate, ⏎ commit, ⌫ on empty deletes, ⌘D dup.
//
// All math routes through lib/estimate-lines.ts; rate book through
// lib/rate-book-v2.ts. Labor $ uses orgs.shop_rate (Phase 12 item 12).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { resolveBucketMargins } from '@/lib/pricing'
import { normalizeItemName } from '@/lib/subproject-description'
import { recomputeProjectBidTotal } from '@/lib/project-totals'
import { useConfirm } from '@/components/confirm-dialog'
import { supabase } from '@/lib/supabase'
import {
  EstimateLine,
  EstimateLineOptionRow,
  FinishSpec,
  InstallMode,
  PricingContext,
  addEstimateLine,
  attachLineOption,
  computeLineBuildup,
  computeSubprojectRollup,
  deleteEstimateLine,
  detachLineOption,
  duplicateEstimateLine,
  loadEstimateLines,
  loadLineOptions,
  loadRateBook,
  updateEstimateLine,
} from '@/lib/estimate-lines'
import {
  CONFIDENCE_COLOR,
  CONFIDENCE_LABEL,
  Confidence,
  RateBookItemRow,
  RateBookOptionRow,
  Unit,
  listOptions,
} from '@/lib/rate-book-v2'
import { LaborDept, LABOR_DEPTS, LABOR_DEPT_LABEL } from '@/lib/rate-book-seed'
import {
  loadSubprojectActuals,
  fmtActualHours,
  type SubActuals,
} from '@/lib/actual-hours'
import { ArrowLeft, Copy, Plus, Trash2, X, Pencil } from 'lucide-react'
import AddLineComposer from '@/components/composer/AddLineComposer'
import FreeformLineModal from '@/components/subproject/FreeformLineModal'
import InstallPrefill from '@/components/subproject/InstallPrefill'
import {
  computeInstallCost,
  emptyInstallPrefill,
  type InstallPrefill as InstallPrefillValues,
} from '@/lib/install-prefill'
import { loadComposerRateBook } from '@/lib/composer-loader'
import {
  initialSubprojectDefaults,
  loadSubprojectDefaults,
} from '@/lib/composer-persist'
import type { ComposerDefaults, ComposerRateBook, ComposerSlots } from '@/lib/composer'
import { productLabelFromKey } from '@/lib/composer'
import { hasMissingSlots } from '@/lib/parser-slot-resolver'
import type { ProductKey } from '@/lib/products'
import {
  bulkRefreshStaleLines,
  findStaleLines,
} from '@/lib/composer-staleness'
import { isPresold, type ProjectStage } from '@/lib/types'
import { CreateCoModal, type CreateCoModalSeed } from '@/components/change-orders'

// ── Formatting ──

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `$${Math.round(n).toLocaleString()}`
}
function fmtHours(n: number) {
  if (!Number.isFinite(n) || n === 0) return '—'
  return `${(Math.round(n * 10) / 10).toFixed(1)} hr`
}

interface SubprojectRow {
  id: string
  project_id: string
  name: string
  description: string | null
  linear_feet: number | null
  consumable_markup_pct: number | null
  activity_type: string | null
  details_json: unknown
  exclusions_json: unknown
}

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  // Phase 12 item 10: gates the staleness banner (only shown presold).
  stage: ProjectStage
  // Phase 12 dogfood-2 Issue 12: project's pinned target margin
  // (NULL = inherit org default). Used for the cost-mode subproject
  // bottom-bar's target readout so it agrees with the project page.
  target_margin_pct: number | null
  // Per-bucket margin pins (052) — used to price change orders here.
  labor_margin_pct: number | null
  material_margin_pct: number | null
  consumable_margin_pct: number | null
}

// True when this subproject's activity type is "install" — the install
// subproject handles all install labor for the project, so regular subs
// hide the Install department row in line details + buildup.
function isInstallSub(sub: { activity_type?: string | null; name?: string | null } | null): boolean {
  if (!sub) return false
  const a = (sub.activity_type || '').toLowerCase()
  if (a === 'install' || a.includes('install')) return true
  const n = (sub.name || '').toLowerCase()
  return n === 'install' || n.startsWith('install ')
}

type OptionsPerLine = Map<string, Array<{ option: RateBookOptionRow; effect_value_override: number | null }>>

// ── Page ──

export default function SubprojectEditorPage() {
  const { id: projectId, subId } = useParams() as { id: string; subId: string }
  const router = useRouter()
  const { org } = useAuth()
  const { confirm, alert: showAlert } = useConfirm()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [subproject, setSubproject] = useState<SubprojectRow | null>(null)
  // Synced QB service items → activity-type dropdown. Empty until a QB item
  // sync has run (Settings → QuickBooks); the field still shows the current
  // value so nothing is lost when the cache is cold.
  const [qbItems, setQbItems] = useState<
    Array<{ qb_id: string; name: string | null; description: string | null }>
  >([])
  // Every subproject on the project, for the tab bar. Only id/name/sort_order
  // are needed here; the active sub carries its full row in `subproject`.
  const [siblingSubs, setSiblingSubs] = useState<Array<{ id: string; name: string; sort_order: number }>>([])
  const [lines, setLines] = useState<EstimateLine[]>([])
  const [items, setItems] = useState<RateBookItemRow[]>([])
  const [options, setOptions] = useState<RateBookOptionRow[]>([])
  const [lineOptions, setLineOptions] = useState<OptionsPerLine>(new Map())
  const [loading, setLoading] = useState(true)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  // Issue 19 — line click opens AddLineComposer in edit mode keyed on
  // this id. null = open-for-new (or closed). Reset whenever the
  // composer closes so the next "+ Compose line" click is fresh.
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  // Freeform modal — set to a line id to open. Used both for click-to-edit
  // on existing freeform rows AND for auto-open after a freeform Enter add.
  const [freeformLineId, setFreeformLineId] = useState<string | null>(null)
  // Create-CO modal seed. null = closed; non-null = open + line-seeded.
  const [coSeed, setCoSeed] = useState<CreateCoModalSeed | null>(null)
  // Install prefill values — loaded + kept in sync by InstallPrefill via its
  // onChange. We hold them here so the subproject total + header strip can
  // reflect the install cost without needing to refetch.
  const [installValues, setInstallValues] = useState<InstallPrefillValues>(emptyInstallPrefill())
  // Phase 12 item 10 — composer rate book + subproject defaults, loaded so
  // we can flag stale composer lines against current rates.
  const [composerRateBook, setComposerRateBook] = useState<ComposerRateBook | null>(null)
  const [composerDefaults, setComposerDefaults] = useState<ComposerDefaults | null>(null)
  const [refreshingStale, setRefreshingStale] = useState(false)
  // Phase 8: per-dept actuals from time_entries. Populated after load so the
  // "Labor by department" strip can render actuals alongside estimates.
  const [actuals, setActuals] = useState<SubActuals | null>(null)
  // Map from department_id (uuid) → canonical LaborDept key. Built from
  // departments.name via name-match heuristics to align with hoursByDept.
  const [deptKeyById, setDeptKeyById] = useState<Record<string, LaborDept>>({})

  // Add-line UI state
  const [addQuery, setAddQuery] = useState('')
  const [addHighlight, setAddHighlight] = useState(0)
  const [pendingAdd, setPendingAdd] = useState<RateBookItemRow | null>(null)
  const [pendingQty, setPendingQty] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  // Subproject rollup runs at COST. Project markup is applied at the
  // project rollup uniformly via projects.target_margin_pct (Phase 12
  // dogfood-2 Issue 12), so we pass 0 here. The subproject bottom-bar
  // readout below shows that target separately.
  const pricingCtx: PricingContext = useMemo(
    () => ({
      shopRate: org?.shop_rate ?? 0,
      consumableMarkupPct:
        subproject?.consumable_markup_pct ?? org?.consumable_markup_pct ?? 10,
      profitMarginPct: 0,
    }),
    [org?.shop_rate, subproject, org]
  )

  // Change orders ARE customer-facing, so they get real per-bucket margins
  // (052) — unlike the cost-only rollup above. Same resolution as the
  // project page: project pin → org default → 35.
  const coPricing = useMemo(
    () => ({
      ...pricingCtx,
      margins: resolveBucketMargins(project, org),
    }),
    [
      pricingCtx,
      project?.labor_margin_pct,
      project?.material_margin_pct,
      project?.consumable_margin_pct,
      org?.labor_margin_pct,
      org?.material_margin_pct,
      org?.consumable_margin_pct,
    ],
  )

  // ── Load ──
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [projRes, subRes, siblingsRes, linesData, rb, opts, lineOpts, subActuals, deptRes, composerRb, composerSubDefaults] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, client_name, stage, target_margin_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct')
          .eq('id', projectId)
          .single(),
        supabase
          .from('subprojects')
          .select('id, project_id, name, description, linear_feet, consumable_markup_pct, activity_type, details_json, exclusions_json')
          .eq('id', subId)
          .single(),
        supabase
          .from('subprojects')
          .select('id, name, sort_order')
          .eq('project_id', projectId)
          .order('sort_order'),
        loadEstimateLines(subId),
        loadRateBook(org.id),
        listOptions(org.id),
        loadLineOptions(subId),
        loadSubprojectActuals(subId),
        supabase.from('departments').select('id, name').eq('org_id', org.id),
        loadComposerRateBook(org.id),
        loadSubprojectDefaults(subId),
      ])
      if (cancelled) return
      if (projRes.data) setProject(projRes.data as any)
      if (subRes.data) setSubproject(subRes.data as any)
      setSiblingSubs((siblingsRes.data || []) as Array<{ id: string; name: string; sort_order: number }>)
      setLines(linesData)
      setItems(rb.items)
      setOptions(opts)
      setComposerRateBook(composerRb)
      setComposerDefaults(
        composerSubDefaults ?? initialSubprojectDefaults(org?.consumable_markup_pct ?? null)
      )

      // Inflate per-line options with their rate-book definitions.
      const optsById = new Map(opts.map((o) => [o.id, o]))
      const inflated: OptionsPerLine = new Map()
      lineOpts.forEach((rows: EstimateLineOptionRow[], lineId: string) => {
        const shaped = rows
          .map((r: EstimateLineOptionRow) => ({
            option: optsById.get(r.rate_book_option_id),
            effect_value_override: r.effect_value_override,
          }))
          .filter((x): x is { option: RateBookOptionRow; effect_value_override: number | null } => !!x.option)
        inflated.set(lineId, shaped)
      })
      setLineOptions(inflated)

      // Phase 8: pin actuals + build department-id → LaborDept key map.
      setActuals(subActuals)
      const deptKeyMap: Record<string, LaborDept> = {}
      for (const d of (deptRes.data || []) as Array<{ id: string; name: string }>) {
        const n = (d.name || '').toLowerCase()
        if (n.includes('eng')) deptKeyMap[d.id] = 'eng'
        else if (n.includes('cnc')) deptKeyMap[d.id] = 'cnc'
        else if (n.includes('assembly') || n.includes('bench')) deptKeyMap[d.id] = 'assembly'
        else if (n.includes('finish') || n.includes('paint') || n.includes('sand')) deptKeyMap[d.id] = 'finish'
        else if (n.includes('install')) deptKeyMap[d.id] = 'install'
      }
      setDeptKeyById(deptKeyMap)

      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id, projectId, subId])

  // Delete this subproject. estimate_lines + line options cascade (001 FKs);
  // time entries set-null (clock-ins survive). Route back to the project.
  const [deleting, setDeleting] = useState(false)
  async function handleDeleteSubproject() {
    if (!subproject || deleting) return
    const ok = await confirm({
      title: 'Delete subproject?',
      message: `"${subproject.name}" and its estimate lines will be permanently removed. This can't be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    setDeleting(true)
    const { error } = await supabase.from('subprojects').delete().eq('id', subId)
    if (error) {
      setDeleting(false)
      await showAlert({ title: 'Could not delete', message: error.message })
      return
    }
    // Keep the project's bid_total honest after the row is gone.
    void recomputeProjectBidTotal(projectId)
    router.replace(`/projects/${projectId}`)
  }

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // ── Autocomplete ──
  const matches = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    const src = items
    if (!q) return src.slice(0, 12)
    return src.filter((i) => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q))
  }, [addQuery, items])

  const groupedMatches = useMemo(() => {
    // Group by category_id → category name resolved via items metadata.
    // We don't store categories here; fall back to "(uncategorized)".
    const out = new Map<string, RateBookItemRow[]>()
    for (const m of matches) {
      const key = m.category_id || '__none__'
      const list = out.get(key) || []
      list.push(m)
      out.set(key, list)
    }
    return Array.from(out.entries())
  }, [matches])

  useEffect(() => setAddHighlight(0), [addQuery])

  // Load the org's cached QB items once, for the activity-type dropdown.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/qb/items', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => null)
      if (!res || !res.ok) return
      const json = await res.json().catch(() => null)
      if (!cancelled && Array.isArray(json?.items)) setQbItems(json.items)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Global keyboard shortcuts ──
  // The "/" key focuses the freeform-add input. ⌘D and Backspace
  // shortcuts were tied to the (now-deleted) selected-line side pane;
  // operators delete via the trash icon on each row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      if (!inField && e.key === '/') {
        e.preventDefault()
        addInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Add-line flow ──
  async function commitRateBookAdd(item: RateBookItemRow, qty: number) {
    setAddError(null)
    try {
      const newLine = await addEstimateLine({
        subprojectId: subId,
        item,
        quantity: qty,
        unit: item.unit,
      })
      if (newLine) {
        setLines((prev) => [...prev, newLine])
      }
      setPendingAdd(null)
      setPendingQty('')
      setAddQuery('')
      addInputRef.current?.focus()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    }
  }

  async function commitFreeformAdd(description: string) {
    setAddError(null)
    try {
      const newLine = await addEstimateLine({
        subprojectId: subId,
        description,
        quantity: 1,
      })
      if (newLine) {
        setLines((prev) => [...prev, newLine])
        // Pop the freeform modal open so the operator fills in qty + total
        // before moving on. Without this they'd be left with a $0 stub line.
        setFreeformLineId(newLine.id)
      }
      setAddQuery('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    }
  }

  function pickMatch(item: RateBookItemRow) {
    setPendingAdd(item)
    setPendingQty('')
    setTimeout(() => addInputRef.current?.focus(), 0)
  }

  function cancelPending() {
    setPendingAdd(null)
    setPendingQty('')
  }

  async function onAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (pendingAdd) {
      if (e.key === 'Enter') {
        const q = parseFloat(pendingQty)
        if (!isNaN(q) && q > 0) await commitRateBookAdd(pendingAdd, q)
      } else if (e.key === 'Escape') {
        cancelPending()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      // The "Add as freeform" row is one slot past the last match.
      const max = matches.length // freeform row index = matches.length
      setAddHighlight((h) => Math.min(h + 1, max))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAddHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (addHighlight < matches.length) {
        const pick = matches[addHighlight]
        if (pick) pickMatch(pick)
      } else if (addQuery.trim().length > 0) {
        await commitFreeformAdd(addQuery.trim())
      }
    } else if (e.key === 'Escape') {
      setAddQuery('')
      addInputRef.current?.blur()
    } else if (e.key === 'Backspace' && addQuery === '' && lines.length > 0) {
      // ⌫ on empty input focuses the last line (deferred: cursor-on-empty deletes last).
    }
  }

  // ── Line mutations ──
  const patchLine = useCallback(
    async (id: string, patch: Partial<EstimateLine>) => {
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
      try {
        await updateEstimateLine(id, patch)
      } catch {
        const fresh = await loadEstimateLines(subId)
        setLines(fresh)
      }
    },
    [subId]
  )

  async function removeLine(id: string) {
    const ok = await confirm({
      title: 'Remove this line?',
      message: 'This pulls it out of the subproject total.',
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!ok) return
    setLines((prev) => prev.filter((l) => l.id !== id))
    try {
      await deleteEstimateLine(id)
    } catch {
      const fresh = await loadEstimateLines(subId)
      setLines(fresh)
    }
  }

  async function onDuplicate(id: string) {
    const dup = await duplicateEstimateLine(id)
    if (dup) {
      setLines((prev) => [...prev, dup])
    }
  }

  // Build a CreateCoModalSeed from a clicked line + its computed buildup.
  // Locks the modal to this subproject; passes the composer's product
  // key + slots so the modal can show a slot-aware editor (Issue 21).
  // Lines that aren't composer-origin (no product_key) can't seed —
  // operator can still use the top-level "+ New CO" panel button.
  function openCoFromLine(
    line: EstimateLine,
    item: RateBookItemRow | null,
    _buildup: { materialCost: number },
  ) {
    if (!subproject) return
    if (!line.product_key || !line.product_slots) {
      setAddError(
        "Change orders from a line require a composer-built line. Use the top-level CO panel for legacy lines.",
      )
      return
    }
    const productLabel =
      line.product_key === 'base'
        ? 'Base cabinet'
        : line.product_key === 'upper'
          ? 'Upper cabinet'
          : line.product_key === 'full'
            ? 'Full height'
            : line.product_key
    setCoSeed({
      subprojectId: subId,
      subprojectName: subproject.name,
      lineId: line.id,
      productKey: line.product_key as ProductKey,
      productSlots: line.product_slots as unknown as ComposerSlots,
      qty: Number(line.quantity) || 0,
      productLabel,
      description: item?.name || line.description || productLabel,
    })
  }

  async function toggleLineOption(lineId: string, option: RateBookOptionRow) {
    const current = lineOptions.get(lineId) || []
    const already = current.some((o) => o.option.id === option.id)
    if (already) {
      try {
        await detachLineOption(lineId, option.id)
      } catch (e) { console.error(e) }
      setLineOptions((prev) => {
        const next = new Map(prev)
        next.set(lineId, current.filter((o) => o.option.id !== option.id))
        return next
      })
    } else {
      try {
        await attachLineOption(lineId, option.id, null)
      } catch (e) { console.error(e) }
      setLineOptions((prev) => {
        const next = new Map(prev)
        next.set(lineId, [...current, { option, effect_value_override: null }])
        return next
      })
    }
  }

  // ── Rollup ──
  const rollup = useMemo(
    () => computeSubprojectRollup(lines, itemsById, lineOptions, pricingCtx),
    [lines, itemsById, lineOptions, pricingCtx]
  )
  // Subproject-level install prefill cost (Phase 12 item 9). Computed off
  // the loaded installValues + the shop install rate; folds into the
  // subproject total below. Separate from rollup.installCost, which is
  // the per-line install mode from Phase 2.
  const installPrefillCost = useMemo(
    () => computeInstallCost(installValues, org?.shop_rate ?? 0),
    [installValues, org?.shop_rate]
  )
  const subprojectTotalWithInstall = rollup.total + installPrefillCost

  // Phase 12 item 10 — staleness against current rate book. Gated to
  // pre-sold stages; post-sold subprojects freeze at their saved values.
  const staleLines = useMemo(() => {
    if (!composerRateBook || !composerDefaults) return []
    return findStaleLines(lines, composerDefaults, composerRateBook)
  }, [lines, composerRateBook, composerDefaults])
  const showStaleBanner =
    staleLines.length > 0 && !!project?.stage && isPresold(project.stage)

  // Banner copy hint — does ANY stale line carry door slots? Drives the
  // third sentence so non-door staleness (material cost edits, Solid
  // Wood Top calibration changes) doesn't get told to "re-pick door type
  // / material / finish" when there are no doors involved.
  const staleHasDoorSlots = useMemo(() => {
    if (staleLines.length === 0) return false
    const staleIds = new Set(staleLines.map((s) => s.lineId))
    return lines.some((l) => {
      if (!staleIds.has(l.id)) return false
      const slots = (l.product_slots ?? null) as
        | { doorTypeId?: string | null; doorMaterialId?: string | null; doorFinishId?: string | null }
        | null
      if (!slots) return false
      return !!(slots.doorTypeId || slots.doorMaterialId || slots.doorFinishId)
    })
  }, [staleLines, lines])
  const staleHasNonDoor = useMemo(() => {
    if (staleLines.length === 0) return false
    const staleIds = new Set(staleLines.map((s) => s.lineId))
    return lines.some((l) => {
      if (!staleIds.has(l.id)) return false
      const slots = (l.product_slots ?? null) as
        | { doorTypeId?: string | null; doorMaterialId?: string | null; doorFinishId?: string | null }
        | null
      if (!slots) return true
      return !(slots.doorTypeId || slots.doorMaterialId || slots.doorFinishId)
    })
  }, [staleLines, lines])

  async function handleRefreshStale() {
    if (staleLines.length === 0) return
    setRefreshingStale(true)
    try {
      await bulkRefreshStaleLines(staleLines)
      const fresh = await loadEstimateLines(subId)
      setLines(fresh)
    } catch (err: any) {
      console.error('handleRefreshStale', err)
      alert('Failed to update lines — ' + (err?.message || 'unknown error'))
    } finally {
      setRefreshingStale(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading…</div>
      </>
    )
  }

  if (!project || !subproject) {
    return (
      <>
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-sm text-[#DC2626]">Subproject not found.</div>
      </>
    )
  }

  return (
    <>

      {/* Project strip */}
      <div className="bg-white border-b border-[#E5E7EB] sticky top-14 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-12 flex items-center gap-3 text-xs text-[#6B7280]">
          <Link href={`/projects/${projectId}`} className="p-1.5 -ml-1.5 rounded-lg hover:text-[#111] hover:bg-[#F3F4F6] transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Link href={`/projects/${projectId}`} className="hover:text-[#111] transition-colors">{project.name}</Link>
          <span className="text-[#D1D5DB]">·</span>
          <span className="text-[#111] font-medium">{subproject.name}</span>
          {project.client_name && (
            <>
              <span className="text-[#D1D5DB]">·</span>
              <span>{project.client_name}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-4 font-mono tabular-nums">
            <span><span className="text-[#111] font-semibold">{fmtHours(rollup.totalHours)}</span></span>
            <span className="text-[#D1D5DB]">·</span>
            <span><span className="text-[#111] font-semibold">{fmtMoney(subprojectTotalWithInstall)}</span></span>
          </div>
        </div>
      </div>

      {/* Subproject tabs — horizontal scroll across every sub on the project. */}
      {siblingSubs.length > 1 && (
        <div className="bg-white border-b border-[#E5E7EB] sticky top-[6.5rem] z-20">
          <div className="max-w-[1400px] mx-auto px-6 flex items-center gap-1 overflow-x-auto">
            {siblingSubs.map((s) => {
              const active = s.id === subId
              return (
                <Link
                  key={s.id}
                  href={`/projects/${projectId}/subprojects/${s.id}`}
                  className={
                    'py-2.5 px-4 text-[13px] whitespace-nowrap border-b-2 transition-colors ' +
                    (active
                      ? 'border-[#2563EB] text-[#111] font-semibold'
                      : 'border-transparent text-[#6B7280] hover:text-[#111] hover:border-[#E5E7EB]')
                  }
                >
                  {s.name}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-6 py-5">
        {project && !isPresold(project.stage) && (
          <div className="mb-4 px-4 py-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl">
            <div className="text-[13px] font-semibold text-[#1E40AF]">
              Locked — sold
            </div>
            <div className="text-[12px] text-[#1E3A8A] mt-0.5">
              The estimate is locked. Click <b>CO</b> on any line row below
              to draft a change order — that's the only edit path post-sale.
            </div>
          </div>
        )}
        {org && org.shop_rate == null && (
          <div className="mb-4 px-4 py-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[#92400E]">
                Shop rate not configured
              </div>
              <div className="text-[12px] text-[#78350F] mt-0.5">
                Labor and install costs render as $0 until you finish the
                shop rate walkthrough or set a rate manually in Settings.
              </div>
            </div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#D97706] rounded-md hover:bg-[#B45309] transition-colors"
            >
              Open settings →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="min-w-0">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#111]">{subproject.name}</h1>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {subproject.linear_feet ? `${subproject.linear_feet} LF · ` : ''}
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </p>
            </div>
            {/* Top-right is a secondary action only — Clone from past stays
                here. Compose line is the primary action and lives below the
                line table as a full-width dashed CTA, matching the style of
                "+ Add subproject" on the project page. */}
            {project && isPresold(project.stage) && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCloneOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Clone from past
                </button>
                <button
                  onClick={handleDeleteSubproject}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#B91C1C] bg-white border border-[#FECACA] rounded-lg hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            )}
          </div>

          {/* Subproject scope — activity type (→ QB item), rich description
              blocks + exclusions. Feeds the QuickBooks line item on push. */}
          <ScopeEditor
            sub={subproject}
            qbItems={qbItems}
            editable={!!project && isPresold(project.stage)}
            onSaved={(patch) => setSubproject((s) => (s ? { ...s, ...patch } : s))}
          />

          {/* Staleness banner (Phase 12 item 10) — pre-sold only. */}
          {showStaleBanner && (
            <div className="mb-4 px-4 py-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#92400E]">
                  Rates have changed since these lines were saved
                </div>
                <div className="text-[12px] text-[#78350F] mt-0.5">
                  {staleLines.length} composer line{staleLines.length === 1 ? '' : 's'} out of date.
                  Recompute against the current rate book to push the new numbers into the lines.
                </div>
                <div className="text-[11px] text-[#78350F] mt-1 italic">
                  {staleHasDoorSlots && staleHasNonDoor
                    ? 'Cabinet door pricing also changed — re-pick door type/material/finish on those lines.'
                    : staleHasDoorSlots
                      ? 'Door pricing updated — re-pick door type, material, and finish on each line.'
                      : 'Click Update to latest rates to push the new numbers in.'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRefreshStale}
                disabled={refreshingStale}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[#D97706] rounded-md hover:bg-[#B45309] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {refreshingStale ? 'Updating…' : 'Update to latest rates'}
              </button>
            </div>
          )}

          {/* Keyboard shortcut legend removed (post-sale dogfood pass).
              Shortcuts (/ ↑↓ ⏎ ⌫ ⌘D) remain functional via onAddKeyDown
              + the document-level "/" focus listener — power users keep
              them; the visible legend was clutter for everyone else. */}

          {/* Line table */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-3">
            <div className="grid grid-cols-[1fr_72px_56px_80px_100px_100px_64px] px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              <div>Item / Finish</div>
              <div className="text-right">Qty</div>
              <div className="text-center">Unit</div>
              <div className="text-right">Hours</div>
              <div className="text-right">Material</div>
              <div className="text-right">Total</div>
              <div />
            </div>

            {lines.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[#9CA3AF] italic">
                No lines yet.
              </div>
            ) : (
              lines.map((line) => {
                const item = line.rate_book_item_id ? itemsById.get(line.rate_book_item_id) ?? null : null
                const opts = lineOptions.get(line.id) || []
                const b = computeLineBuildup(line, item, opts, pricingCtx)
                const isComposerLine = !!line.product_key
                const editable = !!project && isPresold(project.stage)
                // Composer lines: product label as the headline, then the
                // slot summary (everything after "{label} · " in the
                // description) on a second muted line. Freeform / rate-book
                // lines: description-as-is, no second line. Keeps the cell
                // narrow even for products with long slot rollups.
                const productLabel = isComposerLine
                  ? productLabelFromKey(line.product_key as ProductKey)
                  : null
                const slotSummary =
                  productLabel &&
                  line.description &&
                  line.description.startsWith(`${productLabel} · `)
                    ? line.description.slice(productLabel.length + 3)
                    : ''
                const headline = productLabel || item?.name || line.description || '(custom)'
                return (
                  <div
                    key={line.id}
                    onClick={() => {
                      // Post-sold rows are read-only; CO is the only edit
                      // path (the per-row CO button below stays visible).
                      if (!editable) return
                      if (isComposerLine) {
                        setEditingLineId(line.id)
                        setComposerOpen(true)
                      } else {
                        // Freeform lines (no product_key) get the minimal
                        // freeform editor. Same path used after Enter-as-
                        // freeform creation so the operator fills in qty +
                        // total immediately.
                        setFreeformLineId(line.id)
                      }
                    }}
                    className={`grid grid-cols-[1fr_72px_56px_80px_100px_100px_64px] px-3 py-2.5 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors ${editable ? 'cursor-pointer' : ''}`}
                  >
                    <div className="pr-3 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-sm text-[#111] font-medium truncate">
                          {headline}
                        </div>
                        {(() => {
                          const pk = (line as any).product_key as
                            | 'base' | 'upper' | 'full' | 'drawer' | null | undefined
                          if (pk !== 'base' && pk !== 'upper' && pk !== 'full' && pk !== 'drawer') {
                            return null
                          }
                          if (!hasMissingSlots(pk, (line as any).product_slots ?? null)) {
                            return null
                          }
                          return (
                            <span
                              className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]"
                              title="Composer line has unset slots — click the row to open the composer and pick the missing pieces"
                            >
                              Needs slots
                            </span>
                          )
                        })()}
                      </div>
                      {slotSummary && (
                        <div className="text-[11px] text-[#6B7280] truncate mt-0.5">
                          {slotSummary}
                        </div>
                      )}
                      {opts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {opts.map((o) => (
                            <button
                              key={o.option.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleLineOption(line.id, o.option)
                              }}
                              title={`Remove ${o.option.name}`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#F3E8FF] text-[#7E22CE] text-[10px] rounded-full border border-[#E9D5FF] hover:bg-[#E9D5FF] hover:text-[#5B21B6] transition-colors"
                            >
                              {o.option.name}
                              <span className="text-[#9B5ECF]">×</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {editable ? (
                      <input
                        type="number"
                        step="any"
                        value={line.quantity || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, quantity: val } : l)))
                        }}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          patchLine(line.id, { quantity: val })
                        }}
                        className="w-full text-right text-sm font-mono tabular-nums bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] focus:outline-none"
                      />
                    ) : (
                      <div className="text-right text-sm font-mono tabular-nums text-[#374151]">
                        {line.quantity || 0}
                      </div>
                    )}
                    <div className="text-center text-xs text-[#6B7280] font-mono">{line.unit || item?.unit || '—'}</div>
                    <div className="text-right text-sm font-mono tabular-nums text-[#6B7280]">
                      {fmtHours(b.totalHours)}
                    </div>
                    <div className="text-right text-sm font-mono tabular-nums text-[#6B7280]">
                      {/* Freeform lines (unit_price_override set) skip the
                          bucket math entirely — show the per-unit cost in
                          the Material column so the row reads as
                          "1 × $300" not "$0 / $300". Composer + rate-book
                          lines show the real material rollup. */}
                      {line.unit_price_override != null
                        ? fmtMoney(line.unit_price_override)
                        : fmtMoney(
                            b.materialCost +
                              b.consumablesCost +
                              (b.hardwareCost || 0),
                          )}
                    </div>
                    <div className="text-right text-sm font-mono tabular-nums font-semibold text-[#111]">
                      {fmtMoney(b.lineTotal)}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {/* CO stays visible in BOTH stages — pre-sold it's
                          optional, post-sold it's the only edit path
                          (Issue D). */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openCoFromLine(line, item, b)
                        }}
                        title="Create change order from this line"
                        className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] hover:text-[#2563EB]"
                      >
                        CO
                      </button>
                      {/* Trash gates pre-sold; CO replaces deletion post-sold. */}
                      {editable && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeLine(line.id)
                          }}
                          className="flex items-center justify-center text-[#D1D5DB] hover:text-[#DC2626]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Primary CTA: full-width dashed "+ Compose line" — same visual
              weight as "+ Add subproject" on the project page. Composer is
              the V1 line creator; the freeform / rate-book search input
              below is the secondary path. Pre-sold only. */}
          {project && isPresold(project.stage) && (
            <button
              onClick={() => {
                setEditingLineId(null)
                setComposerOpen(true)
              }}
              className="block w-full mb-3 border border-dashed border-[#D1D5DB] rounded-xl px-4 py-3.5 text-center text-sm text-[#6B7280] hover:text-[#2563EB] hover:border-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
            >
              <Plus className="w-3.5 h-3.5 inline mr-1" />
              Compose line
            </button>
          )}

          {/* Search-or-freeform add — pre-sold only. Post-sold the only
              legitimate add path is a CO that creates a line on a sub. */}
          {project && isPresold(project.stage) && (
          <div className="relative mb-6">
            <div className={`flex items-center gap-3 px-3 py-2.5 bg-white border rounded-lg transition-colors ${pendingAdd ? 'border-[#2563EB]' : 'border-dashed border-[#E5E7EB]'}`}>
              <Plus className="w-4 h-4 text-[#9CA3AF]" />
              {pendingAdd ? (
                <>
                  <span className="text-sm text-[#111] font-medium">{pendingAdd.name}</span>
                  <span className="text-sm text-[#6B7280]">· how many {pendingAdd.unit}?</span>
                  <input
                    ref={addInputRef}
                    autoFocus
                    type="number"
                    step="any"
                    value={pendingQty}
                    onChange={(e) => setPendingQty(e.target.value)}
                    onKeyDown={onAddKeyDown}
                    className="flex-1 bg-transparent border-none outline-none text-sm font-mono tabular-nums"
                    placeholder={`Enter ${pendingAdd.unit} and press ⏎`}
                  />
                  <button onClick={cancelPending} className="text-[#9CA3AF] hover:text-[#111]" aria-label="Cancel">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <input
                    ref={addInputRef}
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    onKeyDown={onAddKeyDown}
                    placeholder="Add line — type to search, or press ⏎ to add as freeform"
                    className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-[#9CA3AF]"
                  />
                  <kbd className="px-1.5 py-0.5 text-[10px] text-[#9CA3AF] bg-[#F9FAFB] border border-[#E5E7EB] rounded font-mono">
                    type to search
                  </kbd>
                </>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {!pendingAdd && addQuery.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border border-[#E5E7EB] rounded-lg shadow-lg">
                {groupedMatches.map(([groupKey, groupItems]) => (
                  <div key={groupKey}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider bg-[#F9FAFB] border-b border-[#F3F4F6]">
                      {groupKey === '__none__' ? 'Other' : resolveCategoryName(groupKey, items) || 'Category'}
                    </div>
                    {groupItems.map((m) => {
                      const flatIdx = matches.indexOf(m)
                      const highlighted = flatIdx === addHighlight
                      const color = CONFIDENCE_COLOR[m.confidence as Confidence]
                      return (
                        <button
                          key={m.id}
                          onMouseEnter={() => setAddHighlight(flatIdx)}
                          onClick={() => pickMatch(m)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 border-b border-[#F3F4F6] last:border-b-0 ${highlighted ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[#111] font-medium truncate">{m.name}</span>
                              <span className="text-[#9CA3AF] text-xs">· {m.unit}</span>
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded-full border uppercase tracking-wider"
                                style={{ background: color.bg, color: color.fg, borderColor: color.border }}
                              >
                                {CONFIDENCE_LABEL[m.confidence as Confidence]}
                              </span>
                              {m.confidence_job_count > 0 && (
                                <span className="text-[10px] text-[#9CA3AF]">· {m.confidence_job_count} jobs</span>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
                {/* Freeform row */}
                <button
                  onMouseEnter={() => setAddHighlight(matches.length)}
                  onClick={() => commitFreeformAdd(addQuery.trim())}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-t border-[#E5E7EB] ${addHighlight === matches.length ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'}`}
                >
                  <Plus className="w-3.5 h-3.5 text-[#6B7280]" />
                  <span className="text-[#6B7280]">Add as freeform line:</span>
                  <span className="text-[#111] font-medium">{addQuery.trim() || '…'}</span>
                </button>
              </div>
            )}

            {addError && (
              <div className="mt-2 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B]">
                Couldn&apos;t add line: {addError}
              </div>
            )}
          </div>
          )}

          {/* Install prefill (Phase 12 item 9) — per-subproject install
              cost from guys × days × install rate × (1 + complexity%).
              Sits below the line list per the dogfood-2 layout call:
              cabinet scope first, install second. Cost folds into
              subprojectTotalWithInstall in the bottom rollup. Hidden
              post-sold; locked install values still surface on the
              Install row of the rollup below. */}
          {project && isPresold(project.stage) && (
            <div className="mb-6">
              <InstallPrefill
                subprojectId={subId}
                installRatePerHour={org?.shop_rate ?? 0}
                onChange={setInstallValues}
              />
            </div>
          )}

          {/* Labor by department + actuals — moved out of the bottom
              rollup bar (which now lives in the right pricing pane).
              Left here as a standalone block so the sub-level operator
              still sees the per-dept hour spread + clocked actuals. */}
          {(rollup.totalHours > 0 || (actuals && actuals.totalMinutes > 0)) && (() => {
              // Phase 8: split actuals.byDeptMinutes into the canonical
              // LaborDept keys. Clock-ins against departments that don't map
              // to a canonical bucket land in `unmappedActualMinutes` and are
              // summarized in their own pill so the total still reconciles.
              const actualByKey: Record<LaborDept, number> = {
                eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0,
              }
              let unmappedActualMinutes = 0
              if (actuals) {
                for (const [deptId, mins] of Object.entries(actuals.byDeptMinutes)) {
                  const key = deptKeyById[deptId]
                  if (key) actualByKey[key] += mins
                  else unmappedActualMinutes += mins
                }
              }
              const totalActualMin = actuals?.totalMinutes || 0
              const estimatedMin = Math.round(rollup.totalHours * 60)
              const overEst = totalActualMin > estimatedMin && estimatedMin > 0
              const pctOfEst = estimatedMin > 0
                ? Math.round((totalActualMin / estimatedMin) * 100)
                : 0
              return (
                <div className="mt-4 pt-3 border-t border-[#F3F4F6]">
                  <div className="flex items-center gap-4 flex-wrap text-xs text-[#6B7280]">
                    <span className="font-semibold uppercase tracking-wider text-[#9CA3AF]">Labor by department</span>
                    {LABOR_DEPTS.map((d) => (
                      <DeptPill
                        key={d}
                        label={LABOR_DEPT_LABEL[d]}
                        hours={rollup.hoursByDept[d]}
                        rate={org?.shop_rate ?? 0}
                        actualMinutes={actualByKey[d]}
                      />
                    ))}
                  </div>
                  {/* Actual vs estimated summary — always visible when either
                      side has nonzero minutes so the "unstarted" state still
                      communicates itself. */}
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-[#6B7280]">
                    <span className="font-semibold uppercase tracking-wider text-[#9CA3AF]">Actual vs estimated</span>
                    <span className="font-mono">
                      {fmtActualHours(totalActualMin)}
                      <span className="text-[#9CA3AF] mx-1">of</span>
                      {fmtHours(rollup.totalHours)}
                    </span>
                    {estimatedMin > 0 && totalActualMin > 0 && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded font-semibold ${
                          overEst
                            ? 'bg-[#FEE2E2] text-[#B91C1C]'
                            : 'bg-[#D1FAE5] text-[#065F46]'
                        }`}
                        title={
                          overEst
                            ? `Tracking ${pctOfEst - 100}% over estimate`
                            : `Tracking at ${pctOfEst}% of estimate`
                        }
                      >
                        {pctOfEst}% of estimate
                      </span>
                    )}
                    {totalActualMin === 0 && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-[#FEF3C7] text-[#92400E] uppercase text-[10px] tracking-wider"
                        title="No time clocked against this subproject yet"
                      >
                        Not started
                      </span>
                    )}
                    {unmappedActualMinutes > 0 && (
                      <span
                        className="text-[10.5px] italic text-[#9CA3AF]"
                        title="Clock-ins against departments that don't map to a canonical labor bucket"
                      >
                        +{fmtActualHours(unmappedActualMinutes)} other-dept
                      </span>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* RIGHT — sticky pricing pane. Mirrors the project page's
              right-column structure but at COST only (margin is applied
              once at the project total, not per subproject). */}
          <div>
            <div className="sticky top-[6.5rem] bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
              <div className="pb-4 border-b border-[#F3F4F6]">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                  Subproject total
                </div>
                <div className="text-[28px] font-semibold text-[#111] font-mono tabular-nums tracking-tight leading-none">
                  {fmtMoney(subprojectTotalWithInstall)}
                </div>
                <div className="text-[11px] text-[#6B7280] mt-1.5">
                  Cost — margin applied at project
                </div>
              </div>

              <div className="pt-4">
                <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
                  Cost breakdown
                </div>

                <SubFinRow
                  label="Labor"
                  hours={rollup.totalHours}
                  value={fmtMoney(rollup.laborCost)}
                />
                <SubFinRow label="Material" value={fmtMoney(rollup.materialCost)} />
                <SubFinRow
                  label={
                    <>
                      Consumables
                      <span className="text-[10px] text-[#9CA3AF] ml-1">
                        ({pricingCtx.consumableMarkupPct.toFixed(0)}% of material)
                      </span>
                    </>
                  }
                  value={fmtMoney(rollup.consumablesCost)}
                />
                <SubFinRow
                  label="Specialty hardware"
                  value={fmtMoney(rollup.hardwareCost)}
                />
                <SubFinRow label="Options" value={fmtMoney(rollup.optionsCost)} />
                <SubFinRow
                  label="Install"
                  hours={rollup.hoursByDept.install}
                  value={fmtMoney(rollup.installCost + installPrefillCost)}
                />

                <div className="mt-3 pt-3 border-t border-[#E5E7EB]">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#374151] font-semibold">
                      Subproject cost
                    </span>
                    <span className="font-mono text-[#111] tabular-nums font-semibold">
                      {fmtMoney(subprojectTotalWithInstall)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {cloneOpen && (
        <CloneFromPastModal
          orgId={org?.id || null}
          currentSubprojectId={subId}
          onClose={() => setCloneOpen(false)}
          onCloned={async () => {
            setCloneOpen(false)
            const fresh = await loadEstimateLines(subId)
            setLines(fresh)
          }}
        />
      )}

      <FreeformLineModal
        line={lines.find((l) => l.id === freeformLineId) ?? null}
        onClose={() => setFreeformLineId(null)}
        onSaved={(patched) => {
          setLines((prev) => prev.map((l) => (l.id === patched.id ? patched : l)))
          setFreeformLineId(null)
        }}
      />

      {composerOpen && org?.id && (
        <AddLineComposer
          subprojectId={subId}
          orgId={org.id}
          orgConsumablePct={org?.consumable_markup_pct ?? null}
          hasExistingLinesInSubproject={lines.length > 0}
          editingLineId={editingLineId}
          onCancel={() => {
            setComposerOpen(false)
            setEditingLineId(null)
          }}
          onLineSaved={async () => {
            setComposerOpen(false)
            setEditingLineId(null)
            const fresh = await loadEstimateLines(subId)
            setLines(fresh)
          }}
        />
      )}

      {coSeed && subproject && (
        <CreateCoModal
          projectId={projectId}
          pricing={coPricing}
          subprojects={[{ id: subId, name: subproject.name }]}
          seed={coSeed}
          composerRateBook={composerRateBook}
          composerDefaults={composerDefaults}
          onClose={() => setCoSeed(null)}
          onCreated={async () => {
            setCoSeed(null)
          }}
        />
      )}
    </>
  )
}

// ── Category resolver for autocomplete group headers ──
function resolveCategoryName(id: string, items: RateBookItemRow[]): string | null {
  // We don't separately load categories in this page. If anyone in `items`
  // has the id as category_id and a populated `.category_name` we could use
  // it; but for now return a trimmed id.
  return null
}

// ── Sub-components ──

/** Parse a jsonb column into a trimmed, non-empty string[]. */
function toStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))).map((s) => s.trim())
}

/** Re-squash the structured scope back into the single `description` string so
 *  legacy surfaces that only read `description` stay in sync. Mirrors the
 *  migration's buildSubDescription format. */
function squashScope(blocks: string[], exclusions: string[]): string | null {
  const b = blocks.map((s) => s.trim()).filter(Boolean)
  const e = exclusions.map((s) => s.trim()).filter(Boolean)
  let t = b.join('\n\n')
  if (e.length) t += (t ? '\n\n' : '') + 'Exclusions:\n' + e.join('\n')
  return t.trim() || null
}

/** Subproject scope editor — activity type (→ QB service item on push), rich
 *  description blocks (details_json), and exclusions (exclusions_json). Reads
 *  the legacy single `description` as one block when details_json is empty.
 *  Persists to the subprojects row; read-only once the estimate locks. */
// Split a QB item's description into editor blocks: one per non-blank line.
// Mirrors how the migration stored details_json (an array of lines), so a
// freshly autofilled sub reads like a migrated one.
function blocksFromItemDescription(desc: string | null | undefined): string[] {
  return (desc || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function ScopeEditor({
  sub,
  qbItems,
  editable,
  onSaved,
}: {
  sub: SubprojectRow
  qbItems: Array<{ qb_id: string; name: string | null; description: string | null }>
  editable: boolean
  onSaved: (patch: Partial<SubprojectRow>) => void
}) {
  const [activityType, setActivityType] = useState('')
  const [blocks, setBlocks] = useState<string[]>([])
  const [exclusions, setExclusions] = useState<string[]>([])

  // The cached QB item for the current activity type (→ its prefill text).
  const itemFor = (name: string) =>
    qbItems.find((i) => i.name && normalizeItemName(i.name) === normalizeItemName(name)) || null

  // Re-seed when the active subproject changes.
  useEffect(() => {
    setActivityType(sub.activity_type || '')
    const detail = toStrArr(sub.details_json)
    const legacy = (sub.description || '').trim()
    setBlocks(detail.length ? detail : legacy ? [legacy] : [])
    setExclusions(toStrArr(sub.exclusions_json))
  }, [sub.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: { activityType?: string; blocks?: string[]; exclusions?: string[] }) {
    const at = (next.activityType ?? activityType).trim()
    const bl = (next.blocks ?? blocks).map((s) => s.trim()).filter(Boolean)
    const ex = (next.exclusions ?? exclusions).map((s) => s.trim()).filter(Boolean)
    const description = squashScope(bl, ex)
    const patch = {
      activity_type: at || null,
      details_json: bl,
      exclusions_json: ex,
      description,
    }
    await supabase.from('subprojects').update(patch).eq('id', sub.id)
    onSaved(patch)
  }

  // Activity-type options: the synced QB items, with the current value folded
  // in so a cold cache (or a value QB no longer has) never drops the selection.
  const itemNames = qbItems.map((i) => i.name || '').filter(Boolean)
  const options = Array.from(new Set([activityType, ...itemNames].filter(Boolean)))

  const labelCls = 'text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider'
  const addBtnCls =
    'text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-40'

  return (
    <div className="mb-4 px-4 py-3 bg-[#F9FAFB] border border-[#F3F4F6] rounded-xl space-y-3">
      {/* Activity type → QB item */}
      <div>
        <div className={labelCls + ' mb-1'}>Activity type</div>
        {editable ? (
          <>
            <select
              value={activityType}
              onChange={(e) => {
                const v = e.target.value
                setActivityType(v)
                // Autofill the description from the QB item — but only when the
                // description is empty, so we never clobber real edits silently.
                // "Restore default" (below) is the explicit re-pull.
                const hasContent = blocks.some((b) => b.trim())
                const filled = blocksFromItemDescription(itemFor(v)?.description)
                if (!hasContent && filled.length) {
                  setBlocks(filled)
                  persist({ activityType: v, blocks: filled })
                } else {
                  persist({ activityType: v })
                }
              }}
              className="w-full max-w-xs px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
            >
              <option value="">— none —</option>
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {qbItems.length === 0 && (
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Sync your QuickBooks items (Settings → QuickBooks) to map to your item list.
              </div>
            )}
          </>
        ) : (
          <div className="text-[13px] text-[#374151]">{activityType || '—'}</div>
        )}
      </div>

      {/* Description blocks */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className={labelCls}>Description</span>
          {editable && (
            <div className="flex items-center gap-3">
              {blocksFromItemDescription(itemFor(activityType)?.description).length > 0 && (
                <button
                  type="button"
                  className={addBtnCls}
                  title="Replace with the default description for this activity type"
                  onClick={() => {
                    const filled = blocksFromItemDescription(itemFor(activityType)?.description)
                    if (!filled.length) return
                    if (
                      blocks.some((b) => b.trim()) &&
                      !window.confirm('Replace the description with the default text for this activity type?')
                    ) {
                      return
                    }
                    setBlocks(filled)
                    persist({ blocks: filled })
                  }}
                >
                  Restore default
                </button>
              )}
              <button type="button" className={addBtnCls} onClick={() => setBlocks((b) => [...b, ''])}>
                + Add
              </button>
            </div>
          )}
        </div>
        {blocks.length === 0 && !editable ? (
          <div className="text-[13px] text-[#9CA3AF] italic">—</div>
        ) : (
          <div className="space-y-2">
            {blocks.map((blk, i) =>
              editable ? (
                <div key={i} className="flex gap-2 items-start">
                  <textarea
                    value={blk}
                    rows={Math.max(2, blk.split('\n').length)}
                    onChange={(e) =>
                      setBlocks((b) => b.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    onBlur={() => persist({})}
                    placeholder="Material / dimensions / details…"
                    className="flex-1 px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none resize-y whitespace-pre-wrap leading-relaxed"
                  />
                  <button
                    type="button"
                    aria-label="Remove block"
                    className="text-[#9CA3AF] hover:text-[#DC2626] mt-1.5"
                    onClick={() => {
                      const nextBlocks = blocks.filter((_, j) => j !== i)
                      setBlocks(nextBlocks)
                      persist({ blocks: nextBlocks })
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <p key={i} className="text-[13px] text-[#374151] whitespace-pre-line leading-relaxed">
                  {blk}
                </p>
              ),
            )}
          </div>
        )}
      </div>

      {/* Exclusions */}
      {(editable || exclusions.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={labelCls}>Exclusions</span>
            {editable && (
              <button
                type="button"
                className={addBtnCls}
                onClick={() => setExclusions((x) => [...x, ''])}
              >
                + Add
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {exclusions.map((ex, i) =>
              editable ? (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={ex}
                    onChange={(e) =>
                      setExclusions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))
                    }
                    onBlur={() => persist({})}
                    placeholder="Excluded from this scope…"
                    className="flex-1 px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Remove exclusion"
                    className="text-[#9CA3AF] hover:text-[#DC2626]"
                    onClick={() => {
                      const nextEx = exclusions.filter((_, j) => j !== i)
                      setExclusions(nextEx)
                      persist({ exclusions: nextEx })
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <p key={i} className="text-[13px] text-[#374151] leading-relaxed">
                  • {ex}
                </p>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Cost-breakdown row in the right pricing pane. Mirrors the project page's
 *  FinRow shape so the two surfaces read identically. */
function SubFinRow({
  label,
  value,
  hours,
}: {
  label: React.ReactNode
  value: string
  hours?: number
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-[#374151]">{label}</span>
      <span className="font-mono text-[#111] tabular-nums">
        {hours != null && hours > 0 && (
          <span className="text-[#9CA3AF] mr-1.5">
            {fmtHours(hours)} est ·
          </span>
        )}
        {value}
      </span>
    </div>
  )
}

function DeptPill({
  label, hours, rate, actualMinutes = 0,
}: {
  label: string
  hours: number
  rate: number
  actualMinutes?: number
}) {
  // Hide only if BOTH estimate and actual are zero — we still want unused-but-
  // clocked-against depts visible, and unfinished estimated depts visible.
  if (hours <= 0 && actualMinutes <= 0) return null
  const actualHrs = actualMinutes / 60
  const over = hours > 0 && actualHrs > hours
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[#9CA3AF]">{label}</span>
      <span className="font-mono tabular-nums text-[#111] font-semibold">{fmtHours(hours)}</span>
      {actualMinutes > 0 && (
        <span
          className={`font-mono tabular-nums text-[10.5px] font-semibold ${
            over ? 'text-[#DC2626]' : 'text-[#059669]'
          }`}
          title={`${fmtActualHours(actualMinutes)} actual · ${fmtHours(hours)} estimated`}
        >
          /{fmtActualHours(actualMinutes)}
        </span>
      )}
      <span className="font-mono tabular-nums text-[#9CA3AF] text-[10.5px]">{fmtMoney(hours * rate)}</span>
    </span>
  )
}


// ── Clone from past modal ──

function CloneFromPastModal({
  orgId, currentSubprojectId, onClose, onCloned,
}: {
  orgId: string | null
  currentSubprojectId: string
  onClose: () => void
  onCloned: () => void
}) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; project_name: string; line_count: number }>>([])
  const [loading, setLoading] = useState(true)
  const [cloning, setCloning] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      setLoading(true)
      // Pull subprojects in this org that have lines, excluding the current one.
      const { data } = await supabase
        .from('subprojects')
        .select('id, name, projects!inner(id, name, org_id), estimate_lines(count)')
        .eq('projects.org_id', orgId)
        .neq('id', currentSubprojectId)
        .order('created_at', { ascending: false })
        .limit(30)
      const shaped = (data || [])
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          project_name: r.projects?.name || '(project)',
          line_count: (r.estimate_lines?.[0]?.count as number) ?? 0,
        }))
        .filter((r) => r.line_count > 0)
      setRows(shaped)
      setLoading(false)
    })()
  }, [orgId, currentSubprojectId])

  async function cloneFrom(sourceId: string) {
    setCloning(sourceId)
    // Copy all estimate_lines from source to current. We use the existing
    // row and flip subproject_id + null the id so Supabase mints a fresh one.
    const { data: src } = await supabase
      .from('estimate_lines')
      .select('*')
      .eq('subproject_id', sourceId)
      .order('sort_order', { ascending: true })
    if (!src || src.length === 0) {
      setCloning(null)
      onCloned()
      return
    }
    // Find current max sort_order on the target.
    const { data: last } = await supabase
      .from('estimate_lines')
      .select('sort_order')
      .eq('subproject_id', currentSubprojectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    let nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

    const inserts = src.map((r: any) => {
      const { id, created_at, updated_at, ...rest } = r
      return { ...rest, subproject_id: currentSubprojectId, sort_order: nextOrder++ }
    })
    await supabase.from('estimate_lines').insert(inserts)
    setCloning(null)
    onCloned()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#111]">Clone lines from a past subproject</h3>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#111]"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-[#9CA3AF]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#9CA3AF]">No past subprojects with lines yet.</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                onClick={() => cloneFrom(r.id)}
                disabled={cloning !== null}
                className="w-full text-left px-5 py-3 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] disabled:opacity-50"
              >
                <div className="text-sm font-medium text-[#111]">{r.name}</div>
                <div className="text-xs text-[#6B7280] mt-0.5">{r.project_name} · {r.line_count} line{r.line_count === 1 ? '' : 's'}</div>
                {cloning === r.id && <div className="text-[11px] text-[#2563EB] mt-1">Cloning…</div>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

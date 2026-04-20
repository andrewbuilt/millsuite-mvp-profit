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
// lib/rate-book-v2.ts. Shop labor rates come from shop_labor_rates.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { supabase } from '@/lib/supabase'
import {
  EstimateLine,
  EstimateLineOptionRow,
  FinishSpec,
  InstallMode,
  PricingContext,
  addEstimateLine,
  applicableOptionsForItem,
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
  laborRateMap,
  listOptions,
  listShopLaborRates,
} from '@/lib/rate-book-v2'
import { LaborDept, LABOR_DEPTS, LABOR_DEPT_LABEL, DEFAULT_LABOR_RATES } from '@/lib/rate-book-seed'
import { seedStarterRateBook } from '@/lib/rate-book-seed'
import {
  loadSubprojectActuals,
  fmtActualHours,
  type SubActuals,
} from '@/lib/actual-hours'
import { ArrowLeft, Copy, Plus, Trash2, X, Pencil } from 'lucide-react'

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
  linear_feet: number | null
  consumable_markup_pct: number | null
  profit_margin_pct: number | null
}

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  status: string
}

type OptionsPerLine = Map<string, Array<{ option: RateBookOptionRow; effect_value_override: number | null }>>

// ── Page ──

export default function SubprojectEditorPage() {
  const { id: projectId, subId } = useParams() as { id: string; subId: string }
  const router = useRouter()
  const { org } = useAuth()
  const { confirm } = useConfirm()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [subproject, setSubproject] = useState<SubprojectRow | null>(null)
  const [lines, setLines] = useState<EstimateLine[]>([])
  const [items, setItems] = useState<RateBookItemRow[]>([])
  const [options, setOptions] = useState<RateBookOptionRow[]>([])
  const [lineOptions, setLineOptions] = useState<OptionsPerLine>(new Map())
  const [laborRates, setLaborRates] = useState<Record<LaborDept, number>>(DEFAULT_LABOR_RATES)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [cloneOpen, setCloneOpen] = useState(false)
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
  const addInputRef = useRef<HTMLInputElement>(null)

  const pricingCtx: PricingContext = useMemo(
    () => ({
      laborRates,
      consumableMarkupPct:
        subproject?.consumable_markup_pct ?? org?.consumable_markup_pct ?? 10,
      profitMarginPct:
        subproject?.profit_margin_pct ?? org?.profit_margin_pct ?? 35,
    }),
    [laborRates, subproject, org]
  )

  // ── Load ──
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Seed if empty — same pattern as /rate-book.
      try {
        await seedStarterRateBook(org.id)
      } catch (e) {
        console.warn('seedStarterRateBook', e)
      }
      const [projRes, subRes, linesData, rb, opts, rates, lineOpts, subActuals, deptRes] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, client_name, status')
          .eq('id', projectId)
          .single(),
        supabase
          .from('subprojects')
          .select('id, project_id, name, linear_feet, consumable_markup_pct, profit_margin_pct')
          .eq('id', subId)
          .single(),
        loadEstimateLines(subId),
        loadRateBook(org.id),
        listOptions(org.id),
        listShopLaborRates(org.id),
        loadLineOptions(subId),
        loadSubprojectActuals(subId),
        supabase.from('departments').select('id, name').eq('org_id', org.id),
      ])
      if (cancelled) return
      if (projRes.data) setProject(projRes.data as any)
      if (subRes.data) setSubproject(subRes.data as any)
      setLines(linesData)
      setItems(rb.items)
      setOptions(opts)
      setLaborRates({ ...DEFAULT_LABOR_RATES, ...laborRateMap(rates) })

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

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      if (!inField && e.key === '/') {
        e.preventDefault()
        addInputRef.current?.focus()
        return
      }
      // ⌘D / Ctrl+D duplicates the selected line.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedLineId) {
          e.preventDefault()
          onDuplicate(selectedLineId)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedLineId])

  // ── Add-line flow ──
  async function commitRateBookAdd(item: RateBookItemRow, qty: number) {
    const newLine = await addEstimateLine({
      subprojectId: subId,
      item,
      quantity: qty,
      unit: item.unit,
    })
    if (newLine) {
      setLines((prev) => [...prev, newLine])
      setSelectedLineId(newLine.id)
    }
    setPendingAdd(null)
    setPendingQty('')
    setAddQuery('')
    addInputRef.current?.focus()
  }

  async function commitFreeformAdd(description: string) {
    const newLine = await addEstimateLine({
      subprojectId: subId,
      description,
      quantity: 1,
    })
    if (newLine) {
      setLines((prev) => [...prev, newLine])
      setSelectedLineId(newLine.id)
    }
    setAddQuery('')
    addInputRef.current?.focus()
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
    if (selectedLineId === id) setSelectedLineId(null)
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
      setSelectedLineId(dup.id)
    }
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

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading…</div>
      </>
    )
  }

  if (!project || !subproject) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-sm text-[#DC2626]">Subproject not found.</div>
      </>
    )
  }

  const selectedLine = selectedLineId ? lines.find((l) => l.id === selectedLineId) || null : null

  return (
    <>
      <Nav />

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
            <span><span className="text-[#111] font-semibold">{fmtMoney(rollup.total)}</span></span>
            <span className="text-[#D1D5DB]">·</span>
            <span className={rollup.marginPct >= 32 ? 'text-[#059669]' : rollup.marginPct >= 25 ? 'text-[#D97706]' : 'text-[#DC2626]'}>
              {Math.round(rollup.marginPct)}% margin
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-5 grid grid-cols-[1fr_340px] gap-6">
        {/* Center column */}
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#111]">{subproject.name}</h1>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {subproject.linear_feet ? `${subproject.linear_feet} LF · ` : ''}
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </p>
            </div>
            <button
              onClick={() => setCloneOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#6B7280] bg-white border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] hover:text-[#111] transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Clone from past
            </button>
          </div>

          {/* Keyboard hint strip */}
          <div className="flex items-center gap-3 px-3 py-2 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg text-[11px] text-[#1D4ED8] mb-3 flex-wrap">
            <span className="font-semibold uppercase tracking-wider">Shortcuts</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">/</kbd> add</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">↑↓</kbd> navigate</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">⏎</kbd> commit</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">⌘D</kbd> duplicate</span>
          </div>

          {/* Line table */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-3">
            <div className="grid grid-cols-[1fr_72px_56px_80px_100px_36px] px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              <div>Item / Finish</div>
              <div className="text-right">Qty</div>
              <div className="text-center">Unit</div>
              <div className="text-right">Hours</div>
              <div className="text-right">Total</div>
              <div />
            </div>

            {lines.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[#9CA3AF] italic">
                No lines yet. Press <kbd className="px-1.5 py-0.5 mx-0.5 bg-[#F3F4F6] border border-[#E5E7EB] rounded font-mono text-[11px]">/</kbd> to add the first one.
              </div>
            ) : (
              lines.map((line) => {
                const item = line.rate_book_item_id ? itemsById.get(line.rate_book_item_id) ?? null : null
                const opts = lineOptions.get(line.id) || []
                const b = computeLineBuildup(line, item, opts, pricingCtx)
                const selected = selectedLineId === line.id
                const finishSummary =
                  (line.finish_specs || [])
                    .map((f) => [f.material, f.finish].filter(Boolean).join(' / '))
                    .filter(Boolean)
                    .join(' · ') || ''
                return (
                  <div
                    key={line.id}
                    onClick={() => setSelectedLineId(selected ? null : line.id)}
                    className={`grid grid-cols-[1fr_72px_56px_80px_100px_36px] px-3 py-2.5 border-b border-[#F3F4F6] last:border-b-0 cursor-pointer transition-colors ${selected ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'}`}
                  >
                    <div className="pr-3 min-w-0">
                      <div className="text-sm text-[#111] font-medium truncate">
                        {item?.name || line.description || '(custom)'}
                      </div>
                      {finishSummary && (
                        <div className="text-[11px] text-[#6B7280] truncate mt-0.5">{finishSummary}</div>
                      )}
                      {opts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {opts.map((o) => (
                            <span key={o.option.id} className="inline-flex items-center px-1.5 py-0.5 bg-[#F3E8FF] text-[#7E22CE] text-[10px] rounded-full border border-[#E9D5FF]">
                              {o.option.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
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
                    <div className="text-center text-xs text-[#6B7280] font-mono">{line.unit || item?.unit || '—'}</div>
                    <div className="text-right text-sm font-mono tabular-nums text-[#6B7280]">
                      {fmtHours(b.totalHours)}
                    </div>
                    <div className="text-right text-sm font-mono tabular-nums font-semibold text-[#111]">
                      {fmtMoney(b.lineTotal)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeLine(line.id)
                      }}
                      className="flex items-center justify-center text-[#D1D5DB] hover:text-[#DC2626]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Add-line input */}
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
          </div>

          {/* Bottom rollup */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
            <div className="grid grid-cols-5 gap-5">
              <RollupCell
                label={`${subproject.name} · ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
                value={fmtMoney(rollup.total)}
                sub={`${Math.round(rollup.marginPct)}% margin${rollup.marginPct < 32 ? ' · below 32%' : ''}`}
                subTone={rollup.marginPct >= 32 ? 'ok' : rollup.marginPct >= 25 ? 'warn' : 'bad'}
                bold
              />
              <RollupCell label="Labor" value={fmtHours(rollup.totalHours)} sub={fmtMoney(rollup.laborCost)} />
              <RollupCell
                label="Material"
                value={fmtMoney(rollup.materialCost)}
                sub={`+ ${fmtMoney(rollup.consumablesCost)} consumables`}
              />
              <RollupCell
                label="Hardware / Install"
                value={fmtMoney(rollup.hardwareCost + rollup.installCost)}
                sub={rollup.installCost > 0 ? `${fmtMoney(rollup.installCost)} install` : `${lines.filter((l) => { const it = l.rate_book_item_id ? itemsById.get(l.rate_book_item_id) : null; return it && it.hardware_cost > 0 }).length} lines`}
              />
              <RollupCell
                label="Subtotal"
                value={fmtMoney(rollup.total)}
                sub={`${fmtHours(rollup.totalHours)} labor · ${fmtMoney(rollup.materialCost + rollup.consumablesCost)} mat · ${fmtMoney(rollup.hardwareCost + rollup.installCost)} hw/inst`}
                divider
              />
            </div>

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
                        rate={laborRates[d]}
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
        </div>

        {/* Right panel */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 h-fit sticky top-[7.5rem]">
          {selectedLine ? (
            <LineDetailPanel
              line={selectedLine}
              item={selectedLine.rate_book_item_id ? itemsById.get(selectedLine.rate_book_item_id) ?? null : null}
              appliedOptions={lineOptions.get(selectedLine.id) || []}
              availableOptions={applicableOptionsForItem(options, selectedLine.rate_book_item_id ? itemsById.get(selectedLine.rate_book_item_id) ?? null : null)}
              pricingCtx={pricingCtx}
              onPatch={(patch) => patchLine(selectedLine.id, patch)}
              onToggleOption={(opt) => toggleLineOption(selectedLine.id, opt)}
              onDuplicate={() => onDuplicate(selectedLine.id)}
            />
          ) : (
            <>
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">Line detail</div>
              <p className="text-sm text-[#9CA3AF] leading-relaxed">
                Click a line to edit its finish specs, options, install mode, and buildup.
              </p>
            </>
          )}
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

function RollupCell({
  label, value, sub, subTone, bold, divider,
}: {
  label: string
  value: string
  sub?: string
  subTone?: 'ok' | 'warn' | 'bad'
  bold?: boolean
  divider?: boolean
}) {
  const tone =
    subTone === 'ok' ? 'text-[#059669]' :
    subTone === 'warn' ? 'text-[#D97706]' :
    subTone === 'bad' ? 'text-[#DC2626]' :
    'text-[#6B7280]'
  return (
    <div className={divider ? 'pl-5 border-l border-[#F3F4F6]' : ''}>
      <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono tabular-nums ${bold ? 'text-xl font-semibold text-[#111]' : 'text-lg font-semibold text-[#111]'}`}>{value}</div>
      {sub && <div className={`text-[11px] mt-1 font-medium ${tone}`}>{sub}</div>}
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

// ── Line detail panel ──

function LineDetailPanel({
  line, item, appliedOptions, availableOptions, pricingCtx, onPatch, onToggleOption, onDuplicate,
}: {
  line: EstimateLine
  item: RateBookItemRow | null
  appliedOptions: Array<{ option: RateBookOptionRow; effect_value_override: number | null }>
  availableOptions: RateBookOptionRow[]
  pricingCtx: PricingContext
  onPatch: (patch: Partial<EstimateLine>) => void
  onToggleOption: (opt: RateBookOptionRow) => void
  onDuplicate: () => void
}) {
  const b = computeLineBuildup(line, item, appliedOptions, pricingCtx)
  const [newFinishMat, setNewFinishMat] = useState('')
  const [newFinishFinish, setNewFinishFinish] = useState('')
  const appliedIds = new Set(appliedOptions.map((o) => o.option.id))

  function addFinishSpec() {
    const mat = newFinishMat.trim()
    const fin = newFinishFinish.trim()
    if (!mat && !fin) return
    const list = [...(line.finish_specs || []), { material: mat || undefined, finish: fin || undefined }]
    onPatch({ finish_specs: list })
    setNewFinishMat('')
    setNewFinishFinish('')
  }
  function removeFinishSpec(i: number) {
    const list = (line.finish_specs || []).slice()
    list.splice(i, 1)
    onPatch({ finish_specs: list.length ? list : null })
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Selected line</div>
        <button onClick={onDuplicate} title="Duplicate (⌘D)" className="p-1 text-[#9CA3AF] hover:text-[#111] rounded">
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-4">
        <div className="text-sm font-semibold text-[#111]">{item?.name || line.description}</div>
        <div className="text-xs text-[#1D4ED8] font-mono tabular-nums mt-0.5">
          {line.quantity} {line.unit || item?.unit || ''} · {fmtMoney(b.lineTotal)}
        </div>
      </div>

      {/* Description (for freeform) */}
      {!item && (
        <div className="mb-4">
          <FieldLabel>Description</FieldLabel>
          <input
            value={line.description}
            onChange={(e) => onPatch({ description: e.target.value })}
            placeholder="What is this line?"
            className="w-full px-2.5 py-1.5 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Unit</FieldLabel>
              <select
                value={line.unit || 'each'}
                onChange={(e) => onPatch({ unit: e.target.value as Unit })}
                className="w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none bg-white"
              >
                {(['lf', 'each', 'sf', 'day', 'hr', 'job'] as Unit[]).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Price / unit</FieldLabel>
              <input
                type="number"
                step="any"
                value={line.unit_price_override ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onPatch({ unit_price_override: v === '' ? null : parseFloat(v) })
                }}
                placeholder="override"
                className="w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Dept-hour overrides */}
      {item && (
        <div className="mb-4">
          <FieldLabel>Hours by dept (override)</FieldLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {LABOR_DEPTS.map((d) => {
              const ov = (line.dept_hour_overrides || {})[d]
              const base =
                d === 'eng' ? item.base_labor_hours_eng :
                d === 'cnc' ? item.base_labor_hours_cnc :
                d === 'assembly' ? item.base_labor_hours_assembly :
                d === 'finish' ? item.base_labor_hours_finish :
                item.base_labor_hours_install
              return (
                <label key={d} className="flex items-center gap-1.5 text-xs">
                  <span className="w-14 text-[#6B7280]">{LABOR_DEPT_LABEL[d]}</span>
                  <input
                    type="number"
                    step="any"
                    value={ov ?? ''}
                    placeholder={String(base)}
                    onChange={(e) => {
                      const v = e.target.value
                      const cur = { ...(line.dept_hour_overrides || {}) }
                      if (v === '') delete cur[d]
                      else cur[d] = parseFloat(v) || 0
                      onPatch({ dept_hour_overrides: Object.keys(cur).length ? cur : null })
                    }}
                    className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono tabular-nums border border-[#E5E7EB] rounded focus:border-[#2563EB] focus:outline-none"
                  />
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Options */}
      {availableOptions.length > 0 && (
        <div className="mb-4">
          <FieldLabel>Options</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {availableOptions.map((o) => {
              const on = appliedIds.has(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => onToggleOption(o)}
                  className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${on ? 'bg-[#F3E8FF] text-[#7E22CE] border-[#C4B5FD]' : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#9CA3AF]'}`}
                >
                  {o.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Finish specs */}
      <div className="mb-4">
        <FieldLabel>Finish specs
          <span className="ml-1 font-normal normal-case tracking-normal text-[#D1D5DB]">· become approval slots when sold</span>
        </FieldLabel>
        <div className="flex flex-col gap-1 mb-2">
          {(line.finish_specs || []).map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-[#EFF6FF] text-[#1D4ED8] text-[11px] rounded-lg border border-[#DBEAFE]">
              <span className="font-medium">{f.material || '—'}</span>
              {f.finish && <span>· {f.finish}</span>}
              <button onClick={() => removeFinishSpec(i)} className="ml-1 text-[#93C5FD] hover:text-[#1D4ED8]" aria-label="Remove">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(line.finish_specs || []).length === 0 && (
            <span className="text-[11px] text-[#9CA3AF] italic">No finish specs on this line</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={newFinishMat}
            onChange={(e) => setNewFinishMat(e.target.value)}
            placeholder="material"
            className="flex-1 min-w-0 px-2 py-1 text-xs border border-dashed border-[#E5E7EB] rounded focus:border-[#2563EB] focus:outline-none"
          />
          <input
            value={newFinishFinish}
            onChange={(e) => setNewFinishFinish(e.target.value)}
            placeholder="finish"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFinishSpec() } }}
            className="flex-1 min-w-0 px-2 py-1 text-xs border border-dashed border-[#E5E7EB] rounded focus:border-[#2563EB] focus:outline-none"
          />
          <button onClick={addFinishSpec} className="text-[#6B7280] hover:text-[#111]"><Plus className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Install mode */}
      <div className="mb-4">
        <FieldLabel>Install pricing</FieldLabel>
        <div className="flex gap-1 mb-2">
          {(['per_man_per_day', 'per_box', 'flat'] as InstallMode[]).map((m) => {
            const on = line.install_mode === m
            const label = m === 'per_man_per_day' ? 'Per man/day' : m === 'per_box' ? 'Per box' : 'Flat'
            return (
              <button
                key={m}
                onClick={() => {
                  if (on) {
                    onPatch({ install_mode: null, install_params: null })
                  } else {
                    const params =
                      m === 'per_man_per_day' ? { days: 1, men: 1, rate: 1200 } :
                      m === 'per_box' ? { boxes: 1, rate_per_box: 45 } :
                      { amount: 0 }
                    onPatch({ install_mode: m, install_params: params as any })
                  }
                }}
                className={`flex-1 px-2 py-1 text-[11px] rounded-lg border transition-colors ${on ? 'bg-[#EFF6FF] border-[#2563EB] text-[#1D4ED8]' : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#9CA3AF]'}`}
              >{label}</button>
            )
          })}
        </div>
        {line.install_mode === 'per_man_per_day' && (
          <div className="grid grid-cols-3 gap-1.5">
            <LabeledNumber label="Days"
              value={(line.install_params as any)?.days ?? 0}
              onChange={(v) => onPatch({ install_params: { ...(line.install_params as any), days: v } as any })} />
            <LabeledNumber label="Men"
              value={(line.install_params as any)?.men ?? 0}
              onChange={(v) => onPatch({ install_params: { ...(line.install_params as any), men: v } as any })} />
            <LabeledNumber label="$/day"
              value={(line.install_params as any)?.rate ?? 0}
              onChange={(v) => onPatch({ install_params: { ...(line.install_params as any), rate: v } as any })} />
          </div>
        )}
        {line.install_mode === 'per_box' && (
          <div className="grid grid-cols-2 gap-1.5">
            <LabeledNumber label="Boxes"
              value={(line.install_params as any)?.boxes ?? 0}
              onChange={(v) => onPatch({ install_params: { ...(line.install_params as any), boxes: v } as any })} />
            <LabeledNumber label="$/box"
              value={(line.install_params as any)?.rate_per_box ?? 0}
              onChange={(v) => onPatch({ install_params: { ...(line.install_params as any), rate_per_box: v } as any })} />
          </div>
        )}
        {line.install_mode === 'flat' && (
          <LabeledNumber label="Flat amount"
            value={(line.install_params as any)?.amount ?? 0}
            onChange={(v) => onPatch({ install_params: { amount: v } as any })} />
        )}
      </div>

      {/* Notes */}
      <div className="mb-4">
        <FieldLabel>Notes</FieldLabel>
        <textarea
          value={line.notes || ''}
          onChange={(e) => onPatch({ notes: e.target.value })}
          placeholder="Internal notes on this line"
          rows={2}
          className="w-full px-2 py-1.5 text-xs border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none resize-none"
        />
      </div>

      {/* Buildup */}
      <div>
        <FieldLabel>What's in this line's price</FieldLabel>
        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 space-y-1.5 text-xs font-mono tabular-nums">
          {LABOR_DEPTS.map((d) => {
            const hrs = b.hoursByDept[d]
            if (hrs === 0) return null
            const cost = hrs * pricingCtx.laborRates[d]
            return (
              <div key={d} className="flex items-center justify-between">
                <span className="text-[#6B7280] capitalize">{LABOR_DEPT_LABEL[d]}</span>
                <span className="text-[#111]">{fmtHours(hrs)} · {fmtMoney(cost)}</span>
              </div>
            )
          })}
          {b.materialCost > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[#6B7280]">Material</span>
              <span className="text-[#111]">{fmtMoney(b.materialCost)}</span>
            </div>
          )}
          {b.consumablesCost > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[#6B7280]">Consumables ({pricingCtx.consumableMarkupPct}%)</span>
              <span className="text-[#111]">{fmtMoney(b.consumablesCost)}</span>
            </div>
          )}
          {b.hardwareCost > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[#6B7280]">Hardware</span>
              <span className="text-[#111]">{fmtMoney(b.hardwareCost)}</span>
            </div>
          )}
          {b.installCost > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[#6B7280]">Install</span>
              <span className="text-[#111]">{fmtMoney(b.installCost)}</span>
            </div>
          )}
          {b.optionsFlatAdd !== 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[#6B7280]">Options</span>
              <span className="text-[#111]">{fmtMoney(b.optionsFlatAdd)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#E5E7EB] font-semibold">
            <span className="text-[#111]">Line total</span>
            <span className="text-[#111]">{fmtMoney(b.lineTotal)}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">{children}</div>
  )
}

function LabeledNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-[#9CA3AF] uppercase tracking-wider">
      {label}
      <input
        type="number"
        step="any"
        value={value || ''}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="px-2 py-1 text-xs font-mono tabular-nums text-[#111] border border-[#E5E7EB] rounded focus:border-[#2563EB] focus:outline-none normal-case tracking-normal"
      />
    </label>
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

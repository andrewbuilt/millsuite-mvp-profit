'use client'

// ============================================================================
// /projects/[id]/subprojects/[subId] — keyboard-first line-item editor
// ============================================================================
// Implements subproject-editor-mockup.html (Apr 18) translated to MillSuite's
// light theme. Each subproject is the sum of its estimate_lines; the bottom
// panel rolls up labor / material / hardware / margin. Lines drive
// approval_items once the project is sold (callouts on the line become
// approval slot labels — see lib/estimate-lines.ts + migration 002).
//
// Scope for this pass:
//   - Line table with qty, callout chips, material variant, hours, total
//   - `/` key focuses the add-line input; autocomplete picks the rate book item
//   - Right panel: selected line detail with callout editor + buildup
//   - Bottom math: subproject totals + department breakdown
//
// Deferred (noted in BUILD-PLAN.md):
//   - Drag-to-reorder
//   - Clone-from-past modal
//   - Per-line per-dept hour overrides
//   - Shop drawings upload button (wired in drawings-track component today)
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { supabase } from '@/lib/supabase'
import {
  loadRateBook,
  loadEstimateLines,
  addEstimateLine,
  updateEstimateLine,
  deleteEstimateLine,
  computeLineBuildup,
  computeSubprojectRollup,
  EstimateLine,
  RateBookItem,
  MaterialVariant,
  PricingDefaults,
} from '@/lib/estimate-lines'
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react'

// ── Helpers ──

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

// ── Page ──

export default function SubprojectEditorPage() {
  const { id: projectId, subId } = useParams() as { id: string; subId: string }
  const router = useRouter()
  const { org } = useAuth()
  const { confirm } = useConfirm()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [subproject, setSubproject] = useState<SubprojectRow | null>(null)
  const [lines, setLines] = useState<EstimateLine[]>([])
  const [rateBook, setRateBook] = useState<{
    items: RateBookItem[]
    variantsByItem: Record<string, MaterialVariant[]>
  }>({ items: [], variantsByItem: {} })
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [addQuery, setAddQuery] = useState('')
  const [addHighlight, setAddHighlight] = useState(0)
  const [pendingAdd, setPendingAdd] = useState<RateBookItem | null>(null)
  const [pendingQty, setPendingQty] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  const shopRate = org?.shop_rate || 75
  const defaults: PricingDefaults = {
    shopRate,
    consumableMarkupPct:
      subproject?.consumable_markup_pct ?? org?.consumable_markup_pct ?? 15,
    profitMarginPct:
      subproject?.profit_margin_pct ?? org?.profit_margin_pct ?? 35,
  }

  // ── Load ──
  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const [projRes, subRes, linesData, rb] = await Promise.all([
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
      ])
      if (projRes.data) setProject(projRes.data as any)
      if (subRes.data) setSubproject(subRes.data as any)
      setLines(linesData)
      setRateBook(rb)
      setLoading(false)
    })()
  }, [org?.id, projectId, subId])

  // ── Autocomplete matches ──
  const matches = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    const source = rateBook.items
    if (!q) return source.slice(0, 10)
    return source.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category_name || '').toLowerCase().includes(q)
    )
  }, [addQuery, rateBook.items])

  // Reset highlight when the match set shifts under the cursor.
  useEffect(() => {
    setAddHighlight(0)
  }, [addQuery])

  // ── Keyboard shortcut: `/` focuses the add-line input ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.key === '/') {
        e.preventDefault()
        addInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Add-line flow ──
  async function commitAdd(item: RateBookItem, qty: number) {
    const newLine = await addEstimateLine({
      subprojectId: subId,
      item,
      quantity: qty,
    })
    if (newLine) {
      setLines((prev) => [...prev, newLine])
      setSelectedLineId(newLine.id)
    }
    setPendingAdd(null)
    setPendingQty('')
    setAddQuery('')
    // Leave focus in the input so the user can `/` again or start typing.
    addInputRef.current?.focus()
  }

  function pickMatch(item: RateBookItem) {
    setPendingAdd(item)
    setPendingQty('')
    // Move focus + placeholder changes to prompt for qty.
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
        if (!isNaN(q) && q > 0) await commitAdd(pendingAdd, q)
      } else if (e.key === 'Escape') {
        cancelPending()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAddHighlight((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAddHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = matches[addHighlight]
      if (pick) pickMatch(pick)
    } else if (e.key === 'Escape') {
      setAddQuery('')
      addInputRef.current?.blur()
    }
  }

  // ── Line mutations ──
  async function patchLine(id: string, patch: Partial<EstimateLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    try {
      await updateEstimateLine(id, patch as any)
    } catch {
      // Reload to resync on failure.
      const fresh = await loadEstimateLines(subId)
      setLines(fresh)
    }
  }

  async function removeLine(id: string) {
    const ok = await confirm({
      title: 'Remove this line?',
      message: 'This pulls it out of the subproject total and deletes any linked callouts.',
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

  // ── Rollups ──
  const rollup = useMemo(
    () => computeSubprojectRollup(lines, rateBook, defaults),
    [lines, rateBook, defaults]
  )

  const itemById = useMemo(
    () => new Map(rateBook.items.map((i) => [i.id, i])),
    [rateBook.items]
  )
  const variantById = useMemo(() => {
    const m = new Map<string, MaterialVariant>()
    for (const list of Object.values(rateBook.variantsByItem)) {
      for (const v of list) m.set(v.id, v)
    }
    return m
  }, [rateBook.variantsByItem])

  // Group autocomplete matches by category for the dropdown.
  const groupedMatches = useMemo(() => {
    const out = new Map<string, RateBookItem[]>()
    for (const m of matches) {
      const g = m.category_name || 'Other'
      ;(out.get(g) || out.set(g, []).get(g)!).push(m)
    }
    return Array.from(out.entries())
  }, [matches])

  const flatMatches = matches // used for highlight index

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">
          Loading…
        </div>
      </>
    )
  }

  if (!project || !subproject) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-sm text-[#DC2626]">
          Subproject not found.
        </div>
      </>
    )
  }

  const selectedLine = selectedLineId
    ? lines.find((l) => l.id === selectedLineId) || null
    : null

  return (
    <>
      <Nav />

      {/* ── Project strip ── */}
      <div className="bg-white border-b border-[#E5E7EB] sticky top-14 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-12 flex items-center gap-3 text-xs text-[#6B7280]">
          <Link
            href={`/projects/${projectId}`}
            className="p-1.5 -ml-1.5 rounded-lg hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Link href={`/projects/${projectId}`} className="hover:text-[#111] transition-colors">
            {project.name}
          </Link>
          <span className="text-[#D1D5DB]">·</span>
          <span className="text-[#111] font-medium">{subproject.name}</span>
          {project.client_name && (
            <>
              <span className="text-[#D1D5DB]">·</span>
              <span>{project.client_name}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-4 font-mono tabular-nums">
            <span>
              <span className="text-[#111] font-semibold">{fmtHours(rollup.totalHours)}</span>
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span>
              <span className="text-[#111] font-semibold">{fmtMoney(rollup.total)}</span>
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span
              className={
                rollup.marginPct >= 32
                  ? 'text-[#059669]'
                  : rollup.marginPct >= 25
                    ? 'text-[#D97706]'
                    : 'text-[#DC2626]'
              }
            >
              {Math.round(rollup.marginPct)}% margin
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-5 grid grid-cols-[1fr_320px] gap-6">
        {/* ── Center column ── */}
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#111]">
                {subproject.name}
              </h1>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {subproject.linear_feet
                  ? `${subproject.linear_feet} LF · `
                  : ''}
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </p>
            </div>
          </div>

          {/* Keyboard hint strip */}
          <div className="flex items-center gap-3 px-3 py-2 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg text-[11px] text-[#1D4ED8] mb-3 flex-wrap">
            <span className="font-semibold uppercase tracking-wider">Shortcuts</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">/</kbd> add item</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">↑↓</kbd> navigate</span>
            <span><kbd className="px-1.5 py-0.5 bg-white border border-[#BFDBFE] rounded font-mono text-[10px]">⏎</kbd> commit</span>
          </div>

          {/* Line table */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-3">
            <div className="grid grid-cols-[1fr_80px_1fr_80px_100px_40px] px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              <div>Item</div>
              <div className="text-right">Qty</div>
              <div>Callouts</div>
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
                const item = line.rate_book_item_id
                  ? itemById.get(line.rate_book_item_id) ?? null
                  : null
                const variant = line.rate_book_material_variant_id
                  ? variantById.get(line.rate_book_material_variant_id) ?? null
                  : null
                const b = computeLineBuildup(line, item, variant, defaults)
                const selected = selectedLineId === line.id

                return (
                  <div
                    key={line.id}
                    onClick={() => setSelectedLineId(selected ? null : line.id)}
                    className={`grid grid-cols-[1fr_80px_1fr_80px_100px_40px] px-3 py-2.5 border-b border-[#F3F4F6] last:border-b-0 cursor-pointer transition-colors ${
                      selected ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="text-sm text-[#111] font-medium truncate pr-3">
                      {item?.name || line.description || '(custom)'}
                      {variant && (
                        <span className="text-xs text-[#6B7280] ml-2 font-normal">
                          · {variant.material_name}
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      step="any"
                      value={line.quantity || ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        setLines((prev) =>
                          prev.map((l) => (l.id === line.id ? { ...l, quantity: val } : l))
                        )
                      }}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        patchLine(line.id, { quantity: val })
                      }}
                      className="w-full text-right text-sm font-mono tabular-nums bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-1 pl-2">
                      {b.effectiveCallouts.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#EFF6FF] text-[#1D4ED8] text-[11px] rounded-full border border-[#DBEAFE]"
                        >
                          {c}
                        </span>
                      ))}
                      {b.effectiveCallouts.length === 0 && (
                        <span className="text-[11px] text-[#D1D5DB] italic">no callouts</span>
                      )}
                    </div>
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
            <div
              className={`flex items-center gap-3 px-3 py-2.5 bg-white border rounded-lg transition-colors ${
                pendingAdd || addInputRef.current === document.activeElement
                  ? 'border-[#2563EB]'
                  : 'border-dashed border-[#E5E7EB]'
              }`}
            >
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
                  <button
                    onClick={cancelPending}
                    className="text-[#9CA3AF] hover:text-[#111]"
                    aria-label="Cancel"
                  >
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
                    placeholder="Add line — type to search (std base, shaker door, pantry…)"
                    className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-[#9CA3AF]"
                  />
                  <kbd className="px-1.5 py-0.5 text-[10px] text-[#9CA3AF] bg-[#F9FAFB] border border-[#E5E7EB] rounded font-mono">
                    type to search
                  </kbd>
                </>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {!pendingAdd && addQuery.length > 0 && matches.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-white border border-[#E5E7EB] rounded-lg shadow-lg">
                {groupedMatches.map(([group, groupItems]) => (
                  <div key={group}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider bg-[#F9FAFB] border-b border-[#F3F4F6]">
                      {group}
                    </div>
                    {groupItems.map((m) => {
                      const flatIdx = flatMatches.indexOf(m)
                      const highlighted = flatIdx === addHighlight
                      return (
                        <button
                          key={m.id}
                          onMouseEnter={() => setAddHighlight(flatIdx)}
                          onClick={() => pickMatch(m)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b border-[#F3F4F6] last:border-b-0 ${
                            highlighted ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'
                          }`}
                        >
                          <div>
                            <span className="text-[#111] font-medium">{m.name}</span>
                            <span className="text-[#9CA3AF] text-xs ml-2">· {m.unit}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
            {!pendingAdd && addQuery.length > 0 && matches.length === 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-[#E5E7EB] rounded-lg shadow-lg px-3 py-3 text-sm text-[#9CA3AF]">
                No rate book items match.{' '}
                <Link href="/settings/rate-book" className="text-[#2563EB] hover:underline">
                  Add one →
                </Link>
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
                subTone={
                  rollup.marginPct >= 32 ? 'ok' : rollup.marginPct >= 25 ? 'warn' : 'bad'
                }
                bold
              />
              <RollupCell
                label="Labor"
                value={fmtHours(rollup.totalHours)}
                sub={fmtMoney(rollup.laborCost)}
              />
              <RollupCell
                label="Material"
                value={fmtMoney(rollup.materialCost + rollup.sheetCost)}
                sub={`+ ${fmtMoney(rollup.consumables)} consumables`}
              />
              <RollupCell
                label="Hardware"
                value={fmtMoney(rollup.hardwareCost)}
                sub={`${lines.filter((l) => {
                  const it = l.rate_book_item_id ? itemById.get(l.rate_book_item_id) : null
                  return it && it.hardware_cost > 0
                }).length} lines`}
              />
              <RollupCell
                label="Subproject total"
                value={fmtMoney(rollup.total)}
                sub={`${fmtHours(rollup.totalHours)} labor · ${fmtMoney(rollup.materialCost + rollup.sheetCost + rollup.consumables)} mat · ${fmtMoney(rollup.hardwareCost)} hw`}
                divider
              />
            </div>

            {rollup.totalHours > 0 && (
              <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center gap-4 flex-wrap text-xs text-[#6B7280]">
                <span className="font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  Labor by department
                </span>
                <DeptPill label="Eng" hours={rollup.hoursByDept.eng} rate={shopRate} />
                <DeptPill label="CNC" hours={rollup.hoursByDept.cnc} rate={shopRate} />
                <DeptPill label="Assembly" hours={rollup.hoursByDept.assembly} rate={shopRate} />
                <DeptPill label="Finish" hours={rollup.hoursByDept.finish} rate={shopRate} />
                <DeptPill label="Install" hours={rollup.hoursByDept.install} rate={shopRate} />
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: selected line detail ── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 h-fit sticky top-[7.5rem]">
          {selectedLine ? (
            <LineDetailPanel
              line={selectedLine}
              item={
                selectedLine.rate_book_item_id
                  ? itemById.get(selectedLine.rate_book_item_id) ?? null
                  : null
              }
              variants={
                selectedLine.rate_book_item_id
                  ? rateBook.variantsByItem[selectedLine.rate_book_item_id] || []
                  : []
              }
              defaults={defaults}
              onPatch={(patch) => patchLine(selectedLine.id, patch)}
            />
          ) : (
            <>
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">
                Line detail
              </div>
              <p className="text-sm text-[#9CA3AF] leading-relaxed">
                Click a line to see its material variant, callouts, and price build-up.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── Sub-components ──

function RollupCell({
  label,
  value,
  sub,
  subTone,
  bold,
  divider,
}: {
  label: string
  value: string
  sub?: string
  subTone?: 'ok' | 'warn' | 'bad'
  bold?: boolean
  divider?: boolean
}) {
  const tone =
    subTone === 'ok'
      ? 'text-[#059669]'
      : subTone === 'warn'
        ? 'text-[#D97706]'
        : subTone === 'bad'
          ? 'text-[#DC2626]'
          : 'text-[#6B7280]'
  return (
    <div className={divider ? 'pl-5 border-l border-[#F3F4F6]' : ''}>
      <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`font-mono tabular-nums ${bold ? 'text-xl font-semibold text-[#111]' : 'text-lg font-semibold text-[#111]'}`}
      >
        {value}
      </div>
      {sub && <div className={`text-[11px] mt-1 font-medium ${tone}`}>{sub}</div>}
    </div>
  )
}

function DeptPill({ label, hours, rate }: { label: string; hours: number; rate: number }) {
  if (hours <= 0) return null
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[#9CA3AF]">{label}</span>
      <span className="font-mono tabular-nums text-[#111] font-semibold">
        {fmtHours(hours)}
      </span>
      <span className="font-mono tabular-nums text-[#9CA3AF] text-[10.5px]">
        {fmtMoney(hours * rate)}
      </span>
    </span>
  )
}

function LineDetailPanel({
  line,
  item,
  variants,
  defaults,
  onPatch,
}: {
  line: EstimateLine
  item: RateBookItem | null
  variants: MaterialVariant[]
  defaults: PricingDefaults
  onPatch: (patch: Partial<EstimateLine>) => void
}) {
  const [newCallout, setNewCallout] = useState('')
  const variant = line.rate_book_material_variant_id
    ? variants.find((v) => v.id === line.rate_book_material_variant_id) || null
    : null
  const b = computeLineBuildup(line, item, variant, defaults)
  const callouts = b.effectiveCallouts

  function setCallouts(next: string[]) {
    // Write null only when the array matches the item defaults exactly — so
    // future edits to rate_book_items.default_callouts flow through. Any
    // divergence is stored as an explicit override on the line.
    const matchesDefault =
      item &&
      next.length === item.default_callouts.length &&
      next.every((c, i) => c === item.default_callouts[i])
    onPatch({ callouts: matchesDefault ? null : next })
  }

  return (
    <>
      <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
        Selected line
      </div>
      <div className="px-3 py-2.5 bg-[#EFF6FF] border border-[#DBEAFE] rounded-lg mb-4">
        <div className="text-sm font-semibold text-[#111]">
          {item?.name || line.description}
        </div>
        <div className="text-xs text-[#1D4ED8] font-mono tabular-nums mt-0.5">
          {line.quantity} {item?.unit || ''} · ${Math.round(b.lineTotal).toLocaleString()}
        </div>
      </div>

      {/* Material variant picker */}
      {variants.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            Material
          </div>
          <div className="space-y-1">
            {variants.map((v) => {
              const on = v.id === line.rate_book_material_variant_id
              return (
                <button
                  key={v.id}
                  onClick={() =>
                    onPatch({ rate_book_material_variant_id: on ? null : v.id })
                  }
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-start gap-2 ${
                    on
                      ? 'bg-[#EFF6FF] border border-[#2563EB] text-[#111]'
                      : 'bg-white border border-[#E5E7EB] hover:border-[#9CA3AF] text-[#6B7280]'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 mt-0.5 rounded-sm border ${
                      on ? 'bg-[#2563EB] border-[#2563EB]' : 'border-[#D1D5DB]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${on ? 'text-[#111]' : ''}`}>
                      {v.material_name}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF] mt-0.5">
                      ${Math.round(v.material_cost_per_lf)}/lf
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Callouts editor */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
          Callouts
          <span className="ml-1 font-normal normal-case tracking-normal text-[#D1D5DB]">
            · become approval slots when sold
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {callouts.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-1 bg-[#EFF6FF] text-[#1D4ED8] text-[11px] rounded-full border border-[#DBEAFE]"
            >
              {c}
              <button
                onClick={() => setCallouts(callouts.filter((x) => x !== c))}
                className="text-[#93C5FD] hover:text-[#1D4ED8]"
                aria-label={`Remove ${c}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {callouts.length === 0 && (
            <span className="text-[11px] text-[#9CA3AF] italic py-1">No callouts on this line</span>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const c = newCallout.trim()
            if (!c || callouts.includes(c)) return
            setCallouts([...callouts, c])
            setNewCallout('')
          }}
          className="flex items-center gap-2"
        >
          <input
            value={newCallout}
            onChange={(e) => setNewCallout(e.target.value)}
            placeholder="+ add callout"
            className="flex-1 px-2.5 py-1.5 text-xs border border-dashed border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none placeholder:text-[#9CA3AF]"
          />
        </form>
      </div>

      {/* Price buildup */}
      <div>
        <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
          What's in this line's price
        </div>
        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 space-y-1.5 text-xs">
          {(['eng', 'cnc', 'assembly', 'finish', 'install'] as const).map((d) => {
            const hrs = b.hoursByDept[d]
            if (hrs === 0) return null
            const cost = hrs * defaults.shopRate
            return (
              <div
                key={d}
                className="flex items-center justify-between font-mono tabular-nums"
              >
                <span className="text-[#6B7280] capitalize">{d}</span>
                <span className="text-[#111]">
                  {fmtHours(hrs)} · {fmtMoney(cost)}
                </span>
              </div>
            )
          })}
          {b.materialCost > 0 && (
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span className="text-[#6B7280]">Material</span>
              <span className="text-[#111]">{fmtMoney(b.materialCost)}</span>
            </div>
          )}
          {b.sheetCost > 0 && (
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span className="text-[#6B7280]">Sheets</span>
              <span className="text-[#111]">{fmtMoney(b.sheetCost)}</span>
            </div>
          )}
          {b.hardwareCost > 0 && (
            <div className="flex items-center justify-between font-mono tabular-nums">
              <span className="text-[#6B7280]">Hardware</span>
              <span className="text-[#111]">{fmtMoney(b.hardwareCost)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#E5E7EB] font-mono tabular-nums font-semibold">
            <span className="text-[#111]">Line total</span>
            <span className="text-[#111]">{fmtMoney(b.lineTotal)}</span>
          </div>
        </div>
      </div>
    </>
  )
}

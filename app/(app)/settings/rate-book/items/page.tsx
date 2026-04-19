'use client'

// ============================================================================
// Rate Book — Items (the "first-class items" view)
// ============================================================================
// Translates rate-book-mockup.html into the MillSuite visual language. Manages
// the NEW schema introduced by migration 002: rate_book_items +
// rate_book_material_variants. These are the rows the subproject editor picks
// from when adding estimate lines.
//
// Layout: 2-pane (list left, detail right). The mockup has a third "Options"
// pane that scopes shop-wide modifiers to items — deferred until the options
// table exists in the schema.
//
// Deferred:
//   · Tree-grouping by rate_book_categories + drill-down (current list is flat,
//     but categories are shown as a label per row)
//   · Change history audit rows + past jobs list on the detail pane
//   · Split-suggestion banners (the "paint-grade vs stain-grade" learning loop)
//   · Cross-item "apply to everything using this rate" bulk edit
//   · Confidence bump on use (lib/rate-book.ts already has bumpRateConfidence
//     for legacy rates; we'll wire a bump for items when it matters)
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { loadRateBook, type RateBookItem, type MaterialVariant } from '@/lib/estimate-lines'
import { ArrowLeft, Plus, Trash2, Pencil, Search, Check, X } from 'lucide-react'

// ── Helpers ──

const DEPT_LABELS = [
  ['eng', 'Engineering'],
  ['cnc', 'CNC'],
  ['assembly', 'Assembly'],
  ['finish', 'Finish'],
  ['install', 'Install'],
] as const

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function confidenceBadge(jobCount: number, lastUsed: string | null) {
  if (jobCount === 0) return { label: 'New', cls: 'bg-[#F3F4F6] text-[#6B7280]' }
  const days = lastUsed
    ? (Date.now() - new Date(lastUsed).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity
  if (days > 180) return { label: 'Stale', cls: 'bg-[#FEE2E2] text-[#991B1B]' }
  if (jobCount >= 5) return { label: 'Reliable', cls: 'bg-[#D1FAE5] text-[#065F46]' }
  return { label: 'Emerging', cls: 'bg-[#FEF3C7] text-[#92400E]' }
}

// ── Page ──

export default function RateBookItemsPage() {
  return (
    <PlanGate requires="rate-book">
      <Nav />
      <RateBookItemsBody />
    </PlanGate>
  )
}

function RateBookItemsBody() {
  const { org } = useAuth()
  const shopRate = org?.shop_rate || 75

  const [items, setItems] = useState<RateBookItem[]>([])
  const [variantsByItem, setVariantsByItem] = useState<Record<string, MaterialVariant[]>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2400)
  }

  async function refresh() {
    if (!org?.id) return
    setLoading(true)
    const rb = await loadRateBook(org.id)
    setItems(rb.items)
    setVariantsByItem(rb.variantsByItem)
    if (!selectedId && rb.items.length) setSelectedId(rb.items[0].id)
    setLoading(false)
  }

  useEffect(() => {
    if (org?.id) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category_name || '').toLowerCase().includes(q)
    )
  }, [items, search])

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  )
  const selectedVariants = selected ? variantsByItem[selected.id] || [] : []

  // ── Item CRUD ──

  async function handleCreateItem() {
    if (!org?.id) return
    setSaving(true)
    const { data, error } = await supabase
      .from('rate_book_items')
      .insert({
        org_id: org.id,
        name: 'New item',
        unit: 'lf',
        base_labor_hours_eng: 0,
        base_labor_hours_cnc: 0,
        base_labor_hours_assembly: 0,
        base_labor_hours_finish: 0,
        base_labor_hours_install: 0,
        sheets_per_unit: 0,
        sheet_cost: 0,
        hardware_cost: 0,
        default_callouts: [],
        active: true,
      })
      .select()
      .single()
    setSaving(false)
    if (error) {
      console.error(error)
      showToast('Could not create item.')
      return
    }
    await refresh()
    if (data?.id) setSelectedId(data.id)
    showToast('Item created.')
  }

  async function handleUpdateItem(patch: Partial<RateBookItem>) {
    if (!selected) return
    // Map camelCase-free keys back to DB columns. Our RateBookItem already
    // uses DB column names for scalar fields, so the patch is direct.
    const dbPatch: any = { ...patch, updated_at: new Date().toISOString() }
    const { error } = await supabase
      .from('rate_book_items')
      .update(dbPatch)
      .eq('id', selected.id)
    if (error) {
      console.error(error)
      showToast('Save failed.')
      return
    }
    // Optimistic local update.
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, ...patch } : i))
    )
  }

  async function handleArchiveItem() {
    if (!selected) return
    const yes = window.confirm(
      `Archive "${selected.name}"? It will stop showing up in the subproject editor. Existing lines that use it keep their data.`
    )
    if (!yes) return
    const { error } = await supabase
      .from('rate_book_items')
      .update({ active: false })
      .eq('id', selected.id)
    if (error) {
      console.error(error)
      showToast('Archive failed.')
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== selected.id))
    setSelectedId(null)
    showToast('Item archived.')
  }

  // ── Variant CRUD ──

  async function handleAddVariant() {
    if (!selected) return
    const { data, error } = await supabase
      .from('rate_book_material_variants')
      .insert({
        rate_book_item_id: selected.id,
        material_name: 'New material',
        material_cost_per_lf: 0,
        labor_multiplier_eng: 1,
        labor_multiplier_cnc: 1,
        labor_multiplier_assembly: 1,
        labor_multiplier_finish: 1,
        labor_multiplier_install: 1,
        active: true,
      })
      .select()
      .single()
    if (error) {
      console.error(error)
      showToast('Add variant failed.')
      return
    }
    await refresh()
  }

  async function handleUpdateVariant(
    variantId: string,
    patch: Partial<MaterialVariant>
  ) {
    const { error } = await supabase
      .from('rate_book_material_variants')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', variantId)
    if (error) {
      console.error(error)
      showToast('Save failed.')
      return
    }
    setVariantsByItem((prev) => {
      if (!selected) return prev
      const list = (prev[selected.id] || []).map((v) =>
        v.id === variantId ? { ...v, ...patch } : v
      )
      return { ...prev, [selected.id]: list }
    })
  }

  async function handleDeleteVariant(variantId: string) {
    if (!selected) return
    const yes = window.confirm('Delete this material variant?')
    if (!yes) return
    const { error } = await supabase
      .from('rate_book_material_variants')
      .update({ active: false })
      .eq('id', variantId)
    if (error) {
      console.error(error)
      showToast('Delete failed.')
      return
    }
    setVariantsByItem((prev) => {
      if (!selected) return prev
      const list = (prev[selected.id] || []).filter((v) => v.id !== variantId)
      return { ...prev, [selected.id]: list }
    })
  }

  async function handleSetDefaultVariant(variantId: string) {
    if (!selected) return
    await handleUpdateItem({ default_variant_id: variantId })
    showToast('Default variant updated.')
  }

  // ── Cost buildup for the detail panel ──

  const buildup = useMemo(() => {
    if (!selected) return null
    const defaultVariant =
      selectedVariants.find((v) => v.id === selected.default_variant_id) ||
      selectedVariants[0] ||
      null

    const totalHours =
      selected.base_labor_hours_eng +
      selected.base_labor_hours_cnc +
      selected.base_labor_hours_assembly +
      selected.base_labor_hours_finish +
      selected.base_labor_hours_install
    const laborCost = totalHours * shopRate
    const materialCost = defaultVariant?.material_cost_per_lf ?? 0
    const sheetCost = selected.sheets_per_unit * selected.sheet_cost
    const consumables = (materialCost + sheetCost) * 0.1 // shop-wide 10% assumption
    const hardware = selected.hardware_cost
    const total = laborCost + materialCost + sheetCost + consumables + hardware
    return { totalHours, laborCost, materialCost, sheetCost, consumables, hardware, total, defaultVariant }
  }, [selected, selectedVariants, shopRate])

  // ── Render ──

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading rate book…
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#F9FAFB]">
      {/* Top context strip */}
      <div className="px-6 py-3 bg-[#EFF6FF] border-b border-[#DBEAFE] flex items-center gap-3 text-xs">
        <span className="px-2 py-0.5 rounded bg-[#2563EB] text-white font-semibold uppercase tracking-wider text-[10px]">
          Back-end
        </span>
        <span className="text-[#1E40AF] leading-relaxed">
          This is where prices live and history gets written. You usually won't come
          here — pricing happens on projects, and the system learns as you go. Come
          back to audit, tune, or add items.
        </span>
      </div>

      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/settings/rate-book"
            className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to rate book
          </Link>
          <span className="text-sm font-medium text-[#111] ml-2">Items</span>
          <span className="text-xs text-[#9CA3AF]">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <button
          onClick={handleCreateItem}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New item
        </button>
      </div>

      {/* 2-pane */}
      <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] min-h-[calc(100vh-164px)]">
        {/* List */}
        <div className="bg-white border-r border-[#E5E7EB] overflow-y-auto">
          <div className="p-3 sticky top-0 bg-white border-b border-[#F3F4F6] z-10">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#9CA3AF]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="w-full pl-8 pr-3 py-2 text-sm bg-[#F9FAFB] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#9CA3AF]">
              {items.length === 0 ? (
                <>
                  No items yet.{' '}
                  <button
                    onClick={handleCreateItem}
                    className="text-[#2563EB] hover:underline font-medium"
                  >
                    Create your first.
                  </button>
                </>
              ) : (
                'Nothing matches that search.'
              )}
            </div>
          ) : (
            filtered.map((it) => {
              const badge = confidenceBadge(
                it.confidence_job_count || 0,
                it.confidence_last_used_at || null
              )
              const isSelected = it.id === selectedId
              return (
                <button
                  key={it.id}
                  onClick={() => setSelectedId(it.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[#F3F4F6] transition-colors ${
                    isSelected
                      ? 'bg-[#EFF6FF] border-l-2 border-l-[#2563EB]'
                      : 'hover:bg-[#F9FAFB]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#111] truncate">
                        {it.name}
                      </div>
                      <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">
                        {it.category_name || 'Uncategorized'} · {it.unit.toUpperCase()}
                      </div>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Detail */}
        <div className="overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-sm text-[#9CA3AF]">
              Select an item to edit.
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-6 space-y-6">
              {/* Header */}
              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={selected.name}
                    onChange={(e) => {
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === selected.id ? { ...i, name: e.target.value } : i
                        )
                      )
                    }}
                    onBlur={(e) => handleUpdateItem({ name: e.target.value })}
                    className="flex-1 text-2xl font-semibold text-[#111] bg-transparent border border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] focus:bg-white rounded px-2 py-1 transition-colors outline-none"
                  />
                  <button
                    onClick={handleArchiveItem}
                    className="p-2 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                    title="Archive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-[#6B7280]">
                  <span>
                    Used in{' '}
                    <strong className="text-[#374151]">
                      {selected.confidence_job_count || 0}
                    </strong>{' '}
                    jobs
                  </span>
                  {selected.confidence_last_used_at && (
                    <span>
                      Last used:{' '}
                      {new Date(selected.confidence_last_used_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Unit + Category inline */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-white border border-[#E5E7EB] rounded-xl">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
                    Unit
                  </label>
                  <select
                    value={selected.unit}
                    onChange={(e) =>
                      handleUpdateItem({ unit: e.target.value as 'lf' | 'each' | 'sf' })
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="lf">LF — Linear feet</option>
                    <option value="each">EA — Each</option>
                    <option value="sf">SF — Square feet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
                    Category
                  </label>
                  <div className="px-3 py-2 text-sm text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] rounded-md">
                    {selected.category_name || 'Uncategorized'}
                  </div>
                </div>
              </div>

              {/* Labor by department */}
              <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-3">
                  Labor hours per unit
                </div>
                <div className="space-y-2">
                  {DEPT_LABELS.map(([key, label]) => {
                    const fieldKey = `base_labor_hours_${key}` as keyof RateBookItem
                    const hours = selected[fieldKey] as number
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[1fr_120px_100px] items-center gap-3 text-sm"
                      >
                        <span className="text-[#374151]">{label}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={hours}
                          onChange={(e) => {
                            const n = Number(e.target.value) || 0
                            setItems((prev) =>
                              prev.map((i) =>
                                i.id === selected.id ? { ...i, [fieldKey]: n } : i
                              )
                            )
                          }}
                          onBlur={(e) => {
                            const n = Number(e.target.value) || 0
                            handleUpdateItem({ [fieldKey]: n } as any)
                          }}
                          className="w-full px-2.5 py-1.5 text-right text-sm font-mono border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                        />
                        <span className="text-right text-xs text-[#9CA3AF] font-mono">
                          {money(hours * shopRate)}
                        </span>
                      </div>
                    )
                  })}
                  <div className="grid grid-cols-[1fr_120px_100px] items-center gap-3 pt-2 border-t border-[#F3F4F6] text-sm font-semibold">
                    <span className="text-[#111]">Total per unit</span>
                    <span className="text-right font-mono text-[#111]">
                      {buildup?.totalHours.toFixed(2)} hr
                    </span>
                    <span className="text-right font-mono text-[#111]">
                      {money(buildup?.laborCost || 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Physical inputs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumberField
                  label="Sheets per unit"
                  value={selected.sheets_per_unit}
                  onBlur={(n) => handleUpdateItem({ sheets_per_unit: n })}
                />
                <NumberField
                  label="Sheet cost ($)"
                  value={selected.sheet_cost}
                  onBlur={(n) => handleUpdateItem({ sheet_cost: n })}
                />
                <NumberField
                  label="Hardware ($)"
                  value={selected.hardware_cost}
                  onBlur={(n) => handleUpdateItem({ hardware_cost: n })}
                />
              </div>

              {/* Default callouts */}
              <CalloutsField
                value={selected.default_callouts || []}
                onChange={(next) =>
                  handleUpdateItem({ default_callouts: next })
                }
              />

              {/* Variants */}
              <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                      Material variants
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] mt-0.5">
                      Swap the material without changing the construction. Mark
                      one as default; users can pick any on a per-line basis.
                    </div>
                  </div>
                  <button
                    onClick={handleAddVariant}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#E5E7EB] text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add variant
                  </button>
                </div>
                {selectedVariants.length === 0 ? (
                  <div className="text-xs text-[#9CA3AF] italic py-3 text-center">
                    No variants yet. Add one to give users a material pick.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedVariants.map((v) => (
                      <VariantRow
                        key={v.id}
                        variant={v}
                        isDefault={v.id === selected.default_variant_id}
                        onUpdate={(patch) => handleUpdateVariant(v.id, patch)}
                        onDelete={() => handleDeleteVariant(v.id)}
                        onSetDefault={() => handleSetDefaultVariant(v.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Price buildup */}
              {buildup && (
                <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-3">
                    Unit price · using{' '}
                    {buildup.defaultVariant?.material_name || 'no variant'}
                  </div>
                  <BuildupRow
                    label="Labor"
                    note={`${buildup.totalHours.toFixed(2)} hr × shop rate`}
                    value={buildup.laborCost}
                  />
                  {buildup.materialCost > 0 && (
                    <BuildupRow
                      label="Material"
                      note={`flat per ${selected.unit.toUpperCase()} · ${
                        buildup.defaultVariant?.material_name
                      }`}
                      value={buildup.materialCost}
                    />
                  )}
                  {buildup.sheetCost > 0 && (
                    <BuildupRow
                      label="Sheet material"
                      note={`${selected.sheets_per_unit} sh × ${money(selected.sheet_cost)}`}
                      value={buildup.sheetCost}
                    />
                  )}
                  {buildup.consumables > 0 && (
                    <BuildupRow
                      label="Consumables"
                      note="10% of material · hinges, glue, fasteners"
                      value={buildup.consumables}
                    />
                  )}
                  {buildup.hardware > 0 && (
                    <BuildupRow
                      label="Hardware"
                      note={`per ${selected.unit.toUpperCase()}`}
                      value={buildup.hardware}
                    />
                  )}
                  <div className="grid grid-cols-[1fr_auto] pt-3 mt-2 border-t border-[#111] font-semibold text-[#111]">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">
                      {money(buildup.total)}{' '}
                      <span className="text-xs text-[#9CA3AF] font-normal">
                        / {selected.unit.toUpperCase()}
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#1E40AF] text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Presentational subcomponents ──

function NumberField({
  label,
  value,
  onBlur,
}: {
  label: string
  value: number
  onBlur: (n: number) => void
}) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => setRaw(String(value)), [value])
  return (
    <div className="p-3 bg-white border border-[#E5E7EB] rounded-xl">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
        {label}
      </label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => onBlur(Number(raw) || 0)}
        className="w-full px-2.5 py-1.5 text-right text-sm font-mono border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
      />
    </div>
  )
}

function CalloutsField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')
  function add() {
    const v = input.trim()
    if (!v) return
    if (value.includes(v)) return
    onChange([...value, v])
    setInput('')
  }
  return (
    <div className="p-4 bg-white border border-[#E5E7EB] rounded-xl">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-2">
        Default callouts
      </div>
      <div className="text-[11px] text-[#9CA3AF] mb-3 leading-relaxed">
        These become the approval-item labels for this construction when a line
        uses this item. Lines can override.
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#EFF6FF] text-[#1E40AF] text-xs"
          >
            {c}
            <button
              onClick={() => onChange(value.filter((x) => x !== c))}
              className="hover:text-[#DC2626]"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Add a callout (e.g. shaker door, soft-close slides)…"
          className="flex-1 px-3 py-1.5 text-sm border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
        />
        <button
          onClick={add}
          className="px-3 py-1.5 text-sm border border-[#E5E7EB] text-[#6B7280] rounded-md hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function VariantRow({
  variant,
  isDefault,
  onUpdate,
  onDelete,
  onSetDefault,
}: {
  variant: MaterialVariant
  isDefault: boolean
  onUpdate: (patch: Partial<MaterialVariant>) => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div className="grid grid-cols-[1fr_120px_auto_auto] items-center gap-2 p-2 border border-[#F3F4F6] rounded-md hover:border-[#E5E7EB] transition-colors">
      <input
        type="text"
        defaultValue={variant.material_name}
        onBlur={(e) => onUpdate({ material_name: e.target.value })}
        className="px-2 py-1 text-sm border border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] rounded-md focus:outline-none"
      />
      <input
        type="number"
        step="0.01"
        min="0"
        defaultValue={variant.material_cost_per_lf}
        onBlur={(e) => onUpdate({ material_cost_per_lf: Number(e.target.value) || 0 })}
        className="px-2 py-1 text-right text-sm font-mono border border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] rounded-md focus:outline-none"
      />
      {isDefault ? (
        <span className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-[#065F46] bg-[#D1FAE5] rounded">
          Default
        </span>
      ) : (
        <button
          onClick={onSetDefault}
          className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-[#6B7280] hover:text-[#2563EB] rounded"
          title="Set as default"
        >
          Make default
        </button>
      )}
      <button
        onClick={onDelete}
        className="p-1.5 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded"
        title="Delete"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function BuildupRow({
  label,
  note,
  value,
}: {
  label: string
  note: string
  value: number
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-baseline py-1.5 text-sm border-b border-[#F3F4F6] last:border-b-0">
      <span className="font-medium text-[#374151] min-w-[120px]">{label}</span>
      <span className="text-xs text-[#9CA3AF]">{note}</span>
      <span className="font-mono tabular-nums text-[#111]">{money(value)}</span>
    </div>
  )
}

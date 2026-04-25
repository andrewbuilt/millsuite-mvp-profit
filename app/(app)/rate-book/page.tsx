'use client'

// ============================================================================
// /rate-book — Phase 1 rate book (top-level, not under settings)
// ============================================================================
// Three panes:
//   Left   — category tree + search, with confidence badges on every item
//   Middle — item detail with three tabs: Current | History | Changes
//            (Current = price buildup; History = audit rows; Changes = upcoming)
//   Right  — options (stackable modifiers)
//
// Gear icon top-right opens the Shop Labor Rates modal.
// Rate book starts empty. Items land via manual add or by accepting
// Suggestions that promote recurring manual estimate entries into permanent
// items — every item lands as 'untested' until real jobs run through.
//
// Edit modal writes a row to rate_book_item_history with apply_scope +
// required reason — the audit trail the Suggestions loop consumes.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import {
  Search, Settings, Plus, Tag, X, ChevronRight, ChevronDown,
  Pencil, Copy, BookOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  type RateBookCategoryRow, type RateBookItemRow, type RateBookOptionRow,
  type RateBookItemHistoryRow, type Confidence,
  type Unit, type MaterialMode,
  listCategories, listItems, listOptions,
  listItemOptions, listItemHistory,
  attachOption, detachOption,
  updateItem,
  computeBuildup,
  CONFIDENCE_LABEL, CONFIDENCE_COLOR,
} from '@/lib/rate-book-v2'
import {
  LABOR_DEPTS, LABOR_DEPT_LABEL, type LaborDept,
} from '@/lib/rate-book-seed'

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers

function fmt$(n: number) {
  return `$${(n || 0).toFixed(2)}`
}

function ConfidencePill({ c, size = 'sm' }: { c: Confidence; size?: 'sm' | 'dot' }) {
  const colors = CONFIDENCE_COLOR[c]
  if (size === 'dot') {
    return (
      <span
        style={{ backgroundColor: colors.fg }}
        className="inline-block w-1.5 h-1.5 rounded-full"
        title={CONFIDENCE_LABEL[c]}
      />
    )
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ backgroundColor: colors.bg, color: colors.fg, borderColor: colors.border }}
    >
      {CONFIDENCE_LABEL[c]}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page

export default function RateBookPage() {
  const { user, org } = useAuth()
  const orgId = user?.org_id

  const [loaded, setLoaded] = useState(false)
  const [categories, setCategories] = useState<RateBookCategoryRow[]>([])
  const [items, setItems] = useState<RateBookItemRow[]>([])
  const [options, setOptions] = useState<RateBookOptionRow[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'current' | 'history' | 'changes'>('current')
  const [history, setHistory] = useState<RateBookItemHistoryRow[]>([])
  const [itemOptionIds, setItemOptionIds] = useState<Set<string>>(new Set())
  const [treeSearch, setTreeSearch] = useState('')
  const [optionSearch, setOptionSearch] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [laborSettingsOpen, setLaborSettingsOpen] = useState(false)

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      await refreshAll(orgId)
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function refreshAll(id: string) {
    const [c, i, o] = await Promise.all([
      listCategories(id), listItems(id), listOptions(id),
    ])
    setCategories(c)
    setItems(i)
    setOptions(o)
    // Auto-expand every category and select first item on cold boot.
    if (expanded.size === 0) {
      setExpanded(new Set(c.map((x) => x.id)))
    }
    if (!selectedId && i.length > 0) {
      setSelectedId(i[0].id)
    }
  }

  // Load per-item side data whenever selection changes.
  useEffect(() => {
    if (!selectedId) return
    ;(async () => {
      const [h, opts] = await Promise.all([
        listItemHistory(selectedId),
        listItemOptions(selectedId),
      ])
      setHistory(h)
      setItemOptionIds(new Set(opts.map((o) => o.rate_book_option_id)))
    })()
  }, [selectedId])

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  )
  const selectedCategory = useMemo(
    () => (selectedItem ? categories.find((c) => c.id === selectedItem.category_id) || null : null),
    [categories, selectedItem]
  )

  const shopRate = org?.shop_rate ?? 0
  const buildup = useMemo(
    () => (selectedItem ? computeBuildup(selectedItem, shopRate) : null),
    [selectedItem, shopRate]
  )

  // Tree: categories → items, filtered by search.
  const filteredTree = useMemo(() => {
    const s = treeSearch.trim().toLowerCase()
    return categories.map((cat) => {
      const catItems = items.filter((it) => it.category_id === cat.id)
      const filteredItems = s
        ? catItems.filter((it) => it.name.toLowerCase().includes(s))
        : catItems
      const catMatches = s ? cat.name.toLowerCase().includes(s) : false
      const visible = catMatches || filteredItems.length > 0
      return { cat, items: catMatches ? catItems : filteredItems, visible, hasSearch: !!s }
    })
  }, [categories, items, treeSearch])

  const filteredOptions = useMemo(() => {
    const s = optionSearch.trim().toLowerCase()
    if (!s) return options
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(s) ||
        (o.notes || '').toLowerCase().includes(s) ||
        o.key.toLowerCase().includes(s)
    )
  }, [options, optionSearch])

  async function toggleOption(optId: string) {
    if (!selectedId) return
    const on = itemOptionIds.has(optId)
    if (on) {
      await detachOption(selectedId, optId)
      const next = new Set(itemOptionIds)
      next.delete(optId)
      setItemOptionIds(next)
    } else {
      await attachOption(selectedId, optId, false)
      const next = new Set(itemOptionIds)
      next.add(optId)
      setItemOptionIds(next)
    }
  }

  function toggleExpand(id: string) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Render

  if (!orgId) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Nav />
        <div className="p-8 text-sm text-[#6B7280]">Loading account…</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      <Nav />

      {/* Context strip */}
      <div className="px-6 py-2 text-[12px] flex items-center gap-3 bg-[#EFF6FF] border-b border-[#DBEAFE]">
        <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#DBEAFE] text-[#1E40AF]">
          Back-end
        </span>
        <span className="text-[#1E3A8A]">
          Prices live here and history gets written. Day-to-day pricing happens in projects — come back to audit, tune, or add items.
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setLaborSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#1E40AF] hover:bg-[#DBEAFE] transition-colors text-[11px] font-medium"
        >
          <Settings className="w-3.5 h-3.5" /> Shop rates
        </button>
      </div>

      {/* 3-pane grid */}
      <div className="flex-1 grid grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* LEFT — Tree */}
        <aside className="border-r border-[#E5E7EB] bg-[#FAFAFA] overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-[#FAFAFA] p-3 border-b border-[#E5E7EB]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
              Items
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#9CA3AF]" />
              <input
                className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                placeholder="Search items…"
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 p-2">
            {!loaded ? (
              <div className="text-xs text-[#9CA3AF] italic p-2">Loading rate book…</div>
            ) : filteredTree.every((n) => !n.visible) ? (
              <div className="text-xs text-[#9CA3AF] italic p-2">No matches.</div>
            ) : (
              filteredTree.map(({ cat, items: its, visible, hasSearch }) => {
                if (!visible) return null
                const open = expanded.has(cat.id) || hasSearch
                return (
                  <div key={cat.id} className="mb-0.5">
                    <button
                      onClick={() => toggleExpand(cat.id)}
                      className="w-full flex items-center gap-1 px-1.5 py-1 rounded text-[13px] text-[#374151] hover:bg-[#F3F4F6] transition-colors"
                    >
                      {open ? (
                        <ChevronDown className="w-3 h-3 text-[#9CA3AF]" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-[#9CA3AF]" />
                      )}
                      <span className="flex-1 text-left font-medium">{cat.name}</span>
                      <span className="text-[10px] text-[#9CA3AF]">{its.length}</span>
                    </button>
                    {open &&
                      its.map((it) => {
                        const isSel = it.id === selectedId
                        return (
                          <button
                            key={it.id}
                            onClick={() => setSelectedId(it.id)}
                            className={`w-full flex items-center gap-2 pl-7 pr-2 py-1 rounded text-[12.5px] text-left transition-colors ${
                              isSel ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'text-[#4B5563] hover:bg-[#F3F4F6]'
                            }`}
                          >
                            <span className="flex-1 truncate">{it.name}</span>
                            <ConfidencePill c={it.confidence} size="dot" />
                          </button>
                        )
                      })}
                  </div>
                )
              })
            )}
          </div>
          <div className="p-3 border-t border-[#E5E7EB] text-[11px] text-[#6B7280] leading-relaxed">
            <div className="font-semibold text-[#374151] mb-1">Trust badges</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5"><ConfidencePill c="well_tested" size="dot" /> well-tested</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="few_jobs" size="dot" /> few jobs</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="untested" size="dot" /> new</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="looking_weird" size="dot" /> looking weird</span>
            </div>
          </div>
        </aside>

        {/* MIDDLE — Detail */}
        <main className="overflow-y-auto">
          {!selectedItem ? (
            <div className="p-12 text-sm text-[#6B7280]">
              {items.length === 0
                ? 'Seeding starter library…'
                : 'Pick an item on the left to see its build-up.'}
            </div>
          ) : (
            <div className="p-8 max-w-3xl">
              {/* Breadcrumb + title */}
              <div className="text-[11px] text-[#9CA3AF] tracking-wide mb-1">
                {selectedCategory ? selectedCategory.name : 'Uncategorized'}
              </div>
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-[22px] font-semibold text-[#111]">{selectedItem.name}</h1>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#374151] hover:bg-[#F3F4F6] rounded-md transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    disabled
                    title="Clone — coming soon"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#9CA3AF] rounded-md cursor-not-allowed"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6B7280] mb-5">
                <span>
                  Used in <strong className="text-[#374151]">{selectedItem.confidence_job_count}</strong> jobs
                </span>
                <ConfidencePill c={selectedItem.confidence} />
                <span>
                  Last used:{' '}
                  {selectedItem.confidence_last_used_at
                    ? new Date(selectedItem.confidence_last_used_at).toLocaleDateString()
                    : 'never'}
                </span>
                <span className="ml-auto text-[11px] text-[#9CA3AF]">Unit · {selectedItem.unit.toUpperCase()}</span>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-[#E5E7EB] mb-5">
                {(['current', 'history', 'changes'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-2 text-[12.5px] border-b-2 -mb-px transition-colors ${
                      tab === t
                        ? 'border-[#2563EB] text-[#111] font-medium'
                        : 'border-transparent text-[#6B7280] hover:text-[#374151]'
                    }`}
                  >
                    {t === 'current' ? 'Current' : t === 'history' ? 'History' : 'Changes'}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              {tab === 'current' && buildup && (
                <CurrentTab item={selectedItem} buildup={buildup} />
              )}
              {tab === 'history' && <HistoryTab rows={history} />}
              {tab === 'changes' && (
                <div className="p-10 text-center text-[12px] text-[#9CA3AF] italic border border-dashed border-[#E5E7EB] rounded-lg">
                  Changes tab — upcoming edits that are staged but not yet live. Phase 10 fills this in.
                </div>
              )}
            </div>
          )}
        </main>

        {/* RIGHT — Options */}
        <aside className="border-l border-[#E5E7EB] bg-[#FAFAFA] overflow-y-auto flex flex-col">
          <div className="sticky top-0 bg-[#FAFAFA] p-3 border-b border-[#E5E7EB]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
              Options
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#9CA3AF]" />
              <input
                className="w-full pl-8 pr-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                placeholder="Search options…"
                value={optionSearch}
                onChange={(e) => setOptionSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 p-2 space-y-1.5">
            {filteredOptions.length === 0 ? (
              <div className="text-xs text-[#9CA3AF] italic p-2">No options defined.</div>
            ) : (
              filteredOptions.map((o) => {
                const on = itemOptionIds.has(o.id)
                return (
                  <button
                    key={o.id}
                    onClick={() => toggleOption(o.id)}
                    disabled={!selectedItem}
                    className={`w-full px-2.5 py-1.5 text-left rounded-md border transition-colors text-[12px] ${
                      on
                        ? 'bg-[#DBEAFE] border-[#93C5FD] text-[#1E40AF]'
                        : 'bg-white border-[#E5E7EB] hover:border-[#9CA3AF] text-[#374151]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{o.name}</span>
                      {on && <Tag className="w-3 h-3" />}
                    </div>
                    <div className="text-[10.5px] font-mono text-[#6B7280] mt-0.5">
                      {describeEffect(o)}
                    </div>
                  </button>
                )
              })
            )}
          </div>
          <div className="p-3 border-t border-[#E5E7EB] text-[11px] text-[#6B7280] leading-relaxed">
            <span className="font-semibold text-[#374151]">Two layers.</span> Back-end defines options.
            Project lines toggle them per line. Keep overriding a default → the suggestions loop proposes a move.
          </div>
        </aside>
      </div>

      {/* Edit modal */}
      {editOpen && selectedItem && (
        <EditItemModal
          item={selectedItem}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false)
            await refreshAll(orgId)
            const h = await listItemHistory(selectedItem.id)
            setHistory(h)
          }}
          changedBy={user?.id || null}
        />
      )}

      {/* Shop-rate modal */}
      {laborSettingsOpen && (
        <ShopRateModal
          orgId={orgId}
          initialRate={shopRate}
          onClose={() => setLaborSettingsOpen(false)}
          onSaved={() => {
            setLaborSettingsOpen(false)
            // Refresh — auth context picks up the new rate on next fetch.
            // For an immediate echo the user can navigate away and back;
            // a full walkthrough rerun is the "correct" recalibration.
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Current tab — price buildup (mirrors the mockup)

function CurrentTab({
  item,
  buildup,
}: {
  item: RateBookItemRow
  buildup: ReturnType<typeof computeBuildup>
}) {
  const [expandLabor, setExpandLabor] = useState(false)

  return (
    <div>
      {/* Buildup */}
      <div className="border border-[#E5E7EB] rounded-lg mb-4 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E7EB] bg-[#F9FAFB] text-[11px] font-semibold tracking-wider uppercase text-[#374151] flex items-center justify-between">
          <span>What's in this price</span>
          <span className="text-[10px] font-normal text-[#9CA3AF] normal-case tracking-normal">
            click labor to drill in
          </span>
        </div>
        <div className="divide-y divide-[#F3F4F6] font-mono text-[12.5px]">
          {/* Labor row */}
          <button
            onClick={() => setExpandLabor((v) => !v)}
            className="w-full grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center hover:bg-[#F9FAFB] transition-colors text-left"
          >
            <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Labor</span>
            <span className="text-[#374151]">
              {buildup.laborHours.toFixed(2)} hr total
              <span className="text-[#9CA3AF]"> · across 5 depts</span>
              <span className="ml-2 text-[10px] text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-1.5 py-0.5 rounded">
                {expandLabor ? '▾ hide' : '▸ show'} breakdown
              </span>
            </span>
            <span className="text-[#111] font-semibold">{fmt$(buildup.laborCost)}</span>
          </button>
          {expandLabor &&
            buildup.perDept
              .filter((d) => d.hours > 0)
              .map((d) => (
                <div
                  key={d.dept}
                  className="grid grid-cols-[90px_1fr_auto] gap-3 pl-8 pr-4 py-1.5 items-center text-[11.5px]"
                >
                  <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    {LABOR_DEPT_LABEL[d.dept]}
                  </span>
                  <span className="text-[#6B7280]">
                    {d.hours.toFixed(2)} hr × <span className="text-[#2563EB]">${d.rate}</span>/hr
                  </span>
                  <span className="text-[#6B7280]">{fmt$(d.cost)}</span>
                </div>
              ))}

          {/* Material row */}
          {item.material_mode === 'sheets' && buildup.materialCost > 0 && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material</span>
              <span className="text-[#374151]">
                {item.sheets_per_unit} sh × <span className="text-[#2563EB]">${item.sheet_cost}</span>
                {item.material_description && (
                  <span className="text-[#9CA3AF]"> · {item.material_description}</span>
                )}
              </span>
              <span className="text-[#111] font-semibold">{fmt$(buildup.materialCost)}</span>
            </div>
          )}
          {item.material_mode === 'linear' && buildup.materialCost > 0 && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material</span>
              <span className="text-[#374151]">
                flat <span className="text-[#2563EB]">${item.linear_cost}</span>/{item.unit}
                {item.material_description && (
                  <span className="text-[#9CA3AF]"> · {item.material_description}</span>
                )}
              </span>
              <span className="text-[#111] font-semibold">{fmt$(buildup.materialCost)}</span>
            </div>
          )}
          {item.material_mode === 'lump' && buildup.materialCost > 0 && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material</span>
              <span className="text-[#374151]">
                lump <span className="text-[#2563EB]">${item.lump_cost}</span>
                {item.material_description && (
                  <span className="text-[#9CA3AF]"> · {item.material_description}</span>
                )}
              </span>
              <span className="text-[#111] font-semibold">{fmt$(buildup.materialCost)}</span>
            </div>
          )}

          {/* Consumables */}
          {buildup.consumables > 0 && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Consumables</span>
              <span className="text-[#374151]">
                10% of material
                <span className="text-[#9CA3AF]"> · hinges, glue, fasteners, finish supplies</span>
              </span>
              <span className="text-[#111] font-semibold">{fmt$(buildup.consumables)}</span>
            </div>
          )}

          {/* Hardware */}
          {buildup.hardware > 0 && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Hardware</span>
              <span className="text-[#374151]">
                per {item.unit}
                {item.hardware_note && <span className="text-[#9CA3AF]"> · {item.hardware_note}</span>}
              </span>
              <span className="text-[#111] font-semibold">{fmt$(buildup.hardware)}</span>
            </div>
          )}

          {/* Total */}
          <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-3 items-baseline bg-[#F9FAFB]">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#111]">Total</span>
            <span />
            <span className="text-[18px] font-bold text-[#111]">
              {fmt$(buildup.total)}{' '}
              <span className="text-[12px] font-normal text-[#6B7280]">/ {item.unit}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// History tab

function HistoryTab({ rows }: { rows: RateBookItemHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="p-10 text-center text-[12px] text-[#9CA3AF] italic border border-dashed border-[#E5E7EB] rounded-lg">
        No edits yet. When you change this item, the deltas show up here.
      </div>
    )
  }
  return (
    <div className="border border-[#E5E7EB] rounded-lg divide-y divide-[#F3F4F6]">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[110px_1fr_auto] gap-3 px-4 py-3 text-[12px] items-start">
          <span className="text-[11px] font-mono text-[#6B7280]">
            {new Date(r.changed_at).toLocaleDateString()}
          </span>
          <div>
            <div className="text-[#111]">
              {Object.entries(r.field_changes).map(([k, v], i) => (
                <div key={i}>
                  <span className="text-[#6B7280]">{k}:</span>{' '}
                  <span className="line-through text-[#9CA3AF]">{String(v.from)}</span>{' '}
                  → <span className="text-[#111] font-medium">{String(v.to)}</span>
                </div>
              ))}
            </div>
            {r.reason && <div className="text-[11px] text-[#6B7280] mt-1">{r.reason}</div>}
          </div>
          <span className="text-[11px] text-[#2563EB]">scope: {r.apply_scope}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit modal

function EditItemModal({
  item,
  onClose,
  onSaved,
  changedBy,
}: {
  item: RateBookItemRow
  onClose: () => void
  onSaved: () => void
  changedBy: string | null
}) {
  const [draft, setDraft] = useState({
    name: item.name,
    unit: item.unit as Unit,
    material_mode: item.material_mode as MaterialMode,
    base_labor_hours_eng: item.base_labor_hours_eng,
    base_labor_hours_cnc: item.base_labor_hours_cnc,
    base_labor_hours_assembly: item.base_labor_hours_assembly,
    base_labor_hours_finish: item.base_labor_hours_finish,
    base_labor_hours_install: item.base_labor_hours_install,
    sheets_per_unit: item.sheets_per_unit,
    sheet_cost: item.sheet_cost,
    linear_cost: item.linear_cost,
    lump_cost: item.lump_cost,
    hardware_cost: item.hardware_cost,
    material_description: item.material_description || '',
    hardware_note: item.hardware_note || '',
    confidence: item.confidence as Confidence,
  })
  const [scope, setScope] = useState<'this' | 'category' | 'shop_wide'>('this')
  const [reason, setReason] = useState('Manual correction')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!reason.trim()) {
      alert('Reason is required.')
      return
    }
    setSaving(true)
    try {
      await updateItem(
        item.id,
        {
          ...draft,
          material_description: draft.material_description || null,
          hardware_note: draft.hardware_note || null,
        } as any,
        { scope, reason: reason.trim(), changedBy }
      )
      onSaved()
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-6">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[14px] font-semibold text-[#111]">Edit item</h2>
          <button onClick={onClose} className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* Name + unit + material mode */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" span={3}>
              <input
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Unit">
              <select
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.unit}
                onChange={(e) => setDraft({ ...draft, unit: e.target.value as Unit })}
              >
                <option value="lf">LF</option>
                <option value="each">EA</option>
                <option value="sf">SF</option>
                <option value="day">DAY</option>
                <option value="hr">HR</option>
                <option value="job">JOB</option>
              </select>
            </Field>
            <Field label="Material mode">
              <select
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.material_mode}
                onChange={(e) =>
                  setDraft({ ...draft, material_mode: e.target.value as MaterialMode })
                }
              >
                <option value="sheets">Sheets</option>
                <option value="linear">Linear $</option>
                <option value="lump">Lump sum</option>
                <option value="none">No material</option>
              </select>
            </Field>
            <Field label="Confidence">
              <select
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.confidence}
                onChange={(e) => setDraft({ ...draft, confidence: e.target.value as Confidence })}
              >
                <option value="untested">new / untested</option>
                <option value="few_jobs">few jobs</option>
                <option value="well_tested">well-tested</option>
                <option value="looking_weird">looking weird</option>
              </select>
            </Field>
          </div>

          {/* Per-dept hours */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
              Labor hours per {draft.unit.toUpperCase()}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {LABOR_DEPTS.map((d) => {
                const key = `base_labor_hours_${d}` as keyof typeof draft
                return (
                  <Field key={d} label={LABOR_DEPT_LABEL[d]}>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                      value={(draft[key] as number) || 0}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: Number(e.target.value) } as any)
                      }
                    />
                  </Field>
                )
              })}
            </div>
          </div>

          {/* Material fields (conditional on mode) */}
          {draft.material_mode === 'sheets' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Sheets / unit">
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.sheets_per_unit}
                  onChange={(e) => setDraft({ ...draft, sheets_per_unit: Number(e.target.value) })}
                />
              </Field>
              <Field label="$ / sheet">
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.sheet_cost}
                  onChange={(e) => setDraft({ ...draft, sheet_cost: Number(e.target.value) })}
                />
              </Field>
              <Field label="Material description">
                <input
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.material_description}
                  onChange={(e) => setDraft({ ...draft, material_description: e.target.value })}
                />
              </Field>
            </div>
          )}
          {draft.material_mode === 'linear' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`$ per ${draft.unit}`}>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.linear_cost}
                  onChange={(e) => setDraft({ ...draft, linear_cost: Number(e.target.value) })}
                />
              </Field>
              <Field label="Material description">
                <input
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.material_description}
                  onChange={(e) => setDraft({ ...draft, material_description: e.target.value })}
                />
              </Field>
            </div>
          )}
          {draft.material_mode === 'lump' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lump $">
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.lump_cost}
                  onChange={(e) => setDraft({ ...draft, lump_cost: Number(e.target.value) })}
                />
              </Field>
              <Field label="Material description">
                <input
                  className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                  value={draft.material_description}
                  onChange={(e) => setDraft({ ...draft, material_description: e.target.value })}
                />
              </Field>
            </div>
          )}

          {/* Hardware */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hardware $">
              <input
                type="number"
                step="0.01"
                className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.hardware_cost}
                onChange={(e) => setDraft({ ...draft, hardware_cost: Number(e.target.value) })}
              />
            </Field>
            <Field label="Hardware note">
              <input
                className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={draft.hardware_note}
                onChange={(e) => setDraft({ ...draft, hardware_note: e.target.value })}
              />
            </Field>
          </div>

          {/* Scope + reason */}
          <div className="border-t border-[#E5E7EB] pt-4 space-y-3">
            <Field label="Apply to">
              <select
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={scope}
                onChange={(e) => setScope(e.target.value as any)}
              >
                <option value="this">This item only</option>
                <option value="category">All items in this category</option>
                <option value="shop_wide">All items in the shop</option>
              </select>
            </Field>
            <Field label="Reason (required)">
              <select
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option>Manual correction</option>
                <option>Better data available</option>
                <option>Accepting a learning suggestion</option>
                <option>Vendor price change</option>
                <option>Shop process change</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-[12.5px] text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save change'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  span = 1,
}: {
  label: string
  children: React.ReactNode
  span?: number
}) {
  return (
    <label className="block" style={{ gridColumn: `span ${span} / span ${span}` }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
        {label}
      </div>
      {children}
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shop-rate modal

function ShopRateModal({
  orgId,
  initialRate,
  onClose,
  onSaved,
}: {
  orgId: string
  initialRate: number
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<number>(initialRate)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('orgs')
        .update({ shop_rate: Number(draft) || 0 })
        .eq('id', orgId)
      if (error) throw error
      onSaved()
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-6">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[14px] font-semibold text-[#111]">Shop rate</h2>
          <button onClick={onClose} className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-[#6B7280] leading-relaxed">
            Single blended rate — every line's labor cost is hours × this rate.
            For a first-principles recalibration (overhead, team comp, billable
            hours), re-run the shop rate walkthrough from onboarding.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[#9CA3AF] text-sm">$</span>
            <input
              type="number"
              step="0.5"
              min="0"
              className="flex-1 px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md font-mono tabular-nums"
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
            />
            <span className="text-[12px] text-[#9CA3AF]">/ hr</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 text-[12.5px] text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Option effect label

function describeEffect(o: RateBookOptionRow): string {
  const t = o.effect_type
  const v = o.effect_value
  const tgt = o.effect_target ? ` (${o.effect_target})` : ''
  if (t === 'hours_multiplier') return `×${v} hours${tgt}`
  if (t === 'rate_multiplier') return `×${v} rate${tgt}`
  if (t === 'material_multiplier') return `×${v} material${tgt}`
  if (t === 'flat_add') return `+$${v}/job${tgt}`
  if (t === 'per_unit_add') return `+$${v}/unit${tgt}`
  if (t === 'flag') return o.notes || 'tag only'
  return ''
}

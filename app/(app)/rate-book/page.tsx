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
import { PRODUCTS, type ProductKey } from '@/lib/products'
import {
  deleteSolidWoodComponent,
  formatThickness,
  loadSolidWoodComponents,
  quartersToInches,
  type SolidWoodComponent,
} from '@/lib/solid-wood'
import {
  listDoorTypeMaterialsForSolidWood,
  recalculateMaterialsForSolidWood,
} from '@/lib/door-types'
import SolidWoodWalkthrough from '@/components/walkthroughs/SolidWoodWalkthrough'
import { useConfirm } from '@/components/confirm-dialog'

// Upper / Full are multipliers on Base cabinet, not standalone rate
// book rows. Surface them in the sidebar as derived read-only entries
// so operators see all three cabinet types in one place. Each derived
// row uses a synthetic id with this prefix so selectedId branches can
// detect it.
const DERIVED_ID_PREFIX = 'derived:'
const DERIVED_PRODUCTS: { key: 'upper' | 'full'; id: string }[] = [
  { key: 'upper', id: `${DERIVED_ID_PREFIX}upper` },
  { key: 'full', id: `${DERIVED_ID_PREFIX}full` },
]
function isDerivedId(id: string | null): boolean {
  return !!id && id.startsWith(DERIVED_ID_PREFIX)
}
function derivedKey(id: string): 'upper' | 'full' | null {
  if (id === `${DERIVED_ID_PREFIX}upper`) return 'upper'
  if (id === `${DERIVED_ID_PREFIX}full`) return 'full'
  return null
}

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
  const { confirm } = useConfirm()
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

  // Solid-wood components live in their own table outside
  // rate_book_categories. Surfaced as a synthetic sidebar group below
  // the category tree. selectedSolidWoodId steers the middle pane: when
  // set, it overrides selectedId's detail render.
  const [solidWoodRows, setSolidWoodRows] = useState<SolidWoodComponent[]>([])
  const [solidWoodExpanded, setSolidWoodExpanded] = useState(true)
  const [selectedSolidWoodId, setSelectedSolidWoodId] = useState<string | null>(null)
  // Walkthrough overlay: 'new' for create, an id string for edit, null closed.
  const [solidWoodWt, setSolidWoodWt] = useState<'new' | string | null>(null)

  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      await refreshAll(orgId)
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  async function refreshAll(id: string) {
    const [c, i, o, sw] = await Promise.all([
      listCategories(id), listItems(id), listOptions(id),
      loadSolidWoodComponents(id),
    ])
    setCategories(c)
    setItems(i)
    setOptions(o)
    setSolidWoodRows(sw)
    // Auto-expand every category and select first item on cold boot.
    if (expanded.size === 0) {
      setExpanded(new Set(c.map((x) => x.id)))
    }
    if (!selectedId && !selectedSolidWoodId && i.length > 0) {
      setSelectedId(i[0].id)
    }
  }

  // Load per-item side data whenever selection changes. Skip the lookup
  // for derived ids — they don't have rows in approval_items / options.
  useEffect(() => {
    if (!selectedId) return
    if (isDerivedId(selectedId)) {
      setHistory([])
      setItemOptionIds(new Set())
      return
    }
    ;(async () => {
      const [h, opts] = await Promise.all([
        listItemHistory(selectedId),
        listItemOptions(selectedId),
      ])
      setHistory(h)
      setItemOptionIds(new Set(opts.map((o) => o.rate_book_option_id)))
    })()
  }, [selectedId])

  // Resolve selectedItem either to a real row or, for the synthetic
  // upper/full ids, to a thin derived row built from Base. The detail
  // pane branches on isDerivedId(selectedId) for read-only render.
  const selectedItem = useMemo(() => {
    if (!selectedId) return null
    if (isDerivedId(selectedId)) {
      const cabinetCat = categories.find((c) => c.item_type === 'cabinet_style')
      const baseRow = items.find(
        (it) => it.category_id === cabinetCat?.id && it.name === 'Base cabinet',
      )
      const key = derivedKey(selectedId)
      if (!baseRow || !key || !cabinetCat) return null
      return {
        ...baseRow,
        id: selectedId,
        name: PRODUCTS[key].label,
        category_id: cabinetCat.id,
      } as RateBookItemRow
    }
    return items.find((i) => i.id === selectedId) || null
  }, [items, categories, selectedId])
  const selectedCategory = useMemo(
    () => (selectedItem ? categories.find((c) => c.id === selectedItem.category_id) || null : null),
    [categories, selectedItem]
  )
  const selectedIsDerived = isDerivedId(selectedId)

  const shopRate = org?.shop_rate ?? 0
  const buildup = useMemo(
    () => (selectedItem ? computeBuildup(selectedItem, shopRate) : null),
    [selectedItem, shopRate]
  )

  // Tree: categories → items, filtered by search.
  // For cabinet_style categories, we also append derived Upper / Full
  // rows synthesized from products.ts so all three cabinet types show
  // up in one list. The derived rows are read-only — clicking one
  // surfaces the multiplier explanation in the detail view.
  const filteredTree = useMemo(() => {
    const s = treeSearch.trim().toLowerCase()
    return categories.map((cat) => {
      const catItems = items.filter((it) => it.category_id === cat.id)
      let allItems: RateBookItemRow[] = catItems
      if (cat.item_type === 'cabinet_style') {
        const baseRow = catItems.find((it) => it.name === 'Base cabinet')
        if (baseRow) {
          // Synthesize a thin derived row per upper/full; only the
          // fields the sidebar reads (id, name, confidence, hours)
          // need to be present and meaningful.
          const derivedRows: RateBookItemRow[] = DERIVED_PRODUCTS.map(
            ({ key, id }) =>
              ({
                ...baseRow,
                id,
                name: PRODUCTS[key].label,
                category_id: cat.id,
              }) as RateBookItemRow,
          )
          allItems = [...catItems, ...derivedRows]
        }
      }
      const filteredItems = s
        ? allItems.filter((it) => it.name.toLowerCase().includes(s))
        : allItems
      const catMatches = s ? cat.name.toLowerCase().includes(s) : false
      const visible = catMatches || filteredItems.length > 0
      return { cat, items: catMatches ? allItems : filteredItems, visible, hasSearch: !!s }
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
                        // "Uncalibrated" = every per-dept hour is zero.
                        // Pre-seeded finish combos land in this state
                        // until FinishWalkthrough writes real numbers.
                        // Surface as a small gray pill so an operator
                        // can tell intentional zero (custom freeform
                        // line) from unfinished setup.
                        const totalHours =
                          (Number(it.base_labor_hours_eng) || 0) +
                          (Number(it.base_labor_hours_cnc) || 0) +
                          (Number(it.base_labor_hours_assembly) || 0) +
                          (Number(it.base_labor_hours_finish) || 0) +
                          (Number(it.base_labor_hours_install) || 0)
                        const uncalibrated = totalHours === 0
                        return (
                          <button
                            key={it.id}
                            onClick={() => setSelectedId(it.id)}
                            className={`w-full flex items-center gap-2 pl-7 pr-2 py-1 rounded text-[12.5px] text-left transition-colors ${
                              isSel ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'text-[#4B5563] hover:bg-[#F3F4F6]'
                            }`}
                          >
                            <span className="flex-1 truncate">{it.name}</span>
                            {uncalibrated && (
                              <span
                                title="No labor hours yet — calibrate via the matching walkthrough"
                                className="text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-[#F3F4F6] text-[#9CA3AF] border border-[#E5E7EB]"
                              >
                                ø
                              </span>
                            )}
                            <ConfidencePill c={it.confidence} size="dot" />
                          </button>
                        )
                      })}
                  </div>
                )
              })
            )}
          </div>
          {/* Solid wood — synthetic sidebar group. Lives outside
              rate_book_categories (own table), so it gets its own header
              with "+ Add" affordance below the standard tree. */}
          <div className="px-2 pb-2">
            <div className="flex items-center gap-1 px-1.5 py-1 text-[13px] text-[#374151]">
              <button
                onClick={() => setSolidWoodExpanded((v) => !v)}
                className="inline-flex items-center gap-1 flex-1 text-left rounded hover:bg-[#F3F4F6] px-1 py-0.5"
              >
                {solidWoodExpanded ? (
                  <ChevronDown className="w-3 h-3 text-[#9CA3AF]" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-[#9CA3AF]" />
                )}
                <span className="font-medium">Solid wood</span>
                <span className="ml-auto text-[10px] text-[#9CA3AF]">
                  {solidWoodRows.length}
                </span>
              </button>
              <button
                onClick={() => setSolidWoodWt('new')}
                title="Add solid wood"
                className="text-[11px] text-[#2563EB] hover:text-[#1D4ED8] px-1.5"
              >
                + Add
              </button>
            </div>
            {solidWoodExpanded && (
              <div className="space-y-0.5 mt-0.5">
                {solidWoodRows.length === 0 ? (
                  <div className="pl-7 pr-2 py-1 text-[11.5px] text-[#9CA3AF] italic">
                    No solid wood yet.
                  </div>
                ) : (
                  solidWoodRows.map((sw) => {
                    const isSel = sw.id === selectedSolidWoodId
                    return (
                      <button
                        key={sw.id}
                        onClick={() => {
                          setSelectedSolidWoodId(sw.id)
                          setSelectedId(null)
                        }}
                        className={`w-full flex items-center gap-2 pl-7 pr-2 py-1 rounded text-[12.5px] text-left transition-colors ${
                          isSel
                            ? 'bg-[#DBEAFE] text-[#1E40AF]'
                            : 'text-[#4B5563] hover:bg-[#F3F4F6]'
                        }`}
                      >
                        <span className="flex-1 truncate">{sw.name}</span>
                        <span className="text-[10px] text-[#9CA3AF] font-mono tabular-nums">
                          ${sw.cost_per_bdft}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[#E5E7EB] text-[11px] text-[#6B7280] leading-relaxed">
            <div className="font-semibold text-[#374151] mb-1">Trust badges</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5"><ConfidencePill c="well_tested" size="dot" /> well-tested</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="few_jobs" size="dot" /> few jobs</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="untested" size="dot" /> new</span>
              <span className="flex items-center gap-1.5"><ConfidencePill c="looking_weird" size="dot" /> looking weird</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[8.5px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-[#F3F4F6] text-[#9CA3AF] border border-[#E5E7EB]">
                  ø
                </span>
                uncalibrated
              </span>
            </div>
          </div>
        </aside>

        {/* MIDDLE — Detail */}
        <main className="overflow-y-auto">
          {selectedSolidWoodId ? (
            <SolidWoodDetail
              row={solidWoodRows.find((r) => r.id === selectedSolidWoodId) ?? null}
              onEdit={(id) => setSolidWoodWt(id)}
              onDelete={async (row) => {
                const ok = await confirm({
                  title: 'Delete solid wood component?',
                  message: `Delete "${row.name}"? Removes the rate-book entry. Lines that already reference it stay priced from their saved snapshot.`,
                  confirmLabel: 'Delete',
                  variant: 'danger',
                })
                if (!ok) return
                await deleteSolidWoodComponent(row.id)
                setSelectedSolidWoodId(null)
                if (orgId) await refreshAll(orgId)
              }}
            />
          ) : !selectedItem ? (
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
                  {!selectedIsDerived && (
                    <button
                      onClick={() => setEditOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#374151] hover:bg-[#F3F4F6] rounded-md transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  <button
                    disabled
                    title="Clone — coming soon"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#9CA3AF] rounded-md cursor-not-allowed"
                  >
                    <Copy className="w-3.5 h-3.5" /> Clone
                  </button>
                </div>
              </div>

              {/* Derived-item explainer. Upper/Full are multipliers
                  on Base — the rate book row doesn't exist for them.
                  Show what the multiplier IS and point at Base for
                  recalibration. */}
              {selectedIsDerived && (() => {
                const key = derivedKey(selectedId!) as 'upper' | 'full'
                const product = PRODUCTS[key]
                return (
                  <div className="mb-5 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-[12.5px] text-[#374151] space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]">
                        Read-only
                      </span>
                      <span className="text-[#6B7280]">
                        Multiplier of Base cabinet
                      </span>
                    </div>
                    <p className="leading-relaxed text-[12px] text-[#374151]">
                      {product.label} shares Base cabinet's per-LF carcass
                      labor + material. The composer applies a face-material
                      multiplier (
                      <span className="font-mono">
                        {(product.sheetsPerLfFace * 12).toFixed(2)}× sheets/LF
                      </span>
                      ) and a door-labor multiplier (
                      <span className="font-mono">
                        {product.doorLaborMultiplier.toFixed(1)}×
                      </span>
                      ) at line compute time.
                    </p>
                    <p className="leading-relaxed text-[11.5px] text-[#9CA3AF] italic">
                      To recalibrate, edit the Base cabinet row above or
                      re-run the BaseCabinet walkthrough. Door labor lives
                      on the Slab door style row and the DoorStyle
                      walkthrough.
                    </p>
                  </div>
                )
              })()}

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
          // The item's category drives field-relevance gating in the
          // modal (hardware $ only for cabinet_style; etc).
          categoryItemType={selectedCategory?.item_type ?? null}
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

      {/* Solid wood walkthrough — single overlay drives both new and edit. */}
      {solidWoodWt && orgId && (
        <SolidWoodWalkthrough
          orgId={orgId}
          existingId={solidWoodWt === 'new' ? null : solidWoodWt}
          onCancel={() => setSolidWoodWt(null)}
          onComplete={async (id) => {
            setSolidWoodWt(null)
            await refreshAll(orgId)
            setSelectedSolidWoodId(id)
            setSelectedId(null)
          }}
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
          {/* Labor row. Hours read per-unit (e.g. "0.50 hr/lf") and the
              dept count reflects only depts with non-zero hours — the
              old "across 5 depts" copy was confusing when a row only
              touched 2 or 3 depts. */}
          {(() => {
            const activeDepts = buildup.perDept.filter((d) => d.hours > 0).length
            return (
              <button
                onClick={() => setExpandLabor((v) => !v)}
                className="w-full grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center hover:bg-[#F9FAFB] transition-colors text-left"
              >
                <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Labor</span>
                <span className="text-[#374151]">
                  {buildup.laborHours.toFixed(2)} hr/{item.unit}
                  {activeDepts > 0 && (
                    <span className="text-[#9CA3AF]">
                      {' · '}
                      across {activeDepts} dept{activeDepts === 1 ? '' : 's'}
                    </span>
                  )}
                  <span className="ml-2 text-[10px] text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-1.5 py-0.5 rounded">
                    {expandLabor ? '▾ hide' : '▸ show'} breakdown
                  </span>
                </span>
                <span className="text-[#111] font-semibold">{fmt$(buildup.laborCost)}</span>
              </button>
            )
          })()}
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
          {item.material_mode === 'none' && (
            <div className="grid grid-cols-[90px_1fr_auto] gap-3 px-4 py-2.5 items-center">
              <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Material</span>
              <span className="text-[#9CA3AF] italic text-[11.5px] leading-relaxed">
                Material picked per-line. Calibrate door labor via the door
                style walkthrough.
              </span>
              <span className="text-[#9CA3AF]">—</span>
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

// System items are seeded by walkthroughs (BaseCabinetWalkthrough,
// DoorStyleWalkthrough, FinishWalkthrough). Their name + unit are
// canonical lookups elsewhere — renaming them would orphan the rows
// the composer math joins to. The fields lock; the rest of the row
// stays editable so an operator can still tune labor / material costs.
const SYSTEM_ITEM_NAMES = new Set([
  'Base cabinet',
  'Slab',
])

/**
 * Field-relevance gate. Returns false → render the input disabled and
 * the label dimmed. Lives outside the component so consumers can pass
 * a single source of truth: the item + its category type.
 */
function isFieldRelevant(
  field:
    | 'name'
    | 'unit'
    | 'sheets_per_unit'
    | 'sheet_cost'
    | 'linear_cost'
    | 'lump_cost'
    | 'hardware_cost'
    | 'hardware_note'
    | 'material_mode',
  item: { name: string; material_mode: MaterialMode },
  categoryItemType: string | null,
): boolean {
  const isSystem = SYSTEM_ITEM_NAMES.has(item.name)
  if (field === 'name' || field === 'unit') return !isSystem
  if (field === 'sheets_per_unit' || field === 'sheet_cost') {
    return item.material_mode === 'sheets'
  }
  if (field === 'linear_cost') return item.material_mode === 'linear'
  if (field === 'lump_cost') return item.material_mode === 'lump'
  if (field === 'hardware_cost' || field === 'hardware_note') {
    return categoryItemType === 'cabinet_style'
  }
  // material_mode is always editable; the operator may need to switch
  // a freshly-imported row to the right mode.
  return true
}

function EditItemModal({
  item,
  categoryItemType,
  onClose,
  onSaved,
  changedBy,
}: {
  item: RateBookItemRow
  categoryItemType: string | null
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

  // Cache the gate per render so JSX reads cleanly.
  const itemForGate = { name: item.name, material_mode: draft.material_mode }
  const canEditName = isFieldRelevant('name', itemForGate, categoryItemType)
  const canEditUnit = isFieldRelevant('unit', itemForGate, categoryItemType)
  const canEditSheets = isFieldRelevant('sheets_per_unit', itemForGate, categoryItemType)
  const canEditSheetCost = isFieldRelevant('sheet_cost', itemForGate, categoryItemType)
  const canEditLinear = isFieldRelevant('linear_cost', itemForGate, categoryItemType)
  const canEditLump = isFieldRelevant('lump_cost', itemForGate, categoryItemType)
  const canEditHardware = isFieldRelevant('hardware_cost', itemForGate, categoryItemType)
  const isSystemItem = SYSTEM_ITEM_NAMES.has(item.name)

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-6">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E7EB]">
          <h2 className="text-[14px] font-semibold text-[#111] inline-flex items-center gap-2">
            Edit item
            {isSystemItem && (
              <span
                title="System item — name + unit are referenced by the composer's slot lookups; calibrate via the matching walkthrough"
                className="text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]"
              >
                System
              </span>
            )}
          </h2>
          <button onClick={onClose} className="p-1 text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {/* Name + unit + material mode */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name" span={3}>
              <input
                className={`w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                  canEditName ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                }`}
                value={draft.name}
                disabled={!canEditName}
                title={canEditName ? '' : 'Locked — system item name is referenced by composer math'}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Unit">
              <select
                className={`w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                  canEditUnit ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                }`}
                value={draft.unit}
                disabled={!canEditUnit}
                title={canEditUnit ? '' : 'Locked — system item unit is referenced by composer math'}
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

          {/* Per-dept hours. Header makes the per-unit dimension
              explicit (e.g. "Labor hours / LF") so a 0.50 number isn't
              misread as an absolute total. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
              Labor hours / {draft.unit}
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

          {/* Material fields (conditional on mode). Label dimension is
              explicit ("Sheets per LF" / "Sheets per each") so the
              operator doesn't have to guess what the input means. */}
          {draft.material_mode === 'sheets' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label={`Sheets per ${draft.unit}`}>
                <input
                  type="number"
                  step="0.01"
                  className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                    canEditSheets ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                  }`}
                  value={draft.sheets_per_unit}
                  disabled={!canEditSheets}
                  onChange={(e) => setDraft({ ...draft, sheets_per_unit: Number(e.target.value) })}
                />
              </Field>
              <Field label="$ / sheet">
                <input
                  type="number"
                  step="0.01"
                  className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                    canEditSheetCost ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                  }`}
                  value={draft.sheet_cost}
                  disabled={!canEditSheetCost}
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
                  className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                    canEditLinear ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                  }`}
                  value={draft.linear_cost}
                  disabled={!canEditLinear}
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
                  className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                    canEditLump ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                  }`}
                  value={draft.lump_cost}
                  disabled={!canEditLump}
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

          {/* Hardware. Only meaningful for cabinet_style items — door
              and finish rows don't carry hardware costs. Disabled for
              other category types so the operator doesn't accidentally
              add a $ that won't be picked up by composer math. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hardware $">
              <input
                type="number"
                step="0.01"
                className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                  canEditHardware ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                }`}
                value={draft.hardware_cost}
                disabled={!canEditHardware}
                title={canEditHardware ? '' : 'Hardware $ only applies to cabinet items.'}
                onChange={(e) => setDraft({ ...draft, hardware_cost: Number(e.target.value) })}
              />
            </Field>
            <Field label="Hardware note">
              <input
                className={`w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md ${
                  canEditHardware ? '' : 'bg-[#F9FAFB] text-[#9CA3AF] cursor-not-allowed'
                }`}
                value={draft.hardware_note}
                disabled={!canEditHardware}
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

// ── Solid wood detail panel ───────────────────────────────────────────────

function SolidWoodDetail({
  row,
  onEdit,
  onDelete,
}: {
  row: SolidWoodComponent | null
  onEdit: (id: string) => void
  onDelete: (row: SolidWoodComponent) => void | Promise<void>
}) {
  const [linkedCount, setLinkedCount] = useState<number | null>(null)
  const [recalcing, setRecalcing] = useState(false)
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!row) {
      setLinkedCount(null)
      setRecalcMsg(null)
      return
    }
    let cancelled = false
    setRecalcMsg(null)
    ;(async () => {
      const mats = await listDoorTypeMaterialsForSolidWood(row.id)
      if (!cancelled) setLinkedCount(mats.length)
    })()
    return () => {
      cancelled = true
    }
  }, [row?.id])

  if (!row) {
    return (
      <div className="p-12 text-sm text-[#6B7280]">
        Solid wood component not found.
      </div>
    )
  }
  const inches = quartersToInches(row.thickness_quarters)

  async function handleRecalc() {
    if (!row || recalcing) return
    setRecalcing(true)
    setRecalcMsg(null)
    try {
      const touched = await recalculateMaterialsForSolidWood(row.id)
      setRecalcMsg(
        touched === 1
          ? '1 door material recalculated.'
          : `${touched} door materials recalculated.`,
      )
    } catch (e) {
      setRecalcMsg(
        e instanceof Error ? e.message : 'Recalculation failed.',
      )
    } finally {
      setRecalcing(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="text-[11px] text-[#9CA3AF] tracking-wide mb-1">Solid wood</div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[22px] font-semibold text-[#111]">{row.name}</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(row.id)}
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
          <button
            onClick={() => onDelete(row)}
            title="Delete"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <DetailRow label="Species" value={row.species} />
        <DetailRow
          label="Thickness"
          value={
            <span title={`${inches.toFixed(2).replace(/\.?0+$/, '')} in`}>
              {formatThickness(row.thickness_quarters)}
            </span>
          }
          mono
        />
        <DetailRow
          label="Cost per BDFT"
          value={`$${row.cost_per_bdft.toFixed(2).replace(/\.?0+$/, '')}`}
          mono
        />
        <DetailRow
          label="Waste %"
          value={`${row.waste_pct}%`}
          mono
        />
        {row.notes && <DetailRow label="Notes" value={row.notes} />}
      </div>

      {linkedCount != null && linkedCount > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
          <div className="text-[12.5px] text-[#374151]">
            <span className="font-medium">
              {linkedCount} door material{linkedCount === 1 ? '' : 's'}
            </span>{' '}
            <span className="text-[#6B7280]">
              {linkedCount === 1 ? 'uses' : 'use'} this stock.
            </span>{' '}
            <span className="text-[#9CA3AF]">
              After editing cost or waste, recalculate to push the new $/door.
            </span>
          </div>
          <button
            onClick={handleRecalc}
            disabled={recalcing}
            className="shrink-0 inline-flex items-center px-3 py-1.5 text-[12px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recalcing ? 'Recalculating…' : 'Recalculate all'}
          </button>
        </div>
      )}
      {recalcMsg && (
        <div className="mt-2 text-[11.5px] text-[#059669]">{recalcMsg}</div>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-[#F3F4F6] last:border-b-0">
      <div className="text-[11.5px] uppercase tracking-wider text-[#9CA3AF]">
        {label}
      </div>
      <div
        className={
          'text-[13px] text-[#111] text-right ' +
          (mono ? 'font-mono tabular-nums' : '')
        }
      >
        {value}
      </div>
    </div>
  )
}

'use client'

// Rate Book — Pro-tier pricing library.
// Three columns: category tree (left), rate editor (middle), confidence panel (right).
//
// Categories are first-class. Labor rates and material pricing rows belong to a
// category (or live uncategorized). Categories carry confidence metadata — job
// count + last used — so you can see which parts of your rate book are battle-tested.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import {
  getCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  getLaborRates,
  createLaborRate,
  updateLaborRate,
  archiveLaborRate,
  getMaterialPricing,
  createMaterialPricing,
  updateMaterialPricing,
  archiveMaterialPricing,
  confidenceLabel,
} from '@/lib/rate-book'
import type {
  RateBookCategory,
  RateBookItemType,
  LaborRate,
  MaterialPricing,
} from '@/lib/types'
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Search,
  TrendingUp,
  Clock,
  Package,
  Wrench,
  DoorOpen,
  Box,
  LayoutGrid,
  Sparkles,
} from 'lucide-react'

// ── Item type metadata ──

const ITEM_TYPES: { type: RateBookItemType; label: string; icon: any }[] = [
  { type: 'door_style', label: 'Door Styles', icon: DoorOpen },
  { type: 'drawer_style', label: 'Drawer Styles', icon: Box },
  { type: 'cabinet_style', label: 'Cabinet Styles', icon: LayoutGrid },
  { type: 'install_style', label: 'Install Styles', icon: Wrench },
  { type: 'hardware', label: 'Hardware', icon: Sparkles },
  { type: 'finish', label: 'Finishes', icon: Package },
  { type: 'custom', label: 'Custom', icon: Plus },
]

// ── Confidence badge ──

function ConfidenceBadge({ jobCount, lastUsed }: { jobCount: number; lastUsed: string | null }) {
  const level = confidenceLabel(jobCount, lastUsed)
  const map = {
    new:      { label: 'New',      cls: 'bg-[#F3F4F6] text-[#6B7280]' },
    emerging: { label: 'Emerging', cls: 'bg-[#FEF3C7] text-[#92400E]' },
    reliable: { label: 'Reliable', cls: 'bg-[#D1FAE5] text-[#065F46]' },
    stale:    { label: 'Stale',    cls: 'bg-[#FEE2E2] text-[#991B1B]' },
  }[level]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${map.cls}`}>
      {map.label}
    </span>
  )
}

// ── Inline number input ──

function NumField({ value, onChange, placeholder, className = '' }: {
  value: number | null
  onChange: (n: number | null) => void
  placeholder?: string
  className?: string
}) {
  const [raw, setRaw] = useState(value == null ? '' : String(value))
  useEffect(() => { setRaw(value == null ? '' : String(value)) }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        const n = raw === '' ? null : Number(raw)
        onChange(isNaN(n as number) ? null : n)
      }}
      className={`w-24 text-right px-2 py-1.5 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors ${className}`}
    />
  )
}

function TextField({ value, onChange, placeholder, className = '' }: {
  value: string | null
  onChange: (s: string) => void
  placeholder?: string
  className?: string
}) {
  const [raw, setRaw] = useState(value || '')
  useEffect(() => { setRaw(value || '') }, [value])
  return (
    <input
      type="text"
      value={raw}
      placeholder={placeholder}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => onChange(raw)}
      className={`px-2 py-1.5 text-sm bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors ${className}`}
    />
  )
}

// ── Page ──

export default function RateBookPage() {
  return (
    <PlanGate requires="rate-book">
      <RateBookInner />
    </PlanGate>
  )
}

function RateBookInner() {
  const { org } = useAuth()
  const orgId = org?.id

  const [categories, setCategories] = useState<RateBookCategory[]>([])
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null)
  const [expandedTypes, setExpandedTypes] = useState<Set<RateBookItemType>>(
    new Set<RateBookItemType>(['door_style', 'drawer_style', 'cabinet_style'])
  )

  const [laborRates, setLaborRates] = useState<LaborRate[]>([])
  const [materials, setMaterials] = useState<MaterialPricing[]>([])
  const [searchQ, setSearchQ] = useState('')
  const [loading, setLoading] = useState(true)

  // ── Load categories ──
  const loadCategories = useCallback(async () => {
    if (!orgId) return
    const cats = await getCategories(orgId)
    setCategories(cats)
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    loadCategories().finally(() => setLoading(false))
  }, [orgId, loadCategories])

  // ── Load rates for selected category ──
  const loadRatesForCategory = useCallback(async (catId: string | null) => {
    if (!orgId) return
    const [labor, mats] = await Promise.all([
      getLaborRates(orgId, catId),
      getMaterialPricing(orgId, catId),
    ])
    setLaborRates(labor)
    setMaterials(mats)
  }, [orgId])

  useEffect(() => {
    if (selectedCatId === null) {
      setLaborRates([])
      setMaterials([])
      return
    }
    loadRatesForCategory(selectedCatId)
  }, [selectedCatId, loadRatesForCategory])

  // ── Group categories by item_type ──
  const categoriesByType = useMemo(() => {
    const by = new Map<RateBookItemType, RateBookCategory[]>()
    for (const c of categories) {
      if (searchQ && !c.name.toLowerCase().includes(searchQ.toLowerCase())) continue
      const arr = by.get(c.item_type) || []
      arr.push(c)
      by.set(c.item_type, arr)
    }
    return by
  }, [categories, searchQ])

  const selectedCat = categories.find(c => c.id === selectedCatId) || null

  // ── Category operations ──

  async function handleCreateCategory(itemType: RateBookItemType) {
    if (!orgId) return
    const name = prompt(`Name for new ${ITEM_TYPES.find(t => t.type === itemType)?.label.replace(/s$/, '')}?`)
    if (!name?.trim()) return
    const newCat = await createCategory({
      org_id: orgId,
      name: name.trim(),
      item_type: itemType,
      display_order: (categoriesByType.get(itemType)?.length || 0),
      active: true,
      confidence_job_count: 0,
    })
    await loadCategories()
    setSelectedCatId(newCat.id)
    setExpandedTypes(prev => new Set(prev).add(itemType))
  }

  async function handleRenameCategory(cat: RateBookCategory) {
    const name = prompt('Rename category:', cat.name)
    if (!name?.trim() || name === cat.name) return
    await updateCategory(cat.id, { name: name.trim() })
    await loadCategories()
  }

  async function handleArchiveCategory(cat: RateBookCategory) {
    if (!confirm(`Archive "${cat.name}"? Rates linked to it will remain (uncategorized).`)) return
    await archiveCategory(cat.id)
    if (selectedCatId === cat.id) setSelectedCatId(null)
    await loadCategories()
  }

  // ── Labor rate operations ──

  async function handleAddLabor() {
    if (!orgId) return
    const row = await createLaborRate({
      org_id: orgId,
      category_id: selectedCatId,
      name: 'New labor rate',
      unit: 'lf',
      hours_per_unit: 0,
      install_hours_per_unit: 0,
      active: true,
      confidence_job_count: 0,
    })
    setLaborRates(prev => [...prev, row])
  }

  async function handleUpdateLabor(id: string, patch: Partial<LaborRate>) {
    const updated = await updateLaborRate(id, patch)
    setLaborRates(prev => prev.map(r => r.id === id ? updated : r))
  }

  async function handleDeleteLabor(id: string) {
    if (!confirm('Archive this labor rate?')) return
    await archiveLaborRate(id)
    setLaborRates(prev => prev.filter(r => r.id !== id))
  }

  // ── Material operations ──

  async function handleAddMaterial() {
    if (!orgId) return
    const row = await createMaterialPricing({
      org_id: orgId,
      category_id: selectedCatId,
      name: 'New material',
      unit: 'sheet',
      cost_per_unit: 0,
      active: true,
    })
    setMaterials(prev => [...prev, row])
  }

  async function handleUpdateMaterial(id: string, patch: Partial<MaterialPricing>) {
    const updated = await updateMaterialPricing(id, patch)
    setMaterials(prev => prev.map(r => r.id === id ? updated : r))
  }

  async function handleDeleteMaterial(id: string) {
    if (!confirm('Archive this material?')) return
    await archiveMaterialPricing(id)
    setMaterials(prev => prev.filter(r => r.id !== id))
  }

  function toggleTypeExpanded(type: RateBookItemType) {
    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // ── Render ──

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col">
      <Nav />

      {/* Header */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#111]">Rate Book</h1>
            <p className="text-sm text-[#6B7280] mt-0.5">
              Your pricing library — categories, labor rates, and material costs
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/settings/rate-book/items"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] border border-[#DBEAFE] transition-colors"
              title="Manage the first-class items that the subproject editor picks from"
            >
              Items →
            </a>
            <div className="flex items-center gap-2 text-xs text-[#6B7280]">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>
                {categories.length} {categories.length === 1 ? 'category' : 'categories'}
                {' · '}
                {laborRates.length + materials.length} rates visible
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="flex-1 grid grid-cols-[280px_1fr_300px] overflow-hidden">

        {/* ── LEFT: Category tree ── */}
        <div className="border-r border-[#E5E7EB] bg-white overflow-y-auto">
          <div className="px-4 pt-4 pb-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search categories..."
                className="w-full pl-8 pr-2.5 py-1.5 text-sm bg-[#F9FAFB] border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="px-2 pb-4">
            {ITEM_TYPES.map(({ type, label, icon: Icon }) => {
              const cats = categoriesByType.get(type) || []
              const isExpanded = expandedTypes.has(type)
              return (
                <div key={type} className="mb-1">
                  <div className="flex items-center group">
                    <button
                      onClick={() => toggleTypeExpanded(type)}
                      className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-[#F3F4F6] transition-colors text-left"
                    >
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3 text-[#9CA3AF]" />
                        : <ChevronRight className="w-3 h-3 text-[#9CA3AF]" />}
                      <Icon className="w-3.5 h-3.5 text-[#6B7280]" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] flex-1">
                        {label}
                      </span>
                      <span className="text-[10px] text-[#9CA3AF] tabular-nums">
                        {cats.length}
                      </span>
                    </button>
                    <button
                      onClick={() => handleCreateCategory(type)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#F3F4F6] text-[#9CA3AF] hover:text-[#111] transition-all"
                      title={`Add ${label.replace(/s$/, '')}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-4 mt-0.5">
                      {cats.length === 0 && (
                        <div className="px-2 py-1 text-[11px] italic text-[#9CA3AF]">
                          No {label.toLowerCase()} yet
                        </div>
                      )}
                      {cats.map(cat => (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCatId(cat.id)}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                            selectedCatId === cat.id
                              ? 'bg-[#EFF6FF] text-[#1D4ED8] font-medium'
                              : 'text-[#374151] hover:bg-[#F3F4F6]'
                          }`}
                        >
                          <span className="truncate">{cat.name}</span>
                          <ConfidenceBadge
                            jobCount={cat.confidence_job_count}
                            lastUsed={cat.confidence_last_used_at}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {loading && (
              <div className="px-2 py-6 text-center text-xs text-[#9CA3AF]">
                Loading…
              </div>
            )}
          </div>
        </div>

        {/* ── MIDDLE: Rate editor ── */}
        <div className="overflow-y-auto bg-[#F9FAFB]">
          {!selectedCat ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-12 h-12 rounded-xl bg-white border border-[#E5E7EB] flex items-center justify-center mx-auto mb-3">
                  <LayoutGrid className="w-5 h-5 text-[#9CA3AF]" />
                </div>
                <h3 className="text-sm font-semibold text-[#111] mb-1">
                  Select a category
                </h3>
                <p className="text-xs text-[#6B7280] leading-relaxed">
                  Pick a category on the left to view and edit its labor rates and
                  materials. Or create a new one — your rate book builds itself as
                  you work.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-8 py-6">
              {/* Category header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#6B7280] mb-1">
                    <span>{ITEM_TYPES.find(t => t.type === selectedCat.item_type)?.label}</span>
                    <ConfidenceBadge
                      jobCount={selectedCat.confidence_job_count}
                      lastUsed={selectedCat.confidence_last_used_at}
                    />
                  </div>
                  <button
                    onClick={() => handleRenameCategory(selectedCat)}
                    className="text-xl font-semibold text-[#111] hover:text-[#2563EB] transition-colors"
                  >
                    {selectedCat.name}
                  </button>
                </div>
                <button
                  onClick={() => handleArchiveCategory(selectedCat)}
                  className="text-xs text-[#9CA3AF] hover:text-[#EF4444] transition-colors"
                >
                  Archive
                </button>
              </div>

              {/* Labor rates */}
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#6B7280]" />
                    <h2 className="text-sm font-semibold text-[#111]">Labor rates</h2>
                    <span className="text-xs text-[#9CA3AF]">
                      {laborRates.length}
                    </span>
                  </div>
                  <button
                    onClick={handleAddLabor}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] rounded-md transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add rate
                  </button>
                </div>

                <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                  {laborRates.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                      No labor rates yet. Click "Add rate" to create one.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[11px] uppercase tracking-wide text-[#6B7280]">
                          <th className="text-left font-medium py-2 px-4">Name</th>
                          <th className="text-left font-medium py-2 px-2">Unit</th>
                          <th className="text-right font-medium py-2 px-2">Shop hrs</th>
                          <th className="text-right font-medium py-2 px-2">Install hrs</th>
                          <th className="text-right font-medium py-2 px-2">Total</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {laborRates.map(r => (
                          <tr key={r.id} className="border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#FAFAFA] group">
                            <td className="px-2 py-1.5">
                              <TextField
                                value={r.name}
                                onChange={v => handleUpdateLabor(r.id, { name: v })}
                                className="w-full"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={r.unit}
                                onChange={e => handleUpdateLabor(r.id, { unit: e.target.value })}
                                className="px-2 py-1.5 text-sm bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                              >
                                <option value="lf">LF</option>
                                <option value="each">each</option>
                                <option value="sf">SF</option>
                                <option value="hr">hr</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <NumField
                                value={r.hours_per_unit}
                                onChange={v => handleUpdateLabor(r.id, { hours_per_unit: v })}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <NumField
                                value={r.install_hours_per_unit}
                                onChange={v => handleUpdateLabor(r.id, { install_hours_per_unit: v })}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[#6B7280]">
                              {((r.hours_per_unit || 0) + (r.install_hours_per_unit || 0)).toFixed(2)}
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => handleDeleteLabor(r.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#FEE2E2] text-[#9CA3AF] hover:text-[#EF4444] transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {/* Materials */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#6B7280]" />
                    <h2 className="text-sm font-semibold text-[#111]">Materials</h2>
                    <span className="text-xs text-[#9CA3AF]">
                      {materials.length}
                    </span>
                  </div>
                  <button
                    onClick={handleAddMaterial}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] rounded-md transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add material
                  </button>
                </div>

                <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                  {materials.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                      No materials yet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[11px] uppercase tracking-wide text-[#6B7280]">
                          <th className="text-left font-medium py-2 px-4">Name</th>
                          <th className="text-left font-medium py-2 px-2">Unit</th>
                          <th className="text-right font-medium py-2 px-2">Cost / unit</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {materials.map(m => (
                          <tr key={m.id} className="border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#FAFAFA] group">
                            <td className="px-2 py-1.5">
                              <TextField
                                value={m.name}
                                onChange={v => handleUpdateMaterial(m.id, { name: v })}
                                className="w-full"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={m.unit}
                                onChange={e => handleUpdateMaterial(m.id, { unit: e.target.value })}
                                className="px-2 py-1.5 text-sm bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB]"
                              >
                                <option value="sheet">sheet</option>
                                <option value="lf">LF</option>
                                <option value="each">each</option>
                                <option value="bf">BF</option>
                                <option value="sf">SF</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <NumField
                                value={m.cost_per_unit}
                                onChange={v => handleUpdateMaterial(m.id, { cost_per_unit: v || 0 })}
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                onClick={() => handleDeleteMaterial(m.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#FEE2E2] text-[#9CA3AF] hover:text-[#EF4444] transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* ── RIGHT: Confidence panel ── */}
        <div className="border-l border-[#E5E7EB] bg-white overflow-y-auto">
          <div className="px-4 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] mb-3">
              Confidence
            </h3>

            {!selectedCat ? (
              <p className="text-xs text-[#9CA3AF] leading-relaxed">
                Select a category to see how battle-tested its rates are.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-[#6B7280] mb-1">Jobs used on</div>
                  <div className="text-2xl font-semibold text-[#111] tabular-nums">
                    {selectedCat.confidence_job_count}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-[#6B7280] mb-1">Last used</div>
                  <div className="text-sm text-[#111]">
                    {selectedCat.confidence_last_used_at
                      ? new Date(selectedCat.confidence_last_used_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                      : <span className="text-[#9CA3AF]">Not yet used</span>}
                  </div>
                </div>

                <div className="pt-3 border-t border-[#E5E7EB]">
                  <div className="text-xs text-[#6B7280] mb-2">Status</div>
                  <ConfidenceBadge
                    jobCount={selectedCat.confidence_job_count}
                    lastUsed={selectedCat.confidence_last_used_at}
                  />
                  <p className="text-[11px] text-[#9CA3AF] leading-relaxed mt-2">
                    Confidence rises each time this category is used on a real
                    job. After 5 jobs it becomes Reliable. If unused for 6
                    months it drops to Stale.
                  </p>
                </div>

                {selectedCat.notes && (
                  <div className="pt-3 border-t border-[#E5E7EB]">
                    <div className="text-xs text-[#6B7280] mb-1">Notes</div>
                    <p className="text-xs text-[#374151] leading-relaxed">
                      {selectedCat.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

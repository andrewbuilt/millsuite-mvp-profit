'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { computeSubprojectPrice } from '@/lib/pricing'
import { useAuth } from '@/lib/auth-context'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, FileText, ExternalLink } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'

// ── Types ──

interface Project {
  id: string
  name: string
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  status: string
  bid_total: number
  notes: string | null
}

interface Subproject {
  id: string
  name: string
  sort_order: number
  material_cost: number
  labor_hours: number
  labor_cost: number
  consumable_markup_pct: number | null
  profit_margin_pct: number | null
  price: number
  manual_price: number | null
}

interface TimeEntry {
  id: string
  subproject_id: string | null
  duration_minutes: number
  employee_type: string | null
}

interface Invoice {
  id: string
  subproject_id: string | null
  total_amount: number
  vendor_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  file_url: string | null
}

// ── Helpers ──

function fmtMoney(n: number) {
  return n < 0 ? `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtHours(minutes: number) {
  const hrs = minutes / 60
  return hrs < 10 ? hrs.toFixed(1) : Math.round(hrs).toString()
}

// ── Main Page ──

export default function ProjectDetailPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()
  const { confirm } = useConfirm()

  const [project, setProject] = useState<Project | null>(null)
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [departments, setDepartments] = useState<{ id: string; name: string; color: string }[]>([])
  const [deptAllocations, setDeptAllocations] = useState<{ id: string; subproject_id: string; department_id: string; estimated_hours: number }[]>([])
  const shopRate = org?.shop_rate || 75
  const orgDefaults = {
    consumable_markup_pct: org?.consumable_markup_pct ?? 15,
    profit_margin_pct: org?.profit_margin_pct ?? 35,
  }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set())
  const [addingSubproject, setAddingSubproject] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [editingField, setEditingField] = useState<string | null>(null)

  // ── Load Data ──

  useEffect(() => { loadData() }, [projectId, org?.id])

  async function loadData() {
    setLoading(true)
    const [
      { data: proj },
      { data: subs },
      { data: entries },
      { data: invs },
    ] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('subprojects').select('*').eq('project_id', projectId).order('sort_order'),
      supabase.from('time_entries').select('id, subproject_id, duration_minutes, employee_type').eq('project_id', projectId),
      supabase.from('invoices').select('id, subproject_id, total_amount, vendor_name, invoice_number, invoice_date, file_url').eq('project_id', projectId),
    ])
    if (proj) setProject(proj)
    setSubprojects(subs || [])
    setTimeEntries(entries || [])
    setInvoices(invs || [])

    // Load departments and allocations for scheduling
    if (org?.id) {
      const { data: depts } = await supabase.from('departments').select('id, name, color').eq('org_id', org.id).eq('active', true).order('display_order')
      setDepartments(depts || [])

      if (subs && subs.length > 0) {
        const subIds = subs.map((s: any) => s.id)
        const { data: allocs } = await supabase.from('department_allocations')
          .select('id, subproject_id, department_id, estimated_hours')
          .in('subproject_id', subIds)
        setDeptAllocations(allocs || [])
      }
    }

    setLoading(false)
  }

  // ── Subproject CRUD ──

  async function addSubproject() {
    if (!newSubName.trim()) return
    setSaving(true)
    const { data } = await supabase.from('subprojects').insert({
      project_id: projectId,
      org_id: org?.id,
      name: newSubName.trim(),
      sort_order: subprojects.length,
      consumable_markup_pct: orgDefaults.consumable_markup_pct,
      profit_margin_pct: orgDefaults.profit_margin_pct,
    }).select().single()
    if (data) {
      setSubprojects(prev => [...prev, data])
      setExpandedSubs(prev => new Set([...prev, data.id]))
    }
    setNewSubName('')
    setAddingSubproject(false)
    setSaving(false)
    recalcBidTotal([...subprojects, data].filter(Boolean) as Subproject[])
  }

  async function deleteSubproject(subId: string) {
    await supabase.from('subprojects').delete().eq('id', subId)
    const updated = subprojects.filter(s => s.id !== subId)
    setSubprojects(updated)
    recalcBidTotal(updated)
  }

  async function updateSubproject(subId: string, changes: Partial<Subproject>) {
    const sub = subprojects.find(s => s.id === subId)
    if (!sub) return

    const updated = { ...sub, ...changes }

    // Recompute price
    const result = computeSubprojectPrice({
      materialCost: updated.material_cost,
      consumableMarkupPct: updated.consumable_markup_pct ?? orgDefaults.consumable_markup_pct,
      laborHours: updated.labor_hours,
      shopRate,
      profitMarginPct: updated.profit_margin_pct ?? orgDefaults.profit_margin_pct,
      manualPrice: updated.manual_price,
    })

    const dbUpdate = {
      ...changes,
      labor_cost: result.laborCost,
      price: result.price,
    }

    await supabase.from('subprojects').update(dbUpdate).eq('id', subId)

    const newSubs = subprojects.map(s => s.id === subId ? { ...s, ...dbUpdate } : s)
    setSubprojects(newSubs)
    recalcBidTotal(newSubs)
  }

  async function recalcBidTotal(subs: Subproject[]) {
    const total = subs.reduce((sum, s) => sum + (s.price || 0), 0)
    await supabase.from('projects').update({ bid_total: total }).eq('id', projectId)
    setProject(prev => prev ? { ...prev, bid_total: total } : prev)
  }

  // ── Project Field Updates ──

  async function updateProject(changes: Partial<Project>) {
    await supabase.from('projects').update(changes).eq('id', projectId)
    setProject(prev => prev ? { ...prev, ...changes } : prev)
  }

  // ── Computed P&L ──

  const bidTotal = project?.bid_total || 0
  const actualLaborMinutes = timeEntries.reduce((sum, e) => sum + e.duration_minutes, 0)
  const actualLaborCost = (actualLaborMinutes / 60) * shopRate
  const actualMaterialCost = invoices.reduce((sum, i) => sum + i.total_amount, 0)
  const actualTotal = actualLaborCost + actualMaterialCost
  const variance = bidTotal - actualTotal
  const variancePct = bidTotal > 0 ? (variance / bidTotal) * 100 : 0
  const estimatedHours = subprojects.reduce((sum, s) => sum + s.labor_hours, 0)
  const actualHours = actualLaborMinutes / 60
  const hoursProgress = estimatedHours > 0 ? Math.min((actualHours / estimatedHours) * 100, 100) : 0

  // Per-subproject actuals
  function getSubActuals(subId: string) {
    const mins = timeEntries.filter(e => e.subproject_id === subId).reduce((s, e) => s + e.duration_minutes, 0)
    const matCost = invoices.filter(i => i.subproject_id === subId).reduce((s, i) => s + i.total_amount, 0)
    return { hours: mins / 60, laborCost: (mins / 60) * shopRate, materialCost: matCost }
  }

  if (loading || !project) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Back + Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/projects')} className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight truncate">{project.name}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              {project.client_name && <span className="text-xs text-[#6B7280]">{project.client_name}</span>}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                project.status === 'bidding' ? 'bg-[#FFFBEB] text-[#D97706]' :
                project.status === 'active' ? 'bg-[#EFF6FF] text-[#2563EB]' :
                'bg-[#ECFDF5] text-[#059669]'
              }`}>
                {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
              </span>
            </div>
          </div>
          <button
            onClick={async () => {
              const confirmed = await confirm({
                title: 'Delete Project',
                message: `Delete "${project.name}"? This will permanently remove all subprojects, time entries, invoices, and scheduling data.`,
                confirmLabel: 'Delete',
                variant: 'danger',
              })
              if (!confirmed) return
              await supabase.from('time_entries').delete().eq('project_id', projectId)
              await supabase.from('invoices').delete().eq('project_id', projectId)
              await supabase.from('department_allocations').delete().in('subproject_id', subprojects.map(s => s.id))
              await supabase.from('subprojects').delete().eq('project_id', projectId)
              await supabase.from('project_month_allocations').delete().eq('project_id', projectId)
              await supabase.from('cash_flow').delete().eq('project_id', projectId)
              await supabase.from('projects').delete().eq('id', projectId)
              router.push('/projects')
            }}
            className="p-2 rounded-lg text-[#D1D5DB] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors flex-shrink-0"
            title="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* P&L Hero Card */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-5 border-b border-[#E5E7EB]">
            <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">Project P&L</div>
          </div>
          <div className="grid grid-cols-4 divide-x divide-[#F3F4F6]">
            <div className="px-6 py-5 text-center">
              <div className="text-xs text-[#9CA3AF] mb-1">Bid Total</div>
              <div className="text-2xl font-mono tabular-nums font-semibold">{fmtMoney(bidTotal)}</div>
            </div>
            <div className="px-6 py-5 text-center">
              <div className="text-xs text-[#9CA3AF] mb-1">Actual Cost</div>
              <div className="text-2xl font-mono tabular-nums font-semibold">{fmtMoney(actualTotal)}</div>
              <div className="text-[10px] text-[#9CA3AF] mt-1">
                Labor {fmtMoney(actualLaborCost)} · Material {fmtMoney(actualMaterialCost)}
              </div>
            </div>
            <div className="px-6 py-5 text-center">
              <div className="text-xs text-[#9CA3AF] mb-1">Variance</div>
              <div className={`text-2xl font-mono tabular-nums font-semibold ${variance >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                {fmtMoney(variance)}
              </div>
              <div className={`text-[10px] mt-1 ${variance >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                {variancePct >= 0 ? '+' : ''}{variancePct.toFixed(1)}%
              </div>
            </div>
            <div className="px-6 py-5 text-center">
              <div className="text-xs text-[#9CA3AF] mb-1">Hours</div>
              <div className="text-2xl font-mono tabular-nums font-semibold">
                {fmtHours(actualLaborMinutes)}<span className="text-sm text-[#9CA3AF] font-normal">/{estimatedHours}</span>
              </div>
              <div className="w-full h-1.5 bg-[#F3F4F6] rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${hoursProgress > 90 ? 'bg-[#DC2626]' : hoursProgress > 70 ? 'bg-[#D97706]' : 'bg-[#2563EB]'}`}
                  style={{ width: `${hoursProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Client Info */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-4 mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Client Name</label>
              <input
                value={project.client_name || ''}
                onChange={e => setProject(prev => prev ? { ...prev, client_name: e.target.value } : prev)}
                onBlur={e => updateProject({ client_name: e.target.value || null })}
                className="mt-1 w-full text-sm bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                placeholder="Client name..."
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Email</label>
              <input
                value={project.client_email || ''}
                onChange={e => setProject(prev => prev ? { ...prev, client_email: e.target.value } : prev)}
                onBlur={e => updateProject({ client_email: e.target.value || null })}
                className="mt-1 w-full text-sm bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Phone</label>
              <input
                value={project.client_phone || ''}
                onChange={e => setProject(prev => prev ? { ...prev, client_phone: e.target.value } : prev)}
                onBlur={e => updateProject({ client_phone: e.target.value || null })}
                className="mt-1 w-full text-sm bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                placeholder="(555) 000-0000"
              />
            </div>
          </div>
        </div>

        {/* Subprojects */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111]">Subprojects</h2>
          </div>

          <div className="space-y-3">
            {subprojects.map(sub => {
              const isExpanded = expandedSubs.has(sub.id)
              const actuals = getSubActuals(sub.id)
              const result = computeSubprojectPrice({
                materialCost: sub.material_cost,
                consumableMarkupPct: sub.consumable_markup_pct ?? orgDefaults.consumable_markup_pct,
                laborHours: sub.labor_hours,
                shopRate,
                profitMarginPct: sub.profit_margin_pct ?? orgDefaults.profit_margin_pct,
                manualPrice: sub.manual_price,
              })
              const laborVariance = sub.labor_hours - actuals.hours

              return (
                <div key={sub.id} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                  {/* Sub Header */}
                  <button
                    onClick={() => setExpandedSubs(prev => {
                      const n = new Set(prev)
                      if (n.has(sub.id)) n.delete(sub.id); else n.add(sub.id)
                      return n
                    })}
                    className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
                      <span className="font-medium text-sm">{sub.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-mono tabular-nums font-semibold">{fmtMoney(result.price)}</span>
                      {actuals.hours > 0 && (
                        <span className={`text-xs font-mono tabular-nums ${laborVariance >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                          {fmtHours(actuals.hours * 60)}/{sub.labor_hours}h
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="border-t border-[#F3F4F6] px-5 py-4 space-y-4">
                      {/* Inputs Grid */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Material Cost</label>
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-sm text-[#9CA3AF]">$</span>
                            <input
                              type="number"
                              value={sub.material_cost || ''}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                setSubprojects(prev => prev.map(s => s.id === sub.id ? { ...s, material_cost: val } : s))
                              }}
                              onBlur={e => updateSubproject(sub.id, { material_cost: parseFloat(e.target.value) || 0 })}
                              className="w-full text-sm font-mono tabular-nums bg-transparent border-b border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Labor Hours</label>
                          <input
                            type="number"
                            value={sub.labor_hours || ''}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0
                              setSubprojects(prev => prev.map(s => s.id === sub.id ? { ...s, labor_hours: val } : s))
                            }}
                            onBlur={e => updateSubproject(sub.id, { labor_hours: parseFloat(e.target.value) || 0 })}
                            className="mt-1 w-full text-sm font-mono tabular-nums bg-transparent border-b border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                            placeholder="0"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Consumable Markup</label>
                          <div className="flex items-center gap-1 mt-1">
                            <input
                              type="number"
                              value={sub.consumable_markup_pct ?? orgDefaults.consumable_markup_pct}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                setSubprojects(prev => prev.map(s => s.id === sub.id ? { ...s, consumable_markup_pct: val } : s))
                              }}
                              onBlur={e => updateSubproject(sub.id, { consumable_markup_pct: parseFloat(e.target.value) || 0 })}
                              className="w-20 text-sm font-mono tabular-nums bg-transparent border-b border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                            />
                            <span className="text-sm text-[#9CA3AF]">%</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Profit Margin</label>
                          <div className="flex items-center gap-1 mt-1">
                            <input
                              type="number"
                              value={sub.profit_margin_pct ?? orgDefaults.profit_margin_pct}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                setSubprojects(prev => prev.map(s => s.id === sub.id ? { ...s, profit_margin_pct: val } : s))
                              }}
                              onBlur={e => updateSubproject(sub.id, { profit_margin_pct: parseFloat(e.target.value) || 0 })}
                              className="w-20 text-sm font-mono tabular-nums bg-transparent border-b border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                            />
                            <span className="text-sm text-[#9CA3AF]">%</span>
                          </div>
                        </div>
                      </div>

                      {/* Department Hours — for scheduling */}
                      {departments.length > 0 && (() => {
                        const DEPT_SORT = ['engineering', 'cnc', 'assembly', 'finish', 'install']
                        const prodDepts = departments
                          .filter(d => DEPT_SORT.includes(d.name.toLowerCase()))
                          .sort((a, b) => DEPT_SORT.indexOf(a.name.toLowerCase()) - DEPT_SORT.indexOf(b.name.toLowerCase()))
                        if (prodDepts.length === 0) return null
                        return (
                        <div className="bg-[#F9FAFB] rounded-xl p-4 mb-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Department Hours</span>
                            <span className="text-[9px] text-[#D1D5DB]">rolls up to labor hours</span>
                          </div>
                          <div className="grid grid-cols-5 gap-2">
                            {prodDepts.map(dept => {
                              const alloc = deptAllocations.find(a => a.subproject_id === sub.id && a.department_id === dept.id)
                              return (
                                <div key={dept.id}>
                                  <label className="flex items-center gap-1 mb-1">
                                    <div className="w-2 h-2 rounded-sm" style={{ background: dept.color }} />
                                    <span className="text-[9px] text-[#6B7280] font-medium">{dept.name}</span>
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    defaultValue={alloc?.estimated_hours || ''}
                                    placeholder="0"
                                    onBlur={async (e) => {
                                      const hrs = parseFloat(e.target.value) || 0
                                      if (alloc) {
                                        if (hrs > 0) {
                                          await supabase.from('department_allocations').update({ estimated_hours: hrs }).eq('id', alloc.id)
                                        } else {
                                          await supabase.from('department_allocations').delete().eq('id', alloc.id)
                                        }
                                      } else if (hrs > 0 && org?.id) {
                                        await supabase.from('department_allocations').insert({
                                          org_id: org.id,
                                          subproject_id: sub.id,
                                          department_id: dept.id,
                                          estimated_hours: hrs,
                                        })
                                      }
                                      // Reload allocations
                                      const subIds = subprojects.map(s => s.id)
                                      const { data: allocs } = await supabase.from('department_allocations')
                                        .select('id, subproject_id, department_id, estimated_hours')
                                        .in('subproject_id', subIds)
                                      setDeptAllocations(allocs || [])

                                      // Roll up total dept hours to labor_hours
                                      const totalDeptHours = (allocs || [])
                                        .filter(a => a.subproject_id === sub.id)
                                        .reduce((s, a) => s + a.estimated_hours, 0)
                                      await supabase.from('subprojects').update({ labor_hours: totalDeptHours }).eq('id', sub.id)
                                      setSubprojects(prev => prev.map(s => s.id === sub.id ? { ...s, labor_hours: totalDeptHours } : s))
                                    }}
                                    className="w-full text-center text-xs font-mono bg-white border border-[#E5E7EB] rounded-lg py-1.5 focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                                  />
                                </div>
                              )
                            })}
                          </div>
                          {deptAllocations.filter(a => a.subproject_id === sub.id).length > 0 && (
                            <div className="flex justify-between mt-2 pt-2 border-t border-[#E5E7EB]">
                              <span className="text-[9px] text-[#9CA3AF]">Total dept hours → labor hours</span>
                              <span className="text-[9px] font-mono text-[#6B7280]">
                                {deptAllocations.filter(a => a.subproject_id === sub.id).reduce((s, a) => s + a.estimated_hours, 0)}h
                              </span>
                            </div>
                          )}
                        </div>
                        )
                      })()}

                      {/* Price Summary */}
                      <div className="bg-[#F9FAFB] rounded-xl p-4">
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-[#6B7280]">Material + {sub.consumable_markup_pct ?? orgDefaults.consumable_markup_pct}% consumables</span>
                            <span className="font-mono tabular-nums">{fmtMoney(result.materialWithConsumables)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[#6B7280]">Labor ({sub.labor_hours}h × ${Number(shopRate).toFixed(2)}/hr)</span>
                            <span className="font-mono tabular-nums">{fmtMoney(result.laborCost)}</span>
                          </div>
                          <div className="flex justify-between text-xs border-t border-[#E5E7EB] pt-1.5">
                            <span className="text-[#6B7280]">Cost</span>
                            <span className="font-mono tabular-nums">{fmtMoney(result.cost)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[#6B7280]">+ {result.profitMarginPct}% margin</span>
                            <span className="font-mono tabular-nums">{fmtMoney(result.price - result.cost)}</span>
                          </div>
                          <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-1.5">
                            <span className="font-medium">Price</span>
                            <span className="font-mono tabular-nums font-semibold text-[#2563EB]">{fmtMoney(result.price)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actuals (if any) */}
                      {(actuals.hours > 0 || actuals.materialCost > 0) && (
                        <div className="border-t border-[#F3F4F6] pt-3">
                          <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Actuals</div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="text-center">
                              <div className="text-xs text-[#9CA3AF]">Hours Logged</div>
                              <div className={`text-sm font-mono tabular-nums font-medium ${actuals.hours > sub.labor_hours ? 'text-[#DC2626]' : 'text-[#059669]'}`}>
                                {fmtHours(actuals.hours * 60)} / {sub.labor_hours}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs text-[#9CA3AF]">Labor Cost</div>
                              <div className="text-sm font-mono tabular-nums">{fmtMoney(actuals.laborCost)}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs text-[#9CA3AF]">Material Invoiced</div>
                              <div className="text-sm font-mono tabular-nums">{fmtMoney(actuals.materialCost)}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Delete */}
                      <div className="flex justify-end pt-2">
                        <button
                          onClick={async () => {
                            const confirmed = await confirm({ title: 'Delete Subproject', message: `Delete "${sub.name}"?`, confirmLabel: 'Delete', variant: 'danger' })
                            if (confirmed) deleteSubproject(sub.id)
                          }}
                          className="flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#DC2626] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Subproject */}
          {addingSubproject ? (
            <div className="mt-3 flex items-center gap-2">
              <input
                autoFocus
                value={newSubName}
                onChange={e => setNewSubName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addSubproject(); if (e.key === 'Escape') { setAddingSubproject(false); setNewSubName('') } }}
                placeholder="Subproject name..."
                className="flex-1 px-4 py-2.5 text-sm bg-white border border-[#E5E7EB] rounded-xl outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
              <button onClick={addSubproject} disabled={saving} className="px-4 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50">
                Add
              </button>
              <button onClick={() => { setAddingSubproject(false); setNewSubName('') }} className="px-3 py-2.5 text-sm text-[#6B7280] hover:text-[#111]">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingSubproject(true)}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[#D1D5DB] rounded-xl text-sm font-medium text-[#6B7280] hover:text-[#111] hover:border-[#9CA3AF] hover:bg-white transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Subproject
            </button>
          )}
        </div>

        {/* Invoices */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#2563EB]" />
                <h2 className="text-sm font-semibold text-[#111]">Invoices</h2>
                <span className="text-xs text-[#9CA3AF] ml-1">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="text-sm font-mono tabular-nums font-semibold">
                {fmtMoney(actualMaterialCost)} total
              </div>
            </div>
          </div>

          {invoices.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <FileText className="w-6 h-6 text-[#D1D5DB] mx-auto mb-2" />
              <p className="text-sm text-[#9CA3AF]">No invoices yet</p>
              <p className="text-xs text-[#D1D5DB] mt-1">Upload invoices from the dashboard</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F3F4F6]">
              {invoices.map(inv => (
                <div key={inv.id} className="px-6 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#111] truncate">{inv.vendor_name || 'Unknown vendor'}</span>
                      {inv.invoice_number && (
                        <span className="text-xs font-mono text-[#9CA3AF]">#{inv.invoice_number}</span>
                      )}
                    </div>
                    {inv.invoice_date && (
                      <div className="text-xs text-[#9CA3AF] mt-0.5">{inv.invoice_date}</div>
                    )}
                  </div>
                  <div className="text-sm font-mono tabular-nums font-semibold text-[#111]">
                    {fmtMoney(inv.total_amount)}
                  </div>
                  {inv.file_url && (
                    <a
                      href={inv.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#2563EB] hover:bg-[#EFF6FF] transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-4">
          <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Notes</label>
          <textarea
            value={project.notes || ''}
            onChange={e => setProject(prev => prev ? { ...prev, notes: e.target.value } : prev)}
            onBlur={e => updateProject({ notes: e.target.value || null })}
            rows={3}
            className="mt-1 w-full text-sm bg-transparent border-none outline-none resize-none"
            placeholder="Project notes..."
          />
        </div>
      </div>
    </>
  )
}

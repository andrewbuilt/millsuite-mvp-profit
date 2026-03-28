'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Nav from '@/components/nav'
import { computeShopRate } from '@/lib/pricing'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

// ── Field config for overhead inputs ──

const OVERHEAD_FIELDS: { key: string; label: string }[] = [
  { key: 'monthly_rent', label: 'Rent / Mortgage' },
  { key: 'monthly_utilities', label: 'Utilities' },
  { key: 'monthly_insurance', label: 'Insurance' },
  { key: 'monthly_equipment', label: 'Equipment / Leases' },
  { key: 'monthly_misc_overhead', label: 'Other Overhead' },
]

const inputClass = "w-32 text-right px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"

// ── Employee type ──

interface Employee {
  id: string
  name: string
  annualCost: string // raw string for typing
  billable: boolean
}

function generateId() { return Math.random().toString(36).slice(2, 9) }

// ── Page ──

export default function SettingsPage() {
  const { org } = useAuth()

  const [rawValues, setRawValues] = useState<Record<string, string>>({
    monthly_rent: '',
    monthly_utilities: '',
    monthly_insurance: '',
    monthly_equipment: '',
    monthly_misc_overhead: '',
    owner_salary: '',
    target_profit_pct: '0',
    working_days_per_month: '21',
    hours_per_day: '8',
  })

  const [ownerBillable, setOwnerBillable] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [consumableMarkup, setConsumableMarkup] = useState('15')
  const [profitMargin, setProfitMargin] = useState('35')
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load from Supabase on mount ──

  useEffect(() => {
    if (!org?.id) return
    async function load() {
      const { data } = await supabase
        .from('shop_rate_settings')
        .select('*')
        .eq('org_id', org!.id)
        .single()

      if (data) {
        setRawValues({
          monthly_rent: data.monthly_rent?.toString() || '',
          monthly_utilities: data.monthly_utilities?.toString() || '',
          monthly_insurance: data.monthly_insurance?.toString() || '',
          monthly_equipment: data.monthly_equipment?.toString() || '',
          monthly_misc_overhead: data.monthly_misc_overhead?.toString() || '',
          owner_salary: data.owner_salary?.toString() || '',
          target_profit_pct: data.target_profit_pct?.toString() || '0',
          working_days_per_month: data.working_days_per_month?.toString() || '21',
          hours_per_day: data.hours_per_day?.toString() || '8',
        })
        if (data.owner_billable !== undefined) setOwnerBillable(data.owner_billable)
        if (data.employees_json) {
          try {
            setEmployees(JSON.parse(data.employees_json))
          } catch {}
        }
      }

      // Load org defaults for consumable markup & profit margin
      setConsumableMarkup(org!.consumable_markup_pct?.toString() || '15')
      setProfitMargin(org!.profit_margin_pct?.toString() || '35')

      setLoaded(true)
    }
    load()
  }, [org?.id])

  function getNum(key: string): number {
    return parseFloat(rawValues[key]) || 0
  }

  function handleChange(key: string, value: string) {
    setRawValues(prev => ({ ...prev, [key]: value.replace(/[^0-9.]/g, '') }))
  }

  // ── Employee helpers ──

  function addEmployee() {
    setEmployees(prev => [...prev, { id: generateId(), name: '', annualCost: '', billable: true }])
  }

  function updateEmployee(id: string, changes: Partial<Employee>) {
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e))
  }

  function removeEmployee(id: string) {
    setEmployees(prev => prev.filter(e => e.id !== id))
  }

  // ── Computed from employees ──

  const totalAnnualPayroll = employees.reduce((sum, e) => sum + (parseFloat(e.annualCost) || 0), 0)
  const totalMonthlyPayroll = totalAnnualPayroll / 12
  const billableEmployees = employees.filter(e => e.billable)
  const nonBillableEmployees = employees.filter(e => !e.billable)
  const billableCount = billableEmployees.length + (ownerBillable ? 1 : 0)

  const result = computeShopRate({
    monthlyRent: getNum('monthly_rent'),
    monthlyUtilities: getNum('monthly_utilities'),
    monthlyInsurance: getNum('monthly_insurance'),
    monthlyEquipment: getNum('monthly_equipment'),
    monthlyMisc: getNum('monthly_misc_overhead'),
    ownerSalary: getNum('owner_salary'),
    totalPayroll: totalMonthlyPayroll,
    targetProfitPct: getNum('target_profit_pct'),
    workingDaysPerMonth: getNum('working_days_per_month'),
    hoursPerDay: getNum('hours_per_day'),
  })

  // Override production hours to account for billable headcount
  const hoursPerMonth = getNum('working_days_per_month') * getNum('hours_per_day')
  const billableHoursPerMonth = hoursPerMonth * billableCount
  const totalMonthlyCost = result.monthlyOverhead + getNum('owner_salary') + totalMonthlyPayroll
  const costPerHour = billableHoursPerMonth > 0 ? totalMonthlyCost / billableHoursPerMonth : 0
  const bufferPct = getNum('target_profit_pct')
  const shopRate = costPerHour * (1 + bufferPct / 100)

  // ── Auto-save with debounce ──

  const doSave = useCallback(async () => {
    if (!org?.id || !loaded) return

    const settingsRow = {
      org_id: org.id,
      monthly_rent: parseFloat(rawValues.monthly_rent) || 0,
      monthly_utilities: parseFloat(rawValues.monthly_utilities) || 0,
      monthly_insurance: parseFloat(rawValues.monthly_insurance) || 0,
      monthly_equipment: parseFloat(rawValues.monthly_equipment) || 0,
      monthly_misc_overhead: parseFloat(rawValues.monthly_misc_overhead) || 0,
      owner_salary: parseFloat(rawValues.owner_salary) || 0,
      target_profit_pct: parseFloat(rawValues.target_profit_pct) || 0,
      working_days_per_month: parseFloat(rawValues.working_days_per_month) || 21,
      hours_per_day: parseFloat(rawValues.hours_per_day) || 8,
      computed_shop_rate: shopRate,
      owner_billable: ownerBillable,
      employees_json: JSON.stringify(employees),
    }

    await supabase
      .from('shop_rate_settings')
      .upsert(settingsRow, { onConflict: 'org_id' })

    await supabase
      .from('orgs')
      .update({
        shop_rate: shopRate,
        consumable_markup_pct: parseFloat(consumableMarkup) || 0,
        profit_margin_pct: parseFloat(profitMargin) || 0,
      })
      .eq('id', org.id)

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [org?.id, loaded, rawValues, shopRate, ownerBillable, employees, consumableMarkup, profitMargin])

  useEffect(() => {
    if (!loaded) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { doSave() }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [doSave])

  return (
    <>
      <Nav />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          {saved && <span className="text-xs text-[#059669] font-medium animate-pulse">Saved</span>}
        </div>

        {/* Shop Rate Calculator */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Shop Rate Calculator</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">Your cost per production hour — this drives all project pricing</p>
          </div>

          {/* Result Hero */}
          <div className="px-6 py-8 bg-[#F9FAFB] border-b border-[#E5E7EB] text-center">
            <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">Your Shop Rate</div>
            <div className="text-5xl font-mono tabular-nums font-semibold text-[#111]">
              ${shopRate.toFixed(2)}
              <span className="text-lg text-[#9CA3AF] font-normal">/hr</span>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-xs text-[#6B7280]">
              <span>Cost: ${costPerHour.toFixed(2)}/hr</span>
              {bufferPct > 0 && <><span>·</span><span>Buffer: ${(shopRate - costPerHour).toFixed(2)}/hr</span></>}
              <span>·</span>
              <span>{billableCount} billable × {hoursPerMonth} hrs = {billableHoursPerMonth} hrs/mo</span>
            </div>
          </div>

          <div className="px-6 py-4">
            {/* Fixed Costs */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Monthly Fixed Costs</h3>
              {OVERHEAD_FIELDS.map(f => (
                <div key={f.key} className="flex items-center justify-between py-3 border-b border-[#F3F4F6] last:border-b-0">
                  <label className="text-sm text-[#6B7280]">{f.label}</label>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#9CA3AF]">$</span>
                    <input type="text" inputMode="decimal" value={rawValues[f.key]} onChange={e => handleChange(f.key, e.target.value)} className={inputClass} placeholder="0" />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between py-3 border-t border-[#E5E7EB] mt-2">
                <span className="text-sm font-medium text-[#111]">Total Overhead</span>
                <span className="text-sm font-mono tabular-nums font-semibold">${result.monthlyOverhead.toLocaleString()}/mo</span>
              </div>
            </div>

            {/* Owner */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Owner</h3>
              <div className="flex items-center justify-between py-3">
                <label className="text-sm text-[#6B7280]">Owner Annual Salary</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-[#9CA3AF]">$</span>
                    <input type="text" inputMode="decimal" value={rawValues.owner_salary} onChange={e => handleChange('owner_salary', e.target.value)} className={inputClass} placeholder="0" />
                    <span className="text-xs text-[#9CA3AF]">/yr</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setOwnerBillable(!ownerBillable)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        ownerBillable ? 'bg-[#2563EB] border-[#2563EB]' : 'border-[#D1D5DB] hover:border-[#9CA3AF]'
                      }`}
                    >
                      {ownerBillable && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      )}
                    </button>
                    <span className="text-xs text-[#9CA3AF]">Billable</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Team */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">Team</h3>
                <button onClick={addEmployee} className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Add Employee
                </button>
              </div>

              {employees.length === 0 ? (
                <div className="text-xs text-[#9CA3AF] italic py-4 text-center border border-dashed border-[#E5E7EB] rounded-xl">
                  No employees added — add your team to calculate accurate production hours
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_120px_80px_32px] gap-3 px-3 py-1">
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Name</span>
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider text-right">Annual Cost</span>
                    <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider text-center">Billable</span>
                    <span />
                  </div>

                  {employees.map(emp => (
                    <div key={emp.id} className="grid grid-cols-[1fr_120px_80px_32px] gap-3 items-center bg-[#F9FAFB] rounded-xl px-3 py-2">
                      <input
                        type="text"
                        value={emp.name}
                        onChange={e => updateEmployee(emp.id, { name: e.target.value })}
                        className="text-sm bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                        placeholder="Employee name..."
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#9CA3AF]">$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={emp.annualCost}
                          onChange={e => updateEmployee(emp.id, { annualCost: e.target.value.replace(/[^0-9.]/g, '') })}
                          className="w-full text-right text-sm font-mono tabular-nums bg-transparent border-b border-transparent hover:border-[#E5E7EB] focus:border-[#2563EB] outline-none py-1 transition-colors"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={() => updateEmployee(emp.id, { billable: !emp.billable })}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            emp.billable ? 'bg-[#2563EB] border-[#2563EB]' : 'border-[#D1D5DB] hover:border-[#9CA3AF]'
                          }`}
                        >
                          {emp.billable && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          )}
                        </button>
                      </div>
                      <button onClick={() => removeEmployee(emp.id)} className="p-1 text-[#D1D5DB] hover:text-[#DC2626] transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Team summary */}
              {employees.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between py-2 border-t border-[#E5E7EB]">
                    <span className="text-sm text-[#6B7280]">Total payroll ({employees.length} employees)</span>
                    <span className="text-sm font-mono tabular-nums">${Math.round(totalMonthlyPayroll).toLocaleString()}/mo</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-[#9CA3AF]">Billable: {billableEmployees.length} employees{ownerBillable ? ' + owner' : ''}</span>
                    <span className="text-xs text-[#9CA3AF]">Non-billable: {nonBillableEmployees.length}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Production */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Production Capacity</h3>
              <div className="flex items-center justify-between py-3 border-b border-[#F3F4F6]">
                <label className="text-sm text-[#6B7280]">Working Days / Month</label>
                <input type="text" inputMode="decimal" value={rawValues.working_days_per_month} onChange={e => handleChange('working_days_per_month', e.target.value)} className={inputClass} placeholder="21" />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-[#F3F4F6]">
                <label className="text-sm text-[#6B7280]">Hours / Day</label>
                <input type="text" inputMode="decimal" value={rawValues.hours_per_day} onChange={e => handleChange('hours_per_day', e.target.value)} className={inputClass} placeholder="8" />
              </div>
              <div className="flex items-center justify-between py-3">
                <label className="text-sm text-[#6B7280]">Overhead Buffer</label>
                <div className="flex items-center gap-1">
                  <input type="text" inputMode="decimal" value={rawValues.target_profit_pct} onChange={e => handleChange('target_profit_pct', e.target.value)} className={inputClass} placeholder="0" />
                  <span className="text-sm text-[#9CA3AF]">%</span>
                </div>
              </div>
              <p className="text-[10px] text-[#9CA3AF] mt-1 ml-1">Covers downtime, unbillable hours, etc. Set to 0 to disable.</p>
            </div>

            {/* Breakdown */}
            <div className="bg-[#F9FAFB] rounded-xl p-4 mb-4">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">Breakdown</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Monthly overhead</span>
                  <span className="font-mono tabular-nums">${result.monthlyOverhead.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Owner salary</span>
                  <span className="font-mono tabular-nums">${Math.round(getNum('owner_salary') / 12).toLocaleString()}/mo</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Team payroll</span>
                  <span className="font-mono tabular-nums">${Math.round(totalMonthlyPayroll).toLocaleString()}/mo</span>
                </div>
                <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-2">
                  <span className="text-[#6B7280]">Total monthly cost</span>
                  <span className="font-mono tabular-nums font-medium">${Math.round(totalMonthlyCost).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Billable production hours</span>
                  <span className="font-mono tabular-nums">{billableCount} people × {hoursPerMonth} = {billableHoursPerMonth} hrs/mo</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Cost per hour</span>
                  <span className="font-mono tabular-nums">${costPerHour.toFixed(2)}</span>
                </div>
                {bufferPct > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B7280]">+ {bufferPct}% buffer</span>
                    <span className="font-mono tabular-nums">${(shopRate - costPerHour).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-2">
                  <span className="font-medium text-[#111]">Shop Rate</span>
                  <span className="font-mono tabular-nums font-semibold text-[#2563EB]">${shopRate.toFixed(2)}/hr</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Defaults */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Project Defaults</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">Applied to all new subprojects — adjustable per project</p>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between py-3">
              <label className="text-sm text-[#6B7280]">Consumable Markup</label>
              <div className="flex items-center gap-1">
                <input type="text" inputMode="decimal" value={consumableMarkup} onChange={e => setConsumableMarkup(e.target.value.replace(/[^0-9.]/g, ''))} className={inputClass} />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Default Profit Margin</label>
              <div className="flex items-center gap-1">
                <input type="text" inputMode="decimal" value={profitMargin} onChange={e => setProfitMargin(e.target.value.replace(/[^0-9.]/g, ''))} className={inputClass} />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

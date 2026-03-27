'use client'

import { useState } from 'react'
import Nav from '@/components/nav'
import { computeShopRate } from '@/lib/pricing'

const FIELD_CONFIG: { key: string; label: string; prefix?: string; suffix?: string; section: string }[] = [
  { key: 'monthly_rent', label: 'Rent / Mortgage', prefix: '$', section: 'overhead' },
  { key: 'monthly_utilities', label: 'Utilities', prefix: '$', section: 'overhead' },
  { key: 'monthly_insurance', label: 'Insurance', prefix: '$', section: 'overhead' },
  { key: 'monthly_equipment', label: 'Equipment / Leases', prefix: '$', section: 'overhead' },
  { key: 'monthly_misc_overhead', label: 'Other Overhead', prefix: '$', section: 'overhead' },
  { key: 'owner_salary', label: 'Owner Salary', prefix: '$', section: 'labor' },
  { key: 'total_payroll', label: 'Total Payroll (all employees)', prefix: '$', section: 'labor' },
  { key: 'working_days_per_month', label: 'Working Days / Month', section: 'production' },
  { key: 'hours_per_day', label: 'Hours / Day', section: 'production' },
  { key: 'target_profit_pct', label: 'Overhead Buffer', suffix: '%', section: 'production' },
]

const inputClass = "w-32 text-right px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"

export default function SettingsPage() {
  // Store raw strings so typing works naturally
  const [rawValues, setRawValues] = useState<Record<string, string>>({
    monthly_rent: '',
    monthly_utilities: '',
    monthly_insurance: '',
    monthly_equipment: '',
    monthly_misc_overhead: '',
    owner_salary: '',
    total_payroll: '',
    target_profit_pct: '0',
    working_days_per_month: '21',
    hours_per_day: '8',
  })

  const [consumableMarkup, setConsumableMarkup] = useState('15')
  const [profitMargin, setProfitMargin] = useState('35')

  function getNum(key: string): number {
    return parseFloat(rawValues[key]) || 0
  }

  function handleChange(key: string, value: string) {
    // Allow digits, decimal point, and empty string
    const clean = value.replace(/[^0-9.]/g, '')
    setRawValues(prev => ({ ...prev, [key]: clean }))
  }

  const result = computeShopRate({
    monthlyRent: getNum('monthly_rent'),
    monthlyUtilities: getNum('monthly_utilities'),
    monthlyInsurance: getNum('monthly_insurance'),
    monthlyEquipment: getNum('monthly_equipment'),
    monthlyMisc: getNum('monthly_misc_overhead'),
    ownerSalary: getNum('owner_salary'),
    totalPayroll: getNum('total_payroll'),
    targetProfitPct: getNum('target_profit_pct'),
    workingDaysPerMonth: getNum('working_days_per_month'),
    hoursPerDay: getNum('hours_per_day'),
  })

  function renderFields(section: string) {
    return FIELD_CONFIG.filter(f => f.section === section).map(f => (
      <div key={f.key} className="flex items-center justify-between py-3 border-b border-[#F3F4F6] last:border-b-0">
        <label className="text-sm text-[#6B7280]">{f.label}</label>
        <div className="flex items-center gap-1">
          {f.prefix && <span className="text-sm text-[#9CA3AF]">{f.prefix}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={rawValues[f.key]}
            onChange={e => handleChange(f.key, e.target.value)}
            className={inputClass}
            placeholder="0"
          />
          {f.suffix && <span className="text-sm text-[#9CA3AF]">{f.suffix}</span>}
        </div>
      </div>
    ))
  }

  return (
    <>
      <Nav />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-8">Settings</h1>

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
              ${result.shopRate.toFixed(2)}
              <span className="text-lg text-[#9CA3AF] font-normal">/hr</span>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-xs text-[#6B7280]">
              <span>Cost: ${result.costPerHour.toFixed(2)}/hr</span>
              <span>·</span>
              <span>Buffer: ${(result.shopRate - result.costPerHour).toFixed(2)}/hr</span>
              <span>·</span>
              <span>{result.productionHoursPerMonth} hrs/mo</span>
            </div>
          </div>

          <div className="px-6 py-4">
            {/* Fixed Costs */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Monthly Fixed Costs</h3>
              {renderFields('overhead')}
              <div className="flex items-center justify-between py-3 border-t border-[#E5E7EB] mt-2">
                <span className="text-sm font-medium text-[#111]">Total Overhead</span>
                <span className="text-sm font-mono tabular-nums font-semibold">${result.monthlyOverhead.toLocaleString()}/mo</span>
              </div>
            </div>

            {/* Labor */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Monthly Labor</h3>
              {renderFields('labor')}
              <div className="flex items-center justify-between py-3 border-t border-[#E5E7EB] mt-2">
                <span className="text-sm font-medium text-[#111]">Total Labor Cost</span>
                <span className="text-sm font-mono tabular-nums font-semibold">${result.monthlyLaborCost.toLocaleString()}/mo</span>
              </div>
            </div>

            {/* Production */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Production Capacity</h3>
              {renderFields('production')}
              <p className="text-[10px] text-[#9CA3AF] mt-1 ml-1">Buffer covers downtime, unbillable hours, etc. Set to 0 if you don't want one.</p>
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
                  <span className="text-[#6B7280]">Monthly labor</span>
                  <span className="font-mono tabular-nums">${result.monthlyLaborCost.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-2">
                  <span className="text-[#6B7280]">Total monthly cost</span>
                  <span className="font-mono tabular-nums font-medium">${result.totalMonthlyCost.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Production hours</span>
                  <span className="font-mono tabular-nums">{result.productionHoursPerMonth} hrs/mo</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Cost per hour</span>
                  <span className="font-mono tabular-nums">${result.costPerHour.toFixed(2)}</span>
                </div>
                {getNum('target_profit_pct') > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B7280]">+ {getNum('target_profit_pct')}% buffer</span>
                    <span className="font-mono tabular-nums">${(result.shopRate - result.costPerHour).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-[#E5E7EB] pt-2">
                  <span className="font-medium text-[#111]">Shop Rate</span>
                  <span className="font-mono tabular-nums font-semibold text-[#2563EB]">${result.shopRate.toFixed(2)}/hr</span>
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
                <input
                  type="text"
                  inputMode="decimal"
                  value={consumableMarkup}
                  onChange={e => setConsumableMarkup(e.target.value.replace(/[^0-9.]/g, ''))}
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Default Profit Margin</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={profitMargin}
                  onChange={e => setProfitMargin(e.target.value.replace(/[^0-9.]/g, ''))}
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

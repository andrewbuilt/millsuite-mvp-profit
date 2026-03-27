'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/nav'
import { computeShopRate } from '@/lib/pricing'
import { supabase } from '@/lib/supabase'

interface ShopRateInputs {
  monthly_rent: number
  monthly_utilities: number
  monthly_insurance: number
  monthly_equipment: number
  monthly_misc_overhead: number
  owner_salary: number
  total_payroll: number
  target_profit_pct: number
  working_days_per_month: number
  hours_per_day: number
}

const DEFAULTS: ShopRateInputs = {
  monthly_rent: 0,
  monthly_utilities: 0,
  monthly_insurance: 0,
  monthly_equipment: 0,
  monthly_misc_overhead: 0,
  owner_salary: 0,
  total_payroll: 0,
  target_profit_pct: 20,
  working_days_per_month: 21,
  hours_per_day: 8,
}

// TODO: Replace with actual org_id from auth
const TEMP_ORG_ID = 'temp'

export default function SettingsPage() {
  const [inputs, setInputs] = useState<ShopRateInputs>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const result = computeShopRate({
    monthlyRent: inputs.monthly_rent,
    monthlyUtilities: inputs.monthly_utilities,
    monthlyInsurance: inputs.monthly_insurance,
    monthlyEquipment: inputs.monthly_equipment,
    monthlyMisc: inputs.monthly_misc_overhead,
    ownerSalary: inputs.owner_salary,
    totalPayroll: inputs.total_payroll,
    targetProfitPct: inputs.target_profit_pct,
    workingDaysPerMonth: inputs.working_days_per_month,
    hoursPerDay: inputs.hours_per_day,
  })

  function updateField(field: keyof ShopRateInputs, value: string) {
    const num = parseFloat(value) || 0
    setInputs(prev => ({ ...prev, [field]: num }))
    setSaved(false)
  }

  function InputRow({ label, field, prefix, suffix }: { label: string; field: keyof ShopRateInputs; prefix?: string; suffix?: string }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-[#F3F4F6] last:border-b-0">
        <label className="text-sm text-[#6B7280]">{label}</label>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-sm text-[#9CA3AF]">{prefix}</span>}
          <input
            type="number"
            value={inputs[field] || ''}
            onChange={e => updateField(field, e.target.value)}
            className="w-28 text-right px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            placeholder="0"
          />
          {suffix && <span className="text-sm text-[#9CA3AF]">{suffix}</span>}
        </div>
      </div>
    )
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
              <span>Profit: ${(result.shopRate - result.costPerHour).toFixed(2)}/hr</span>
              <span>·</span>
              <span>{result.productionHoursPerMonth} hrs/mo</span>
            </div>
          </div>

          <div className="px-6 py-4">
            {/* Fixed Costs */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Monthly Fixed Costs</h3>
              <InputRow label="Rent / Mortgage" field="monthly_rent" prefix="$" />
              <InputRow label="Utilities" field="monthly_utilities" prefix="$" />
              <InputRow label="Insurance" field="monthly_insurance" prefix="$" />
              <InputRow label="Equipment / Leases" field="monthly_equipment" prefix="$" />
              <InputRow label="Other Overhead" field="monthly_misc_overhead" prefix="$" />
              <div className="flex items-center justify-between py-3 border-t border-[#E5E7EB] mt-2">
                <span className="text-sm font-medium text-[#111]">Total Overhead</span>
                <span className="text-sm font-mono tabular-nums font-semibold">${result.monthlyOverhead.toLocaleString()}/mo</span>
              </div>
            </div>

            {/* Labor */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Monthly Labor</h3>
              <InputRow label="Owner Salary" field="owner_salary" prefix="$" />
              <InputRow label="Total Payroll (all employees)" field="total_payroll" prefix="$" />
              <div className="flex items-center justify-between py-3 border-t border-[#E5E7EB] mt-2">
                <span className="text-sm font-medium text-[#111]">Total Labor Cost</span>
                <span className="text-sm font-mono tabular-nums font-semibold">${result.monthlyLaborCost.toLocaleString()}/mo</span>
              </div>
            </div>

            {/* Production */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Production Capacity</h3>
              <InputRow label="Working Days / Month" field="working_days_per_month" />
              <InputRow label="Hours / Day" field="hours_per_day" />
              <InputRow label="Target Profit" field="target_profit_pct" suffix="%" />
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
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">+ {inputs.target_profit_pct}% profit</span>
                  <span className="font-mono tabular-nums">${(result.shopRate - result.costPerHour).toFixed(2)}</span>
                </div>
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
            <p className="text-xs text-[#9CA3AF] mt-0.5">Applied to all new subprojects</p>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between py-3">
              <label className="text-sm text-[#6B7280]">Consumable Markup</label>
              <div className="flex items-center gap-1">
                <input type="number" defaultValue={15} className="w-20 text-right px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Default Profit Margin</label>
              <div className="flex items-center gap-1">
                <input type="number" defaultValue={35} className="w-20 text-right px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

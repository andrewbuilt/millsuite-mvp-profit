'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Nav from '@/components/nav'
import { computeShopRate } from '@/lib/pricing'
import { Copy, Check, ArrowRight, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { PLAN_LABELS, PLAN_SEAT_PRICE, PLAN_SEAT_MINIMUM, type Plan } from '@/lib/feature-flags'

// ── Field config for overhead inputs ──

const OVERHEAD_FIELDS: { key: string; label: string }[] = [
  { key: 'monthly_rent', label: 'Rent / Mortgage' },
  { key: 'monthly_utilities', label: 'Utilities' },
  { key: 'monthly_insurance', label: 'Insurance' },
  { key: 'monthly_equipment', label: 'Equipment / Leases' },
  { key: 'monthly_misc_overhead', label: 'Other Overhead' },
]

const inputClass = "w-32 text-right px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"

// ── Team member type (from users table) ──

interface TeamMember {
  id: string
  name: string
  hourly_cost: number | null
  is_billable: boolean
}

// ── Page ──

export default function SettingsPage() {
  const { org, refreshOrg } = useAuth()

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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [seatCount, setSeatCount] = useState(1)
  const [consumableMarkup, setConsumableMarkup] = useState('15')
  const [profitMargin, setProfitMargin] = useState('35')

  // Business Info fields
  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessCity, setBusinessCity] = useState('')
  const [businessState, setBusinessState] = useState('')
  const [businessZip, setBusinessZip] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')

  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load from Supabase on mount ──

  useEffect(() => {
    if (!org?.id) return
    async function load() {
      // Load settings and team separately to avoid .single() killing both
      const { data } = await supabase
        .from('shop_rate_settings')
        .select('*')
        .eq('org_id', org!.id)
        .maybeSingle()

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, role, hourly_cost, is_billable')
        .eq('org_id', org!.id)
        .order('name')

      if (usersError) console.warn('Users query error:', usersError.message)

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
      }

      // Filter out the owner (they have their own salary field)
      const teamOnly = (users || []).filter((u: any) => u.role !== 'owner')
      setTeamMembers(teamOnly)

      // Total seat count = all users (owner + team). Every user is a seat.
      setSeatCount((users || []).length || 1)

      // Load org defaults for consumable markup & profit margin
      setConsumableMarkup(org!.consumable_markup_pct?.toString() || '15')
      setProfitMargin(org!.profit_margin_pct?.toString() || '35')

      // Load business info from org
      setBusinessName(org!.name || '')
      setBusinessAddress((org as any).business_address || '')
      setBusinessCity((org as any).business_city || '')
      setBusinessState((org as any).business_state || '')
      setBusinessZip((org as any).business_zip || '')
      setBusinessPhone((org as any).business_phone || '')
      setBusinessEmail((org as any).business_email || '')

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

  // ── Computed from team members (users table) ──

  const totalAnnualPayroll = teamMembers.reduce((sum, m) => sum + (m.hourly_cost || 0), 0)
  const totalMonthlyPayroll = totalAnnualPayroll / 12
  const billableMembers = teamMembers.filter(m => m.is_billable !== false)
  const nonBillableMembers = teamMembers.filter(m => m.is_billable === false)
  const billableCount = billableMembers.length + (ownerBillable ? 1 : 0)

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
      total_payroll: totalMonthlyPayroll * 12,
      target_profit_pct: parseFloat(rawValues.target_profit_pct) || 0,
      working_days_per_month: parseFloat(rawValues.working_days_per_month) || 21,
      hours_per_day: parseFloat(rawValues.hours_per_day) || 8,
      computed_shop_rate: shopRate,
      owner_billable: ownerBillable,
      employees_json: JSON.stringify([]), // deprecated: team managed via users table
    }

    const { error: settingsError } = await supabase
      .from('shop_rate_settings')
      .upsert(settingsRow, { onConflict: 'org_id' })

    if (settingsError) {
      console.error('Settings save error:', settingsError)
      // Fallback: try insert if upsert fails
      if (settingsError.code === '23505' || settingsError.message?.includes('duplicate')) {
        await supabase.from('shop_rate_settings').update(settingsRow).eq('org_id', org.id)
      }
    }

    const { error: orgError } = await supabase
      .from('orgs')
      .update({
        shop_rate: Math.round(shopRate * 100) / 100,
        consumable_markup_pct: parseFloat(consumableMarkup) || 0,
        profit_margin_pct: parseFloat(profitMargin) || 0,
        name: businessName.trim() || undefined,
        business_address: businessAddress.trim(),
        business_city: businessCity.trim(),
        business_state: businessState.trim(),
        business_zip: businessZip.trim(),
        business_phone: businessPhone.trim(),
        business_email: businessEmail.trim(),
      })
      .eq('id', org.id)

    if (orgError) console.error('Org save error:', orgError)

    await refreshOrg()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [org?.id, loaded, rawValues, shopRate, ownerBillable, teamMembers, consumableMarkup, profitMargin, businessName, businessAddress, businessCity, businessState, businessZip, businessPhone, businessEmail])

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

        {/* Plan & Billing */}
        {(() => {
          const currentPlan = ((org?.plan as Plan) || 'starter') as Plan
          const seatPrice = PLAN_SEAT_PRICE[currentPlan] ?? 12
          const monthlyCost = seatPrice * Math.max(seatCount, PLAN_SEAT_MINIMUM[currentPlan] ?? 1)
          const tiers: { key: Plan; tagline: string; unlocks: string[]; coming?: string[] }[] = [
            {
              key: 'starter',
              tagline: 'Profit-first basics',
              unlocks: [
                'Shop rate calculator',
                'Projects + subproject pricing',
                'Time tracking (desktop + mobile)',
                'Printable estimates',
                'Invoice parsing',
                '2 AI shop reports / seat / mo',
              ],
            },
            {
              key: 'pro',
              tagline: 'Run the whole shop',
              unlocks: [
                'Everything in Starter',
                'Leads Kanban + sold handoff',
                'Pre-production selections',
                'Client portal w/ sign-off',
                'Department scheduling + capacity',
                'Team roles + rate book',
              ],
            },
            {
              key: 'pro-ai',
              tagline: 'Early access to AI',
              unlocks: [
                'Everything in Pro',
                'Unlimited AI shop reports',
                'Priority support',
                'Early access: AI estimating',
              ],
              coming: ['Drawing parser', 'Learning loop', 'Custom AI reports'],
            },
          ]
          const planIndex = tiers.findIndex(t => t.key === currentPlan)
          return (
            <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">Plan &amp; Billing</h2>
                  <p className="text-xs text-[#9CA3AF] mt-0.5">What you're on, what you're paying, what you could unlock</p>
                </div>
                <a
                  href="mailto:hello@millsuite.com?subject=MillSuite%20billing"
                  className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                >
                  Contact billing →
                </a>
              </div>

              {/* Current plan hero */}
              <div className="px-6 py-5 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-1">Current Plan</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold text-[#111]">{PLAN_LABELS[currentPlan]}</span>
                    {currentPlan === 'pro-ai' && <Sparkles className="w-4 h-4 text-[#2563EB]" />}
                  </div>
                  <div className="text-xs text-[#6B7280] mt-1">
                    {seatCount} {seatCount === 1 ? 'seat' : 'seats'} × ${seatPrice}/mo
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-1">Est. Monthly</div>
                  <div className="text-3xl font-mono tabular-nums font-semibold text-[#111]">
                    ${monthlyCost.toLocaleString()}
                    <span className="text-sm text-[#9CA3AF] font-normal">/mo</span>
                  </div>
                </div>
              </div>

              {/* Tier comparison */}
              <div className="px-6 py-4">
                <div className="grid grid-cols-3 gap-3">
                  {tiers.map((t, i) => {
                    const isCurrent = t.key === currentPlan
                    const isDowngrade = i < planIndex
                    const isUpgrade = i > planIndex
                    return (
                      <div
                        key={t.key}
                        className={`rounded-xl border p-4 ${
                          isCurrent ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-semibold ${isCurrent ? 'text-[#2563EB]' : 'text-[#111]'}`}>
                            {PLAN_LABELS[t.key]}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-medium text-[#2563EB] uppercase tracking-wider">Current</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#6B7280] mb-2">{t.tagline}</div>
                        <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                          ${PLAN_SEAT_PRICE[t.key]}
                          <span className="text-[11px] text-[#9CA3AF] font-normal">/seat/mo</span>
                        </div>
                        <ul className="mt-3 space-y-1">
                          {t.unlocks.map(f => (
                            <li key={f} className="text-[11px] text-[#6B7280] flex items-start gap-1.5">
                              <Check className="w-3 h-3 text-[#059669] mt-0.5 flex-shrink-0" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                        {t.coming && t.coming.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-dashed border-[#E5E7EB]">
                            <div className="text-[9px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">Coming Later</div>
                            <ul className="space-y-0.5">
                              {t.coming.map(f => (
                                <li key={f} className="text-[10px] text-[#9CA3AF]">· {f}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {isUpgrade && (
                          <a
                            href={`/api/checkout?plan=${t.key}&seats=${seatCount}`}
                            className="mt-3 w-full block text-center px-3 py-1.5 bg-[#111] text-white text-xs font-medium rounded-lg hover:bg-[#2563EB] transition-colors"
                          >
                            Upgrade
                          </a>
                        )}
                        {isDowngrade && (
                          <a
                            href={`mailto:hello@millsuite.com?subject=Downgrade%20to%20${encodeURIComponent(PLAN_LABELS[t.key])}`}
                            className="mt-3 w-full block text-center px-3 py-1.5 bg-white border border-[#E5E7EB] text-[#6B7280] text-xs font-medium rounded-lg hover:bg-[#F9FAFB] transition-colors"
                          >
                            Downgrade
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

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

            {/* Team Rollup (managed on Team page) */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">Team</h3>
                <Link href="/team" className="flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium transition-colors">
                  Manage Team <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {teamMembers.length === 0 ? (
                <div className="text-xs text-[#9CA3AF] italic py-4 text-center border border-dashed border-[#E5E7EB] rounded-xl">
                  No team members yet — <Link href="/team" className="text-[#2563EB] hover:underline">add them on the Team page</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {billableMembers.length > 0 && (
                    <div className="flex items-center justify-between bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl px-4 py-3">
                      <div>
                        <span className="text-sm font-medium text-[#059669]">{billableMembers.length} billable</span>
                        {ownerBillable && <span className="text-xs text-[#059669] ml-1">+ owner</span>}
                      </div>
                      <span className="text-sm font-mono tabular-nums font-medium text-[#059669]">
                        ${Math.round(billableMembers.reduce((s, m) => s + (m.hourly_cost || 0), 0) / 12).toLocaleString()}/mo
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-4 py-3">
                    <span className="text-sm font-medium text-[#6B7280]">{nonBillableMembers.length} non-billable</span>
                    <span className="text-sm font-mono tabular-nums text-[#6B7280]">
                      ${Math.round(nonBillableMembers.reduce((s, m) => s + (m.hourly_cost || 0), 0) / 12).toLocaleString()}/mo
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-[#9CA3AF]">Total payroll</span>
                    <span className="text-xs font-mono tabular-nums text-[#6B7280]">${Math.round(totalMonthlyPayroll).toLocaleString()}/mo</span>
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

        {/* Business Info */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Business Info</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">Your business details for estimates and invoices</p>
          </div>
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between py-2">
              <label className="text-sm text-[#6B7280]">Business Name</label>
              <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} className="w-64 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="Your Business Name" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Address</label>
              <input type="text" value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} className="w-64 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="123 Main St" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">City, State, Zip</label>
              <div className="flex items-center gap-2">
                <input type="text" value={businessCity} onChange={e => setBusinessCity(e.target.value)} className="w-28 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="City" />
                <input type="text" value={businessState} onChange={e => setBusinessState(e.target.value)} className="w-16 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="ST" />
                <input type="text" value={businessZip} onChange={e => setBusinessZip(e.target.value)} className="w-20 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="00000" />
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Phone</label>
              <input type="text" value={businessPhone} onChange={e => setBusinessPhone(e.target.value)} className="w-64 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="(555) 123-4567" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Email</label>
              <input type="text" value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} className="w-64 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors" placeholder="info@yourbusiness.com" />
            </div>
          </div>
        </div>

        {/* Team Invite Link */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Team Invite Link</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">Share this link with your team so they can create accounts and start tracking time</p>
          </div>
          <div className="px-6 py-4">
            {(org as any)?.slug ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-sm font-mono text-[#6B7280] truncate">
                  {typeof window !== 'undefined' ? window.location.origin : 'https://millsuite.com'}/join/{(org as any).slug}
                </div>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/join/${(org as any).slug}`
                    navigator.clipboard.writeText(url)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className={`flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    copied
                      ? 'bg-[#059669]/10 text-[#059669]'
                      : 'bg-[#2563EB] text-white hover:bg-[#1D4ED8]'
                  }`}
                >
                  {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy</>}
                </button>
              </div>
            ) : (
              <p className="text-sm text-[#9CA3AF]">Loading...</p>
            )}
            <p className="text-xs text-[#9CA3AF] mt-3">Your team members will sign up with their own email and password. They'll automatically be added to your shop.</p>
          </div>
        </div>

        {/* QuickBooks (Phase 9) */}
        <QuickBooksPanel orgId={org?.id || null} />

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

// ── QuickBooks connection panel (Phase 9) ──
//
// Real Intuit OAuth lives in a follow-up. For MVP we stash a synthetic
// qb_connections row so the reconciliation pipeline (lib/qb-events.ts) can
// operate end-to-end: an org with a connected QB is expected to have a row
// here, the reconciliation page reads the row and surfaces the connected
// realm id. "Connect" stubs a row, "Disconnect" removes it.

interface QbConnection {
  id: string
  realm_id: string
  connected_at: string
  last_polled_at: string | null
}

function QuickBooksPanel({ orgId }: { orgId: string | null }) {
  const [conn, setConn] = useState<QbConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [realmInput, setRealmInput] = useState('')

  const refresh = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const { data } = await supabase
      .from('qb_connections')
      .select('id, realm_id, connected_at, last_polled_at')
      .eq('org_id', orgId)
      .maybeSingle()
    setConn((data as QbConnection | null) ?? null)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleConnect() {
    if (!orgId) return
    setBusy(true)
    const realm = realmInput.trim() || `sim-${Math.random().toString(36).slice(2, 10)}`
    const { error } = await supabase.from('qb_connections').insert({
      org_id: orgId,
      realm_id: realm,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      scope: 'com.intuit.quickbooks.accounting',
      metadata: { stub: true, note: 'Synthetic connection — real OAuth lands in follow-up.' },
    })
    setBusy(false)
    if (error) {
      console.error('QB connect', error)
      alert(`Failed to save QB connection: ${error.message}`)
      return
    }
    setRealmInput('')
    refresh()
  }

  async function handleDisconnect() {
    if (!orgId || !conn) return
    if (!window.confirm('Disconnect QuickBooks? Past QB events stay in your audit log; no new events will be accepted until you reconnect.')) {
      return
    }
    setBusy(true)
    const { error } = await supabase.from('qb_connections').delete().eq('id', conn.id)
    setBusy(false)
    if (error) {
      console.error('QB disconnect', error)
      alert(`Failed to disconnect: ${error.message}`)
      return
    }
    refresh()
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">QuickBooks</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5 max-w-md">
            MillSuite never sends to QuickBooks — it only watches.
            Connect your Intuit realm and we'll match deposits and invoice
            payments back to the milestones you already set on each project.
            Review unmatched events on the{' '}
            <Link href="/qb-reconciliation" className="text-[#2563EB] underline">reconciliation page</Link>.
          </p>
        </div>
        {conn && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-xs font-semibold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
            Connected
          </span>
        )}
      </div>
      <div className="px-6 py-4">
        {loading ? (
          <div className="text-xs text-[#9CA3AF]">Loading connection…</div>
        ) : conn ? (
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <div className="font-mono text-[#111]">{conn.realm_id}</div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Connected {new Date(conn.connected_at).toLocaleString()}
                {conn.last_polled_at ? ` · last poll ${new Date(conn.last_polled_at).toLocaleString()}` : ' · never polled'}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Realm ID (optional — leave blank to simulate)"
              value={realmInput}
              onChange={(e) => setRealmInput(e.target.value)}
              className="flex-1 px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <button
              onClick={handleConnect}
              disabled={busy || !orgId}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {busy ? 'Connecting…' : 'Connect QuickBooks'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

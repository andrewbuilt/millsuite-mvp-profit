'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Nav from '@/components/nav'
import { Copy, Check, Sparkles, Trash2, Plus } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { PLAN_LABELS, PLAN_SEAT_PRICE, PLAN_SEAT_MINIMUM, type Plan } from '@/lib/feature-flags'
import {
  computeBillableHoursYear,
  computeDerivedShopRate,
  countBillable,
  defaultBillableHoursInputs,
  emptyOverheadInputs,
  loadShopRateSetup,
  makeTeamMember,
  saveShopRate,
  saveShopRateInputs,
  sumOverheadAnnual,
  sumTeamAnnualComp,
  type BillableHoursInputs,
  type OverheadInput,
  type OverheadInputs,
  type Period,
  type TeamMember,
} from '@/lib/shop-rate-setup'

const inputClass =
  'w-32 text-right px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors'

// Maps the legacy shop_rate_settings row (if present and the org's
// overhead_inputs is still null) into the new jsonb shape so users who
// configured the old way don't lose their numbers.
function backfillFromLegacy(legacy: any): {
  overhead: OverheadInputs
  team: TeamMember[]
  billable: BillableHoursInputs
} {
  const overhead: OverheadInputs = {}
  const fields: Array<[string, string]> = [
    ['monthly_rent', 'Rent'],
    ['monthly_utilities', 'Utilities'],
    ['monthly_insurance', 'Insurance'],
    ['monthly_equipment', 'Equipment / Leases'],
    ['monthly_misc_overhead', 'Other'],
  ]
  for (const [col, label] of fields) {
    const v = Number(legacy?.[col]) || 0
    if (v > 0) overhead[label] = { amount: v, period: 'monthly' }
  }

  const team: TeamMember[] = []
  const ownerSalary = Number(legacy?.owner_salary) || 0
  if (ownerSalary > 0) {
    team.push(
      makeTeamMember('Owner', ownerSalary, legacy?.owner_billable !== false),
    )
  }

  // Best-effort billable hours mapping. Legacy stored
  // working_days_per_month + hours_per_day; new model is per-week + weeks/yr.
  // Assume a 5-day week and 48 working weeks unless legacy says otherwise.
  const hoursPerDay = Number(legacy?.hours_per_day) || 8
  const daysPerMonth = Number(legacy?.working_days_per_month) || 21
  const weeksPerYear = Math.max(1, Math.round((daysPerMonth * 12) / 5))
  const utilization = legacy?.target_profit_pct
    ? Math.max(0, 100 - Number(legacy.target_profit_pct))
    : 70
  const billable: BillableHoursInputs = {
    hrs_per_week: hoursPerDay * 5,
    weeks_per_year: weeksPerYear,
    utilization_pct: utilization,
  }

  return { overhead, team, billable }
}

export default function SettingsPage() {
  const { org, refreshOrg } = useAuth()

  const [overhead, setOverhead] = useState<OverheadInputs>(emptyOverheadInputs())
  const [team, setTeam] = useState<TeamMember[]>([])
  const [billable, setBillable] = useState<BillableHoursInputs>(
    defaultBillableHoursInputs(),
  )

  const [seatCount, setSeatCount] = useState(1)
  const [consumableMarkup, setConsumableMarkup] = useState('15')
  const [profitMargin, setProfitMargin] = useState('35')

  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessCity, setBusinessCity] = useState('')
  const [businessState, setBusinessState] = useState('')
  const [businessZip, setBusinessZip] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')

  const [copied, setCopied] = useState(false)
  const [savingRate, setSavingRate] = useState(false)
  const [rateSavedAt, setRateSavedAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  // ── Load ──
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const setup = await loadShopRateSetup(org.id)
      if (cancelled) return

      // If the walkthrough has never run AND a legacy shop_rate_settings
      // row exists, backfill once into the new jsonb columns so the
      // user's existing numbers carry over.
      const isFresh =
        Object.keys(setup.overhead || {}).length === 0 &&
        (setup.team || []).length === 0
      if (isFresh) {
        const { data: legacy } = await supabase
          .from('shop_rate_settings')
          .select('*')
          .eq('org_id', org.id)
          .maybeSingle()
        if (!cancelled && legacy) {
          const backfilled = backfillFromLegacy(legacy)
          setOverhead(backfilled.overhead)
          setTeam(backfilled.team)
          setBillable(backfilled.billable)
          // Persist the backfill so the next load reads from jsonb only.
          await saveShopRateInputs(org.id, backfilled)
        } else {
          setOverhead(setup.overhead)
          setTeam(setup.team)
          setBillable(setup.billable)
        }
      } else {
        setOverhead(setup.overhead)
        setTeam(setup.team)
        setBillable(setup.billable)
      }

      // Plan / business / project defaults are still on orgs columns.
      const { count: userCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
      if (!cancelled) setSeatCount(userCount || 1)

      if (!cancelled) {
        setConsumableMarkup(org.consumable_markup_pct?.toString() || '15')
        setProfitMargin(org.profit_margin_pct?.toString() || '35')
        setBusinessName(org.name || '')
        setBusinessAddress((org as any).business_address || '')
        setBusinessCity((org as any).business_city || '')
        setBusinessState((org as any).business_state || '')
        setBusinessZip((org as any).business_zip || '')
        setBusinessPhone((org as any).business_phone || '')
        setBusinessEmail((org as any).business_email || '')
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  // ── Derived shop rate ──
  const derivedRate = useMemo(
    () => computeDerivedShopRate(overhead, team, billable),
    [overhead, team, billable],
  )
  const annualOverhead = useMemo(() => sumOverheadAnnual(overhead), [overhead])
  const annualTeam = useMemo(() => sumTeamAnnualComp(team), [team])
  const billablePeople = useMemo(() => countBillable(team), [team])
  const billableHoursYear = useMemo(
    () => computeBillableHoursYear(billable, billablePeople),
    [billable, billablePeople],
  )

  // ── Persist on change ──
  // Each input edit syncs the in-memory shape to its jsonb column with a
  // small debounce. Keeps the walkthrough's data and the Settings page
  // perfectly aligned.
  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(() => {
      saveShopRateInputs(org.id, { overhead }).catch((e) =>
        console.warn('overhead save', e),
      )
    }, 600)
    return () => clearTimeout(t)
  }, [overhead, org?.id, loaded])

  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(() => {
      saveShopRateInputs(org.id, { team }).catch((e) =>
        console.warn('team save', e),
      )
    }, 600)
    return () => clearTimeout(t)
  }, [team, org?.id, loaded])

  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(() => {
      saveShopRateInputs(org.id, { billable }).catch((e) =>
        console.warn('billable save', e),
      )
    }, 600)
    return () => clearTimeout(t)
  }, [billable, org?.id, loaded])

  // Project defaults + business info + plan markup pcts go on orgs cols.
  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from('orgs')
        .update({
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
      if (error) console.warn('org save', error)
      else await refreshOrg()
    }, 800)
    return () => clearTimeout(t)
  }, [
    consumableMarkup,
    profitMargin,
    businessName,
    businessAddress,
    businessCity,
    businessState,
    businessZip,
    businessPhone,
    businessEmail,
    org?.id,
    loaded,
    refreshOrg,
  ])

  // ── Mutators for the lists ──
  function updateOverheadRow(category: string, patch: Partial<OverheadInput>) {
    setOverhead((prev) => ({
      ...prev,
      [category]: { ...prev[category], ...patch },
    }))
  }
  function renameOverheadRow(oldCat: string, newCat: string) {
    if (!newCat || newCat === oldCat || overhead[newCat]) return
    setOverhead((prev) => {
      const next: OverheadInputs = {}
      for (const [k, v] of Object.entries(prev)) {
        next[k === oldCat ? newCat : k] = v
      }
      return next
    })
  }
  function removeOverheadRow(category: string) {
    setOverhead((prev) => {
      const next = { ...prev }
      delete next[category]
      return next
    })
  }
  function addOverheadRow() {
    let label = 'New category'
    let i = 1
    while (overhead[label]) {
      label = `New category ${++i}`
    }
    setOverhead((prev) => ({
      ...prev,
      [label]: { amount: 0, period: 'monthly' },
    }))
  }

  function addTeamMember() {
    setTeam((prev) => [...prev, makeTeamMember('', 0, true)])
  }
  function updateTeamMember(id: string, patch: Partial<TeamMember>) {
    setTeam((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }
  function removeTeamMember(id: string) {
    setTeam((prev) => prev.filter((m) => m.id !== id))
  }

  // ── Save derived rate to orgs.shop_rate ──
  async function saveDerivedRate() {
    if (!org?.id) return
    setSavingRate(true)
    try {
      await saveShopRate(org.id, Math.round(derivedRate * 100) / 100)
      await refreshOrg()
      setRateSavedAt(Date.now())
    } catch (e: any) {
      console.error('saveShopRate', e)
    } finally {
      setSavingRate(false)
    }
  }

  // ── Render ──
  const fmtMoney = (n: number) =>
    Number.isFinite(n) && n !== 0 ? '$' + Math.round(n).toLocaleString() : '$0'
  const fmtRate = (n: number) =>
    Number.isFinite(n) && n > 0 ? '$' + n.toFixed(2) + '/hr' : '$0/hr'
  const currentRate = Number(org?.shop_rate) || 0
  const rateDelta = Math.abs(derivedRate - currentRate)
  const rateOutOfSync = currentRate > 0 && rateDelta > 0.005

  return (
    <>
      <Nav />
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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

        {/* Shop rate setup — same model as the welcome walkthrough. */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Shop rate setup</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Overhead, team comp, and billable hours. Edits autosave; click
              the save button when the derived rate looks right.
            </p>
          </div>

          {/* Result hero */}
          <div className="px-6 py-6 bg-[#F9FAFB] border-b border-[#E5E7EB]">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-1">
                  Derived shop rate
                </div>
                <div className="text-4xl font-mono tabular-nums font-semibold text-[#111] leading-none">
                  {fmtRate(derivedRate)}
                </div>
                <div className="text-[11.5px] text-[#6B7280] font-mono mt-2">
                  ({fmtMoney(annualTeam)} payroll + {fmtMoney(annualOverhead)} overhead)
                  <br />÷ {Math.round(billableHoursYear).toLocaleString()} billable hr / yr
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-1">
                  Saved as your shop rate
                </div>
                <div className="text-2xl font-mono tabular-nums font-semibold text-[#374151] leading-none">
                  {currentRate > 0 ? fmtRate(currentRate) : '—'}
                </div>
                <button
                  type="button"
                  onClick={saveDerivedRate}
                  disabled={savingRate || derivedRate <= 0}
                  className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-semibold rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                >
                  {savingRate
                    ? 'Saving…'
                    : rateOutOfSync
                      ? `Update to ${fmtRate(derivedRate)}`
                      : 'Save as my shop rate'}
                </button>
                {rateSavedAt && Date.now() - rateSavedAt < 4000 && (
                  <div className="text-[10.5px] text-[#059669] font-medium mt-1.5">Saved.</div>
                )}
              </div>
            </div>
          </div>

          {/* Overhead */}
          <div className="px-6 py-4 border-b border-[#F3F4F6]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Overhead
              </h3>
              <button
                type="button"
                onClick={addOverheadRow}
                className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add category
              </button>
            </div>
            <div className="space-y-1.5">
              {Object.entries(overhead).map(([cat, input]) => (
                <OverheadRow
                  key={cat}
                  category={cat}
                  input={input}
                  onAmount={(amt) => updateOverheadRow(cat, { amount: amt })}
                  onPeriod={(p) => updateOverheadRow(cat, { period: p })}
                  onRename={(next) => renameOverheadRow(cat, next)}
                  onRemove={() => removeOverheadRow(cat)}
                />
              ))}
              {Object.keys(overhead).length === 0 && (
                <div className="text-xs text-[#9CA3AF] italic py-3 text-center">
                  No overhead categories yet. Add one above.
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#F3F4F6] text-sm">
              <span className="text-[#6B7280]">Annual overhead</span>
              <span className="font-mono tabular-nums font-semibold">
                {fmtMoney(annualOverhead)}
              </span>
            </div>
          </div>

          {/* Team & comp */}
          <div className="px-6 py-4 border-b border-[#F3F4F6]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Team &amp; comp
              </h3>
              <button
                type="button"
                onClick={addTeamMember}
                className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add team member
              </button>
            </div>
            <p className="text-[11px] text-[#9CA3AF] leading-snug mb-2">
              Owner counts here too. Billable = Yes for production roles
              (CNC, assembly, finish, install). Office staff and pure-admin
              owner time = No.
            </p>
            <div className="space-y-1.5">
              {team.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg"
                >
                  <input
                    type="text"
                    value={m.name}
                    onChange={(e) => updateTeamMember(m.id, { name: e.target.value })}
                    placeholder="Name"
                    className="flex-1 min-w-0 text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                  />
                  <span className="text-sm text-[#6B7280]">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1000"
                    value={m.annual_comp || ''}
                    placeholder="0"
                    onChange={(e) =>
                      updateTeamMember(m.id, {
                        annual_comp:
                          e.target.value === '' ? 0 : Number(e.target.value),
                      })
                    }
                    className="w-28 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                  />
                  <span className="text-sm text-[#9CA3AF]">/ yr</span>
                  <label className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                    <span className="hidden sm:inline">Billable</span>
                    <select
                      value={m.billable ? 'yes' : 'no'}
                      onChange={(e) =>
                        updateTeamMember(m.id, {
                          billable: e.target.value === 'yes',
                        })
                      }
                      className="text-sm px-1.5 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeTeamMember(m.id)}
                    aria-label={`Remove ${m.name || 'team member'}`}
                    className="text-[#9CA3AF] hover:text-[#991B1B]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {team.length === 0 && (
                <div className="text-xs text-[#9CA3AF] italic py-3 text-center">
                  No team yet. Add yourself as the first member.
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#F3F4F6] text-sm">
              <div>
                <div className="text-[#6B7280]">Annual team comp</div>
                <div className="text-[10.5px] text-[#9CA3AF]">
                  {team.filter((m) => m.billable).length} billable ·{' '}
                  {team.filter((m) => !m.billable).length} non-billable
                </div>
              </div>
              <span className="font-mono tabular-nums font-semibold">
                {fmtMoney(annualTeam)}
              </span>
            </div>
          </div>

          {/* Billable hours */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
              Billable hours
            </h3>
            <BillableInput
              label="Hours per week"
              hint="per person"
              value={billable.hrs_per_week}
              step={1}
              onChange={(n) => setBillable((p) => ({ ...p, hrs_per_week: n }))}
              unit="hr"
            />
            <BillableInput
              label="Working weeks per year"
              hint="52 minus holidays, PTO, shutdowns"
              value={billable.weeks_per_year}
              step={1}
              onChange={(n) => setBillable((p) => ({ ...p, weeks_per_year: n }))}
              unit="wk"
            />
            <BillableInput
              label="Utilization"
              hint="% of hours actually billable"
              value={billable.utilization_pct}
              step={5}
              onChange={(n) => setBillable((p) => ({ ...p, utilization_pct: n }))}
              unit="%"
            />
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#F3F4F6] text-sm">
              <div>
                <div className="text-[#6B7280]">Billable hours / year</div>
                <div className="text-[10.5px] text-[#9CA3AF] font-mono">
                  {billablePeople} × {billable.hrs_per_week || 0} hr ×{' '}
                  {billable.weeks_per_year || 0} wk ×{' '}
                  {billable.utilization_pct || 0}%
                </div>
              </div>
              <span className="font-mono tabular-nums font-semibold">
                {Math.round(billableHoursYear).toLocaleString()} hr
              </span>
            </div>
          </div>
        </div>

        {/* Project defaults */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Project defaults</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Applied to new projects. Each project can override its target margin.
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between py-3">
              <label className="text-sm text-[#6B7280]">Default profit margin</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={profitMargin}
                  onChange={(e) =>
                    setProfitMargin(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Consumable markup</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={consumableMarkup}
                  onChange={(e) =>
                    setConsumableMarkup(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Business Info */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
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
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
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
      </div>
    </>
  )
}

// ── Overhead row ──

function OverheadRow({
  category,
  input,
  onAmount,
  onPeriod,
  onRename,
  onRemove,
}: {
  category: string
  input: OverheadInput
  onAmount: (n: number) => void
  onPeriod: (p: Period) => void
  onRename: (next: string) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(category)
  useEffect(() => {
    setName(category)
  }, [category])

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim()
          if (trimmed && trimmed !== category) onRename(trimmed)
          else setName(category)
        }}
        className="flex-1 min-w-0 text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
      <span className="text-sm text-[#6B7280]">$</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="1"
        value={input.amount || ''}
        placeholder="0"
        onChange={(e) =>
          onAmount(e.target.value === '' ? 0 : Number(e.target.value))
        }
        className="w-24 text-right font-mono tabular-nums text-sm px-2 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
      <select
        value={input.period}
        onChange={(e) => onPeriod(e.target.value as Period)}
        className="text-sm px-1.5 py-1 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      >
        <option value="monthly">/ mo</option>
        <option value="annual">/ yr</option>
      </select>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${category}`}
        className="text-[#9CA3AF] hover:text-[#991B1B]"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Billable hours input ──

function BillableInput({
  label,
  hint,
  value,
  step,
  unit,
  onChange,
}: {
  label: string
  hint: string
  value: number
  step: number
  unit: string
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center gap-3 px-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg mb-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#111]">{label}</div>
        <div className="text-[11px] text-[#9CA3AF]">{hint}</div>
      </div>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value || ''}
        placeholder="0"
        onChange={(e) =>
          onChange(e.target.value === '' ? 0 : Number(e.target.value))
        }
        className="w-24 text-right font-mono tabular-nums text-sm px-2 py-1.5 bg-white border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
      <span className="text-sm text-[#9CA3AF] w-6">{unit}</span>
    </label>
  )
}

// ── QuickBooks connection panel (Phase 9) ──

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
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">QuickBooks</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5 max-w-md">
            MillSuite never sends to QuickBooks. It only watches.
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
              placeholder="Realm ID (optional, leave blank to simulate)"
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

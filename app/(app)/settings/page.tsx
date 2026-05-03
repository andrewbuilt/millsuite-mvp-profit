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
import SolidWoodTopWalkthrough from '@/components/walkthroughs/SolidWoodTopWalkthrough'
import BillingSection from '@/components/billing-section'

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

  // Invoicing settings — feed the create-invoice modal prefill and the
  // numbering sequence. nextInvoiceNumber is shown read-only with a
  // confirm-gated reset; the rest are free-form.
  const [invoicePrefix, setInvoicePrefix] = useState('')
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState(1)
  const [defaultTaxPct, setDefaultTaxPct] = useState('')
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState('14')
  const [invoiceFooterText, setInvoiceFooterText] = useState('')
  const [invoiceEmailTemplate, setInvoiceEmailTemplate] = useState('')

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

        // Invoicing — pulled with a fresh select since the auth Org type
        // doesn't expose these columns yet.
        const { data: invSettings } = await supabase
          .from('orgs')
          .select(
            'invoice_prefix, next_invoice_number, default_tax_pct, default_payment_terms_days, invoice_footer_text, invoice_email_template',
          )
          .eq('id', org.id)
          .single()
        if (invSettings && !cancelled) {
          setInvoicePrefix(invSettings.invoice_prefix || '')
          setNextInvoiceNumber(Number(invSettings.next_invoice_number) || 1)
          setDefaultTaxPct(
            invSettings.default_tax_pct == null
              ? ''
              : String(invSettings.default_tax_pct),
          )
          setDefaultPaymentTermsDays(
            String(Number(invSettings.default_payment_terms_days) || 14),
          )
          setInvoiceFooterText(invSettings.invoice_footer_text || '')
          setInvoiceEmailTemplate(invSettings.invoice_email_template || '')
        }
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

  // Invoicing settings — separate debounce so the heavier invoice-prefix
  // change doesn't piggyback on the project-defaults effect's deps.
  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(async () => {
      const taxNum = defaultTaxPct.trim() === '' ? null : Number(defaultTaxPct)
      const termsNum = Math.max(0, parseInt(defaultPaymentTermsDays, 10) || 14)
      const { error } = await supabase
        .from('orgs')
        .update({
          invoice_prefix: invoicePrefix.trim() || null,
          default_tax_pct: taxNum != null && !Number.isNaN(taxNum) ? taxNum : null,
          default_payment_terms_days: termsNum,
          invoice_footer_text: invoiceFooterText.trim() || null,
          invoice_email_template: invoiceEmailTemplate.trim() || null,
        })
        .eq('id', org.id)
      if (error) console.warn('invoicing save', error)
    }, 800)
    return () => clearTimeout(t)
  }, [
    invoicePrefix,
    defaultTaxPct,
    defaultPaymentTermsDays,
    invoiceFooterText,
    invoiceEmailTemplate,
    org?.id,
    loaded,
  ])

  async function handleResetInvoiceNumber() {
    if (!org?.id) return
    const ok = window.confirm(
      'Reset the next invoice number to 1? Future invoices will start at INV-0001 (or your prefix). Existing invoices keep their numbers.',
    )
    if (!ok) return
    const { error } = await supabase
      .from('orgs')
      .update({ next_invoice_number: 1 })
      .eq('id', org.id)
    if (!error) setNextInvoiceNumber(1)
    else console.warn('reset invoice number', error)
  }

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
          const seatPrice = PLAN_SEAT_PRICE[currentPlan] ?? 40
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
                        {(isUpgrade || isDowngrade) && (
                          <p className="mt-3 text-[10px] text-[#9CA3AF] text-center leading-snug">
                            Use <span className="font-medium text-[#6B7280]">Manage subscription</span> in the
                            Subscription card above to switch plans (Stripe handles proration).
                          </p>
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

        {/* Subscription / Billing */}
        <BillingSection />

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

        {/* Invoicing */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <h2 className="text-base font-semibold">Invoicing</h2>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Defaults applied when generating an invoice from a project milestone.
            </p>
          </div>
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-center justify-between py-2">
              <label className="text-sm text-[#6B7280]">
                Invoice number prefix
                <span className="block text-[11px] text-[#9CA3AF] font-normal">
                  Defaults to "INV-" when blank
                </span>
              </label>
              <input
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                placeholder="INV-"
                className="w-32 px-3 py-2 text-sm font-mono bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">
                Next invoice number
                <span className="block text-[11px] text-[#9CA3AF] font-normal">
                  Bumps automatically as invoices are created
                </span>
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-sm text-[#111] tabular-nums px-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg w-32 text-right">
                  {String(nextInvoiceNumber).padStart(4, '0')}
                </span>
                <button
                  type="button"
                  onClick={handleResetInvoiceNumber}
                  className="text-[12px] text-[#9CA3AF] hover:text-[#DC2626]"
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Default tax %</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={defaultTaxPct}
                  onChange={(e) =>
                    setDefaultTaxPct(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  placeholder="0"
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Default payment terms</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={defaultPaymentTermsDays}
                  onChange={(e) =>
                    setDefaultPaymentTermsDays(e.target.value.replace(/[^0-9]/g, ''))
                  }
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">days</span>
              </div>
            </div>
            <div className="py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280] block mb-1.5">
                Invoice footer text
                <span className="block text-[11px] text-[#9CA3AF] font-normal">
                  Appears at the bottom of every invoice (terms, thank-you note, etc.)
                </span>
              </label>
              <textarea
                value={invoiceFooterText}
                onChange={(e) => setInvoiceFooterText(e.target.value)}
                rows={3}
                placeholder="Payment due within 14 days. Make checks payable to ${business name}."
                className="w-full px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none"
              />
            </div>
            <div className="py-2 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280] block mb-1.5">
                Email template body
                <span className="block text-[11px] text-[#9CA3AF] font-normal">
                  Used by the "copy email" affordance once PDF send ships in the next release.
                </span>
              </label>
              <textarea
                value={invoiceEmailTemplate}
                onChange={(e) => setInvoiceEmailTemplate(e.target.value)}
                rows={4}
                placeholder="Hi ${client name},&#10;Attached is invoice ${invoice number} for ${project name}. Let me know if you have any questions.&#10;Thanks!"
                className="w-full px-3 py-2 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none"
              />
            </div>
          </div>
        </div>

        {/* Active departments */}
        <DepartmentsSection orgId={org?.id} />

        {/* Holidays & PTO — feeds capacity_overrides which /capacity reads
            to reduce monthly working days + subtract PTO hours. */}
        <HolidaysAndPtoSection orgId={org?.id} />

        {/* Solid Wood Top calibration — opens SolidWoodTopWalkthrough; the
            composer uses this row to scale per-piece labor by BdFt. */}
        <SolidWoodTopCalibrationSection orgId={org?.id} />

        {/* Drawing parser limits */}
        <ParserLimitsSection orgId={org?.id} />

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


// ── Drawing parser limits section ────────────────────────────────────────
// Shows the org's daily cap + today's usage. Read-only — V1 caps are
// per-plan defaults configured at the org level. Click "View pricing"
// to see plan tiers when the cap feels low.

function ParserLimitsSection({ orgId }: { orgId: string | undefined }) {
  const [cap, setCap] = useState<number>(50)
  const [used, setUsed] = useState<number>(0)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const today = new Date().toISOString().slice(0, 10)
      const [orgRes, usageRes] = await Promise.all([
        supabase
          .from('orgs')
          .select('daily_parse_cap')
          .eq('id', orgId)
          .single(),
        supabase
          .from('parse_call_log')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('call_date', today)
          .in('status', ['success', 'rate_limited']),
      ])
      if (cancelled) return
      setCap(Number((orgRes.data as any)?.daily_parse_cap) || 50)
      setUsed(usageRes.count ?? 0)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold">Drawing parser</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Daily cap on /api/parse-drawings calls. Failed parses don&apos;t count.
        </p>
      </div>
      <div className="px-6 py-4">
        <div className="flex items-center justify-between py-2">
          <label className="text-sm text-[#6B7280]">Daily drawing parse limit</label>
          <div className="text-sm font-mono tabular-nums text-[#111]">
            {loaded ? `${cap} parses / day (your plan)` : 'Loading…'}
          </div>
        </div>
        <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
          <label className="text-sm text-[#6B7280]">Used today</label>
          <div className="flex items-center gap-3">
            <div className="text-sm font-mono tabular-nums text-[#111]">
              {loaded ? `${used} / ${cap}` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Departments section ──────────────────────────────────────────────────
// Toggling a dept off sets active=false; schedule/time-clock/capacity
// already filter on active=true so the row drops out everywhere.
// Don't delete — that would orphan time_entries.

function DepartmentsSection({ orgId }: { orgId: string | undefined }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; active: boolean; display_order: number }>>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('departments')
        .select('id, name, active, display_order')
        .eq('org_id', orgId)
        .order('display_order')
      if (cancelled) return
      setRows((data || []) as any[])
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function toggle(id: string, next: boolean) {
    setBusyId(id)
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, active: next } : r)))
    const { error } = await supabase
      .from('departments')
      .update({ active: next })
      .eq('id', id)
    setBusyId(null)
    if (error) {
      // Roll back optimistic update on failure.
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, active: !next } : r)))
      console.warn('toggle department', error)
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold">Active departments</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Departments your shop runs. Inactive ones drop out of schedule, time
          clock, and capacity. Existing time entries are preserved.
        </p>
      </div>
      <div className="px-6 py-4">
        {!loaded ? (
          <div className="text-xs text-[#9CA3AF]">Loading departments…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-[#9CA3AF] italic">
            No departments yet. They seed automatically on signup; if your
            org pre-dates that seed, add them in the schedule page first.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <label
                key={r.id}
                className="flex items-center gap-3 py-1.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={r.active}
                  disabled={busyId === r.id}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB]"
                />
                <span
                  className={`text-sm ${
                    r.active ? 'text-[#111]' : 'text-[#9CA3AF] line-through'
                  }`}
                >
                  {r.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Holidays & PTO section ───────────────────────────────────────────────
// Feeds the capacity_overrides table, which app/(app)/capacity/page.tsx
// reads to reduce monthly working days (holidays) and subtract individual
// PTO hours from the rolled-up monthly capacity.
//
// Holidays = team_member_id NULL. Apply to everyone (or one dept if
// department_id is set; not surfaced in V1 UI). Each holiday drops one
// working day from every billable member's effective capacity.
//
// PTO = team_member_id NOT NULL. Subtracts hours_reduction (or 8h
// default when 0) from the month's totalCapacity.

interface OverrideRow {
  id: string
  override_date: string
  team_member_id: string | null
  department_id: string | null
  reason: string
  hours_reduction: number
}

const HOLIDAY_HOURS_DEFAULT = 8

function HolidaysAndPtoSection({ orgId }: { orgId: string | undefined }) {
  const [rows, setRows] = useState<OverrideRow[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loaded, setLoaded] = useState(false)

  // Inline-add form state — one form per list, both null when closed.
  const [holidayDraft, setHolidayDraft] = useState<{ date: string; reason: string } | null>(null)
  const [ptoDraft, setPtoDraft] = useState<{
    member_id: string
    date: string
    reason: string
    hours: string
  } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const [{ data }, setup] = await Promise.all([
        supabase
          .from('capacity_overrides')
          .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
          .eq('org_id', orgId)
          .order('override_date', { ascending: true }),
        loadShopRateSetup(orgId),
      ])
      if (cancelled) return
      setRows((data || []) as OverrideRow[])
      setTeam(setup.team)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const billableMembers = useMemo(
    () => team.filter((m) => m.billable && m.name.trim().length > 0),
    [team],
  )
  const memberById = useMemo(() => {
    const m: Record<string, TeamMember> = {}
    for (const t of team) m[t.id] = t
    return m
  }, [team])

  const holidays = rows.filter((r) => r.team_member_id == null)
  const ptos = rows.filter((r) => r.team_member_id != null)

  async function addHoliday() {
    if (!orgId || !holidayDraft) return
    if (!holidayDraft.date) return
    setSaving(true)
    const { data, error } = await supabase
      .from('capacity_overrides')
      .insert({
        org_id: orgId,
        override_date: holidayDraft.date,
        team_member_id: null,
        reason: holidayDraft.reason.trim(),
        hours_reduction: 0,
        is_full_day: true,
      })
      .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
      .single()
    setSaving(false)
    if (error || !data) {
      console.warn('addHoliday', error)
      return
    }
    setRows((prev) => [...prev, data as OverrideRow])
    setHolidayDraft(null)
  }

  async function addPto() {
    if (!orgId || !ptoDraft) return
    if (!ptoDraft.member_id || !ptoDraft.date) return
    const parsed = Number(ptoDraft.hours)
    const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    setSaving(true)
    const { data, error } = await supabase
      .from('capacity_overrides')
      .insert({
        org_id: orgId,
        override_date: ptoDraft.date,
        team_member_id: ptoDraft.member_id,
        reason: ptoDraft.reason.trim(),
        hours_reduction: hours,
        is_full_day: hours === 0,
      })
      .select('id, override_date, team_member_id, department_id, reason, hours_reduction')
      .single()
    setSaving(false)
    if (error || !data) {
      console.warn('addPto', error)
      return
    }
    setRows((prev) => [...prev, data as OverrideRow])
    setPtoDraft(null)
  }

  async function remove(id: string) {
    const prev = rows
    setRows((p) => p.filter((r) => r.id !== id))
    const { error } = await supabase.from('capacity_overrides').delete().eq('id', id)
    if (error) {
      console.warn('remove override', error)
      setRows(prev) // roll back
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold">Holidays &amp; PTO</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Reduce a month's effective capacity. Holidays drop one working day
          for everyone. PTO subtracts a person's hours from the month.
        </p>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Company holidays */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#111]">Company holidays</h3>
            {!holidayDraft && (
              <button
                onClick={() => setHolidayDraft({ date: '', reason: '' })}
                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add holiday
              </button>
            )}
          </div>

          {!loaded ? (
            <div className="text-xs text-[#9CA3AF]">Loading…</div>
          ) : (
            <>
              {holidays.length === 0 && !holidayDraft && (
                <div className="text-xs text-[#9CA3AF] italic py-1">No holidays yet.</div>
              )}
              <div className="space-y-1">
                {holidays.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 py-1 text-sm"
                  >
                    <span className="font-mono tabular-nums text-[#111] w-28">
                      {h.override_date}
                    </span>
                    <span className="flex-1 text-[#374151]">{h.reason || '—'}</span>
                    <button
                      onClick={() => remove(h.id)}
                      className="text-[#9CA3AF] hover:text-[#DC2626] p-1"
                      title="Delete holiday"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {holidayDraft && (
                  <div className="flex items-center gap-2 py-1">
                    <input
                      type="date"
                      value={holidayDraft.date}
                      onChange={(e) =>
                        setHolidayDraft({ ...holidayDraft, date: e.target.value })
                      }
                      className="px-2 py-1 text-sm font-mono bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Reason (e.g. Independence Day)"
                      value={holidayDraft.reason}
                      onChange={(e) =>
                        setHolidayDraft({ ...holidayDraft, reason: e.target.value })
                      }
                      className="flex-1 px-3 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={addHoliday}
                      disabled={saving || !holidayDraft.date}
                      className="px-3 py-1 text-xs font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setHolidayDraft(null)}
                      className="px-2 py-1 text-xs text-[#6B7280] hover:text-[#111]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* PTO */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[#111]">Time off</h3>
            {!ptoDraft && billableMembers.length > 0 && (
              <button
                onClick={() =>
                  setPtoDraft({
                    member_id: billableMembers[0]?.id ?? '',
                    date: '',
                    reason: '',
                    hours: String(HOLIDAY_HOURS_DEFAULT),
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add PTO
              </button>
            )}
          </div>

          {!loaded ? (
            <div className="text-xs text-[#9CA3AF]">Loading…</div>
          ) : billableMembers.length === 0 ? (
            <div className="text-xs text-[#9CA3AF] italic">
              Add billable team members on the Team page first.
            </div>
          ) : (
            <>
              {ptos.length === 0 && !ptoDraft && (
                <div className="text-xs text-[#9CA3AF] italic py-1">No PTO yet.</div>
              )}
              <div className="space-y-1">
                {ptos.map((p) => {
                  const member = p.team_member_id ? memberById[p.team_member_id] : null
                  const hoursDisplay =
                    p.hours_reduction > 0 ? `${p.hours_reduction}h` : `${HOLIDAY_HOURS_DEFAULT}h`
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-1 text-sm">
                      <span className="text-[#111] w-32 truncate">
                        {member?.name ?? 'Unknown'}
                      </span>
                      <span className="font-mono tabular-nums text-[#111] w-28">
                        {p.override_date}
                      </span>
                      <span className="flex-1 text-[#374151] truncate">
                        {p.reason || '—'}
                      </span>
                      <span className="font-mono tabular-nums text-[#6B7280] w-12 text-right">
                        {hoursDisplay}
                      </span>
                      <button
                        onClick={() => remove(p.id)}
                        className="text-[#9CA3AF] hover:text-[#DC2626] p-1"
                        title="Delete PTO"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
                {ptoDraft && (
                  <div className="flex items-center gap-2 py-1">
                    <select
                      value={ptoDraft.member_id}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, member_id: e.target.value })
                      }
                      className="px-2 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] w-32"
                    >
                      {billableMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={ptoDraft.date}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, date: e.target.value })
                      }
                      className="px-2 py-1 text-sm font-mono bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="text"
                      placeholder="Reason"
                      value={ptoDraft.reason}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, reason: e.target.value })
                      }
                      className="flex-1 px-3 py-1 text-sm bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <input
                      type="number"
                      placeholder="Hours"
                      value={ptoDraft.hours}
                      onChange={(e) =>
                        setPtoDraft({ ...ptoDraft, hours: e.target.value })
                      }
                      className="w-16 px-2 py-1 text-sm font-mono text-right bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
                    />
                    <button
                      onClick={addPto}
                      disabled={saving || !ptoDraft.member_id || !ptoDraft.date}
                      className="px-3 py-1 text-xs font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setPtoDraft(null)}
                      className="px-2 py-1 text-xs text-[#6B7280] hover:text-[#111]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Solid Wood Top calibration section ──────────────────────────────
// Surfaces the SolidWoodTopWalkthrough alongside the other settings.
// Shows whether the org has run the walkthrough yet (so the operator
// knows the composer's solid-wood-top product is ready to price).

function SolidWoodTopCalibrationSection({ orgId }: { orgId: string | undefined }) {
  const [calibrated, setCalibrated] = useState<boolean | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!orgId) return
    const { data } = await supabase
      .from('solid_wood_top_calibrations')
      .select('updated_at')
      .eq('org_id', orgId)
      .maybeSingle()
    if (data) {
      setCalibrated(true)
      setUpdatedAt((data as any).updated_at ?? null)
    } else {
      setCalibrated(false)
      setUpdatedAt(null)
    }
  }, [orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Solid Wood Top calibration</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5">
            Per-op labor for one typical top — composer scales by BdFt on
            every line.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {calibrated === true && (
            <span className="text-[11px] text-[#059669] font-mono">Calibrated</span>
          )}
          {calibrated === false && (
            <span className="text-[11px] text-[#9CA3AF] font-mono">Not yet</span>
          )}
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8]"
          >
            {calibrated ? 'Recalibrate' : 'Calibrate'}
          </button>
        </div>
      </div>
      {updatedAt && (
        <div className="px-6 py-2 text-[11px] text-[#9CA3AF] font-mono">
          Last updated {new Date(updatedAt).toLocaleString()}
        </div>
      )}
      {open && orgId && (
        <SolidWoodTopWalkthrough
          orgId={orgId}
          onCancel={() => setOpen(false)}
          onComplete={async () => {
            setOpen(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

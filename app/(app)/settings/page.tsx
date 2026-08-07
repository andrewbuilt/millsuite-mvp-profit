'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Copy, Check, Sparkles, Trash2, Plus } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { supabase } from '@/lib/supabase'
import { invoicingMode, type InvoicingMode } from '@/lib/org-settings'
import { updateOrgChecked, awaitPendingOrgWrites } from '@/lib/org-write'
import { saveChangedComp } from '@/lib/team-comp'
import { useAutosave, type Autosave } from '@/hooks/use-autosave'
import SaveStatus from '@/components/save-status'
import {
  PLAN_LABELS,
  PLAN_SEAT_PRICE,
  PLAN_SEAT_MINIMUM,
  isInternalPlan,
  type Plan,
} from '@/lib/feature-flags'
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
  saveTeamMembersMerged,
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
  const { confirm } = useConfirm()

  const [overhead, setOverhead] = useState<OverheadInputs>(emptyOverheadInputs())
  const [team, setTeam] = useState<TeamMember[]>([])
  const [billable, setBillable] = useState<BillableHoursInputs>(
    defaultBillableHoursInputs(),
  )

  const [seatCount, setSeatCount] = useState(1)
  const [consumableMarkup, setConsumableMarkup] = useState('10')
  // Per-bucket margin defaults (migration 052). Each applies as a true
  // gross margin to its cost group on new projects; a project can pin its
  // own. profit_margin_pct is the legacy single knob, kept only as a
  // fallback for orgs not yet migrated.
  const [laborMargin, setLaborMargin] = useState('35')
  const [materialMargin, setMaterialMargin] = useState('35')
  const [consumableMargin, setConsumableMargin] = useState('35')

  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessCity, setBusinessCity] = useState('')
  const [businessState, setBusinessState] = useState('')
  const [businessZip, setBusinessZip] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [businessEmail, setBusinessEmail] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState('')

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLogoBusy(true)
    setLogoError('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/org/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Upload failed.')
      await refreshOrg()
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Logo upload failed.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    setLogoBusy(true)
    setLogoError('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      await fetch('/api/org/logo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      await refreshOrg()
    } finally {
      setLogoBusy(false)
    }
  }

  // Invoicing settings — feed the create-invoice modal prefill and the
  // numbering sequence. nextInvoiceNumber is shown read-only with a
  // confirm-gated reset; the rest are free-form.
  const [invoicePrefix, setInvoicePrefix] = useState('')
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState(1)
  const [defaultTaxPct, setDefaultTaxPct] = useState('')
  const [defaultPaymentTermsDays, setDefaultPaymentTermsDays] = useState('14')
  const [invoiceFooterText, setInvoiceFooterText] = useState('')
  const [invoiceEmailTemplate, setInvoiceEmailTemplate] = useState('')

  // Invoicing backend — 'internal' | 'quickbooks' (migration 057). A discrete
  // toggle, so it saves immediately on change (not debounced) and calls
  // refreshOrg() so the app-wide org reflects it for later mode-gated surfaces.
  const [invoicingModeValue, setInvoicingModeValue] =
    useState<InvoicingMode>('internal')

  const [copied, setCopied] = useState(false)
  const [savingRate, setSavingRate] = useState(false)
  const [rateSavedAt, setRateSavedAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  // ── Load ──
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      // Wait out any org write still in flight from another page (/team also
      // writes orgs.team_members) so this read can't hand back pre-edit values.
      await awaitPendingOrgWrites()
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
      // Seat count is server-side since 084 — a client can only see its own
      // users row, which is what stops the RLS policy recursing.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const seatRes = await fetch('/api/org/seats', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        cache: 'no-store',
      })
      const seatJson = await seatRes.json().catch(() => ({}))
      if (!cancelled) setSeatCount(seatJson.used || 1)

      if (!cancelled) {
        setConsumableMarkup(org.consumable_markup_pct?.toString() || '10')
        setLaborMargin(
          (org.labor_margin_pct ?? org.profit_margin_pct ?? 35).toString(),
        )
        setMaterialMargin(
          (org.material_margin_pct ?? org.profit_margin_pct ?? 35).toString(),
        )
        setConsumableMargin(
          (org.consumable_margin_pct ?? org.profit_margin_pct ?? 35).toString(),
        )
        setBusinessName(org.name || '')
        setBusinessAddress((org as any).business_address || '')
        setBusinessCity((org as any).business_city || '')
        setBusinessState((org as any).business_state || '')
        setBusinessZip((org as any).business_zip || '')
        setBusinessPhone((org as any).business_phone || '')
        setBusinessEmail((org as any).business_email || '')
        setInvoicingModeValue(invoicingMode(org))

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
  //
  // useAutosave, not a raw setTimeout: the old effects cancelled the pending
  // save on unmount, so an edit followed by navigating away inside the debounce
  // window was silently discarded (fix list 2, item 1 — same bug as /team).
  const orgId = org?.id
  const canPersist = !!orgId && loaded
  const saveOverhead = useCallback(
    (v: OverheadInputs) => saveShopRateInputs(orgId!, { overhead: v }),
    [orgId],
  )
  // Two destinations now (087): the employee record merges into
  // orgs.team_members, and salary goes to the owner-only team_compensation
  // table. Merged rather than overwritten because /team edits the same
  // roster — see saveTeamMembersMerged.
  const saveTeam = useCallback(
    async (v: TeamMember[], base: TeamMember[] | null) => {
      await saveTeamMembersMerged(orgId!, base, v)
      if (base) await saveChangedComp(orgId!, base, v)
    },
    [orgId],
  )
  const saveBillable = useCallback(
    (v: BillableHoursInputs) => saveShopRateInputs(orgId!, { billable: v }),
    [orgId],
  )
  const overheadSave = useAutosave(overhead, saveOverhead, {
    enabled: canPersist,
    label: 'overhead save',
  })
  const teamSave = useAutosave(team, saveTeam, {
    enabled: canPersist,
    label: 'team save',
  })
  const billableSave = useAutosave(billable, saveBillable, {
    enabled: canPersist,
    label: 'billable save',
  })

  // Project defaults + business info + plan markup pcts go on orgs cols.
  const orgDefaults = useMemo(
    () => ({
      consumable_markup_pct: parseFloat(consumableMarkup) || 0,
      labor_margin_pct: parseFloat(laborMargin) || 0,
      material_margin_pct: parseFloat(materialMargin) || 0,
      consumable_margin_pct: parseFloat(consumableMargin) || 0,
      name: businessName.trim() || undefined,
      business_address: businessAddress.trim(),
      business_city: businessCity.trim(),
      business_state: businessState.trim(),
      business_zip: businessZip.trim(),
      business_phone: businessPhone.trim(),
      business_email: businessEmail.trim(),
    }),
    [
      consumableMarkup,
      laborMargin,
      materialMargin,
      consumableMargin,
      businessName,
      businessAddress,
      businessCity,
      businessState,
      businessZip,
      businessPhone,
      businessEmail,
    ],
  )
  const persistOrgDefaults = useCallback(
    async (v: typeof orgDefaults) => {
      await updateOrgChecked(orgId!, v)
      await refreshOrg()
    },
    [orgId, refreshOrg],
  )
  const orgDefaultsSave = useAutosave(orgDefaults, persistOrgDefaults, {
    enabled: canPersist,
    delayMs: 800,
    label: 'org save',
  })

  // Invoicing settings — separate autosave so the heavier invoice-prefix
  // change doesn't piggyback on the project-defaults deps.
  const invoicingDefaults = useMemo(() => {
    const taxNum = defaultTaxPct.trim() === '' ? null : Number(defaultTaxPct)
    return {
      invoice_prefix: invoicePrefix.trim() || null,
      default_tax_pct: taxNum != null && !Number.isNaN(taxNum) ? taxNum : null,
      default_payment_terms_days: Math.max(0, parseInt(defaultPaymentTermsDays, 10) || 14),
      invoice_footer_text: invoiceFooterText.trim() || null,
      invoice_email_template: invoiceEmailTemplate.trim() || null,
    }
  }, [
    invoicePrefix,
    defaultTaxPct,
    defaultPaymentTermsDays,
    invoiceFooterText,
    invoiceEmailTemplate,
  ])
  const persistInvoicing = useCallback(
    (v: typeof invoicingDefaults) => updateOrgChecked(orgId!, v),
    [orgId],
  )
  const invoicingSave = useAutosave(invoicingDefaults, persistInvoicing, {
    enabled: canPersist,
    delayMs: 800,
    label: 'invoicing save',
  })

  async function handleResetInvoiceNumber() {
    if (!org?.id) return
    const ok = window.confirm(
      'Reset the next invoice number to 1? Future invoices will start at INV-0001 (or your prefix). Existing invoices keep their numbers.',
    )
    if (!ok) return
    try {
      await updateOrgChecked(org.id, { next_invoice_number: 1 })
      setNextInvoiceNumber(1)
    } catch (e) {
      console.warn('reset invoice number', e)
      window.alert(e instanceof Error ? e.message : 'Could not reset the invoice number.')
    }
  }

  async function handleInvoicingModeChange(mode: InvoicingMode) {
    if (!org?.id || mode === invoicingModeValue) return
    // Confirm first (payment audit item 1). This changes how invoices get
    // CREATED from here on, and flipping it mid-project silently stops
    // internal auto-creation — deposits and milestones quietly stop producing
    // invoices, which is a slow failure that's hard to spot. Existing invoices
    // are untouched either way; say so, because that's the part people fear.
    const ok = await confirm(
      mode === 'quickbooks'
        ? {
            title: 'Switch invoicing to QuickBooks?',
            message:
              'From now on invoices are created in QuickBooks and pushed from here — MillSuite stops auto-creating them for deposits and milestones. Invoices that already exist are unchanged, and you can switch back any time.',
            confirmLabel: 'Use QuickBooks',
          }
        : {
            title: 'Switch invoicing to MillSuite?',
            message:
              'From now on invoices are created here and nothing is pushed to QuickBooks. Invoices that already exist are unchanged, and you can switch back any time.',
            confirmLabel: 'Use MillSuite',
          },
    )
    if (!ok) return
    const prev = invoicingModeValue
    setInvoicingModeValue(mode) // optimistic
    try {
      await updateOrgChecked(org.id, { invoicing_mode: mode })
    } catch (e) {
      console.warn('invoicing mode save', e)
      setInvoicingModeValue(prev) // revert on failure
      window.alert(e instanceof Error ? e.message : 'Could not change the invoicing mode.')
      return
    }
    await refreshOrg() // propagate to the app-wide org (later chunks gate on it)
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

  // One indicator for the whole page: the most urgent state across the five
  // autosaves wins, so a failed write can't hide behind four quiet ones.
  const settingsSave = useMemo<Autosave>(() => {
    const all = [overheadSave, teamSave, billableSave, orgDefaultsSave, invoicingSave]
    const rank = { error: 4, unsaved: 3, saving: 2, saved: 1, idle: 0 } as const
    const worst = all.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a))
    return {
      status: worst.status,
      error: worst.error,
      saveNow: () => all.forEach((s) => s.saveNow()),
    }
  }, [overheadSave, teamSave, billableSave, orgDefaultsSave, invoicingSave])

  return (
    <>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          {/* Everything on this page autosaves; show whether it landed. */}
          <SaveStatus save={settingsSave} />
        </div>

        {/* Plan & Billing — comped orgs have no subscription, so the whole
            tier ladder / seat cost / Stripe portal block is replaced by a
            plain statement of fact.

            Wording is CUSTOMER-FACING (first-customer onboarding step 2): a
            comped customer sees this card, not just Andrew, and "Internal"
            read like a dev flag someone forgot to take out. `internal` is
            still the plan key everywhere in code — only the label changed. */}
        {isInternalPlan(org?.plan) ? (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-semibold">Plan</h2>
            </div>
            <div className="px-6 py-5">
              <div className="text-sm font-medium text-[#111]">Full access</div>
              <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                Every feature is unlocked, with no seat or usage limits. Billing
                is handled directly — there&apos;s no subscription to manage here.
              </p>
            </div>
          </div>
        ) : (() => {
          const currentPlan = ((org?.plan as Plan) || 'starter') as Plan
          const seatPrice = PLAN_SEAT_PRICE[currentPlan] ?? 40
          const monthlyCost = seatPrice * Math.max(seatCount, PLAN_SEAT_MINIMUM[currentPlan] ?? 1)
          const tiers: { key: Plan; tagline: string; unlocks: string[]; coming?: string[] }[] = [
            {
              key: 'starter',
              tagline: 'Track every job, know your margin',
              unlocks: [
                'Dashboard + project outcomes',
                'Projects (sold + active)',
                'Time tracking (multi-user)',
                'Team management',
                'Shop rate calculator',
                'Invoices + payments',
                'Shop reports +AI insights · 1/mo',
              ],
            },
            {
              key: 'pro',
              tagline: 'Run the whole shop with AI in your corner',
              unlocks: [
                'Everything in Profit',
                'Sales pipeline (Leads kanban)',
                'Rate book',
                'AI Learning loop',
                'Pre-production approvals',
                'Capacity calendar (12-month, PTO/holidays)',
                'QuickBooks integration (optional)',
                'Shop reports +AI insights · 2/mo',
              ],
            },
            {
              key: 'pro-ai',
              tagline: 'Drop drawings, schedule departments, let AI do the heavy lifting',
              unlocks: [
                'Everything in Pro',
                'Drawing parser +AI estimating',
                'Department Scheduling +AI assistant',
                'Diagnostics drawer (margin waterfall)',
                'Shop reports +AI insights · 4/mo',
                'Priority support',
              ],
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
              Applied to new projects. Each project can pin its own margins.
              Each is a true gross margin (price = cost ÷ (1 − margin)).
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between py-3">
              <label className="text-sm text-[#6B7280]">
                Labor margin
                <span className="block text-[11px] text-[#9CA3AF]">
                  Labor + install
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={laborMargin}
                  onChange={(e) =>
                    setLaborMargin(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">
                Material margin
                <span className="block text-[11px] text-[#9CA3AF]">
                  Material + hardware + options
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={materialMargin}
                  onChange={(e) =>
                    setMaterialMargin(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className={inputClass}
                />
                <span className="text-sm text-[#9CA3AF]">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-[#F3F4F6]">
              <label className="text-sm text-[#6B7280]">Consumable margin</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={consumableMargin}
                  onChange={(e) =>
                    setConsumableMargin(e.target.value.replace(/[^0-9.]/g, ''))
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
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
              <div>
                <label className="text-sm text-[#6B7280]">Logo</label>
                <p className="text-[11px] text-[#9CA3AF]">Shows on the header, login pages, and PDFs. PNG/JPG/SVG, under 2 MB.</p>
              </div>
              <div className="flex items-center gap-3">
                {org?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={org.logo_url} alt="Logo" className="h-9 w-auto max-w-[120px] object-contain border border-[#E5E7EB] rounded bg-white" />
                ) : (
                  <span className="text-xs text-[#9CA3AF]">No logo</span>
                )}
                <label className={`text-xs px-2.5 py-1.5 border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] ${logoBusy ? 'opacity-50' : 'cursor-pointer'}`}>
                  {logoBusy ? 'Uploading…' : org?.logo_url ? 'Replace' : 'Upload'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={handleLogoFile} disabled={logoBusy} />
                </label>
                {org?.logo_url && (
                  <button type="button" onClick={handleLogoRemove} disabled={logoBusy} className="text-xs text-[#B91C1C] hover:underline disabled:opacity-50">Remove</button>
                )}
              </div>
            </div>
            {logoError && <div className="text-xs text-[#B91C1C] text-right">{logoError}</div>}
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
            {/* Invoicing backend — Internal vs QuickBooks (migration 057).
                Governs where estimates/invoices are created; cash flow stays
                milestone-based in both modes. QB push wiring lands in later
                chunks. */}
            <div className="flex items-center justify-between py-2">
              <label className="text-sm text-[#6B7280]">
                Invoicing backend
                <span className="block text-[11px] text-[#9CA3AF] font-normal">
                  {invoicingModeValue === 'quickbooks'
                    ? 'Estimates & invoices push to QuickBooks. Cash flow stays milestone-based.'
                    : "MillSuite's built-in invoices (default)."}
                </span>
              </label>
              <div className="inline-flex rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-0.5">
                {(['internal', 'quickbooks'] as const).map((mode) => {
                  const active = invoicingModeValue === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleInvoicingModeChange(mode)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        active
                          ? 'bg-white text-[#111] shadow-sm'
                          : 'text-[#6B7280] hover:text-[#111]'
                      }`}
                    >
                      {mode === 'internal' ? 'Internal' : 'QuickBooks'}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-[#F3F4F6]">
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

interface QbStatus {
  connected: boolean
  companyName?: string
  realmId?: string
  refreshExpiresAt?: string
}

function QuickBooksPanel({ orgId }: { orgId: string | null }) {
  const [status, setStatus] = useState<QbStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  // Attaches the caller's Supabase access token so the /api/qb routes can
  // resolve which org is asking.
  const authedFetch = useCallback(async (path: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(path, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
  }, [])

  const loadStatus = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const res = await authedFetch('/api/qb/status')
      setStatus(res.ok ? await res.json() : { connected: false })
    } catch {
      setStatus({ connected: false })
    }
    setLoading(false)
  }, [orgId, authedFetch])

  // Surface the outcome of an OAuth round-trip (?qb=connected | ?qb=error&reason=)
  // then strip it from the URL so a refresh doesn't replay the banner.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const qb = params.get('qb')
    if (qb === 'connected') setNotice({ ok: true, text: 'QuickBooks connected.' })
    else if (qb === 'error') {
      setNotice({ ok: false, text: `Couldn't connect: ${params.get('reason') || 'unknown error'}` })
    }
    if (qb) window.history.replaceState({}, '', '/settings')
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  async function handleConnect() {
    if (!orgId) return
    setBusy(true)
    try {
      const res = await authedFetch('/api/qb/connect')
      const data = await res.json()
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start QuickBooks connect')
      }
      window.location.href = data.url // off to Intuit's consent screen
    } catch (err: any) {
      setBusy(false)
      setNotice({ ok: false, text: err?.message || 'Could not start QuickBooks connect' })
    }
  }

  async function handleSyncItems() {
    if (!orgId) return
    setBusy(true)
    setNotice(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/qb/sync-items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Sync failed')
      setNotice({ ok: true, text: `Synced ${data.count} QuickBooks item${data.count === 1 ? '' : 's'}.` })
    } catch (err: any) {
      setNotice({ ok: false, text: err?.message || 'Could not sync QuickBooks items' })
    }
    setBusy(false)
  }

  async function handleDisconnect() {
    if (!orgId) return
    if (!window.confirm('Disconnect QuickBooks? Past QB events stay in your audit log; no new events will be accepted until you reconnect.')) {
      return
    }
    setBusy(true)
    const { error } = await supabase.from('qb_connections').delete().eq('org_id', orgId)
    setBusy(false)
    if (error) {
      setNotice({ ok: false, text: `Failed to disconnect: ${error.message}` })
      return
    }
    setNotice({ ok: true, text: 'QuickBooks disconnected.' })
    loadStatus()
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">QuickBooks</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5 max-w-md">
            Connect your QuickBooks Online company. When your invoicing backend
            is set to QuickBooks, MillSuite pushes estimates and invoices here
            and watches for payments to update your project milestones. Review
            matched and unmatched payments on the{' '}
            <Link href="/qb-reconciliation" className="text-[#2563EB] underline">reconciliation page</Link>.
          </p>
        </div>
        {status?.connected && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-xs font-semibold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
            Connected
          </span>
        )}
      </div>
      <div className="px-6 py-4">
        {notice && (
          <div
            className={`mb-3 text-xs px-3 py-2 rounded-lg ${
              notice.ok ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]'
            }`}
          >
            {notice.text}
          </div>
        )}
        {loading ? (
          <div className="text-xs text-[#9CA3AF]">Checking connection…</div>
        ) : status?.connected ? (
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <div className="font-medium text-[#111]">{status.companyName}</div>
              <div className="text-[11px] text-[#9CA3AF] mt-1">
                Company ID {status.realmId}
                {status.refreshExpiresAt
                  ? ` · reconnect by ${new Date(status.refreshExpiresAt).toLocaleDateString()}`
                  : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleSyncItems}
                disabled={busy}
                title="Pull your QuickBooks service items so subproject activity types map to the right QB line item"
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Sync items'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConnect}
            disabled={busy || !orgId}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect QuickBooks'}
          </button>
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

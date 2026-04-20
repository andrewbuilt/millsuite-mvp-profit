'use client'

// ============================================================================
// /onboarding — Phase 11 four-step skippable wizard
// ============================================================================
// Every shop can skip every step. The starter rate book + default labor rates
// already make MillSuite usable on day one — this page is additive polish for
// shops that want to invest 10 minutes up front.
//
// Steps (all wired to lib/onboarding.ts):
//
//   1. Business card → contact + company prefill
//   2. Past estimate upload → stash baselines into onboarding_stashed_baselines
//   3. Bank statement inputs → shop burden suggestion
//   4. Dept-rate sliders with reference ranges
//
// State persists per org in onboarding_progress. The wizard auto-jumps to
// the next pending step on load; "Skip step" calls setStepState('skipped').
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  STEP_ORDER,
  STEP_META,
  loadOnboardingProgress,
  setStepState,
  dismissOnboarding,
  nextStep,
  isFullyDoneOrSkipped,
  computeShopBurden,
  REFERENCE_DEPT_RATES,
  type OnboardingStep,
  type OnboardingProgressRow,
} from '@/lib/onboarding'
import type { LaborDept } from '@/lib/rate-book-seed'
import { CheckCircle2, ChevronRight, ChevronLeft, Upload, X } from 'lucide-react'

const DEPTS: LaborDept[] = ['eng', 'cnc', 'assembly', 'finish', 'install']

function StepDot({ done, current }: { done: boolean; current: boolean }) {
  return (
    <div
      className={`h-2.5 w-2.5 rounded-full ${
        done ? 'bg-emerald-500' : current ? 'bg-slate-900' : 'bg-slate-300'
      }`}
    />
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { org } = useAuth()
  const [progress, setProgress] = useState<OnboardingProgressRow | null>(null)
  const [active, setActive] = useState<OnboardingStep>('card')

  // Step 1 (card)
  const [cardName, setCardName] = useState('')
  const [cardEmail, setCardEmail] = useState('')
  const [cardPhone, setCardPhone] = useState('')
  const [cardCompany, setCardCompany] = useState('')

  // Step 2 (estimate)
  const [estimateFileName, setEstimateFileName] = useState('')

  // Step 3 (bank)
  const [bankRent, setBankRent] = useState(0)
  const [bankUtilities, setBankUtilities] = useState(0)
  const [bankInsurance, setBankInsurance] = useState(0)
  const [bankOther, setBankOther] = useState(0)
  const [bankHours, setBankHours] = useState(0)
  const burden =
    bankHours > 0
      ? computeShopBurden({
          monthlyRent: bankRent,
          monthlyUtilities: bankUtilities,
          monthlyInsurance: bankInsurance,
          monthlyOtherFixed: bankOther,
          monthlyShopHours: bankHours,
        })
      : 0

  // Step 4 (rates)
  const [rates, setRates] = useState<Record<LaborDept, number>>({
    eng: REFERENCE_DEPT_RATES.eng.median,
    cnc: REFERENCE_DEPT_RATES.cnc.median,
    assembly: REFERENCE_DEPT_RATES.assembly.median,
    finish: REFERENCE_DEPT_RATES.finish.median,
    install: REFERENCE_DEPT_RATES.install.median,
  })

  const loadProgress = useCallback(async () => {
    if (!org?.id) return
    const p = await loadOnboardingProgress(org.id)
    setProgress(p)
    const next = nextStep(p)
    if (next) setActive(next)
  }, [org?.id])

  useEffect(() => { void loadProgress() }, [loadProgress])

  if (!progress) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <div className="mx-auto max-w-3xl px-6 py-12 text-sm text-slate-500">Loading…</div>
      </div>
    )
  }

  const advance = () => {
    const idx = STEP_ORDER.indexOf(active)
    if (idx < STEP_ORDER.length - 1) setActive(STEP_ORDER[idx + 1])
  }
  const back = () => {
    const idx = STEP_ORDER.indexOf(active)
    if (idx > 0) setActive(STEP_ORDER[idx - 1])
  }

  const skip = async () => {
    if (!org?.id) return
    await setStepState({ orgId: org.id, step: active, state: 'skipped' })
    await loadProgress()
    advance()
  }

  const onCardSave = async () => {
    if (!org?.id) return
    if (cardName || cardEmail || cardPhone || cardCompany) {
      // Best-effort prefill: insert into contacts + clients tables when we
      // have at least an email or company. Schema is forgiving.
      try {
        if (cardCompany) {
          await supabase.from('clients').insert({
            org_id: org.id,
            name: cardCompany,
          })
        }
        if (cardName || cardEmail || cardPhone) {
          await supabase.from('contacts').insert({
            org_id: org.id,
            name: cardName || null,
            email: cardEmail || null,
            phone: cardPhone || null,
          })
        }
      } catch {
        // Surface but don't block onboarding.
      }
    }
    await setStepState({
      orgId: org.id,
      step: 'card',
      state: 'done',
      payload: {
        name: cardName,
        email: cardEmail,
        phone: cardPhone,
        company: cardCompany,
      },
    })
    await loadProgress()
    advance()
  }

  const onEstimateSave = async () => {
    if (!org?.id) return
    // MVP: stash a placeholder baseline so the operator sees it land in the
    // /suggestions queue. Full PDF parse plugs in via lib/pdf-parser.ts.
    if (estimateFileName) {
      await supabase.from('onboarding_stashed_baselines').insert({
        org_id: org.id,
        source: 'estimate_upload',
        kind: 'rate_book_item_baseline',
        rate_book_item_id: null,
        payload: { source_filename: estimateFileName },
        parse_confidence: null,
        notes: 'Pending parser run. Pick the matching rate-book item to seed.',
      })
    }
    await setStepState({
      orgId: org.id,
      step: 'estimate',
      state: 'done',
      payload: { filename: estimateFileName },
    })
    await loadProgress()
    advance()
  }

  const onBankSave = async () => {
    if (!org?.id) return
    // Stash a shop_rate_baseline so the operator can confirm before it
    // overrides shop_labor_rates.
    if (burden > 0) {
      await supabase.from('onboarding_stashed_baselines').insert({
        org_id: org.id,
        source: 'bank_statement',
        kind: 'shop_rate_baseline',
        payload: {
          burden_per_hour: burden,
          monthly_rent: bankRent,
          monthly_utilities: bankUtilities,
          monthly_insurance: bankInsurance,
          monthly_other_fixed: bankOther,
          monthly_shop_hours: bankHours,
        },
        parse_confidence: null,
        notes: `Computed burden: $${burden}/hr.`,
      })
    }
    await setStepState({
      orgId: org.id,
      step: 'bank',
      state: 'done',
      payload: { burden },
    })
    await loadProgress()
    advance()
  }

  const onRatesSave = async () => {
    if (!org?.id) return
    // Write directly to shop_labor_rates — these are the live rates the
    // estimate engine consults.
    for (const dept of DEPTS) {
      await supabase
        .from('shop_labor_rates')
        .upsert(
          { org_id: org.id, dept, rate_per_hour: rates[dept] },
          { onConflict: 'org_id,dept' }
        )
    }
    await setStepState({
      orgId: org.id,
      step: 'rates',
      state: 'done',
      payload: rates,
    })
    await loadProgress()
    advance()
  }

  const onFinish = async () => {
    if (!org?.id) return
    await dismissOnboarding(org.id)
    router.push('/dashboard')
  }

  const fullyDone = isFullyDoneOrSkipped(progress)

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Welcome to MillSuite</h1>
            <p className="text-sm text-slate-600 mt-1">
              Four optional steps to make your first day faster. Skip any of them — your starter rate book is already loaded.
            </p>
          </div>
          <button
            onClick={onFinish}
            className="text-sm text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
          >
            <X className="h-4 w-4" />
            Close wizard
          </button>
        </div>

        {/* Step header */}
        <div className="flex items-center gap-3 mb-6">
          {STEP_ORDER.map((s, i) => {
            const state = progress.step_states[s] || 'pending'
            return (
              <button
                key={s}
                onClick={() => setActive(s)}
                className="flex items-center gap-2 text-xs"
              >
                <StepDot done={state === 'done' || state === 'skipped'} current={s === active} />
                <span className={s === active ? 'font-medium text-slate-900' : 'text-slate-500'}>
                  {i + 1}. {STEP_META[s].title.split(' ').slice(0, 3).join(' ')}
                </span>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg bg-white ring-1 ring-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold">{STEP_META[active].title}</h2>
          <p className="text-sm text-slate-600 mt-1">{STEP_META[active].blurb}</p>

          <div className="mt-6 space-y-4">
            {active === 'card' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Your name" value={cardName} onChange={setCardName} />
                  <Input label="Company" value={cardCompany} onChange={setCardCompany} />
                  <Input label="Email" value={cardEmail} onChange={setCardEmail} />
                  <Input label="Phone" value={cardPhone} onChange={setCardPhone} />
                </div>
                <p className="text-xs text-slate-500">
                  Card scanning lands when we ship the OCR pass. For now, type what's on the card.
                </p>
              </>
            )}

            {active === 'estimate' && (
              <div>
                <label className="text-sm text-slate-700">
                  Past estimate filename
                  <div className="flex items-center gap-2 mt-2">
                    <Upload className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={estimateFileName}
                      onChange={(e) => setEstimateFileName(e.target.value)}
                      placeholder="e.g. Smith-Kitchen-Estimate.pdf"
                      className="flex-1 rounded-md ring-1 ring-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </label>
                <p className="text-xs text-slate-500 mt-2">
                  We'll parse it and stash baselines for you to confirm in the rate book — gray confidence until new jobs fill them in.
                </p>
              </div>
            )}

            {active === 'bank' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Monthly rent ($)" value={bankRent} onChange={setBankRent} />
                  <NumberInput label="Monthly utilities ($)" value={bankUtilities} onChange={setBankUtilities} />
                  <NumberInput label="Monthly insurance ($)" value={bankInsurance} onChange={setBankInsurance} />
                  <NumberInput label="Other fixed costs ($)" value={bankOther} onChange={setBankOther} />
                  <NumberInput label="Productive shop hours / month" value={bankHours} onChange={setBankHours} />
                </div>
                {burden > 0 && (
                  <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm">
                    Suggested shop burden:{' '}
                    <span className="font-semibold">${burden.toFixed(2)} / hour</span>
                  </div>
                )}
              </div>
            )}

            {active === 'rates' && (
              <div className="space-y-4">
                {DEPTS.map((dept) => {
                  const ref = REFERENCE_DEPT_RATES[dept]
                  return (
                    <div key={dept} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">{dept}</span>
                        <span className="text-slate-700">${rates[dept]}/hr</span>
                      </div>
                      <input
                        type="range"
                        min={ref.low}
                        max={ref.high}
                        value={rates[dept]}
                        onChange={(e) =>
                          setRates((prev) => ({ ...prev, [dept]: Number(e.target.value) }))
                        }
                        className="w-full"
                      />
                      <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wide">
                        <span>${ref.low}</span>
                        <span>median ${ref.median}</span>
                        <span>${ref.high}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4">
            <button
              onClick={back}
              disabled={STEP_ORDER.indexOf(active) === 0}
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={skip}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5"
              >
                Skip this step
              </button>
              <button
                onClick={
                  active === 'card'
                    ? onCardSave
                    : active === 'estimate'
                    ? onEstimateSave
                    : active === 'bank'
                    ? onBankSave
                    : onRatesSave
                }
                className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
              >
                Save & continue
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {fullyDone && (
          <div className="mt-6 rounded-md bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            All set. Closing the wizard will drop you on the dashboard.
            <button
              onClick={onFinish}
              className="ml-auto rounded-md bg-emerald-600 text-white px-3 py-1 text-xs"
            >
              Take me to the dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="text-sm text-slate-700">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full mt-1 rounded-md ring-1 ring-slate-200 px-3 py-2 text-sm"
      />
    </label>
  )
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="text-sm text-slate-700">
      {label}
      <input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="block w-full mt-1 rounded-md ring-1 ring-slate-200 px-3 py-2 text-sm"
      />
    </label>
  )
}

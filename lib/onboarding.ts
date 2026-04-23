// ============================================================================
// onboarding.ts — Phase 11 wizard state + accept/skip actions
// ============================================================================
// The wizard is four steps and every one is optional:
//
//   1. 'card'     — business card parse → contacts prefill
//   2. 'estimate' — past estimate PDF → rate-book baselines stashed
//   3. 'bank'     — redacted bank statement → shop-burden suggestion
//   4. 'rates'    — dept-rate interview sliders
//
// Step state: 'pending' | 'done' | 'skipped'. Onboarding_progress.step_states
// is a single jsonb map so we can add/remove steps without migrations.
//
// ACCEPTED baselines from step 2 and 3 write to rate_book_items +
// rate_book_item_history (Phase 10 audit path) so the Change tab shows the
// edit. DISMISSED baselines stay in onboarding_stashed_baselines for audit;
// they don't re-surface.
//
// Confidence ramp (step 6 of Phase 11 checklist) lives in
// bumpItemConfidence() below — called from lib/suggestions.ts whenever a
// closed-job scan updates an item's evidence.
// ============================================================================

import { supabase } from './supabase'
import type { LaborDept } from './rate-book-seed'

export type OnboardingStep = 'card' | 'estimate' | 'bank' | 'rates'
export type StepState = 'pending' | 'done' | 'skipped'

export const STEP_ORDER: OnboardingStep[] = ['card', 'estimate', 'bank', 'rates']

export const STEP_META: Record<
  OnboardingStep,
  { title: string; blurb: string; optional: boolean }
> = {
  card: {
    title: 'Start with a business card',
    blurb:
      'Snap a photo of your business card — we\'ll prefill your shop name, phone, and email so you don\'t have to type.',
    optional: true,
  },
  estimate: {
    title: 'Bring over a past estimate',
    blurb:
      'Upload a PDF estimate from your old tool. We\'ll suggest rate-book baselines based on what you charged last time — gray confidence until new jobs fill it in.',
    optional: true,
  },
  bank: {
    title: 'Shop burden from a redacted statement',
    blurb:
      'Upload a redacted bank statement and we\'ll suggest a shop-burden rate. Dollar amounts only — no account numbers required.',
    optional: true,
  },
  rates: {
    title: 'Dial in your department rates',
    blurb:
      'Drag the sliders to set per-dept rates. Reference shop medians show next to each one so you know where you land.',
    optional: true,
  },
}

export interface OnboardingProgressRow {
  org_id: string
  step_states: Partial<Record<OnboardingStep, StepState>>
  step_payloads: Partial<Record<OnboardingStep, Record<string, unknown>>>
  completed_at: string | null
  dismissed_at: string | null
}

export async function loadOnboardingProgress(orgId: string): Promise<OnboardingProgressRow> {
  const { data } = await supabase
    .from('onboarding_progress')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()
  if (data) return data as OnboardingProgressRow
  // Seed a row lazily — safer than returning a stub the UI might later persist.
  const seeded = {
    org_id: orgId,
    step_states: {},
    step_payloads: {},
    completed_at: null,
    dismissed_at: null,
  }
  await supabase.from('onboarding_progress').insert(seeded)
  return seeded
}

export function nextStep(progress: OnboardingProgressRow): OnboardingStep | null {
  for (const step of STEP_ORDER) {
    const state = progress.step_states[step] || 'pending'
    if (state === 'pending') return step
  }
  return null
}

export function isFullyDoneOrSkipped(progress: OnboardingProgressRow): boolean {
  for (const step of STEP_ORDER) {
    const state = progress.step_states[step] || 'pending'
    if (state === 'pending') return false
  }
  return true
}

/** Mark a step done (or skipped). Optionally stash a payload. */
export async function setStepState(args: {
  orgId: string
  step: OnboardingStep
  state: 'done' | 'skipped'
  payload?: Record<string, unknown>
}): Promise<void> {
  const { orgId, step, state, payload } = args
  const current = await loadOnboardingProgress(orgId)
  const nextStates = { ...current.step_states, [step]: state }
  const nextPayloads = payload
    ? { ...current.step_payloads, [step]: payload }
    : current.step_payloads
  const patch: Record<string, unknown> = {
    step_states: nextStates,
    step_payloads: nextPayloads,
    updated_at: new Date().toISOString(),
  }
  if (isFullyDoneOrSkipped({ ...current, step_states: nextStates })) {
    patch.completed_at = new Date().toISOString()
  }
  await supabase.from('onboarding_progress').update(patch).eq('org_id', orgId)
}

/** User explicitly closes the wizard without finishing. Kept as audit. */
export async function dismissOnboarding(orgId: string): Promise<void> {
  await supabase
    .from('onboarding_progress')
    .update({ dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
}

// ============================================================================
// Stashed baselines — the bridge between parsed PDFs and the rate book.
// ============================================================================

export type StashKind =
  | 'rate_book_item_baseline'
  | 'shop_rate_baseline'
  | 'dept_rate_baseline'
  | 'material_cost_baseline'

export interface StashedBaseline {
  id: string
  org_id: string
  source: 'estimate_upload' | 'bank_statement' | 'manual'
  kind: StashKind
  rate_book_item_id: string | null
  payload: Record<string, unknown>
  parse_confidence: number | null
  notes: string | null
  status: 'pending' | 'accepted' | 'dismissed'
  created_at: string
}

export async function listStashedBaselines(orgId: string): Promise<StashedBaseline[]> {
  const { data } = await supabase
    .from('onboarding_stashed_baselines')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return (data || []) as StashedBaseline[]
}

export async function dismissStash(id: string): Promise<void> {
  await supabase
    .from('onboarding_stashed_baselines')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Accept a rate_book_item_baseline into the rate book. Payload shape:
 *   { unit_price?, base_labor_hours_*?, sheet_cost?, material_cost_per_lf? }
 *
 * Writes to rate_book_items and rate_book_item_history (field_changes shape
 * matches Phase 10's accept path).
 */
export async function acceptStashedItemBaseline(args: {
  stashId: string
  userId: string | null
  reason: string
}): Promise<{ ok: boolean; error?: string }> {
  const { stashId, userId, reason } = args
  const { data: stash } = await supabase
    .from('onboarding_stashed_baselines')
    .select('*')
    .eq('id', stashId)
    .single()
  if (!stash) return { ok: false, error: 'stash not found' }
  const s = stash as StashedBaseline
  if (!s.rate_book_item_id) {
    return { ok: false, error: 'stash has no target item — use Split flow' }
  }

  const { data: item } = await supabase
    .from('rate_book_items')
    .select('id, base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly, base_labor_hours_finish, base_labor_hours_install, sheet_cost, linear_cost')
    .eq('id', s.rate_book_item_id)
    .single()
  if (!item) return { ok: false, error: 'rate book item missing' }
  const existing = item as Record<string, number | string>

  const patch: Record<string, number> = {}
  const history: Record<string, { from: number; to: number }> = {}
  const payload = s.payload as Record<string, number | undefined>
  const FIELDS = [
    'base_labor_hours_eng',
    'base_labor_hours_cnc',
    'base_labor_hours_assembly',
    'base_labor_hours_finish',
    'base_labor_hours_install',
    'sheet_cost',
    'linear_cost',
  ] as const
  for (const f of FIELDS) {
    const next = payload[f]
    if (typeof next !== 'number' || !Number.isFinite(next)) continue
    const from = Number(existing[f]) || 0
    if (Math.abs(next - from) < 0.01) continue
    patch[f] = next
    history[f] = { from, to: next }
  }

  if (Object.keys(patch).length === 0) {
    await supabase
      .from('onboarding_stashed_baselines')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', stashId)
    return { ok: true }
  }

  patch.updated_at = new Date().toISOString() as unknown as number
  await supabase
    .from('rate_book_items')
    .update(patch)
    .eq('id', s.rate_book_item_id)
  await supabase.from('rate_book_item_history').insert({
    rate_book_item_id: s.rate_book_item_id,
    changed_by: userId,
    field_changes: history,
    reason: reason || 'Onboarding: past-estimate baseline',
    apply_scope: 'this',
  })
  await supabase
    .from('onboarding_stashed_baselines')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', stashId)

  return { ok: true }
}

// ============================================================================
// Bank-statement → shop burden calc. Simple MVP heuristic. Phase 12 item
// 12 deprecated the per-dept rate path; the "accept" surface should now
// feed orgs.shop_rate instead (pending follow-up).
// ============================================================================

export interface BankStatementInputs {
  monthlyRent: number
  monthlyUtilities: number
  monthlyInsurance: number
  monthlyOtherFixed: number
  monthlyShopHours: number // productive shop hours per month
}

export function computeShopBurden(inputs: BankStatementInputs): number {
  const fixed =
    (inputs.monthlyRent || 0) +
    (inputs.monthlyUtilities || 0) +
    (inputs.monthlyInsurance || 0) +
    (inputs.monthlyOtherFixed || 0)
  const hours = inputs.monthlyShopHours || 0
  if (hours <= 0) return 0
  return Math.round((fixed / hours) * 100) / 100
}

// ============================================================================
// Confidence ramp — item-level hook called from suggestions.regenerate or
// after a job closes referencing the item.
// ============================================================================

export type ItemConfidence = 'untested' | 'few_jobs' | 'well_tested' | 'looking_weird'

export function deriveConfidence(jobCount: number, drift: number): ItemConfidence {
  // drift = |actual/estimate - 1|. Large drift with evidence → looking_weird.
  if (drift > 0.35 && jobCount >= 3) return 'looking_weird'
  if (jobCount >= 5) return 'well_tested'
  if (jobCount >= 1) return 'few_jobs'
  return 'untested'
}

/**
 * Bump an item's confidence metadata. Called after a closed-job scan — a job
 * referencing the item increments confidence_job_count + stamps
 * confidence_last_used_at, then re-derives the confidence bucket.
 */
export async function bumpItemConfidence(args: {
  rateBookItemId: string
  jobCount: number
  drift: number
}): Promise<void> {
  const { rateBookItemId, jobCount, drift } = args
  const confidence = deriveConfidence(jobCount, drift)
  await supabase
    .from('rate_book_items')
    .update({
      confidence,
      confidence_job_count: jobCount,
      confidence_last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rateBookItemId)
}

// Default per-dept reference rates shown next to sliders in step 4. These
// match the starter defaults in rate-book-seed but let the UI display
// "median shop: $X" copy without round-tripping the DB.
export const REFERENCE_DEPT_RATES: Record<LaborDept, { low: number; median: number; high: number }> = {
  eng: { low: 75, median: 95, high: 125 },
  cnc: { low: 65, median: 85, high: 115 },
  assembly: { low: 65, median: 85, high: 110 },
  finish: { low: 70, median: 90, high: 115 },
  install: { low: 65, median: 80, high: 105 },
}

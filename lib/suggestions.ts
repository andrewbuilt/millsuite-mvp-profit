// ============================================================================
// suggestions.ts — Phase 10 learning loop generator + accept/dismiss
// ============================================================================
// Reads closed-job evidence via lib/closed-jobs.ts, produces one of five
// suggestion shapes per item, and upserts the row into `item_suggestions`.
// The /suggestions UI then pivots on status=active.
//
//   big_up      — mean actual / mean estimate ≥ 1.20 across ≥2 jobs; suggest
//                 raising rate-book per-dept hours to match the mean actual.
//   big_down    — mirror image. Ratio ≤ 0.80 across ≥2 jobs; suggest
//                 lowering per-dept hours to the mean actual.
//   minor       — ratio in (0.80, 1.20) but still outside the noise band
//                 (1.05-or-0.95). A nudge, shown last.
//   split       — coefficient-of-variation across jobs for actual total
//                 minutes ≥ 0.5 AND there are ≥4 jobs. The item is probably
//                 two things. Suggest two new-item names (slow/fast) with
//                 the cluster means; user edits before accepting.
//   quiet       — item hasn't appeared on any estimate line in 90+ days AND
//                 has at least one closed-job record in history. Suggest
//                 deprecating.
//
// Signatures: dismissed rows carry a sha256 of the sorted job-id list. When
// the re-scan sees the same sha, the dismissed row stays dismissed; when the
// job list has changed, the re-engine flips it back to active (or writes a
// fresh active row if an accepted version already exists).
// ============================================================================

import { createHash } from 'crypto'
import { supabase } from './supabase'
import {
  loadClosedJobItemRollups,
  type ClosedJobItemRollup,
  type ClosedJobItemRollupJob,
} from './closed-jobs'
import { bumpItemConfidence } from './onboarding'
import type { LaborDept } from './rate-book-seed'

const DEPTS: LaborDept[] = ['eng', 'cnc', 'assembly', 'finish', 'install']

export type SuggestionType = 'big_up' | 'big_down' | 'minor' | 'split' | 'quiet'
export type SuggestionStatus = 'active' | 'accepted' | 'dismissed'

export interface SuggestionRow {
  id: string
  org_id: string
  rate_book_item_id: string | null
  suggestion_type: SuggestionType
  status: SuggestionStatus
  evidence: {
    itemName: string
    baselineMinutesByDept: Record<LaborDept, number>
    jobs: ClosedJobItemRollupJob[]
    meanActualByDept?: Record<LaborDept, number>
    meanEstimateByDept?: Record<LaborDept, number>
    ratio?: number
    coefficientOfVariation?: number
  }
  source_job_ids: string[]
  excluded_job_ids: string[]
  proposed_changes: {
    // big_up / big_down / minor
    field_changes?: Array<{ field: string; from: number; to: number }>
    // split
    new_items?: Array<{ name: string; baseHoursByDept: Record<LaborDept, number> }>
    // quiet
    deprecate?: boolean
  }
  rationale: string | null
  dismissed_signature: string | null
  dismissed_at: string | null
  dismissed_by: string | null
  accepted_at: string | null
  accepted_by: string | null
  accepted_history_id: string | null
  created_at: string
  updated_at: string
}

// Signature over a suggestion's inputs: the ids of the jobs that informed
// it, sorted lexically, sha256'd. Changes when the evidence changes.
export function evidenceSignature(jobs: ClosedJobItemRollupJob[]): string {
  const ids = [...jobs.map((j) => `${j.projectId}:${j.subprojectId}:${j.estimateLineId}`)].sort()
  return createHash('sha256').update(ids.join('|')).digest('hex').slice(0, 16)
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  if (m === 0) return 0
  const variance = mean(arr.map((v) => (v - m) ** 2))
  return Math.sqrt(variance) / m
}

interface SuggestionCandidate {
  type: SuggestionType
  rateBookItemId: string
  evidence: SuggestionRow['evidence']
  source_job_ids: string[]
  proposed_changes: SuggestionRow['proposed_changes']
  rationale: string
}

/**
 * Core classifier: pick the single best suggestion (if any) for one item
 * given its closed-job rollup. Returns null when the item looks fine.
 */
export function classify(rollup: ClosedJobItemRollup): SuggestionCandidate | null {
  const jobs = rollup.jobs
  if (jobs.length === 0) return null

  const totalsActual = jobs.map((j) => j.actualMinutesTotal)
  const totalsEst = jobs.map((j) => j.estimatedMinutesTotal)
  const meanActual = mean(totalsActual)
  const meanEst = mean(totalsEst)
  const ratio = meanEst > 0 ? meanActual / meanEst : 0

  const cv = coefficientOfVariation(totalsActual)
  const source_job_ids = jobs.map((j) => j.projectId)

  // Per-dept means for the evidence payload.
  const meanActualByDept: Record<LaborDept, number> = {
    eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0,
  }
  const meanEstByDept: Record<LaborDept, number> = {
    eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0,
  }
  for (const d of DEPTS) {
    meanActualByDept[d] = mean(jobs.map((j) => j.actualMinutesByDept[d] || 0))
    meanEstByDept[d] = mean(jobs.map((j) => j.estimatedMinutesByDept[d] || 0))
  }

  const baseEvidence: SuggestionRow['evidence'] = {
    itemName: rollup.itemName,
    baselineMinutesByDept: rollup.baselineMinutesByDept,
    jobs,
    meanActualByDept,
    meanEstimateByDept: meanEstByDept,
    ratio,
    coefficientOfVariation: cv,
  }

  // ---- split: high variance + enough jobs -----------------------------
  if (jobs.length >= 4 && cv >= 0.5) {
    // MVP clustering: take the median and bucket jobs above / below it.
    const sorted = [...totalsActual].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const slow = jobs.filter((j) => j.actualMinutesTotal > median)
    const fast = jobs.filter((j) => j.actualMinutesTotal <= median)
    if (slow.length >= 2 && fast.length >= 2) {
      const slowHours: Record<LaborDept, number> = {
        eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0,
      }
      const fastHours: Record<LaborDept, number> = {
        eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0,
      }
      for (const d of DEPTS) {
        slowHours[d] = mean(slow.map((j) => j.actualMinutesByDept[d] || 0)) / 60
        fastHours[d] = mean(fast.map((j) => j.actualMinutesByDept[d] || 0)) / 60
      }
      return {
        type: 'split',
        rateBookItemId: rollup.rateBookItemId,
        evidence: baseEvidence,
        source_job_ids,
        proposed_changes: {
          new_items: [
            { name: `${rollup.itemName} — slow`, baseHoursByDept: slowHours },
            { name: `${rollup.itemName} — fast`, baseHoursByDept: fastHours },
          ],
        },
        rationale: `Actual hours scatter across ${jobs.length} closed jobs (CV ${(cv * 100).toFixed(0)}%). Consider splitting into two items.`,
      }
    }
  }

  // ---- quiet: no recent usage (≥2 jobs, last closed >90 days ago) ----
  const mostRecent = jobs
    .map((j) => (j.closedAt ? new Date(j.closedAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0)
  if (jobs.length >= 2 && mostRecent > 0) {
    const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24)
    if (daysSince >= 90) {
      return {
        type: 'quiet',
        rateBookItemId: rollup.rateBookItemId,
        evidence: baseEvidence,
        source_job_ids,
        proposed_changes: { deprecate: true },
        rationale: `Item hasn't been used on a new estimate in ${daysSince.toFixed(0)} days. Consider deprecating.`,
      }
    }
  }

  // ---- big_up / big_down / minor ------------------------------------
  if (jobs.length < 2 || meanEst === 0) return null

  const field_changes: Array<{ field: string; from: number; to: number }> = []
  for (const d of DEPTS) {
    const baseline = rollup.baselineMinutesByDept[d] / 60
    const newHours = meanActualByDept[d] / 60
    if (Math.abs(newHours - baseline) < 0.05) continue
    field_changes.push({
      field: `base_labor_hours_${d}`,
      from: Math.round(baseline * 100) / 100,
      to: Math.round(newHours * 100) / 100,
    })
  }
  if (field_changes.length === 0) return null

  const common = {
    rateBookItemId: rollup.rateBookItemId,
    evidence: baseEvidence,
    source_job_ids,
    proposed_changes: { field_changes },
  }
  if (ratio >= 1.2) {
    return {
      type: 'big_up',
      ...common,
      rationale: `Mean actual is ${(ratio * 100).toFixed(0)}% of estimate across ${jobs.length} closed jobs. Suggesting bump.`,
    }
  }
  if (ratio <= 0.8) {
    return {
      type: 'big_down',
      ...common,
      rationale: `Mean actual is ${(ratio * 100).toFixed(0)}% of estimate across ${jobs.length} closed jobs. Suggesting reduction.`,
    }
  }
  if (ratio >= 1.05 || ratio <= 0.95) {
    return {
      type: 'minor',
      ...common,
      rationale: `Small but consistent drift: mean actual is ${(ratio * 100).toFixed(0)}% of estimate.`,
    }
  }
  return null
}

/**
 * Re-scan closed jobs for the org and upsert suggestions. Idempotent: the
 * unique active index on (org, item, type) makes the upsert collapse to an
 * update in-place. Dismissed rows get the fresh signature compared; if the
 * evidence has changed they're flipped back to active.
 */
export async function regenerateSuggestions(orgId: string): Promise<{
  created: number
  updated: number
  resurfaced: number
  stale: number
}> {
  const rollups = await loadClosedJobItemRollups(orgId)

  // Phase 11 confidence ramp: any item that has closed-job evidence gets its
  // confidence metadata refreshed here. Drift = |ratio-1|; jobCount = number
  // of distinct closed jobs referencing this item.
  for (const r of rollups) {
    const jobCount = r.jobs.length
    const totalsActual = r.jobs.map((j) => j.actualMinutesTotal)
    const totalsEst = r.jobs.map((j) => j.estimatedMinutesTotal)
    const meanActual = totalsActual.reduce((a, b) => a + b, 0) / (jobCount || 1)
    const meanEst = totalsEst.reduce((a, b) => a + b, 0) / (jobCount || 1)
    const drift = meanEst > 0 ? Math.abs(meanActual / meanEst - 1) : 0
    await bumpItemConfidence({ rateBookItemId: r.rateBookItemId, jobCount, drift })
  }

  const fresh: Record<string, SuggestionCandidate> = {}
  for (const r of rollups) {
    const c = classify(r)
    if (!c) continue
    fresh[`${c.rateBookItemId}:${c.type}`] = c
  }

  // Pull existing rows for this org + item-type set so we can decide
  // create/update/resurface.
  const { data: existing } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('org_id', orgId)
  const existingRows = (existing || []) as SuggestionRow[]
  const existingByKey: Record<string, SuggestionRow> = {}
  for (const row of existingRows) {
    if (!row.rate_book_item_id) continue
    existingByKey[`${row.rate_book_item_id}:${row.suggestion_type}`] = row
  }

  let created = 0
  let updated = 0
  let resurfaced = 0
  let stale = 0

  const freshKeysArr = Object.keys(fresh)
  const freshKeySet: Record<string, true> = {}
  for (const k of freshKeysArr) freshKeySet[k] = true
  for (const key of freshKeysArr) {
    const c = fresh[key]
    const signature = evidenceSignature(c.evidence.jobs)
    const existingRow = existingByKey[key]

    if (!existingRow) {
      await supabase.from('item_suggestions').insert({
        org_id: orgId,
        rate_book_item_id: c.rateBookItemId,
        suggestion_type: c.type,
        status: 'active',
        evidence: c.evidence,
        source_job_ids: c.source_job_ids,
        proposed_changes: c.proposed_changes,
        rationale: c.rationale,
      })
      created += 1
      continue
    }

    if (existingRow.status === 'accepted') {
      // Accepted already. Don't overwrite history; produce a fresh active row
      // (unique index is partial on status='active' so this doesn't collide).
      await supabase.from('item_suggestions').insert({
        org_id: orgId,
        rate_book_item_id: c.rateBookItemId,
        suggestion_type: c.type,
        status: 'active',
        evidence: c.evidence,
        source_job_ids: c.source_job_ids,
        proposed_changes: c.proposed_changes,
        rationale: c.rationale,
      })
      created += 1
      continue
    }

    if (existingRow.status === 'dismissed') {
      if (existingRow.dismissed_signature === signature) {
        // Same evidence; stay dismissed.
        continue
      }
      // Evidence changed — resurface.
      await supabase
        .from('item_suggestions')
        .update({
          status: 'active',
          evidence: c.evidence,
          source_job_ids: c.source_job_ids,
          proposed_changes: c.proposed_changes,
          rationale: c.rationale,
          dismissed_signature: null,
          dismissed_at: null,
          dismissed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRow.id)
      resurfaced += 1
      continue
    }

    // Active — refresh the payload.
    await supabase
      .from('item_suggestions')
      .update({
        evidence: c.evidence,
        source_job_ids: c.source_job_ids,
        proposed_changes: c.proposed_changes,
        rationale: c.rationale,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRow.id)
    updated += 1
  }

  // Sweep: mark active rows whose item/type no longer produces a suggestion
  // as stale (status='dismissed' with an empty signature so they re-surface
  // naturally if the item becomes problematic again).
  for (const row of existingRows) {
    if (row.status !== 'active') continue
    if (!row.rate_book_item_id) continue
    const key = `${row.rate_book_item_id}:${row.suggestion_type}`
    if (freshKeySet[key]) continue
    await supabase
      .from('item_suggestions')
      .update({
        status: 'dismissed',
        dismissed_at: new Date().toISOString(),
        dismissed_signature: 'stale:no-evidence',
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    stale += 1
  }

  return { created, updated, resurfaced, stale }
}

/** List active suggestions for the /suggestions page. */
export async function listActiveSuggestions(orgId: string): Promise<SuggestionRow[]> {
  const { data } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
  return (data || []) as SuggestionRow[]
}

/** List all suggestions (for the "Dismissed" / "Accepted" tabs). */
export async function listSuggestionsByStatus(
  orgId: string,
  status: SuggestionStatus
): Promise<SuggestionRow[]> {
  const { data } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', status)
    .order('updated_at', { ascending: false })
  return (data || []) as SuggestionRow[]
}

/**
 * Accept a suggestion. Writes the change to rate_book_items + logs a
 * rate_book_item_history row, then stamps the suggestion with accepted_at
 * and the history id. Respects `excludedJobIds` by recomputing the mean
 * actual from the non-excluded subset before applying.
 */
export async function acceptSuggestion(args: {
  orgId: string
  suggestionId: string
  userId: string | null
  reason: string
  applyScope: 'this' | 'category' | 'shop_wide'
  excludedJobIds?: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const { orgId, suggestionId, userId, reason, applyScope, excludedJobIds = [] } = args
  const { data: sugg } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single()
  if (!sugg) return { ok: false, error: 'suggestion not found' }
  const s = sugg as SuggestionRow

  // If the user flipped jobs off, recompute from the remaining evidence.
  const keptJobs = s.evidence.jobs.filter(
    (j) => !excludedJobIds.includes(j.projectId)
  )
  if (keptJobs.length === 0) {
    return { ok: false, error: 'all source jobs excluded — nothing to apply' }
  }

  let fieldChanges = s.proposed_changes.field_changes || []
  let deprecate = s.proposed_changes.deprecate || false

  // Recompute field_changes from remaining evidence for up/down/minor.
  if (
    s.suggestion_type === 'big_up' ||
    s.suggestion_type === 'big_down' ||
    s.suggestion_type === 'minor'
  ) {
    const newFieldChanges: Array<{ field: string; from: number; to: number }> = []
    for (const d of DEPTS) {
      const baseline = (s.evidence.baselineMinutesByDept[d] || 0) / 60
      const newHoursMinutes = mean(keptJobs.map((j) => j.actualMinutesByDept[d] || 0))
      const newHours = newHoursMinutes / 60
      if (Math.abs(newHours - baseline) < 0.05) continue
      newFieldChanges.push({
        field: `base_labor_hours_${d}`,
        from: Math.round(baseline * 100) / 100,
        to: Math.round(newHours * 100) / 100,
      })
    }
    fieldChanges = newFieldChanges
  }

  // ---- apply ----
  if (!s.rate_book_item_id) {
    return { ok: false, error: 'suggestion has no target item' }
  }

  let historyId: string | null = null

  if (fieldChanges.length > 0) {
    const patch: Record<string, number> = {}
    for (const fc of fieldChanges) patch[fc.field] = fc.to
    await supabase
      .from('rate_book_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', s.rate_book_item_id)
    const fieldChangesJson: Record<string, { from: number; to: number }> = {}
    for (const fc of fieldChanges) {
      fieldChangesJson[fc.field] = { from: fc.from, to: fc.to }
    }
    const { data: hist } = await supabase
      .from('rate_book_item_history')
      .insert({
        rate_book_item_id: s.rate_book_item_id,
        changed_by: userId,
        field_changes: fieldChangesJson,
        reason,
        apply_scope: applyScope,
      })
      .select('id')
      .single()
    if (hist) historyId = (hist as { id: string }).id
  }

  if (deprecate) {
    await supabase
      .from('rate_book_items')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', s.rate_book_item_id)
    const { data: hist } = await supabase
      .from('rate_book_item_history')
      .insert({
        rate_book_item_id: s.rate_book_item_id,
        changed_by: userId,
        field_changes: { active: { from: true, to: false } },
        reason: reason || 'Deprecated via suggestion',
        apply_scope: applyScope,
      })
      .select('id')
      .single()
    if (hist) historyId = (hist as { id: string }).id
  }

  // Stamp the suggestion accepted.
  await supabase
    .from('item_suggestions')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
      accepted_history_id: historyId,
      excluded_job_ids: excludedJobIds,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('org_id', orgId)

  return { ok: true }
}

/**
 * Apply a `split` suggestion: create the two new items and deprecate the
 * original. Caller passes the (possibly user-edited) new_items payload.
 */
export async function acceptSplit(args: {
  orgId: string
  suggestionId: string
  userId: string | null
  reason: string
  newItems: Array<{ name: string; baseHoursByDept: Record<LaborDept, number> }>
}): Promise<{ ok: boolean; error?: string; newItemIds?: string[] }> {
  const { orgId, suggestionId, userId, reason, newItems } = args
  const { data: sugg } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single()
  if (!sugg) return { ok: false, error: 'suggestion not found' }
  const s = sugg as SuggestionRow
  if (!s.rate_book_item_id) return { ok: false, error: 'suggestion has no target item' }

  // Read category from the original item so new items land in the same folder.
  const { data: original } = await supabase
    .from('rate_book_items')
    .select('category_id, unit')
    .eq('id', s.rate_book_item_id)
    .single()
  const orig = original as { category_id: string | null; unit: string | null } | null

  const inserted: string[] = []
  for (const item of newItems) {
    const payload = {
      org_id: orgId,
      category_id: orig?.category_id || null,
      unit: orig?.unit || 'each',
      name: item.name,
      base_labor_hours_eng: item.baseHoursByDept.eng || 0,
      base_labor_hours_cnc: item.baseHoursByDept.cnc || 0,
      base_labor_hours_assembly: item.baseHoursByDept.assembly || 0,
      base_labor_hours_finish: item.baseHoursByDept.finish || 0,
      base_labor_hours_install: item.baseHoursByDept.install || 0,
    }
    const { data: ins } = await supabase
      .from('rate_book_items')
      .insert(payload)
      .select('id')
      .single()
    if (ins) inserted.push((ins as { id: string }).id)
  }

  // Deprecate original.
  await supabase
    .from('rate_book_items')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', s.rate_book_item_id)

  const { data: hist } = await supabase
    .from('rate_book_item_history')
    .insert({
      rate_book_item_id: s.rate_book_item_id,
      changed_by: userId,
      field_changes: {
        split_into: { from: null, to: inserted },
        active: { from: true, to: false },
      },
      reason,
      apply_scope: 'this',
    })
    .select('id')
    .single()

  await supabase
    .from('item_suggestions')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
      accepted_history_id: hist ? (hist as { id: string }).id : null,
      proposed_changes: { new_items: newItems },
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('org_id', orgId)

  return { ok: true, newItemIds: inserted }
}

/** Dismiss a suggestion with a signature so it only resurfaces on new evidence. */
export async function dismissSuggestion(args: {
  orgId: string
  suggestionId: string
  userId: string | null
}): Promise<{ ok: boolean }> {
  const { orgId, suggestionId, userId } = args
  const { data: sugg } = await supabase
    .from('item_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .single()
  if (!sugg) return { ok: false }
  const s = sugg as SuggestionRow
  const signature = evidenceSignature(s.evidence.jobs)
  await supabase
    .from('item_suggestions')
    .update({
      status: 'dismissed',
      dismissed_at: new Date().toISOString(),
      dismissed_by: userId,
      dismissed_signature: signature,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('org_id', orgId)
  return { ok: true }
}

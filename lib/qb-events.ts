// ============================================================================
// lib/qb-events.ts — Phase 9: QB event intake + match-to-milestone pipeline
// ============================================================================
// This module owns everything between a raw QB payment event and a flipped
// cash_flow_receivables.status='received' row. It has four jobs:
//
//   1. insertQbEvent  — normalize + persist a new qb_events row (dedupes on
//      Intuit's event id when one is supplied).
//   2. findCandidates — given an event, score every projected milestone in
//      the org that's even remotely plausible. Combines customer-name
//      similarity, amount proximity, and expected-date proximity into a
//      single 0–1 confidence. Callers use this to auto-match when the top
//      candidate is clearly ahead, or to present the reconciliation UI with
//      a ranked list.
//   3. processIncoming — the end-to-end pipeline: insert the event, run
//      candidates, auto-match if confidence ≥ AUTO_MATCH_THRESHOLD and the
//      gap to the second-best candidate is material, otherwise leave the
//      event in 'unmatched' state for the user to review.
//   4. confirmMatch / dismissEvent / reassignMatch — the reconciliation-UI
//      actions. Each also flips the underlying cash_flow_receivables row
//      to 'received' (or reverts it) so the milestone widget on /rollup
//      picks up the change.
//
// ─── Why the scoring lives in TypeScript ───
// This is a small domain — projected milestones rarely exceed a few hundred
// rows per org at steady state — and keeping the scoring in the app layer
// (instead of a materialized view or a server-side function) makes it easy
// to iterate on weights without touching the DB. If we need to scale this
// we can always port the reducer to a Postgres function; until then,
// in-process is simpler.
// ============================================================================

import { supabase } from './supabase'

// ─── Types ───

export type QbEventType =
  | 'payment_received'
  | 'invoice_paid'
  | 'deposit_received'
  | 'other'

export type QbEventSource = 'webhook' | 'poll' | 'manual'

export type QbMatchStatus = 'unmatched' | 'matched' | 'confirmed' | 'dismissed'

export interface QbEvent {
  id: string
  org_id: string
  source: QbEventSource
  event_type: QbEventType
  qb_event_id: string | null
  qb_object_id: string | null
  occurred_at: string
  customer_name: string | null
  amount: number
  currency: string
  memo: string | null
  match_status: QbMatchStatus
  matched_project_id: string | null
  matched_receivable_id: string | null
  match_confidence: number | null
  match_reasons: string[]
  payload: Record<string, unknown>
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

export interface MatchCandidate {
  projectId: string
  projectName: string
  clientName: string | null
  receivableId: string
  milestoneLabel: string
  expectedDate: string | null
  amount: number
  confidence: number    // 0.0 – 1.0
  reasons: string[]     // human-readable scoring breakdown
}

// ─── Scoring thresholds ───
//
// These are intentionally lenient for the MVP; the reconciliation UI is the
// real safety net. Tune with real data.
//
// AUTO_MATCH_THRESHOLD — minimum top-candidate confidence to auto-confirm.
// AUTO_MATCH_GAP — minimum gap between #1 and #2 for auto-match (prevents
// grabbing one of two identical candidates without user review).
export const AUTO_MATCH_THRESHOLD = 0.85
export const AUTO_MATCH_GAP = 0.15
export const SUGGEST_THRESHOLD = 0.35   // below this we don't even suggest

// ─── Helpers ───

/**
 * Normalize a string for name comparison. Lowercases, strips punctuation,
 * collapses whitespace, and drops corporate suffixes that people drop
 * inconsistently. Returns a space-joined token string.
 */
function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[.,&'"]/g, '')
    .replace(/\b(llc|inc|corp|corporation|co|company|ltd|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Token-overlap similarity: size of intersection / size of union, with a
 * floor of 0 and ceiling of 1. Good enough for "Acme Renovations" vs
 * "Acme Renovations LLC" and similar real-world variations.
 */
function nameSimilarity(a: string | null, b: string | null): number {
  const an = normalizeName(a)
  const bn = normalizeName(b)
  if (!an || !bn) return 0
  if (an === bn) return 1
  const at = an.split(' ').filter(Boolean)
  const bt = bn.split(' ').filter(Boolean)
  if (at.length === 0 || bt.length === 0) return 0
  const bSet: Record<string, true> = {}
  for (const t of bt) bSet[t] = true
  let inter = 0
  const aUniq: Record<string, true> = {}
  for (const t of at) aUniq[t] = true
  for (const t of Object.keys(aUniq)) if (bSet[t]) inter++
  const unionCount = Object.keys({ ...aUniq, ...bSet }).length
  return unionCount === 0 ? 0 : inter / unionCount
}

/**
 * Amount similarity: 1.0 for exact match, falling off quickly. Tolerates
 * sales-tax-sized offsets without rewarding wildly different amounts. 5%
 * tolerance before the score dives.
 */
function amountSimilarity(expected: number, observed: number): number {
  if (expected <= 0 || observed <= 0) return 0
  const diff = Math.abs(expected - observed)
  const pct = diff / expected
  if (pct < 0.005) return 1.0          // under half a percent → exact
  if (pct < 0.05) return 1 - pct * 10   // 0.5–5% → linear decay to 0.5
  if (pct < 0.15) return 0.35 - (pct - 0.05) * 3 // 5–15% → 0.35→0.05
  return 0
}

/**
 * Date proximity: 1.0 when the event lands inside the expected window,
 * falling off over a ~30 day range. Returns 0.5 if either date is missing
 * (we don't penalize for missing dates — common on 'manual' milestones).
 */
function dateProximity(expected: string | null, observed: string): number {
  if (!expected) return 0.5
  const ed = new Date(expected).getTime()
  const od = new Date(observed).getTime()
  if (isNaN(ed) || isNaN(od)) return 0.5
  const days = Math.abs(od - ed) / (1000 * 60 * 60 * 24)
  if (days < 3) return 1
  if (days < 14) return 0.85
  if (days < 30) return 0.6
  if (days < 60) return 0.3
  return 0.1
}

// ─── Insert ───

export interface IncomingQbEvent {
  org_id: string
  source?: QbEventSource
  event_type: QbEventType
  qb_event_id?: string | null
  qb_object_id?: string | null
  occurred_at: string
  customer_name?: string | null
  amount: number
  currency?: string
  memo?: string | null
  payload?: Record<string, unknown>
}

/**
 * Persist an incoming QB event. If the event carries a qb_event_id that we
 * already have on file, the insert is a no-op and we return the existing
 * row (dedup via the unique partial index). Caller gets back the row id
 * and a fresh/dup flag.
 */
export async function insertQbEvent(
  input: IncomingQbEvent
): Promise<{ eventId: string; fresh: boolean } | null> {
  if (input.qb_event_id) {
    const { data: existing } = await supabase
      .from('qb_events')
      .select('id')
      .eq('org_id', input.org_id)
      .eq('qb_event_id', input.qb_event_id)
      .maybeSingle()
    if (existing?.id) return { eventId: existing.id, fresh: false }
  }
  const { data, error } = await supabase
    .from('qb_events')
    .insert({
      org_id: input.org_id,
      source: input.source || 'webhook',
      event_type: input.event_type,
      qb_event_id: input.qb_event_id || null,
      qb_object_id: input.qb_object_id || null,
      occurred_at: input.occurred_at,
      customer_name: input.customer_name || null,
      amount: input.amount,
      currency: input.currency || 'USD',
      memo: input.memo || null,
      payload: input.payload || {},
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('insertQbEvent', error)
    return null
  }
  return { eventId: data.id, fresh: true }
}

// ─── Candidate finding ───

/**
 * Scan every projected receivable in the org and score each against the
 * event. Returns candidates above SUGGEST_THRESHOLD, sorted by confidence
 * descending. Ties are broken by amount-exactness, then expected-date
 * proximity, so deterministic ordering lands.
 *
 * Candidate pool is bounded by org + status='projected' and not matched to
 * another already-confirmed event. The query joins projects for the
 * customer-name side of the score.
 */
export async function findCandidates(
  orgId: string,
  event: {
    customer_name: string | null
    amount: number
    occurred_at: string
  }
): Promise<MatchCandidate[]> {
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .select(
      'id, project_id, milestone_label, amount, expected_date, projects(id, name, client_name, org_id)'
    )
    .eq('type', 'receivable')
    .eq('status', 'projected')
  if (error || !data) {
    console.error('findCandidates', error)
    return []
  }
  const candidates: MatchCandidate[] = []
  // Supabase typings sometimes shape the joined side as an array even on a
  // one-to-one FK, depending on the generated types. Coerce through unknown
  // and normalize to a single object on the caller side.
  type Row = {
    id: string
    project_id: string
    milestone_label: string | null
    amount: number | null
    expected_date: string | null
    projects:
      | { id: string; name: string; client_name: string | null; org_id: string }
      | Array<{ id: string; name: string; client_name: string | null; org_id: string }>
      | null
  }
  for (const row of data as unknown as Row[]) {
    const proj = Array.isArray(row.projects) ? row.projects[0] : row.projects
    // Filter to this org. Supabase's PostgREST doesn't filter-on-join
    // cleanly without an RLS policy, so we do it here.
    if (!proj || proj.org_id !== orgId) continue
    const expectedAmt = Number(row.amount) || 0
    if (expectedAmt <= 0) continue

    const nameScore = nameSimilarity(proj.client_name, event.customer_name)
    const amountScore = amountSimilarity(expectedAmt, event.amount)
    const dateScore = dateProximity(row.expected_date, event.occurred_at)

    // Weighted blend: amount carries the most weight (checks with exact
    // dollar amounts are the strongest signal), customer name next, date
    // last. Weights sum to 1.0.
    const confidence = amountScore * 0.55 + nameScore * 0.3 + dateScore * 0.15

    if (confidence < SUGGEST_THRESHOLD) continue

    const reasons: string[] = []
    if (amountScore >= 0.99) {
      reasons.push(`Exact amount match ($${expectedAmt.toLocaleString()})`)
    } else if (amountScore > 0.5) {
      const pct = ((Math.abs(expectedAmt - event.amount) / expectedAmt) * 100).toFixed(1)
      reasons.push(`Amount within ${pct}% of projected`)
    } else if (amountScore > 0) {
      reasons.push(`Amount differs from projected ($${expectedAmt.toLocaleString()})`)
    }
    if (nameScore >= 0.9) {
      reasons.push(`Customer "${proj.client_name}" matches closely`)
    } else if (nameScore > 0.4) {
      reasons.push(`Customer "${proj.client_name}" partially matches`)
    } else if (nameScore > 0) {
      reasons.push(`Weak customer-name match`)
    }
    if (dateScore >= 0.85 && row.expected_date) {
      reasons.push(`Near expected date (${row.expected_date})`)
    }

    candidates.push({
      projectId: row.project_id,
      projectName: proj.name,
      clientName: proj.client_name,
      receivableId: row.id,
      milestoneLabel: row.milestone_label || 'Milestone',
      expectedDate: row.expected_date,
      amount: expectedAmt,
      confidence,
      reasons,
    })
  }
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    // Tie-break: prefer exact-amount match
    const aExact = a.amount === event.amount ? 1 : 0
    const bExact = b.amount === event.amount ? 1 : 0
    if (bExact !== aExact) return bExact - aExact
    // Then earlier expected date
    if (a.expectedDate && b.expectedDate) {
      return a.expectedDate.localeCompare(b.expectedDate)
    }
    return 0
  })
  return candidates
}

// ─── Apply / resolve ───

/**
 * End-to-end pipeline for a newly-observed event. Inserts, runs candidates,
 * auto-confirms when the top candidate is clearly ahead, otherwise parks
 * the event in 'matched' (if we have a best guess) or 'unmatched' for the
 * reconciliation UI to handle.
 */
export async function processIncoming(
  input: IncomingQbEvent
): Promise<{ eventId: string; status: QbMatchStatus; autoMatched: boolean }> {
  const ins = await insertQbEvent(input)
  if (!ins) throw new Error('Failed to insert QB event')
  if (!ins.fresh) {
    // Duplicate — leave as-is.
    const { data } = await supabase
      .from('qb_events')
      .select('match_status')
      .eq('id', ins.eventId)
      .single()
    return {
      eventId: ins.eventId,
      status: (data?.match_status as QbMatchStatus) || 'unmatched',
      autoMatched: false,
    }
  }

  const candidates = await findCandidates(input.org_id, {
    customer_name: input.customer_name || null,
    amount: input.amount,
    occurred_at: input.occurred_at,
  })
  if (candidates.length === 0) {
    return { eventId: ins.eventId, status: 'unmatched', autoMatched: false }
  }

  const top = candidates[0]
  const second = candidates[1]
  const gapOk = !second || top.confidence - second.confidence >= AUTO_MATCH_GAP
  const confidentEnough = top.confidence >= AUTO_MATCH_THRESHOLD

  if (confidentEnough && gapOk) {
    // Auto-confirm.
    await confirmMatch(ins.eventId, top.receivableId, { auto: true })
    return { eventId: ins.eventId, status: 'confirmed', autoMatched: true }
  }

  // Suggest but don't auto-apply.
  await supabase
    .from('qb_events')
    .update({
      match_status: 'matched',
      matched_project_id: top.projectId,
      matched_receivable_id: top.receivableId,
      match_confidence: top.confidence,
      match_reasons: top.reasons,
    })
    .eq('id', ins.eventId)
  return { eventId: ins.eventId, status: 'matched', autoMatched: false }
}

/**
 * Confirm that a QB event corresponds to a specific projected receivable.
 * Flips the receivable to status='received' + stamps received_date and
 * received_amount, and marks the event 'confirmed'. Safe to call for an
 * already-confirmed event (idempotent update).
 */
export async function confirmMatch(
  eventId: string,
  receivableId: string,
  opts: { auto?: boolean; reviewerId?: string } = {}
): Promise<boolean> {
  const { data: evt } = await supabase
    .from('qb_events')
    .select('org_id, amount, occurred_at')
    .eq('id', eventId)
    .single()
  if (!evt) return false
  const { data: rcv } = await supabase
    .from('cash_flow_receivables')
    .select('project_id')
    .eq('id', receivableId)
    .single()
  if (!rcv) return false

  const { error: rcvErr } = await supabase
    .from('cash_flow_receivables')
    .update({
      status: 'received',
      received_date: String(evt.occurred_at).slice(0, 10),
      received_amount: evt.amount,
    })
    .eq('id', receivableId)
  if (rcvErr) {
    console.error('confirmMatch → receivable', rcvErr)
    return false
  }
  const { error: evtErr } = await supabase
    .from('qb_events')
    .update({
      match_status: 'confirmed',
      matched_project_id: rcv.project_id,
      matched_receivable_id: receivableId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: opts.reviewerId || null,
    })
    .eq('id', eventId)
  if (evtErr) {
    console.error('confirmMatch → event', evtErr)
    return false
  }
  return true
}

/**
 * Dismiss an event. Used when the bookkeeper confirms it's a match they
 * don't want to apply (e.g. a duplicate deposit, or a QB-side reversal).
 * Does NOT touch the receivable; the milestone stays projected.
 */
export async function dismissEvent(
  eventId: string,
  reviewerId: string | null
): Promise<boolean> {
  const { error } = await supabase
    .from('qb_events')
    .update({
      match_status: 'dismissed',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', eventId)
  if (error) {
    console.error('dismissEvent', error)
    return false
  }
  return true
}

/**
 * Reassign a 'matched' event to a different candidate, then confirm. Use
 * case: the system picked the wrong milestone and the user wants to
 * redirect before applying.
 */
export async function reassignMatch(
  eventId: string,
  newReceivableId: string,
  reviewerId: string | null
): Promise<boolean> {
  return confirmMatch(eventId, newReceivableId, { reviewerId: reviewerId ?? undefined })
}

// ─── Read paths for the reconciliation UI ───

/**
 * List events for the reconciliation page, optionally filtered by status.
 * Joins the matched project + receivable + client_name so the UI can
 * render a row without additional round-trips.
 */
export async function listQbEvents(
  orgId: string,
  opts: { status?: QbMatchStatus | 'all'; limit?: number } = {}
): Promise<QbEvent[]> {
  let q = supabase
    .from('qb_events')
    .select('*')
    .eq('org_id', orgId)
    .order('occurred_at', { ascending: false })
    .limit(opts.limit ?? 200)
  if (opts.status && opts.status !== 'all') q = q.eq('match_status', opts.status)
  const { data, error } = await q
  if (error || !data) {
    console.error('listQbEvents', error)
    return []
  }
  return data as QbEvent[]
}

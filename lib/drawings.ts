// ============================================================================
// drawings.ts — data access for drawing revisions (Phase 2)
// ============================================================================
// Implements the D8 decisions from BUILD-PLAN.md against drawing_revisions in
// migrations/002_preprod_approval_schema.sql. One row per revision, is_latest
// stored (flipped on upload), approved = shop user marked it after verbal/
// email sign-off. Replaces the Apr 18 "drawings by Drive folder name"
// heuristic — revisions are always user-uploaded, never inferred.
// ============================================================================

import { supabase } from './supabase'
import type { ApprovalState } from './approvals'

// ── Types ──

export interface DrawingRevision {
  id: string
  subproject_id: string
  revision_number: number
  file_url: string | null
  state: ApprovalState
  is_latest: boolean
  uploaded_by_user_id: string | null
  submitted_at: string | null
  responded_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ── Reads ──

/**
 * Load every drawing revision for a subproject, newest revision first.
 */
export async function loadDrawingRevisions(
  subprojectId: string
): Promise<DrawingRevision[]> {
  const { data, error } = await supabase
    .from('drawing_revisions')
    .select('*')
    .eq('subproject_id', subprojectId)
    .order('revision_number', { ascending: false })

  if (error) {
    console.error('loadDrawingRevisions', error)
    return []
  }
  return (data || []) as DrawingRevision[]
}

/**
 * Find the latest revision for a subproject (is_latest = true). Returns null
 * if no revisions exist yet. The scheduling gate uses this to decide whether
 * to block handoff.
 */
export async function getLatestRevision(
  subprojectId: string
): Promise<DrawingRevision | null> {
  const { data, error } = await supabase
    .from('drawing_revisions')
    .select('*')
    .eq('subproject_id', subprojectId)
    .eq('is_latest', true)
    .maybeSingle()

  if (error) {
    console.error('getLatestRevision', error)
    return null
  }
  return (data as DrawingRevision) || null
}

// ── Upload a new revision ──

/**
 * Upload a new drawing revision. V1 accepts a URL paste (Drive, Dropbox,
 * etc.); blob storage is deferred to a later phase. Auto-increments
 * revision_number per-subproject and flips the previous latest's is_latest
 * flag to false. Starts in 'pending' state — shop user then marks it sent to
 * client (in_review) and later approved.
 */
export async function uploadNewRevision(
  subprojectId: string,
  input: {
    file_url: string
    notes?: string
    uploaded_by_user_id?: string
  }
): Promise<DrawingRevision | null> {
  // 1. Determine next revision_number.
  const { data: maxRow } = await supabase
    .from('drawing_revisions')
    .select('revision_number')
    .eq('subproject_id', subprojectId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextRevisionNumber = (maxRow?.revision_number ?? 0) + 1

  // 2. Demote previous latest (if any).
  const { error: demoteErr } = await supabase
    .from('drawing_revisions')
    .update({ is_latest: false, updated_at: new Date().toISOString() })
    .eq('subproject_id', subprojectId)
    .eq('is_latest', true)
  if (demoteErr) {
    console.error('uploadNewRevision demote', demoteErr)
    return null
  }

  // 3. Insert the new revision, is_latest = true, state = 'pending'.
  const { data, error } = await supabase
    .from('drawing_revisions')
    .insert({
      subproject_id: subprojectId,
      revision_number: nextRevisionNumber,
      file_url: input.file_url,
      state: 'pending' as ApprovalState,
      is_latest: true,
      uploaded_by_user_id: input.uploaded_by_user_id || null,
      submitted_at: new Date().toISOString(),
      notes: input.notes || null,
    })
    .select()
    .single()

  if (error) {
    console.error('uploadNewRevision insert', error)
    return null
  }
  return data as DrawingRevision
}

// ── State transitions ──

interface TransitionArgs {
  note?: string
}

/**
 * pending → in_review. Used when the shop sends the revision to the client
 * for review (email, pickup, etc.). Ball-in-court would flip to client, but
 * that's tracked on approval_items, not drawings — drawings have their own
 * state machine and the scheduling gate aggregates both.
 */
export async function submitRevisionForReview(
  revisionId: string,
  _args: TransitionArgs = {}
): Promise<void> {
  const { error } = await supabase
    .from('drawing_revisions')
    .update({
      state: 'in_review' as ApprovalState,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', revisionId)
  if (error) throw error
}

/**
 * in_review → approved. Per D8, approval means shop user marked it approved
 * after verbal/email sign-off from the client. Sets responded_at.
 */
export async function approveRevision(
  revisionId: string,
  _args: TransitionArgs = {}
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('drawing_revisions')
    .update({
      state: 'approved' as ApprovalState,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', revisionId)
  if (error) throw error
}

/**
 * in_review → pending, used when a revision needs rework before re-sending
 * (e.g., client flagged an error before formal review). Doesn't create a new
 * revision — that's uploadNewRevision's job.
 */
export async function reopenRevision(
  revisionId: string,
  _args: TransitionArgs = {}
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('drawing_revisions')
    .update({
      state: 'pending' as ApprovalState,
      responded_at: now,
      updated_at: now,
    })
    .eq('id', revisionId)
  if (error) throw error
}

/**
 * Create an "approved without upload" revision for a subproject. Used when
 * the shop has shop drawings outside the system (paper, vendor PDF, etc.)
 * and just needs to record verbal client sign-off so the scheduling gate
 * can flip green. Persists exactly like a real revision but with
 * file_url = null and a human-visible note so the absence is auditable.
 */
export async function markDrawingsApprovedManually(
  subprojectId: string,
  input: { uploaded_by_user_id?: string; notes?: string } = {}
): Promise<DrawingRevision | null> {
  const { data: maxRow } = await supabase
    .from('drawing_revisions')
    .select('revision_number')
    .eq('subproject_id', subprojectId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextRevisionNumber = (maxRow?.revision_number ?? 0) + 1

  const { error: demoteErr } = await supabase
    .from('drawing_revisions')
    .update({ is_latest: false, updated_at: new Date().toISOString() })
    .eq('subproject_id', subprojectId)
    .eq('is_latest', true)
  if (demoteErr) {
    console.error('markDrawingsApprovedManually demote', demoteErr)
    return null
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('drawing_revisions')
    .insert({
      subproject_id: subprojectId,
      revision_number: nextRevisionNumber,
      file_url: null,
      state: 'approved' as ApprovalState,
      is_latest: true,
      uploaded_by_user_id: input.uploaded_by_user_id || null,
      submitted_at: now,
      responded_at: now,
      notes:
        input.notes ||
        'Manually approved (no revision uploaded)',
    })
    .select()
    .single()
  if (error) {
    console.error('markDrawingsApprovedManually insert', error)
    return null
  }
  return data as DrawingRevision
}

// ── Derived helpers ──

/**
 * "Ready from drawings perspective" — there's a latest revision and it's
 * approved. Phase 3 scheduling gate will combine this with the
 * approval_items check. Mirror of the SQL gate in 002's view.
 */
export function isDrawingsGateGreen(revs: DrawingRevision[]): boolean {
  const latest = revs.find((r) => r.is_latest)
  return latest !== undefined && latest.state === 'approved'
}

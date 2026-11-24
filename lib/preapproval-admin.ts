// ============================================================================
// lib/preapproval-admin.ts — the SHOP's side of the B2B approval portal
// ============================================================================
// Browser-side helpers for the pre-production page. Split deliberately, the
// same way lib/portal-admin splits 092's portal:
//   • the portal LINK (a bearer credential), the notify queue and finish
//     PHOTOS (private bucket, no storage policy) go through authenticated
//     SERVER routes on the service role;
//   • lead time, the questions thread and answers go direct through RLS — the
//     tables have a FOR ALL own-org policy, so a signed-in shop user is
//     entitled to them. Every such write selects the row back and treats zero
//     rows as a failure (the standing rule: a refused write is otherwise a
//     success-shaped silence).
//
// Nothing here is imported by the public portal; that reads through
// lib/preapproval-portal on the service role. Keep it that way.
// ============================================================================

import { supabase } from './supabase'
import type { PortalActivityEntry } from './preapproval-view'

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error || fallback
}

// ── Link + notify queue ─────────────────────────────────────────────────────

export interface PortalAdminState {
  link: { url: string; issuedAt: string | null } | null
  lastNotifiedAt: string | null
  pocEmail: string | null
  /** Changes since the last "updates sent" stamp, newest first. */
  queue: PortalActivityEntry[]
  /** The prefilled email — null until there's a link to put in it. */
  email: { subject: string; body: string } | null
}

export async function loadPortalAdminState(projectId: string): Promise<PortalAdminState | null> {
  const res = await fetch(`/api/preapproval/${projectId}`, { headers: await authHeader(), cache: 'no-store' })
  if (!res.ok) {
    console.error('loadPortalAdminState', res.status)
    return null
  }
  return (await res.json()) as PortalAdminState
}

/** 'link' mints one if there isn't one · 'reissue' kills every link already
 *  sent · 'notified' stamps the queue cleared. Throws with the server's words. */
export async function portalAdminAction(
  projectId: string,
  action: 'link' | 'reissue' | 'notified',
): Promise<PortalAdminState> {
  const res = await fetch(`/api/preapproval/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(await errorOf(res, 'Could not update the portal link.'))
  return (await res.json()) as PortalAdminState
}

// ── Lead time ───────────────────────────────────────────────────────────────

/** "8", "8.5", "" → 8, 8.5, null. Anything else is rejected, not guessed at. */
export function parseLeadTimeWeeks(raw: string): { ok: true; weeks: number | null } | { ok: false } {
  const v = raw.trim()
  if (!v) return { ok: true, weeks: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 104) return { ok: false }
  return { ok: true, weeks: Math.round(n * 10) / 10 }
}

export async function loadLeadTimeWeeks(projectId: string): Promise<number | null> {
  // Isolated select: folding lead_time_weeks into the page's main project
  // read would 42703 that whole read on a pre-135 database.
  const { data, error } = await supabase.from('projects').select('lead_time_weeks').eq('id', projectId).maybeSingle()
  if (error) return null
  const n = Number((data as { lead_time_weeks?: number | null } | null)?.lead_time_weeks)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** null = no lead time → the portal hides the callout. */
export async function saveLeadTimeWeeks(projectId: string, weeks: number | null): Promise<void> {
  const { data, error } = await supabase
    .from('projects')
    .update({ lead_time_weeks: weeks })
    .eq('id', projectId)
    .select('id')
  if (error) throw new Error(/lead_time_weeks/.test(error.message) ? 'Run migration 135 first.' : error.message)
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
}

// ── Questions thread ────────────────────────────────────────────────────────

export interface PortalQuestionRow {
  id: string
  body: string
  author_name: string
  created_at: string
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  task_id: string | null
  /** True while the task the question created is still open. */
  taskOpen: boolean
}

export function unansweredCount(rows: Pick<PortalQuestionRow, 'answer'>[]): number {
  return rows.filter((q) => !q.answer?.trim()).length
}

export async function listPortalQuestions(projectId: string): Promise<PortalQuestionRow[]> {
  const { data, error } = await supabase
    .from('portal_questions')
    .select('id, body, author_name, created_at, answer, answered_by, answered_at, task_id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) {
    // Pre-135 the table isn't there. No thread, not a broken page.
    console.warn('listPortalQuestions', error.message)
    return []
  }
  const rows = (data || []) as Omit<PortalQuestionRow, 'taskOpen'>[]
  const taskIds = rows.map((r) => r.task_id).filter((x): x is string => !!x)
  const open = new Set<string>()
  if (taskIds.length) {
    const { data: tasks } = await supabase.from('tasks').select('id, done_at').in('id', taskIds)
    for (const t of (tasks || []) as { id: string; done_at: string | null }[]) if (!t.done_at) open.add(t.id)
  }
  return rows.map((r) => ({ ...r, taskOpen: !!r.task_id && open.has(r.task_id) }))
}

/** Writes answer / answered_by / answered_at — which is what makes it appear,
 *  time-stamped, on the client's portal. */
export async function answerPortalQuestion(questionId: string, answer: string, userId: string | null): Promise<void> {
  const text = answer.trim()
  if (!text) throw new Error('Type an answer first.')
  const { data, error } = await supabase
    .from('portal_questions')
    .update({ answer: text, answered_by: userId, answered_at: new Date().toISOString() })
    .eq('id', questionId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The answer could not be saved.')
}

// ── Finish photos (slot editor) ─────────────────────────────────────────────

export interface ApprovalPhoto {
  id: string
  url: string
  caption: string | null
  addedBy: string | null
  fromClient: boolean
  createdAt: string
}

export async function listApprovalPhotos(itemId: string): Promise<ApprovalPhoto[]> {
  const res = await fetch(`/api/preapproval/photos?itemId=${encodeURIComponent(itemId)}`, {
    headers: await authHeader(),
    cache: 'no-store',
  })
  if (!res.ok) return []
  return ((await res.json()) as { photos: ApprovalPhoto[] }).photos
}

export async function uploadApprovalPhoto(itemId: string, file: File, caption = ''): Promise<ApprovalPhoto[]> {
  const form = new FormData()
  form.append('itemId', itemId)
  form.append('file', file)
  form.append('caption', caption)
  const res = await fetch('/api/preapproval/photos', { method: 'POST', headers: await authHeader(), body: form })
  if (!res.ok) throw new Error(await errorOf(res, 'Could not upload the photo.'))
  return ((await res.json()) as { photos: ApprovalPhoto[] }).photos
}

export async function deleteApprovalPhoto(photoId: string): Promise<ApprovalPhoto[]> {
  const res = await fetch(`/api/preapproval/photos?photoId=${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error(await errorOf(res, 'Could not remove the photo.'))
  return ((await res.json()) as { photos: ApprovalPhoto[] }).photos
}

// ============================================================================
// lib/preapproval-portal.ts — the B2B approval portal's SERVER side (135)
// ============================================================================
// ⛔ SERVER ONLY. Everything here runs on the SERVICE ROLE and is reachable
// from an UNAUTHENTICATED request carrying nothing but a token. Import it from
// app/(preapproval)/p/** and app/api/p/** (and the shop's authenticated
// /api/preapproval/** routes) — never from a component.
//
// ⛔ NO ANON GRANTS, ANYWHERE. Migration 135 gives the public key nothing. The
// portal therefore cannot read or write a single row except through this file.
//
// ⛔ THE COLUMN LISTS ARE THE SECURITY BOUNDARY ON THE WAY IN. Every select
// names its columns; there is no `select('*')` and there must never be one.
// `projects` carries bid totals, margins, the locked shop rate and site-access
// notes; `approval_items` carries custom cost + labor-hour baselines; `orgs`
// carries plan, Stripe ids and everyone's pay. None of those are named below,
// and lib/preapproval-view.ts copies the rest across by name on the way out.
// scripts/verify-portal-b2b.mjs greps both halves.
//
// Access is PER PROJECT (unlike 092's per-client portal): one unguessable
// token on projects.portal_token opens exactly that project. Every write
// re-proves the row it touches hangs off the token's project.
// ============================================================================

import { randomBytes, randomUUID } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { draftCoItemIds } from './client-portal'
import {
  buildPortalView,
  cleanPortalName,
  cleanPortalText,
  contactChanges,
  isUsablePortalName,
  PORTAL_CONTACT_FIELDS,
  PORTAL_EVENT_TYPES,
  type PortalTeamContact,
  type PreapprovalPortal,
  type RawPortalDrawing,
  type RawPortalEvent,
  type RawPortalInput,
  type RawPortalItem,
  type RawPortalItemRevision,
  type RawPortalPhoto,
  type RawPortalProject,
  type RawPortalQuestion,
  type RawPortalSub,
} from './preapproval-view'

export const APPROVAL_PHOTO_BUCKET = 'approval-photos'
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_MAX_PER_ITEM = 24
export const PHOTO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/** The tag a portal question's task carries (tasks store tag NAMES — 098). */
export const PORTAL_QUESTION_TAG = 'PM Communication'

/** Stages whose project a client may open. An unsold or lost job has no
 *  portal even if a token was minted on it earlier. */
const PORTAL_STAGES = ['sold', 'production', 'installed', 'complete']

// ── Token ───────────────────────────────────────────────────────────────────

/** 32 URL-safe characters from 24 random bytes — same shape as 092's. */
export function mintProjectPortalToken(): string {
  return randomBytes(24).toString('base64url')
}

export interface PortalProjectIdentity {
  projectId: string
  orgId: string
  projectName: string
}

/**
 * Token → project. The single gate every portal read and write goes through.
 * Null for anything unrecognised, with no distinction between "no such token",
 * "malformed" and "that project isn't client-visible" — callers 404 either way.
 */
export async function resolveProjectPortalToken(token: string): Promise<PortalProjectIdentity | null> {
  const clean = (token || '').trim()
  // Tokens are base64url. Reject anything else before it reaches the database.
  if (!clean || clean.length < 16 || clean.length > 128 || !/^[A-Za-z0-9_-]+$/.test(clean)) return null
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id, org_id, name')
    .eq('portal_token', clean)
    .is('practice_at', null)
    .in('stage', PORTAL_STAGES)
    .maybeSingle()
  const row = data as { id: string; org_id: string; name: string } | null
  if (!row?.id || !row.org_id) return null
  return { projectId: row.id, orgId: row.org_id, projectName: row.name || 'Project' }
}

// ── The shop's contact: ONE person, name / title / email / phone ────────────

interface RosterRow {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  userId: string | null
}

export interface ResolvedPm {
  /** Roster id (tasks.assignee_ids' id space) — null when nobody resolves. */
  rosterId: string | null
  userId: string | null
  contact: PortalTeamContact
}

/**
 * Who the client is told to call, and who a portal question's task goes to.
 *
 * In order: the org's pre-production coordinator (Settings → Automatic tasks,
 * `auto_task_rules.preprod_coordinator`) → a roster member titled "project
 * manager" → Kaylin by name (Andrew's spec for BUILT) → the org owner. With
 * nobody on the roster at all, the card falls back to the shop's own name and
 * business contact, and the task is created unassigned.
 *
 * ⛔ Only this ONE person's name/title/email/phone ever reaches the portal.
 * `team_members` also holds everyone's pay — it is read here, never returned.
 */
export async function resolvePortalPm(orgId: string): Promise<ResolvedPm> {
  const [{ data: orgRow }, { data: ownerRow }] = await Promise.all([
    supabaseAdmin
      .from('orgs')
      .select(
        'name, team_members, auto_task_rules, business_address, business_city, business_state, business_zip, business_phone, business_email',
      )
      .eq('id', orgId)
      .maybeSingle(),
    supabaseAdmin.from('users').select('id').eq('org_id', orgId).eq('role', 'owner').limit(1).maybeSingle(),
  ])
  const org = (orgRow || {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const roster: RosterRow[] = (Array.isArray(org.team_members) ? org.team_members : [])
    .filter((m: any) => m && m.id && str(m.name) && m.active !== false)
    .map((m: any) => ({
      id: String(m.id),
      name: str(m.name)!,
      title: str(m.title),
      email: str(m.email),
      phone: str(m.phone),
      userId: m.user_id ? String(m.user_id) : null,
    }))

  const coordinatorId = str((org.auto_task_rules as Record<string, unknown> | null)?.preprod_coordinator)
  const ownerUserId = (ownerRow as { id: string } | null)?.id ?? null
  const pm =
    roster.find((m) => m.id === coordinatorId) ||
    roster.find((m) => /project manager/i.test(m.title || '')) ||
    roster.find((m) => /^kaylin\b/i.test(m.name)) ||
    roster.find((m) => ownerUserId && m.userId === ownerUserId) ||
    null

  const cityLine = [str(org.business_city), [str(org.business_state), str(org.business_zip)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const shopAddress = [str(org.business_address), cityLine].filter(Boolean).join(', ') || null
  const orgName = str(org.name) || 'Your shop'

  return {
    rosterId: pm?.id ?? null,
    userId: pm?.userId ?? null,
    contact: {
      name: pm?.name ?? orgName,
      title: pm ? pm.title || 'Project Manager' : null,
      email: pm?.email ?? str(org.business_email),
      phone: pm?.phone ?? str(org.business_phone),
      shopAddress,
    },
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

const PROJECT_COLS =
  'id, name, client_name, sold_at, lead_time_weeks, portal_token_issued_at, poc_name, poc_email, poc_phone, delivery_address, client_deadline'
const SUB_COLS = 'id, name, sort_order'
const ITEM_COLS =
  'id, subproject_id, label, material, finish, state, ball_in_court, last_state_change_at, item_kind, link_url, created_at'
const ITEM_REV_COLS = 'id, approval_item_id, action, note, actor_name, occurred_at'
const DRAWING_COLS =
  'id, subproject_id, revision_number, file_url, state, is_latest, submitted_at, responded_at, responded_by_name, notes'
const PHOTO_COLS = 'id, approval_item_id, storage_path, caption, added_by, from_client, created_at'
const QUESTION_COLS = 'id, body, author_name, created_at, answer, answered_by, answered_at'
const EVENT_COLS = 'id, event_type, label, created_at'

/** One hour — long enough to read the page, short enough that a copied image
 *  URL isn't a second, permanent link. */
const SIGNED_URL_SECONDS = 3600

async function signPhotoPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data } = await supabaseAdmin.storage.from(APPROVAL_PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  for (const row of data || []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl)
  }
  return out
}

/** The raw, already-allowlisted rows for one project. Shared by the public
 *  page and the shop's own queue (which needs the same activity). */
export async function loadPortalRaw(id: PortalProjectIdentity): Promise<RawPortalInput | null> {
  const [{ data: projRow }, { data: subRows }, pm, { data: orgRow }] = await Promise.all([
    supabaseAdmin.from('projects').select(PROJECT_COLS).eq('id', id.projectId).eq('org_id', id.orgId).maybeSingle(),
    supabaseAdmin.from('subprojects').select(SUB_COLS).eq('project_id', id.projectId).order('sort_order'),
    resolvePortalPm(id.orgId),
    supabaseAdmin.from('orgs').select('name').eq('id', id.orgId).maybeSingle(),
  ])
  const project = projRow as RawPortalProject | null
  if (!project) return null
  const subs = (subRows as RawPortalSub[] | null) || []
  const subIds = subs.map((s) => s.id)

  const [{ data: itemRows }, { data: drawingRows }, { data: questionRows }, { data: eventRows }] = await Promise.all([
    subIds.length
      ? supabaseAdmin.from('approval_items').select(ITEM_COLS).in('subproject_id', subIds).is('dismissed_at', null)
      : Promise.resolve({ data: [] as unknown[] }),
    subIds.length
      ? supabaseAdmin.from('drawing_revisions').select(DRAWING_COLS).in('subproject_id', subIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from('portal_questions').select(QUESTION_COLS).eq('project_id', id.projectId).order('created_at'),
    supabaseAdmin
      .from('project_events')
      .select(EVENT_COLS)
      .eq('project_id', id.projectId)
      .in('event_type', [...PORTAL_EVENT_TYPES]),
  ])
  const items = (itemRows as RawPortalItem[] | null) || []
  const itemIds = items.map((i) => i.id)

  const [{ data: revRows }, { data: photoRows }, blocked] = await Promise.all([
    itemIds.length
      ? supabaseAdmin.from('item_revisions').select(ITEM_REV_COLS).in('approval_item_id', itemIds)
      : Promise.resolve({ data: [] as unknown[] }),
    itemIds.length
      ? supabaseAdmin.from('approval_item_photos').select(PHOTO_COLS).in('approval_item_id', itemIds).order('created_at')
      : Promise.resolve({ data: [] as unknown[] }),
    draftCoItemIds(itemIds),
  ])

  const rawPhotos = (photoRows as Array<Omit<RawPortalPhoto, 'url'> & { storage_path: string }> | null) || []
  const signed = await signPhotoPaths(rawPhotos.map((p) => p.storage_path))
  const photos: RawPortalPhoto[] = rawPhotos
    .filter((p) => signed.has(p.storage_path))
    .map((p) => ({
      id: p.id,
      approval_item_id: p.approval_item_id,
      caption: p.caption,
      added_by: p.added_by,
      from_client: p.from_client === true,
      created_at: p.created_at,
      url: signed.get(p.storage_path)!,
    }))

  const pmFirst = pm.contact.name.split(/\s+/)[0]
  const questions: RawPortalQuestion[] = (
    (questionRows as Array<{
      id: string
      body: string
      author_name: string
      created_at: string
      answer: string | null
      answered_by: string | null
      answered_at: string | null
    }> | null) || []
  ).map((q) => ({
    id: q.id,
    body: q.body,
    author_name: q.author_name,
    created_at: q.created_at,
    answer: q.answer,
    answered_at: q.answered_at,
    // The PM's first name only when the PM answered — never another teammate's.
    answered_by_label: q.answered_by && pm.userId && q.answered_by === pm.userId ? pmFirst : null,
  }))

  return {
    orgName: ((orgRow as { name?: string } | null)?.name || '').trim() || 'Your shop',
    team: pm.contact,
    project,
    subs,
    items,
    itemRevisions: (revRows as RawPortalItemRevision[] | null) || [],
    drawings: (drawingRows as RawPortalDrawing[] | null) || [],
    photos,
    questions,
    events: (eventRows as RawPortalEvent[] | null) || [],
    blockedItemIds: [...blocked],
  }
}

/** The public page. Null → the caller 404s. */
export async function loadPreapprovalPortal(token: string): Promise<PreapprovalPortal | null> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return null
  const raw = await loadPortalRaw(id)
  return raw ? buildPortalView(raw) : null
}

/** Just the shop's name, for the browser tab (never "MillSuite — Project
 *  Profit Tracker" in front of a client). */
export async function loadPortalTabTitle(token: string): Promise<string | null> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return null
  const { data } = await supabaseAdmin.from('orgs').select('name').eq('id', id.orgId).maybeSingle()
  return (data as { name?: string } | null)?.name?.trim() || null
}

// ── Writes ──────────────────────────────────────────────────────────────────
// Each returns { status, body } so the route handlers stay one-liners and
// "no such token", "not this project's row" and "no such row" are all the
// same 404. Every UPDATE selects the row back: a zero-row update is a
// success-shaped silence through PostgREST.

export interface PortalWriteResult {
  status: number
  body: Record<string, unknown>
}

const NOT_FOUND: PortalWriteResult = { status: 404, body: { error: 'Not found' } }
const bad = (error: string): PortalWriteResult => ({ status: 400, body: { error } })
const conflict = (error: string): PortalWriteResult => ({ status: 409, body: { error } })
const failed = (error: string): PortalWriteResult => ({ status: 500, body: { error } })
const OK: PortalWriteResult = { status: 200, body: { ok: true } }

async function subprojectIds(projectId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('subprojects').select('id').eq('project_id', projectId)
  return ((data as { id: string }[] | null) || []).map((s) => s.id)
}

/** The item, only if it hangs off THIS project and isn't a tombstone. */
async function ownedItem(projectId: string, itemId: string) {
  const subIds = await subprojectIds(projectId)
  if (!itemId || subIds.length === 0) return null
  const { data } = await supabaseAdmin
    .from('approval_items')
    .select('id, label, state, ball_in_court, subproject_id')
    .eq('id', itemId)
    .in('subproject_id', subIds)
    .is('dismissed_at', null)
    .maybeSingle()
  return data as { id: string; label: string; state: string; ball_in_court: string | null } | null
}

/** The drawing revision, only if it hangs off THIS project. */
async function ownedDrawing(projectId: string, revisionId: string) {
  const subIds = await subprojectIds(projectId)
  if (!revisionId || subIds.length === 0) return null
  const { data } = await supabaseAdmin
    .from('drawing_revisions')
    .select('id, state, is_latest, revision_number')
    .eq('id', revisionId)
    .in('subproject_id', subIds)
    .maybeSingle()
  return data as { id: string; state: string; is_latest: boolean; revision_number: number } | null
}

/**
 * Mirrors lib/approvals.applyTransition on the service role (that helper runs
 * on the browser client, which has no session in a route handler): flip the
 * state + ball, write the item_revisions audit row — with the client's TYPED
 * NAME on it — and mirror both to any slot linked TO this one. If
 * applyTransition grows a step, it has to grow here too.
 *
 * Deliberately does NOT run finalizeSpecCosOnApproval: an item carrying a
 * draft change order is refused before this is reached.
 */
async function transitionItem(
  itemId: string,
  to: { state: 'approved' | 'pending'; ball: 'shop' | null; action: 'approved' | 'client_requested_change' },
  name: string,
  note: string,
  prev: { state: string; ball_in_court: string | null },
): Promise<PortalWriteResult> {
  const now = new Date().toISOString()
  const patch = { state: to.state, ball_in_court: to.ball, last_state_change_at: now, updated_at: now }
  const { data: updated, error } = await supabaseAdmin.from('approval_items').update(patch).eq('id', itemId).select('id')
  if (error) return failed(error.message)
  if (!updated || updated.length === 0) return failed('Nothing was updated')

  const { error: revErr } = await supabaseAdmin.from('item_revisions').insert({
    approval_item_id: itemId,
    action: to.action,
    note,
    actor_user_id: null,
    actor_name: name,
    occurred_at: now,
  })
  // The audit row IS the signature — a state change without it must not read
  // as done. Put the state back rather than leave an unsigned approval.
  if (revErr) {
    await supabaseAdmin
      .from('approval_items')
      .update({ state: prev.state, ball_in_court: prev.ball_in_court, updated_at: now })
      .eq('id', itemId)
    return failed(revErr.message)
  }

  const { data: deps } = await supabaseAdmin.from('approval_items').select('id').eq('linked_to_item_id', itemId)
  for (const dep of (deps as { id: string }[] | null) || []) {
    await supabaseAdmin.from('approval_items').update(patch).eq('id', dep.id)
    await supabaseAdmin.from('item_revisions').insert({
      approval_item_id: dep.id,
      action: to.action,
      note: `(auto) linked to ${itemId}`,
      actor_user_id: null,
      actor_name: name,
      occurred_at: now,
    })
  }
  return OK
}

interface TargetBody {
  type?: unknown
  id?: unknown
  name?: unknown
  note?: unknown
}

/** Approve one callout or one drawing revision, signed with a typed name. */
export async function portalApprove(token: string, body: TargetBody | null): Promise<PortalWriteResult> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return NOT_FOUND
  const name = cleanPortalName(body?.name)
  const targetId = String(body?.id || '')
  if (!targetId) return bad('Bad request')
  if (!isUsablePortalName(name)) return bad('Type your name to approve')

  if (body?.type === 'drawing') {
    const rev = await ownedDrawing(id.projectId, targetId)
    if (!rev) return NOT_FOUND
    if (!rev.is_latest) return conflict('A newer revision has been submitted — reload to see it')
    if (rev.state === 'approved') return { status: 200, body: { ok: true, alreadyApproved: true } }
    if (rev.state !== 'in_review') return conflict('These drawings aren’t with you right now')
    const now = new Date().toISOString()
    const { data: updated, error } = await supabaseAdmin
      .from('drawing_revisions')
      .update({ state: 'approved', responded_at: now, responded_by_name: name, updated_at: now })
      .eq('id', rev.id)
      .eq('is_latest', true)
      .eq('state', 'in_review')
      .select('id')
    if (error) return failed(error.message)
    if (!updated || updated.length === 0) return conflict('These drawings changed — reload and try again')
    return OK
  }

  const item = await ownedItem(id.projectId, targetId)
  if (!item) return NOT_FOUND
  // Idempotent: a double-tap is a no-op, not a second audit row.
  if (item.state === 'approved') return { status: 200, body: { ok: true, alreadyApproved: true } }
  // The ball has to be with the client. A stale tab must not approve something
  // the shop has pulled back for a new sample round.
  if (item.ball_in_court !== 'client') return conflict('This one isn’t with you right now')
  // ⛔ Priced-change guard (same as 092's portal): approving an item with a
  // draft change order would, in the app, finalize that CO's price. The client
  // has been shown no number here — and never will be on this page.
  if ((await draftCoItemIds([item.id])).has(item.id)) return conflict('A change order is needed for this first')
  return transitionItem(item.id, { state: 'approved', ball: null, action: 'approved' }, name, 'Approved in the portal', item)
}

/**
 * Request a change — a note is required. Uses the app's own change-request
 * transition (lib/approvals.requestChange): the item goes back to the shop
 * (pending, ball = shop) with a `client_requested_change` revision row, so the
 * pre-production card offers "Sample submitted" for the next round.
 */
export async function portalRequestChange(token: string, body: TargetBody | null): Promise<PortalWriteResult> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return NOT_FOUND
  const name = cleanPortalName(body?.name)
  const note = cleanPortalText(body?.note, 1000)
  const targetId = String(body?.id || '')
  if (!targetId) return bad('Bad request')
  if (!isUsablePortalName(name)) return bad('Type your name')
  if (note.length < 3) return bad('Tell us what to change')

  if (body?.type === 'drawing') {
    const rev = await ownedDrawing(id.projectId, targetId)
    if (!rev) return NOT_FOUND
    if (!rev.is_latest) return conflict('A newer revision has been submitted — reload to see it')
    if (rev.state !== 'in_review') return conflict('These drawings aren’t with you right now')
    const now = new Date().toISOString()
    const { data: updated, error } = await supabaseAdmin
      .from('drawing_revisions')
      .update({ state: 'pending', responded_at: now, responded_by_name: name, notes: note, updated_at: now })
      .eq('id', rev.id)
      .eq('is_latest', true)
      .eq('state', 'in_review')
      .select('id')
    if (error) return failed(error.message)
    if (!updated || updated.length === 0) return conflict('These drawings changed — reload and try again')
    return OK
  }

  const item = await ownedItem(id.projectId, targetId)
  if (!item) return NOT_FOUND
  if (item.state === 'approved') return conflict('This one is already approved — ask us a question below instead')
  if (item.ball_in_court !== 'client') return conflict('This one isn’t with you right now')
  return transitionItem(
    item.id,
    { state: 'pending', ball: 'shop', action: 'client_requested_change' },
    name,
    note,
    item,
  )
}

/** Today in the shop's timezone (YYYY-MM-DD) — a question asked at 8pm
 *  Eastern must land in Today, not in tomorrow's UTC date. */
function shopToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.SHOP_TIMEZONE || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * A client question: one portal_questions row AND one task for the PM, tagged
 * "PM Communication", linked to the project.
 *
 * The question is the thing that must not be lost — if the task insert fails
 * the question still stands (it shows on pre-production with its unanswered
 * badge) and the failure is logged, not returned to the client.
 */
export async function portalAskQuestion(
  token: string,
  body: { name?: unknown; body?: unknown } | null,
): Promise<PortalWriteResult> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return NOT_FOUND
  const name = cleanPortalName(body?.name)
  const text = cleanPortalText(body?.body, 2000)
  if (!isUsablePortalName(name)) return bad('Add your name so we know who’s asking')
  if (text.length < 3) return bad('Type your question first')

  const { data: q, error } = await supabaseAdmin
    .from('portal_questions')
    .insert({ org_id: id.orgId, project_id: id.projectId, body: text, author_name: name })
    .select('id')
    .single()
  if (error || !q) return failed(error?.message || 'Could not send your question')

  try {
    const pm = await resolvePortalPm(id.orgId)
    const today = shopToday()
    const { data: task, error: taskErr } = await supabaseAdmin
      .from('tasks')
      .insert({
        org_id: id.orgId,
        project_id: id.projectId,
        title: `Portal question — ${id.projectName}`,
        description: `${name} asked in the approval portal:\n\n${text}`,
        need_by: today,
        bucket: 'today',
        assignee_ids: pm.rosterId ? [pm.rosterId] : [],
        tags: [PORTAL_QUESTION_TAG],
        created_by: null,
        critical: false,
        seen_by: [],
        sort_order: -Date.now(),
      })
      .select('id')
      .single()
    if (taskErr || !task) throw new Error(taskErr?.message || 'no task row')
    await supabaseAdmin.from('portal_questions').update({ task_id: (task as { id: string }).id }).eq('id', (q as { id: string }).id)
  } catch (e) {
    console.error('portalAskQuestion: task not created', e)
  }
  return OK
}

/**
 * The client fixes their own info. Writes the SAME handoff columns the
 * pre-production HandoffCard writes, and logs one project_events row per
 * changed field (which is what puts it in Activity and the notify queue).
 */
export async function portalEditContact(
  token: string,
  body: { fields?: unknown } | null,
): Promise<PortalWriteResult> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return NOT_FOUND
  const { data: cur } = await supabaseAdmin
    .from('projects')
    .select('poc_name, poc_email, poc_phone, delivery_address, client_deadline, client_name')
    .eq('id', id.projectId)
    .maybeSingle()
  const current = (cur || {}) as Record<string, string | null>
  const changes = contactChanges(current, body?.fields)
  if (changes.length === 0) return { status: 200, body: { ok: true, changed: 0 } }

  const emailChange = changes.find((c) => c.field === 'poc_email')
  if (emailChange && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailChange.value)) return bad('That email doesn’t look right')

  const patch: Record<string, string> = { updated_at: new Date().toISOString() }
  for (const c of changes) patch[c.field] = c.value
  const { data: updated, error } = await supabaseAdmin.from('projects').update(patch).eq('id', id.projectId).select('id')
  if (error) return failed(error.message)
  if (!updated || updated.length === 0) return failed('Nothing was updated')

  const who =
    (changes.find((c) => c.field === 'poc_name')?.value || current.poc_name || current.client_name || 'Client').trim()
  await supabaseAdmin.from('project_events').insert(
    changes.map((c) => ({
      org_id: id.orgId,
      project_id: id.projectId,
      event_type: 'portal_contact_edit',
      label: `${who} updated the ${PORTAL_CONTACT_FIELDS[c.field].label}`,
      meta: { field: c.field, from: current[c.field] ?? null, to: c.value, source: 'portal' },
      actor_user_id: null,
    })),
  )
  return { status: 200, body: { ok: true, changed: changes.length } }
}

/** Upload one photo's bytes + its row together; the row is inserted only
 *  after the upload lands, and the object is removed if the row is refused. */
export async function storeApprovalPhoto(input: {
  orgId: string
  projectId: string
  itemId: string
  file: File
  addedBy: string | null
  fromClient: boolean
  caption?: string | null
}): Promise<PortalWriteResult> {
  const { file } = input
  const ext = PHOTO_TYPES[file.type]
  if (!ext) return bad(`That file type isn’t supported (${file.type || 'unknown'})`)
  if (file.size > PHOTO_MAX_BYTES) return bad('That photo is over 10 MB')
  const { count } = await supabaseAdmin
    .from('approval_item_photos')
    .select('id', { count: 'exact', head: true })
    .eq('approval_item_id', input.itemId)
  if ((count ?? 0) >= PHOTO_MAX_PER_ITEM) return conflict('This item already has the maximum number of photos')

  const path = `${input.orgId}/${input.projectId}/${input.itemId}/${randomUUID()}.${ext}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(APPROVAL_PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (upErr) return failed(upErr.message || 'Upload failed')

  const { data, error } = await supabaseAdmin
    .from('approval_item_photos')
    .insert({
      org_id: input.orgId,
      approval_item_id: input.itemId,
      storage_path: path,
      caption: (input.caption || '').trim().slice(0, 120) || null,
      added_by: input.addedBy,
      from_client: input.fromClient,
    })
    .select('id')
    .single()
  if (error || !data) {
    await supabaseAdmin.storage.from(APPROVAL_PHOTO_BUCKET).remove([path])
    return failed(error?.message || 'Could not save the photo')
  }
  return { status: 200, body: { ok: true, id: (data as { id: string }).id } }
}

/** The client's "+" on a finish. Token → project → the item must be this
 *  project's and still open. */
export async function portalAddPhoto(token: string, form: FormData | null): Promise<PortalWriteResult> {
  const id = await resolveProjectPortalToken(token)
  if (!id) return NOT_FOUND
  const file = form?.get('file')
  if (!form || !(file instanceof File)) return bad('No file')
  const name = cleanPortalName(form.get('name'))
  if (!isUsablePortalName(name)) return bad('Add your name with the photo')
  const item = await ownedItem(id.projectId, String(form.get('itemId') || ''))
  if (!item) return NOT_FOUND
  if (item.state === 'approved') return conflict('This one is already approved')
  return storeApprovalPhoto({
    orgId: id.orgId,
    projectId: id.projectId,
    itemId: item.id,
    file,
    addedBy: name,
    fromClient: true,
  })
}

/** Signed URLs for the shop's own slot editor (bucket is private). */
export async function signedPhotosForItem(itemId: string) {
  const { data } = await supabaseAdmin
    .from('approval_item_photos')
    .select(PHOTO_COLS)
    .eq('approval_item_id', itemId)
    .order('created_at')
  const rows = (data as Array<Omit<RawPortalPhoto, 'url'> & { storage_path: string }> | null) || []
  const signed = await signPhotoPaths(rows.map((r) => r.storage_path))
  return rows
    .filter((r) => signed.has(r.storage_path))
    .map((r) => ({
      id: r.id,
      url: signed.get(r.storage_path)!,
      caption: r.caption,
      addedBy: r.added_by,
      fromClient: r.from_client === true,
      createdAt: r.created_at,
    }))
}

// ============================================================================
// lib/preapproval-view.ts — the B2B approval portal's PUBLIC read model
// ============================================================================
// PURE. No supabase import, no Node APIs — it runs on the server (the real
// portal), in the browser (the /dev fixture) and under tsx (the verify script).
//
// ⛔ `PreapprovalPortal` IS EVERYTHING A STRANGER WITH THE LINK RECEIVES. The
// page is public-by-link, so this type is the security boundary on the way
// OUT, the same way lib/preapproval-portal.ts's column lists are on the way
// in. It must never grow a price, a margin, a cost, an hour, a payment, an
// internal note, a site-access note, or a teammate other than the one PM
// contact. `buildPortalView` copies fields across BY NAME — it never spreads a
// raw row — so an extra column on a raw row cannot ride along
// (verify-portal-b2b poisons the raw rows and proves it).
//
// Free text is exposed only when the CLIENT wrote it: a change-request note
// counts when the revision carries a typed portal name (actor_name /
// responded_by_name), and never otherwise — shop-side notes on those same
// rows ("Approval overridden — sign-off happened outside MillSuite…") stay in.
// ============================================================================

import { ITEM_KINDS, KIND_GROUP_LABEL, normalizeItemKind, safeHttpUrl, type ItemKind } from './approval-kind'

// ── Raw rows (what the server loader hands in) ──────────────────────────────

export interface RawPortalProject {
  id: string
  name: string
  client_name: string | null
  sold_at: string | null
  lead_time_weeks: number | null
  portal_token_issued_at: string | null
  poc_name: string | null
  poc_email: string | null
  poc_phone: string | null
  delivery_address: string | null
  client_deadline: string | null
}

export interface RawPortalSub {
  id: string
  name: string
  sort_order: number | null
}

export interface RawPortalItem {
  id: string
  subproject_id: string
  label: string
  material: string | null
  finish: string | null
  state: string
  ball_in_court: string | null
  last_state_change_at: string | null
  item_kind: string | null
  link_url: string | null
  created_at: string | null
}

export interface RawPortalItemRevision {
  id: string
  approval_item_id: string
  action: string
  note: string | null
  actor_name: string | null
  occurred_at: string
}

export interface RawPortalDrawing {
  id: string
  subproject_id: string
  revision_number: number
  file_url: string | null
  state: string
  is_latest: boolean
  submitted_at: string | null
  responded_at: string | null
  responded_by_name: string | null
  notes: string | null
}

export interface RawPortalPhoto {
  id: string
  approval_item_id: string
  caption: string | null
  added_by: string | null
  from_client: boolean
  created_at: string
  /** Signed by the loader; the storage path itself never leaves the server. */
  url: string
}

export interface RawPortalQuestion {
  id: string
  body: string
  author_name: string
  created_at: string
  answer: string | null
  answered_at: string | null
  /** Resolved by the loader: the PM's first name when the PM answered, else
   *  null (the view then says the shop's name). Never another teammate. */
  answered_by_label: string | null
}

export interface RawPortalEvent {
  id: string
  event_type: string
  label: string
  created_at: string
}

export interface PortalTeamContact {
  name: string
  title: string | null
  email: string | null
  phone: string | null
  shopAddress: string | null
}

export interface RawPortalInput {
  orgName: string
  team: PortalTeamContact
  project: RawPortalProject
  subs: RawPortalSub[]
  items: RawPortalItem[]
  itemRevisions: RawPortalItemRevision[]
  drawings: RawPortalDrawing[]
  photos: RawPortalPhoto[]
  questions: RawPortalQuestion[]
  events: RawPortalEvent[]
  /** Approval-item ids carrying a DRAFT change order — not one-click
   *  approvable (approving would finalize a price the client hasn't seen). */
  blockedItemIds: string[]
}

// ── The public payload ──────────────────────────────────────────────────────

export type PortalPill = 'approved' | 'waiting' | 'shop'

export interface PortalPhotoView {
  id: string
  url: string
  caption: string | null
}

export interface PortalItemView {
  /** 'item' = an approval callout; 'drawing' = a subproject's drawing track. */
  type: 'item' | 'drawing'
  /** approval_items.id, or the LATEST drawing_revisions.id (null when the
   *  shop hasn't logged a revision yet — nothing to act on). */
  id: string | null
  name: string
  detail: string | null
  pill: PortalPill
  /** Whether Approve / Request a change are offered. */
  canAct: boolean
  /** "Approved by Dave Pajot", "Rev 3 · uploaded", "Changes requested by …" */
  statusText: string | null
  statusAt: string | null
  linkUrl: string | null
  photos: PortalPhotoView[]
  photosNote: { by: string; at: string } | null
  /** Items only — the client may add finish photos to any open callout. */
  canAddPhoto: boolean
  /** Drawings only. */
  viewUrl: string | null
  priorNotes: Array<{ rev: number; by: string; at: string | null; note: string }>
}

export interface PortalGroupView {
  kind: ItemKind
  label: string
  items: PortalItemView[]
}

export interface PortalSubView {
  id: string
  name: string
  approved: number
  total: number
  allApproved: boolean
  groups: PortalGroupView[]
}

export interface PortalQuestionView {
  id: string
  body: string
  authorName: string
  askedAt: string
  answer: string | null
  answeredBy: string | null
  answeredAt: string | null
}

export interface PortalActivityEntry {
  key: string
  at: string
  who: string
  text: string
  /** What kind of change this is — the notify queue filters on it. */
  kind: 'revision' | 'state' | 'photo' | 'question' | 'answer' | 'contact' | 'opened'
  /** True when the CLIENT did it (portal side). */
  fromClient: boolean
}

export interface PreapprovalPortal {
  orgName: string
  updatedAt: string | null
  clientName: string | null
  projectName: string
  team: PortalTeamContact
  you: {
    pocName: string | null
    pocEmail: string | null
    pocPhone: string | null
    jobsite: string | null
    deadline: string | null
  }
  status: {
    approved: number
    total: number
    waitingOnYou: number
    inOurCourt: number
    daysInPrepro: number | null
  }
  leadTime: { weeks: number; completionDate: string } | null
  subs: PortalSubView[]
  questions: PortalQuestionView[]
  activity: PortalActivityEntry[]
}

// ── Small pure pieces ───────────────────────────────────────────────────────

const DAY = 86400000

/** Whole days since the job sold. Null when it never recorded a sold_at
 *  (pre-094 jobs) — the strip shows a dash rather than inventing a number. */
export function daysInPrepro(soldAt: string | null | undefined, now: Date): number | null {
  if (!soldAt) return null
  const then = new Date(soldAt).getTime()
  if (!Number.isFinite(then)) return null
  const d = Math.floor((now.getTime() - then) / DAY)
  return d < 0 ? 0 : d
}

/** Today + lead time, as a calendar date (YYYY-MM-DD, UTC). Null when the
 *  lead time isn't set — the whole callout hides. */
export function leadTimeCompletion(weeks: number | null | undefined, now: Date): string | null {
  const w = Number(weeks)
  if (!weeks || !Number.isFinite(w) || w <= 0) return null
  return new Date(now.getTime() + Math.round(w * 7) * DAY).toISOString().slice(0, 10)
}

/** 8 → "8", 8.5 → "8.5" — numeric columns come back as 8.0. */
export function weeksLabel(weeks: number): string {
  return String(Math.round(weeks * 10) / 10)
}

/** What the client is looking at for one callout. */
export function itemPill(
  item: Pick<RawPortalItem, 'state' | 'ball_in_court'>,
  blocked: boolean,
): PortalPill {
  if (item.state === 'approved') return 'approved'
  if (!blocked && item.ball_in_court === 'client') return 'waiting'
  return 'shop'
}

/** A drawing track: approved, with the client (in_review), or with the shop. */
export function drawingPill(latest: Pick<RawPortalDrawing, 'state'> | null | undefined): PortalPill {
  if (!latest) return 'shop'
  if (latest.state === 'approved') return 'approved'
  if (latest.state === 'in_review') return 'waiting'
  return 'shop'
}

/** A typed name as it's stored: trimmed, whitespace collapsed, capped. */
export function cleanPortalName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

/** Free text from the client: trimmed, capped, newlines kept. */
export function cleanPortalText(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max)
}

/** A name needs two real characters — "x" isn't a signature. */
export function isUsablePortalName(name: string): boolean {
  return name.replace(/[^\p{L}\p{N}]/gu, '').length >= 2
}

// ── Client-editable contact fields ──────────────────────────────────────────
// ⛔ THE ALLOWLIST FOR THE ONE GENERIC PORTAL WRITE. The contact route updates
// `projects` with whatever keys survive this map — so it is these five handoff
// columns and nothing else, ever. site_access_notes is deliberately absent
// (gate codes are not the client's to read back or rewrite from a link).

export const PORTAL_CONTACT_FIELDS = {
  poc_name: { label: 'contact name', max: 80 },
  poc_email: { label: 'contact email', max: 120 },
  poc_phone: { label: 'contact phone', max: 40 },
  delivery_address: { label: 'jobsite address', max: 200 },
  client_deadline: { label: 'jobsite deadline', max: 120 },
} as const

export type PortalContactField = keyof typeof PORTAL_CONTACT_FIELDS

/**
 * Which fields a submitted contact form actually changes.
 *
 * ⛔ BLANK NEVER CLEARS. These same columns gate production (lib/handoff) — a
 * client wiping the jobsite address from a public link must not be able to
 * re-block a job. An empty box means "leave it as it is".
 */
export function contactChanges(
  current: Partial<Record<PortalContactField, string | null>>,
  submitted: unknown,
): Array<{ field: PortalContactField; value: string }> {
  const out: Array<{ field: PortalContactField; value: string }> = []
  if (!submitted || typeof submitted !== 'object') return out
  for (const field of Object.keys(PORTAL_CONTACT_FIELDS) as PortalContactField[]) {
    const raw = (submitted as Record<string, unknown>)[field]
    if (typeof raw !== 'string') continue
    const value = raw.trim().replace(/\s+/g, ' ').slice(0, PORTAL_CONTACT_FIELDS[field].max)
    if (!value) continue
    if (value === (current[field] || '').trim()) continue
    out.push({ field, value })
  }
  return out
}

/** Event types the portal's Activity may read out of `project_events`. That
 *  table also holds stage changes, margin edits and CO history — everything
 *  outside this list stays in. */
export const PORTAL_EVENT_TYPES = ['portal_contact_edit', 'portal_opened'] as const

// ── Activity (derived — there is no events table for this) ──────────────────

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/**
 * Everything that happened, newest first, from the rows that already exist:
 * item_revisions + drawing_revisions + photos + questions/answers + the
 * contact-edit project_events.
 */
export function buildActivity(input: RawPortalInput): PortalActivityEntry[] {
  const out: PortalActivityEntry[] = []
  const shop = input.orgName
  const client = input.project.poc_name?.trim() || input.project.client_name?.trim() || 'Client'
  const subName = new Map(input.subs.map((s) => [s.id, s.name]))
  const itemById = new Map(input.items.map((i) => [i.id, i]))

  for (const r of input.itemRevisions) {
    const item = itemById.get(r.approval_item_id)
    if (!item) continue // dismissed, or another project's — never guess a label
    // The mirrored row a linked slot gets — one approval, one line.
    if ((r.note || '').startsWith('(auto) linked')) continue
    const who = r.actor_name?.trim() || shop
    const fromClient = !!r.actor_name?.trim()
    let text: string | null = null
    if (r.action === 'approved') text = fromClient ? `approved ${item.label}` : `recorded approval of ${item.label}`
    else if (r.action === 'client_requested_change')
      text = fromClient ? `requested a change on ${item.label}` : `logged a change request on ${item.label}`
    else if (r.action === 'submitted') text = `submitted ${item.label} for approval`
    else if (r.action === 'material_changed') text = `updated ${item.label}`
    if (!text) continue
    out.push({ key: `ir-${r.id}`, at: r.occurred_at, who, text, kind: 'state', fromClient })
  }

  for (const d of input.drawings) {
    const sub = subName.get(d.subproject_id)
    if (!sub) continue
    if (d.submitted_at) {
      out.push({
        key: `dr-up-${d.id}`,
        at: d.submitted_at,
        who: shop,
        text: `submitted Rev ${d.revision_number} of the ${sub} drawings`,
        kind: 'revision',
        fromClient: false,
      })
    }
    if (d.responded_at && (d.state === 'approved' || d.state === 'pending')) {
      const who = d.responded_by_name?.trim() || shop
      const fromClient = !!d.responded_by_name?.trim()
      // A shop-recorded approval of a rev logged in the same instant ("accepted
      // with no revision logged") is one event, not two.
      if (!fromClient && d.state === 'approved' && d.responded_at === d.submitted_at) continue
      // The shop pulling its own revision back is shop housekeeping, not news.
      if (!fromClient && d.state === 'pending') continue
      out.push({
        key: `dr-re-${d.id}`,
        at: d.responded_at,
        who,
        text:
          d.state === 'approved'
            ? `${fromClient ? 'approved' : 'recorded approval of'} ${sub} drawings Rev ${d.revision_number}`
            : `requested a change on ${sub} drawings Rev ${d.revision_number}`,
        kind: 'state',
        fromClient,
      })
    }
  }

  // Photos batch: one line per (item, uploader, 10-minute window).
  const batches = new Map<string, { at: string; n: number; who: string; label: string; fromClient: boolean; id: string }>()
  for (const p of [...input.photos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const item = itemById.get(p.approval_item_id)
    if (!item) continue
    const who = p.from_client ? p.added_by?.trim() || client : shop
    const bucket = Math.floor(new Date(p.created_at).getTime() / (10 * 60000))
    const k = `${p.approval_item_id}|${who}|${bucket}`
    const b = batches.get(k)
    if (b) {
      b.n += 1
      b.at = p.created_at
    } else batches.set(k, { at: p.created_at, n: 1, who, label: item.label, fromClient: p.from_client, id: p.id })
  }
  for (const b of batches.values()) {
    out.push({
      key: `ph-${b.id}`,
      at: b.at,
      who: b.who,
      text: `added ${b.n === 1 ? 'a photo' : `${b.n} photos`} to ${b.label}`,
      kind: 'photo',
      fromClient: b.fromClient,
    })
  }

  for (const q of input.questions) {
    out.push({
      key: `q-${q.id}`,
      at: q.created_at,
      who: q.author_name,
      text: 'asked a question',
      kind: 'question',
      fromClient: true,
    })
    if (q.answer && q.answered_at) {
      out.push({
        key: `qa-${q.id}`,
        at: q.answered_at,
        who: q.answered_by_label || shop,
        text: `answered ${firstName(q.author_name)}’s question`,
        kind: 'answer',
        fromClient: false,
      })
    }
  }

  for (const e of input.events) {
    if (!(PORTAL_EVENT_TYPES as readonly string[]).includes(e.event_type)) continue
    if (e.event_type === 'portal_contact_edit') {
      // The label is written by the contact route as "<who> updated the <field>".
      const m = /^(.*?) (updated the .*)$/.exec(e.label)
      out.push({
        key: `ev-${e.id}`,
        at: e.created_at,
        who: m ? m[1] : client,
        text: m ? m[2] : 'updated their info',
        kind: 'contact',
        fromClient: true,
      })
    }
  }

  if (input.project.portal_token_issued_at) {
    out.push({
      key: 'opened',
      at: input.project.portal_token_issued_at,
      who: shop,
      text: 'opened this portal',
      kind: 'opened',
      fromClient: false,
    })
  }

  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

// ── The view ────────────────────────────────────────────────────────────────

function buildItemView(
  item: RawPortalItem,
  input: RawPortalInput,
  revsByItem: Map<string, RawPortalItemRevision[]>,
  photosByItem: Map<string, RawPortalPhoto[]>,
): PortalItemView {
  const blocked = input.blockedItemIds.includes(item.id)
  const pill = itemPill(item, blocked)
  const revs = revsByItem.get(item.id) || []
  const last = revs[revs.length - 1]

  let statusText: string | null = null
  let statusAt: string | null = item.last_state_change_at
  if (pill === 'approved') {
    const ap = [...revs].reverse().find((r) => r.action === 'approved')
    statusText = ap?.actor_name?.trim() ? `Approved by ${ap.actor_name.trim()}` : `Approved · recorded by ${input.orgName}`
    statusAt = ap?.occurred_at || item.last_state_change_at
  } else if (last?.action === 'client_requested_change') {
    // Only a note the CLIENT typed is ever echoed back.
    const by = last.actor_name?.trim()
    statusText = by
      ? `Changes requested by ${by}${last.note?.trim() ? ` — “${last.note.trim()}”` : ''}`
      : 'Changes requested — we’re on it'
    statusAt = last.occurred_at
  } else if (last?.action === 'submitted') {
    statusText = 'Submitted for your approval'
    statusAt = last.occurred_at
  } else if (pill === 'shop') {
    statusText = blocked ? 'A change order is being prepared for this' : 'We’re working on this'
    statusAt = null
  } else {
    statusText = 'Ready for your approval'
    statusAt = null
  }

  const photos = photosByItem.get(item.id) || []
  const lastPhoto = photos[photos.length - 1]
  return {
    type: 'item',
    id: item.id,
    name: item.label,
    detail: [item.material, item.finish].map((s) => (s || '').trim()).filter(Boolean).join(' · ') || null,
    pill,
    canAct: pill === 'waiting',
    statusText,
    statusAt,
    linkUrl: safeHttpUrl(item.link_url),
    photos: photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption })),
    photosNote: lastPhoto
      ? { by: lastPhoto.from_client ? lastPhoto.added_by?.trim() || 'you' : input.orgName, at: lastPhoto.created_at }
      : null,
    canAddPhoto: pill !== 'approved',
    viewUrl: null,
    priorNotes: [],
  }
}

function buildDrawingView(sub: RawPortalSub, revs: RawPortalDrawing[], orgName: string): PortalItemView {
  const sorted = [...revs].sort((a, b) => b.revision_number - a.revision_number)
  const latest = sorted.find((r) => r.is_latest) || null
  const pill = drawingPill(latest)

  let statusText: string
  let statusAt: string | null = null
  if (!latest) {
    statusText = 'Rev 1 in progress'
  } else if (pill === 'approved') {
    statusText = latest.responded_by_name?.trim()
      ? `Rev ${latest.revision_number} · approved by ${latest.responded_by_name.trim()}`
      : `Rev ${latest.revision_number} · approved · recorded by ${orgName}`
    statusAt = latest.responded_at
  } else if (pill === 'waiting') {
    statusText = `Rev ${latest.revision_number} · submitted`
    statusAt = latest.submitted_at
  } else {
    statusText = `Rev ${latest.revision_number + (latest.responded_at ? 1 : 0)} in progress`
  }

  // Change requests the client typed against any revision (including the
  // latest, once it's back with the shop). Shop notes never qualify.
  const priorNotes = sorted
    .filter((r) => r.state !== 'approved' && r.responded_by_name?.trim() && r.notes?.trim())
    .map((r) => ({
      rev: r.revision_number,
      by: r.responded_by_name!.trim(),
      at: r.responded_at,
      note: r.notes!.trim(),
    }))

  return {
    type: 'drawing',
    id: latest?.id ?? null,
    name: `Shop drawings — ${sub.name}`,
    detail: null,
    pill,
    canAct: pill === 'waiting' && !!latest,
    statusText,
    statusAt,
    linkUrl: null,
    photos: [],
    photosNote: null,
    canAddPhoto: false,
    viewUrl: latest && pill !== 'shop' ? safeHttpUrl(latest.file_url) : null,
    priorNotes,
  }
}

/**
 * Raw rows → the public payload. Copies BY NAME; see the header.
 */
export function buildPortalView(input: RawPortalInput, now: Date = new Date()): PreapprovalPortal {
  const p = input.project
  const subs = [...input.subs].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const revsByItem = new Map<string, RawPortalItemRevision[]>()
  for (const r of [...input.itemRevisions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    const list = revsByItem.get(r.approval_item_id) || []
    list.push(r)
    revsByItem.set(r.approval_item_id, list)
  }
  const photosByItem = new Map<string, RawPortalPhoto[]>()
  for (const ph of [...input.photos].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = photosByItem.get(ph.approval_item_id) || []
    list.push(ph)
    photosByItem.set(ph.approval_item_id, list)
  }

  const subViews: PortalSubView[] = subs.map((sub) => {
    const items = input.items
      .filter((i) => i.subproject_id === sub.id)
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    const drawing = buildDrawingView(
      sub,
      input.drawings.filter((d) => d.subproject_id === sub.id),
      input.orgName,
    )
    const groups: PortalGroupView[] = ITEM_KINDS.map((kind) => {
      const views = items
        .filter((i) => normalizeItemKind(i.item_kind) === kind)
        .map((i) => buildItemView(i, input, revsByItem, photosByItem))
      // The drawing track leads the Drawings group; drawing-kind callouts follow.
      if (kind === 'drawing') views.unshift(drawing)
      return { kind, label: KIND_GROUP_LABEL[kind], items: views }
    }).filter((g) => g.items.length > 0)
    const all = groups.flatMap((g) => g.items)
    const approved = all.filter((v) => v.pill === 'approved').length
    return {
      id: sub.id,
      name: sub.name,
      approved,
      total: all.length,
      allApproved: all.length > 0 && approved === all.length,
      groups,
    }
  })

  const everything = subViews.flatMap((s) => s.groups.flatMap((g) => g.items))
  const activity = buildActivity(input)
  const completion = leadTimeCompletion(p.lead_time_weeks, now)

  return {
    orgName: input.orgName,
    updatedAt: activity[0]?.at ?? null,
    clientName: p.client_name?.trim() || null,
    projectName: p.name,
    team: {
      name: input.team.name,
      title: input.team.title,
      email: input.team.email,
      phone: input.team.phone,
      shopAddress: input.team.shopAddress,
    },
    you: {
      pocName: p.poc_name?.trim() || null,
      pocEmail: p.poc_email?.trim() || null,
      pocPhone: p.poc_phone?.trim() || null,
      jobsite: p.delivery_address?.trim() || null,
      deadline: p.client_deadline?.trim() || null,
    },
    status: {
      approved: everything.filter((v) => v.pill === 'approved').length,
      total: everything.length,
      waitingOnYou: everything.filter((v) => v.pill === 'waiting').length,
      inOurCourt: everything.filter((v) => v.pill === 'shop').length,
      daysInPrepro: daysInPrepro(p.sold_at, now),
    },
    leadTime: completion ? { weeks: Number(p.lead_time_weeks), completionDate: completion } : null,
    subs: subViews,
    questions: [...input.questions]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((q) => ({
        id: q.id,
        body: q.body,
        authorName: q.author_name,
        askedAt: q.created_at,
        answer: q.answer?.trim() || null,
        answeredBy: q.answer ? q.answered_by_label || input.orgName : null,
        answeredAt: q.answer ? q.answered_at : null,
      })),
    activity,
  }
}

// ── Notify-first queue (NO auto-send; a human clicks) ───────────────────────

/** Everything since the last "updates sent" stamp. With no stamp yet, the
 *  queue starts when the link was created — history before the client could
 *  see the portal isn't news to send them. */
export function notifyQueue(
  activity: PortalActivityEntry[],
  lastNotifiedAt: string | null | undefined,
  linkIssuedAt: string | null | undefined,
): PortalActivityEntry[] {
  const since = lastNotifiedAt || linkIssuedAt
  if (!since) return []
  const t = new Date(since).getTime()
  return activity.filter((a) => a.kind !== 'opened' && new Date(a.at).getTime() > t)
}

function stampForEmail(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

/** The prefilled email. Subject + body only — the caller owns the address. */
export function buildNotifyEmail(input: {
  orgName: string
  projectName: string
  pocName: string | null
  portalUrl: string
  queue: PortalActivityEntry[]
  waitingOnYou: number
  timeZone?: string
}): { subject: string; body: string } {
  const tz = input.timeZone || 'America/New_York'
  const hi = input.pocName?.trim() ? `Hi ${firstName(input.pocName)},` : 'Hi,'
  const lines = [...input.queue]
    .reverse()
    .map((a) => `• ${stampForEmail(a.at, tz)} — ${a.who} ${a.text}`)
  const waiting =
    input.waitingOnYou > 0
      ? `${input.waitingOnYou} item${input.waitingOnYou === 1 ? ' is' : 's are'} waiting on your approval.`
      : 'Nothing is waiting on you right now.'
  const body = [
    hi,
    '',
    `Here’s what’s new on ${input.projectName}:`,
    '',
    ...(lines.length ? lines : ['• (no changes since the last update)']),
    '',
    waiting,
    '',
    `Review and approve here: ${input.portalUrl}`,
    '',
    `— ${input.orgName}`,
  ].join('\n')
  return { subject: `${input.projectName} — approval portal update`, body }
}

export function mailtoHref(to: string | null | undefined, email: { subject: string; body: string }): string {
  return `mailto:${encodeURIComponent((to || '').trim())}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
}

// ============================================================================
// lib/client-portal.ts — the public-safe read model for the client portal
// ============================================================================
// ⛔ SERVER ONLY. Every function here runs on the SERVICE ROLE and is reachable
// from an UNAUTHENTICATED request that carries nothing but a token. Import it
// from route handlers under app/api/portal/** only — never from a component,
// never from anything that ships to the browser.
//
// ⛔ THE ALLOWLIST IS THE SECURITY BOUNDARY. Every select in this file names
// its columns explicitly. There is no `select('*')` anywhere and there must
// never be one: the tables involved carry costs, margins, hours, shop rate,
// internal notes and other clients' data, and `*` would hand all of it to a
// stranger with a link. When you add a field to a portal type, add the column
// to the matching select by hand and ask whether a client should see it.
//
// The things that must never leave this file, on any path:
//   • cost / margin / labor-hour / shop-rate anything
//   • rate book, materials pricing, product internals
//   • internal_notes, or any other-client or other-project row
//   • org data beyond public branding + contact details
//
// Access is per CLIENT (Andrew, 2026-08-31): one unguessable token lists every
// project that client has with the shop. Every project read is re-scoped to the
// token's client_id — the projectId in the URL is never trusted on its own.
// ============================================================================

import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'

// ── Phases ──────────────────────────────────────────────────────────────────
// The seven client-facing phases from the design pass. These are NOT the
// stored `projects.stage` enum — that has eight values, several of which are
// pipeline states a client should never be shown ('lost' above all). This is
// the translation layer between the two.

export const PORTAL_PHASES = [
  { key: 'estimate', label: 'Estimate', blurb: 'Your estimate is with you for review.' },
  { key: 'deposit', label: 'Deposit', blurb: 'We start scheduling as soon as the deposit lands.' },
  { key: 'drawings', label: 'Drawings', blurb: 'Shop drawings and selections are being worked out with you.' },
  { key: 'production', label: 'In production', blurb: 'Your cabinets are being cut and assembled on the shop floor.' },
  { key: 'finishing', label: 'Finishing', blurb: 'Everything is built. Finish is going on now.' },
  { key: 'installation', label: 'Installation', blurb: 'Installed. We are working through the punch list.' },
  { key: 'walkthrough', label: 'Walkthrough', blurb: 'Final walkthrough. Thank you for building with us.' },
] as const

export type PortalPhaseKey = (typeof PORTAL_PHASES)[number]['key']
export const PORTAL_PHASE_COUNT = PORTAL_PHASES.length

/** Stages a client may see at all. 'lost' and the early pipeline stages are
 *  deliberately absent — a client should never learn we marked them lost, and
 *  an unsent estimate isn't theirs to see yet. */
const CLIENT_VISIBLE_STAGES = new Set(['sold', 'production', 'installed', 'complete'])

// ── Public types ────────────────────────────────────────────────────────────

export interface PortalOrg {
  name: string
  logo_url: string | null
  phone: string | null
  email: string | null
}

export interface PortalPhaseState {
  key: PortalPhaseKey
  label: string
  /** 1-based, so it reads as "PHASE 04 / 07" without arithmetic in the view. */
  index: number
  state: 'done' | 'current' | 'upcoming'
}

export interface PortalProjectCard {
  id: string
  name: string
  phaseIndex: number
  phaseLabel: string
  phaseTotal: number
  /** Approvals waiting on the client + change orders sent but unsigned. */
  needsYouCount: number
  statusLine: string
  paymentLine: string | null
}

export interface PortalHome {
  org: PortalOrg
  clientName: string
  projects: PortalProjectCard[]
}

export interface PortalPhotoItem {
  id: string
  url: string
  caption: string | null
  takenOn: string
}

export interface PortalApprovalItem {
  id: string
  label: string
  /** Free-text detail the shop already shows internally (material / finish). */
  detail: string | null
  /** 'you' = we're waiting on the client, 'shop' = we're working on it. */
  waitingOn: 'you' | 'shop' | 'vendor' | null
  approved: boolean
  /** The date that matters for this row — approved-on, or last state change. */
  stampedAt: string | null
}

export interface PortalChangeOrder {
  id: string
  number: string
  title: string
  description: string | null
  lines: { label: string; amount: number }[]
  netChange: number
  newContractTotal: number | null
  sentAt: string | null
  signedName: string | null
  signedAt: string | null
  /** True when it's sitting with the client, unsigned — the one signable state. */
  awaitingSignature: boolean
}

export interface PortalDocument {
  kind: string
  label: string
  sublabel: string | null
  url: string
}

export interface PortalPaymentRow {
  label: string
  sublabel: string | null
  amount: number
  paid: boolean
  due: boolean
}

export interface PortalPayments {
  total: number
  paid: number
  rows: PortalPaymentRow[]
}

export interface PortalProject {
  org: PortalOrg
  clientName: string
  id: string
  name: string
  /** The client's own site/residence label, when the shop recorded one. */
  siteLabel: string | null
  phases: PortalPhaseState[]
  phaseIndex: number
  phaseLabel: string
  phaseBlurb: string
  phaseTotal: number
  startedOn: string | null
  installTarget: string | null
  lastEvent: { label: string; value: string } | null
  photos: PortalPhotoItem[]
  approvals: PortalApprovalItem[]
  changeOrders: PortalChangeOrder[]
  documents: PortalDocument[]
  payments: PortalPayments
  contractTotal: number
}

// ── Token ───────────────────────────────────────────────────────────────────

export interface PortalIdentity {
  clientId: string
  orgId: string
  clientName: string
}

/** 32 URL-safe characters from 24 random bytes. Long enough that guessing is
 *  not a threat model; short enough to survive being pasted into a text. */
export function mintPortalToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Token → client. The single gate every portal read and write goes through.
 *  Returns null for anything unrecognised, with no distinction between
 *  "no such token" and "malformed" — the caller must 404 either way. */
export async function resolvePortalToken(token: string): Promise<PortalIdentity | null> {
  const clean = (token || '').trim()
  // Tokens are base64url. Reject anything else before it reaches the database
  // so a hostile string can't ride into a query.
  if (!clean || clean.length < 16 || clean.length > 128 || !/^[A-Za-z0-9_-]+$/.test(clean)) {
    return null
  }
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id, org_id, name')
    .eq('portal_token', clean)
    .maybeSingle()
  const row = data as { id: string; org_id: string; name: string } | null
  if (!row?.id || !row.org_id) return null
  return { clientId: row.id, orgId: row.org_id, clientName: row.name || 'there' }
}

/** Just the shop's name, for the browser tab. The portal is the client's view
 *  of THEIR cabinet shop, so the tab must not read "MillSuite — Project Profit
 *  Tracker" (the root layout's title): the client has no idea what MillSuite is,
 *  and "profit tracker" is the last phrase to put in front of them. Two small
 *  indexed reads, run from generateMetadata. */
export async function loadPortalOrgName(token: string): Promise<string | null> {
  const id = await resolvePortalToken(token)
  if (!id) return null
  return (await loadOrg(id.orgId)).name
}

/** The gate every portal WRITE goes through. Resolves the token AND proves the
 *  project it names belongs to that token's client, in one call, so a route
 *  handler can't accidentally check one and forget the other. Returns null on
 *  any failure — callers must 404 rather than distinguish the cases. */
export async function authorizePortalProject(
  token: string,
  projectId: string,
): Promise<{ identity: PortalIdentity; projectId: string } | null> {
  const identity = await resolvePortalToken(token)
  if (!identity) return null
  if (!projectId || typeof projectId !== 'string') return null
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('client_id', identity.clientId)
    .eq('org_id', identity.orgId)
    .is('practice_at', null)
    .in('stage', Array.from(CLIENT_VISIBLE_STAGES))
    .maybeSingle()
  if (!(data as { id: string } | null)?.id) return null
  return { identity, projectId }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Aug 28" / "Aug 28, 2025" — the portal's only date format. Parses the
 *  date-only strings Postgres hands back as calendar dates, NOT as UTC
 *  midnight, so an install target never slips a day for a client west of UTC. */
export function portalDate(value: string | null | undefined, withYear = false): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const [, y, mo, d] = m
  const label = `${MONTH[Number(mo) - 1]} ${Number(d)}`
  const nowYear = new Date().getUTCFullYear()
  return withYear || Number(y) !== nowYear ? `${label}, ${y}` : label
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

async function loadOrg(orgId: string): Promise<PortalOrg> {
  // Branding + how to reach a human. Nothing else from `orgs` — that row also
  // carries plan, Stripe ids, shop rate settings and margin targets.
  const { data } = await supabaseAdmin
    .from('orgs')
    .select('name, logo_url, business_phone, business_email')
    .eq('id', orgId)
    .maybeSingle()
  const o = (data || {}) as Record<string, string | null>
  return {
    name: o.name || 'Your shop',
    logo_url: o.logo_url ?? null,
    phone: o.business_phone ?? null,
    email: o.business_email ?? null,
  }
}

interface RawProject {
  id: string
  name: string
  stage: string
  bid_total: number | null
  finishing_at: string | null
  estimate_pdf_url: string | null
  estimate_number: string | null
  estimate_sent_at: string | null
  deposit_override: boolean | null
  delivery_address: string | null
}

const PROJECT_COLUMNS =
  'id, name, stage, bid_total, finishing_at, estimate_pdf_url, estimate_number, estimate_sent_at, deposit_override, delivery_address'

/** Projects the token's client is allowed to see. Scoped by BOTH client_id and
 *  org_id — client_id alone would be enough today, but the org check means a
 *  future cross-org client row can't widen the blast radius. */
async function loadVisibleProjects(id: PortalIdentity): Promise<RawProject[]> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('client_id', id.clientId)
    .eq('org_id', id.orgId)
    .is('practice_at', null)
    .in('stage', Array.from(CLIENT_VISIBLE_STAGES))
    .order('created_at', { ascending: false })
  return ((data as RawProject[] | null) || []).filter((p) => p?.id)
}

// ── Phase derivation ────────────────────────────────────────────────────────

interface PhaseSignals {
  stage: string
  depositReceived: boolean
  drawingsApproved: boolean
  finishing: boolean
}

/** Which phases are complete, in order. The current phase is the FIRST one
 *  that isn't — so a project whose drawings are done but whose deposit hasn't
 *  landed reads as sitting on Deposit, which is exactly where it is. */
function phaseDone(s: PhaseSignals): boolean[] {
  const installed = s.stage === 'installed' || s.stage === 'complete'
  const complete = s.stage === 'complete'
  return [
    CLIENT_VISIBLE_STAGES.has(s.stage), // estimate — accepted, so we're building
    s.depositReceived,
    s.drawingsApproved,
    s.finishing || installed, // production
    installed, // finishing
    complete, // installation
    complete, // walkthrough (terminal: current when the project is complete)
  ]
}

function phaseStates(s: PhaseSignals): { phases: PortalPhaseState[]; index: number } {
  const done = phaseDone(s)
  const firstOpen = done.findIndex((d) => !d)
  // Every phase done → the project is complete, so sit on the last one.
  const index = firstOpen === -1 ? PORTAL_PHASE_COUNT : firstOpen + 1
  const phases = PORTAL_PHASES.map((p, i) => ({
    key: p.key,
    label: p.label,
    index: i + 1,
    state: (i + 1 < index ? 'done' : i + 1 === index ? 'current' : 'upcoming') as PortalPhaseState['state'],
  }))
  return { phases, index }
}

// ── Per-project signal gathering ────────────────────────────────────────────

interface ProjectSignals {
  subprojectIds: string[]
  depositReceived: boolean
  drawingsApproved: boolean
  contractInvoice: { id: string; total: number; amount_received: number } | null
}

async function loadSignals(p: RawProject): Promise<ProjectSignals> {
  const { data: subs } = await supabaseAdmin
    .from('subprojects')
    .select('id')
    .eq('project_id', p.id)
  const subprojectIds = ((subs as { id: string }[] | null) || []).map((s) => s.id)

  // The contract invoice: the project's non-void invoice that isn't a change
  // order's rolling invoice. Same rule as lib/invoices.findContractInvoice,
  // re-implemented here on the service role with a narrowed select.
  const [invRes, coInvRes] = await Promise.all([
    supabaseAdmin
      .from('client_invoices')
      .select('id, total, amount_received, status')
      .eq('project_id', p.id)
      .neq('status', 'void')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('change_orders')
      .select('co_invoice_id')
      .eq('project_id', p.id)
      .not('co_invoice_id', 'is', null),
  ])
  const coIds = new Set(
    (((coInvRes.data as { co_invoice_id: string | null }[] | null) || []).map((c) => c.co_invoice_id) || []).filter(
      Boolean,
    ),
  )
  const invoices = ((invRes.data as { id: string; total: number | null; amount_received: number | null }[] | null) || [])
  const contract = invoices.find((i) => !coIds.has(i.id)) ?? null

  // Drawings: every subproject must have an approved latest revision. The
  // existing readiness view already answers this per subproject.
  let drawingsApproved = false
  if (subprojectIds.length > 0) {
    const { data: status } = await supabaseAdmin
      .from('subproject_approval_status')
      .select('subproject_id, latest_drawing_revisions, latest_drawings_approved')
      .in('subproject_id', subprojectIds)
    const rows =
      (status as { subproject_id: string; latest_drawing_revisions: number; latest_drawings_approved: number }[] | null) ||
      []
    drawingsApproved =
      rows.length === subprojectIds.length &&
      rows.every((r) => Number(r.latest_drawing_revisions) > 0 && Number(r.latest_drawings_approved) === Number(r.latest_drawing_revisions))
  }

  const received = Number(contract?.amount_received) || 0
  return {
    subprojectIds,
    depositReceived: received > 0 || !!p.deposit_override,
    drawingsApproved,
    contractInvoice: contract
      ? { id: contract.id, total: Number(contract.total) || 0, amount_received: received }
      : null,
  }
}

/** Approvals sitting with the client + change orders sent but unsigned. This is
 *  the "1 ITEM FOR YOUR REVIEW" badge, so it must count only things the client
 *  can actually act on in the portal. */
async function countNeedsYou(subprojectIds: string[], projectId: string): Promise<number> {
  const [appr, cos] = await Promise.all([
    subprojectIds.length
      ? supabaseAdmin
          .from('approval_items')
          .select('id')
          .in('subproject_id', subprojectIds)
          .eq('ball_in_court', 'client')
          .neq('state', 'approved')
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from('change_orders').select('id').eq('project_id', projectId).eq('state', 'sent_to_client'),
  ])
  return (((appr as { data: unknown[] }).data || []).length) + (((cos as { data: unknown[] }).data || []).length)
}

// ── Client home ─────────────────────────────────────────────────────────────

export async function loadPortalHome(token: string): Promise<PortalHome | null> {
  const id = await resolvePortalToken(token)
  if (!id) return null

  const [org, projects] = await Promise.all([loadOrg(id.orgId), loadVisibleProjects(id)])

  const cards = await Promise.all(
    projects.map(async (p): Promise<PortalProjectCard> => {
      const sig = await loadSignals(p)
      const { index } = phaseStates({
        stage: p.stage,
        depositReceived: sig.depositReceived,
        drawingsApproved: sig.drawingsApproved,
        finishing: !!p.finishing_at,
      })
      const needsYouCount = await countNeedsYou(sig.subprojectIds, p.id)
      const phase = PORTAL_PHASES[index - 1]

      const total = sig.contractInvoice?.total || Number(p.bid_total) || 0
      const paid = sig.contractInvoice?.amount_received || 0
      const paymentLine = total > 0 ? `${money(paid)} paid of ${money(total)}` : null

      return {
        id: p.id,
        name: p.name,
        phaseIndex: index,
        phaseLabel: phase.label,
        phaseTotal: PORTAL_PHASE_COUNT,
        needsYouCount,
        statusLine: phase.blurb,
        paymentLine,
      }
    }),
  )

  return { org, clientName: id.clientName, projects: cards }
}

// ── Project detail ──────────────────────────────────────────────────────────

export async function loadPortalProject(token: string, projectId: string): Promise<PortalProject | null> {
  const id = await resolvePortalToken(token)
  if (!id) return null

  // Re-scope by client + org rather than trusting the id in the URL. A valid
  // token for client A asking for client B's project must 404, not leak.
  const projects = await loadVisibleProjects(id)
  const p = projects.find((row) => row.id === projectId)
  if (!p) return null

  const [org, sig] = await Promise.all([loadOrg(id.orgId), loadSignals(p)])

  const { phases, index } = phaseStates({
    stage: p.stage,
    depositReceived: sig.depositReceived,
    drawingsApproved: sig.drawingsApproved,
    finishing: !!p.finishing_at,
  })
  const phase = PORTAL_PHASES[index - 1]

  const [photos, approvals, changeOrders, documents, payments, schedule] = await Promise.all([
    loadPhotos(p.id),
    loadApprovals(sig.subprojectIds),
    loadChangeOrders(p.id),
    loadDocuments(p, sig.subprojectIds),
    loadPayments(p, sig),
    loadScheduleDates(sig.subprojectIds),
  ])

  const contractTotal = sig.contractInvoice?.total || Number(p.bid_total) || 0

  // "LAST · …" — the most recent thing that actually happened, from the rows we
  // already have in hand. No extra query, and nothing invented: if there's no
  // approved anything yet, the row simply doesn't render.
  const lastApproved = approvals.filter((a) => a.approved && a.stampedAt).sort((a, b) => (a.stampedAt! < b.stampedAt! ? 1 : -1))[0]
  const lastEvent = lastApproved
    ? { label: lastApproved.label, value: `Approved ${portalDate(lastApproved.stampedAt) ?? ''}`.trim() }
    : null

  return {
    org,
    clientName: id.clientName,
    id: p.id,
    name: p.name,
    siteLabel: p.delivery_address || null,
    phases,
    phaseIndex: index,
    phaseLabel: phase.label,
    phaseBlurb: phase.blurb,
    phaseTotal: PORTAL_PHASE_COUNT,
    startedOn: schedule.startedOn,
    installTarget: schedule.installTarget,
    lastEvent,
    photos,
    approvals,
    changeOrders,
    documents,
    payments,
    contractTotal,
  }
}

// ── Section loaders ─────────────────────────────────────────────────────────

async function loadPhotos(projectId: string): Promise<PortalPhotoItem[]> {
  const { data } = await supabaseAdmin
    .from('project_photos')
    .select('id, storage_path, caption, taken_on')
    .eq('project_id', projectId)
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(24)
  const rows = (data as { id: string; storage_path: string; caption: string | null; taken_on: string }[] | null) || []
  return rows.map((r) => ({
    id: r.id,
    url: supabaseAdmin.storage.from('shop-photos').getPublicUrl(r.storage_path).data.publicUrl,
    caption: r.caption,
    takenOn: r.taken_on,
  }))
}

async function loadApprovals(subprojectIds: string[]): Promise<PortalApprovalItem[]> {
  if (subprojectIds.length === 0) return []
  // `material` and `finish` are the denormalized display strings the shop
  // already shows on the approvals board. The cost columns on this table
  // (custom_material_cost_per_lf, custom_labor_hours_*) are deliberately not
  // selected — they are exactly the numbers a client must never see.
  const { data } = await supabaseAdmin
    .from('approval_items')
    .select('id, label, material, finish, state, ball_in_court, last_state_change_at')
    .in('subproject_id', subprojectIds)
    .order('last_state_change_at', { ascending: false })
  const rows =
    (data as {
      id: string
      label: string
      material: string | null
      finish: string | null
      state: string
      ball_in_court: string | null
      last_state_change_at: string | null
    }[] | null) || []

  // ⛔ Items with a DRAFT change order hanging off them are not one-click
  // approvable, and this is deliberate. In the app, approving such an item runs
  // finalizeSpecCosOnApproval → applyApprovedCo → recomputeProjectBidTotal:
  // approving the selection silently finalizes a PRICED change and moves the
  // contract total. A client tapping "Approve" on a material name has not seen
  // that price, so the portal refuses the shortcut and shows the item as still
  // with the shop. The shop's move is to send it as a change order, which the
  // client then signs with the number in front of them.
  //
  // The approve ROUTE enforces the same rule server-side — this only keeps the
  // button from appearing.
  const withDraftCo = await draftCoItemIds(rows.map((r) => r.id))

  return rows.map((r) => {
    const detail = [r.material, r.finish].filter(Boolean).join(' · ') || null
    const approved = r.state === 'approved'
    const blocked = withDraftCo.has(r.id)
    return {
      id: r.id,
      label: r.label,
      detail,
      waitingOn: approved
        ? null
        : blocked
          ? 'shop'
          : r.ball_in_court === 'client'
            ? 'you'
            : r.ball_in_court === 'vendor'
              ? 'vendor'
              : 'shop',
      approved,
      stampedAt: r.last_state_change_at,
    }
  })
}

/** Approval items carrying an unsent (draft) change order. Exported so the
 *  approve route enforces exactly the same rule the view renders. */
export async function draftCoItemIds(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('change_orders')
    .select('approval_item_id')
    .in('approval_item_id', itemIds)
    .eq('state', 'draft')
  return new Set(
    (((data as { approval_item_id: string | null }[] | null) || [])
      .map((c) => c.approval_item_id)
      .filter(Boolean) as string[]),
  )
}

async function loadChangeOrders(projectId: string): Promise<PortalChangeOrder[]> {
  // Only states a client is meant to know about. Drafts are the shop thinking
  // out loud; voided and rejected COs are noise.
  const { data } = await supabaseAdmin
    .from('change_orders')
    .select(
      'id, co_number, title, state, client_price, no_price_change, proposed_line, signed_name, signed_at, updated_at',
    )
    .eq('project_id', projectId)
    .in('state', ['sent_to_client', 'approved'])
    .order('co_number', { ascending: true })
  const rows =
    (data as {
      id: string
      co_number: number | null
      title: string
      state: string
      client_price: number | null
      no_price_change: boolean | null
      proposed_line: Record<string, unknown> | null
      signed_name: string | null
      signed_at: string | null
      updated_at: string | null
    }[] | null) || []

  return rows.map((r) => {
    // Custom-mode COs stash their client-facing material lines in
    // proposed_line.notes as JSON (same shape the CO PDF route reads). Only
    // description + the client-facing amount come across; unit costs and
    // vendor flags stay behind.
    let lines: { label: string; amount: number }[] = []
    let description: string | null = null
    const notes = (r.proposed_line as { notes?: unknown } | null)?.notes
    if (typeof notes === 'string') {
      try {
        const parsed = JSON.parse(notes) as { materials?: { desc?: string; qty?: number; unit_cost?: number }[] }
        if (Array.isArray(parsed?.materials)) {
          lines = parsed.materials
            .filter((m) => m?.desc)
            .map((m) => ({ label: String(m.desc), amount: (Number(m.qty) || 0) * (Number(m.unit_cost) || 0) }))
        }
      } catch {
        // Spec-mode CO: notes is prose, not JSON. Show it as the description.
        description = notes
      }
    }
    return {
      id: r.id,
      number: `CO-${String(r.co_number ?? 0).padStart(2, '0')}`,
      title: r.title || 'Change order',
      description,
      lines,
      netChange: r.no_price_change ? 0 : Number(r.client_price) || 0,
      newContractTotal: null, // filled by the caller, which knows the contract total
      sentAt: r.updated_at,
      signedName: r.signed_name,
      signedAt: r.signed_at,
      awaitingSignature: r.state === 'sent_to_client',
    }
  })
}

async function loadDocuments(p: RawProject, subprojectIds: string[]): Promise<PortalDocument[]> {
  const docs: PortalDocument[] = []

  if (p.estimate_pdf_url) {
    docs.push({
      kind: 'PDF',
      label: `Estimate ${p.estimate_number || ''}`.trim(),
      sublabel: p.estimate_sent_at ? `Sent ${portalDate(p.estimate_sent_at)}` : null,
      url: p.estimate_pdf_url,
    })
  }

  if (subprojectIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('drawing_revisions')
      .select('revision_number, file_url, state, responded_at, submitted_at')
      .in('subproject_id', subprojectIds)
      .eq('is_latest', true)
      .not('file_url', 'is', null)
    const rows =
      (data as {
        revision_number: number
        file_url: string
        state: string
        responded_at: string | null
        submitted_at: string | null
      }[] | null) || []
    rows.forEach((r) => {
      docs.push({
        kind: 'DWG',
        label: `Shop drawings · Rev ${r.revision_number}`,
        sublabel:
          r.state === 'approved' && r.responded_at
            ? `Approved ${portalDate(r.responded_at)}`
            : r.submitted_at
              ? `Sent ${portalDate(r.submitted_at)}`
              : null,
        url: r.file_url,
      })
    })
  }

  // Countersigned change orders. Only signed ones — an unsigned CO is a thing
  // to act on, not a document to file, and it appears in its own section.
  const { data: cos } = await supabaseAdmin
    .from('change_orders')
    .select('co_number, title, signed_pdf_url, signed_at, client_price, no_price_change')
    .eq('project_id', p.id)
    .not('signed_pdf_url', 'is', null)
    .order('co_number', { ascending: true })
  ;(
    (cos as {
      co_number: number | null
      title: string
      signed_pdf_url: string
      signed_at: string | null
      client_price: number | null
      no_price_change: boolean | null
    }[] | null) || []
  ).forEach((c) => {
    const delta = c.no_price_change ? 0 : Number(c.client_price) || 0
    docs.push({
      kind: `CO-${String(c.co_number ?? 0).padStart(2, '0')}`,
      label: `Change order · ${c.title}`,
      sublabel: [c.signed_at ? `Signed ${portalDate(c.signed_at)}` : null, delta ? `+${money(delta)}` : null]
        .filter(Boolean)
        .join(' · ') || null,
      url: c.signed_pdf_url,
    })
  })

  // Manual links the shop attached. `kind` here is the table's own free-text
  // column; anything not recognised renders as a generic link.
  const { data: manual } = await supabaseAdmin
    .from('project_documents')
    .select('label, url, kind')
    .eq('project_id', p.id)
    .order('created_at', { ascending: true })
  ;((manual as { label: string; url: string; kind: string | null }[] | null) || []).forEach((d) => {
    docs.push({ kind: 'LINK', label: d.label, sublabel: null, url: d.url })
  })

  return docs
}

async function loadPayments(p: RawProject, sig: ProjectSignals): Promise<PortalPayments> {
  const total = sig.contractInvoice?.total || Number(p.bid_total) || 0

  const rows: PortalPaymentRow[] = []

  // ── The milestone schedule IS the client's payment plan ──────────────────
  // ⛔ Read this before "simplifying" back to invoice payments only.
  //
  // A milestone can be marked received in TWO different ways depending on the
  // org's invoicing mode (lib/milestones.markMilestoneReceived):
  //   • internal mode → flips the milestone AND records a real payment on the
  //     contract invoice, so `client_invoice_payments` has a row.
  //   • QUICKBOOKS mode → flips the milestone and deliberately stops there.
  //     Money is supposed to arrive via the QB watcher, so the invoice's
  //     amount_received legitimately stays 0 until then.
  //
  // Built is a QB org. The first version of this read only invoice payments
  // and additionally FILTERED OUT received milestones, so a project with real
  // money against it rendered as "$0 paid" with the paid rows missing
  // entirely — the one record that existed was the one thing being ignored.
  //
  // So: every milestone renders, and its own status says whether it's paid.
  const { data: ms } = await supabaseAdmin
    .from('cash_flow_receivables')
    .select('milestone_label, amount, status, expected_date, received_date')
    .eq('project_id', p.id)
    .eq('type', 'receivable')
    .order('created_at', { ascending: true })
  const milestones = (
    (ms as
      | {
          milestone_label: string | null
          amount: number | null
          status: string
          expected_date: string | null
          received_date: string | null
        }[]
      | null) || []
  ).filter((m) => m.status !== 'cancelled')

  milestones.forEach((m) => {
    const paid = m.status === 'received'
    rows.push({
      label: m.milestone_label || 'Milestone',
      sublabel: paid
        ? `Paid${portalDate(m.received_date) ? ` ${portalDate(m.received_date)}` : ''}`
        : m.expected_date
          ? `Due ${portalDate(m.expected_date)}`
          : 'Due on schedule',
      amount: Number(m.amount) || 0,
      paid,
      due: !paid && !!m.expected_date,
    })
  })

  const paidFromMilestones = milestones
    .filter((m) => m.status === 'received')
    .reduce((sum, m) => sum + (Number(m.amount) || 0), 0)

  // Invoice payments. With milestones present these are the SAME money seen
  // from the other side (internal mode records both), so they're only listed
  // when there is no milestone schedule to list instead — otherwise every
  // internal-mode payment would appear twice.
  let paidFromInvoice = 0
  if (sig.contractInvoice) {
    const { data } = await supabaseAdmin
      .from('client_invoice_payments')
      .select('amount, payment_date, payment_method, reference')
      .eq('invoice_id', sig.contractInvoice.id)
      .order('payment_date', { ascending: true })
    const payments =
      (data as
        | { amount: number | null; payment_date: string | null; payment_method: string | null; reference: string | null }[]
        | null) || []
    payments.forEach((pay) => {
      paidFromInvoice += Number(pay.amount) || 0
      if (milestones.length > 0) return
      const bits = [portalDate(pay.payment_date) ? `Paid ${portalDate(pay.payment_date)}` : null]
      if (pay.reference) bits.push(pay.reference)
      else if (pay.payment_method) bits.push(pay.payment_method)
      rows.push({
        label: 'Payment received',
        sublabel: bits.filter(Boolean).join(' · ') || null,
        amount: Number(pay.amount) || 0,
        paid: true,
        due: false,
      })
    })
  }

  // MAX, not sum: in internal mode the same money is recorded in both places,
  // so adding them would double the figure on a client-facing page. In QB mode
  // only the milestone side moves until the watcher posts, and after it posts
  // only the invoice side may be complete — max is right in every combination.
  const paid = Math.max(paidFromInvoice, paidFromMilestones)

  return { total, paid, rows }
}

/** Production start and install target, both derived from the schedule rather
 *  than a stored stage timestamp — nothing stamps "production began" today, but
 *  startProduction() seeds department allocations at that moment, so the
 *  earliest allocation IS the start. Returns nulls freely: a missing date drops
 *  its row from the view rather than showing a guess. */
async function loadScheduleDates(
  subprojectIds: string[],
): Promise<{ startedOn: string | null; installTarget: string | null }> {
  if (subprojectIds.length === 0) return { startedOn: null, installTarget: null }
  const { data } = await supabaseAdmin
    .from('department_allocations')
    .select('name, scheduled_date')
    .in('subproject_id', subprojectIds)
    .not('scheduled_date', 'is', null)
    .order('scheduled_date', { ascending: true })
  const rows = (data as { name: string | null; scheduled_date: string }[] | null) || []
  if (rows.length === 0) return { startedOn: null, installTarget: null }
  const install = rows.find((r) => /install/i.test(r.name || ''))
  return { startedOn: rows[0].scheduled_date, installTarget: install?.scheduled_date ?? null }
}

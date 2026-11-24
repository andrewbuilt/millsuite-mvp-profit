'use client'

// ============================================================================
// /dev/preapproval-prepro — fixture for the PRE-PRODUCTION side of 135
// ============================================================================
// Mounts the REAL ApprovalSlots (type picker, grouping by kind, hardware link,
// photo strip) and the REAL PortalAdminCard (link, lead time, notify-first
// queue, questions thread) with the Supabase client's `from()` and the two
// /api/preapproval routes swapped for in-memory stand-ins — so the real
// lib/approvals + lib/preapproval-admin code runs and nothing touches the
// database. Dev-only: production builds 404 it.
// ============================================================================

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ConfirmProvider } from '@/components/confirm-dialog'
import ApprovalSlots from '@/components/approval-slots'
import PortalAdminCard from '@/components/preapproval/PortalAdminCard'
import HandoffCard from '@/components/project/HandoffCard'
import { buildNotifyEmail, type PortalActivityEntry } from '@/lib/preapproval-view'

type Row = Record<string, any>
const now = () => new Date().toISOString()
const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString()
let seq = 0

const db: Record<string, Row[]> = {}
const portal = { token: null as string | null, issuedAt: null as string | null, notifiedAt: null as string | null }
const photos: Record<string, Row[]> = {}

function seed() {
  const item = (id: string, label: string, kind: string, extra: Row = {}): Row => ({
    id, subproject_id: 's1', label, material: null, finish: null, state: 'pending', ball_in_court: 'shop',
    last_state_change_at: ago(48), revision: 1, item_kind: kind, link_url: null, is_custom: true,
    linked_to_item_id: null, source_estimate_line_id: null, dismissed_at: null, created_at: ago(72), updated_at: ago(48),
    ...extra,
  })
  db.approval_items = [
    item('a1', 'Exterior finish', 'finish', { finish: 'Matte lacquer', state: 'in_review', ball_in_court: 'client' }),
    item('a2', 'Carcass material', 'finish', { material: 'White oak', state: 'approved', ball_in_court: null }),
    item('a3', 'Pulls', 'hardware', { material: 'Amerock Candler 96mm', link_url: 'https://www.amerock.com/candler-96' }),
    item('a4', 'Feature', 'other', { material: '15 LF LED COB strip' }),
  ]
  db.item_revisions = [
    { id: 'r1', approval_item_id: 'a2', action: 'approved', note: 'Approved in the portal', actor_user_id: null, actor_name: 'Dave Pajot', occurred_at: ago(30) },
  ]
  db.subprojects = [{ id: 's1', project_id: 'p1', org_id: 'org1', name: 'Reception Desk' }]
  db.projects = [{ id: 'p1', lead_time_weeks: null, handoff_contacts: [{ id: 'c1', category: 'gc', name: 'David Andrukaitis', phone: '1-941-555-0111', email: 'build@example.com' }] }]
  db.tasks = [{ id: 't1', org_id: 'org1', title: 'Portal question — Hunt', done_at: null }]
  db.portal_questions = [
    { id: 'q1', project_id: 'p1', body: 'Is the desk shipped assembled?', author_name: 'Dave Pajot', created_at: ago(5), answer: null, answered_by: null, answered_at: null, task_id: 't1' },
    { id: 'q0', project_id: 'p1', body: 'Can the uppers go to the deck?', author_name: 'Dave Pajot', created_at: ago(50), answer: 'Yes.', answered_by: 'u1', answered_at: ago(48), task_id: null },
  ]
  db.project_events = []
  portal.token = portal.issuedAt = portal.notifiedAt = null
  for (const k of Object.keys(photos)) delete photos[k]
}

/** Just enough of the PostgREST builder for lib/approvals + preapproval-admin. */
function fakeFrom(table: string) {
  const st = { op: 'select', body: null as Row | null, single: false, filters: [] as ((r: Row) => boolean)[] }
  const rows = (): Row[] => (db[table] ||= [])
  const exec = () => {
    let out: Row[]
    if (st.op === 'insert') {
      const list = (Array.isArray(st.body) ? st.body : [st.body]) as Row[]
      out = list.map((b) => ({ id: `x${++seq}`, created_at: now(), updated_at: now(), dismissed_at: null, revision: 1, ...b }))
      rows().push(...out)
    } else {
      out = rows().filter((r) => st.filters.every((f) => f(r)))
      if (st.op === 'update') out.forEach((r) => Object.assign(r, st.body))
    }
    const data = st.single ? out[0] ?? null : out
    return { data: JSON.parse(JSON.stringify(data)), error: null }
  }
  const b: any = {
    select: () => b,
    insert: (x: Row) => ((st.op = 'insert'), (st.body = x), b),
    update: (x: Row) => ((st.op = 'update'), (st.body = x), b),
    eq: (k: string, v: unknown) => (st.filters.push((r) => r[k] === v), b),
    in: (k: string, v: unknown[]) => (st.filters.push((r) => v.includes(r[k])), b),
    is: (k: string, v: unknown) => (st.filters.push((r) => (r[k] ?? null) === v), b),
    order: () => b,
    limit: () => b,
    single: () => ((st.single = true), b),
    maybeSingle: () => ((st.single = true), b),
    then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
  }
  return b
}

/** What the shop's queue would hold: revisions + answers since the last send. */
function queue(): PortalActivityEntry[] {
  const since = portal.notifiedAt || portal.issuedAt
  if (!since) return []
  const label = (id: string) => db.approval_items.find((i) => i.id === id)?.label || 'a callout'
  const out: PortalActivityEntry[] = [
    ...db.item_revisions.map((r) => ({
      key: `ir-${r.id}`, at: r.occurred_at, who: r.actor_name || 'BUILT', kind: 'state' as const, fromClient: !!r.actor_name,
      text: r.action === 'submitted' ? `submitted ${label(r.approval_item_id)} for approval` : `${r.action.replace(/_/g, ' ')} ${label(r.approval_item_id)}`,
    })),
    ...db.portal_questions.filter((q) => q.answered_at).map((q) => ({
      key: `qa-${q.id}`, at: q.answered_at, who: 'BUILT', kind: 'answer' as const, fromClient: false, text: 'answered Dave’s question',
    })),
    ...Object.entries(photos).flatMap(([itemId, list]) =>
      list.map((p) => ({ key: `ph-${p.id}`, at: p.createdAt, who: 'BUILT', kind: 'photo' as const, fromClient: false, text: `added a photo to ${label(itemId)}` })),
    ),
  ]
  return out.filter((a) => a.at > since).sort((a, b) => b.at.localeCompare(a.at))
}

function adminState() {
  const url = portal.token ? `${location.origin}/p/${portal.token}` : null
  const q = queue()
  return {
    link: url ? { url, issuedAt: portal.issuedAt } : null,
    lastNotifiedAt: portal.notifiedAt,
    pocEmail: 'dave@example.com',
    queue: q,
    email: url
      ? buildNotifyEmail({ orgName: 'BUILT', projectName: 'Hunt — Reception', pocName: 'Dave Pajot', portalUrl: url, queue: q, waitingOnYou: 1 })
      : null,
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), location.origin)
  if (url.pathname === '/api/preapproval/photos') {
    if (init?.method === 'POST') {
      const form = init.body as FormData
      const itemId = String(form.get('itemId'))
      ;(photos[itemId] ||= []).push({
        id: `ph${++seq}`, url: URL.createObjectURL(form.get('file') as File), caption: null, addedBy: 'Kaylin', fromClient: false, createdAt: now(),
      })
      return json({ photos: photos[itemId] })
    }
    if (init?.method === 'DELETE') {
      const id = url.searchParams.get('photoId')
      const itemId = Object.keys(photos).find((k) => photos[k].some((p) => p.id === id)) || ''
      photos[itemId] = (photos[itemId] || []).filter((p) => p.id !== id)
      return json({ photos: photos[itemId] })
    }
    return json({ photos: photos[url.searchParams.get('itemId') || ''] || [] })
  }
  if (url.pathname.startsWith('/api/preapproval/')) {
    if (init?.method === 'POST') {
      const { action } = JSON.parse(String(init.body))
      const mint = () => `fixture${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
      if (action === 'link' && !portal.token) (portal.token = mint()), (portal.issuedAt = now())
      if (action === 'reissue') (portal.token = mint()), (portal.issuedAt = now())
      if (action === 'notified') portal.notifiedAt = now()
    }
    return json(adminState())
  }
  return realFetch(input, init)
}
let realFetch: typeof fetch

export default function PreapprovalPreproFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [refresh, setRefresh] = useState(0)

  // Swap table access, the session read and the two admin routes, once.
  useState(() => {
    seed()
    ;(supabase as any).from = fakeFrom
    ;(supabase.auth as any).getSession = async () => ({ data: { session: { access_token: 'fixture' } } })
    if (typeof window !== 'undefined' && !realFetch) {
      realFetch = window.fetch.bind(window)
      window.fetch = fakeFetch as typeof fetch
    }
    return true
  })

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-[#F9FAFB] p-8">
        <div className="max-w-[820px] mx-auto">
          <div className="text-xs text-[#9CA3AF] mb-3">
            DEV fixture · pre-production side of the approval portal (migration 135) · in-memory, nothing saved
          </div>
          <HandoffCard
            projectId="p1"
            values={{ poc_name: 'Bryan Hunt', poc_phone: '555-0100', poc_email: 'bryan@example.com', delivery_address: '7981 2nd Ave S', client_deadline: 'End of February' }}
            onSaved={() => {}}
          />
          <PortalAdminCard projectId="p1" orgId="org1" userId="u1" refreshKey={refresh} />
          <section className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-[#F3F4F6] text-[15px] font-semibold text-[#111]">
              Reception Desk
            </div>
            <div className="px-3 py-3">
              <ApprovalSlots subprojectId="s1" actorUserId="u1" hideHeader onChange={() => setRefresh((n) => n + 1)} />
            </div>
          </section>
        </div>
      </div>
    </ConfirmProvider>
  )
}

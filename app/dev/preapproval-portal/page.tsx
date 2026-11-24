'use client'

// ============================================================================
// /dev/preapproval-portal — fixture harness for the B2B approval portal (135)
// ============================================================================
// Mounts the REAL PreapprovalPortalView over the REAL read model
// (lib/preapproval-view buildPortalView) on an in-memory copy of the rows the
// server loader would hand it — the mockup's "Hunt — Reception & Casework"
// job, three subprojects. The portal is otherwise unreachable locally without
// a live token and migration 135.
//
// The writes here mimic what lib/preapproval-portal does to the rows (same
// guards: ball must be with the client, a name is required, a change needs a
// note, blank contact fields never clear) so every interaction can be driven
// end to end. The raw rows carry POISON fields a real loader never selects
// (bid_total, margins, internal notes) to show they cannot reach the page.
//
// The grey bar at the top plays the SHOP: answer a question, submit a drawing
// revision, toggle the lead time. Dev-only: production builds 404 it.
// ============================================================================

import { useMemo, useState } from 'react'
import { notFound } from 'next/navigation'
import { PreapprovalPortalView, type PortalActions } from '@/components/preapproval/PreapprovalPortalView'
import {
  buildPortalView,
  contactChanges,
  notifyQueue,
  PORTAL_CONTACT_FIELDS,
  type RawPortalInput,
} from '@/lib/preapproval-view'

const ago = (days: number, hours = 0) => new Date(Date.now() - days * 86400000 - hours * 3600000).toISOString()

function swatch(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function seed(): RawPortalInput {
  const poison = { bid_total: 184250, labor_margin_pct: 38, internal_notes: 'INTERNAL: client is slow to pay' }
  return {
    orgName: 'BUILT',
    team: {
      name: 'Kaylin',
      title: 'Project Manager',
      email: 'kaylin@example.com',
      phone: '(813) 555-0142',
      shopAddress: '4902 N Hale Ave, Tampa, FL 33614',
    },
    project: {
      id: 'p1',
      name: 'Hunt — Reception & Casework Package',
      client_name: 'Pajot Millwork',
      sold_at: ago(12),
      lead_time_weeks: 8,
      portal_token_issued_at: ago(12, -1),
      poc_name: 'Dave Pajot',
      poc_email: 'dave@example.com',
      poc_phone: '(813) 555-0177',
      delivery_address: 'Hunt Office Building, 601 E Kennedy Blvd, Tampa',
      client_deadline: 'Occupied by March 1',
      ...poison,
    } as RawPortalInput['project'],
    subs: [
      { id: 's1', name: 'Reception Desk', sort_order: 1 },
      { id: 's2', name: 'Conference Casework', sort_order: 2 },
      { id: 's3', name: 'Mailroom', sort_order: 3 },
    ],
    items: [
      {
        id: 'i1', subproject_id: 's1', label: 'White Oak — natural clear', material: 'Physical sample #S-118 delivered',
        finish: null, state: 'in_review', ball_in_court: 'client', last_state_change_at: ago(5), item_kind: 'finish',
        link_url: null, created_at: ago(12), custom_material_cost_per_lf: 41.5,
      } as RawPortalInput['items'][number],
      {
        id: 'i2', subproject_id: 's1', label: 'PLAM — Formica 949 White', material: null, finish: null,
        state: 'approved', ball_in_court: null, last_state_change_at: ago(7), item_kind: 'finish', link_url: null,
        created_at: ago(12, -1),
      },
      {
        id: 'i3', subproject_id: 's1', label: 'Blum soft-close hinges · satin nickel pulls', material: null,
        finish: null, state: 'approved', ball_in_court: null, last_state_change_at: ago(7), item_kind: 'hardware',
        link_url: 'https://www.richelieu.com/BP98765-195', created_at: ago(12, -2),
      },
      {
        id: 'i4', subproject_id: 's1', label: 'Countertop — Quartz, Caesarstone 4141', material: null, finish: null,
        state: 'approved', ball_in_court: null, last_state_change_at: ago(10), item_kind: 'drawing', link_url: null,
        created_at: ago(12, -3),
      },
      {
        id: 'i5', subproject_id: 's3', label: 'Mailroom laminate', material: 'Wilsonart Fashion Grey', finish: 'Matte',
        state: 'approved', ball_in_court: null, last_state_change_at: ago(9), item_kind: 'finish', link_url: null,
        created_at: ago(12),
      },
    ],
    itemRevisions: [
      { id: 'r1', approval_item_id: 'i1', action: 'submitted', note: null, actor_name: null, occurred_at: ago(5) },
      { id: 'r2', approval_item_id: 'i2', action: 'approved', note: 'Approved in the portal', actor_name: 'Dave Pajot', occurred_at: ago(7) },
      { id: 'r3', approval_item_id: 'i3', action: 'approved', note: 'Approved in the portal', actor_name: 'Dave Pajot', occurred_at: ago(7, -1) },
      // Recorded in the app, with a SHOP note that must never be echoed.
      { id: 'r4', approval_item_id: 'i4', action: 'approved', note: 'INTERNAL: approved by vendor sample, GC grumbled', actor_name: null, occurred_at: ago(10) },
      { id: 'r5', approval_item_id: 'i5', action: 'approved', note: 'Approved in the portal', actor_name: 'Dave Pajot', occurred_at: ago(9) },
    ],
    drawings: [
      { id: 'd1', subproject_id: 's1', revision_number: 1, file_url: null, state: 'pending', is_latest: false, submitted_at: ago(11), responded_at: ago(10), responded_by_name: null, notes: 'INTERNAL: redrawn after site measure' },
      { id: 'd2', subproject_id: 's1', revision_number: 2, file_url: null, state: 'pending', is_latest: false, submitted_at: ago(8), responded_at: ago(6), responded_by_name: 'Dave Pajot', notes: 'extend the transaction top 4" past the gable' },
      { id: 'd3', subproject_id: 's1', revision_number: 3, file_url: 'https://drive.google.com/file/d/example/view', state: 'in_review', is_latest: true, submitted_at: ago(3), responded_at: null, responded_by_name: null, notes: null },
      { id: 'd4', subproject_id: 's3', revision_number: 1, file_url: null, state: 'approved', is_latest: true, submitted_at: ago(9), responded_at: ago(8), responded_by_name: 'Dave Pajot', notes: null },
    ],
    photos: [
      { id: 'ph1', approval_item_id: 'i1', caption: 'sample', added_by: 'Kaylin', from_client: false, created_at: ago(5, -0.2), url: swatch('#E7D8C2', '#C9A97C') },
      { id: 'ph2', approval_item_id: 'i1', caption: 'in situ', added_by: 'Kaylin', from_client: false, created_at: ago(5, -0.21), url: swatch('#F4F4F2', '#DADAD6') },
    ],
    questions: [
      {
        id: 'q1', body: 'Can the mailroom uppers go to the deck instead of 42"?', author_name: 'Dave Pajot',
        created_at: ago(6, 1), answer: 'Yes — we’ll pick it up on Rev 2 of the mailroom drawings.',
        answered_at: ago(6), answered_by_label: 'Kaylin',
      },
    ],
    events: [
      { id: 'e1', event_type: 'portal_contact_edit', label: 'Dave Pajot updated the jobsite deadline', created_at: ago(9, 2) },
      // A non-portal event a real loader filters out — and the view drops again.
      { id: 'e2', event_type: 'margin_changed', label: 'INTERNAL: margin dropped to 31%', created_at: ago(4) },
    ],
    blockedItemIds: [],
  }
}

let seq = 0
const nid = (p: string) => `${p}-new-${++seq}`

export default function PreapprovalPortalFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [raw, setRaw] = useState<RawPortalInput>(seed)
  const [lastNotified, setLastNotified] = useState<string | null>(null)
  const view = useMemo(() => buildPortalView(raw), [raw])
  const queue = notifyQueue(view.activity, lastNotified, raw.project.portal_token_issued_at)

  const actions = useMemo<PortalActions>(() => {
    const now = () => new Date().toISOString()
    return {
      async approve(type, id, name) {
        let err: string | null = null
        setRaw((r) => {
          if (type === 'drawing') {
            const d = r.drawings.find((x) => x.id === id)
            if (!d || !d.is_latest || d.state !== 'in_review') return (err = 'These drawings aren’t with you right now'), r
            return { ...r, drawings: r.drawings.map((x) => (x.id === id ? { ...x, state: 'approved', responded_at: now(), responded_by_name: name } : x)) }
          }
          const it = r.items.find((x) => x.id === id)
          if (!it || it.ball_in_court !== 'client') return (err = 'This one isn’t with you right now'), r
          return {
            ...r,
            items: r.items.map((x) => (x.id === id ? { ...x, state: 'approved', ball_in_court: null, last_state_change_at: now() } : x)),
            itemRevisions: [...r.itemRevisions, { id: nid('r'), approval_item_id: id, action: 'approved', note: 'Approved in the portal', actor_name: name, occurred_at: now() }],
          }
        })
        return err
      },
      async requestChange(type, id, name, note) {
        let err: string | null = null
        setRaw((r) => {
          if (type === 'drawing') {
            const d = r.drawings.find((x) => x.id === id)
            if (!d || !d.is_latest || d.state !== 'in_review') return (err = 'These drawings aren’t with you right now'), r
            return { ...r, drawings: r.drawings.map((x) => (x.id === id ? { ...x, state: 'pending', responded_at: now(), responded_by_name: name, notes: note } : x)) }
          }
          const it = r.items.find((x) => x.id === id)
          if (!it || it.ball_in_court !== 'client') return (err = 'This one isn’t with you right now'), r
          return {
            ...r,
            items: r.items.map((x) => (x.id === id ? { ...x, state: 'pending', ball_in_court: 'shop', last_state_change_at: now() } : x)),
            itemRevisions: [...r.itemRevisions, { id: nid('r'), approval_item_id: id, action: 'client_requested_change', note, actor_name: name, occurred_at: now() }],
          }
        })
        return err
      },
      async ask(name, body) {
        setRaw((r) => ({
          ...r,
          questions: [...r.questions, { id: nid('q'), body, author_name: name, created_at: now(), answer: null, answered_at: null, answered_by_label: null }],
        }))
        return null
      },
      async saveContact(fields) {
        setRaw((r) => {
          const changes = contactChanges(r.project, fields)
          if (changes.length === 0) return r
          const project = { ...r.project }
          for (const c of changes) project[c.field] = c.value
          const who = project.poc_name || 'Client'
          return {
            ...r,
            project,
            events: [
              ...r.events,
              ...changes.map((c) => ({ id: nid('e'), event_type: 'portal_contact_edit', label: `${who} updated the ${PORTAL_CONTACT_FIELDS[c.field].label}`, created_at: now() })),
            ],
          }
        })
        return null
      },
      async addPhoto(itemId, name, file) {
        const url = URL.createObjectURL(file)
        setRaw((r) => ({
          ...r,
          photos: [...r.photos, { id: nid('ph'), approval_item_id: itemId, caption: null, added_by: name, from_client: true, created_at: now(), url }],
        }))
        return null
      },
    }
  }, [])

  const unanswered = raw.questions.filter((q) => !q.answer)
  const bar: React.CSSProperties = { background: '#111827', color: '#E5E7EB', fontSize: 12, padding: '8px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }
  const btn: React.CSSProperties = { background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 9px', fontSize: 12, cursor: 'pointer' }

  return (
    <div>
      <div style={bar} data-testid="shop-bar">
        <b>DEV · playing the shop</b>
        <button
          style={btn}
          disabled={unanswered.length === 0}
          onClick={() =>
            setRaw((r) => ({
              ...r,
              questions: r.questions.map((q) =>
                q.answer ? q : { ...q, answer: 'Good question — yes, we can do that.', answered_at: new Date().toISOString(), answered_by_label: 'Kaylin' },
              ),
            }))
          }
        >
          Answer open questions ({unanswered.length})
        </button>
        <button
          style={btn}
          onClick={() =>
            setRaw((r) => {
              const n = Math.max(0, ...r.drawings.filter((d) => d.subproject_id === 's2').map((d) => d.revision_number)) + 1
              return {
                ...r,
                drawings: [
                  ...r.drawings.map((d) => (d.subproject_id === 's2' ? { ...d, is_latest: false } : d)),
                  { id: nid('d'), subproject_id: 's2', revision_number: n, file_url: null, state: 'in_review', is_latest: true, submitted_at: new Date().toISOString(), responded_at: null, responded_by_name: null, notes: null },
                ],
              }
            })
          }
        >
          Submit next Conference rev
        </button>
        <button style={btn} onClick={() => setRaw((r) => ({ ...r, project: { ...r.project, lead_time_weeks: r.project.lead_time_weeks ? null : 8 } }))}>
          Lead time: {raw.project.lead_time_weeks ? `${raw.project.lead_time_weeks} wks` : 'not set'}
        </button>
        <button style={btn} onClick={() => setLastNotified(new Date().toISOString())}>
          “Email updates” (clears queue)
        </button>
        <span data-testid="queue-count">updates to send: {queue.length}</span>
        <button style={btn} onClick={() => { setRaw(seed()); setLastNotified(null) }}>
          Reset
        </button>
      </div>
      <PreapprovalPortalView p={view} actions={actions} />
    </div>
  )
}

'use client'

// ============================================================================
// PreapprovalPortalView — the B2B approval portal, as the client sees it
// ============================================================================
// Built to mockups/preapproval-portal-mockup.html (v2, approved 2026-11-24).
// The stylesheet below IS the mockup's, class for class, scoped under `.pap` —
// so "match it closely" is a diff against one file rather than a translation
// into utility classes.
//
// Presentation + local form state only. It renders a `PreapprovalPortal`
// payload (lib/preapproval-view — the public allowlist) and calls `actions`
// for every write, so the real page (token routes) and the /dev fixture
// (in-memory) drive the exact same component.
//
// ⛔ Nothing here may display money, margins, payments or internal notes —
// and it can't: none of it is in the payload type.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { shortLinkLabel } from '@/lib/approval-kind'
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABEL, MAX_HANDOFF_CONTACTS } from '@/lib/handoff-contacts'
import { weeksLabel, type PortalItemView, type PortalSubView, type PreapprovalPortal } from '@/lib/preapproval-view'

/** Each returns an error message, or null when it worked. */
export interface PortalActions {
  approve(type: 'item' | 'drawing', id: string, name: string): Promise<string | null>
  requestChange(type: 'item' | 'drawing', id: string, name: string, note: string): Promise<string | null>
  ask(name: string, body: string): Promise<string | null>
  saveContact(
    fields: Record<string, string>,
    contacts: Array<{ id?: string; category: string; name: string; phone: string; email: string }>,
  ): Promise<string | null>
  addPhoto(itemId: string, name: string, file: File): Promise<string | null>
}

const CSS = `
.pap{--ink:#111827;--body:#374151;--mut:#6B7280;--faint:#9CA3AF;--line:#E5E7EB;--soft:#F3F4F6;--bg:#F9FAFB;--blue:#2563EB;--blue-bg:#EFF6FF;--green:#059669;--green-bg:#ECFDF5;--amber:#B45309;--amber-bg:#FFFBEB;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--body);line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh}
.pap *{box-sizing:border-box;margin:0;padding:0}
.pap .page{max-width:880px;margin:0 auto;padding:0 24px 80px}
.pap .topbar{background:#fff;border-bottom:1px solid var(--line)}
.pap .topbar-in{max-width:880px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.pap .wordmark{font-weight:800;letter-spacing:.12em;font-size:15px;color:var(--ink);text-transform:uppercase}
.pap .topbar .mut{font-size:12.5px;color:var(--faint);text-align:right}
.pap .head{padding:40px 0 8px}
.pap .eyebrow{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600}
.pap h1{font-size:27px;font-weight:700;color:var(--ink);letter-spacing:-.01em;margin-top:6px}
.pap .card{background:#fff;border:1px solid var(--line);border-radius:14px;margin-top:20px;overflow:hidden}
.pap .card-pad{padding:22px 24px}
.pap .card h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:700}
.pap .contacts{display:grid;grid-template-columns:1fr 1fr;gap:0}
.pap .contacts .col{padding:18px 24px;min-width:0}
.pap .contacts .col+.col{border-left:1px solid var(--soft)}
.pap .c-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.pap .c-title{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:700}
.pap .edit{font-size:12px;color:var(--blue);text-decoration:none;font-weight:600;cursor:pointer;background:none;border:none}
.pap .c-name{font-size:14.5px;font-weight:600;color:var(--ink)}
.pap .c-line{font-size:13.5px;color:var(--mut);margin-top:2px;overflow-wrap:anywhere}
.pap .c-line a{color:var(--blue);text-decoration:none}
.pap .c-lbl{display:block;font-size:11px;color:var(--faint);margin-top:8px}
.pap .c-input{width:100%;margin-top:4px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:13.5px;color:var(--ink);font-family:inherit;background:#fff}
.pap .c-input:focus{outline:none;border-color:var(--blue)}
.pap .c-save{display:flex;gap:8px;margin-top:8px}
.pap .c-other{margin-top:10px;padding-top:10px;border-top:1px solid var(--soft)}
.pap .c-tag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);background:var(--soft);border-radius:999px;padding:2px 8px;margin-right:8px;vertical-align:1px}
.pap .c-row{margin-top:10px;padding-top:6px;border-top:1px solid var(--soft)}
.pap .statusgrid{display:flex;border-bottom:1px solid var(--soft)}
.pap .statusgrid .cell{flex:1;padding:20px 24px;border-right:1px solid var(--soft)}
.pap .statusgrid .cell:last-child{border-right:none}
.pap .big{font-size:24px;font-weight:700;color:var(--ink)}
.pap .big .dim{color:var(--faint);font-weight:600}
.pap .lbl{font-size:12px;color:var(--mut);margin-top:2px}
.pap .bar{height:6px;background:var(--soft);border-radius:3px;overflow:hidden;margin:18px 24px 0}
.pap .bar i{display:block;height:100%;background:var(--green);border-radius:3px}
.pap .barnote{padding:8px 24px 18px;font-size:13px;color:var(--mut)}
.pap .barnote b{color:var(--ink);font-weight:600}
.pap .lead{background:var(--blue-bg);border:1px solid #DBEAFE;border-radius:14px;margin-top:20px;padding:20px 24px;display:flex;gap:16px;align-items:flex-start}
.pap .lead .num{font-size:30px;font-weight:800;color:var(--blue);line-height:1.1;white-space:nowrap}
.pap .lead .num small{display:block;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#60A5FA}
.pap .lead p{font-size:14px;color:#1E3A8A}
.pap .lead .clock{font-size:12.5px;color:#3B82F6;margin-top:6px}
.pap .sub{border:1px solid var(--line);border-radius:14px;margin-top:20px;background:#fff;overflow:hidden}
.pap .sub-head{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer;background:#fff;width:100%;border:none;text-align:left;font-family:inherit}
.pap .caret{width:0;height:0;border-left:6px solid var(--faint);border-top:5px solid transparent;border-bottom:5px solid transparent;transition:transform .1s}
.pap .sub.open .caret{transform:rotate(90deg)}
.pap .sub-title{font-size:16px;font-weight:700;color:var(--ink);flex:1}
.pap .sub-count{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.pap .sub-count.part{background:var(--amber-bg);color:var(--amber)}
.pap .sub-count.done{background:var(--green-bg);color:var(--green)}
.pap .sub-body{border-top:1px solid var(--soft)}
.pap .group{padding:4px 0 10px}
.pap .group-h{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:700;padding:14px 20px 4px}
.pap .item{display:flex;gap:14px;padding:12px 20px;align-items:flex-start;border-top:1px solid var(--soft)}
.pap .group .item:first-of-type{border-top:none}
.pap .dot{width:9px;height:9px;border-radius:50%;margin-top:7px;flex-shrink:0}
.pap .dot.g{background:var(--green)} .pap .dot.a{background:#F59E0B} .pap .dot.b{background:var(--blue)}
.pap .mid{flex:1;min-width:0}
.pap .name{font-size:14.5px;font-weight:600;color:var(--ink)}
.pap .meta{font-size:12.5px;color:var(--mut);margin-top:1px;overflow-wrap:anywhere}
.pap .meta .ts{color:var(--faint)}
.pap .meta a{color:var(--blue);text-decoration:none}
.pap .pill{display:inline-block;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.pap .pill.approved{background:var(--green-bg);color:var(--green)}
.pap .pill.waiting{background:var(--amber-bg);color:var(--amber)}
.pap .pill.shop{background:var(--soft);color:var(--mut)}
.pap .act{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.pap .btn{font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--body);cursor:pointer;font-family:inherit}
.pap .btn:disabled{opacity:.5;cursor:default}
.pap .btn.primary{background:var(--green);border-color:var(--green);color:#fff}
.pap .btn.blue{background:var(--blue);border-color:var(--blue);color:#fff}
.pap .btn.q{color:var(--blue)}
.pap .confirm{margin-top:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:10px;max-width:460px}
.pap .confirm p{font-size:12.5px;color:var(--mut)}
.pap .confirm textarea{width:100%;margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13.5px;font-family:inherit;resize:vertical;min-height:64px;color:var(--ink)}
.pap .err{font-size:12.5px;color:#B91C1C;margin-top:6px}
.pap .thumbs{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.pap .thumb{width:64px;height:64px;border-radius:8px;border:1px solid var(--line);background:var(--soft);position:relative;overflow:hidden;display:block}
.pap .thumb img{width:100%;height:100%;object-fit:cover;display:block}
.pap .thumb small{position:absolute;bottom:2px;left:4px;font-size:9px;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.7)}
.pap .thumb.add{background:#fff;border:1.5px dashed var(--line);display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:20px;cursor:pointer}
.pap .thumb-ts{font-size:11px;color:var(--faint);margin-top:4px}
.pap .foot{margin-top:40px;text-align:center;font-size:12px;color:var(--faint)}
.pap .foot b{letter-spacing:.1em;color:var(--mut);text-transform:uppercase}
.pap .qa{padding:0 24px 22px}
.pap .q-row{border-top:1px solid var(--soft);padding:14px 0}
.pap .q-row:first-child{border-top:none}
.pap .q-q{font-size:14px;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.pap .q-meta{font-size:12px;color:var(--faint);margin-top:2px}
.pap .q-a{margin-top:10px;margin-left:16px;padding:10px 14px;background:var(--bg);border-radius:10px;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}
.pap .q-wait{margin-top:6px;margin-left:16px;font-size:12px;color:var(--faint)}
.pap .ask{margin-top:6px;padding-top:16px;border-top:1px solid var(--soft)}
.pap .ask-row{display:flex;gap:8px}
.pap .ask textarea{flex:1;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13.5px;font-family:inherit;resize:none;height:42px;color:var(--ink)}
.pap .ask .c-input{max-width:260px;margin:0 0 8px}
.pap .tl{padding:6px 24px 20px}
.pap .tl-row{display:flex;gap:14px;padding:10px 0;border-top:1px solid var(--soft);font-size:13.5px}
.pap .tl-row:first-child{border-top:none}
.pap .tl-ts{width:148px;flex-shrink:0;color:var(--faint);font-size:12.5px}
.pap .tl-row .who{font-weight:600;color:var(--ink)}
.pap .empty{font-size:13px;color:var(--faint);padding:4px 0 2px}
@media(max-width:640px){.pap .statusgrid{flex-wrap:wrap}.pap .statusgrid .cell{min-width:50%}.pap .contacts{grid-template-columns:1fr}.pap .contacts .col+.col{border-left:none;border-top:1px solid var(--soft)}.pap .tl-ts{width:110px}.pap .lead{flex-direction:column;gap:8px}}
`

/** The shop's timezone for the first paint (server + hydration must agree);
 *  after mount the reader's own timezone takes over. */
const SHOP_TZ = 'America/New_York'

function useStamp() {
  const [tz, setTz] = useState<string | undefined>(SHOP_TZ)
  useEffect(() => setTz(undefined), [])
  return {
    /** "Nov 24, 2:14 PM" (+ year when it isn't this one). */
    stamp(iso: string | null | undefined): string {
      if (!iso) return ''
      const d = new Date(iso)
      if (!Number.isFinite(d.getTime())) return ''
      const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
        hour: 'numeric',
        minute: '2-digit',
        timeZone: tz,
      })
    },
  }
}

/** A date-only value (YYYY-MM-DD) — never shifted by a timezone. */
function calendarDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function PreapprovalPortalView({ p, actions }: { p: PreapprovalPortal; actions: PortalActions }) {
  const { stamp } = useStamp()
  // Typed once per visit, then offered back — still typed by them, never
  // prefilled from the contact card.
  const [signer, setSigner] = useState('')
  const open = p.status.total - p.status.approved
  const pct = p.status.total === 0 ? 0 : Math.round((p.status.approved / p.status.total) * 100)

  return (
    <div className="pap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="topbar">
        <div className="topbar-in">
          <div className="wordmark">{p.orgName}</div>
          <div className="mut">
            Project approval portal{p.updatedAt ? ` · updated ${stamp(p.updatedAt)}` : ''}
          </div>
        </div>
      </div>

      <div className="page">
        <div className="head">
          {p.clientName && <div className="eyebrow">Prepared for {p.clientName}</div>}
          <h1>{p.projectName}</h1>
        </div>

        <ContactsCard p={p} actions={actions} />

        {/* STATUS */}
        <div className="card" data-testid="portal-status">
          <div className="statusgrid">
            <div className="cell">
              <div className="big">
                {p.status.approved} <span className="dim">of {p.status.total}</span>
              </div>
              <div className="lbl">items approved</div>
            </div>
            <div className="cell">
              <div className="big" style={{ color: 'var(--amber)' }}>
                {p.status.waitingOnYou}
              </div>
              <div className="lbl">waiting on you</div>
            </div>
            <div className="cell">
              <div className="big" style={{ color: 'var(--mut)' }}>
                {p.status.inOurCourt}
              </div>
              <div className="lbl">in our court</div>
            </div>
            <div className="cell">
              <div className="big">
                {p.status.daysInPrepro === null ? (
                  '—'
                ) : (
                  <>
                    {p.status.daysInPrepro} <span className="dim">{p.status.daysInPrepro === 1 ? 'day' : 'days'}</span>
                  </>
                )}
              </div>
              <div className="lbl">in pre-production</div>
            </div>
          </div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="barnote">
            {p.status.total === 0 ? (
              'Nothing has been submitted for approval yet.'
            ) : open === 0 ? (
              <>
                <b>Everything is approved</b> — this project is released to the production schedule.
              </>
            ) : (
              <>
                <b>
                  {open} item{open === 1 ? '' : 's'}
                </b>{' '}
                stand{open === 1 ? 's' : ''} between this project and the production schedule —{' '}
                {p.status.waitingOnYou === 0
                  ? 'none are waiting on you right now.'
                  : `${p.status.waitingOnYou} ${p.status.waitingOnYou === 1 ? 'is' : 'are'} waiting on your approval below.`}
              </>
            )}
          </div>
        </div>

        {/* LEAD TIME — hidden entirely when no lead time is set */}
        {p.leadTime && (
          <div className="lead" data-testid="portal-lead">
            <div className="num">
              <small>Lead time</small>
              {weeksLabel(p.leadTime.weeks)} wks
            </div>
            <div>
              <p>
                <b>
                  Our current lead time is {weeksLabel(p.leadTime.weeks)} weeks, and it begins when the last item below
                  is approved
                </b>{' '}
                — not from the order date. Approvals release this project to the production schedule.
              </p>
              <div className="clock">
                Everything approved today → estimated completion week of <b>{calendarDate(p.leadTime.completionDate)}</b>
                .
              </div>
            </div>
          </div>
        )}

        {p.subs.map((s) => (
          <SubCard key={s.id} sub={s} actions={actions} signer={signer} setSigner={setSigner} stamp={stamp} />
        ))}

        <Questions p={p} actions={actions} signer={signer} setSigner={setSigner} stamp={stamp} />

        {/* ACTIVITY */}
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <h2>Activity — everything, time-stamped</h2>
          </div>
          <div className="tl">
            {p.activity.length === 0 && <div className="empty">Nothing yet.</div>}
            {p.activity.map((a) => (
              <div className="tl-row" key={a.key}>
                <div className="tl-ts">{stamp(a.at)}</div>
                <div>
                  <span className="who">{a.who}</span> {a.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="foot">
          Fabricated by <b>{p.orgName}</b> · This page is live — bookmark it; it updates as the project moves.
        </div>
      </div>
    </div>
  )
}

// ── Contacts ────────────────────────────────────────────────────────────────

function ContactsCard({ p, actions }: { p: PreapprovalPortal; actions: PortalActions }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const initial = () => ({
    poc_name: p.you.pocName || '',
    poc_email: p.you.pocEmail || '',
    poc_phone: p.you.pocPhone || '',
    delivery_address: p.you.jobsite || '',
    client_deadline: p.you.deadline || '',
  })
  const [v, setV] = useState(initial)
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value })
  // The job's other contacts (GC, designer…). `id` is absent on a row the
  // client is adding. They can add and correct here; removing is the shop's.
  type Row = { id?: string; category: string; name: string; phone: string; email: string }
  const initialRows = (): Row[] =>
    p.you.contacts.map((c) => ({ id: c.id, category: c.category, name: c.name, phone: c.phone || '', email: c.email || '' }))
  const [rows, setRows] = useState<Row[]>(initialRows)
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save() {
    setBusy(true)
    setErr(null)
    const e = await actions.saveContact(v, rows)
    setBusy(false)
    if (e) return setErr(e)
    setEditing(false)
  }

  const t = p.team
  return (
    <div className="card" data-testid="portal-contacts">
      <div className="contacts">
        <div className="col">
          <div className="c-head">
            <span className="c-title">Your team at {p.orgName}</span>
          </div>
          <div className="c-name">
            {t.name}
            {t.title ? ` — ${t.title}` : ''}
          </div>
          {(t.email || t.phone) && (
            <div className="c-line">
              {t.email && <a href={`mailto:${t.email}`}>{t.email}</a>}
              {t.email && t.phone ? ' · ' : ''}
              {t.phone}
            </div>
          )}
          {t.shopAddress && (
            <div className="c-line" style={{ marginTop: 8 }}>
              Shop: {t.shopAddress}
            </div>
          )}
        </div>
        <div className="col">
          <div className="c-head">
            <span className="c-title">Your info</span>
            {!editing && (
              <button
                className="edit"
                onClick={() => {
                  setV(initial())
                  setRows(initialRows())
                  setErr(null)
                  setEditing(true)
                }}
              >
                Edit
              </button>
            )}
          </div>
          {!editing ? (
            <>
              <div className="c-name">
                {[p.you.pocName, p.clientName].filter(Boolean).join(' · ') || 'No contact on file yet'}
              </div>
              {(p.you.pocEmail || p.you.pocPhone) && (
                <div className="c-line">{[p.you.pocEmail, p.you.pocPhone].filter(Boolean).join(' · ')}</div>
              )}
              <div className="c-line" style={{ marginTop: 8 }}>
                Jobsite: {p.you.jobsite || <i>not on file — tap Edit to add it</i>}
              </div>
              <div className="c-line">Deadline: {p.you.deadline || <i>not on file — tap Edit to add it</i>}</div>
              {p.you.contacts.map((c) => (
                <div className="c-other" key={c.id} data-testid="portal-other-contact">
                  <div className="c-name">
                    <span className="c-tag">{c.categoryLabel}</span>
                    {c.name}
                  </div>
                  {(c.email || c.phone) && <div className="c-line">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>}
                </div>
              ))}
            </>
          ) : (
            <>
              <label className="c-lbl">Contact name</label>
              <input className="c-input" value={v.poc_name} onChange={set('poc_name')} autoFocus />
              <label className="c-lbl">Email</label>
              <input className="c-input" type="email" value={v.poc_email} onChange={set('poc_email')} />
              <label className="c-lbl">Phone</label>
              <input className="c-input" type="tel" value={v.poc_phone} onChange={set('poc_phone')} />
              <label className="c-lbl">Jobsite address</label>
              <input className="c-input" value={v.delivery_address} onChange={set('delivery_address')} />
              <label className="c-lbl">Deadline</label>
              <input
                className="c-input"
                value={v.client_deadline}
                onChange={set('client_deadline')}
                placeholder="A date, or “ASAP”"
              />
              {rows.map((r, i) => (
                <div className="c-row" key={r.id ?? `new-${i}`}>
                  <label className="c-lbl">{r.id ? 'Other contact' : 'New contact'}</label>
                  <select
                    className="c-input"
                    value={r.category}
                    aria-label="Contact type"
                    onChange={(e) => setRow(i, { category: e.target.value })}
                  >
                    {CONTACT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CONTACT_CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                  <input className="c-input" placeholder="Name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                  <input className="c-input" type="email" placeholder="Email" value={r.email} onChange={(e) => setRow(i, { email: e.target.value })} />
                  <input className="c-input" type="tel" placeholder="Phone" value={r.phone} onChange={(e) => setRow(i, { phone: e.target.value })} />
                </div>
              ))}
              {rows.length < MAX_HANDOFF_CONTACTS && (
                <button
                  className="edit"
                  style={{ marginTop: 10, padding: 0 }}
                  onClick={() => setRows([...rows, { category: 'gc', name: '', phone: '', email: '' }])}
                >
                  + Add another contact (GC, designer…)
                </button>
              )}
              {err && <div className="err">{err}</div>}
              <div className="c-save">
                <button className="btn blue" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button className="btn" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <div className="c-line" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--faint)' }}>
            Edits are time-stamped and we’re notified.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Subprojects ─────────────────────────────────────────────────────────────

interface Shared {
  actions: PortalActions
  signer: string
  setSigner: (s: string) => void
  stamp: (iso: string | null | undefined) => string
}

function SubCard({ sub, ...shared }: { sub: PortalSubView } & Shared) {
  // Every subproject starts collapsed (Andrew, 2026-11-24): the page opens as
  // a short list of headers with their "N of M approved" counts.
  const [open, setOpen] = useState(false)
  return (
    <div className={`sub ${open ? 'open' : 'closed'}`} data-testid={`portal-sub-${sub.id}`}>
      <button className="sub-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="caret" />
        <span className="sub-title">{sub.name}</span>
        <span className={`sub-count ${sub.allApproved ? 'done' : 'part'}`}>
          {sub.allApproved ? '✓ All approved' : `${sub.approved} of ${sub.total} approved`}
        </span>
      </button>
      {open && (
        <div className="sub-body">
          {sub.groups.map((g) => (
            <div className="group" key={g.kind}>
              <div className="group-h">{g.label}</div>
              {g.items.map((it, i) => (
                <ItemRow key={it.id ?? `${g.kind}-${i}`} item={it} {...shared} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, actions, signer, setSigner, stamp }: { item: PortalItemView } & Shared) {
  const [mode, setMode] = useState<null | 'approve' | 'change'>(null)
  const [name, setName] = useState(signer)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoAsk, setPhotoAsk] = useState(false)

  function start(m: 'approve' | 'change') {
    setErr(null)
    setName(signer)
    setMode(m)
  }

  async function submit() {
    if (!item.id || !mode) return
    const n = name.trim()
    if (n.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return setErr('Type your full name.')
    if (mode === 'change' && note.trim().length < 3) return setErr('Tell us what to change.')
    setBusy(true)
    setErr(null)
    const e =
      mode === 'approve'
        ? await actions.approve(item.type, item.id, n)
        : await actions.requestChange(item.type, item.id, n, note.trim())
    setBusy(false)
    if (e) return setErr(e)
    setSigner(n)
    setMode(null)
    setNote('')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !item.id) return
    const n = (signer || name).trim()
    setBusy(true)
    setErr(null)
    const msg = await actions.addPhoto(item.id, n, file)
    setBusy(false)
    if (msg) setErr(msg)
    else setPhotoAsk(false)
  }

  const dot = item.pill === 'approved' ? 'g' : item.pill === 'waiting' ? 'a' : 'b'
  const pillText = item.pill === 'approved' ? 'Approved' : item.pill === 'waiting' ? 'Waiting on you' : 'In our court'

  return (
    <div className="item" data-testid={`portal-item-${item.type}-${item.id ?? 'none'}`}>
      <div className={`dot ${dot}`} />
      <div className="mid">
        <div className="name">{item.name}</div>
        {item.detail && <div className="meta">{item.detail}</div>}
        <div className="meta">
          {item.linkUrl && (
            <>
              <a href={item.linkUrl} target="_blank" rel="noopener noreferrer nofollow">
                {shortLinkLabel(item.linkUrl)} ↗
              </a>
              {item.statusText ? ' · ' : ''}
            </>
          )}
          {item.statusText}
          {item.statusAt && (
            <>
              {' '}
              · <span className="ts">{stamp(item.statusAt)}</span>
            </>
          )}
          {item.viewUrl && (
            <>
              {' '}
              ·{' '}
              <a href={item.viewUrl} target="_blank" rel="noopener noreferrer nofollow">
                View drawings
              </a>
            </>
          )}
        </div>
        {item.priorNotes.map((n) => (
          <div className="meta" key={n.rev} style={{ marginTop: 4, color: 'var(--faint)' }}>
            Rev {n.rev}: changes requested by {n.by}
            {n.at ? ` · ${stamp(n.at)}` : ''} — “{n.note}”
          </div>
        ))}

        {(item.photos.length > 0 || item.canAddPhoto) && (
          <>
            <div className="thumbs">
              {item.photos.map((ph) => (
                <a className="thumb" key={ph.id} href={ph.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt={ph.caption || `${item.name} photo`} loading="lazy" />
                  {ph.caption && <small>{ph.caption}</small>}
                </a>
              ))}
              {item.canAddPhoto && (
                <button
                  className="thumb add"
                  title="Add a photo"
                  aria-label={`Add a photo to ${item.name}`}
                  disabled={busy}
                  onClick={() => (signer.trim() ? fileRef.current?.click() : setPhotoAsk(true))}
                >
                  +
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            </div>
            {item.photosNote && (
              <div className="thumb-ts">
                Photos added by {item.photosNote.by} · {stamp(item.photosNote.at)}
              </div>
            )}
            {photoAsk && (
              <div className="confirm">
                <p>Add your name with the photo, so we know who sent it.</p>
                <input
                  className="c-input"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
                <div className="c-save">
                  <button
                    className="btn blue"
                    disabled={name.trim().length < 2 || busy}
                    onClick={() => {
                      setSigner(name.trim())
                      fileRef.current?.click()
                    }}
                  >
                    Choose photo
                  </button>
                  <button className="btn" onClick={() => setPhotoAsk(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {item.canAct && !mode && (
          <div className="act">
            <button className="btn primary" onClick={() => start('approve')}>
              Approve
            </button>
            <button className="btn q" onClick={() => start('change')}>
              Request a change
            </button>
          </div>
        )}

        {item.canAct && mode && (
          <div className="confirm" data-testid="portal-confirm">
            <p>
              {mode === 'approve'
                ? `Type your name to approve “${item.name}”. This is recorded with the date and time.`
                : `Tell us what to change on “${item.name}”, and type your name.`}
            </p>
            {mode === 'change' && (
              <textarea
                placeholder="What should change?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
            )}
            <input
              className="c-input"
              placeholder="Your full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={mode === 'approve'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
            <div className="c-save">
              <button className={`btn ${mode === 'approve' ? 'primary' : 'blue'}`} disabled={busy} onClick={submit}>
                {busy ? 'Saving…' : mode === 'approve' ? 'Confirm approval' : 'Send change request'}
              </button>
              <button className="btn" disabled={busy} onClick={() => setMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
      <span className={`pill ${item.pill}`}>{pillText}</span>
    </div>
  )
}

// ── Questions ───────────────────────────────────────────────────────────────

function Questions({ p, actions, signer, setSigner, stamp }: { p: PreapprovalPortal } & Shared) {
  const [name, setName] = useState(signer)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (signer) setName(signer)
  }, [signer])

  async function send() {
    const n = name.trim()
    if (n.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return setErr('Add your name so we know who’s asking.')
    if (body.trim().length < 3) return setErr('Type your question first.')
    setBusy(true)
    setErr(null)
    const e = await actions.ask(n, body.trim())
    setBusy(false)
    if (e) return setErr(e)
    setSigner(n)
    setBody('')
  }

  return (
    <div className="card" data-testid="portal-questions">
      <div className="card-pad" style={{ paddingBottom: 10 }}>
        <h2>Questions</h2>
      </div>
      <div className="qa">
        {p.questions.map((q) => (
          <div className="q-row" key={q.id}>
            <div className="q-q">{q.body}</div>
            <div className="q-meta">
              {q.authorName} · {stamp(q.askedAt)}
            </div>
            {q.answer ? (
              <div className="q-a">
                {q.answer}
                <div className="q-meta">
                  {q.answeredBy && q.answeredBy !== p.orgName ? `${q.answeredBy} · ${p.orgName}` : p.orgName}
                  {q.answeredAt ? ` · ${stamp(q.answeredAt)}` : ''}
                </div>
              </div>
            ) : (
              <div className="q-wait">Sent — we’ll answer here.</div>
            )}
          </div>
        ))}
        <div className="ask">
          <input
            className="c-input"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Your name"
          />
          <div className="ask-row">
            <textarea
              placeholder="Ask us anything about this project…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Your question"
            />
            <button className="btn blue" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={send}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    </div>
  )
}

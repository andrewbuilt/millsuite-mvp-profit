'use client'

// ============================================================================
// MyReviews — the employee's own reviews, action items and notes on /me (125)
// ============================================================================
// The no-blindside half of November item 4: everything a manager logs about
// you on /team is shown to you here — notes AND offenses, plainly. RLS already
// limits the read to your own rows (125); this filters by your roster id too
// so a manager viewing /me doesn't see the whole shop's.
//
// An upcoming review shows as "Review coming up {date}"; a review's write-up
// shows once it's held. Renders nothing when there's nothing (day-one rule).
// ============================================================================

import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import {
  listNotes,
  listReviews,
  nextReviewDate,
  todayISO,
  type EmployeeNote,
  type EmployeeReview,
} from '@/lib/employee-reviews'

const fmtDate = (iso: string | null) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MyReviews({ orgId, memberId }: { orgId: string; memberId: string }) {
  const [reviews, setReviews] = useState<EmployeeReview[]>([])
  const [notes, setNotes] = useState<EmployeeNote[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listReviews(orgId, memberId), listNotes(orgId, memberId)])
      .then(([r, n]) => {
        if (cancelled) return
        setReviews(r)
        setNotes(n)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, memberId])

  const upcoming = nextReviewDate(reviews, todayISO())
  const held = reviews.filter((r) => r.held_at).sort((a, b) => (b.held_at || '').localeCompare(a.held_at || ''))
  if (!upcoming && held.length === 0 && notes.length === 0) return null

  return (
    <section className="mb-3 bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      {upcoming && (
        <div className="px-4 py-2.5 bg-[#EFF6FF] border-b border-[#BFDBFE] text-[12.5px] text-[#1E3A8A] flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[#2563EB]" />
          Review coming up {fmtDate(upcoming)}
        </div>
      )}
      {(held.length > 0 || notes.length > 0) && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left"
          >
            <span className="text-[12.5px] font-semibold text-[#111]">My reviews &amp; notes</span>
            <span className="text-[11px] text-[#9CA3AF]">
              {held.length} review{held.length === 1 ? '' : 's'} · {notes.length} note{notes.length === 1 ? '' : 's'}
              {open ? ' · hide' : ' · show'}
            </span>
          </button>
          {open && (
            <div className="border-t border-[#F3F4F6] divide-y divide-[#F3F4F6]">
              {held.map((r) => (
                <div key={r.id} className="px-4 py-2.5 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[#059669]">Review · {fmtDate(r.held_at)}</div>
                  {r.strengths && <Block label="Doing well" text={r.strengths} />}
                  {r.improvements && <Block label="Needs improvement" text={r.improvements} />}
                  {r.action_items && <Block label="Action items" text={r.action_items} />}
                </div>
              ))}
              {notes.map((n) => (
                <div key={n.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ' +
                        (n.kind === 'offense' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F3F4F6] text-[#6B7280]')
                      }
                    >
                      {n.kind}
                    </span>
                    <span className="text-[10.5px] text-[#9CA3AF]">{fmtDate(n.note_date)}</span>
                  </div>
                  <div className="text-[12.5px] text-[#111] mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{n.body}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10.5px] text-[#9CA3AF]">{label}</div>
      <div className="text-[12.5px] text-[#111] whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
    </div>
  )
}

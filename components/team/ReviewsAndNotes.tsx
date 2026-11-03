'use client'

// ============================================================================
// ReviewsAndNotes — the /team expanded card's reviews + notes/offense log (125)
// ============================================================================
// Managers schedule a review, write it up (doing well / needs improvement /
// action items, then mark it held), and log dated notes and offenses.
//
// ⛔ Everything here is visible to the employee on /me — the no-blindside rule
// is enforced in RLS, and this card SAYS so, so nobody writes something here
// believing it's private. Loads only when a card is expanded.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  addNote,
  deleteNote,
  deleteReview,
  fireDueReviewTasks,
  listNotes,
  listReviews,
  scheduleReview,
  todayISO,
  updateReview,
  type EmployeeNote,
  type EmployeeReview,
  type NoteKind,
} from '@/lib/employee-reviews'

const fmtDate = (iso: string | null) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const input =
  'px-2.5 py-1.5 text-[12.5px] rounded-lg border border-[#E5E7EB] bg-white focus:outline-none focus:border-[#2563EB]'

export default function ReviewsAndNotes({
  orgId,
  memberId,
  memberName,
  authorId,
}: {
  orgId: string
  memberId: string
  memberName: string
  authorId: string | null
}) {
  const [reviews, setReviews] = useState<EmployeeReview[]>([])
  const [notes, setNotes] = useState<EmployeeNote[]>([])
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [schedDate, setSchedDate] = useState('')
  const [openReview, setOpenReview] = useState<string | null>(null)
  const [noteKind, setNoteKind] = useState<NoteKind>('note')
  const [noteDate, setNoteDate] = useState(todayISO())
  const [noteBody, setNoteBody] = useState('')
  const [busy, setBusy] = useState(false)
  const first = memberName.split(' ')[0] || 'They'

  const reload = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([listReviews(orgId, memberId), listNotes(orgId, memberId)])
      setReviews(r)
      setNotes(n)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load reviews.')
    } finally {
      setLoaded(true)
    }
  }, [orgId, memberId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t save.')
    } finally {
      setBusy(false)
    }
  }

  if (!authorId) return null

  return (
    <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Reviews &amp; notes</span>
        <span className="text-[10.5px] text-[#9CA3AF]">{first} sees all of this on their My work page</span>
      </div>
      {err && (
        <div className="mb-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">{err}</div>
      )}

      {/* Schedule */}
      <div className="flex items-center gap-2 flex-wrap">
        <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className={input} />
        <button
          disabled={!schedDate || busy}
          onClick={() =>
            void run(async () => {
              await scheduleReview({ orgId, memberId, date: schedDate, authorId })
              setSchedDate('')
              // A review inside the lead window gets its Today task now.
              await fireDueReviewTasks(orgId)
            })
          }
          className="px-2.5 py-1.5 text-[12px] font-semibold rounded-lg bg-[#111] text-white hover:bg-[#333] disabled:opacity-40"
        >
          Schedule review
        </button>
      </div>

      {/* Reviews */}
      {loaded && reviews.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {reviews.map((r) => (
            <ReviewRow
              key={r.id}
              review={r}
              open={openReview === r.id}
              onToggle={() => setOpenReview((cur) => (cur === r.id ? null : r.id))}
              busy={busy}
              onSave={(patch) => run(() => updateReview(r.id, patch))}
              onDelete={() => run(() => deleteReview(r.id))}
            />
          ))}
        </div>
      )}

      {/* Notes + offenses */}
      <div className="mt-3 rounded-lg border border-[#F3F4F6] p-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden text-[11.5px]">
            {(['note', 'offense'] as NoteKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setNoteKind(k)}
                className={
                  'px-2.5 py-1 ' +
                  (noteKind === k
                    ? k === 'offense'
                      ? 'bg-[#FEF2F2] text-[#B91C1C] font-semibold'
                      : 'bg-[#F3F4F6] text-[#111] font-semibold'
                    : 'bg-white text-[#6B7280]')
                }
              >
                {k === 'note' ? 'Note' : 'Offense'}
              </button>
            ))}
          </div>
          <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} className={input} />
        </div>
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={2}
          placeholder={noteKind === 'offense' ? 'What happened — written the way you’d say it to them' : 'A note for the record'}
          className={input + ' w-full mt-2 resize-y'}
        />
        <div className="flex justify-end mt-1.5">
          <button
            disabled={!noteBody.trim() || !noteDate || busy}
            onClick={() =>
              void run(async () => {
                await addNote({ orgId, memberId, kind: noteKind, date: noteDate, body: noteBody, authorId })
                setNoteBody('')
              })
            }
            className="px-2.5 py-1 text-[11.5px] font-semibold rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] disabled:opacity-40"
          >
            Log {noteKind === 'offense' ? 'offense' : 'note'}
          </button>
        </div>
        {notes.length > 0 && (
          <div className="mt-2 divide-y divide-[#F3F4F6]">
            {notes.map((n) => (
              <div key={n.id} className="py-1.5 flex items-start gap-2 group">
                <span
                  className={
                    'mt-0.5 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ' +
                    (n.kind === 'offense' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F3F4F6] text-[#6B7280]')
                  }
                >
                  {n.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] text-[#9CA3AF]">{fmtDate(n.note_date)}</div>
                  <div className="text-[12.5px] text-[#111] whitespace-pre-wrap [overflow-wrap:anywhere]">{n.body}</div>
                </div>
                <button
                  onClick={() => void run(() => deleteNote(n.id))}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-100 text-[#9CA3AF] hover:text-[#B91C1C]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewRow({
  review,
  open,
  onToggle,
  busy,
  onSave,
  onDelete,
}: {
  review: EmployeeReview
  open: boolean
  onToggle: () => void
  busy: boolean
  onSave: (patch: Partial<EmployeeReview>) => Promise<unknown>
  onDelete: () => Promise<unknown>
}) {
  const [strengths, setStrengths] = useState(review.strengths || '')
  const [improvements, setImprovements] = useState(review.improvements || '')
  const [actions, setActions] = useState(review.action_items || '')
  const [held, setHeld] = useState(review.held_at || '')
  useEffect(() => {
    setStrengths(review.strengths || '')
    setImprovements(review.improvements || '')
    setActions(review.action_items || '')
    setHeld(review.held_at || '')
  }, [review])

  const status = review.held_at ? `Held ${fmtDate(review.held_at)}` : `Scheduled ${fmtDate(review.scheduled_at)}`
  return (
    <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-[#F9FAFB]">
        <span className="text-[12.5px] text-[#111]">
          Review · <span className={review.held_at ? 'text-[#059669]' : 'text-[#B45309]'}>{status}</span>
        </span>
        <span className="text-[11px] text-[#9CA3AF]">{open ? 'Close' : review.held_at ? 'View' : 'Write up'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-[#F3F4F6] pt-2">
          {[
            ['Doing well', strengths, setStrengths],
            ['Needs improvement', improvements, setImprovements],
            ['Action items', actions, setActions],
          ].map(([label, val, set]) => (
            <label key={label as string} className="block">
              <span className="block text-[11px] text-[#6B7280] mb-0.5">{label as string}</span>
              <textarea
                value={val as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
                rows={2}
                className={input + ' w-full resize-y'}
              />
            </label>
          ))}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
              Held on
              <input type="date" value={held} onChange={(e) => setHeld(e.target.value)} className={input} />
            </label>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void onDelete()}
                disabled={busy}
                className="px-2 py-1 text-[11px] text-[#9CA3AF] hover:text-[#B91C1C] disabled:opacity-40"
              >
                Delete
              </button>
              <button
                onClick={() =>
                  void onSave({
                    strengths: strengths.trim() || null,
                    improvements: improvements.trim() || null,
                    action_items: actions.trim() || null,
                    held_at: held || null,
                  })
                }
                disabled={busy}
                className="px-2.5 py-1 text-[11.5px] font-semibold rounded-lg bg-[#111] text-white hover:bg-[#333] disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

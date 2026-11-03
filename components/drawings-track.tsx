// ============================================================================
// drawings-track.tsx — drawing approvals as a REV COUNTER (Nov batch 2 #6)
// ============================================================================
// ⛔ REPLACED THE UPLOAD-REVISION FLOW. Andrew's screenshot: overlapping
// pills ("Mark approved manually" / "Upload revision" ran into each other in
// the narrow pre-pro column) and a forced Drive link per revision. Now:
//
//   [Submit Rev N]  [Accepted]
//   Rev 2 · submitted Nov 3 · + link
//   Rev 1 · submitted Oct 28 · drive.google.com/…
//
//   · Submit Rev N — logs the round, timestamped, state in_review (it's with
//     the client). The button then reads Submit Rev N+1. Submitting after an
//     acceptance supersedes it: the gate waits again until the new rev is
//     accepted (confirmed first, because it un-greens the gate).
//   · Accepted — approves the latest rev (no rev yet → logs an accepted one
//     with no submission, the old "approved manually" row). THE GATE IS
//     UNCHANGED: latest.state === 'approved' (isDrawingsGateGreen + 002's view).
//   · A link is optional on every rev, addable after the fact. Never required.
//
// Legacy rows (an uploaded rev still 'pending', i.e. never sent) render in the
// same log as "logged". Superseded revs are just older lines in the log.
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, Send, Undo2 } from 'lucide-react'
import {
  DrawingRevision,
  approveRevision,
  isDrawingsGateGreen,
  loadDrawingRevisions,
  markDrawingsApprovedManually,
  setRevisionLink,
  submitNextRevision,
  unacceptRevision,
} from '@/lib/drawings'
import { useConfirm } from '@/components/confirm-dialog'
import { announce } from '@/lib/tour-events'

interface Props {
  subprojectId: string
  /** Optional, set as uploaded_by_user_id on new revision rows. */
  actorUserId?: string
  /** Called after every successful change. Lets the parent refetch the
   *  scheduling-gate view so the project header updates immediately. */
  onChange?: () => void
  /** data-tour hook for the Accepted button. Passed by the pre-prod page for
   *  its first subproject only, so the value stays unique. */
  tourTag?: string
  /** The pre-production card already prints a DRAWINGS column head; drop
   *  this component's own "Drawings" word (the status stays). */
  hideHeader?: boolean
}

export default function DrawingsTrack({ subprojectId, actorUserId, onChange, tourTag, hideHeader }: Props) {
  const { confirm, alert } = useConfirm()
  const [revs, setRevs] = useState<DrawingRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState('')

  const reload = useCallback(async () => {
    const next = await loadDrawingRevisions(subprojectId)
    setRevs(next)
    setLoading(false)
  }, [subprojectId])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(fn: () => Promise<unknown>, failTitle: string, after?: () => void) {
    if (busy) return
    setBusy(true)
    try {
      const result = await fn()
      if (result === null) throw new Error('no row')
      await reload()
      onChange?.()
      after?.()
    } catch (err) {
      console.error(err)
      await alert({
        title: failTitle,
        message: 'Something went wrong saving that. Open the browser console for the full error and try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading drawings…</div>
  }

  const latest = revs.find((r) => r.is_latest)
  const accepted = isDrawingsGateGreen(revs)
  const nextN = (revs[0]?.revision_number ?? 0) + 1

  async function submitNext() {
    if (accepted && latest) {
      const ok = await confirm({
        title: `Submit Rev ${nextN}?`,
        message: `Rev ${latest.revision_number} is accepted. Logging Rev ${nextN} means the client has new drawings to look at — this subproject waits on drawings again until you mark Rev ${nextN} accepted.`,
        confirmLabel: `Submit Rev ${nextN}`,
      })
      if (!ok) return
    }
    await run(
      () => submitNextRevision(subprojectId, { uploaded_by_user_id: actorUserId }),
      'Couldn’t log the revision',
    )
  }

  async function accept() {
    await run(
      () =>
        latest
          ? approveRevision(latest.id)
          : markDrawingsApprovedManually(subprojectId, {
              uploaded_by_user_id: actorUserId,
              notes: 'Accepted with no revision logged',
            }),
      'Couldn’t mark drawings accepted',
      // After the approval actually lands — the sell-it guide waits on this.
      () => announce('ms:drawings-approved'),
    )
  }

  async function saveLink(revId: string) {
    const url = linkDraft.trim()
    await run(() => setRevisionLink(revId, url || null), 'Couldn’t save the link', () => {
      setLinkFor(null)
      setLinkDraft('')
    })
  }

  const status = accepted
    ? `Accepted ${fmtDate(latest?.responded_at || latest?.updated_at || null)}`
    : latest
      ? latest.state === 'in_review'
        ? `Rev ${latest.revision_number} with the client`
        : `Rev ${latest.revision_number} logged, not sent`
      : 'Nothing submitted yet'

  return (
    <div className="space-y-2">
      <div className="text-[12px] text-neutral-600">
        {!hideHeader && <span className="font-medium text-neutral-700 mr-1.5">Drawings</span>}
        <span className={accepted ? 'text-emerald-700 font-medium' : ''}>{status}</span>
      </div>

      {/* One wrapping row — the old pills overlapped in the narrow column. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => void submitNext()}
          disabled={busy}
          className="text-xs whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          <Send className="w-3 h-3" />
          Submit Rev {nextN}
        </button>
        {accepted ? (
          <span className="text-xs whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" />
            Accepted
            <button
              onClick={() => latest && void run(() => unacceptRevision(latest.id), 'Couldn’t undo')}
              disabled={busy}
              title="Undo — back to waiting on the client"
              className="ml-1 text-emerald-600 hover:text-emerald-900"
            >
              <Undo2 className="w-3 h-3" />
            </button>
          </span>
        ) : (
          <button
            onClick={() => void accept()}
            disabled={busy}
            data-tour={tourTag}
            title={
              latest
                ? `Client accepted Rev ${latest.revision_number}`
                : 'Client accepted drawings that live outside MillSuite'
            }
            className="text-xs whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3 h-3" />
            Accepted
          </button>
        )}
      </div>

      {/* The log — newest first. */}
      {revs.length > 0 && (
        <div className="space-y-0.5">
          {revs.map((r) => (
            <div key={r.id} className="text-[11px] text-neutral-500 leading-snug">
              <div className="flex flex-wrap items-center gap-x-1.5">
                <span className={`font-medium ${r.is_latest ? 'text-neutral-800' : ''}`}>Rev {r.revision_number}</span>
                <span>·</span>
                <span>
                  {r.submitted_at && r.state !== 'pending'
                    ? `submitted ${fmtDate(r.submitted_at)}`
                    : r.submitted_at
                      ? `logged ${fmtDate(r.submitted_at)}`
                      : `logged ${fmtDate(r.created_at)}`}
                </span>
                {r.state === 'approved' && (
                  <span className="text-emerald-700">· accepted {fmtDate(r.responded_at)}</span>
                )}
                {linkFor !== r.id &&
                  (r.file_url ? (
                    <a
                      href={r.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800 max-w-[180px] truncate"
                      title={r.file_url}
                    >
                      · <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{shortUrl(r.file_url)}</span>
                    </a>
                  ) : (
                    <button
                      onClick={() => {
                        setLinkFor(r.id)
                        setLinkDraft('')
                      }}
                      className="inline-flex items-center gap-0.5 text-neutral-400 hover:text-blue-600"
                    >
                      · <Link2 className="w-2.5 h-2.5" /> link
                    </button>
                  ))}
              </div>
              {r.notes && <div className="text-neutral-400">{r.notes}</div>}
              {linkFor === r.id && (
                <div className="flex items-center gap-1 mt-0.5">
                  <input
                    autoFocus
                    type="url"
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveLink(r.id)
                      if (e.key === 'Escape') setLinkFor(null)
                    }}
                    placeholder="Paste a link (optional)"
                    className="flex-1 min-w-0 border border-neutral-300 rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => void saveLink(r.id)}
                    disabled={busy}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-900 text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button onClick={() => setLinkFor(null)} className="text-[11px] px-1 text-neutral-500">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? '/…' : '')
  } catch {
    return url
  }
}

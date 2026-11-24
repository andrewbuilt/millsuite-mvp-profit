'use client'

// ============================================================================
// PortalAdminCard — the shop's side of the client approval portal (135)
// ============================================================================
// One card on the pre-production page, four jobs:
//
//   1. THE LINK — "Create portal link" / "Copy link" / "Reissue". The link is
//      the client's key; reissuing kills every link already sent, so it asks.
//   2. LEAD TIME — weeks, typed per project, shown to the client. Empty hides
//      the portal's lead-time callout.
//   3. PORTAL UPDATES TO SEND — the notify-first queue. ⛔ NOTHING AUTO-SENDS
//      (no SMTP is connected in v1). Changes since the last send collect here;
//      one click opens a prefilled email to the POC and stamps the queue
//      cleared. A human always presses send in their own mail app.
//   4. QUESTIONS — what the client asked in the portal. Answering here is what
//      puts the answer, time-stamped, in front of them; each question also made
//      a "PM Communication" task, which can be closed from the thread.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Copy, ExternalLink, Mail, RefreshCw } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'
import { setTaskDone } from '@/lib/tasks'
import { mailtoHref } from '@/lib/preapproval-view'
import {
  answerPortalQuestion,
  listPortalQuestions,
  loadLeadTimeWeeks,
  loadPortalAdminState,
  parseLeadTimeWeeks,
  portalAdminAction,
  saveLeadTimeWeeks,
  unansweredCount,
  type PortalAdminState,
  type PortalQuestionRow,
} from '@/lib/preapproval-admin'

function stamp(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function PortalAdminCard({
  projectId,
  orgId,
  userId,
  refreshKey,
}: {
  projectId: string
  orgId?: string | null
  userId?: string | null
  /** Bumped by the page whenever approvals / drawings / handoff change, so the
   *  queue re-reads without its own polling. */
  refreshKey?: number
}) {
  const { confirm } = useConfirm()
  const [state, setState] = useState<PortalAdminState | null>(null)
  const [questions, setQuestions] = useState<PortalQuestionRow[]>([])
  const [lead, setLead] = useState('')
  const [leadSaved, setLeadSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [s, q, w] = await Promise.all([
      loadPortalAdminState(projectId),
      listPortalQuestions(projectId),
      loadLeadTimeWeeks(projectId),
    ])
    setState(s)
    setQuestions(q)
    setLead(w === null ? '' : String(w))
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  async function act(action: 'link' | 'reissue' | 'notified') {
    setBusy(true)
    setErr(null)
    try {
      setState(await portalAdminAction(projectId, action))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function reissue() {
    const ok = await confirm({
      title: 'Reissue the portal link?',
      message:
        'This makes a new link and the old one stops working immediately — anyone you already sent it to will need the new one.',
      confirmLabel: 'Reissue link',
      variant: 'danger',
    })
    if (ok) await act('reissue')
  }

  async function copy() {
    if (!state?.link) return
    try {
      await navigator.clipboard.writeText(state.link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setErr('Could not copy — select the link and copy it by hand.')
    }
  }

  async function commitLead() {
    const parsed = parseLeadTimeWeeks(lead)
    if (!parsed.ok) return setErr('Lead time is a number of weeks, like 8.')
    setErr(null)
    setLeadSaved('saving')
    try {
      await saveLeadTimeWeeks(projectId, parsed.weeks)
      setLeadSaved('saved')
      setTimeout(() => setLeadSaved('idle'), 1500)
    } catch (e) {
      setLeadSaved('idle')
      setErr(e instanceof Error ? e.message : 'Could not save the lead time.')
    }
  }

  const unanswered = unansweredCount(questions)
  const queue = state?.queue ?? []

  return (
    <section
      id="client-portal"
      data-portal-admin
      className="bg-white border border-[#E5E7EB] rounded-2xl mb-4 overflow-hidden scroll-mt-24"
    >
      <div className="flex items-center justify-between gap-4 px-[18px] py-3.5 border-b border-[#F3F4F6]">
        <div>
          <div className="text-[15px] font-semibold text-[#111]">Client approval portal</div>
          <div className="text-[12px] text-[#9CA3AF] mt-px">
            One link, no login. The client approves, asks questions and keeps their info current.
          </div>
        </div>
        {unanswered > 0 && (
          <span
            data-unanswered-badge
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]"
          >
            {unanswered} question{unanswered === 1 ? '' : 's'} to answer
          </span>
        )}
      </div>

      {/* 1 · the link  +  2 · lead time */}
      <div className="px-[18px] py-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 items-end border-b border-[#F3F4F6]">
        <div className="min-w-0">
          <div className="text-[11px] text-[#6B7280] mb-1">Portal link</div>
          {state?.link ? (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-[12px] text-[#374151] bg-[#F3F4F6] rounded-lg px-2.5 py-1.5 truncate max-w-full">
                {state.link.url}
              </code>
              <button
                onClick={copy}
                className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
              >
                <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy link'}
              </button>
              <a
                href={state.link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[#2563EB] hover:bg-[#EFF6FF]"
              >
                <ExternalLink className="w-3 h-3" /> Open
              </a>
              <button
                onClick={reissue}
                disabled={busy}
                className="text-xs inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[#6B7280] hover:text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-40"
              >
                <RefreshCw className="w-3 h-3" /> Reissue
              </button>
            </div>
          ) : (
            <button
              onClick={() => void act('link')}
              disabled={busy || !state}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-40"
            >
              Create portal link
            </button>
          )}
          {state?.link?.issuedAt && (
            <div className="text-[11px] text-[#9CA3AF] mt-1">Created {stamp(state.link.issuedAt)}</div>
          )}
        </div>
        <label className="block">
          <span className="flex items-center justify-between text-[11px] text-[#6B7280] mb-1 gap-3">
            <span>Lead time (weeks) — shown to the client</span>
            <span className="text-[10.5px] text-[#9CA3AF]">
              {leadSaved === 'saving' ? 'Saving…' : leadSaved === 'saved' ? 'Saved' : ''}
            </span>
          </span>
          <input
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            onBlur={() => void commitLead()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            inputMode="decimal"
            placeholder="Empty hides it"
            data-lead-time
            className="w-[150px] px-2.5 py-1.5 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#111] placeholder:text-[#C4C8CE] focus:outline-none focus:border-[#2563EB]"
          />
        </label>
      </div>

      {/* 3 · notify-first queue */}
      {state?.link && (
        <div className="px-[18px] py-3 border-b border-[#F3F4F6]" data-notify-queue>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1.5">
            <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em]">
              Portal updates to send{queue.length > 0 ? ` · ${queue.length}` : ''}
            </div>
            {queue.length > 0 && state.email && (
              <a
                href={mailtoHref(state.pocEmail, state.email)}
                onClick={() => void act('notified')}
                className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111] text-white hover:bg-black"
              >
                <Mail className="w-3 h-3" /> Email {state.pocEmail || 'the client'}
              </a>
            )}
          </div>
          {queue.length === 0 ? (
            <div className="text-[12px] text-[#9CA3AF]">
              Nothing new since {state.lastNotifiedAt ? `the last update (${stamp(state.lastNotifiedAt)})` : 'the link was created'}.
            </div>
          ) : (
            <>
              <ul className="text-[12.5px] text-[#374151] space-y-1">
                {queue.map((a) => (
                  <li key={a.key} className="flex gap-2">
                    <span className="text-[#9CA3AF] shrink-0 w-[112px]">{stamp(a.at)}</span>
                    <span>
                      <span className="font-medium text-[#111]">{a.who}</span> {a.text}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="text-[11px] text-[#9CA3AF] mt-1.5">
                Opens your email with the summary and the link — nothing sends on its own.
                {!state.pocEmail && ' No contact email on the handoff yet, so the To line will be empty.'}
              </div>
            </>
          )}
        </div>
      )}

      {/* 4 · questions */}
      <div className="px-[18px] py-3" data-portal-questions>
        <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em] mb-1.5">
          Client questions
        </div>
        {questions.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF]">None yet. Questions asked in the portal show up here.</div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionRow
                key={q.id}
                q={q}
                onAnswer={async (text) => {
                  await answerPortalQuestion(q.id, text, userId ?? null)
                  await reload()
                }}
                onCloseTask={async () => {
                  if (!q.task_id) return
                  await setTaskDone(q.task_id, true, orgId ?? undefined, userId ?? null)
                  await reload()
                }}
              />
            ))}
          </div>
        )}
        {err && <div className="text-[12px] text-[#B91C1C] mt-2">{err}</div>}
      </div>
    </section>
  )
}

function QuestionRow({
  q,
  onAnswer,
  onCloseTask,
}: {
  q: PortalQuestionRow
  onAnswer: (text: string) => Promise<void>
  onCloseTask: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="text-[13px]">
      <div className="text-[#111] whitespace-pre-wrap break-words">{q.body}</div>
      <div className="text-[11px] text-[#9CA3AF] mt-0.5">
        {q.author_name} · {stamp(q.created_at)}
      </div>
      {q.answer ? (
        <div className="mt-1.5 ml-3 px-3 py-2 rounded-lg bg-[#F9FAFB] text-[#374151] whitespace-pre-wrap break-words">
          {q.answer}
          <div className="text-[11px] text-[#9CA3AF] mt-0.5">Answered {stamp(q.answered_at)} · on the portal</div>
        </div>
      ) : (
        <div className="mt-1.5 ml-3 flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Answer — the client sees this on the portal, time-stamped"
            rows={2}
            className="flex-1 px-2.5 py-1.5 text-[13px] rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#2563EB] resize-y"
          />
          <button
            disabled={busy || !draft.trim()}
            onClick={() => void run(() => onAnswer(draft))}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Answer'}
          </button>
        </div>
      )}
      {q.taskOpen && (
        <button
          disabled={busy}
          onClick={() => void run(onCloseTask)}
          className="mt-1.5 ml-3 text-[11px] text-[#2563EB] hover:underline disabled:opacity-40"
        >
          Close the “Portal question” task
        </button>
      )}
      {err && <div className="text-[11px] text-[#B91C1C] mt-1 ml-3">{err}</div>}
    </div>
  )
}

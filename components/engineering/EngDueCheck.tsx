'use client'

// ============================================================================
// components/engineering/EngDueCheck.tsx — the end-of-day engineering check
// ============================================================================
// Mounted once in the app layout, for every signed-in person. It asks the
// server (/api/engineering/due-check) what THIS person must answer; for
// anyone who isn't an engineer with a job due today / overdue, that's nothing
// and it renders nothing. Otherwise a prompt they can't dismiss:
//   "Is engineering done on <job>?"  →  Yes, it's done  |  Not yet
//   Not yet → when will it be ready + what's holding it up → the PM is told.
// It re-checks every 5 minutes, so it appears at 3:30 PM on its own.
// Once per day per browser it also runs the sweep that turns yesterday's
// unanswered checks into a Critical task for the PM.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { fmtDueDay, nextWorkday, validNotYet } from '@/lib/eng-due-check'

export interface DueJob {
  projectId: string
  name: string
  due: string
  overdue: boolean
}

export interface DueAnswerInput {
  answer: 'done' | 'not_yet'
  newDate?: string
  reason?: string
}

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/engineering/due-check', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`)
  return json as T
}

const RECHECK_MS = 5 * 60 * 1000

export default function EngDueCheck() {
  const { user, org } = useAuth()
  const [jobs, setJobs] = useState<DueJob[]>([])
  const [today, setToday] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await call<{ jobs: DueJob[]; today: string }>('GET')
      setJobs(r.jobs || [])
      setToday(r.today || '')
    } catch {
      // Pre-138, signed out, or offline: say nothing, try again later.
    }
  }, [])

  useEffect(() => {
    if (!user || !org) return
    load()
    const t = setInterval(load, RECHECK_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [user, org, load])

  useEffect(() => {
    if (!user || !org) return
    const key = `millsuite:eng-sweep:${org.id}:${new Date().toDateString()}`
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    } catch { /* private mode: sweep anyway, it's idempotent */ }
    call('POST', { action: 'sweep' }).catch(() => {})
  }, [user, org])

  if (!jobs.length || !today) return null
  const job = jobs[0]
  return (
    <DueCheckPrompt
      key={job.projectId}
      job={job}
      position={1}
      count={jobs.length}
      today={today}
      onAnswer={async (a) => {
        await call('POST', { action: 'answer', projectId: job.projectId, ...a })
        setJobs((js) => js.slice(1))
        load()
      }}
    />
  )
}

/** The prompt itself — no dismiss, no close button, no backdrop click. */
export function DueCheckPrompt({ job, position, count, today, onAnswer }: {
  job: DueJob
  position: number
  count: number
  today: string
  onAnswer: (a: DueAnswerInput) => Promise<void>
}) {
  const [mode, setMode] = useState<'ask' | 'not_yet'>('ask')
  const [newDate, setNewDate] = useState(() => nextWorkday(today))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function send(a: DueAnswerInput) {
    if (a.answer === 'not_yet') {
      const bad = validNotYet(a.newDate, a.reason, today)
      if (bad) { setErr(bad); return }
    }
    setBusy(true); setErr(null)
    try { await onAnswer(a) } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t save. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(24,24,27,0.45)] p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="due-check-title"
        className="w-full max-w-[440px] rounded-2xl bg-white shadow-2xl border border-[#E4E4E7] p-6">
        <div className="text-[13px] font-medium text-[#71717A]">
          End-of-day check{count > 1 ? ` · ${position} of ${count}` : ''}
        </div>
        <h2 id="due-check-title" className="mt-1 text-[22px] font-bold leading-tight text-[#18181B]">
          {mode === 'ask' ? 'Is engineering done?' : 'When will it be ready?'}
        </h2>
        <div className="mt-4 rounded-xl bg-[#FAFAF9] border border-[#F4F4F5] px-4 py-3">
          <div className="text-[16px] font-semibold text-[#18181B]">{job.name}</div>
          <div className={`mt-1 text-[14px] font-medium ${job.overdue ? 'text-[#C2410C]' : 'text-[#52525B]'}`}>
            {job.overdue ? `Was due ${fmtDueDay(job.due)}` : 'Due today'}
          </div>
        </div>

        {mode === 'ask' ? (
          <div className="mt-5 flex flex-col gap-2">
            <button disabled={busy} onClick={() => send({ answer: 'done' })}
              className="h-12 rounded-xl bg-[#16A34A] text-white text-[15px] font-semibold hover:bg-[#15803D] disabled:opacity-50">
              {busy ? 'Saving…' : 'Yes, it’s done'}
            </button>
            <button disabled={busy} onClick={() => { setMode('not_yet'); setErr(null) }}
              className="h-12 rounded-xl border border-[#D4D4D8] bg-white text-[15px] font-semibold text-[#18181B] hover:bg-[#FAFAF9] disabled:opacity-50">
              Not yet
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <label htmlFor="due-check-date" className="block text-[13px] font-medium text-[#18181B] mb-1.5">Ready by</label>
              <input id="due-check-date" type="date" value={newDate} min={nextWorkday(today)}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full h-11 rounded-lg border border-[#D4D4D8] px-3 text-[14px]" />
            </div>
            <div>
              <label htmlFor="due-check-reason" className="block text-[13px] font-medium text-[#18181B] mb-1.5">What’s holding it up?</label>
              <textarea id="due-check-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-[#D4D4D8] px-3 py-2 text-[14px] resize-none" />
            </div>
            <div className="flex gap-2">
              <button disabled={busy || !reason.trim()} onClick={() => send({ answer: 'not_yet', newDate, reason })}
                className="flex-1 h-12 rounded-xl bg-[#18181B] text-white text-[15px] font-semibold disabled:opacity-40">
                {busy ? 'Sending…' : 'Send'}
              </button>
              <button disabled={busy} onClick={() => { setMode('ask'); setErr(null) }}
                className="h-12 px-4 rounded-xl border border-[#D4D4D8] bg-white text-[15px] font-medium text-[#18181B]">
                Back
              </button>
            </div>
            <div className="text-[13px] text-[#71717A]">The project manager sees this, and the job moves to the top of your list.</div>
          </div>
        )}
        {err && <div className="mt-3 text-[13px] text-[#B91C1C]">{err}</div>}
      </div>
    </div>
  )
}

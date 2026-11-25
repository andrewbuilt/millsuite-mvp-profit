'use client'

// /dev/eng-due-check — the end-of-day engineering check prompt on fixtures.
// Dev-only: production builds 404 it. Answers go nowhere. The first job is overdue,
// the second is due today.

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { DueCheckPrompt, type DueJob, type DueAnswerInput } from '@/components/engineering/EngDueCheck'
import { dateKey } from '@/lib/eng-board-math'

export default function EngDueCheckFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  const today = dateKey(new Date())
  const [jobs, setJobs] = useState<DueJob[]>([
    { projectId: 'p1', name: 'Ya Laford', due: '2026-11-20', overdue: true },
    { projectId: 'p2', name: 'Acme - 400 Beach - Kitchen & Ride Share', due: today, overdue: false },
  ])
  const [log, setLog] = useState<string[]>([])
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>End-of-day check fixture</h1>
      <pre>{log.join('\n') || 'No answers yet.'}</pre>
      {jobs.length > 0 && (
        <DueCheckPrompt
          key={jobs[0].projectId}
          job={jobs[0]}
          position={1}
          count={jobs.length}
          today={today}
          onAnswer={async (a: DueAnswerInput) => {
            await new Promise((r) => setTimeout(r, 200))
            setLog((l) => [...l, `${jobs[0].name}: ${JSON.stringify(a)}`])
            setJobs((js) => js.slice(1))
          }}
        />
      )}
    </div>
  )
}

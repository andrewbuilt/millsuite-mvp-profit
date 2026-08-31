'use client'

// ============================================================================
// components/portal/ApproveItem.tsx — client write #1: approve a selection
// ============================================================================
// The whole interactive surface of the "WITH YOU" card. Posts to the portal's
// own token-authenticated route; the token is re-resolved server-side, so this
// component holds no credential beyond the one already in the URL bar.
//
// On success it flips to the confirmation state locally AND calls
// router.refresh() so the rest of the page (the needs-you badge, the phase
// rail, the approvals list) re-reads from the server. Without the refresh the
// card would say "approved" while the badge above it still said "1 item for
// your review", which is exactly the kind of thing that makes a client email
// asking whether it actually went through.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eyebrow, mono, MUTED, INK } from './ui'

export function ApproveItem({
  token,
  projectId,
  itemId,
  label,
  detail,
  contactEmail,
  projectName,
}: {
  token: string
  projectId: string
  itemId: string
  label: string
  detail: string | null
  contactEmail: string | null
  projectName: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  async function approve() {
    setState('saving')
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, itemId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState('done')
      router.refresh()
    } catch {
      setState('error')
    }
  }

  const title = detail ? `${label} · ${detail}` : label

  if (state === 'done') {
    return (
      <div className="mt-4 rounded-xl border p-[18px]" style={{ background: '#F4F2EC', borderColor: '#E4E0D7' }}>
        <Eyebrow>Approved just now</Eyebrow>
        <div className="mt-[9px] text-[14.5px] font-semibold" style={{ letterSpacing: '-0.01em' }}>
          {title}
        </div>
        <div className="mt-[7px] text-[12.5px] leading-[1.55]" style={{ color: '#5C5951' }}>
          Thanks. We have it. You will see it move along here.
        </div>
      </div>
    )
  }

  return (
    <div
      className="mt-4 rounded-xl border p-[18px]"
      style={{ background: '#F6F3EC', borderColor: '#DCD6C7', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }}
    >
      <Eyebrow color="#9A7B3F">With you</Eyebrow>
      <div className="mt-[9px] text-[14.5px] font-semibold" style={{ letterSpacing: '-0.01em' }}>
        {title}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={state === 'saving'}
          className="rounded-lg px-4 py-[11px] text-[11px] font-bold uppercase disabled:opacity-60"
          style={{
            background: INK,
            color: '#F2F0EC',
            letterSpacing: '0.12em',
            boxShadow: '0 6px 14px -8px rgba(22,22,20,.8)',
          }}
        >
          {state === 'saving' ? 'Sending…' : 'Approve'}
        </button>
        {contactEmail ? (
          <a
            href={`mailto:${contactEmail}?subject=${encodeURIComponent(`Question about ${label} · ${projectName}`)}`}
            className="rounded-lg border px-4 py-[11px] text-[11px] font-bold uppercase"
            style={{ borderColor: '#CFCBC2', background: '#FCFBF8', letterSpacing: '0.12em' }}
          >
            Ask a question
          </a>
        ) : null}
      </div>
      {state === 'error' ? (
        <div className="mt-3 text-[11.5px]" style={{ ...mono, color: '#8A3B3B' }}>
          That did not go through. Please try again, or email us and we will take care of it.
        </div>
      ) : (
        <div className="mt-3 text-[11px]" style={{ ...mono, color: MUTED }}>
          Approving tells the shop to order and build to this.
        </div>
      )}
    </div>
  )
}

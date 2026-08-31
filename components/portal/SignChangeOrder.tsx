'use client'

// ============================================================================
// components/portal/SignChangeOrder.tsx — client write #2: sign a change order
// ============================================================================
// Typed-name signature, per the design: "Typing my name counts as my
// signature." Both the checkbox AND a name of real length are required before
// the button enables, and the server re-checks both — the disabled attribute is
// a courtesy, not the gate.
//
// The signed state is rendered from the SERVER's response, not from local
// state, so the stamp the client sees ("Signed Aug 31, 2026") is the stamp
// that actually went into the database rather than the browser's clock.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PortalChangeOrder } from '@/lib/client-portal'
import { Eyebrow, RowStack, Row, mono, MUTED, money } from './ui'

export function SignChangeOrder({
  token,
  projectId,
  co,
  contractTotal,
}: {
  token: string
  projectId: string
  co: PortalChangeOrder
  contractTotal: number
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [signed, setSigned] = useState<{ name: string; stamp: string } | null>(
    co.signedName && co.signedAt ? { name: co.signedName, stamp: co.signedAt } : null,
  )

  const canSign = agreed && name.trim().length > 2

  async function sign() {
    if (!canSign) return
    setState('saving')
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/sign-change-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, changeOrderId: co.id, name: name.trim() }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { signedName: string; signedAt: string }
      setSigned({ name: body.signedName, stamp: body.signedAt })
      router.refresh()
    } catch {
      setState('error')
    }
  }

  const newTotal = contractTotal > 0 ? contractTotal + co.netChange : null

  return (
    <div>
      <div
        className="flex items-baseline justify-between text-[10px] uppercase"
        style={{ ...mono, letterSpacing: '0.18em', color: MUTED }}
      >
        <span>Change order {co.number.replace(/^CO-/, '')}</span>
        {co.sentAt ? <span>Sent {formatStamp(co.sentAt, false)}</span> : null}
      </div>

      <h3 className="mt-4 text-[24px] font-extrabold uppercase leading-[1.02]" style={{ letterSpacing: '-0.03em' }}>
        {co.title}
      </h3>

      {co.description ? (
        <p className="mt-3 text-[13.5px] leading-[1.6]" style={{ color: '#3A3833', textWrap: 'pretty' }}>
          {co.description}
        </p>
      ) : null}

      {co.lines.length > 0 ? (
        <div className="mt-5">
          <RowStack>
            {co.lines.map((l, i) => (
              <Row key={i}>
                <span className="text-[11.5px]" style={{ ...mono, color: MUTED }}>
                  {l.label}
                </span>
                <span className="text-[11.5px]" style={{ ...mono }}>
                  {money(l.amount)}
                </span>
              </Row>
            ))}
          </RowStack>
        </div>
      ) : null}

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase" style={{ ...mono, letterSpacing: '0.18em', color: MUTED }}>
          {newTotal !== null ? `New contract total ${money(newTotal)}` : 'Change to your contract'}
        </span>
        <span className="text-[24px] font-extrabold" style={{ letterSpacing: '-0.03em' }}>
          {co.netChange === 0 ? 'No charge' : `${co.netChange > 0 ? '+' : '−'}${money(Math.abs(co.netChange))}`}
        </span>
      </div>

      {signed ? (
        <div className="mt-6 rounded-[14px] border p-[22px]" style={{ background: '#F4F2EC', borderColor: '#E4E0D7' }}>
          <Eyebrow>Signed</Eyebrow>
          <div className="mt-[10px] text-[24px] font-bold" style={{ letterSpacing: '-0.02em' }}>
            {signed.name}
          </div>
          <div className="mt-2 text-[11px]" style={{ ...mono, color: MUTED }}>
            {formatStamp(signed.stamp, true)}
          </div>
          <div className="mt-3 text-[13px] leading-[1.6]" style={{ color: '#3A3833' }}>
            A countersigned copy is in your documents below.
          </div>
        </div>
      ) : (
        <div
          className="mt-6 rounded-[14px] border p-[22px]"
          style={{ background: '#F6F3EC', borderColor: '#DCD6C7', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)' }}
        >
          <Eyebrow>Sign to approve</Eyebrow>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full name"
            autoComplete="name"
            className="mt-3 w-full rounded-[9px] border px-[15px] py-[14px] text-[15px] outline-none"
            style={{
              ...mono,
              background: '#FCFBF8',
              borderColor: '#D8D3C8',
              color: '#161614',
              boxShadow: 'inset 0 1px 3px rgba(22,22,20,.06)',
            }}
          />
          <label className="mt-[14px] flex cursor-pointer items-start gap-[10px] text-[11px] leading-[1.6]" style={{ ...mono, color: '#5C5951' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-[2px] h-[15px] w-[15px]"
              style={{ accentColor: '#161614' }}
            />
            <span>
              I approve this change order and the revised contract total. Typing my name counts as my signature.
            </span>
          </label>
          <button
            type="button"
            onClick={sign}
            disabled={!canSign || state === 'saving'}
            className="mt-[18px] w-full rounded-[10px] py-4 text-[12px] font-bold uppercase disabled:opacity-50"
            style={{
              background: '#161614',
              color: '#F2F0EC',
              letterSpacing: '0.14em',
              boxShadow: '0 10px 20px -12px rgba(22,22,20,.9)',
            }}
          >
            {state === 'saving' ? 'Signing…' : 'Sign change order'}
          </button>
          <div className="mt-[10px] text-center text-[10px]" style={{ ...mono, color: '#8B867D' }}>
            {state === 'error'
              ? 'That did not go through. Please try again.'
              : 'A countersigned PDF lands in your documents'}
          </div>
        </div>
      )}
    </div>
  )
}

/** Server timestamps are ISO strings; render them in the reader's own zone,
 *  which for a signature stamp is the honest thing to show. */
function formatStamp(iso: string, withTime: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (!withTime) return date
  return `Signed ${date} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

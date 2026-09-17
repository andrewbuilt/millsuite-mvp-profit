'use client'

// ============================================================================
// components/portal/DeliveryAddressCard.tsx — client write #3: delivery address
// ============================================================================
// Rendered ONLY when the project has no delivery address. The shop usually
// records one at intake; when it didn't, the client is the person who knows it,
// so the portal asks instead of the address staying blank until install week.
//
// Posts to the portal's own token-authenticated route (fill-only server-side —
// this card can never overwrite a shop-entered address). On success it flips to
// a confirmation locally AND router.refresh()es so the hero picks the address
// up as its siteLabel — same pattern as ApproveItem, for the same reason.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Eyebrow, mono, MUTED, INK } from './ui'

export function DeliveryAddressCard({ token, projectId }: { token: string; projectId: string }) {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  async function save() {
    const clean = address.trim()
    if (clean.length < 5) return
    setState('saving')
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/delivery-address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, address: clean }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState('done')
      router.refresh()
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <Card>
        <Eyebrow>Delivery address</Eyebrow>
        <div className="mt-[9px] text-[14.5px] font-semibold" style={{ letterSpacing: '-0.01em' }}>
          {address.trim()}
        </div>
        <div className="mt-[7px] text-[12.5px] leading-[1.55]" style={{ color: '#5C5951' }}>
          Thanks. The shop has it.
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <Eyebrow color="#9A7B3F">Delivery address needed</Eyebrow>
      <div className="mt-[9px] text-[13.5px] leading-[1.55]" style={{ color: '#3A3833' }}>
        We don&apos;t have a delivery address for this project yet. Where should the finished
        work go?
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="mt-4 flex flex-col gap-2"
      >
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
          placeholder="Street, city, state zip"
          className="w-full rounded-lg border px-3 py-[11px] text-[13.5px]"
          style={{ borderColor: '#CFCBC2', background: '#FCFBF8' }}
        />
        <button
          type="submit"
          disabled={state === 'saving' || address.trim().length < 5}
          className="self-start rounded-lg px-4 py-[11px] text-[11px] font-bold uppercase disabled:opacity-60"
          style={{
            background: INK,
            color: '#F2F0EC',
            letterSpacing: '0.12em',
            boxShadow: '0 6px 14px -8px rgba(22,22,20,.8)',
          }}
        >
          {state === 'saving' ? 'Sending…' : 'Send to the shop'}
        </button>
      </form>
      {state === 'error' ? (
        <div className="mt-3 text-[11.5px]" style={{ ...mono, color: '#8A3B3B' }}>
          That did not go through. Please try again, or email us and we will take care of it.
        </div>
      ) : (
        <div className="mt-3 text-[11px]" style={{ ...mono, color: MUTED }}>
          This goes straight onto your project for the shop and installers.
        </div>
      )}
    </Card>
  )
}

'use client'

// ============================================================================
// PreapprovalPortalLive — the real portal: token routes + a server refresh
// ============================================================================
// The page is a Server Component that loads the payload on the service role;
// this wires the view's writes to POST /api/p/{token}/… and then asks Next to
// re-render the page, so what the client sees after a click is what the
// database says — never an optimistic guess about an approval.
// ============================================================================

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { PreapprovalPortal } from '@/lib/preapproval-view'
import { PreapprovalPortalView, type PortalActions } from './PreapprovalPortalView'

export function PreapprovalPortalLive({ token, p }: { token: string; p: PreapprovalPortal }) {
  const router = useRouter()
  const actions = useMemo<PortalActions>(() => {
    const base = `/api/p/${encodeURIComponent(token)}`
    async function send(path: string, init: RequestInit): Promise<string | null> {
      try {
        const res = await fetch(`${base}/${path}`, { method: 'POST', ...init })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          return body?.error || 'Something went wrong — please try again.'
        }
        router.refresh()
        return null
      } catch {
        return 'Could not reach the server — check your connection and try again.'
      }
    }
    const json = (body: unknown): RequestInit => ({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return {
      approve: (type, id, name) => send('approve', json({ type, id, name })),
      requestChange: (type, id, name, note) => send('request-change', json({ type, id, name, note })),
      ask: (name, body) => send('question', json({ name, body })),
      saveContact: (fields) => send('contact', json({ fields })),
      addPhoto: (itemId, name, file) => {
        const form = new FormData()
        form.append('itemId', itemId)
        form.append('name', name)
        form.append('file', file)
        return send('photo', { body: form })
      },
    }
  }, [token, router])

  return <PreapprovalPortalView p={p} actions={actions} />
}

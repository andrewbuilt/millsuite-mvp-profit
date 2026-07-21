// ============================================================================
// lib/change-order-pdf.ts — client wrapper around /api/change-orders/[id]/pdf
// ============================================================================

import { supabase } from './supabase'

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return `Bearer ${token}`
}

/** Generate (or refresh) the CO PDF; returns its public URL. */
export async function generateChangeOrderPdf(coId: string): Promise<string> {
  const res = await fetch(`/api/change-orders/${coId}/pdf`, {
    method: 'POST',
    headers: { Authorization: await authHeader() },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Failed to generate the change-order PDF')
  return data.url as string
}

/** Generate + open the CO PDF in a new tab. */
export async function downloadChangeOrderPdf(coId: string): Promise<void> {
  const url = await generateChangeOrderPdf(coId)
  window.open(url, '_blank', 'noopener,noreferrer')
}

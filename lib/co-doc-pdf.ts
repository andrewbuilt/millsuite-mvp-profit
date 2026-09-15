// ============================================================================
// lib/co-doc-pdf.ts — client wrapper around /api/co-docs/[id]/pdf
// ============================================================================
// Mirrors lib/change-order-pdf for the v2 document. Separate route because the
// two render different things: a v1 CO is one change, a v2 doc is a list of
// them with one net total and one signature.
// ============================================================================

import { supabase } from './supabase'

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return `Bearer ${token}`
}

/**
 * Generate (or fetch) the doc PDF; returns its URL.
 *
 * ⚠️ An ACCEPTED doc returns its stored snapshot without re-rendering — see
 * the route header. The client the document was signed by must keep seeing the
 * document they signed, not a re-render against a rate book that has moved.
 */
export async function generateCoDocPdf(docId: string): Promise<string> {
  const res = await fetch(`/api/co-docs/${docId}/pdf`, {
    method: 'POST',
    headers: { Authorization: await authHeader() },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Failed to generate the change-order PDF')
  return data.url as string
}

/** Generate + open in a new tab. */
export async function downloadCoDocPdf(docId: string): Promise<void> {
  const url = await generateCoDocPdf(docId)
  window.open(url, '_blank', 'noopener,noreferrer')
}

// ============================================================================
// lib/invoice-pdf.ts — client-side wrappers around /api/invoices/[id]/pdf
// ============================================================================
// The API route gates on the caller's auth session, so every request
// has to ship the current user's access token in the Authorization
// header. supabase.auth.getSession() resolves it locally without a
// network round-trip when the session is already cached.
// ============================================================================

import { supabase } from './supabase'

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return `Bearer ${token}`
}

/** POST to the generation route. Returns the cached public URL of the
 *  rendered PDF. The route regenerates on every call (idempotent
 *  upsert), so callers don't need to invalidate. */
export async function generateAndCachePdf(invoiceId: string): Promise<string> {
  const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
    method: 'POST',
    headers: { Authorization: await authHeader() },
  })
  if (!res.ok) {
    let message = `Failed to generate PDF (${res.status})`
    try {
      const j = await res.json()
      if (j?.error) message = j.error
    } catch {
      // body wasn't json — keep the default
    }
    throw new Error(message)
  }
  const { url } = (await res.json()) as { url: string }
  return url
}

/** Generate-and-open. Pops the PDF in a new tab; the browser's PDF
 *  viewer then surfaces a "save" affordance. We don't force a
 *  download because most users want to skim the file before saving
 *  it to disk. */
export async function downloadInvoicePdf(invoiceId: string): Promise<string> {
  const url = await generateAndCachePdf(invoiceId)
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return url
}

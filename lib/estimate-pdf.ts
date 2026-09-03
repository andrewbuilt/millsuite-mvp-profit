// ============================================================================
// lib/estimate-pdf.ts — client wrapper around /api/estimates/[projectId]/pdf
// ============================================================================
// The caller passes the same computed estimate data it shows on screen, so the
// rendered PDF total reconciles exactly with the on-screen project price.
// ============================================================================

import { supabase } from './supabase'

export interface EstimatePdfPayload {
  lineItems: {
    description: string
    quantity: number
    unit?: string | null
    unit_price: number
    amount: number
  }[]
  schedule?: { label: string; pct: number; trigger?: string | null; amount: number }[]
  totals: { subtotal: number; taxPct: number; taxAmount: number; total: number }
  terms?: string | null
  validUntil?: string | null
  /** 'standard' | 'presentation'. Omitted ⇒ the route resolves it from the
   *  project's stamp, then the org default. */
  template?: string | null
  /** The presentation cover's editorial sentence. Ignored by the standard
   *  template. Persisted by the route so a regenerate reproduces it. */
  headline?: string | null
}

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return `Bearer ${token}`
}

/** POST to the generation route; returns the cached public PDF URL. */
export async function generateEstimatePdf(
  projectId: string,
  payload: EstimatePdfPayload,
): Promise<string> {
  const res = await fetch(`/api/estimates/${projectId}/pdf`, {
    method: 'POST',
    headers: { Authorization: await authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let message = `Failed to generate estimate PDF (${res.status})`
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

/** Generate-and-open in a new tab (browser PDF viewer surfaces "save"). */
export async function downloadEstimatePdf(
  projectId: string,
  payload: EstimatePdfPayload,
): Promise<string> {
  const url = await generateEstimatePdf(projectId, payload)
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return url
}

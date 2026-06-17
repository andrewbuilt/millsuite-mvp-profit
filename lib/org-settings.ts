// Per-org settings shared by the client (UI) and the server. Pure functions
// only — no React, no Supabase — so both halves of the app branch on the same
// logic and never drift.

/**
 * Invoicing backend for an org (orgs.invoicing_mode, migration 057):
 *   'internal'   — MillSuite's built-in invoices (default, today's behavior).
 *   'quickbooks' — estimates/invoices are pushed to QuickBooks instead.
 * Cash flow stays milestone-based in both modes.
 */
export type InvoicingMode = 'internal' | 'quickbooks'

/** Minimal org shape needed to resolve the invoicing backend. */
export interface OrgInvoicingFields {
  invoicing_mode?: string | null
}

/**
 * The invoicing backend for an org, normalized to a known mode. Anything other
 * than 'quickbooks' — including null/undefined (an org predating the column, or
 * a partial select that omitted it) — reads as 'internal', so callers never
 * have to guard. This is the single source of truth for the invoicing-mode
 * branch; UI and server both call it.
 */
export function invoicingMode(
  org: OrgInvoicingFields | null | undefined,
): InvoicingMode {
  return org?.invoicing_mode === 'quickbooks' ? 'quickbooks' : 'internal'
}

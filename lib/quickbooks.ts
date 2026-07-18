// lib/quickbooks.ts
// QuickBooks Online integration for MillSuite — OAuth 2.0 + per-org token
// storage. Ported from Built OS's single-tenant client and adapted to
// MillSuite's per-org `qb_connections` table (one row per org; migrations 010 +
// 058). Tokens are stored raw — MVP posture, same as Built OS; the table is
// only ever read server-side via the service-role client below.
//
// Chunk 2 is the connect/refresh/status half. The push half
// (findOrCreateCustomer / createEstimate / createInvoice) lands in Chunk 3 and
// will build on getValidToken() / qboApi() here.

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeItemName } from '@/lib/subproject-description'

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE =
  process.env.QBO_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
const QBO_MINOR_VERSION = '73'
const QBO_SCOPE = 'com.intuit.quickbooks.accounting'

const CLIENT_ID = process.env.QBO_CLIENT_ID!
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET!
const REDIRECT_URI = process.env.QBO_REDIRECT_URI!

export interface QBOTokens {
  access_token: string
  refresh_token: string
  realm_id: string
  expires_at: string
  refresh_expires_at: string
}

export interface QBOCustomer {
  Id?: string
  DisplayName: string
  PrimaryEmailAddr?: { Address: string }
  PrimaryPhone?: { FreeFormNumber: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
  }
}

export interface QBOLineItem {
  DetailType: 'SalesItemLineDetail'
  Amount: number
  Description?: string
  SalesItemLineDetail: {
    UnitPrice: number
    Qty: number
    ItemRef?: { value: string; name: string }
  }
}

export interface QBOEstimate {
  Id?: string
  DocNumber?: string
  CustomerRef: { value: string; name?: string }
  Line: QBOLineItem[]
  TotalAmt?: number
  ExpirationDate?: string
  CustomerMemo?: { value: string }
  PrivateNote?: string
}

export interface QBOInvoice {
  Id?: string
  DocNumber?: string
  DueDate?: string
  CustomerRef: { value: string; name?: string }
  Line: QBOLineItem[]
  TotalAmt?: number
  Balance?: number
  CustomerMemo?: { value: string }
  PrivateNote?: string
  LinkedTxn?: { TxnId: string; TxnType: string }[]
}

export interface QbLineItemInput {
  description: string
  amount: number
  qty: number
  unitPrice: number
}

/**
 * Build the Intuit consent URL. `state` round-trips back to our callback
 * unchanged; we put the org id there so the callback knows which org to store
 * tokens for. (MVP: plain org id. TODO before multi-tenant GA: HMAC-sign it so
 * the callback can reject a tampered/forged org id.)
 */
export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: QBO_SCOPE,
    state,
  })
  return `${QBO_AUTH_URL}?${params.toString()}`
}

/** Exchange the authorization code for tokens and store them for this org. */
export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
  orgId: string,
): Promise<QBOTokens> {
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  const now = Date.now()
  const tokens: QBOTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    expires_at: new Date(now + data.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(
      now + data.x_refresh_token_expires_in * 1000,
    ).toISOString(),
  }
  // Initial connect (or reconnect): upsert the whole row for this org. A
  // leftover stub row for the same org is overwritten via onConflict.
  const { error } = await supabaseAdmin.from('qb_connections').upsert(
    {
      org_id: orgId,
      realm_id: tokens.realm_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      refresh_expires_at: tokens.refresh_expires_at,
      scope: QBO_SCOPE,
      connected_at: new Date().toISOString(),
      metadata: {},
    },
    { onConflict: 'org_id' },
  )
  if (error) throw new Error(`Failed to save QB tokens: ${error.message}`)
  return tokens
}

/** Refresh this org's access token using its stored refresh token. */
export async function refreshAccessToken(orgId: string): Promise<QBOTokens> {
  const current = await getStoredTokens(orgId)
  if (!current) throw new Error('QuickBooks not connected for this org')
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
    }),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} ${await response.text()}`)
  }
  const data = await response.json()
  const now = Date.now()
  const tokens: QBOTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: current.realm_id,
    expires_at: new Date(now + data.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(
      now + data.x_refresh_token_expires_in * 1000,
    ).toISOString(),
  }
  const { error } = await supabaseAdmin
    .from('qb_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      refresh_expires_at: tokens.refresh_expires_at,
    })
    .eq('org_id', orgId)
  if (error) throw new Error(`Failed to update QB tokens: ${error.message}`)
  return tokens
}

/**
 * The org's stored tokens, or null if it isn't really connected. A row with
 * null access/refresh tokens (e.g. a leftover from the old stub button) counts
 * as not-connected.
 */
export async function getStoredTokens(orgId: string): Promise<QBOTokens | null> {
  const { data, error } = await supabaseAdmin
    .from('qb_connections')
    .select('realm_id, access_token, refresh_token, expires_at, refresh_expires_at')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return null
  if (!data.access_token || !data.refresh_token) return null
  return data as QBOTokens
}

/** A valid access token for this org, refreshing if it's within 5 min of expiry. */
async function getValidToken(
  orgId: string,
): Promise<{ accessToken: string; realmId: string }> {
  let tokens = await getStoredTokens(orgId)
  if (!tokens) throw new Error('QuickBooks not connected for this org')
  const msUntilExpiry = new Date(tokens.expires_at).getTime() - Date.now()
  if (msUntilExpiry < 5 * 60 * 1000) {
    tokens = await refreshAccessToken(orgId)
  }
  return { accessToken: tokens.access_token, realmId: tokens.realm_id }
}

/** Call the QBO API for an org, auto-refreshing once on a 401. */
export async function qboApi<T = any>(
  orgId: string,
  method: string,
  endpoint: string,
  body?: any,
): Promise<T> {
  const { accessToken, realmId } = await getValidToken(orgId)
  // Some endpoints already carry a query string (e.g. `query?query=...`), so
  // pick the right separator for minorversion — a second `?` breaks QB's parser.
  const sep = endpoint.includes('?') ? '&' : '?'
  const url = `${QBO_API_BASE}/v3/company/${realmId}/${endpoint}${sep}minorversion=${QBO_MINOR_VERSION}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) {
    const refreshed = await refreshAccessToken(orgId)
    headers.Authorization = `Bearer ${refreshed.access_token}`
    const retry = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!retry.ok) {
      throw new Error(`QBO API error after refresh: ${retry.status} ${await retry.text()}`)
    }
    return retry.json()
  }
  if (!response.ok) {
    throw new Error(`QBO API error: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

/**
 * Whether the org is connected, plus the QB company name. The companyinfo call
 * actually exercises the token, so a `connected: true` here means the
 * connection genuinely works (not just that a row exists).
 */
export async function getConnectionStatus(orgId: string): Promise<{
  connected: boolean
  companyName?: string
  realmId?: string
  tokenExpiresAt?: string
  refreshExpiresAt?: string
}> {
  const tokens = await getStoredTokens(orgId)
  if (!tokens) return { connected: false }
  try {
    const info = await qboApi<any>(orgId, 'GET', 'companyinfo/' + tokens.realm_id)
    return {
      connected: true,
      companyName: info.CompanyInfo?.CompanyName || 'Connected',
      realmId: tokens.realm_id,
      tokenExpiresAt: tokens.expires_at,
      refreshExpiresAt: tokens.refresh_expires_at,
    }
  } catch {
    return { connected: false, realmId: tokens.realm_id }
  }
}

// ── Push (outbound) — Chunk 3 ───────────────────────────────────────────────
// Create customers / estimates / invoices in the org's QB company. The inbound
// half (matching QB payments back to milestones) stays in lib/qb-events.ts.

function toLine(item: QbLineItemInput): QBOLineItem {
  return {
    DetailType: 'SalesItemLineDetail',
    Amount: Math.round(item.amount * 100) / 100,
    Description: item.description,
    SalesItemLineDetail: {
      UnitPrice: Math.round(item.unitPrice * 100) / 100,
      Qty: item.qty,
    },
  }
}

/** Find a QB customer by exact display name, or create one. Returns its QB id. */
export async function findOrCreateCustomer(
  orgId: string,
  clientName: string,
  email?: string,
  phone?: string,
  address?: { line1?: string; city?: string; state?: string; zip?: string },
): Promise<string> {
  const query = `SELECT * FROM Customer WHERE DisplayName = '${clientName.replace(/'/g, "\\'")}'`
  const result = await qboApi<any>(orgId, 'GET', `query?query=${encodeURIComponent(query)}`)
  if (result.QueryResponse?.Customer?.length > 0) {
    return result.QueryResponse.Customer[0].Id
  }
  const customer: QBOCustomer = { DisplayName: clientName }
  if (email) customer.PrimaryEmailAddr = { Address: email }
  if (phone) customer.PrimaryPhone = { FreeFormNumber: phone }
  if (address) {
    customer.BillAddr = {
      Line1: address.line1,
      City: address.city,
      CountrySubDivisionCode: address.state,
      PostalCode: address.zip,
    }
  }
  const created = await qboApi<any>(orgId, 'POST', 'customer', customer)
  return created.Customer.Id
}

/** Create an estimate in the org's QB company. */
export async function createEstimate(
  orgId: string,
  params: {
    customerQboId: string
    customerName: string
    lineItems: QbLineItemInput[]
    memo?: string
    privateNote?: string
    expirationDate?: string
  },
): Promise<{ estimateId: string; docNumber: string }> {
  const estimate: QBOEstimate = {
    CustomerRef: { value: params.customerQboId, name: params.customerName },
    Line: params.lineItems.map(toLine),
    ...(params.memo && { CustomerMemo: { value: params.memo } }),
    ...(params.privateNote && { PrivateNote: params.privateNote }),
    ...(params.expirationDate && { ExpirationDate: params.expirationDate }),
  }
  const result = await qboApi<any>(orgId, 'POST', 'estimate', estimate)
  return { estimateId: result.Estimate.Id, docNumber: result.Estimate.DocNumber }
}

/** Create an invoice in the org's QB company (optionally linked to a QB estimate). */
export async function createInvoice(
  orgId: string,
  params: {
    customerQboId: string
    customerName: string
    lineItems: QbLineItemInput[]
    dueDate?: string
    memo?: string
    privateNote?: string
    linkedEstimateId?: string
  },
): Promise<{ invoiceId: string; docNumber: string; totalAmt: number }> {
  const invoice: QBOInvoice = {
    CustomerRef: { value: params.customerQboId, name: params.customerName },
    Line: params.lineItems.map(toLine),
    ...(params.dueDate && { DueDate: params.dueDate }),
    ...(params.memo && { CustomerMemo: { value: params.memo } }),
    ...(params.privateNote && { PrivateNote: params.privateNote }),
    ...(params.linkedEstimateId && {
      LinkedTxn: [{ TxnId: params.linkedEstimateId, TxnType: 'Estimate' }],
    }),
  }
  const result = await qboApi<any>(orgId, 'POST', 'invoice', invoice)
  return {
    invoiceId: result.Invoice.Id,
    docNumber: result.Invoice.DocNumber,
    totalAmt: result.Invoice.TotalAmt,
  }
}

// ── QB item cache — activity_type → QB service-item (ItemRef) mapping ────────
// 6a-2. Ported from Built OS (single-tenant) into MillSuite's per-org model.
// The invoice push maps each subproject's activity_type to a real QB Item via
// a strict, normalized name match against qbo_items_cache (migration 064). A
// miss surfaces as a CacheMissError → 422 "sync your QB items", never a
// silently-invented item.

/** Thrown when a subproject's activity_type has no matching row in the org's
 *  qbo_items_cache. Carries the activity type for the "sync items" CTA. */
export class CacheMissError extends Error {
  activityType: string
  constructor(activityType: string) {
    super(`Activity type "${activityType}" not found in qbo_items_cache`)
    this.name = 'CacheMissError'
    this.activityType = activityType
  }
}

export interface QbItem {
  qb_id: string
  name: string | null
  type: string | null
}

const QB_ITEM_PAGE = 100

/** Pull the org's active Service + NonInventory items from QB into the cache.
 *  Upserts on (org_id, qb_id); deactivates cached rows QB no longer returns.
 *  Returns the number of items synced. */
export async function syncQbItems(orgId: string): Promise<number> {
  const items: any[] = []
  let start = 1
  // Paginate QB's query API (STARTPOSITION/MAXRESULTS).
  for (;;) {
    const sql =
      `SELECT * FROM Item WHERE Active = true AND Type IN ('Service', 'NonInventory') ` +
      `STARTPOSITION ${start} MAXRESULTS ${QB_ITEM_PAGE}`
    const res = await qboApi<any>(orgId, 'GET', `query?query=${encodeURIComponent(sql)}`)
    const page = res?.QueryResponse?.Item ?? []
    if (page.length === 0) break
    items.push(...page)
    if (page.length < QB_ITEM_PAGE) break
    start += QB_ITEM_PAGE
  }

  const now = new Date().toISOString()
  if (items.length > 0) {
    const rows = items.map((it: any) => ({
      org_id: orgId,
      qb_id: String(it.Id),
      name: it.Name ?? null,
      description: it.Description ?? null,
      type: it.Type ?? null,
      income_account_id: it.IncomeAccountRef?.value ?? null,
      unit_price: typeof it.UnitPrice === 'number' ? it.UnitPrice : null,
      active: it.Active ?? true,
      synced_at: now,
    }))
    const { error } = await supabaseAdmin
      .from('qbo_items_cache')
      .upsert(rows, { onConflict: 'org_id,qb_id' })
    if (error) throw error
  }

  // Deactivate cached rows QB no longer returns (deleted / made inactive).
  const returned = new Set(items.map((it: any) => String(it.Id)))
  const { data: existing } = await supabaseAdmin
    .from('qbo_items_cache')
    .select('qb_id')
    .eq('org_id', orgId)
    .eq('active', true)
  const stale = (existing || []).map((r: any) => r.qb_id).filter((id: string) => !returned.has(id))
  if (stale.length > 0) {
    await supabaseAdmin
      .from('qbo_items_cache')
      .update({ active: false, synced_at: now })
      .eq('org_id', orgId)
      .in('qb_id', stale)
  }

  return items.length
}

/** The org's active cached items (for the activity-type dropdown). */
export async function listQbItems(orgId: string): Promise<QbItem[]> {
  const { data, error } = await supabaseAdmin
    .from('qbo_items_cache')
    .select('qb_id, name, type')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as QbItem[]
}

/** Strict (normalized) match of an activity type to the org's cached QB item.
 *  Throws CacheMissError on no match — the push turns that into a 422. */
export async function strictCacheItemLookup(
  orgId: string,
  activityType: string,
): Promise<{ value: string; name: string }> {
  const trimmed = (activityType ?? '').trim()
  if (!trimmed) throw new CacheMissError(activityType)
  const target = normalizeItemName(trimmed)
  const { data, error } = await supabaseAdmin
    .from('qbo_items_cache')
    .select('qb_id, name')
    .eq('org_id', orgId)
    .eq('active', true)
  if (error) throw error
  const hit = (data ?? []).find((r: any) => r.name && normalizeItemName(r.name) === target)
  if (!hit) throw new CacheMissError(activityType)
  return { value: hit.qb_id, name: hit.name }
}

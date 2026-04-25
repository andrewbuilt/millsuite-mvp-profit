// ============================================================================
// lib/clients.ts — data access for the clients table.
// ============================================================================
// Schema lives in migration 001 (clients + contacts) with RLS added in 033.
// Read/write helpers for:
//   - Project-detail Client picker (loadClients, createClient,
//     setProjectClient, updateClient).
//   - /clients dashboard list + detail (loadClientsWithMeta,
//     loadClientDetail, deleteClient, contact CRUD).
// ============================================================================

import { supabase } from './supabase'
import type { ProjectStage } from './types'

export interface Client {
  id: string
  org_id: string | null
  name: string
  type: 'B2B' | 'D2C' | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  org_id: string | null
  client_id: string | null
  name: string
  role: string | null
  phone: string | null
  email: string | null
  is_primary: boolean
  created_at: string
}

/** List every client in an org, alphabetical. */
export async function loadClients(orgId: string): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true })
  if (error) {
    console.error('loadClients', error)
    return []
  }
  return (data || []) as Client[]
}

/**
 * Insert a new client and return the row. Required: name. Everything else
 * is optional. Trims string fields and converts empty strings to null so
 * the row reads cleanly in lists.
 */
export async function createClient(input: {
  org_id: string
  name: string
  type?: 'B2B' | 'D2C' | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}): Promise<Client | null> {
  const cleaned = {
    org_id: input.org_id,
    name: input.name.trim(),
    type: input.type ?? null,
    phone: (input.phone || '').trim() || null,
    email: (input.email || '').trim() || null,
    address: (input.address || '').trim() || null,
    notes: (input.notes || '').trim() || null,
  }
  if (!cleaned.name) return null
  const { data, error } = await supabase
    .from('clients')
    .insert(cleaned)
    .select()
    .single()
  if (error) {
    console.error('createClient', error)
    throw error
  }
  return data as Client
}

/**
 * Wire a client onto a project. Writes BOTH client_id (FK) AND client_name
 * (denormalized fallback string) so existing surfaces that read
 * project.client_name (sales card, kanban card, /projects card, dashboard
 * report) keep working without a join.
 *
 * SYSTEM-MAP: projects.client_name is a denormalized cache of clients.name.
 * setProjectClient + updateClient are the only canonical write paths that
 * keep it in sync. See SYSTEM-MAP.md "Denormalized columns" for the full
 * contract.
 */
export async function setProjectClient(
  projectId: string,
  client: { id: string; name: string } | null,
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      client_id: client?.id ?? null,
      client_name: client?.name ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
  if (error) {
    console.error('setProjectClient', error)
    throw error
  }
}

/**
 * Patch a client row AND propagate the new name to every linked project's
 * denormalized projects.client_name column. Skips the propagation when the
 * patch doesn't touch `name` — phone / email / address / notes don't
 * surface on project list cards.
 *
 * Bypassing this helper (a direct UPDATE on clients.name) leaves
 * projects.client_name stale across every list / header surface. A future
 * DB trigger could enforce server-side; until then, route all client-name
 * edits through here. The propagation failure is non-fatal: clients.name
 * remains canonical via the picker, and the next setProjectClient touch
 * on each linked project will re-sync the cache.
 */
export async function updateClient(
  clientId: string,
  patch: Partial<Omit<Client, 'id' | 'org_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const trimmedPatch: Record<string, unknown> = {}
  if (patch.name !== undefined) trimmedPatch.name = (patch.name || '').trim()
  if (patch.type !== undefined) trimmedPatch.type = patch.type ?? null
  if (patch.phone !== undefined) trimmedPatch.phone = (patch.phone || '').trim() || null
  if (patch.email !== undefined) trimmedPatch.email = (patch.email || '').trim() || null
  if (patch.address !== undefined)
    trimmedPatch.address = (patch.address || '').trim() || null
  if (patch.notes !== undefined) trimmedPatch.notes = (patch.notes || '').trim() || null

  if (Object.keys(trimmedPatch).length === 0) return

  trimmedPatch.updated_at = new Date().toISOString()

  const { error } = await supabase
    .from('clients')
    .update(trimmedPatch)
    .eq('id', clientId)
  if (error) {
    console.error('updateClient', error)
    throw error
  }

  if (typeof trimmedPatch.name === 'string') {
    const { error: propErr } = await supabase
      .from('projects')
      .update({
        client_name: trimmedPatch.name,
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)
    if (propErr) {
      console.error('updateClient: client_name propagation', propErr)
      // Non-fatal — see docstring above.
    }
  }
}

// ── Dashboard helpers (/clients list + detail) ──

export interface ClientWithMeta extends Client {
  primary_contact: Contact | null
  active_project_count: number
  last_activity_at: string | null
}

const ACTIVE_STAGES: ProjectStage[] = [
  'new_lead',
  'fifty_fifty',
  'ninety_percent',
  'sold',
  'production',
  'installed',
]

/**
 * Load every client in the org plus, for each, the primary contact (or
 * first contact if none flagged primary), the count of "active"
 * projects, and the most recent project.updated_at as a "last activity"
 * timestamp. Three queries, joined client-side — keeps the SELECT clauses
 * simple enough that anyone reading later doesn't have to puzzle over a
 * Supabase nested query.
 */
export async function loadClientsWithMeta(orgId: string): Promise<ClientWithMeta[]> {
  const { data: clientsData, error: clientsErr } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true })
  if (clientsErr) {
    console.error('loadClientsWithMeta clients', clientsErr)
    return []
  }
  const clients = (clientsData || []) as Client[]
  if (clients.length === 0) return []

  const ids = clients.map((c) => c.id)
  const [{ data: contactsData }, { data: projectsData }] = await Promise.all([
    supabase.from('contacts').select('*').in('client_id', ids),
    supabase
      .from('projects')
      .select('id, client_id, stage, updated_at')
      .in('client_id', ids),
  ])

  const contactsByClient = new Map<string, Contact[]>()
  for (const c of (contactsData || []) as Contact[]) {
    if (!c.client_id) continue
    const list = contactsByClient.get(c.client_id) || []
    list.push(c)
    contactsByClient.set(c.client_id, list)
  }

  const activeByClient = new Map<string, number>()
  const lastActivityByClient = new Map<string, string>()
  for (const p of (projectsData || []) as Array<{
    id: string
    client_id: string | null
    stage: ProjectStage
    updated_at: string
  }>) {
    if (!p.client_id) continue
    if ((ACTIVE_STAGES as readonly string[]).includes(p.stage)) {
      activeByClient.set(p.client_id, (activeByClient.get(p.client_id) || 0) + 1)
    }
    const prev = lastActivityByClient.get(p.client_id)
    if (!prev || p.updated_at > prev) {
      lastActivityByClient.set(p.client_id, p.updated_at)
    }
  }

  return clients.map((c) => {
    const contacts = (contactsByClient.get(c.id) || []).sort((a, b) => {
      // Primary first, then alphabetic by name.
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return (a.name || '').localeCompare(b.name || '')
    })
    return {
      ...c,
      primary_contact: contacts[0] || null,
      active_project_count: activeByClient.get(c.id) || 0,
      last_activity_at: lastActivityByClient.get(c.id) || null,
    }
  })
}

export interface ClientProjectSummary {
  id: string
  name: string
  stage: ProjectStage
  bid_total: number
  updated_at: string
}

export interface ClientDetail {
  client: Client
  contacts: Contact[]
  projects: ClientProjectSummary[]
}

/**
 * Hydrate the /clients/[id] detail page. Single round-trip per table,
 * sorted client-side. Returns null when the client doesn't exist (the
 * detail page renders a "not found" state).
 */
export async function loadClientDetail(clientId: string): Promise<ClientDetail | null> {
  const [clientRes, contactsRes, projectsRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
    supabase
      .from('contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('projects')
      .select('id, name, stage, bid_total, updated_at')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false }),
  ])
  if (clientRes.error || !clientRes.data) {
    if (clientRes.error) console.error('loadClientDetail client', clientRes.error)
    return null
  }
  return {
    client: clientRes.data as Client,
    contacts: (contactsRes.data || []) as Contact[],
    projects: (projectsRes.data || []) as ClientProjectSummary[],
  }
}

/**
 * Delete a client. projects.client_id is a plain uuid in migration 001 (no
 * FK constraint) so a raw DELETE leaves orphan references — null those
 * out first. We DON'T null out projects.client_name; the denormalized
 * fallback string is the right thing to keep showing on cards once the
 * structured client is gone, and the user can repick later. Contacts
 * cascade automatically (contacts.client_id has ON DELETE CASCADE).
 */
export async function deleteClient(clientId: string): Promise<void> {
  const { error: detachErr } = await supabase
    .from('projects')
    .update({ client_id: null, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
  if (detachErr) {
    console.error('deleteClient: project detach', detachErr)
    throw detachErr
  }
  const { error } = await supabase.from('clients').delete().eq('id', clientId)
  if (error) {
    console.error('deleteClient', error)
    throw error
  }
}

// ── Contacts CRUD ──

/** Insert a contact. Required: client_id, org_id, name. */
export async function createContact(input: {
  client_id: string
  org_id: string
  name: string
  role?: string | null
  phone?: string | null
  email?: string | null
  is_primary?: boolean
}): Promise<Contact | null> {
  const cleaned = {
    client_id: input.client_id,
    org_id: input.org_id,
    name: input.name.trim(),
    role: (input.role || '').trim() || null,
    phone: (input.phone || '').trim() || null,
    email: (input.email || '').trim() || null,
    is_primary: !!input.is_primary,
  }
  if (!cleaned.name) return null

  // Only one primary per client. If this insert claims primary, demote
  // every other contact on the same client first.
  if (cleaned.is_primary) {
    await supabase
      .from('contacts')
      .update({ is_primary: false })
      .eq('client_id', cleaned.client_id)
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert(cleaned)
    .select()
    .single()
  if (error) {
    console.error('createContact', error)
    throw error
  }
  return data as Contact
}

/** Patch a contact. When is_primary flips to true, demotes peers. */
export async function updateContact(
  contactId: string,
  patch: Partial<Omit<Contact, 'id' | 'org_id' | 'client_id' | 'created_at'>>,
): Promise<void> {
  const cleaned: Record<string, unknown> = {}
  if (patch.name !== undefined) cleaned.name = (patch.name || '').trim()
  if (patch.role !== undefined) cleaned.role = (patch.role || '').trim() || null
  if (patch.phone !== undefined) cleaned.phone = (patch.phone || '').trim() || null
  if (patch.email !== undefined) cleaned.email = (patch.email || '').trim() || null
  if (patch.is_primary !== undefined) cleaned.is_primary = !!patch.is_primary

  if (Object.keys(cleaned).length === 0) return

  if (cleaned.is_primary === true) {
    const { data: row } = await supabase
      .from('contacts')
      .select('client_id')
      .eq('id', contactId)
      .maybeSingle()
    const clientId = (row as { client_id: string | null } | null)?.client_id
    if (clientId) {
      await supabase
        .from('contacts')
        .update({ is_primary: false })
        .eq('client_id', clientId)
        .neq('id', contactId)
    }
  }

  const { error } = await supabase
    .from('contacts')
    .update(cleaned)
    .eq('id', contactId)
  if (error) {
    console.error('updateContact', error)
    throw error
  }
}

export async function deleteContact(contactId: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', contactId)
  if (error) {
    console.error('deleteContact', error)
    throw error
  }
}

// ============================================================================
// lib/clients.ts — data access for the clients table.
// ============================================================================
// Schema lives in migration 001 (clients + contacts) with RLS added in 033.
// Purpose: small, opinionated read/write helpers for the project-detail
// Client picker. Anything more elaborate (CRM-style contact management,
// org-wide client browse) can layer on later.
// ============================================================================

import { supabase } from './supabase'

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

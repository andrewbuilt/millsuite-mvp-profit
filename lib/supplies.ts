// ============================================================================
// lib/supplies.ts — the "where do we buy this" directory.
// ============================================================================
// Andrew: "some things we only buy every few months and we have to dig around
// to figure out where to get it."
//
// ⛔ NOT A PRICED CATALOG. Nothing here feeds pricing — see the header of
// migration 102. If a supply needs a cost, it belongs in the rate book, or two
// tables end up describing the same material and disagreeing.
//
// ⛔ EVERY WRITE SELECTS THE ROW BACK AND THROWS ON ZERO ROWS. PostgREST
// reports an RLS-blocked UPDATE as `{ error: null }` with an empty body — a
// refusal that is otherwise indistinguishable from a success. Same rule as
// lib/tasks and lib/payments.
// ============================================================================

import { supabase } from '@/lib/supabase'
import { normalizeLinkUrl } from '@/lib/task-links'
import type { SupplyItem } from '@/lib/supply-item'

// The shape and the search live in a PURE module so a verification script can
// import them without a Supabase client. Re-exported so callers have one
// import site. ⛔ Don't move `supplyMatches` back in here.
export { supplyMatches } from '@/lib/supply-item'
export type { SupplyItem }

const COLUMNS = 'id, name, url, vendor, vendor_info, notes, active, created_at'

/** True when PostgREST is telling us migration 102 hasn't run. */
export function isMissingSupplies(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  const code = e.code || ''
  if (code === '42P01' || code === '42703' || code === 'PGRST204' || code === 'PGRST205') return true
  return /does not exist|could not find the/i.test(e.message || '')
}

function toItem(r: Record<string, unknown>): SupplyItem {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    // ⛔ NORMALISED ON THE WAY OUT, not just on the way in. A row written
    // before this rule existed — or straight into the database — would
    // otherwise reach an href unchecked. `javascript:` is refused by the
    // allowlist in lib/task-links, which is already tested to 38 cases.
    url: r.url ? normalizeLinkUrl(String(r.url)) : null,
    vendor: r.vendor ? String(r.vendor) : null,
    vendorInfo: r.vendor_info ? String(r.vendor_info) : null,
    notes: r.notes ? String(r.notes) : null,
    active: r.active !== false,
    createdAt: String(r.created_at ?? ''),
  }
}

export interface SuppliesLoad {
  items: SupplyItem[]
  error: string | null
  /** Migration 102 hasn't run. The page says so rather than showing "no
   *  supplies yet", which would read as an empty directory. */
  missing: boolean
}

export async function loadSupplies(orgId: string): Promise<SuppliesLoad> {
  const { data, error } = await supabase
    .from('supply_items')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .order('name')

  if (error) {
    if (isMissingSupplies(error)) return { items: [], error: null, missing: true }
    console.error('loadSupplies', error)
    return { items: [], error: error.message || 'Could not load supplies.', missing: false }
  }
  return {
    items: (data || []).map((r) => toItem(r as Record<string, unknown>)),
    error: null,
    missing: false,
  }
}

export interface SupplyInput {
  name: string
  url?: string | null
  vendor?: string | null
  vendorInfo?: string | null
  notes?: string | null
}

/** Empty string ⇒ null, so a cleared field doesn't persist as ''. */
function blankToNull(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

export async function createSupply(orgId: string, input: SupplyInput): Promise<SupplyItem> {
  const name = input.name.trim()
  if (!name) throw new Error('A supply needs a name.')

  const { data, error } = await supabase
    .from('supply_items')
    .insert({
      org_id: orgId,
      name,
      // Stored normalised, so a bad scheme never reaches the database — but
      // `toItem` normalises again on read, because this isn't the only way a
      // row can get in.
      url: normalizeLinkUrl(input.url ?? ''),
      vendor: blankToNull(input.vendor),
      vendor_info: blankToNull(input.vendorInfo),
      notes: blankToNull(input.notes),
    })
    .select(COLUMNS)
    .single()

  if (error) {
    if (isMissingSupplies(error)) {
      throw new Error('Supplies needs migration 102, which has not been run on this database yet.')
    }
    throw new Error(error.message || 'Could not add that supply.')
  }
  return toItem(data as Record<string, unknown>)
}

export async function updateSupply(
  id: string,
  patch: Partial<SupplyInput> & { active?: boolean },
): Promise<SupplyItem> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const n = patch.name.trim()
    if (!n) throw new Error('A supply needs a name.')
    update.name = n
  }
  if (patch.url !== undefined) update.url = normalizeLinkUrl(patch.url ?? '')
  if (patch.vendor !== undefined) update.vendor = blankToNull(patch.vendor)
  if (patch.vendorInfo !== undefined) update.vendor_info = blankToNull(patch.vendorInfo)
  if (patch.notes !== undefined) update.notes = blankToNull(patch.notes)
  if (patch.active !== undefined) update.active = patch.active

  const { data, error } = await supabase
    .from('supply_items')
    .update(update)
    .eq('id', id)
    .select(COLUMNS)

  if (error) {
    if (isMissingSupplies(error)) {
      throw new Error('Supplies needs migration 102, which has not been run on this database yet.')
    }
    throw new Error(error.message || 'Could not save that supply.')
  }
  // ⛔ ZERO ROWS IS A REFUSAL, NOT A SUCCESS. An UPDATE that matches nothing
  // returns `{ error: null }` — RLS blocking the write looks exactly like a
  // write that worked.
  if (!data || data.length === 0) {
    throw new Error(
      'That save did not reach the database. You may not have permission, or the session expired — reload and sign in again.',
    )
  }
  return toItem(data[0] as Record<string, unknown>)
}


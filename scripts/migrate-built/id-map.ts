// ============================================================================
// scripts/migrate-built/id-map.ts — idempotent Built→MillSuite id mapping
// ============================================================================
// Every migrated row records (org_id, entity, built_id) → millsuite_id in the
// migration_id_map table (migration 063). A re-run looks the built_id up
// first: hit → update that MillSuite row; miss → insert + record. This is
// what makes the whole transfer re-runnable without duplicating.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type Entity =
  | 'client'
  | 'project'
  | 'subproject'
  | 'estimate_line'
  | 'milestone'

/** Look up the MillSuite id a Built id was mapped to, or null if unmigrated. */
export async function lookupMillsuiteId(
  ms: SupabaseClient,
  orgId: string,
  entity: Entity,
  builtId: string,
): Promise<string | null> {
  const { data, error } = await ms
    .from('migration_id_map')
    .select('millsuite_id')
    .eq('org_id', orgId)
    .eq('entity', entity)
    .eq('built_id', builtId)
    .maybeSingle()
  if (error) throw new Error(`id-map lookup failed (${entity} ${builtId}): ${error.message}`)
  return data?.millsuite_id ?? null
}

/** Load the whole map for one entity as { built_id → millsuite_id } (handy
 *  for rewiring FKs in bulk without a query per row). */
export async function loadEntityMap(
  ms: SupabaseClient,
  orgId: string,
  entity: Entity,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await ms
      .from('migration_id_map')
      .select('built_id, millsuite_id')
      .eq('org_id', orgId)
      .eq('entity', entity)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`id-map load failed (${entity}): ${error.message}`)
    for (const r of data || []) out[r.built_id as string] = r.millsuite_id as string
    if (!data || data.length < pageSize) break
  }
  return out
}

/** Record (or refresh) a Built→MillSuite mapping. Upserts on the
 *  (org_id, entity, built_id) unique key from migration 063. */
export async function recordId(
  ms: SupabaseClient,
  orgId: string,
  entity: Entity,
  builtId: string,
  millsuiteId: string,
): Promise<void> {
  const { error } = await ms.from('migration_id_map').upsert(
    {
      org_id: orgId,
      entity,
      built_id: builtId,
      millsuite_id: millsuiteId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,entity,built_id' },
  )
  if (error) throw new Error(`id-map record failed (${entity} ${builtId}): ${error.message}`)
}

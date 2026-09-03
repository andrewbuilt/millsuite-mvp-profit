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

/**
 * Like `lookupMillsuiteId`, but proves the mapped row STILL EXISTS.
 *
 * ⛔ THE BUG THIS EXISTS FOR. The map outlives the rows it points at. Delete a
 * project in the app to force a clean re-import — the obvious thing to try —
 * and the map still holds Built-id → the dead uuid. Every caller then takes
 * its `if (existing)` branch and runs
 *
 *     .update(payload).eq('id', <deleted uuid>)
 *
 * which matches zero rows. PostgREST reports that as SUCCESS, so the script
 * throws nothing and prints "updated 1" while writing nothing at all. The job
 * stays deleted and the run looks clean.
 *
 * It cascades, too: deleting a project takes its subprojects, lines and
 * milestones with it, so their mappings go stale in the same instant.
 *
 * So: confirm the row is really there. If it isn't, drop the dead mapping and
 * return null, which sends the caller down its insert path and re-creates the
 * row properly. That makes "delete it and re-import" behave the way anyone
 * would expect it to.
 */
export async function lookupLiveMillsuiteId(
  ms: SupabaseClient,
  orgId: string,
  entity: Entity,
  builtId: string,
  table: string,
): Promise<string | null> {
  const mapped = await lookupMillsuiteId(ms, orgId, entity, builtId)
  if (!mapped) return null

  const { data, error } = await ms.from(table).select('id').eq('id', mapped).maybeSingle()
  if (error) {
    throw new Error(`id-map liveness check failed (${entity} ${builtId}): ${error.message}`)
  }
  if (data) return mapped

  // Mapped but gone. Clear it so the re-insert can record a fresh mapping —
  // leaving it would make the next run take the same dead branch again.
  console.log(
    `    · ${entity} ${builtId} was mapped to a row that no longer exists — ` +
      're-importing it from scratch',
  )
  const { error: delErr } = await ms
    .from('migration_id_map')
    .delete()
    .eq('org_id', orgId)
    .eq('entity', entity)
    .eq('built_id', builtId)
  if (delErr) {
    throw new Error(`could not clear stale mapping (${entity} ${builtId}): ${delErr.message}`)
  }
  return null
}

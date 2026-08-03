// ============================================================================
// scripts/migrate-built/migrate.ts — Built OS → MillSuite migration (entry)
// ============================================================================
// Chunk 2 scaffold: env + CLI + id-map wiring, preflight, and the entity
// pipeline in dependency order. The per-entity transforms are filled in by
// later chunks:
//   client        → chunk 3
//   project       → chunk 3
//   subproject    → chunk 3
//   estimate_line → chunk 4 (active jobs) / chunk 5 (snapshots)
//   milestone     → chunk 3
//
// Run (Built creds via env or scripts/migrate-built/.env):
//   npx tsx scripts/migrate-built/migrate.ts --dry-run
//   npx tsx scripts/migrate-built/migrate.ts --project <built-project-id>
//   npx tsx scripts/migrate-built/migrate.ts --entity project --limit 5
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { builtClient, millsuiteClient, resolveTargetOrgId, TARGET_ORG_SLUG } from './env'
import { parseArgs, describeOptions } from './cli'
import type { Entity } from './id-map'
import {
  resolveScope,
  migrateClients,
  migrateProjects,
  migrateSubprojects,
  migrateMilestones,
  migrateEstimateLinesFrozen,
  dumpReEnterSheets,
  verifyAgainstManifest,
  type Ctx,
} from './entities'
import { loadManifest, describeManifest, MANIFEST_PATH } from './manifest'

// Dependency order — parents before children so FKs resolve through the map.
const PIPELINE: Entity[] = ['client', 'project', 'subproject', 'estimate_line', 'milestone']

// Confirm migration 063 has run — the whole script depends on the id map.
// NB: a head/count query does NOT error on a missing table in supabase-js, so
// use a real (non-head) select to surface "table not found".
async function preflight(ms: SupabaseClient): Promise<void> {
  const { error } = await ms.from('migration_id_map').select('id').limit(1)
  if (error) {
    throw new Error(
      'migration_id_map not found — run db/migrations/063_migration_id_map.sql on the ' +
        `MillSuite Supabase project first. (${error.message})`,
    )
  }
}

const RUNNERS: Record<Entity, (ctx: Ctx) => Promise<void>> = {
  client: migrateClients,
  project: migrateProjects,
  subproject: migrateSubprojects,
  estimate_line: migrateEstimateLinesFrozen,
  milestone: migrateMilestones,
}

async function main() {
  const opts = parseArgs()
  console.log('Built OS → MillSuite migration')
  console.log(`  ${describeOptions(opts)}`)
  console.log(`  target org slug: ${TARGET_ORG_SLUG}`)

  // 6c: the manifest is the pick list. No manifest ⇒ nothing is migrated —
  // the selective migration never falls back to a full run.
  const manifest = loadManifest()
  if (!manifest) {
    throw new Error(
      `no pick list found at ${MANIFEST_PATH} — selective migration (6c) requires a manifest.json ` +
        'listing which Built jobs to import. Nothing was migrated.',
    )
  }
  console.log(`  manifest: ${describeManifest(manifest)}`)

  const ms = millsuiteClient()
  await preflight(ms)
  const built = builtClient()
  const orgId = await resolveTargetOrgId(ms)
  console.log(`  target org id: ${orgId}`)

  const scope = await resolveScope(built, opts.project)
  if (scope.id) console.log(`  scope: single ${scope.kind} ${scope.id}`)
  console.log('')

  const ctxEarly: Ctx = { built, ms, orgId, opts, scope, manifest }
  if (opts.verifyOnly) {
    console.log('verify:')
    await verifyAgainstManifest({ ...ctxEarly, opts: { ...opts, dryRun: false } })
    console.log('\nDone. (verify-only — nothing written)')
    return
  }

  const entities = opts.entity ? PIPELINE.filter((e) => e === opts.entity) : PIPELINE
  if (entities.length === 0) {
    console.error(`Unknown --entity "${opts.entity}". One of: ${PIPELINE.join(', ')}`)
    process.exit(1)
  }

  const ctx: Ctx = { built, ms, orgId, opts, scope, manifest }
  for (const entity of entities) {
    console.log(`${entity}:`)
    await RUNNERS[entity](ctx)
  }

  // 6c tail: reference sheets for the re-enter list, then verify every
  // imported job against the Built checksums. Both are no-ops when the run
  // was scoped to a single entity via --entity.
  if (!opts.entity) {
    console.log('\nre-enter sheets:')
    await dumpReEnterSheets(ctx)
    console.log('\nverify:')
    await verifyAgainstManifest(ctx)
  }

  console.log('\nDone.' + (opts.dryRun ? ' (dry-run — nothing written)' : ''))
}

main().catch((err) => {
  console.error('\nMigration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})

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
  type Ctx,
} from './entities'

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

// estimate_lines translation lands in chunks 4–5.
async function migrateEstimateLines(_ctx: Ctx): Promise<void> {
  console.log('  estimate_lines (v4 translate / snapshot) — not yet implemented (chunks 4–5)')
}

const RUNNERS: Record<Entity, (ctx: Ctx) => Promise<void>> = {
  client: migrateClients,
  project: migrateProjects,
  subproject: migrateSubprojects,
  estimate_line: migrateEstimateLines,
  milestone: migrateMilestones,
}

async function main() {
  const opts = parseArgs()
  console.log('Built OS → MillSuite migration')
  console.log(`  ${describeOptions(opts)}`)
  console.log(`  target org slug: ${TARGET_ORG_SLUG}`)

  const ms = millsuiteClient()
  await preflight(ms)
  const built = builtClient()
  const orgId = await resolveTargetOrgId(ms)
  console.log(`  target org id: ${orgId}`)

  const scope = await resolveScope(built, opts.project)
  if (scope.id) console.log(`  scope: single ${scope.kind} ${scope.id}`)
  console.log('')

  const entities = opts.entity ? PIPELINE.filter((e) => e === opts.entity) : PIPELINE
  if (entities.length === 0) {
    console.error(`Unknown --entity "${opts.entity}". One of: ${PIPELINE.join(', ')}`)
    process.exit(1)
  }

  const ctx: Ctx = { built, ms, orgId, opts, scope }
  for (const entity of entities) {
    console.log(`${entity}:`)
    await RUNNERS[entity](ctx)
  }

  console.log('\nDone.' + (opts.dryRun ? ' (dry-run — nothing written)' : ''))
}

main().catch((err) => {
  console.error('\nMigration failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})

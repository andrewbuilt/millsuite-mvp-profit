// ============================================================================
// scripts/migrate-built/lookup.ts — READ-ONLY. Resolve job names → built_ids.
// ============================================================================
// Adding a job to manifest.json needs its Built-side `built_id` and the
// current `expected_price` / `expected_hours` checksums, and there was no way
// to get them short of opening the Built OS dashboard by hand.
//
// It also answers the question that actually matters before an import: DOES
// MILLSUITE ALREADY HAVE THIS JOB? A near-duplicate that nobody spots means
// the pipeline counts the same contract twice.
//
// WRITES NOTHING. Safe to run against live data — it only selects.
//
//   npx tsx scripts/migrate-built/lookup.ts Bonzer Brabson Schiller
//
// ============================================================================

import { builtClient, millsuiteClient, resolveTargetOrgId } from './env'
import { loadManifest } from './manifest'

const terms = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (terms.length === 0) {
  console.error('usage: npx tsx scripts/migrate-built/lookup.ts <name> [name...]')
  process.exit(1)
}

const money = (n: unknown) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

async function main() {
  const built = builtClient()
  const ms = millsuiteClient()
  const orgId = await resolveTargetOrgId(ms)
  const manifest = loadManifest()

  for (const term of terms) {
    console.log(`\n${'='.repeat(70)}\n${term}\n${'='.repeat(70)}`)

    // ── Built OS side ──
    // Built keeps both `leads` and `projects`; either can be the source row,
    // so check both rather than reporting "not found" from half the data.
    for (const table of ['projects', 'leads'] as const) {
      const { data, error } = await built
        .from(table)
        .select('*')
        .ilike('name', `%${term}%`)
      if (error) {
        console.log(`  built.${table}: ERROR ${error.message}`)
        continue
      }
      const rows = (data || []) as Array<Record<string, unknown>>
      if (rows.length === 0) {
        console.log(`  built.${table}: no match`)
        continue
      }
      for (const r of rows) {
        const price = r.bid_total ?? r.contract_total ?? r.estimated_price ?? r.amount
        console.log(
          `  built.${table}  ${String(r.id)}\n` +
            `      name  ${String(r.name)}\n` +
            `      stage ${String(r.stage ?? r.status ?? '—')}   price ${money(price)}`,
        )
        const inManifest = manifest?.jobs.find((j) => j.built_id === String(r.id))
        if (inManifest) {
          const drift =
            inManifest.expected_price != null &&
            Math.round(Number(inManifest.expected_price)) !== Math.round(Number(price) || 0)
          console.log(
            `      manifest: decision=${inManifest.decision} expected_price=${money(
              inManifest.expected_price,
            )}${drift ? '   ⚠️  DRIFT vs Built — update expected_price before importing' : '   ✓ matches Built'}`,
          )
        } else {
          console.log('      manifest: NOT LISTED — needs an entry to be imported')
        }
      }
    }

    // ── MillSuite side: would importing create a duplicate? ──
    const { data: msRows } = await ms
      .from('projects')
      .select('id, name, stage, bid_total, imported_at')
      .eq('org_id', orgId)
      .ilike('name', `%${term}%`)
    const existing = (msRows || []) as Array<Record<string, unknown>>
    if (existing.length === 0) {
      console.log('  millsuite: nothing with this name — clean import')
    } else {
      for (const p of existing) {
        console.log(
          `  millsuite  ${String(p.id)}\n` +
            `      name  ${String(p.name)}\n` +
            `      stage ${String(p.stage)}   ${money(p.bid_total)}   ${
              p.imported_at ? 'IMPORTED (re-run updates it in place)' : '⚠️  MANUAL — a fresh import lands ALONGSIDE this, double-counting the pipeline'
            }`,
        )
      }
    }
  }
  console.log('')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

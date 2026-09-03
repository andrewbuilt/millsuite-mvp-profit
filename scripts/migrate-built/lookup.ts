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
    // ⚠️ Built's name columns are NOT `name`: projects use `project_name`,
    // leads use `lead_name`. Guessing cost a round trip — the authoritative
    // list is schema-snapshot/schema.json.
    const SOURCES = [
      { table: 'projects' as const, nameCol: 'project_name' },
      { table: 'leads' as const, nameCol: 'lead_name' },
    ]
    const builtHits: Array<{ table: string; row: Record<string, unknown> }> = []

    for (const { table, nameCol } of SOURCES) {
      const { data, error } = await built
        .from(table)
        .select('*')
        .ilike(nameCol, `%${term}%`)
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
        builtHits.push({ table, row: r })
        const nm = String(r[nameCol] ?? '')
        console.log(
          `\n  built.${table}  ${String(r.id)}\n` +
            `      name   ${nm}\n` +
            `      status ${String(r.status ?? '—')}  lifecycle ${String(r.lifecycle_state ?? '—')}\n` +
            `      price  ${money(r.estimated_price)}   hours ${r.estimated_hours ?? '—'}` +
            (r.converted_to_project_id
              ? `\n      converted → project ${String(r.converted_to_project_id)}`
              : ''),
        )
        const inManifest = manifest?.jobs.find((j) => j.built_id === String(r.id))
        if (inManifest) {
          const drift =
            inManifest.expected_price != null &&
            Math.round(Number(inManifest.expected_price)) !==
              Math.round(Number(r.estimated_price) || 0)
          console.log(
            `      manifest: decision=${inManifest.decision} expected=${money(
              inManifest.expected_price,
            )}` +
              (drift
                ? `  ⚠️  DRIFT — Built now says ${money(r.estimated_price)}; the checksum is verified AFTER import, so fix it first`
                : '  ✓ checksum matches Built'),
          )
        } else {
          console.log('      manifest: NOT LISTED — needs an entry before it can be imported')
        }
      }
    }

    // ── MillSuite: would importing duplicate something? ──
    // Searched by the term AND by each Built name's leading token, because a
    // card entered by hand often drops the client ("400 Central PH4" with no
    // "Bonzer"), and a name-only check would call that a clean import.
    const probes = new Set<string>([term])
    for (const h of builtHits) {
      const nm = String(h.row.project_name ?? h.row.lead_name ?? '')
      for (const part of nm.split(/[-–—]/)) {
        const t = part.trim()
        if (t.length >= 4) probes.add(t)
      }
    }
    const seen = new Map<string, Record<string, unknown>>()
    for (const probe of probes) {
      const { data } = await ms
        .from('projects')
        .select('id, name, stage, bid_total, imported_at')
        .eq('org_id', orgId)
        .ilike('name', `%${probe}%`)
      for (const p of (data || []) as Array<Record<string, unknown>>) {
        seen.set(String(p.id), p)
      }
    }
    if (seen.size === 0) {
      console.log(`\n  millsuite: no project matches any of [${[...probes].join(', ')}] — clean import`)
    } else {
      for (const p of seen.values()) {
        console.log(
          `\n  millsuite  ${String(p.id)}\n` +
            `      name  ${String(p.name)}\n` +
            `      stage ${String(p.stage)}   ${money(p.bid_total)}   ${
              p.imported_at
                ? 'IMPORTED (a re-run updates this row in place)'
                : '⚠️  MANUAL — an import lands ALONGSIDE this and double-counts the pipeline'
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

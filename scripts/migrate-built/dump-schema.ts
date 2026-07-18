// ============================================================================
// scripts/migrate-built/dump-schema.ts — export the live Built OS schema
// ============================================================================
// Built OS has no migration files (schema lives in its Supabase dashboard),
// so before writing any transform we snapshot the real shape of the in-scope
// tables. Authoritative columns/types come from PostgREST's OpenAPI spec
// (GET /rest/v1/); row counts + the estimate-format split come from count
// queries. We DO NOT write row data — only column metadata, counts, and a
// value-stripped shape of one spec_lines_json — so nothing here contains PII.
//
// Output → scripts/migrate-built/schema-snapshot/{schema.json,
// estimate-format-split.json, SUMMARY.md}
//
// Run: npx tsx scripts/migrate-built/dump-schema.ts
// (needs BUILT_SUPABASE_URL + BUILT_SUPABASE_SERVICE_KEY)
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { builtClient, builtRestBase } from './env'

// In-scope for the first pass (STATE.md): clients, leads (+lead_subprojects),
// projects, subprojects, and milestones (Built stores these in cash_flow;
// milestone_instances captured too to confirm which carries per-project %s).
// estimate_line_items is included to confirm it's unused (estimates live in
// the subproject *_lines_json columns, not a separate table).
const IN_SCOPE = [
  'clients',
  'leads',
  'lead_subprojects',
  'projects',
  'subprojects',
  'cash_flow',
  'milestone_instances',
  'estimate_line_items',
]

const OUT_DIR = resolve(__dirname, 'schema-snapshot')

interface ColumnDef {
  name: string
  type: string
  format: string
  description: string
}

interface SwaggerProp {
  type?: string
  format?: string
  description?: string
}

/** Fetch PostgREST's OpenAPI (Swagger 2.0) definitions for column metadata. */
async function fetchOpenApiDefinitions(): Promise<Record<string, { properties?: Record<string, SwaggerProp> }>> {
  const { url, key } = builtRestBase()
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status} ${res.statusText}`)
  const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, SwaggerProp> }> }
  return spec.definitions ?? {}
}

function columnsFromDef(def?: { properties?: Record<string, SwaggerProp> }): ColumnDef[] {
  if (!def?.properties) return []
  return Object.entries(def.properties).map(([name, p]) => ({
    name,
    type: p.type ?? '',
    format: p.format ?? '',
    description: (p.description ?? '').replace(/\s+/g, ' ').trim(),
  }))
}

/** Recursively replace values with their type so we capture the SHAPE of a
 *  json blob without leaking any actual data. */
function shapeOf(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.length && depth < 6 ? [shapeOf(v[0], depth + 1)] : []
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = shapeOf((v as Record<string, unknown>)[k], depth + 1)
    }
    return out
  }
  return `<${typeof v}>`
}

async function countRows(table: string, apply?: (q: any) => any): Promise<number | null> {
  const built = builtClient()
  let q = built.from(table).select('*', { head: true, count: 'exact' })
  if (apply) q = apply(q)
  const { count, error } = await q
  if (error) return null
  return count ?? 0
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const built = builtClient()
  const defs = await fetchOpenApiDefinitions()

  const schema: Record<string, { rowCount: number | null; exists: boolean; columns: ColumnDef[] }> = {}

  for (const table of IN_SCOPE) {
    const columns = columnsFromDef(defs[table])
    const exists = columns.length > 0
    const rowCount = exists ? await countRows(table) : null
    schema[table] = { rowCount, exists, columns }
    console.log(
      `${table.padEnd(20)} ${exists ? `${columns.length} cols` : 'NOT FOUND'} ${
        rowCount != null ? `· ${rowCount} rows` : ''
      }`,
    )
  }

  // ── Estimate-format split on subprojects ──
  const subCols = new Set(schema['subprojects']?.columns.map((c) => c.name) ?? [])
  const has = (c: string) => subCols.has(c)
  const split: Record<string, number | null | unknown> = {
    total: schema['subprojects']?.rowCount ?? null,
    v4_spec_lines_json: has('spec_lines_json')
      ? await countRows('subprojects', (q) => q.not('spec_lines_json', 'is', null))
      : 'column absent',
    v2_pricing_lines_json: has('pricing_lines_json')
      ? await countRows('subprojects', (q) => q.not('pricing_lines_json', 'is', null))
      : 'column absent',
    v3_assembly_lines_json_IGNORE: has('assembly_lines_json')
      ? await countRows('subprojects', (q) => q.not('assembly_lines_json', 'is', null))
      : 'column absent',
  }
  // Rows with none of the three json columns set → flat v1 or empty.
  if (has('spec_lines_json') && has('pricing_lines_json') && has('assembly_lines_json')) {
    split['none_flat_v1_or_empty'] = await countRows('subprojects', (q) =>
      q
        .is('spec_lines_json', null)
        .is('pricing_lines_json', null)
        .is('assembly_lines_json', null),
    )
  }

  // Value-stripped shape of one spec_lines_json (structure only, no data).
  if (has('spec_lines_json')) {
    const { data } = await built
      .from('subprojects')
      .select('spec_lines_json')
      .not('spec_lines_json', 'is', null)
      .limit(1)
    const sample = (data || [])[0]?.spec_lines_json
    split['spec_lines_json_shape'] = sample !== undefined ? shapeOf(sample) : null
  }

  writeFileSync(resolve(OUT_DIR, 'schema.json'), JSON.stringify(schema, null, 2))
  writeFileSync(resolve(OUT_DIR, 'estimate-format-split.json'), JSON.stringify(split, null, 2))

  // Human-readable recap.
  const lines: string[] = []
  lines.push('# Built OS schema snapshot')
  lines.push('')
  lines.push('_Generated by scripts/migrate-built/dump-schema.ts. Schema + counts only, no row data._')
  lines.push('')
  lines.push('| Table | Columns | Rows |')
  lines.push('|---|---|---|')
  for (const t of IN_SCOPE) {
    const s = schema[t]
    lines.push(`| \`${t}\` | ${s.exists ? s.columns.length : 'NOT FOUND'} | ${s.rowCount ?? '—'} |`)
  }
  lines.push('')
  lines.push('## Estimate format split (subprojects)')
  lines.push('')
  lines.push('```json')
  lines.push(
    JSON.stringify(
      Object.fromEntries(Object.entries(split).filter(([k]) => k !== 'spec_lines_json_shape')),
      null,
      2,
    ),
  )
  lines.push('```')
  lines.push('')
  lines.push('> Translate `spec_lines_json` (v4) and `pricing_lines_json` (v2); **ignore** `assembly_lines_json` (v3 engine was deleted). `none_flat_v1_or_empty` rows are legacy flat v1 or empty.')
  writeFileSync(resolve(OUT_DIR, 'SUMMARY.md'), lines.join('\n'))

  console.log(`\nWrote snapshot → ${OUT_DIR}`)
}

main().catch((err) => {
  console.error('\nSchema dump failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})

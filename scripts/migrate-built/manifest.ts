// ============================================================================
// scripts/migrate-built/manifest.ts — selective migration manifest (6c)
// ============================================================================
// Andrew's rule: NO full run. Only the jobs he picks come across. The manifest
// (scripts/migrate-built/manifest.json, gitignored) is the single source of
// truth for what gets imported:
//
//   decision: 'import'    → migrate the job fully (project + subs + lines + …)
//   decision: 're-enter'  → migrate the CLIENT only, and dump a reference sheet
//                           (Built scope/specs/price/hours) so Andrew can
//                           rebuild the estimate natively in MillSuite
//   decision: 'skip'      → explicitly excluded (logged)
//   not listed at all     → skipped (logged), same as 'skip'
//
// Each row also carries Built-side checksums (expected_price / expected_hours)
// that the script verifies after import so silent drift can't slip through.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type ManifestDecision = 'import' | 're-enter' | 'skip'

export interface ManifestJob {
  /** Which Built table the id lives in. */
  entity: 'lead' | 'project'
  built_id: string
  name: string
  decision: ManifestDecision
  /** Built bid total — imported bid_total must match (flagged if it drifts). */
  expected_price?: number | null
  /** Built total dept hours — imported hours must match. */
  expected_hours?: number | null
  /** Milestone count in Built; 0 = Andrew records payments-to-date by hand. */
  milestones?: number | null
}

export interface Manifest {
  path: string
  jobs: ManifestJob[]
  byId: Map<string, ManifestJob>
  /** Built's effective shop rate — the labor rate used for any imported job
   *  where Built recorded no locked_shop_rate. NOT MillSuite's org rate:
   *  costing an imported job at MillSuite's current rate inflates its labor
   *  and silently reprices work the client already signed. */
  builtShopRate: number | null
  /** Built's consumables markup %. Imported subprojects are stamped with this
   *  so they price at Built's 10%, not MillSuite's org default (15%). */
  builtConsumablesPct: number | null
}

export const MANIFEST_PATH = join(__dirname, 'manifest.json')

/**
 * Load the manifest. Returns null when the file is absent — callers decide
 * whether that's fatal (it is for a real run; the script refuses to migrate
 * anything without an explicit pick list).
 */
export function loadManifest(path: string = MANIFEST_PATH): Manifest | null {
  if (!existsSync(path)) return null
  let parsed: any
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(
      `manifest.json is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  const rows: any[] = Array.isArray(parsed?.jobs) ? parsed.jobs : []
  const jobs: ManifestJob[] = []
  for (const [i, r] of rows.entries()) {
    if (!r?.built_id) throw new Error(`manifest.json jobs[${i}] is missing built_id`)
    const decision = String(r.decision ?? 'skip') as ManifestDecision
    if (!['import', 're-enter', 'skip'].includes(decision)) {
      throw new Error(
        `manifest.json jobs[${i}] (${r.name ?? r.built_id}) has unknown decision "${r.decision}" — use import | re-enter | skip`,
      )
    }
    jobs.push({
      entity: r.entity === 'lead' ? 'lead' : 'project',
      built_id: String(r.built_id),
      name: String(r.name ?? r.built_id),
      decision,
      expected_price: r.expected_price == null ? null : Number(r.expected_price),
      expected_hours: r.expected_hours == null ? null : Number(r.expected_hours),
      milestones: r.milestones == null ? null : Number(r.milestones),
    })
  }
  const builtShopRate =
    parsed?.built_shop_rate == null ? null : Number(parsed.built_shop_rate) || null
  const builtConsumablesPct =
    parsed?.built_consumables_pct == null ? null : Number(parsed.built_consumables_pct)
  return {
    path,
    jobs,
    byId: new Map(jobs.map((j) => [j.built_id, j])),
    builtShopRate,
    builtConsumablesPct,
  }
}

export function jobsWithDecision(m: Manifest, decision: ManifestDecision): ManifestJob[] {
  return m.jobs.filter((j) => j.decision === decision)
}

/** Built ids to import, by table. */
export function importIds(m: Manifest, entity: 'lead' | 'project'): string[] {
  return m.jobs.filter((j) => j.decision === 'import' && j.entity === entity).map((j) => j.built_id)
}

/** Ids whose CLIENT should still come across ('import' + 're-enter'). */
export function clientBearingIds(m: Manifest): Set<string> {
  return new Set(
    m.jobs.filter((j) => j.decision !== 'skip').map((j) => j.built_id),
  )
}

export function describeManifest(m: Manifest): string {
  const n = (d: ManifestDecision) => jobsWithDecision(m, d).length
  const rate = m.builtShopRate ? ` · Built rate $${m.builtShopRate}/hr` : ''
  return `${m.jobs.length} listed · ${n('import')} import · ${n('re-enter')} re-enter · ${n('skip')} skip${rate}`
}

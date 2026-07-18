// ============================================================================
// scripts/migrate-built/cli.ts — flag parsing for the migration script
// ============================================================================
// Flags:
//   --dry-run            print the plan; write nothing (default OFF, but the
//                        scaffold main treats "no --write" conservatively)
//   --entity <name>      limit to one entity (client|project|subproject|...)
//   --project <built-id> single-project test (one Built project + its children)
//   --limit <N>          cap rows per entity (for quick test passes)
// ============================================================================

export interface CliOptions {
  dryRun: boolean
  entity: string | null
  project: string | null
  limit: number | null
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliOptions {
  const opts: CliOptions = { dryRun: false, entity: null, project: null, limit: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    // Support both "--flag value" and "--flag=value".
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const inlineVal = eq === -1 ? null : arg.slice(eq + 1)
    const next = () => inlineVal ?? argv[++i] ?? ''

    switch (key) {
      case '--dry-run':
        opts.dryRun = true
        break
      case '--entity':
        opts.entity = next()
        break
      case '--project':
        opts.project = next()
        break
      case '--limit': {
        const n = parseInt(next(), 10)
        opts.limit = Number.isFinite(n) ? n : null
        break
      }
      default:
        if (key.startsWith('--')) {
          console.warn(`Unknown flag ignored: ${key}`)
        }
    }
  }
  return opts
}

export function describeOptions(o: CliOptions): string {
  const parts = [
    o.dryRun ? 'DRY-RUN (no writes)' : 'LIVE (writes enabled)',
    o.entity ? `entity=${o.entity}` : 'all entities',
    o.project ? `project=${o.project}` : null,
    o.limit != null ? `limit=${o.limit}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

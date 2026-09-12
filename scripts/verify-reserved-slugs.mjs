// ============================================================================
// verify-reserved-slugs.mjs — every app route must be a reserved slug.
// ============================================================================
// Run: node scripts/verify-reserved-slugs.mjs
//
// ⛔ WHY. `lib/auth-context` treats ANY unreserved first URL segment as an org
// slug, and therefore as a PUBLIC path — so an app route missing from
// RESERVED_SLUGS silently stops redirecting logged-out visitors to /login, and
// becomes claimable as a shop slug at signup. On 2026-09-12 THREE routes were
// missing (`payments`, `pm`, `tasks`) — every route added in the preceding
// week. The list is maintained by hand, so it rots exactly when the app grows.
//
// This reads the filesystem, not a second hand-written list, so it cannot
// drift from what actually ships.
// ============================================================================

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const routes = readdirSync(join(root, 'app', '(app)'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  // Route groups "(x)" and private folders "_x" aren't URL segments.
  // Route groups "(x)" and private folders "_x" aren't URL segments, and a
  // dynamic "[shop]" IS the org-slug route this list exists to protect.
  .filter((n) => !n.startsWith('(') && !n.startsWith('_') && !n.startsWith('['))

// Every OTHER route group's top-level folders are URL segments too. Read the
// groups from disk rather than naming them — app/(portal) was missed when this
// listed "(app)" and "(marketing)" by hand, which is the same rot the script
// exists to catch.
const groups = readdirSync(join(root, 'app'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('(') && e.name !== '(app)')
  .map((e) => e.name)

const marketing = groups.flatMap((g) =>
  readdirSync(join(root, 'app', g), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !n.startsWith('(') && !n.startsWith('_') && !n.startsWith('[')),
)

const src = readFileSync(join(root, 'lib', 'reserved-slugs.ts'), 'utf8')
const listed = new Set([...src.matchAll(/'([a-z0-9-]+)',/g)].map((m) => m[1]))

const missing = [...routes, ...marketing].filter((r) => !listed.has(r))

if (missing.length) {
  console.log('❌ FAIL — app routes missing from RESERVED_SLUGS:\n')
  for (const m of missing) console.log(`   ${m}`)
  console.log('\nAdd them to lib/reserved-slugs.ts. Until you do, each one is')
  console.log('treated as a public shop-login path and is claimable as a slug.')
  process.exit(1)
}

console.log(
  `PASS — all ${routes.length + marketing.length} route segments are reserved.`,
)

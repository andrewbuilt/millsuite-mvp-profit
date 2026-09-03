// ============================================================================
// scripts/verify-migration.mjs — prove a migration actually landed on prod
// ============================================================================
//   node --env-file=.env.local scripts/verify-migration.mjs \
//     orgs:estimate_template_default,estimate_cover_stats \
//     projects:estimate_template,estimate_headline
//
// ⛔ WHY THIS EXISTS. A migration reporting "Success" in the Supabase SQL
// editor does NOT mean it ran. Our migrations are wrapped in BEGIN…COMMIT, so
// a failure anywhere rolls the whole thing back — and if the editor executed
// only a selected fragment, you get a success message and no schema change.
// That happened on 093: the tables were simply absent afterwards, and the only
// reason anyone noticed was a check like this one.
//
// It asks PostgREST for the columns BY NAME with the public key. A 200 means
// they're in the schema cache and the app can actually see them; a 42703 or
// PGRST205 means they aren't there, whatever the editor said. `limit=0` so no
// row data crosses the wire and RLS is irrelevant — this is a schema question.
//
// Read-only.
// ============================================================================

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  console.error('Run with:  node --env-file=.env.local scripts/verify-migration.mjs <table:col,col> …')
  process.exit(1)
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node --env-file=.env.local scripts/verify-migration.mjs <table:col,col> [more…]')
  console.error('   eg: … projects:sold_at project_events:id,event_type')
  process.exit(1)
}

let failed = 0
for (const t of targets) {
  const [table, cols] = t.split(':')
  if (!table) continue
  // A bare table name still proves the TABLE exists, which is the 093 case.
  const select = cols ? `id,${cols}` : 'id'
  const res = await fetch(`${url}/rest/v1/${table}?select=${select}&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (res.status === 200) {
    console.log(`PASS  ${table}${cols ? ` — ${cols.split(',').join(', ')}` : ''}`)
  } else {
    failed++
    const body = (await res.text()).slice(0, 160)
    console.log(`FAIL  ${table}  [${res.status}] ${body}`)
  }
}

console.log(
  failed === 0
    ? '\nVerified — every table and column is in the schema cache.'
    : `\n${failed} check(s) FAILED. The migration did not fully land — re-run it with NOTHING selected in the SQL editor.`,
)
process.exit(failed ? 1 : 0)

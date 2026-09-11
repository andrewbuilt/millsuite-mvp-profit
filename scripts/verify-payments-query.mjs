// ============================================================================
// scripts/verify-payments-query.mjs — does the /payments query PARSE on the server?
// ============================================================================
//   node --env-file=.env.local scripts/verify-payments-query.mjs
//
// Read-only, anon key, no session.
//
// ⛔ WHAT THIS PROVES, AND WHAT IT DOESN'T.
// `projects!inner(...)` plus a filter on the EMBEDDED table
// (`projects.stage=in.(...)`) is PostgREST syntax, not TypeScript. `tsc` will
// happily compile a select string that the server rejects outright, and the
// failure only appears at runtime as an empty page. This asks the real
// database whether the query resolves:
//
//     200 → the relationship and the embedded filter both resolve.  ✅
//     400 → the syntax is wrong (bad relationship name, bad filter). ❌
//
// It CANNOT check the numbers: with the anon key and no session, RLS correctly
// returns zero rows. Footing the totals is a live check on the page itself —
// which is the acceptance test the scope note asks for anyway ("month totals
// foot by hand against 2–3 real projects").
// ============================================================================

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const POSTSOLD = ['sold', 'production', 'installed', 'complete']

/** Exactly the select `loadOrgPayments` issues. Keep them in step — the point
 *  of this probe is that THIS string is the one that runs. */
const SELECT =
  'id,project_id,milestone_label,amount,status,expected_date,received_date,' +
  'projects!inner(name,client_name,stage)'

const cases = [
  {
    label: 'embedded join + embedded stage filter (the real query)',
    qs: new URLSearchParams({
      select: SELECT,
      type: 'eq.receivable',
      status: 'neq.cancelled',
      'projects.stage': `in.(${POSTSOLD.join(',')})`,
      limit: '0',
    }),
  },
  {
    label: 'received_date is selectable (no migration needed)',
    qs: new URLSearchParams({ select: 'id,received_date,expected_date', limit: '0' }),
  },
]

let bad = 0
for (const c of cases) {
  const res = await fetch(`${url}/rest/v1/cash_flow_receivables?${c.qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (res.ok) {
    console.log(`ok   ${c.label}  [${res.status}]`)
  } else {
    bad++
    console.log(`FAIL ${c.label}  [${res.status}] ${await res.text()}`)
  }
}

console.log(
  bad
    ? `\n${bad} query/queries REJECTED by PostgREST — fix the select before shipping.`
    : '\nPostgREST accepts the /payments query. (Row counts need a signed-in session; foot the totals on the page.)',
)
process.exit(bad ? 1 : 0)

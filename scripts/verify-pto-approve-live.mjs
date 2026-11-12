// ============================================================================
// verify-pto-approve-live.mjs — can a PTO day for a roster member be written?
// ============================================================================
// Run: npx tsx scripts/verify-pto-approve-live.mjs
// 2026-11-12: approve failed for everyone because prod had a stray FK from
// capacity_overrides.team_member_id to users(id) (roster ids aren't login ids).
// This inserts ONE row dated 2099-01-05 for a real roster member of every shop
// with pending/approved PTO (service key — tests constraints, not RLS) and
// deletes it immediately. Also: lib/error-text must render PostgREST objects.
// ============================================================================
import fs from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub'
const { errorText } = await import('../lib/error-text.ts')
let bad = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) bad++ }

ok(errorText({ message: 'boom', details: 'Key x', code: '23503' }) === 'boom — Key x (23503)', 'a PostgREST error object reaches the banner with its code')
ok(errorText(new Error('worded')) === 'worded', 'an Error keeps its message')
ok(errorText(undefined, 'fallback') === 'fallback', 'nothing → fallback')
const team = fs.readFileSync('app/(app)/team/page.tsx', 'utf8')
ok(!/e instanceof Error \? e\.message : 'Could not (approve|deny) that request\.'/.test(team), '/team no longer swallows approve/deny errors')
const pto = fs.readFileSync('lib/pto.ts', 'utf8')
ok(!/if \((error|updErr)\) throw (error|updErr)\b/.test(pto), 'lib/pto never throws a raw PostgREST object')

const { createClient } = await import('@supabase/supabase-js')
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: reqs } = await sb.from('pto_requests').select('org_id, team_member_id').limit(500)
const seen = new Set()
for (const r of reqs || []) {
  if (seen.has(r.org_id)) continue
  seen.add(r.org_id)
  const { data, error } = await sb
    .from('capacity_overrides')
    .insert({ org_id: r.org_id, override_date: '2099-01-05', team_member_id: r.team_member_id, reason: 'PTO', hours_reduction: 8, is_full_day: true })
    .select('id')
  if (data?.[0]) await sb.from('capacity_overrides').delete().eq('id', data[0].id)
  ok(!error, `org ${r.org_id.slice(0, 8)}: a roster member's PTO day writes${error ? ` — ${errorText(error)}` : ''}`)
}
console.log(bad ? `\nFAIL — ${bad}` : '\nPASS')
process.exit(bad ? 1 : 0)

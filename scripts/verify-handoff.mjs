// ============================================================================
// verify-handoff.mjs — the pre-production handoff gate + project notes (125)
// ============================================================================
// Run: npx tsx scripts/verify-handoff.mjs     (pure + static, no database)
//
// PURE  — handoffMissing: what counts as a contact, ASAP is a deadline,
//         whitespace isn't, imported jobs are never gated. Mentions: only
//         people still written in the note, never yourself; highlighting.
// STATIC — the ONE rule is asked by the gate (isReadyForProduction), the
//         kanban bounce and the pre-prod rail; the notes pane is on both
//         project pages; the strip is on /pm and /me; the badge is in the
//         nav; the portal never touches the notes tables; RLS is in 125 and
//         the audit lists both tables.
// ============================================================================

import fs from 'fs'
import { execSync } from 'child_process'

let failures = 0
let checks = 0
const ok = (cond, msg) => {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// lib/supabase builds a client at import; nothing here touches the network.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused'
const { handoffMissing, handoffMissingPhrase } = await import('../lib/handoff.ts')
const { mentionsInBody, splitMentions } = await import('../lib/project-comments.ts')

console.log('PURE — the handoff rule')
const full = { poc_name: 'Dana Luka', poc_phone: '555-0100', delivery_address: '12 Elm St', client_deadline: 'ASAP' }
ok(eq(handoffMissing(full), []), 'name + phone + address + "ASAP" is complete')
ok(eq(handoffMissing({ ...full, poc_phone: null, poc_email: 'd@x.com' }), []), 'an email instead of a phone counts')
ok(eq(handoffMissing({ ...full, poc_phone: '' }), ['contact']), 'a name with no phone or email is not a contact')
ok(eq(handoffMissing({ ...full, poc_name: '  ' }), ['contact']), 'a blank name is not a contact')
ok(eq(handoffMissing({ ...full, delivery_address: null }), ['address']), 'no jobsite address gates')
ok(eq(handoffMissing({ ...full, client_deadline: '   ' }), ['deadline']), 'a whitespace deadline gates')
ok(eq(handoffMissing({}), ['contact', 'address', 'deadline']), 'an empty sheet lists all three, in order')
ok(eq(handoffMissing({ imported_at: '2026-07-17' }), []), 'imported jobs are never gated')
ok(eq(handoffMissing({ ...full, site_access_notes: null }), []), 'site access never gates')
ok(eq(handoffMissing(null), []), 'no project → nothing to say')
ok(handoffMissingPhrase(['contact', 'deadline']) === 'the point of contact and client deadline are missing', 'bounce phrase reads in the shop\'s words')
ok(handoffMissingPhrase(['address']) === 'the jobsite address is missing', 'singular phrase')

console.log('PURE — mentions')
const kay = { userId: 'u-kay', name: 'Kaylin Price' }
const evan = { userId: 'u-evan', name: 'Evan Otero' }
ok(eq(mentionsInBody('@Kaylin Price can you call?', [kay], 'u-me'), ['u-kay']), 'a picked, written mention lands')
ok(eq(mentionsInBody('never mind', [kay], 'u-me'), []), 'deleting the @text un-mentions')
ok(eq(mentionsInBody('@Kaylin Price @Kaylin Price', [kay, kay], 'u-me'), ['u-kay']), 'one mention per person')
ok(eq(mentionsInBody('@Kaylin Price', [kay], 'u-kay'), []), 'never yourself')
ok(eq(mentionsInBody('@Evan Otero and @Kaylin Price', [kay, evan], 'u-me').sort(), ['u-evan', 'u-kay']), 'two people')
const parts = splitMentions('ping @Kaylin Price re: keypad', ['Kaylin Price', 'Kaylin'])
ok(eq(parts.map((p) => p.mention), [false, true, false]) && parts[1].text === '@Kaylin Price', 'longest name wins when highlighting')

console.log('STATIC — wiring')
const read = (f) => fs.readFileSync(f, 'utf8')
const stage = read('lib/project-stage.ts')
ok(/if \(\(await loadHandoffGaps\(projectId\)\)\.length > 0\) return false/.test(stage), 'isReadyForProduction asks the handoff rule')
ok(!/loadHandoffGaps/.test(stage.slice(stage.indexOf('export async function forceStartProduction'))), 'the approval override is unchanged (imports bypass)')
const kanban = read('app/(app)/projects/page.tsx')
ok(/handoffMissing\(r\)/.test(kanban) && /handoffMissingPhrase\(e\.handoffGaps\)/.test(kanban), 'the kanban computes gaps and says them on a bounce')
ok(/dep && !\(gapsById\[p\.id\] \|\| \[\]\)\.length/.test(kanban), 'the kanban\'s ready flag includes the handoff')
const preprod = read('app/(app)/projects/[id]/pre-production/page.tsx')
ok(/<HandoffCard/.test(preprod) && /handoffMissing\(project\)/.test(preprod), 'pre-prod shows the card and puts gaps on the rail')
ok(/<ProjectNotes projectId=\{projectId\}/.test(preprod), 'notes on the pre-production page')
ok(/<ProjectNotes projectId=\{projectId\}/.test(read('app/(app)/projects/[id]/page.tsx')), 'notes on the project page')
ok(/<MentionsStrip \/>/.test(read('app/(app)/pm/page.tsx')), 'mentions strip on /pm')
ok(/<MentionsStrip \/>/.test(read('app/(app)/me/page.tsx')), 'mentions strip on /me (workers can be mentioned)')
ok(/<MentionsBadge \/>/.test(read('components/top-nav.tsx')), 'mentions badge in the nav')
const portalHits = execSync(
  `grep -rlE "project_comment|ProjectNotes|listProjectComments" app/portal "app/(portal)" app/api/portal lib/client-portal.ts 2>/dev/null || true`,
  { encoding: 'utf8' },
).trim()
ok(portalHits === '', `the client portal never reads notes (${portalHits})`)
const mig = read('db/migrations/125_november_batch.sql')
for (const t of ['project_comments', 'project_comment_mentions'])
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(mig), `125 turns on RLS for ${t}`)
ok(/comment_mentions_update[\s\S]*user_id = \(SELECT u\.id FROM public\.users u WHERE u\.auth_user_id = auth\.uid\(\)/.test(mig), 'only the mentioned person can close a mention out')
ok(/project_comments_delete[\s\S]*author_id = \(SELECT u\.id/.test(mig), 'only the author can delete a note')
for (const c of ['poc_name', 'poc_phone', 'poc_email', 'client_deadline', 'site_access_notes'])
  ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}`).test(mig), `125 adds projects.${c}`)
const audit = read('scripts/rls-audit.mjs')
ok(/project_comments project_comment_mentions/.test(audit), 'the RLS audit lists both new tables')

console.log(failures === 0 ? `\nPASS — ${checks} checks` : `\nFAIL — ${failures} of ${checks}`)
process.exit(failures === 0 ? 0 : 1)

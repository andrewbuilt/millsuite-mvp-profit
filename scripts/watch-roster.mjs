// Polls orgs.team_members and prints every change, with a timestamp.
// Run it, then make an edit in the app — this shows whether the write reaches
// the database at all, and whether anything writes over it afterwards.
//   node scripts/watch-roster.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const ORG = '85b67e22-ebf4-4d78-94e8-3b1c73ca702f'

const fingerprint = (team) =>
  (team || [])
    .map((m) => `${m.name}|${m.title ?? ''}|${m.email ?? ''}|${m.hours_per_week ?? ''}|${m.active}`)
    .join('\n')

let last = null
let ticks = 0
console.log('watching orgs.team_members — make your edit now (Ctrl-C to stop)\n')

for (;;) {
  const { data, error } = await sb.from('orgs').select('team_members').eq('id', ORG).single()
  const stamp = new Date().toISOString().slice(11, 19)
  if (error) {
    console.log(`${stamp}  read error: ${error.message}`)
  } else {
    const fp = fingerprint(data.team_members)
    if (last === null) {
      console.log(`${stamp}  baseline captured (${(data.team_members || []).length} members)`)
      last = fp
    } else if (fp !== last) {
      const before = last.split('\n')
      const after = fp.split('\n')
      console.log(`${stamp}  ✏️  CHANGED`)
      for (let i = 0; i < Math.max(before.length, after.length); i++) {
        if (before[i] !== after[i]) {
          console.log(`            was: ${before[i] ?? '(none)'}`)
          console.log(`            now: ${after[i] ?? '(none)'}`)
        }
      }
      last = fp
    }
  }
  ticks++
  if (ticks % 30 === 0) console.log(`${stamp}  …still watching, no change`)
  await new Promise((r) => setTimeout(r, 1000))
}

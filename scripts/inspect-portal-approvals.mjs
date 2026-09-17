// ============================================================================
// inspect-portal-approvals.mjs — READ ONLY. Why doesn't a project's portal
// show its approvals box?
// ============================================================================
// Run: npx tsx scripts/inspect-portal-approvals.mjs killinger
//
// The portal's "Approvals & selections" card renders iff loadApprovals()
// returns rows, and that reads ONE table: approval_items, joined through the
// project's subprojects. So the box being missing means one of exactly four
// things, and this prints which:
//   1. the project isn't portal-visible at all (stage / practice_at / client)
//   2. the project has no subprojects
//   3. the subprojects have no approval_items rows
//   4. the rows exist and the bug is in rendering (then it IS a code bug)
// It also prints drawing_revisions, because "the approvals box" in Andrew's
// head may include drawing approvals — which the portal shows only under
// Documents, never in the approvals card.
// ============================================================================

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
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const needle = process.argv[2] || 'killinger'
const CLIENT_VISIBLE_STAGES = new Set(['sold', 'production', 'installed', 'complete'])

const { data: projects } = await db
  .from('projects')
  .select('id, name, stage, practice_at, client_id, org_id, delivery_address, created_at')
  .ilike('name', `%${needle}%`)

if (!projects?.length) {
  console.log(`No project matching "${needle}".`)
  process.exit(0)
}

for (const p of projects) {
  console.log(`\n━━ ${p.name} (${p.id})`)
  console.log(`   stage=${p.stage}  practice_at=${p.practice_at ?? 'null'}  client_id=${p.client_id ?? 'NULL ⛔'}`)

  // 1. Portal visibility — the same gates authorizePortalProject applies.
  const gates = []
  if (!CLIENT_VISIBLE_STAGES.has(p.stage)) gates.push(`stage "${p.stage}" not client-visible`)
  if (p.practice_at) gates.push('practice project')
  if (!p.client_id) gates.push('no client_id — token can never match')
  if (gates.length) {
    console.log(`   ⛔ NOT PORTAL-VISIBLE: ${gates.join(' · ')} — the portal 404s before approvals matter.`)
  } else {
    console.log('   ✅ portal-visible')
  }

  if (p.client_id) {
    const { data: client } = await db
      .from('clients')
      .select('id, name, portal_token, portal_token_issued_at')
      .eq('id', p.client_id)
      .maybeSingle()
    console.log(
      client?.portal_token
        ? `   client "${client.name}": portal token issued ${client.portal_token_issued_at ?? '(no timestamp)'}`
        : `   ⛔ client ${client?.name ?? p.client_id}: NO portal token minted`,
    )
  }

  // 2. Subprojects.
  const { data: subs } = await db
    .from('subprojects')
    .select('id, name, created_at')
    .eq('project_id', p.id)
  console.log(`   subprojects: ${subs?.length ?? 0}`)
  if (!subs?.length) {
    console.log('   ⛔ no subprojects → loadApprovals returns [] → no approvals box. Done.')
    continue
  }
  const subIds = subs.map((s) => s.id)
  const subName = new Map(subs.map((s) => [s.id, s.name]))

  // 3. approval_items — the ONLY source of the portal approvals card.
  const { data: items } = await db
    .from('approval_items')
    .select('id, subproject_id, label, material, finish, state, ball_in_court, last_state_change_at')
    .in('subproject_id', subIds)
  if (!items?.length) {
    console.log('   ⛔ ZERO approval_items rows → the portal approvals card has nothing to render.')
  } else {
    console.log(`   approval_items: ${items.length}`)
    for (const i of items) {
      console.log(
        `     · [${i.state}${i.ball_in_court ? ` / ball=${i.ball_in_court}` : ''}] ${i.label}` +
          `${[i.material, i.finish].filter(Boolean).length ? ` (${[i.material, i.finish].filter(Boolean).join(' · ')})` : ''}` +
          `  sub=${subName.get(i.subproject_id) ?? i.subproject_id}`,
      )
    }
    console.log('   ✅ rows exist — if the box still does not render, the bug is in code, not data.')
  }

  // 4. Drawing revisions — visible in-app as approvals, but the portal shows
  //    them only in Documents. If these exist and approval_items don't, the
  //    "missing box" is a modelling gap, not a query bug.
  const { data: drawings } = await db
    .from('drawing_revisions')
    .select('id, subproject_id, revision_number, state, is_latest, file_url')
    .in('subproject_id', subIds)
  if (drawings?.length) {
    console.log(`   drawing_revisions: ${drawings.length}`)
    for (const d of drawings) {
      console.log(
        `     · Rev ${d.revision_number} [${d.state}${d.is_latest ? ', latest' : ''}]` +
          ` file=${d.file_url ? 'yes' : 'NO'}  sub=${subName.get(d.subproject_id) ?? d.subproject_id}`,
      )
    }
  } else {
    console.log('   drawing_revisions: 0')
  }
}

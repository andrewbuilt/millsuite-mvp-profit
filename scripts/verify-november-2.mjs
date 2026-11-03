// ============================================================================
// verify-november-2.mjs — November batch 2 (items 4, 6, 7 and B)
// ============================================================================
// Run: npx tsx scripts/verify-november-2.mjs     (pure + static, no database)
// Item 5 lives in verify-reviews.mjs; C in verify-capacity-lens.mjs.
// ============================================================================

import fs from 'fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused'

let failures = 0
let checks = 0
const ok = (cond, msg) => {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}
const read = (f) => fs.readFileSync(f, 'utf8')

const { selfEditPatch, snapshotOf } = await import('../lib/worker-time.ts')
const { canHardDelete, describeHistory, historyTotal, isActiveMember } = await import('../lib/team-lifecycle.ts')

console.log('PURE — #7 crew self-edits')
const e = {
  id: 'e1', org_id: 'o', user_id: 'u', project_id: 'p1', subproject_id: 's1', department_id: 'd1',
  started_at: '2026-11-02T13:00:00.000Z', ended_at: '2026-11-02T21:00:00.000Z', duration_minutes: 480,
  notes: null, created_at: 'x', needs_review: false, edit_before: null,
}
const p1 = selfEditPatch(e, { duration_minutes: 390 }, 'u', 'NOW')
ok(p1.needs_review === true && p1.edited_by === 'u' && p1.edited_at === 'NOW', 'a self-edit stamps who + flags it')
ok(JSON.stringify(p1.edit_before) === JSON.stringify(snapshotOf(e)), 'first edit remembers the original')
ok(p1.ended_at === '2026-11-02T19:30:00.000Z', 'hours change keeps the span consistent')
const flagged = { ...e, duration_minutes: 390, needs_review: true, edit_before: snapshotOf(e) }
const p2 = selfEditPatch(flagged, { department_id: 'd2' }, 'u', 'NOW')
ok(p2.edit_before.duration_minutes === 480 && p2.edit_before.department_id === 'd1', 'a second unreviewed edit keeps the ORIGINAL, not the middle')
ok(!('duration_minutes' in p2), 'a dept-only edit leaves hours alone')
const p3 = selfEditPatch(e, { duration_minutes: 0 }, 'u', 'NOW')
ok(p3.duration_minutes === 0 && p3.needs_review === true, 'Remove = 0h + flagged, not a delete')

console.log('PURE — B lifecycle')
const none = { timeEntries: 0, tasks: 0, ptoRequests: 0, ptoDays: 0, reviews: 0, notes: 0, comments: 0 }
ok(isActiveMember({}) && isActiveMember({ active: true }) && !isActiveMember({ active: false }), 'active undefined = active')
ok(canHardDelete({ user_id: null }, none), 'typo row (no history, no login) → deletable')
ok(!canHardDelete({ user_id: 'x' }, none), 'has a login → not deletable')
ok(!canHardDelete({ user_id: null }, { ...none, timeEntries: 1 }), 'has time → not deletable')
ok(!canHardDelete({ user_id: null }, null), 'history unknown (loading/failed) → not deletable')
ok(historyTotal({ ...none, tasks: 2, notes: 1 }) === 3, 'history total')
ok(describeHistory({ ...none, timeEntries: 12, tasks: 1 }) === '12 time entries · 1 task', 'history reads plainly')

console.log('STATIC')
const lc = read('lib/team-lifecycle.ts')
ok(/return error \? 1 : n \|\| 0/.test(lc), 'a failed history count blocks Delete')
const team = read('app/(app)/team/page.tsx')
ok(!/from\('users'\)\.delete\(\)/.test(team), '/team never deletes a users row from the browser')
ok(/<LifecycleControls/.test(team) && /action: 'set_login_disabled'/.test(team), '/team deactivates via the lifecycle controls + disables the login')
ok(/<MemberModal/.test(team), '#2 member editor is a modal')
ok(/isActiveMember\(m\) && \(m\.dept_assignments/.test(team), 'dept cards count active people only')
const api = read('app/api/admin/users/route.ts')
ok(/action === 'set_login_disabled'[\s\S]*?checkAuthorityOver[\s\S]*?ban_duration/.test(api), 'disable-login is authority-checked and bans (not deletes)')
const settings = read('app/(app)/settings/page.tsx')
ok(!/removeTeamMember|addTeamMember/.test(settings) && /href="\/team"/.test(settings), 'Settings no longer adds/removes people — points to /team')
ok(/m\.active !== false && m\.name/.test(read('components/team/HolidaysAndPtoSection.tsx')), 'manual PTO picker: active only')
ok(/roster\.filter\(\(r\) => r\.active/.test(read('app/(app)/time/page.tsx')), '/time member filter: active only')
ok(/!m\.billable \|\| m\.active === false/.test(read('lib/schedule-seed.ts')), 'schedule seeding headcount: active only')
ok(/listAssignees\(orgId\)\)\.some/.test(read('lib/auto-tasks.ts')), 'auto-tasks skip a deactivated coordinator')
const tr = read('components/tasks/TaskRow.tsx')
ok(/draggable=\{dragArmed\}/.test(tr) && /<GripVertical/.test(tr) && /<textarea/.test(tr), '#3 drag from the grip only; title edit is a textarea')
const cf = read('components/me/clockin-flow.tsx')
ok(/deptOptions=\{timer\.subprojectId \? deptOptions : undefined\}/.test(cf), '#4 multi-dept picker on the clock-in sheet')
const dt = read('components/drawings-track.tsx')
ok(/Submit Rev \{nextN\}/.test(dt) && /submitNextRevision/.test(dt) && !/UploadRevisionModal/.test(dt), '#6 rev counter replaces the upload flow')
ok(/approveRevision\(latest\.id\)/.test(dt) && /isDrawingsGateGreen/.test(dt), '#6 Accepted approves the latest (gate unchanged)')
const mig = read('db/migrations/127_november_batch_2.sql')
ok(/needs_review boolean NOT NULL DEFAULT false/.test(mig) && /edit_before jsonb/.test(mig) && /NOTIFY pgrst/.test(mig), '127 adds the crew-edit flag')
ok(/<CrewEdits/.test(read('app/(app)/time/page.tsx')), '#7 /time shows the crew edits strip')
ok(!/updateEntryMinutes|deleteEntry\(/.test(read('components/me/tabs.tsx')), '#7 /me has no silent edit/delete left')

console.log(failures === 0 ? `\nPASS — ${checks} checks` : `\nFAIL — ${failures} of ${checks}`)
process.exit(failures === 0 ? 0 : 1)

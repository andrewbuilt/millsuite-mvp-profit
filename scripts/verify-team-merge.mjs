// Verifies lib/team-merge against the scenarios that actually broke.
//   npx tsx scripts/verify-team-merge.mjs
import { mergeTeam } from '../lib/team-merge'

const M = (id, over = {}) => ({
  id,
  name: id,
  annual_comp: 0,
  billable: true,
  dept_assignments: [],
  user_id: null,
  email: null,
  phone: null,
  title: null,
  start_date: null,
  hours_per_week: undefined,
  active: true,
  tasks_enabled: true,
  ...over,
})

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${e}\n       actual   ${a}`)
}
const titles = (team) => team.map((m) => `${m.id}:${m.title}`)
const comps = (team) => team.map((m) => `${m.id}:${m.annual_comp}`)

// 1. THE LIVE BUG: a stale page writes its whole array over a newer edit.
//    /settings loaded when the title was "sdff", someone changed it to "New
//    test title", then /settings saved a comp edit.
check(
  'stale page does NOT revert a title it never touched',
  titles(
    mergeTeam(
      [M('matt', { title: 'sdff' })], // /settings loaded this
      [M('matt', { title: 'sdff', annual_comp: 80000 })], // it changed comp only
      [M('matt', { title: 'New test title' })], // server moved on
    ),
  ),
  ['matt:New test title'],
)
check(
  '…and its own comp edit still lands',
  comps(
    mergeTeam(
      [M('matt', { title: 'sdff' })],
      [M('matt', { title: 'sdff', annual_comp: 80000 })],
      [M('matt', { title: 'New test title' })],
    ),
  ),
  ['matt:80000'],
)

// 2. The ordinary case: my edit wins when nobody else touched it.
check(
  'my own edit wins',
  titles(mergeTeam([M('a', { title: 'old' })], [M('a', { title: 'mine' })], [M('a', { title: 'old' })])),
  ['a:mine'],
)

// 3. Last-writer-wins on a genuine conflict (both changed the same field).
check(
  'genuine conflict resolves to mine',
  titles(mergeTeam([M('a', { title: 'old' })], [M('a', { title: 'mine' })], [M('a', { title: 'theirs' })])),
  ['a:mine'],
)

// 4. Adds and removes.
check(
  'member I added is appended',
  mergeTeam([M('a')], [M('a'), M('b')], [M('a')]).map((m) => m.id),
  ['a', 'b'],
)
check(
  'member I removed is removed',
  mergeTeam([M('a'), M('b')], [M('a')], [M('a'), M('b')]).map((m) => m.id),
  ['a'],
)
check(
  'member someone else added is kept',
  mergeTeam([M('a')], [M('a', { title: 'mine' })], [M('a'), M('c')]).map((m) => m.id),
  ['a', 'c'],
)

// 5. dept_assignments compare by content, not identity — otherwise every save
//    would claim to have changed them and clobber the other page's toggles.
check(
  'untouched dept_assignments do not override the server',
  mergeTeam(
    [M('a', { dept_assignments: ['d1'] })],
    [M('a', { dept_assignments: ['d1'] })], // same content, new array
    [M('a', { dept_assignments: ['d1', 'd2'] })],
  )[0].dept_assignments,
  ['d1', 'd2'],
)
check(
  'changed dept_assignments DO override',
  mergeTeam(
    [M('a', { dept_assignments: ['d1'] })],
    [M('a', { dept_assignments: ['d1', 'd3'] })],
    [M('a', { dept_assignments: ['d1', 'd2'] })],
  )[0].dept_assignments,
  ['d1', 'd3'],
)

// 6. Clearing a field is a real change, not "untouched".
check(
  'clearing a title is respected',
  titles(mergeTeam([M('a', { title: 'x' })], [M('a', { title: null })], [M('a', { title: 'x' })])),
  ['a:null'],
)

// 7. THE REGRESSION. `tasks_enabled` was added to TeamMember but not to the
// merge's field list, so toggling "Gets tasks" on /team appeared to save and
// then reverted: the merge copied the SERVER's value back over it. An unlisted
// field isn't rejected loudly, it's silently un-edited.
check(
  'toggling tasks_enabled survives the merge',
  mergeTeam(
    [M('a', { tasks_enabled: true })],
    [M('a', { tasks_enabled: false })],
    [M('a', { tasks_enabled: true })],
  )[0].tasks_enabled,
  false,
)

// 8. The generic net for that whole bug class. Change each field in turn and
// assert the edit survives. This derives the field list from a FIXTURE, so it
// stays independent of the allowlist in the source — a field present on a
// member but missing from MERGEABLE_FIELDS fails here even though both are
// "self-consistent". The compile-time Record check is the first net; this is
// the second, and they fail for different reasons.
const CHANGED = {
  name: 'changed',
  annual_comp: 12345,
  billable: false,
  dept_assignments: ['dX'],
  tasks_enabled: false,
  user_id: 'u-changed',
  email: 'changed@example.com',
  phone: '555',
  title: 'changed',
  start_date: '2020-01-01',
  hours_per_week: 7,
  active: false,
}
for (const field of Object.keys(M('a'))) {
  if (field === 'id') continue
  if (!(field in CHANGED)) {
    failures++
    console.log(`FAIL every field survives a merge — no CHANGED value for '${field}'`)
    continue
  }
  const merged = mergeTeam([M('a')], [M('a', { [field]: CHANGED[field] })], [M('a')])[0]
  check(`  ${field} survives a merge`, JSON.stringify(merged[field]), JSON.stringify(CHANGED[field]))
}

console.log(failures === 0 ? '\nall merge cases pass' : `\n${failures} FAILING`)
process.exit(failures ? 1 : 0)

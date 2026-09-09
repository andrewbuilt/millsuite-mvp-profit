// ============================================================================
// scripts/verify-composer-staleness.mjs — when may the banner fire?
// ============================================================================
//   npx tsx --env-file=.env.local scripts/verify-composer-staleness.mjs
//
// Andrew: "This pops up randomly or when any change is made but it usually
// doesn't seem like it makes any sense."
//
// The property that matters most isn't the banner — it's that a line flagged
// stale gets its recomputed numbers WRITTEN BACK by "Update to latest rates".
// So anything that makes the recompute wrong doesn't just annoy, it destroys
// money. These cases pin the two failure modes:
//
//   · an UNRESOLVED slot id (archived material, deleted door type) prices that
//     component at $0, so the line looks stale and a refresh would bank the
//     zero. It must be skipped instead.
//   · an untouched line must NOT be stale, or the banner cries wolf.
// ============================================================================

import { unresolvedSlotIds } from '../lib/composer.ts'

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`)
}

const rb = {
  materials: [{ id: 'm1' }, { id: 'm2' }],
  doorTypes: [{ id: 'dt1' }],
  doorTypeMaterials: [{ id: 'dm1' }],
  doorTypeMaterialFinishes: [{ id: 'df1' }],
  finishes: [{ id: 'f1' }],
  drawerStyles: [{ id: 'ds1' }],
  customProducts: [{ id: 'cp1' }],
  solidWoodComponents: [{ id: 'sw1' }],
}

const allNull = {
  carcassMaterial: null, backPanelMaterial: null, doorTypeId: null,
  doorMaterialId: null, doorFinishId: null, interiorFinish: null,
  drawerStyle: null, customProductId: null, solidWoodMaterialId: null,
}

// A line whose picks all still exist — the normal case. Must be clean, or the
// banner fires on every untouched line.
ck('everything resolves → nothing missing',
  unresolvedSlotIds({ ...allNull, carcassMaterial: 'm1', doorTypeId: 'dt1', doorMaterialId: 'dm1' }, rb),
  [])

// Null slots are a legitimate "none" (open shelving has no door), NOT missing.
ck('null slots are not missing', unresolvedSlotIds(allNull, rb), [])

// The failure that silently zeroes money.
ck('archived carcass material is caught',
  unresolvedSlotIds({ ...allNull, carcassMaterial: 'GONE' }, rb), ['carcass material'])
ck('deleted door type is caught',
  unresolvedSlotIds({ ...allNull, doorTypeId: 'GONE' }, rb), ['door type'])
ck('several at once are all reported',
  unresolvedSlotIds({ ...allNull, carcassMaterial: 'GONE', doorFinishId: 'ALSO-GONE', drawerStyle: 'ds1' }, rb),
  ['carcass material', 'door finish'])

// Every id-bearing slot must be covered — a slot nobody checks is a slot that
// can silently price at zero.
const everySlotBroken = {
  carcassMaterial: 'x', backPanelMaterial: 'x', doorTypeId: 'x', doorMaterialId: 'x',
  doorFinishId: 'x', interiorFinish: 'x', drawerStyle: 'x', customProductId: 'x',
  solidWoodMaterialId: 'x',
}
ck('all nine id slots are covered', unresolvedSlotIds(everySlotBroken, rb).length, 9)

// An empty/absent pool must not be read as "everything resolves".
ck('missing pool counts as unresolved',
  unresolvedSlotIds({ ...allNull, drawerStyle: 'ds1' }, { ...rb, drawerStyles: undefined }),
  ['drawer style'])

console.log(bad ? `\n${bad} FAILING` : '\nall staleness-guard cases pass')
process.exit(bad ? 1 : 0)

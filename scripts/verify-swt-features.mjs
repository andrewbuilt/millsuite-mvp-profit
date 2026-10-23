// ============================================================================
// verify-swt-features.mjs — Solid Wood Top features price the way the spec says
// ============================================================================
// Run: npx tsx scripts/verify-swt-features.mjs        (pure — no database)
//
// Pins lib/swt-features + its fold-in to computeBreakdown (lib/composer):
//   · each / sqft / length_steps arithmetic, incl. the step bracket (ceil),
//     the past-the-last-step tail, and the one-face sqft default
//   · feature hours land in their DEPT and are NOT scaled by BdFt or the edge
//     multiplier; feature material joins the subtotal (consumables apply,
//     stock waste does not); everything × line qty
//   · the client wording is plain
//   · an archived feature makes the line UNRESOLVED (staleness skips it)
// The headline case is Andrew's: a sapele waterfall top — 2 mitered corners
// at 2', hand-rubbed both faces, 2 bowties.
// ============================================================================

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-key-for-verify-script'

const F = await import('../lib/swt-features.ts')
const C = await import('../lib/composer.ts')

let bad = 0
const near = (a, b) => Math.abs(a - b) < 1e-6
const ck = (label, actual, expected) => {
  const ok = typeof expected === 'number' ? near(actual, expected) : actual === expected
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`)
}
const H = (eng, cnc, assembly, finish) => ({ eng, cnc, assembly, finish })

const bowtie = F.normalizeSwtFeature({
  id: 'bow', org_id: 'o', name: 'Bowtie', pricing_mode: 'each',
  hours_eng: 0, hours_cnc: 0.25, hours_assembly: 0.5, hours_finish: 0.1, material_per_unit: 4,
})
const rubbed = F.normalizeSwtFeature({
  id: 'rub', org_id: 'o', name: 'Hand-rubbed finish', pricing_mode: 'sqft',
  hours_finish: 0.3, material_per_unit: 1.5,
})
const miter = F.normalizeSwtFeature({
  id: 'mit', org_id: 'o', name: 'Mitered corner', pricing_mode: 'length_steps',
  // deliberately out of order — normalize sorts
  steps: [
    { up_to_ft: 4, hours: H(0.5, 0, 6, 0.5), material: 20 },
    { up_to_ft: 1, hours: H(0.5, 0, 2, 0.25), material: 5 },
    { up_to_ft: 2, hours: H(0.5, 0, 2.5, 0.25), material: 8 },
  ],
  extra_ft_hours: { assembly: 1.25 }, extra_ft_material: 4,
})

console.log('— pure pricing')
ck('steps sorted ascending', miter.steps.map((s) => s.up_to_ft).join(','), '1,2,4')
ck('each: 2 bowties → assembly 1.0 h', F.priceSwtFeature(bowtie, { featureId: 'bow', qty: 2 }, 0).hours.assembly, 1.0)
ck('each: 2 bowties → $8 material', F.priceSwtFeature(bowtie, { featureId: 'bow', qty: 2 }, 0).material, 8)
ck('sqft default = one face (96×26 → 17.33)', F.defaultSqft(96, 26), 17.33)
ck('sqft blank → uses the default', F.priceSwtFeature(rubbed, { featureId: 'rub', sqft: null }, 10).hours.finish, 3)
ck('sqft typed → uses the typed value', F.priceSwtFeature(rubbed, { featureId: 'rub', sqft: 20 }, 10).hours.finish, 6)
ck('length 2 ft → the 2 ft step (absolute, not ×2)', F.priceSwtFeature(miter, { featureId: 'mit', lengthFt: 2 }, 0).hours.assembly, 2.5)
ck('length 1.2 ft → rounds UP to the 2 ft step', F.priceSwtFeature(miter, { featureId: 'mit', lengthFt: 1.2 }, 0).hours.assembly, 2.5)
ck('length 3 ft → the 4 ft step', F.priceSwtFeature(miter, { featureId: 'mit', lengthFt: 3 }, 0).material, 20)
const six = F.priceSwtFeature(miter, { featureId: 'mit', lengthFt: 6 }, 0)
ck('length 6 ft → 4 ft step + 2 extra ft (assembly 6 + 2.5)', six.hours.assembly, 8.5)
ck('length 6 ft → material 20 + 2×4', six.material, 28)
ck('length 0 → nothing', F.sumHours(F.priceSwtFeature(miter, { featureId: 'mit', lengthFt: 0 }, 0).hours), 0)

console.log('— Andrew’s sapele waterfall top, through computeBreakdown')
const sapele = { id: 'sap', name: 'Sapele 8/4', species: 'Sapele', thickness_quarters: 8, cost_per_bdft: 14, waste_pct: 20 }
const cal = {
  calib_length_in: 96, calib_width_in: 26, calib_thickness_in: 2,
  hours_by_op: { eng_drawing: 0.5, asy_glueup: 2, fin_sanding: 1, fin_apply: 1 },
  edge_mult_hand: 1.5, edge_mult_cnc: 1.2, default_cut_method: 'saw', default_material_id: null,
}
const rb = {
  shopRate: 100,
  doorTypeMaterials: [], doorFinishesByDoorTypeId: new Map(), doorTypeMaterialFinishes: [], drawerStyles: [],
  finishes: [], cabinetFeatures: [], customProducts: [],
  solidWoodTopCalibration: cal, solidWoodComponents: [sapele],
  swtFeatures: [bowtie, rubbed, miter],
}
const slots = (feats) => ({
  ...C.emptySlots(), pieceLengthIn: 96, pieceWidthIn: 26, pieceThicknessIn: 1.75,
  solidWoodMaterialId: 'sap', edgeProfile: 'hand', cutMethod: 'saw', swtFeatures: feats,
})
const defaults = { consumablesPct: 10, wastePct: 5 }
const waterfall = [
  { featureId: 'mit', lengthFt: 2 }, { featureId: 'mit', lengthFt: 2 }, // 2 mitered corners at 2'
  { featureId: 'rub', sqft: F.defaultSqft(96, 26) * 2 },                 // both faces, typed
  { featureId: 'bow', qty: 2 },
]
const plain = C.computeBreakdown({ productId: 'countertop', qty: 1, slots: slots([]) }, rb, defaults)
const full = C.computeBreakdown({ productId: 'countertop', qty: 1, slots: slots(waterfall) }, rb, defaults)
// Feature hours per dept: assembly 2.5+2.5+1.0 = 6.0 · finish 0.25+0.25+0.3×34.67+0.2 · cnc 0.5 · eng 1.0
const sq2 = F.defaultSqft(96, 26) * 2
ck('assembly gains exactly the feature hours (not ×edge 1.5)', full.hoursByDept.assembly - plain.hoursByDept.assembly, 6.0)
ck('finish gains corners + rubbed + bowties', full.hoursByDept.finish - plain.hoursByDept.finish, 0.5 + 0.3 * sq2 + 0.2)
ck('cnc gains the bowties', full.hoursByDept.cnc - plain.hoursByDept.cnc, 0.5)
ck('eng gains the corners', full.hoursByDept.eng - plain.hoursByDept.eng, 1.0)
ck('install stays 0', full.hoursByDept.install, 0)
const featMat = 8 + 8 + 1.5 * sq2 + 8
ck('feature material joins the subtotal', full.materialSubtotal - plain.materialSubtotal, featMat)
ck('stock material unchanged (no stock waste on features)', full.carcassMaterial, plain.carcassMaterial)
ck('consumables apply to feature material', full.consumables - plain.consumables, featMat * 0.1)
ck('labor $ = feature hours × rate', full.totals.labor - plain.totals.labor, (6 + 0.5 + 0.3 * sq2 + 0.2 + 0.5 + 1.0) * 100)
ck('breakdown itemizes 4 feature rows', full.solidWoodTop.features.length, 4)

console.log('— qty 3 multiplies everything')
const three = C.computeBreakdown({ productId: 'countertop', qty: 3, slots: slots(waterfall) }, rb, defaults)
ck('assembly ×3', three.hoursByDept.assembly, full.hoursByDept.assembly * 3)
ck('material ×3', three.materialSubtotal, full.materialSubtotal * 3)

console.log('— wording + staleness')
ck('client wording', C.summarizeSlots({ productId: 'countertop', qty: 1, slots: slots([{ featureId: 'bow', qty: 2 }, { featureId: 'rub', sqft: null }, { featureId: 'mit', lengthFt: 4 }]) }, rb).split(' · ').slice(-3).join(' · '),
  '2 × Bowtie · Hand-rubbed finish · Mitered corner 4 ft')
ck('archived feature → unresolved (refresh skips the line)', C.unresolvedSlotIds(slots([{ featureId: 'gone', qty: 1 }]), rb).includes('solid wood top feature'), true)
ck('known features → resolved', C.unresolvedSlotIds(slots(waterfall), rb).length, 0)
const st = (await import('../lib/composer-row.ts')).breakdownToStorageValues(full, 1)
ck('stored lump includes feature material', st.lumpCostOverride, full.materialSubtotal)

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)

// ============================================================================
// scripts/preview-presentation-estimate.tsx — render the template to /tmp
// ============================================================================
//   npx tsx scripts/preview-presentation-estimate.tsx
//
// Kept rather than thrown away: this is the ONLY way to see the presentation
// estimate without a live project, and layout is the thing most likely to
// regress in it. Two fixtures on purpose, both required by the spec —
//
//   williams  12 subprojects, long names, multi-page scope  → the stress case
//   dover      1 subproject                                 → proves the cover
//              index still reads when the package is tiny
//
// Every layout bug found so far showed up in one or the other: the cover
// spilling to a second sheet, a long title printing through its own price, a
// lone half-width dotted rule, and the signature block orphaning onto a page
// of its own. Re-run it after touching EstimatePresentationPdf and LOOK at
// both PDFs — react-pdf compiles happily while overlapping text.
// ============================================================================
import React from 'react'
import { renderToFile } from '@react-pdf/renderer'
import { EstimatePresentationPdf } from '../components/estimates/EstimatePresentationPdf'

const line = (name: string, amount: number, material: string, details: string[], excludes: string) => ({
  description: [
    name,
    `Material - ${material}`,
    ...details.map((d) => `Description - ${d}`),
    'Includes Installation',
    'Exclusions:',
    ...excludes.split(' · ').map((e) => `- ${e}`),
  ].join('\n'),
  quantity: 1,
  unit: 'ea',
  unit_price: amount,
  amount,
})

const WILLIAMS = [
  line('Kitchen Cabinets & Island (Sheets: 1-11)', 98447,
    'Premium rift white oak · engineered sheet goods · approx. per plans',
    ['Rift white oak on all exterior surfaces, stained to match sample, matte clear top coat',
     'Slow-close European hinged doors',
     'Flat panel doors with panels for panel-ready appliances',
     '44 Blum Legra drawer boxes with soft close',
     'Double pull-out trash in island and sink wall',
     'Adjustable shelves throughout'],
    'LEDs · stone · power · fixtures & sinks · handles'),
  line('Primary Closet Cabinets (Plans A27-30)', 114948,
    'Oak veneer · premium walnut · solid oak & walnut · glass · per plans',
    ['Oak micro-shaker doors and drawers, satin lacquer',
     'Walnut island, matte clear · drawers one side, cubbies opposite',
     'Four full-height mirror-panel doors on Wall 11',
     'Angled shoe shelves between mirror cabinets',
     'Clear glass door above laundry storage',
     '14 Blum Legra drawer boxes with soft close'],
    'hanging rods · stone · safe · LEDs'),
  line('Mudroom Cabinets', 54158, 'White oak · engineered sheet goods',
    ['Bench with cubbies above', 'Shaker doors, satin lacquer'], 'hooks · stone'),
  line('Outdoor Kitchen Cabinets', 25369, 'Marine-grade polymer',
    ['Weather-rated doors and drawer fronts'], 'appliances · stone'),
  line('Primary Bath Cabinets', 23676, 'Walnut veneer', ['Floating vanity, matte clear'], 'stone · sinks'),
  line('Gym Storage Cabinets', 19062, 'Engineered sheet goods', ['Open shelving with towel storage'], 'mirrors'),
  line('Theater Cabinets', 17497, 'Rift white oak', ['Media base with vented backs'], 'AV equipment'),
  line('Office Cabinets', 17237, 'Walnut', ['Built-in desk and upper storage'], 'power · chairs'),
  line('Snack Bar Cabinets', 15193, 'Rift white oak', ['Uppers and base with open shelf'], 'appliances'),
  line('Breakfast Nook (Plan A10)', 13130,
    'Premium rift white oak veneer · engineered sheet goods · per plans',
    ['U-shaped seating with back, veneer on seat, back and base',
     'Stained to match sample, matte clear top coat',
     'Mounted in place with scribe panels, curved ends',
     'GC provides wood blocking at wall locations'],
    'cushions & upholstery'),
  line('Powder 1 & 2 · Bunk · Caydon · Dallas · Emery · Finley · Pool Bath vanities', 34872,
    'Mixed species per room schedule', ['Seven vanities, sizes per plan'], 'stone · sinks · fixtures'),
  line('Dog Area Cabinet', 4918, 'Engineered sheet goods', ['Feeding station with pull-out'], 'bowls'),
]

// ⛔ SHAPED FROM REAL DATA (Kennedy EST-0017), not invented. Three things in
// here broke the first implementation and must stay:
//   · the material is NESTED — "Description - Material - …" — so there is no
//     Material section to find
//   · everything after "Details - …" is a bare continuation line
//   · one detail is enormous (the Blum paragraph)
// and 20 subprojects, which is what pushed the cover's total onto a second
// sheet. My original fixtures topped out at 12 and missed all of it.
const kennedyLine = (name: string, amount: number) => ({
  // VERBATIM from Kennedy EST-0017's first line item — twelve details, one of
  // them a 300-character paragraph. My invented fixture had six short ones and
  // therefore never reproduced the density that drove the page count.
  description:
    `${name}\n` +
    `Description - Material - Paint Grade Sheet Goods, Engineered Sheet Goods\n` +
    `Dimensions - Approx: Based on plans\n` +
    `Details - Satin lacquer finish to match paint spec. TBD\n` +
    `Roll out drawers inside left tall cabinet on stove wall\n` +
    `Vertical tray storage in upper left cabinet\n` +
    `Spice cabinet on left cabinet wall\n` +
    `Island Trash cabinet to have insert with trash cut outs and typical paper towel holder\n` +
    `Island outside upper cabinets have interior roll out insert drawers\n` +
    `Prefin maple, black or white laminate cabinet interiors\n` +
    `Slow close european hinged doors\n` +
    `Flat panel doors\n` +
    `QTY 16 @ Blum legra drawer boxes (a premium, minimalist drawer system ` +
    `characterized by, straight, slim-walled sides and a sleek, modern aesthetic. ` +
    `Designed for high-end kitchens and bathrooms, it features superior, quiet, ` +
    `full-extension runners (40 kg or 70 kg capacity), BLUMOTION soft-close, and ` +
    `customizable, matte-finished metal surfaces.) Finish in orion grey, white, ` +
    `brushed stainless steel\n` +
    `(Includes interior roll out and trash cabinet)\n` +
    `Adjustable shelves\n` +
    `*GC to provide wood blocking in wall\n` +
    `\nIncludes Installation\n\nExclusions:\n- Stone\n- Power\n- LEDS\n- Handles\n- Sinks and fixtures`,
  quantity: 1,
  unit: 'ea',
  unit_price: amount,
  amount,
})

const KENNEDY = [
  ['Kitchen Cabinets (Sheets:  1-11)', 32307], ['Breakfast Nook Cabinets & Wall Panel', 34651],
  ['Pantry Cabinets', 43471], ['Downstairs Laundry Cabinets', 35394],
  ["Emily's Office Cabinets", 15624], ['Powder Room Vanity Cabinet', 4488],
  ['Summer Kitchen Cabinets', 13132], ['Martini Bar Cabinets and Shelves', 28925],
  ['Wine Room Cabinets & Shelving', 48507], ['Primary Guest Bath Cabinets', 14738],
  ['Upper Living Room Cabinets & Wall Panels', 113999], ['Upper Laundry Cabinets', 31003],
  ['Primary Bath Cabinets', 12058], ["Emily's Bath Cabinet", 7821],
  ["Patrick's Office Cabinets & Wall Panels", 47885], ['Bath 3 Cabinet', 5814],
  ['Bath 2 Cabinet', 8274], ["Emily's Closet Cabinets and Shelving", 79517],
  ["Patrick's Closet", 43325], ['Yoga Room and Bath Cabinet & Shelves', 11158],
].map(([n, a]) => kennedyLine(n as string, a as number))

const DOVER = [
  line('Painted Vanity (Sheets: 3)', 6029, 'Poplar · engineered sheet goods',
    ['Shaker doors and drawer fronts, painted to match sample', 'Two soft-close drawers'],
    'stone · sink · fixtures'),
]

const ORG = {
  name: 'Built',
  logo_url: null,
  business_address: '602 N Newport Ave',
  business_city: 'Tampa',
  business_state: 'FL',
  business_zip: '33606',
  business_phone: '813 512 6250',
  business_email: 'info@builtthings.com',
}
const STATS = [
  { value: '2013', label: 'Family owned since' },
  { value: '15', label: 'Craftspeople' },
  { value: '8', label: 'Families supported' },
  { value: '12 & 16', label: 'Kids and pets' },
]
const NOTE =
  "Thank you for considering us for your project. We take pride in what leaves this shop, and we're thankful for the opportunity to make you something great."
const TERMS =
  'Estimate valid for 30 days · 30% deposit due at contract signing · remaining balance billed per production milestones · lead time quoted separately · change orders in writing only.'

function sched(total: number) {
  return [
    { label: 'Deposit', pct: 30, trigger: 'At contract signing', amount: Math.round(total * 0.3) },
    { label: 'Rough-in', pct: 40, trigger: 'Enters production', amount: Math.round(total * 0.4) },
    { label: 'Install start', pct: 20, trigger: 'Install begins on site', amount: Math.round(total * 0.2) },
    { label: 'Final punchout', pct: 10, trigger: 'On completion', amount: Math.round(total * 0.1) },
  ]
}

async function render(name: string, lines: typeof WILLIAMS, num: string, headline: string, project: string, client: string) {
  const total = lines.reduce((n, l) => n + l.amount, 0)
  const el = React.createElement(EstimatePresentationPdf, {
    estimateNumber: num,
    estimateDate: '2026-08-28',
    validUntil: null,
    org: ORG,
    project: { name: project },
    client: { name: client, address: null, email: null, phone: null },
    lines,
    schedule: sched(total),
    totals: { subtotal: total, taxPct: 0, taxAmount: 0, total },
    terms: TERMS,
    closingNote: NOTE,
    headline,
    stats: STATS,
    signature: 'Andrew',
  })
  await renderToFile(el as any, `/tmp/${name}.pdf`)
  console.log(`/tmp/${name}.pdf  — ${lines.length} sub(s), total $${total.toLocaleString('en-US')}`)
}

async function main() {
  await render('williams', WILLIAMS, 'EST-0010',
    'A custom millwork package for the Williams residence.',
    'Williams Residential Millwork Package', 'The Williams Residence')
  await render('kennedy', KENNEDY, 'EST-0017',
    'A custom millwork package for Patrick Kennedy.',
    'Kennedy - Millwork Package', 'Patrick Kennedy')
  await render('dover', DOVER, 'EST-0011',
    'A painted vanity for the Dover residence.',
    'Dover - Painted Vanity', 'The Dover Residence')
}
main().catch((e) => { console.error(e); process.exit(1) })

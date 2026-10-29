// ============================================================================
// verify-attention.mjs — the attention rings say what the spec says (10-29)
// ============================================================================
// Run: npx tsx scripts/verify-attention.mjs        (pure + static, no database)
//
// Pins lib/attention:
//   · per-stage clocks + thresholds (lead 7/14/21d · sent 10/21d · pre-prod 2w/4w)
//   · thicker AND darker together, stepped
//   · resets: a touch AFTER the base restarts the clock; one before doesn't
//   · honest data: no stamp → no ring; installed/complete/lost run no clock
//   · production fill ring + "+Nh over"; worst-first + newest-first ordering
// And the wiring (greps): both boards use the shared shells, /projects drags
// into production only through startProduction, the header boxes + filter
// buttons are gone, /pm mounts the list, Touched base logs a timeline event.
// ============================================================================
import fs from 'fs'
import {
  ATTENTION_THRESHOLDS,
  RING_STYLE,
  ageAttention,
  ageChip,
  attentionScore,
  clockFor,
  fillAttention,
  fillGradient,
  newestFirst,
} from '../lib/attention.ts'

let bad = 0
const ck = (label, ok) => {
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}`)
}
const DAY = 86400000
const NOW = Date.parse('2026-10-29T12:00:00Z')
const ago = (d) => new Date(NOW - d * DAY).toISOString()

// ── clocks ──
ck('new lead runs the lead clock', clockFor('new_lead', null) === 'lead')
ck('a sent estimate runs the sent clock in any pipeline column', clockFor('fifty_fifty', ago(1)) === 'sent' && clockFor('new_lead', ago(1)) === 'sent')
ck('sold runs the pre-prod clock', clockFor('sold', null) === 'preprod')
ck('production/installed/complete/lost run no age clock', ['production', 'installed', 'complete', 'lost'].every((s) => clockFor(s, ago(3)) === null))

// ── thresholds ──
const lead = (d) => ageAttention({ stage: 'new_lead', created_at: ago(d) }, NOW)
ck('lead 6d → no ring', lead(6).level === 0)
ck('lead 7d → amber', lead(7).level === 1)
ck('lead 14d → orange', lead(14).level === 2)
ck('lead 21d → red, chip "3w", phrase "3w quiet"', lead(21).level === 3 && lead(21).chip === '3w' && lead(21).phrase === '3w quiet')
ck('lead 12d → chip "12d"', lead(12).chip === '12d')
const sent = (d) => ageAttention({ stage: 'ninety_percent', created_at: ago(90), estimate_sent_at: ago(d) }, NOW)
ck('sent 9d → none, 10d → amber, 20d → still amber (no orange step)', sent(9).level === 0 && sent(10).level === 1 && sent(20).level === 1)
ck('sent 21d → red, "sent 3w ago"', sent(21).level === 3 && sent(21).phrase === 'sent 3w ago')
ck('sent clock ignores created_at (90d old lead, sent 3d ago → calm)', sent(3).level === 0)
const pre = (d) => ageAttention({ stage: 'sold', sold_at: ago(d) }, NOW)
ck('pre-prod 13d → none, 14d → amber, 28d → red "4w in pre-prod"', pre(13).level === 0 && pre(14).level === 1 && pre(28).level === 3 && pre(28).phrase === '4w in pre-prod')
ck('thresholds live in one constant', ATTENTION_THRESHOLDS.lead.red === 21 && ATTENTION_THRESHOLDS.preprod.amber === 14)

// ── thicker AND darker ──
ck('ring widths step up 2 → 3 → 4', RING_STYLE[1].width === 2 && RING_STYLE[2].width === 3 && RING_STYLE[3].width === 4)
ck('ring colours all differ', new Set([RING_STYLE[1].color, RING_STYLE[2].color, RING_STYLE[3].color]).size === 3)

// ── resets ──
const touched = ageAttention({ stage: 'new_lead', created_at: ago(30), lastTouch: { at: ago(2), label: 'Touched base' } }, NOW)
ck('Touched base 2d ago resets a 30d lead to calm', touched.level === 0 && touched.days === 2)
ck('reset shows in the tooltip', /Touched base/.test(touched.tooltip))
ck('reset moves `since` (the sort key) to the touch', touched.since === ago(2))
const stale = ageAttention({ stage: 'fifty_fifty', estimate_sent_at: ago(25), lastTouch: { at: ago(40), label: 'Stage changed' } }, NOW)
ck('a touch BEFORE the base does not reset (sent 25d stays red)', stale.level === 3 && stale.days === 25)
const preTouched = ageAttention({ stage: 'sold', sold_at: ago(40), lastTouch: { at: ago(3), label: 'Payment recorded' } }, NOW)
ck('payment on a 40d pre-prod job resets it, phrase says "since touch"', preTouched.level === 0 && /since touch/.test(preTouched.phrase))

// ── honest data ──
ck('null sold_at → no ring', ageAttention({ stage: 'sold', sold_at: null }, NOW) === null)
ck('null created_at lead → no ring', ageAttention({ stage: 'new_lead', created_at: null }, NOW) === null)
ck('installed → no ring', ageAttention({ stage: 'installed', sold_at: ago(90) }, NOW) === null)
ck('ageChip 13 → 13d, 14 → 2w', ageChip(13) === '13d' && ageChip(14) === '2w')

// ── production fill ──
ck('no estimate → no fill ring', fillAttention(0, 10) === null)
const half = fillAttention(100, 50)
ck('50 of 100h → ratio .5, no chip', half.ratio === 0.5 && half.chip === null)
const over = fillAttention(100, 108)
ck('108 of 100h → "+8h over"', over.chip === '+8h over' && Math.round(over.overHours) === 8)
ck('fill gradient: half = green to 180deg', fillGradient(0.5).includes('180deg'))
ck('fill gradient past 100% carries a red slice', /#DC2626/.test(fillGradient(1.08)) && !/#DC2626/.test(fillGradient(0.9)))

// ── ordering ──
ck('over-hours production ranks with red', attentionScore(over) >= 3000)
ck('red outranks orange outranks amber', attentionScore(lead(21)) > attentionScore(lead(14)) && attentionScore(lead(14)) > attentionScore(lead(7)))
ck('within red, older is worse', attentionScore(lead(40)) > attentionScore(lead(22)))
ck('calm scores 0', attentionScore(lead(2)) === 0 && attentionScore(half) === 0)
const keys = [ago(10), null, ago(1), ago(30)].sort(newestFirst)
ck('newest first, unknown last', keys[0] === ago(1) && keys[2] === ago(30) && keys[3] === null)

// ── wiring ──
const read = (f) => fs.readFileSync(f, 'utf8')
const sales = read('app/(app)/sales/kanban/page.tsx')
const projects = read('app/(app)/projects/page.tsx')
const pm = read('app/(app)/pm/page.tsx')
for (const [name, src] of [['sales kanban', sales], ['/projects', projects]]) {
  ck(`${name} uses the shared KanbanColumn + KanbanCard`, /components\/kanban\/KanbanColumn/.test(src) && /components\/kanban\/KanbanCard/.test(src))
  ck(`${name} offers Touched base`, /TouchedBaseModal/.test(src) && /'Touched base'/.test(src))
  ck(`${name} sorts newest first`, /newestFirst/.test(src))
}
ck('sales kanban keeps its tour targets', /data-tour="kanban-board"/.test(sales) && /'tour-project-card'/.test(sales))
ck('the tour card suppresses the attention ring', /suppressRing=\{isTourProject\}/.test(sales))
ck('/projects → production only via startProduction', /await startProduction\(project\.id\)/.test(projects) && !/updateProjectStage\(project\.id, 'production'/.test(projects))
ck('/projects lost the metric boxes + filter buttons', !/MetricCard/.test(projects) && !/FILTERS/.test(projects))
ck('/projects keeps search', /matchesProjectSearch/.test(projects))
ck('/projects keeps temp + archived off', /temp\.has\(r\.id\)/.test(projects) && /archived\.has\(r\.id\)/.test(projects))
ck('/projects keeps the complete-card Archive button', /canArchive\(p\.stage\)/.test(projects))
ck('/pm mounts the attention list', /<AttentionCard orgId=/.test(pm))
ck('Touched base logs a project event', /eventType: 'touched_base'/.test(read('lib/attention-data.ts')))
ck('the shared column carries no tour attribute (pages own those)', !/data-tour/.test(read('components/kanban/KanbanColumn.tsx')))

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)

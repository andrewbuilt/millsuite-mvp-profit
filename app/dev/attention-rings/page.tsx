'use client'

// ============================================================================
// /dev/attention-rings — fixture harness for the board cards' ATTENTION RINGS
// ============================================================================
// The boards can't be looked at without a login against live data, and a ring
// is a thing you have to SEE (thickness + colour, the fill frame) — tsc says
// nothing about whether level 3 reads as "worse" than level 1. Mounts the real
// KanbanColumn + KanbanCard on fixture clocks: one column per clock, ordered
// newest-first like the boards, so the column darkens downward.
//
// Dev-only: production builds 404 it. It talks to no database.
// ============================================================================

import { notFound } from 'next/navigation'
import KanbanColumn from '@/components/kanban/KanbanColumn'
import KanbanCard from '@/components/kanban/KanbanCard'
import { ageAttention, fillAttention, type Attention } from '@/lib/attention'

const DAY = 86400000
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString()

const COLS: { title: string; cards: { name: string; client: string; value: number; a: Attention | null }[] }[] = [
  {
    title: 'New lead',
    cards: [3, 8, 15, 24].map((d, i) => ({
      name: ['Hartley kitchen', 'Marsh vanities', 'Leonard – JW Marriott – Lobby Bar Phase 1 – Back Bar Millwork', 'Batia library'][i],
      client: 'Fixture client',
      value: 40000 + i * 12000,
      a: ageAttention({ stage: 'new_lead', created_at: ago(d) }),
    })),
  },
  {
    title: 'Estimate sent',
    cards: [4, 12, 22].map((d, i) => ({
      name: ['Pajot bar', 'Leonard lobby', 'Kinser island'][i],
      client: 'Fixture client',
      value: 90000 + i * 30000,
      a: ageAttention({ stage: 'ninety_percent', estimate_sent_at: ago(d) }),
    })),
  },
  {
    title: 'Pre-production',
    cards: [
      { name: 'Touched base 1d ago', d: 45, touch: 1 },
      { name: 'Oliveira', d: 16, touch: null },
      { name: 'Bonzer', d: 33, touch: null },
      { name: 'Imported (no sold_at)', d: null, touch: null },
    ].map((c) => ({
      name: c.name,
      client: 'Fixture client',
      value: 60000,
      a: ageAttention({
        stage: 'sold',
        sold_at: c.d == null ? null : ago(c.d),
        lastTouch: c.touch == null ? null : { at: ago(c.touch), label: 'Touched base' },
      }),
    })),
  },
  {
    title: 'Production',
    cards: [
      { name: 'Schiller table', est: 120, tracked: 30 },
      { name: 'Killinger', est: 200, tracked: 150 },
      { name: 'Hunt millwork', est: 100, tracked: 108 },
      { name: 'No estimate', est: 0, tracked: 12 },
    ].map((c) => ({ name: c.name, client: 'Fixture client', value: 75000, a: fillAttention(c.est, c.tracked) })),
  },
]

export default function AttentionRingsFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6 bg-white min-h-screen">
      <h1 className="text-xl font-semibold text-[#111] mb-4">Attention rings — fixture</h1>
      <div className="grid grid-cols-4 gap-3">
        {COLS.map((col) => (
          <KanbanColumn key={col.title} title={col.title} count={col.cards.length} sum={col.cards.reduce((s, c) => s + c.value, 0)} hint="Fixture" isOver={false}>
            {col.cards.map((c) => (
              <KanbanCard key={c.name} title={c.name} attention={c.a} onOpen={() => {}} menu={[{ label: 'Touched base', onClick: () => {} }]}>
                <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF] mt-2">${c.value.toLocaleString()}</div>
              </KanbanCard>
            ))}
          </KanbanColumn>
        ))}
      </div>
    </div>
  )
}

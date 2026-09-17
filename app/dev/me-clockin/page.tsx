'use client'

// ============================================================================
// /dev/me-clockin — fixture harness for the clock-in flow's three screens
// ============================================================================
// The reason components/me/clockin-flow.tsx exports its screens as pure views:
// /me can't be exercised without a worker login against live data, and the
// wave-3 lesson is that a phone layout must be LOOKED AT at 375px and 320px —
// tsc compiles overlapping text without complaint. This mounts each screen on
// fixture data (long names, an over-budget dept, the 87/100 case) with the
// real BottomTabs so the z-stack (sheet under footer) is the real one.
//
// Dev-only: production builds 404 it. It talks to no database.
// ============================================================================

import { useState } from 'react'
import { notFound } from 'next/navigation'
import {
  ProjectSelectScreen,
  SubCardsScreen,
  TimerSheet,
} from '@/components/me/clockin-flow'
import { BottomTabs } from '@/components/me/tabs'
import type { SubClockCard } from '@/lib/worker-clockin'

const PROJECTS = [
  { id: 'p1', name: 'Leonard – JW Marriott – Lobby Bar Phase 1' },
  { id: 'p2', name: 'Hunt - Pajot Millwork' },
  { id: 'p3', name: 'Killinger' },
  { id: 'p4', name: 'Schiller - Brabson Dining Table' },
  { id: 'p5', name: 'UT - Public Arts Panels and Boxes' },
]

const CARDS: SubClockCard[] = [
  {
    subprojectId: 's1',
    name: 'TV Wall',
    // The spec's own example: 87 of 100 — and Assembly OVER (red bar + number).
    estHoursByDept: { eng: 12, cnc: 30, assembly: 100, finish: 24, install: 16 },
    actualMinutesByDept: { eng: 6 * 60 + 30, cnc: 31 * 60, assembly: 87 * 60, finish: 0, install: 0 },
    unmappedActualMinutes: 0,
    totalEstHours: 182,
    totalActualMinutes: (6 * 60 + 30) + 31 * 60 + 87 * 60,
  },
  {
    subprojectId: 's2',
    name: 'Kitchen Perimeter Cabinets with a Deliberately Long Name',
    estHoursByDept: { eng: 8, cnc: 22.5, assembly: 60, finish: 18, install: 12 },
    actualMinutesByDept: { eng: 9 * 60 + 15, cnc: 4 * 60, assembly: 0, finish: 0, install: 0 },
    unmappedActualMinutes: 95,
    totalEstHours: 120.5,
    totalActualMinutes: 9 * 60 + 15 + 4 * 60 + 95,
  },
  {
    subprojectId: 's3',
    name: 'Floating Shelves',
    estHoursByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
    actualMinutesByDept: { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 },
    unmappedActualMinutes: 0,
    totalEstHours: 0,
    totalActualMinutes: 0,
  },
]

export default function MeClockinFixture() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [screen, setScreen] = useState<1 | 2 | 3 | '3-running'>(2)

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-24">
      <div className="mb-4 flex gap-2 text-xs">
        {([1, 2, 3, '3-running'] as const).map((s) => (
          <button
            key={String(s)}
            onClick={() => setScreen(s)}
            className={`px-2 py-1 rounded border ${
              screen === s ? 'bg-[#111] text-white border-[#111]' : 'border-[#E5E7EB] text-[#6B7280]'
            }`}
          >
            {s === 1 ? 'Projects' : s === 2 ? 'Sub cards' : s === 3 ? 'Timer idle' : 'Timer running'}
          </button>
        ))}
      </div>

      {screen === 1 && (
        <ProjectSelectScreen
          projects={PROJECTS}
          activeLabel="Hunt - Pajot Millwork · TV Wall"
          onPick={() => setScreen(2)}
          onOpenTimer={() => setScreen('3-running')}
        />
      )}

      {screen === 2 && (
        <SubCardsScreen
          projectName="Leonard – JW Marriott – Lobby Bar Phase 1"
          cards={CARDS}
          loading={false}
          onBack={() => setScreen(1)}
          onPickSub={() => setScreen(3)}
          onOtherWork={() => setScreen(3)}
        />
      )}

      {(screen === 3 || screen === '3-running') && (
        <TimerSheet
          projectName="Leonard – JW Marriott – Lobby Bar Phase 1"
          subName="Kitchen Perimeter Cabinets with a Deliberately Long Name"
          running={screen === '3-running'}
          timerLabel={screen === '3-running' ? '03:41:07' : '00:00:00'}
          busy={false}
          onStart={() => setScreen('3-running')}
          onStop={() => setScreen(2)}
          onClose={() => setScreen(2)}
        />
      )}

      <BottomTabs tab="today" setTab={() => {}} clockedIn={screen === '3-running'} />
    </div>
  )
}

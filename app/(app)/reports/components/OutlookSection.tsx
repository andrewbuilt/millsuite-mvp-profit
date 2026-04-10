'use client'

import { useState, useMemo } from 'react'
import KpiCard from './KpiCard'
import AlertBar from './AlertBar'
import OutlookChart from './OutlookChart'
import {
  computeOutlook,
  computeAlert,
  find80Target,
  type BookedProject,
} from '@/lib/reports/outlookCalculations'

export default function OutlookSection({
  projects,
  currentHeadcount,
  overhead,
  avgWage,
  monthKeys,
}: {
  projects: BookedProject[]
  currentHeadcount: number
  overhead: number
  avgWage: number
  monthKeys: string[]
}) {
  const [crewSize, setCrewSize] = useState(currentHeadcount)

  const outlook = useMemo(
    () => computeOutlook(projects, crewSize, overhead, avgWage, monthKeys),
    [projects, crewSize, overhead, avgWage, monthKeys]
  )

  const baselineOutlook = useMemo(
    () => crewSize !== currentHeadcount
      ? computeOutlook(projects, currentHeadcount, overhead, avgWage, monthKeys)
      : null,
    [projects, currentHeadcount, overhead, avgWage, monthKeys, crewSize]
  )

  const alert = computeAlert(outlook, crewSize)
  const targetHc = useMemo(
    () => find80Target(projects, overhead, avgWage, monthKeys),
    [projects, overhead, avgWage, monthKeys]
  )

  const showBaseline = crewSize !== currentHeadcount

  return (
    <div className="space-y-4">
      {/* Header + slider */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-[#111]">Outlook</h2>
          <p className="text-sm text-[#6B7280]">If nothing changes, here&apos;s where you&apos;re heading</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-[#6B7280]">Crew size</label>
          <input
            type="range"
            min={6}
            max={30}
            step={1}
            value={crewSize}
            onChange={e => setCrewSize(parseInt(e.target.value))}
            className="w-44"
          />
          <span className="text-sm font-medium text-[#111] min-w-[70px] text-center font-mono tabular-nums">
            {crewSize} people
          </span>
        </div>
      </div>

      {/* Alert */}
      <AlertBar level={alert.level} message={alert.message} />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Avg utilization"
          value={`${outlook.avgUtil}%`}
          sub="6-month avg"
          valueColor={outlook.avgUtil >= 75 ? '#059669' : outlook.avgUtil >= 55 ? '#D97706' : '#DC2626'}
        />
        <KpiCard
          label="Peak"
          value={`${outlook.peakUtil}%`}
          sub={`${outlook.peakMonth}${outlook.peakUtil > 100 ? ' — over capacity' : ''}`}
          valueColor={outlook.peakUtil > 100 ? '#DC2626' : '#111'}
        />
        <KpiCard
          label="Effective rate"
          value={`$${outlook.effRate}/hr`}
          sub={`At ${outlook.avgUtil}% util`}
        />
        <KpiCard
          label="Hours gap"
          value={`${outlook.hoursGap > 0 ? '+' : ''}${outlook.hoursGap.toLocaleString()}h`}
          sub={outlook.hoursGap > 0 ? 'Over capacity' : 'Idle capacity'}
          valueColor={outlook.hoursGap > 0 ? '#DC2626' : '#D97706'}
        />
      </div>

      {/* Chart */}
      <OutlookChart
        months={outlook.months}
        baselineMonths={baselineOutlook?.months}
        showBaseline={showBaseline}
        baselineHeadcount={currentHeadcount}
      />

      {/* Target hint + scenario note */}
      <div className="space-y-1">
        {targetHc && crewSize === currentHeadcount && (
          <p className="text-xs text-[#6B7280]">
            To average ~80% utilization on current booked work, you&apos;d need roughly <span className="font-medium text-[#111]">{targetHc} people</span>.
          </p>
        )}
        {showBaseline && (
          <p className="text-xs text-[#9CA3AF] italic">
            Showing {crewSize} crew ({crewSize > currentHeadcount ? '+' : ''}{crewSize - currentHeadcount} from current). Gray dashed line is your current {currentHeadcount}.
          </p>
        )}
        {!showBaseline && (
          <p className="text-xs text-[#9CA3AF] italic">
            Drag the slider to model different crew sizes against your booked work.
          </p>
        )}
      </div>

      {/* Booked work list */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
        <div className="text-sm font-medium text-[#111] mb-0.5">Booked work</div>
        <div className="text-xs text-[#6B7280] mb-3">Projects in production or scheduled to start</div>
        <div className="divide-y divide-[#E5E7EB]">
          {projects.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-[#111]">{p.name}</span>
              <span className="text-[#6B7280] font-mono tabular-nums">
                {p.estimatedHours.toLocaleString()}h &middot; {formatMonthRange(p.startMonth, p.endMonth)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function formatMonthRange(start: string, end: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const sm = parseInt(start.split('-')[1], 10)
  const em = parseInt(end.split('-')[1], 10)
  if (sm === em) return MONTHS[sm - 1]
  return `${MONTHS[sm - 1]} - ${MONTHS[em - 1]}`
}

'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { MonthlyProjection } from '@/lib/reports/outlookCalculations'

interface ChartData {
  month: string
  utilization: number
  baseline?: number
}

export default function OutlookChart({
  months,
  baselineMonths,
  showBaseline,
  baselineHeadcount,
}: {
  months: MonthlyProjection[]
  baselineMonths?: MonthlyProjection[]
  showBaseline: boolean
  baselineHeadcount: number
}) {
  const data: ChartData[] = months.map((m, i) => ({
    month: m.month,
    utilization: m.utilization,
    baseline: showBaseline && baselineMonths ? baselineMonths[i]?.utilization : undefined,
  }))

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
      {/* Legend */}
      <div className="flex gap-4 mb-2 text-xs text-[#6B7280]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-[3px] rounded-sm bg-[#2563EB]" />
          Projected utilization
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0 border-t-[1.5px] border-dashed border-[#D97706]" />
          80% target
        </div>
        {showBaseline && (
          <div className="flex items-center gap-1">
            <div className="w-3 h-0 border-t-[1.5px] border-dashed border-[#9CA3AF]" />
            Current ({baselineHeadcount})
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.04)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: '#9CA3AF', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 140]}
            ticks={[0, 20, 40, 60, 80, 100, 120, 140]}
            tickFormatter={v => `${v}%`}
            tick={{ fill: '#9CA3AF', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: any, name: any) => {
              const label = name === 'utilization' ? 'Projected' : 'Baseline'
              return [`${value}%`, label]
            }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #E5E7EB',
              boxShadow: 'none',
            }}
          />
          {/* 80% target */}
          <ReferenceLine
            y={80}
            stroke="#D97706"
            strokeDasharray="6 4"
            strokeWidth={1.5}
          />
          {/* Baseline (current headcount) */}
          {showBaseline && (
            <Line
              type="monotone"
              dataKey="baseline"
              stroke="#9CA3AF"
              strokeDasharray="3 3"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {/* Projected utilization with fill */}
          <defs>
            <linearGradient id="utilFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563EB" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#2563EB" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="utilization"
            fill="url(#utilFill)"
            stroke="none"
          />
          <Line
            type="monotone"
            dataKey="utilization"
            stroke="#2563EB"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#2563EB', strokeWidth: 0 }}
            activeDot={{ r: 6, fill: '#2563EB', strokeWidth: 2, stroke: '#fff' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import type { WeeklySnapshot, ShopEvent } from '@/lib/financial-engine'
import { Plus, X, TrendingUp, Users, Activity, Calendar, ChevronDown } from 'lucide-react'

// ── Helpers ──

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

function fmtDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtWeek(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const EVENT_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  hire:       { bg: 'bg-green-100', dot: 'bg-green-500', text: 'text-green-700' },
  departure:  { bg: 'bg-red-100',   dot: 'bg-red-500',   text: 'text-red-700' },
  raise:      { bg: 'bg-amber-100', dot: 'bg-amber-500', text: 'text-amber-700' },
  equipment:  { bg: 'bg-blue-100',  dot: 'bg-blue-500',  text: 'text-blue-700' },
  other:      { bg: 'bg-gray-100',  dot: 'bg-gray-400',  text: 'text-gray-600' },
}

function eventStyle(type: string) {
  return EVENT_COLORS[type] || EVENT_COLORS.other
}

// ── SVG Chart Utilities ──

function normalize(value: number, min: number, max: number, height: number, padding: number): number {
  if (max === min) return padding + height / 2
  return padding + height - ((value - min) / (max - min)) * height
}

function buildPolyline(
  values: (number | null)[],
  min: number,
  max: number,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  count: number
): string {
  const points: string[] = []
  const stepX = count > 1 ? (width - paddingX * 2) / (count - 1) : 0
  values.forEach((v, i) => {
    if (v === null) return
    const x = paddingX + i * stepX
    const y = normalize(v, min, max, height - paddingY * 2, paddingY)
    points.push(`${x},${y}`)
  })
  return points.join(' ')
}

function niceAxisTicks(min: number, max: number, count: number): number[] {
  if (max === min) return [min]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, i) => min + step * i)
}

// ── Main Page ──

export default function TrajectoryPage() {
  return (
    <>
      <Nav />
      <PlanGate requires="trajectory">
        <TrajectoryContent />
      </PlanGate>
    </>
  )
}

// ── Content ──

function TrajectoryContent() {
  const { org } = useAuth()
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([])
  const [events, setEvents] = useState<ShopEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null)
  const [headcountTooltip, setHeadcountTooltip] = useState<{ x: number; y: number; idx: number } | null>(null)
  const [utilTooltip, setUtilTooltip] = useState<{ x: number; y: number; idx: number } | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [eventForm, setEventForm] = useState({
    event_date: new Date().toISOString().slice(0, 10),
    event_type: 'other',
    title: '',
    description: '',
    financial_impact: '',
    person_name: '',
  })
  const [saving, setSaving] = useState(false)
  const chartRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (org?.id) loadData()
  }, [org?.id])

  async function loadData() {
    setLoading(true)
    const [{ data: snaps }, { data: evts }] = await Promise.all([
      supabase
        .from('weekly_snapshots')
        .select('*')
        .eq('org_id', org!.id)
        .order('week_start', { ascending: true })
        .limit(52),
      supabase
        .from('shop_events')
        .select('*')
        .eq('org_id', org!.id)
        .order('event_date', { ascending: false }),
    ])
    setSnapshots(snaps || [])
    setEvents(evts || [])
    setLoading(false)
  }

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault()
    if (!org?.id || !eventForm.title.trim()) return
    setSaving(true)
    const { error } = await supabase.from('shop_events').insert({
      org_id: org.id,
      event_date: eventForm.event_date,
      event_type: eventForm.event_type,
      title: eventForm.title.trim(),
      description: eventForm.description.trim() || null,
      financial_impact: eventForm.financial_impact ? parseFloat(eventForm.financial_impact) : null,
      person_name: eventForm.person_name.trim() || null,
    })
    if (!error) {
      setShowEventForm(false)
      setEventForm({ event_date: new Date().toISOString().slice(0, 10), event_type: 'other', title: '', description: '', financial_impact: '', person_name: '' })
      await loadData()
    }
    setSaving(false)
  }

  // ── Chart computations ──

  const chartW = 800
  const chartH = 300
  const padX = 60
  const padY = 30

  const { shopRates, revenues, margins, weeks } = useMemo(() => {
    const sr = snapshots.map(s => s.shop_rate)
    const rev = snapshots.map(s => s.total_revenue)
    const mg = snapshots.map(s => s.gross_margin_pct)
    const wk = snapshots.map(s => s.week_start)
    return { shopRates: sr, revenues: rev, margins: mg, weeks: wk }
  }, [snapshots])

  const srMin = Math.min(...shopRates.filter((v): v is number => v !== null))
  const srMax = Math.max(...shopRates.filter((v): v is number => v !== null))
  const srMinSafe = isFinite(srMin) ? Math.floor(srMin * 0.9) : 0
  const srMaxSafe = isFinite(srMax) ? Math.ceil(srMax * 1.1) : 100

  const revMin = Math.min(...revenues)
  const revMax = Math.max(...revenues)
  const revMinSafe = isFinite(revMin) ? Math.floor(revMin * 0.9) : 0
  const revMaxSafe = isFinite(revMax) ? Math.ceil(revMax * 1.1) : 10000

  const mgMin = Math.min(...margins.filter((v): v is number => v !== null))
  const mgMax = Math.max(...margins.filter((v): v is number => v !== null))
  const mgMinSafe = isFinite(mgMin) ? Math.floor(mgMin - 5) : 0
  const mgMaxSafe = isFinite(mgMax) ? Math.ceil(mgMax + 5) : 50

  const srLine = buildPolyline(shopRates, srMinSafe, srMaxSafe, chartW, chartH, padX, padY, snapshots.length)
  const revLine = buildPolyline(revenues, revMinSafe, revMaxSafe, chartW, chartH, padX, padY, snapshots.length)
  const mgLine = buildPolyline(margins, mgMinSafe, mgMaxSafe, chartW, chartH, padX, padY, snapshots.length)

  // Event positions on the chart x-axis
  const eventPositions = useMemo(() => {
    if (weeks.length < 2) return []
    const firstDate = new Date(weeks[0] + 'T00:00:00').getTime()
    const lastDate = new Date(weeks[weeks.length - 1] + 'T00:00:00').getTime()
    const range = lastDate - firstDate
    if (range === 0) return []
    return events
      .filter(ev => {
        const d = new Date(ev.event_date + 'T00:00:00').getTime()
        return d >= firstDate && d <= lastDate
      })
      .map(ev => {
        const d = new Date(ev.event_date + 'T00:00:00').getTime()
        const pct = (d - firstDate) / range
        const x = padX + pct * (chartW - padX * 2)
        return { ...ev, x }
      })
  }, [events, weeks])

  // Headcount chart
  const headcounts = snapshots.map(s => s.headcount)
  const hcMin = Math.min(...headcounts)
  const hcMax = Math.max(...headcounts)
  const hcMinSafe = isFinite(hcMin) ? Math.max(0, hcMin - 1) : 0
  const hcMaxSafe = isFinite(hcMax) ? hcMax + 1 : 10

  // Utilization chart
  const utilActual = snapshots.map(s => s.utilization_actual)
  const utilAssumed = snapshots.map(s => s.utilization_assumed)
  const allUtils = [...utilActual.filter((v): v is number => v !== null), ...utilAssumed]
  const utilMin = Math.min(...allUtils)
  const utilMax = Math.max(...allUtils)
  const utilMinSafe = isFinite(utilMin) ? Math.max(0, Math.floor(utilMin - 5)) : 0
  const utilMaxSafe = isFinite(utilMax) ? Math.min(100, Math.ceil(utilMax + 5)) : 100

  const smallW = 400
  const smallH = 160
  const sPadX = 40
  const sPadY = 20

  function getTooltipScreenPos(svgEl: SVGSVGElement | null, svgX: number, svgY: number) {
    if (!svgEl) return { x: 0, y: 0 }
    const rect = svgEl.getBoundingClientRect()
    const scaleX = rect.width / chartW
    const scaleY = rect.height / chartH
    return { x: rect.left + svgX * scaleX, y: rect.top + svgY * scaleY }
  }

  function handleMainChartHover(e: React.MouseEvent<SVGSVGElement>) {
    if (snapshots.length === 0) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartW
    const stepX = snapshots.length > 1 ? (chartW - padX * 2) / (snapshots.length - 1) : 0
    const idx = Math.round((mouseX - padX) / (stepX || 1))
    if (idx < 0 || idx >= snapshots.length) { setTooltip(null); return }
    const x = padX + idx * stepX
    setTooltip({ x: e.clientX, y: e.clientY - 10, idx })
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-gray-200 rounded" />
          <div className="h-[300px] bg-gray-100 rounded-xl" />
        </div>
      </div>
    )
  }

  // ── Empty state ──

  if (snapshots.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-semibold text-[#111] mb-2">Trajectory</h1>
        <p className="text-sm text-[#6B7280] mb-8">Where are we heading?</p>
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-6 h-6 text-[#9CA3AF]" />
          </div>
          <h2 className="text-lg font-semibold text-[#111] mb-2">No data yet</h2>
          <p className="text-sm text-[#6B7280] max-w-md mx-auto leading-relaxed">
            Click &ldquo;Take Snapshot&rdquo; to start building your trajectory.
            The chart populates automatically as weekly snapshots accumulate.
          </p>
        </div>
      </div>
    )
  }

  // ── Y-axis label helpers ──

  const srTicks = niceAxisTicks(srMinSafe, srMaxSafe, 5)
  const revTicks = niceAxisTicks(revMinSafe, revMaxSafe, 5)
  const mgTicks = niceAxisTicks(mgMinSafe, mgMaxSafe, 5)

  // X-axis label positions
  const xLabelInterval = Math.max(1, Math.floor(snapshots.length / 8))

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[#111] mb-1">Trajectory</h1>
        <p className="text-sm text-[#6B7280]">Where are we heading? &mdash; Shop performance over time</p>
      </div>

      {/* ── Main Three-Line Chart ── */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
        <div className="flex items-center gap-6 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 bg-blue-500 inline-block rounded" />
            <span className="text-xs text-[#6B7280]">Shop Rate ($/hr)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 bg-green-500 inline-block rounded" />
            <span className="text-xs text-[#6B7280]">Weekly Revenue ($)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 bg-purple-500 inline-block rounded" />
            <span className="text-xs text-[#6B7280]">Gross Margin (%)</span>
          </div>
        </div>

        <div className="relative w-full" style={{ aspectRatio: '800/300' }}>
          <svg
            ref={chartRef}
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="w-full h-full"
            onMouseMove={handleMainChartHover}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Grid lines */}
            {srTicks.map((tick, i) => {
              const y = normalize(tick, srMinSafe, srMaxSafe, chartH - padY * 2, padY)
              return (
                <g key={`grid-${i}`}>
                  <line x1={padX} y1={y} x2={chartW - padX} y2={y} stroke="#F3F4F6" strokeWidth="1" />
                  <text x={padX - 6} y={y + 3} textAnchor="end" className="text-[10px]" fill="#9CA3AF">${Math.round(tick)}</text>
                </g>
              )
            })}

            {/* Right Y-axis labels (Revenue) */}
            {revTicks.map((tick, i) => {
              const y = normalize(tick, revMinSafe, revMaxSafe, chartH - padY * 2, padY)
              return (
                <text key={`rev-tick-${i}`} x={chartW - padX + 6} y={y + 3} textAnchor="start" className="text-[10px]" fill="#22C55E">
                  {tick >= 1000 ? `$${(tick / 1000).toFixed(0)}k` : `$${Math.round(tick)}`}
                </text>
              )
            })}

            {/* X-axis labels */}
            {weeks.map((w, i) => {
              if (i % xLabelInterval !== 0 && i !== weeks.length - 1) return null
              const stepX = snapshots.length > 1 ? (chartW - padX * 2) / (snapshots.length - 1) : 0
              const x = padX + i * stepX
              return (
                <text key={`x-${i}`} x={x} y={chartH - 4} textAnchor="middle" className="text-[10px]" fill="#9CA3AF">
                  {fmtWeek(w)}
                </text>
              )
            })}

            {/* Event vertical lines */}
            {eventPositions.map((ev, i) => (
              <line
                key={`ev-line-${i}`}
                x1={ev.x}
                y1={padY}
                x2={ev.x}
                y2={chartH - padY}
                stroke={eventStyle(ev.event_type).dot.replace('bg-', '')}
                strokeWidth="1"
                strokeDasharray="4 3"
                opacity="0.5"
                style={{ stroke: ev.event_type === 'hire' ? '#22C55E' : ev.event_type === 'departure' ? '#EF4444' : ev.event_type === 'raise' ? '#F59E0B' : ev.event_type === 'equipment' ? '#3B82F6' : '#9CA3AF' }}
              />
            ))}

            {/* Axis lines */}
            <line x1={padX} y1={padY} x2={padX} y2={chartH - padY} stroke="#E5E7EB" strokeWidth="1" />
            <line x1={padX} y1={chartH - padY} x2={chartW - padX} y2={chartH - padY} stroke="#E5E7EB" strokeWidth="1" />
            <line x1={chartW - padX} y1={padY} x2={chartW - padX} y2={chartH - padY} stroke="#E5E7EB" strokeWidth="1" />

            {/* Lines */}
            {srLine && <polyline points={srLine} fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinejoin="round" />}
            {revLine && <polyline points={revLine} fill="none" stroke="#22C55E" strokeWidth="2" strokeLinejoin="round" />}
            {mgLine && <polyline points={mgLine} fill="none" stroke="#A855F7" strokeWidth="2" strokeLinejoin="round" />}

            {/* Data points for hover detection */}
            {snapshots.map((s, i) => {
              const stepX = snapshots.length > 1 ? (chartW - padX * 2) / (snapshots.length - 1) : 0
              const x = padX + i * stepX
              const srY = s.shop_rate !== null ? normalize(s.shop_rate, srMinSafe, srMaxSafe, chartH - padY * 2, padY) : null
              return (
                <g key={`pt-${i}`}>
                  {srY !== null && <circle cx={x} cy={srY} r="3" fill="#3B82F6" opacity={tooltip?.idx === i ? 1 : 0} />}
                  {<circle cx={x} cy={normalize(s.total_revenue, revMinSafe, revMaxSafe, chartH - padY * 2, padY)} r="3" fill="#22C55E" opacity={tooltip?.idx === i ? 1 : 0} />}
                  {s.gross_margin_pct !== null && <circle cx={x} cy={normalize(s.gross_margin_pct, mgMinSafe, mgMaxSafe, chartH - padY * 2, padY)} r="3" fill="#A855F7" opacity={tooltip?.idx === i ? 1 : 0} />}
                </g>
              )
            })}

            {/* Hover vertical line */}
            {tooltip && (() => {
              const stepX = snapshots.length > 1 ? (chartW - padX * 2) / (snapshots.length - 1) : 0
              const x = padX + tooltip.idx * stepX
              return <line x1={x} y1={padY} x2={x} y2={chartH - padY} stroke="#6B7280" strokeWidth="1" strokeDasharray="3 2" />
            })()}
          </svg>

          {/* Tooltip overlay */}
          {tooltip && snapshots[tooltip.idx] && (
            <div
              className="fixed z-50 bg-white border border-[#E5E7EB] rounded-xl shadow-lg px-4 py-3 pointer-events-none"
              style={{ left: tooltip.x + 12, top: tooltip.y - 80 }}
            >
              <p className="text-xs font-medium text-[#111] mb-1.5">{fmtWeek(snapshots[tooltip.idx].week_start)}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                  <span className="text-[#6B7280]">Shop Rate:</span>
                  <span className="font-medium text-[#111]">{snapshots[tooltip.idx].shop_rate !== null ? `$${snapshots[tooltip.idx].shop_rate!.toFixed(2)}/hr` : '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  <span className="text-[#6B7280]">Revenue:</span>
                  <span className="font-medium text-[#111]">{fmtMoney(snapshots[tooltip.idx].total_revenue)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
                  <span className="text-[#6B7280]">Gross Margin:</span>
                  <span className="font-medium text-[#111]">{snapshots[tooltip.idx].gross_margin_pct !== null ? fmtPct(snapshots[tooltip.idx].gross_margin_pct!) : '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Event Annotations Legend */}
        {eventPositions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
            <p className="text-xs font-medium text-[#6B7280] mb-2">Events</p>
            <div className="flex flex-wrap gap-4 mb-3">
              {(['hire', 'departure', 'raise', 'equipment', 'other'] as const).map(type => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${eventStyle(type).dot} inline-block`} />
                  <span className="text-xs text-[#6B7280] capitalize">{type}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {eventPositions.map((ev, i) => {
                const style = eventStyle(ev.event_type)
                return (
                  <div key={`ev-ann-${i}`} className="flex items-start gap-3 text-xs">
                    <span className={`w-2 h-2 rounded-full ${style.dot} mt-1 shrink-0`} />
                    <span className="text-[#9CA3AF] w-20 shrink-0">{fmtDate(ev.event_date)}</span>
                    <span className="font-medium text-[#111]">{ev.title}</span>
                    {ev.description && <span className="text-[#6B7280]">&mdash; {ev.description}</span>}
                    {ev.financial_impact !== null && (
                      <span className={`ml-auto font-medium ${ev.financial_impact >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtMoney(ev.financial_impact)}/yr
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Small Charts Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Headcount Chart */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#111]">Headcount</h2>
          </div>
          <div className="relative w-full" style={{ aspectRatio: '400/160' }}>
            <svg
              viewBox={`0 0 ${smallW} ${smallH}`}
              className="w-full h-full"
              onMouseMove={(e) => {
                const svg = e.currentTarget
                const rect = svg.getBoundingClientRect()
                const mouseX = ((e.clientX - rect.left) / rect.width) * smallW
                const stepX = snapshots.length > 1 ? (smallW - sPadX * 2) / (snapshots.length - 1) : 0
                const idx = Math.round((mouseX - sPadX) / (stepX || 1))
                if (idx < 0 || idx >= snapshots.length) { setHeadcountTooltip(null); return }
                setHeadcountTooltip({ x: e.clientX, y: e.clientY - 10, idx })
              }}
              onMouseLeave={() => setHeadcountTooltip(null)}
            >
              {/* Grid */}
              {niceAxisTicks(hcMinSafe, hcMaxSafe, 4).map((tick, i) => {
                const y = normalize(tick, hcMinSafe, hcMaxSafe, smallH - sPadY * 2, sPadY)
                return (
                  <g key={`hc-grid-${i}`}>
                    <line x1={sPadX} y1={y} x2={smallW - 10} y2={y} stroke="#F3F4F6" strokeWidth="1" />
                    <text x={sPadX - 4} y={y + 3} textAnchor="end" className="text-[9px]" fill="#9CA3AF">{Math.round(tick)}</text>
                  </g>
                )
              })}

              {/* Stepped line for headcount */}
              {(() => {
                const stepX = snapshots.length > 1 ? (smallW - sPadX * 2) / (snapshots.length - 1) : 0
                const pts: string[] = []
                headcounts.forEach((h, i) => {
                  const x = sPadX + i * stepX
                  const y = normalize(h, hcMinSafe, hcMaxSafe, smallH - sPadY * 2, sPadY)
                  if (i > 0) {
                    // Stepped: horizontal then vertical
                    const prevY = normalize(headcounts[i - 1], hcMinSafe, hcMaxSafe, smallH - sPadY * 2, sPadY)
                    pts.push(`${x},${prevY}`)
                  }
                  pts.push(`${x},${y}`)
                })
                return <polyline points={pts.join(' ')} fill="none" stroke="#6366F1" strokeWidth="2" />
              })()}

              {/* Fill area */}
              {(() => {
                const stepX = snapshots.length > 1 ? (smallW - sPadX * 2) / (snapshots.length - 1) : 0
                const baseY = smallH - sPadY
                const pts: string[] = [`${sPadX},${baseY}`]
                headcounts.forEach((h, i) => {
                  const x = sPadX + i * stepX
                  const y = normalize(h, hcMinSafe, hcMaxSafe, smallH - sPadY * 2, sPadY)
                  if (i > 0) {
                    const prevY = normalize(headcounts[i - 1], hcMinSafe, hcMaxSafe, smallH - sPadY * 2, sPadY)
                    pts.push(`${x},${prevY}`)
                  }
                  pts.push(`${x},${y}`)
                })
                pts.push(`${sPadX + (snapshots.length - 1) * stepX},${baseY}`)
                return <polygon points={pts.join(' ')} fill="#6366F1" fillOpacity="0.08" />
              })()}

              <line x1={sPadX} y1={sPadY} x2={sPadX} y2={smallH - sPadY} stroke="#E5E7EB" strokeWidth="1" />
              <line x1={sPadX} y1={smallH - sPadY} x2={smallW - 10} y2={smallH - sPadY} stroke="#E5E7EB" strokeWidth="1" />
            </svg>

            {headcountTooltip && snapshots[headcountTooltip.idx] && (
              <div
                className="fixed z-50 bg-white border border-[#E5E7EB] rounded-lg shadow-lg px-3 py-2 pointer-events-none"
                style={{ left: headcountTooltip.x + 12, top: headcountTooltip.y - 40 }}
              >
                <p className="text-xs text-[#9CA3AF]">{fmtWeek(snapshots[headcountTooltip.idx].week_start)}</p>
                <p className="text-sm font-semibold text-[#111]">{snapshots[headcountTooltip.idx].headcount} people</p>
              </div>
            )}
          </div>
        </div>

        {/* Utilization Trend Chart */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#111]">Utilization Trend</h2>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />
              <span className="text-[10px] text-[#6B7280]">Actual</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-gray-400 inline-block rounded border-dashed" style={{ borderTop: '1px dashed #9CA3AF', height: 0 }} />
              <span className="text-[10px] text-[#6B7280]">Assumed</span>
            </div>
          </div>
          <div className="relative w-full" style={{ aspectRatio: '400/160' }}>
            <svg
              viewBox={`0 0 ${smallW} ${smallH}`}
              className="w-full h-full"
              onMouseMove={(e) => {
                const svg = e.currentTarget
                const rect = svg.getBoundingClientRect()
                const mouseX = ((e.clientX - rect.left) / rect.width) * smallW
                const stepX = snapshots.length > 1 ? (smallW - sPadX * 2) / (snapshots.length - 1) : 0
                const idx = Math.round((mouseX - sPadX) / (stepX || 1))
                if (idx < 0 || idx >= snapshots.length) { setUtilTooltip(null); return }
                setUtilTooltip({ x: e.clientX, y: e.clientY - 10, idx })
              }}
              onMouseLeave={() => setUtilTooltip(null)}
            >
              {/* Grid */}
              {niceAxisTicks(utilMinSafe, utilMaxSafe, 4).map((tick, i) => {
                const y = normalize(tick, utilMinSafe, utilMaxSafe, smallH - sPadY * 2, sPadY)
                return (
                  <g key={`util-grid-${i}`}>
                    <line x1={sPadX} y1={y} x2={smallW - 10} y2={y} stroke="#F3F4F6" strokeWidth="1" />
                    <text x={sPadX - 4} y={y + 3} textAnchor="end" className="text-[9px]" fill="#9CA3AF">{Math.round(tick)}%</text>
                  </g>
                )
              })}

              {/* Assumed line (dashed) */}
              <polyline
                points={buildPolyline(utilAssumed, utilMinSafe, utilMaxSafe, smallW, smallH, sPadX, sPadY, snapshots.length)}
                fill="none"
                stroke="#9CA3AF"
                strokeWidth="1.5"
                strokeDasharray="6 3"
                strokeLinejoin="round"
              />

              {/* Actual line */}
              <polyline
                points={buildPolyline(utilActual, utilMinSafe, utilMaxSafe, smallW, smallH, sPadX, sPadY, snapshots.length)}
                fill="none"
                stroke="#10B981"
                strokeWidth="2"
                strokeLinejoin="round"
              />

              {/* Fill between lines */}
              {(() => {
                const stepX = snapshots.length > 1 ? (smallW - sPadX * 2) / (snapshots.length - 1) : 0
                const ptsTop: string[] = []
                const ptsBot: string[] = []
                snapshots.forEach((s, i) => {
                  const x = sPadX + i * stepX
                  const yActual = s.utilization_actual !== null
                    ? normalize(s.utilization_actual, utilMinSafe, utilMaxSafe, smallH - sPadY * 2, sPadY)
                    : null
                  const yAssumed = normalize(s.utilization_assumed, utilMinSafe, utilMaxSafe, smallH - sPadY * 2, sPadY)
                  if (yActual !== null) {
                    ptsTop.push(`${x},${yActual}`)
                    ptsBot.unshift(`${x},${yAssumed}`)
                  }
                })
                if (ptsTop.length < 2) return null
                return <polygon points={[...ptsTop, ...ptsBot].join(' ')} fill="#10B981" fillOpacity="0.06" />
              })()}

              <line x1={sPadX} y1={sPadY} x2={sPadX} y2={smallH - sPadY} stroke="#E5E7EB" strokeWidth="1" />
              <line x1={sPadX} y1={smallH - sPadY} x2={smallW - 10} y2={smallH - sPadY} stroke="#E5E7EB" strokeWidth="1" />
            </svg>

            {utilTooltip && snapshots[utilTooltip.idx] && (
              <div
                className="fixed z-50 bg-white border border-[#E5E7EB] rounded-lg shadow-lg px-3 py-2 pointer-events-none"
                style={{ left: utilTooltip.x + 12, top: utilTooltip.y - 50 }}
              >
                <p className="text-xs text-[#9CA3AF] mb-1">{fmtWeek(snapshots[utilTooltip.idx].week_start)}</p>
                <p className="text-xs"><span className="text-[#6B7280]">Actual:</span> <span className="font-semibold text-emerald-600">{snapshots[utilTooltip.idx].utilization_actual !== null ? fmtPct(snapshots[utilTooltip.idx].utilization_actual!) : '—'}</span></p>
                <p className="text-xs"><span className="text-[#6B7280]">Assumed:</span> <span className="font-semibold text-[#111]">{fmtPct(snapshots[utilTooltip.idx].utilization_assumed)}</span></p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Event Log Table ── */}
      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#111]">Event Log</h2>
            <span className="text-xs text-[#9CA3AF]">({events.length})</span>
          </div>
          <button
            onClick={() => setShowEventForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Event
          </button>
        </div>

        {/* Add Event Form */}
        {showEventForm && (
          <form onSubmit={handleAddEvent} className="mb-6 p-4 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[#111]">New Event</h3>
              <button type="button" onClick={() => setShowEventForm(false)} className="text-[#9CA3AF] hover:text-[#6B7280]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Date</label>
                <input
                  type="date"
                  value={eventForm.event_date}
                  onChange={e => setEventForm(f => ({ ...f, event_date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Type</label>
                <select
                  value={eventForm.event_type}
                  onChange={e => setEventForm(f => ({ ...f, event_type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  <option value="hire">Hire</option>
                  <option value="departure">Departure</option>
                  <option value="raise">Raise</option>
                  <option value="equipment">Equipment</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Title</label>
                <input
                  type="text"
                  value={eventForm.title}
                  onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Hired new welder"
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Description</label>
                <input
                  type="text"
                  value={eventForm.description}
                  onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional details"
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Financial Impact ($/yr)</label>
                <input
                  type="number"
                  value={eventForm.financial_impact}
                  onChange={e => setEventForm(f => ({ ...f, financial_impact: e.target.value }))}
                  placeholder="e.g. 65000"
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-[#6B7280] mb-1">Person Name</label>
                <input
                  type="text"
                  value={eventForm.person_name}
                  onChange={e => setEventForm(f => ({ ...f, person_name: e.target.value }))}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm border border-[#D1D5DB] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEventForm(false)}
                className="px-4 py-2 text-xs text-[#6B7280] hover:text-[#111] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Add Event'}
              </button>
            </div>
          </form>
        )}

        {/* Event Table */}
        {events.length === 0 ? (
          <p className="text-sm text-[#9CA3AF] py-4 text-center">No events recorded yet. Add events to annotate your trajectory chart.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6]">
                  <th className="text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wider py-2 pr-4">Date</th>
                  <th className="text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wider py-2 pr-4">Type</th>
                  <th className="text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wider py-2 pr-4">Title</th>
                  <th className="text-left text-xs font-medium text-[#9CA3AF] uppercase tracking-wider py-2 pr-4">Description</th>
                  <th className="text-right text-xs font-medium text-[#9CA3AF] uppercase tracking-wider py-2">Financial Impact</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => {
                  const style = eventStyle(ev.event_type)
                  return (
                    <tr key={ev.id} className="border-b border-[#F9FAFB] hover:bg-[#F9FAFB] transition-colors">
                      <td className="py-2.5 pr-4 text-[#6B7280] whitespace-nowrap">{fmtDate(ev.event_date)}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          {ev.event_type}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-[#111]">
                        {ev.title}
                        {ev.person_name && <span className="text-[#9CA3AF] font-normal"> &mdash; {ev.person_name}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-[#6B7280] max-w-xs truncate">{ev.description || '—'}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {ev.financial_impact !== null ? (
                          <span className={`font-medium ${ev.financial_impact >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {fmtMoney(ev.financial_impact)}/yr
                          </span>
                        ) : (
                          <span className="text-[#D1D5DB]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

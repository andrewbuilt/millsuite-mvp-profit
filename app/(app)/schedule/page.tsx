'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import PlanGate from '@/components/plan-gate'
import Nav from '@/components/nav'
import GateChip from '@/components/gate-chip'
import { supabase } from '@/lib/supabase'
import { loadSubprojectStatusMap, SubprojectStatus } from '@/lib/subproject-status'
import { seedAllocationsForProduction } from '@/lib/schedule-seed'
import { autoSeedProjectMonthAllocations } from '@/lib/capacity-seed'
import DivideBlockModal from '@/components/schedule/DivideBlockModal'
import { loadShopRateSetup } from '@/lib/shop-rate-setup'

// =====================================================
// TYPES
// =====================================================
interface Department {
  id: string
  name: string
  display_order: number
  color: string | null
  hours_per_day: number
  active: boolean
  org_id: string
}

interface Project {
  id: string
  name: string
  client_name: string | null
  stage: string
  due_date: string | null
}

interface Subproject {
  id: string
  name: string
  sort_order: number
  project_id: string
}

interface Allocation {
  id: string
  subproject_id: string
  department_id: string
  scheduled_date: string | null
  scheduled_days: number
  estimated_hours: number
  crew_size: number
  completed: boolean
}

interface Block {
  id: string
  project: string
  projectName: string
  sub: string
  subId: string
  dept: string
  week: number
  hours: number
}

interface DiffInfo {
  from: number
  to: number
  direction: 'earlier' | 'later'
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  type?: string
  thinking?: string
  moveCount?: number
}

interface DragStateType {
  blockId: string
  subKey: string
  startX: number
  startWeek: number
  independent: boolean
}

// =====================================================
// CONSTANTS
// =====================================================
const WEEK_WIDTH = 164
const ROW_HEIGHT = 140
const SWIM_ROW = 36
// Bumped 200 → 280 so a sub-row label fits its name, the "best case" pill,
// the gate chip (short form), and the trailing hours figure without
// truncating the sub name or wrapping the row.
const SWIM_LABEL_WIDTH = 280
const DEPT_LABEL_WIDTH = 150

const COLOR_PALETTE = [
  { bg: '#2563EB', light: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  { bg: '#7C3AED', light: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  { bg: '#059669', light: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  { bg: '#DC2626', light: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  { bg: '#D97706', light: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  { bg: '#0891B2', light: '#CFFAFE', text: '#155E75', border: '#67E8F9' },
  { bg: '#4F46E5', light: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  { bg: '#BE185D', light: '#FCE7F3', text: '#831843', border: '#F9A8D4' },
  { bg: '#EA580C', light: '#FFF7ED', text: '#9A3412', border: '#FDBA74' },
  { bg: '#16A34A', light: '#DCFCE7', text: '#14532D', border: '#86EFAC' },
]

const DEPT_COLOR_PALETTE = [
  { bg: '#2563EB', light: '#DBEAFE', text: '#1E40AF' },
  { bg: '#D97706', light: '#FEF3C7', text: '#92400E' },
  { bg: '#059669', light: '#D1FAE5', text: '#065F46' },
  { bg: '#7C3AED', light: '#EDE9FE', text: '#5B21B6' },
  { bg: '#DC2626', light: '#FEE2E2', text: '#991B1B' },
  { bg: '#0891B2', light: '#CFFAFE', text: '#155E75' },
  { bg: '#4F46E5', light: '#E0E7FF', text: '#3730A3' },
  { bg: '#BE185D', light: '#FCE7F3', text: '#831843' },
]

const PRIORITY_LABELS: Record<number, string> = { 1: 'Critical', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Backlog' }
const PRIORITY_COLORS: Record<number, string> = { 1: '#DC2626', 2: '#D97706', 3: '#6B7280', 4: '#9CA3AF', 5: '#D1D5DB' }

const POWERED_BY = [
  'Powered by coffee and sawdust', 'Powered by Harry Potter', 'Powered by gypsy tears',
  'Powered by jet fuel', 'Powered by wind turbines', 'Powered by your mother-in-law',
  'Powered by spite and determination', 'Powered by leftover pizza', 'Powered by oak shavings',
  'Powered by 3 hours of sleep', 'Powered by CNC dust', 'Powered by sheer willpower',
  'Powered by dad jokes', 'Powered by existential dread', 'Powered by a really long extension cord',
  'Powered by vibes', 'Powered by the tears of project managers', 'Powered by diet coke',
  'Powered by Florida humidity', 'Powered by whatever Elon is smoking', 'Powered by blind optimism',
  'Powered by ramen and regret', 'Powered by a hamster wheel', 'Powered by 42 Chrome tabs',
  'Powered by maple plywood offcuts', 'Powered by the client who keeps changing their mind',
  'Powered by Supabase and prayers', 'Powered by Tampa tap water', 'Powered by unrealistic deadlines',
  'Powered by a M4 Pro doing its best',
]

// =====================================================
// HELPERS
// =====================================================
function getDeptShort(name: string): string {
  const map: Record<string, string> = {
    'engineering': 'ENG', 'cnc': 'CNC', 'cnc / mill': 'CNC', 'cnc/mill': 'CNC',
    'assembly': 'ASSY', 'case assembly': 'ASSY',
    'finishing': 'FIN', 'finish': 'FIN',
    'install': 'INST', 'installation': 'INST',
  }
  return map[name.toLowerCase()] || name.substring(0, 4).toUpperCase()
}

function getDeptDisplayName(name: string): string {
  const map: Record<string, string> = {
    'case assembly': 'Assembly',
  }
  return map[name.toLowerCase()] || name
}

// Capacity-utilization color thresholds — single source of truth used by
// the header dots, the sticky CapacityRow, and any future widget that
// surfaces per-column utilization. Returns null when zero so callers can
// hide the indicator entirely.
function capColor(pct: number): string | null {
  if (pct <= 0) return null
  if (pct > 100) return '#EF4444'
  if (pct > 85) return '#F59E0B'
  if (pct > 50) return '#3B82F6'
  return '#D1D5DB'
}

function getMonday(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getSubKey(b: Block): string {
  return `${b.project}::${b.sub}`
}

function getPoweredBy(): string {
  return POWERED_BY[Math.floor(Date.now() / 86400000) % POWERED_BY.length]
}

function computeDiff(oldBlocks: Block[], newBlocks: Block[]): Map<string, DiffInfo> {
  const diff = new Map<string, DiffInfo>()
  const oldMap = new Map(oldBlocks.map(b => [b.id, b]))
  for (const nb of newBlocks) {
    const ob = oldMap.get(nb.id)
    if (ob && ob.week !== nb.week) {
      diff.set(nb.id, { from: ob.week, to: nb.week, direction: nb.week < ob.week ? 'earlier' : 'later' })
    }
  }
  return diff
}

// =====================================================
// STYLE HELPERS
// =====================================================
function btnS(bg: string, color: string): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: bg, color, cursor: 'pointer', transition: 'all 0.15s' }
}
const simBtnS: React.CSSProperties = { fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, border: '1px solid #E5E7EB', background: '#FFF', color: '#6B7280', cursor: 'pointer' }

// =====================================================
// BLOCK ACTION MENU (⋮ kebab on each schedule block)
// =====================================================
function BlockActionMenu({ block, hasSiblings, onDivide, onMerge, btnStyle }: {
  block: Block
  hasSiblings: boolean
  onDivide: (b: Block) => void
  onMerge: (b: Block) => void
  btnStyle: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // No siblings → keep the legacy single-purpose ⋮ button (fires divide directly).
  if (!hasSiblings) {
    return (
      <button
        className="sched-divide-btn"
        onClick={(e) => { e.stopPropagation(); onDivide(block) }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Divide block"
        style={btnStyle}
      >⋮</button>
    )
  }

  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    fontSize: 11, padding: '6px 10px', border: 'none', background: 'transparent',
    color: '#374151', cursor: 'pointer', borderRadius: 4, whiteSpace: 'nowrap',
  }

  return (
    <div ref={wrapRef} style={{ position: 'absolute', right: btnStyle.right ?? 2, top: '50%', transform: 'translateY(-50%)' }}>
      <button
        className="sched-divide-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Block actions"
        style={{ ...btnStyle, position: 'static', transform: 'none', right: undefined, top: undefined }}
      >⋮</button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 16, right: 0, minWidth: 160,
            background: '#FFF', border: '1px solid #E5E7EB', borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 100, padding: 4,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDivide(block) }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F3F4F6')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            style={itemStyle}
          >Divide block</button>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onMerge(block) }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#F3F4F6')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            style={itemStyle}
          >Merge with adjacent</button>
        </div>
      )}
    </div>
  )
}

// =====================================================
// THINKING BLOCK
// =====================================================
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 4, paddingLeft: 4 }}>
      <button onClick={() => setOpen(o => !o)} style={{ fontSize: 10, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><path d="M9 18l6-6-6-6" /></svg>
        reasoning
      </button>
      {open && <div style={{ fontSize: 11, color: '#9CA3AF', background: '#F9FAFB', border: '1px solid #F3F4F6', borderRadius: 8, padding: '8px 10px', marginTop: 2, lineHeight: 1.45, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>{thinking}</div>}
    </div>
  )
}

// =====================================================
// WEEK COLUMN HEADERS
// =====================================================
function WeekHeaders({ numWeeks, weekZero, departments, capacityMap, effectiveCapacity, onWeekClick }: {
  numWeeks: number
  weekZero: Date
  departments: Department[]
  capacityMap: Record<string, number>
  effectiveCapacity: (deptId: string) => number
  onWeekClick?: (weekIndex: number) => void
}) {
  const getWeekLabel = (i: number): string => {
    const d = new Date(weekZero)
    d.setDate(d.getDate() + i * 7)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <>
      {Array.from({ length: numWeeks }, (_, i) => {
        const wt = departments.reduce((s, d) => s + (capacityMap[`${d.id}::${i}`] || 0), 0)
        const wc = departments.reduce((s, d) => s + effectiveCapacity(d.id), 0)
        const wp = wc > 0 ? Math.round((wt / wc) * 100) : 0
        const dotC = capColor(wp)
        return (
          <div key={i} onClick={() => onWeekClick?.(i)} style={{ width: WEEK_WIDTH, minWidth: WEEK_WIDTH, flexShrink: 0, borderBottom: '1px solid #E5E7EB', borderRight: '1px solid #F3F4F6', padding: '6px 0 6px', textAlign: 'center', background: i % 2 === 0 ? '#FFF' : '#FAFBFC', cursor: 'pointer' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>WK {i + 1}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#6B7280', marginTop: 1 }}>{getWeekLabel(i)}</div>
            <div style={{ height: 6, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {dotC && <div title={`${wp}% utilized`} style={{ width: 4, height: 4, borderRadius: 999, background: dotC }} />}
            </div>
          </div>
        )
      })}
    </>
  )
}

// =====================================================
// CAPACITY ROW (sticky, pinned below the column-header row)
// =====================================================
// Shows a one-glance view of each week's total utilization across all
// departments. Pinned via position:sticky immediately below the header
// row so it stays visible while the operator scrolls vertically through
// the dept rows. Numeric mode (per-week) for short horizons; pill bars
// for long ones so the row doesn't crowd a wide projection.
function CapacityRow({ numWeeks, departments, capacityMap, effectiveCapacity, deptColors, labelWidth, top }: {
  numWeeks: number
  departments: Department[]
  capacityMap: Record<string, number>
  effectiveCapacity: (deptId: string) => number
  deptColors: Record<string, { bg: string; light: string; text: string }>
  labelWidth: number
  top: number
}) {
  const usePill = numWeeks > 26
  const totalCap = departments.reduce((s, d) => s + effectiveCapacity(d.id), 0)
  return (
    <div style={{ display: 'flex', position: 'sticky', top, zIndex: 9, background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
      <div style={{ width: labelWidth, minWidth: labelWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 12, background: '#FAFAFA', borderRight: '1px solid #E5E7EB', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
        {departments.map(d => {
          const c = deptColors[d.id] || DEPT_COLOR_PALETTE[0]
          return (
            <div key={d.id} title={d.name} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <div style={{ width: 5, height: 5, borderRadius: 999, background: c.bg, flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 500, color: '#6B7280', letterSpacing: '0.02em' }}>{getDeptShort(d.name)}</span>
            </div>
          )
        })}
      </div>
      {Array.from({ length: numWeeks }, (_, i) => {
        const wt = departments.reduce((s, d) => s + (capacityMap[`${d.id}::${i}`] || 0), 0)
        const wp = totalCap > 0 ? Math.round((wt / totalCap) * 100) : 0
        const c = capColor(wp)
        return (
          <div key={i} title={`${wp}% utilized`} style={{ width: WEEK_WIDTH, minWidth: WEEK_WIDTH, flexShrink: 0, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #F3F4F6', background: i % 2 === 0 ? '#FAFAFA' : '#F5F5F5' }}>
            {usePill
              ? (c && <div style={{ width: 6, height: 3, borderRadius: 2, background: c }} />)
              : (c && <span style={{ fontSize: 10, fontFamily: "'SF Mono', monospace", fontWeight: wp > 85 ? 700 : 500, color: c }}>{wp}%</span>)}
          </div>
        )
      })}
    </div>
  )
}

// =====================================================
// FLOW VIEW (departments as rows)
// =====================================================
function FlowView({ blocks, numWeeks, weekZero, departments, deptColors, projectColors, capacityMap, effectiveCapacity, filter, highlightKey, dragState, whatIfDiff, whatIfActive, onPointerDown, onHover, onLeave, onSelect, onDivide, onMerge, siblingCounts, simMode, adjustCapacity, capacityOverrides, deptCapacities, onWeekClick }: {
  blocks: Block[]
  numWeeks: number
  weekZero: Date
  departments: Department[]
  deptColors: Record<string, { bg: string; light: string; text: string }>
  projectColors: Record<string, { bg: string; light: string; text: string; border: string }>
  capacityMap: Record<string, number>
  effectiveCapacity: (deptId: string) => number
  filter: string | null
  highlightKey: string | null
  dragState: DragStateType | null
  whatIfDiff: Map<string, DiffInfo> | null
  whatIfActive: boolean
  onPointerDown: (e: React.PointerEvent, block: Block) => void
  onHover: (block: Block) => void
  onLeave: () => void
  onSelect: (sk: string) => void
  onDivide: (block: Block) => void
  onMerge: (block: Block) => void
  siblingCounts: Record<string, number>
  simMode: boolean
  adjustCapacity: (deptId: string, delta: number) => void
  capacityOverrides: Record<string, number>
  deptCapacities: Record<string, number>
  onWeekClick: (weekIndex: number) => void
}) {
  const visibleCellMap = useMemo(() => {
    const m: Record<string, Block[]> = {}
    for (const b of blocks) {
      if (filter && b.project !== filter) continue
      const k = `${b.dept}::${b.week}`
      if (!m[k]) m[k] = []
      m[k].push(b)
    }
    return m
  }, [blocks, filter])

  return (
    <div style={{ minWidth: DEPT_LABEL_WIDTH + numWeeks * WEEK_WIDTH }}>
      {/* Column headers */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, background: '#FFF', minHeight: 50 }}>
        <div style={{ width: DEPT_LABEL_WIDTH, minWidth: DEPT_LABEL_WIDTH, flexShrink: 0, borderBottom: '1px solid #E5E7EB', borderRight: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: '#FFF', zIndex: 25 }}>Dept</div>
        <WeekHeaders numWeeks={numWeeks} weekZero={weekZero} departments={departments} capacityMap={capacityMap} effectiveCapacity={effectiveCapacity} onWeekClick={onWeekClick} />
      </div>
      {/* Sticky capacity row — pinned below header so weekly utilization
          stays visible while scrolling the dept rows. */}
      <CapacityRow numWeeks={numWeeks} departments={departments} capacityMap={capacityMap} effectiveCapacity={effectiveCapacity} deptColors={deptColors} labelWidth={DEPT_LABEL_WIDTH} top={50} />
      {/* Rows */}
      {departments.map(dept => {
        const cap = effectiveCapacity(dept.id)
        const isOverridden = capacityOverrides[dept.id] != null
        const baseCap = deptCapacities[dept.id] || 0
        const dc = deptColors[dept.id] || DEPT_COLOR_PALETTE[0]
        return (
          <div key={dept.id} style={{ display: 'flex', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ width: DEPT_LABEL_WIDTH, minWidth: DEPT_LABEL_WIDTH, flexShrink: 0, minHeight: ROW_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 12px', borderRight: '1px solid #E5E7EB', background: isOverridden ? '#F5F3FF' : '#FFF', position: 'sticky', left: 0, zIndex: 15 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{getDeptDisplayName(dept.name)}</div>
              <div style={{ fontSize: 10, color: isOverridden ? '#7C3AED' : '#9CA3AF', fontFamily: "'SF Mono', monospace", marginTop: 1, fontWeight: isOverridden ? 600 : 400 }}>
                {cap}h/wk {isOverridden && <span style={{ fontSize: 8, color: '#A78BFA' }}>(was {baseCap})</span>}
              </div>
              {simMode && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                  <button onClick={() => adjustCapacity(dept.id, -20)} style={simBtnS}>-20</button>
                  <button onClick={() => adjustCapacity(dept.id, -10)} style={simBtnS}>-10</button>
                  <button onClick={() => adjustCapacity(dept.id, 10)} style={simBtnS}>+10</button>
                  <button onClick={() => adjustCapacity(dept.id, 20)} style={simBtnS}>+20</button>
                </div>
              )}
            </div>
            {Array.from({ length: numWeeks }, (_, wi) => {
              const ck = `${dept.id}::${wi}`
              const cellBlks = visibleCellMap[ck] || []
              const th = capacityMap[ck] || 0
              const oc = th > cap
              const overflow = oc ? th - cap : 0
              return (
                <div key={wi} style={{ width: WEEK_WIDTH, minWidth: WEEK_WIDTH, flexShrink: 0, minHeight: ROW_HEIGHT, position: 'relative', borderRight: '1px solid #F3F4F6', background: oc ? '#FEF2F2' : wi % 2 === 0 ? '#FFF' : '#FAFBFC', padding: '14px 3px 3px', display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'flex-start', transition: 'background 0.2s' }}>
                  {th > 0 && <div style={{ position: 'absolute', top: 2, right: 5, fontSize: 8, fontWeight: 600, fontFamily: "'SF Mono', monospace", color: oc ? '#DC2626' : (th / cap) > 0.8 ? '#D97706' : '#C4C4C4' }}>{th}h{overflow > 0 && <span style={{ color: '#DC2626' }}> (+{overflow})</span>}</div>}
                  {cellBlks.map(block => {
                    const c = projectColors[block.project] || COLOR_PALETTE[0]
                    const sk = getSubKey(block)
                    const hl = highlightKey === sk
                    const drag = dragState?.blockId === block.id
                    const dim = highlightKey && !hl
                    const n = cellBlks.length
                    const diffInfo = whatIfDiff?.get(block.id)
                    const isNew = diffInfo != null
                    const diffBorder = isNew ? (diffInfo.direction === 'earlier' ? '#059669' : '#D97706') : null
                    return (
                      <div key={block.id} className="sched-block" onPointerDown={e => onPointerDown(e, block)} onMouseEnter={() => onHover(block)} onMouseLeave={onLeave}
                        onClick={e => { e.stopPropagation(); onSelect(sk) }}
                        style={{
                          height: n > 6 ? 18 : n > 4 ? 20 : n > 2 ? 22 : 26, width: 'calc(100% - 4px)', borderRadius: 5,
                          background: isNew ? `${diffBorder}18` : oc && !hl ? `linear-gradient(135deg, ${c.bg}20, #DC262618)` : hl ? c.bg : `${c.bg}14`,
                          border: isNew
                            ? `2px dashed ${diffBorder}`
                            : `1.5px solid ${oc && !hl ? '#FCA5A5' : hl ? c.bg : `${c.border}80`}`,
                          cursor: whatIfActive ? 'default' : drag ? 'grabbing' : 'grab',
                          display: 'flex', alignItems: 'center', padding: '0 6px',
                          opacity: dim ? 0.15 : 1, transition: drag ? 'none' : 'all 0.12s',
                          transform: drag ? 'scale(1.04)' : 'scale(1)', zIndex: drag ? 50 : hl ? 10 : 1,
                          boxShadow: isNew ? `0 0 8px ${diffBorder}40` : drag ? `0 4px 12px ${c.bg}40` : hl ? `0 1px 4px ${c.bg}30` : 'none', flexShrink: 0,
                        }}>
                        <span style={{ fontSize: n > 6 ? 8 : n > 4 ? 9 : 10, fontWeight: 600, lineHeight: 1, color: hl ? '#FFF' : oc ? '#991B1B' : c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{block.sub}</span>
                        <span style={{ fontSize: n > 4 ? 7 : 8, fontWeight: 600, marginLeft: 'auto', paddingLeft: 3, fontFamily: "'SF Mono', monospace", flexShrink: 0, color: hl ? 'rgba(255,255,255,0.7)' : oc ? '#DC2626' : '#B0B0B0' }}>{block.hours}h</span>
                        {isNew && <span style={{ fontSize: 7, marginLeft: 3, color: diffBorder!, fontWeight: 700 }}>{diffInfo.direction === 'earlier' ? '\u25C0' : '\u25B6'}</span>}
                        <BlockActionMenu
                          block={block}
                          hasSiblings={(siblingCounts[`${block.subId}::${block.dept}`] || 0) > 1}
                          onDivide={onDivide}
                          onMerge={onMerge}
                          btnStyle={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 12, height: 14, padding: 0, border: 'none', background: 'rgba(255,255,255,0.85)', borderRadius: 2, cursor: 'pointer', color: '#374151', fontSize: 11, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        />
                      </div>
                    )
                  })}
                  {overflow > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #DC2626, #EF4444)', opacity: 0.7 }} />}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// =====================================================
// SWIMLANE VIEW (projects as rows, expand to subprojects)
// =====================================================
function SwimlaneView({ blocks, numWeeks, weekZero, departments, deptColors, projectColors, projectNames, projectSubs, subIdByKey, subStatusMap, deptIndex, deptShortMap, capacityMap, effectiveCapacity, filter, highlightKey, dragState, whatIfDiff, whatIfActive, onPointerDown, onHover, onLeave, onSelect, onDivide, onMerge, siblingCounts, priorities, onWeekClick }: {
  blocks: Block[]
  numWeeks: number
  weekZero: Date
  departments: Department[]
  deptColors: Record<string, { bg: string; light: string; text: string }>
  projectColors: Record<string, { bg: string; light: string; text: string; border: string }>
  projectNames: Record<string, string>
  projectSubs: Record<string, string[]>
  subIdByKey: Record<string, string>
  subStatusMap: Record<string, SubprojectStatus>
  deptIndex: Record<string, number>
  deptShortMap: Record<string, string>
  capacityMap: Record<string, number>
  effectiveCapacity: (deptId: string) => number
  filter: string | null
  highlightKey: string | null
  dragState: DragStateType | null
  whatIfDiff: Map<string, DiffInfo> | null
  whatIfActive: boolean
  onPointerDown: (e: React.PointerEvent, block: Block) => void
  onHover: (block: Block) => void
  onLeave: () => void
  onSelect: (sk: string) => void
  onDivide: (block: Block) => void
  onMerge: (block: Block) => void
  siblingCounts: Record<string, number>
  priorities: Record<string, number>
  onWeekClick: (weekIndex: number) => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    Object.keys(projectNames).forEach(k => { init[k] = true })
    return init
  })

  const toggleExpand = useCallback((pk: string) => {
    setExpanded(prev => ({ ...prev, [pk]: !prev[pk] }))
  }, [])

  const projectOrder = useMemo(() => {
    return Object.keys(projectNames).sort((a, b) => (priorities[a] || 3) - (priorities[b] || 3))
  }, [priorities, projectNames])

  const filteredProjects = filter ? [filter] : projectOrder

  return (
    <div style={{ minWidth: SWIM_LABEL_WIDTH + numWeeks * WEEK_WIDTH }}>
      {/* Column headers */}
      <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, background: '#FFF', minHeight: 50 }}>
        <div style={{ width: SWIM_LABEL_WIDTH, minWidth: SWIM_LABEL_WIDTH, flexShrink: 0, borderBottom: '1px solid #E5E7EB', borderRight: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: '#FFF', zIndex: 25 }}>Project</div>
        <WeekHeaders numWeeks={numWeeks} weekZero={weekZero} departments={departments} capacityMap={capacityMap} effectiveCapacity={effectiveCapacity} onWeekClick={onWeekClick} />
      </div>
      {/* Sticky capacity row — pinned below header so weekly utilization
          stays visible while scrolling the project rows. */}
      <CapacityRow numWeeks={numWeeks} departments={departments} capacityMap={capacityMap} effectiveCapacity={effectiveCapacity} deptColors={deptColors} labelWidth={SWIM_LABEL_WIDTH} top={50} />

      {/* Project rows */}
      {filteredProjects.map(pk => {
        const c = projectColors[pk] || COLOR_PALETTE[0]
        const pri = priorities[pk] || 3
        const subs = projectSubs[pk] || []
        const isExpanded = expanded[pk]
        const projBlocks = blocks.filter(b => b.project === pk)
        const totalH = projBlocks.reduce((s, b) => s + b.hours, 0)
        const minWeek = projBlocks.length > 0 ? Math.min(...projBlocks.map(b => b.week)) : 0
        const maxWeek = projBlocks.length > 0 ? Math.max(...projBlocks.map(b => b.week)) : 0

        return (
          <div key={pk}>
            {/* Project header row */}
            <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', background: `${c.bg}06` }}>
              <div onClick={() => toggleExpand(pk)} style={{
                width: SWIM_LABEL_WIDTH, minWidth: SWIM_LABEL_WIDTH, flexShrink: 0, height: SWIM_ROW + 8,
                display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8,
                borderRight: '1px solid #E5E7EB', position: 'sticky', left: 0, zIndex: 15,
                background: '#FAFBFC', cursor: 'pointer', userSelect: 'none',
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth="2.5"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c.bg, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectNames[pk]}</div>
                </div>
                <span style={{ fontSize: 8, fontWeight: 700, color: PRIORITY_COLORS[pri], flexShrink: 0 }}>P{pri}</span>
                <span style={{ fontSize: 9, color: '#9CA3AF', fontFamily: "'SF Mono', monospace", flexShrink: 0 }}>{totalH}h</span>
              </div>
              {/* Summary bar */}
              {Array.from({ length: numWeeks }, (_, wi) => {
                const inRange = wi >= minWeek && wi <= maxWeek && projBlocks.length > 0
                const weekBlocks = projBlocks.filter(b => b.week === wi)
                const weekH = weekBlocks.reduce((s, b) => s + b.hours, 0)
                return (
                  <div key={wi} style={{ width: WEEK_WIDTH, minWidth: WEEK_WIDTH, flexShrink: 0, height: SWIM_ROW + 8, borderRight: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', background: wi % 2 === 0 ? 'transparent' : '#FAFBFC' }}>
                    {inRange && (
                      <div style={{
                        width: 'calc(100% - 4px)', height: 18, borderRadius: 4,
                        background: `${c.bg}18`, border: `1px solid ${c.border}60`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {weekH > 0 && <span style={{ fontSize: 8, fontWeight: 600, color: c.text, fontFamily: "'SF Mono', monospace" }}>{weekH}h</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Subproject rows (expanded) */}
            {isExpanded && subs.map(sub => {
              const sk = `${pk}::${sub}`
              const subBlocks = blocks.filter(b => b.project === pk && b.sub === sub).sort((a, b) => (deptIndex[a.dept] ?? 0) - (deptIndex[b.dept] ?? 0))
              const hl = highlightKey === sk
              const dim = highlightKey && !hl
              const subId = subIdByKey[sk]
              const gateStatus = subId ? subStatusMap[subId] : null

              return (
                <div key={sk} style={{ display: 'flex', borderBottom: '1px solid #F3F4F6', opacity: dim ? 0.3 : 1, transition: 'opacity 0.12s' }}>
                  {/* Sub label */}
                  <div style={{
                    width: SWIM_LABEL_WIDTH, minWidth: SWIM_LABEL_WIDTH, flexShrink: 0, height: SWIM_ROW,
                    display: 'flex', alignItems: 'center', padding: '0 10px 0 34px', gap: 6,
                    borderRight: '1px solid #E5E7EB', position: 'sticky', left: 0, zIndex: 15,
                    background: hl ? c.light : '#FFF',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{sub}</div>
                    {gateStatus && <GateChip status={gateStatus} small />}
                    <span style={{ fontSize: 8, color: '#B0B0B0', fontFamily: "'SF Mono', monospace", flexShrink: 0 }}>{subBlocks.reduce((s, b) => s + b.hours, 0)}h</span>
                  </div>

                  {/* Week cells with dept-colored blocks */}
                  {Array.from({ length: numWeeks }, (_, wi) => {
                    const cellBlocks = subBlocks.filter(b => b.week === wi)
                    return (
                      <div key={wi}
                        onMouseEnter={() => cellBlocks.length > 0 && onHover(cellBlocks[0])}
                        onMouseLeave={onLeave}
                        onClick={e => { e.stopPropagation(); onSelect(sk) }}
                        style={{
                          width: WEEK_WIDTH, minWidth: WEEK_WIDTH, flexShrink: 0, height: SWIM_ROW,
                          borderRight: '1px solid #F3F4F6', display: 'flex', alignItems: 'center',
                          gap: 2, padding: '0 2px',
                          background: hl && cellBlocks.length ? `${c.bg}08` : wi % 2 === 0 ? '#FFF' : '#FAFBFC',
                        }}>
                        {cellBlocks.map(block => {
                          const dc = deptColors[block.dept] || DEPT_COLOR_PALETTE[0]
                          const diffInfo = whatIfDiff?.get(block.id)
                          const isNew = diffInfo != null
                          const diffBorder = isNew ? (diffInfo.direction === 'earlier' ? '#059669' : '#D97706') : null
                          const isDragging = dragState?.blockId === block.id
                          return (
                            <div key={block.id}
                              className="sched-block"
                              onPointerDown={e => onPointerDown(e, block)}
                              style={{
                                flex: 1, height: 24, borderRadius: 4,
                                background: isNew ? `${diffBorder}18` : hl ? dc.bg : `${dc.bg}20`,
                                border: isNew
                                  ? `2px dashed ${diffBorder}`
                                  : `1.5px solid ${hl ? dc.bg : `${dc.bg}50`}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                padding: '0 4px', cursor: whatIfActive ? 'default' : isDragging ? 'grabbing' : 'grab',
                                boxShadow: isNew ? `0 0 6px ${diffBorder}40` : isDragging ? `0 4px 8px ${dc.bg}40` : hl ? `0 1px 3px ${dc.bg}30` : 'none',
                                transition: isDragging ? 'none' : 'all 0.12s',
                                transform: isDragging ? 'scale(1.06)' : 'scale(1)',
                                zIndex: isDragging ? 50 : 1,
                              }}>
                              <span style={{ fontSize: 8, fontWeight: 700, color: hl ? '#FFF' : dc.text, letterSpacing: '0.02em' }}>{deptShortMap[block.dept] || 'DEPT'}</span>
                              <span style={{ fontSize: 8, fontWeight: 600, color: hl ? 'rgba(255,255,255,0.7)' : `${dc.text}90`, fontFamily: "'SF Mono', monospace" }}>{block.hours}h</span>
                              {isNew && <span style={{ fontSize: 6, color: diffBorder!, fontWeight: 700 }}>{diffInfo.direction === 'earlier' ? '\u25C0' : '\u25B6'}</span>}
                              <BlockActionMenu
                                block={block}
                                hasSiblings={(siblingCounts[`${block.subId}::${block.dept}`] || 0) > 1}
                                onDivide={onDivide}
                                onMerge={onMerge}
                                btnStyle={{ position: 'absolute', right: 1, top: '50%', transform: 'translateY(-50%)', width: 12, height: 14, padding: 0, border: 'none', background: 'rgba(255,255,255,0.85)', borderRadius: 2, cursor: 'pointer', color: '#374151', fontSize: 11, fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Dept legend for swimlane */}
      <div style={{ display: 'flex', gap: 12, padding: '10px 16px', position: 'sticky', left: 0 }}>
        {departments.map(d => {
          const dc = deptColors[d.id] || DEPT_COLOR_PALETTE[0]
          return (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: dc.bg }} />
              <span style={{ fontSize: 10, color: '#6B7280' }}>{getDeptDisplayName(d.name)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =====================================================
// CHAT PANEL
// =====================================================
function ChatPanel({ messages, isThinking, chatInput, setChatInput, sendMessage, whatIfBlocks, whatIfDiff, acceptWhatIf, discardWhatIf, onClose }: {
  messages: ChatMessage[]
  isThinking: boolean
  chatInput: string
  setChatInput: (v: string) => void
  sendMessage: (text: string) => void
  whatIfBlocks: Block[] | null
  whatIfDiff: Map<string, DiffInfo> | null
  acceptWhatIf: () => void
  discardWhatIf: () => void
  onClose: () => void
}) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isThinking])

  return (
    <div style={{ width: 360, flexShrink: 0, borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', background: '#FAFBFC', height: '100%' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E7EB', background: '#FFF', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Schedule AI</div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>{getPoweredBy()}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 8px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
            <div style={{
              maxWidth: '94%', padding: '10px 14px', borderRadius: 12,
              fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              background: msg.role === 'user' ? '#111' : '#FFF',
              color: msg.role === 'user' ? '#FFF' : '#111',
              border: msg.role === 'user' ? 'none' : '1px solid #E5E7EB',
              boxShadow: msg.role === 'user' ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {msg.text}
            </div>
            {msg.type === 'applied' && (
              <div style={{ fontSize: 10, color: '#059669', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                {msg.moveCount || 0} move{msg.moveCount !== 1 ? 's' : ''} applied
              </div>
            )}
            {msg.type === 'proposal' && whatIfBlocks && i === messages.length - 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 4 }}>
                <button onClick={acceptWhatIf} style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#FFF', cursor: 'pointer' }}>
                  Apply {whatIfDiff?.size || 0} move{whatIfDiff?.size !== 1 ? 's' : ''}
                </button>
                <button onClick={discardWhatIf} style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#FFF', color: '#6B7280', cursor: 'pointer' }}>
                  Nevermind
                </button>
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ padding: '12px 16px', borderRadius: 12, background: '#FFF', border: '1px solid #E5E7EB', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <style>{`@keyframes pulse2{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
              {[0, 0.2, 0.4].map((d, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#111', animation: `pulse2 1.2s infinite ${d}s` }} />)}
              <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 4 }}>Working through it...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: '10px 12px 14px', borderTop: '1px solid #E5E7EB', background: '#FFF', flexShrink: 0 }}>
        <textarea
          ref={inputRef} value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput) } }}
          placeholder={whatIfBlocks ? 'Apply or discard the preview first...' : "Tell me what's going on with the schedule..."}
          disabled={isThinking || !!whatIfBlocks}
          rows={3}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: 13, outline: 'none', background: (isThinking || whatIfBlocks) ? '#F9FAFB' : '#FFF', color: '#111', resize: 'none', lineHeight: 1.4, fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#C4C4C4' }}>Shift+Enter for new line</span>
          <button onClick={() => sendMessage(chatInput)} disabled={isThinking || !chatInput.trim() || !!whatIfBlocks}
            style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: chatInput.trim() && !whatIfBlocks ? '#111' : '#E5E7EB', color: chatInput.trim() && !whatIfBlocks ? '#FFF' : '#9CA3AF', cursor: chatInput.trim() && !whatIfBlocks ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// LOADING SKELETON
// =====================================================
function LoadingSkeleton() {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", background: '#FFF', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F3F4F6', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: '#6B7280' }}>Loading schedule...</div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Fetching projects, departments, and allocations</div>
      </div>
    </div>
  )
}

// =====================================================
// PARENT COMPONENT
// =====================================================
export default function SchedulePage() {
  const { user, org, loading: authLoading } = useAuth()

  // --- Data state ---
  const [departments, setDepartments] = useState<Department[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Subproject[]>>({})
  const [subStatusMap, setSubStatusMap] = useState<Record<string, SubprojectStatus>>({})
  const [blocks, setBlocks] = useState<Block[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  const [headcountByDept, setHeadcountByDept] = useState<Record<string, number>>({})

  // --- UI state ---
  const [dragState, setDragState] = useState<DragStateType | null>(null)
  const [hoveredBlock, setHoveredBlock] = useState<Block | null>(null)
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [history, setHistory] = useState<Block[][]>([])
  const [viewMode, setViewMode] = useState<'flow' | 'swimlane'>('flow')

  const [priorities, setPriorities] = useState<Record<string, number>>({})
  const [showPriorityPanel, setShowPriorityPanel] = useState(false)

  // Divide-block modal — null = closed; otherwise carries the block being
  // split. The block carries id (= allocation_id), dept_id, sub_id, etc.
  // so the save handler has everything it needs to wipe the source row +
  // insert N new ones with explicit dates.
  const [divideBlock, setDivideBlock] = useState<Block | null>(null)
  const [dividing, setDividing] = useState(false)
  const [capacityOverrides, setCapacityOverrides] = useState<Record<string, number>>({})
  const [simMode, setSimMode] = useState(false)

  const [whatIfBlocks, setWhatIfBlocks] = useState<Block[] | null>(null)
  const [whatIfDiff, setWhatIfDiff] = useState<Map<string, DiffInfo> | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)

  // Schedule AI pane defaults to closed so the timeline gets full width on
  // first load. User toggle is sticky via localStorage — if they leave it
  // open, next visit honors that. Hydration-safe: useState seeds false,
  // useEffect upgrades from localStorage on mount so SSR + first paint
  // don't flicker.
  const [chatOpen, setChatOpen] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = window.localStorage.getItem('schedule.chatOpen')
    if (saved === '1') setChatOpen(true)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('schedule.chatOpen', chatOpen ? '1' : '0')
  }, [chatOpen])
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: "What's on your mind? Tell me what's going on with the schedule and I'll figure out the moves.", type: 'greeting' }
  ])
  const [isThinking, setIsThinking] = useState(false)
  const [pendingMoves, setPendingMoves] = useState<any[] | null>(null)

  const gridRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef<Block[]>(blocks)
  useEffect(() => { blocksRef.current = blocks }, [blocks])

  // --- Derived data ---
  const weekZero = useMemo(() => getMonday(new Date()), [])

  const projectColors = useMemo(() => {
    const colors: Record<string, { bg: string; light: string; text: string; border: string }> = {}
    projects.forEach((p, i) => {
      colors[p.id] = COLOR_PALETTE[i % COLOR_PALETTE.length]
    })
    return colors
  }, [projects])

  const deptColors = useMemo(() => {
    const colors: Record<string, { bg: string; light: string; text: string }> = {}
    departments.forEach((d, i) => {
      colors[d.id] = DEPT_COLOR_PALETTE[i % DEPT_COLOR_PALETTE.length]
    })
    return colors
  }, [departments])

  const deptOrder = useMemo(() => departments.map(d => d.id), [departments])
  const deptIndex = useMemo(() => Object.fromEntries(deptOrder.map((id, i) => [id, i])), [deptOrder])
  const deptShortMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const d of departments) { m[d.id] = getDeptShort(d.name) }
    return m
  }, [departments])

  const projectNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of projects) { m[p.id] = p.name }
    return m
  }, [projects])

  // siblingCounts[`${subId}::${deptId}`] = number of allocation rows for that
  // subproject × department pair. Drives the "Merge with adjacent" menu
  // option visibility — only show it when count > 1 (i.e. the block was
  // previously split).
  const siblingCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of blocks) {
      const k = `${b.subId}::${b.dept}`
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [blocks])

  const projectSubs = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const p of projects) {
      m[p.id] = (subprojectsByProject[p.id] || []).map(s => s.name)
    }
    return m
  }, [projects, subprojectsByProject])

  // sk = `${pk}::${subName}` → subId, so SwimlaneView can lookup gate status.
  const subIdByKey = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of projects) {
      for (const s of subprojectsByProject[p.id] || []) {
        m[`${p.id}::${s.name}`] = s.id
      }
    }
    return m
  }, [projects, subprojectsByProject])

  const deptCapacities = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of departments) {
      // Strict 0 when no billable team_members are assigned to the dept.
      // The legacy `|| 1` fallback inflated capacity to a phantom 40h/wk
      // for unassigned depts, which made the schedule lie about how
      // much work the shop could actually take on.
      const headcount = headcountByDept[d.id] || 0
      m[d.id] = d.hours_per_day * headcount * 5
    }
    return m
  }, [departments, headcountByDept])

  const numWeeks = useMemo(() => {
    if (blocks.length === 0) return 18
    const maxWeek = Math.max(...blocks.map(b => b.week))
    return Math.max(18, maxWeek + 4)
  }, [blocks])

  const displayBlocks = whatIfBlocks || blocks

  const effectiveCapacity = useCallback((deptId: string) => {
    if (capacityOverrides[deptId] != null) return capacityOverrides[deptId]
    return deptCapacities[deptId] || 0
  }, [capacityOverrides, deptCapacities])

  const capacityMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const b of displayBlocks) { const k = `${b.dept}::${b.week}`; m[k] = (m[k] || 0) + b.hours }
    return m
  }, [displayBlocks])

  const highlightKey = useMemo(() => selectedSub || (hoveredBlock ? getSubKey(hoveredBlock) : null), [selectedSub, hoveredBlock])

  // --- Week <-> Date helpers ---
  const dateToWeekIndex = useCallback((dateStr: string | null): number => {
    if (!dateStr) return 0
    const d = new Date(dateStr + 'T00:00:00')
    const diffMs = d.getTime() - weekZero.getTime()
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000))
  }, [weekZero])

  const weekIndexToDate = useCallback((week: number): string => {
    const d = new Date(weekZero)
    d.setDate(d.getDate() + week * 7)
    return d.toISOString().split('T')[0]
  }, [weekZero])

  // --- Install sequencing ---
  const enforceInstallSequencing = useCallback((blks: Block[]): Block[] => {
    // Find the last department in the order (install-like)
    if (departments.length === 0) return blks
    const lastDeptId = departments[departments.length - 1]?.id
    if (!lastDeptId) return blks

    const byProject: Record<string, Block[]> = {}
    for (const b of blks) {
      if (b.dept !== lastDeptId) continue
      if (!byProject[b.project]) byProject[b.project] = []
      byProject[b.project].push(b)
    }
    let updated = [...blks]
    for (const [proj, installs] of Object.entries(byProject)) {
      if (installs.length <= 1) continue
      const subOrder = projectSubs[proj] || []
      const sorted = [...installs].sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week
        return subOrder.indexOf(a.sub) - subOrder.indexOf(b.sub)
      })
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].week <= sorted[i - 1].week) {
          const nw = Math.min(sorted[i - 1].week + 1, numWeeks - 1)
          updated = updated.map(b => b.id === sorted[i].id ? { ...b, week: nw } : b)
          sorted[i] = { ...sorted[i], week: nw }
        }
      }
    }
    return updated
  }, [departments, projectSubs, numWeeks])

  // --- Data Loading ---
  useEffect(() => {
    if (authLoading || !org) return
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, org?.id])

  async function loadData() {
    if (!org) return

    // Load departments
    const { data: deptData } = await supabase
      .from('departments')
      .select('*')
      .eq('org_id', org.id)
      .eq('active', true)
      .order('display_order')

    // Filter out management (and the MGMT short-form variant the org may
    // use) and enforce production order
    const PROD_ORDER = ['engineering', 'cnc', 'cnc / mill', 'cnc/mill', 'assembly', 'case assembly', 'finishing', 'finish', 'install', 'installation']
    const depts: Department[] = (deptData || [])
      .filter(d => !/management|mgmt/i.test(d.name))
      .sort((a, b) => {
        const ai = PROD_ORDER.findIndex(p => a.name.toLowerCase().includes(p))
        const bi = PROD_ORDER.findIndex(p => b.name.toLowerCase().includes(p))
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.display_order - b.display_order
      })
    setDepartments(depts)

    // Schedule shows projects that are actually in the shop. Pre-sold bids
    // (new lead / fifty-fifty / ninety / sold) clutter the swimlane with
    // jobs that can't be allocated yet — they don't appear until auto-advance
    // flips stage to 'production' (lib/project-stage.maybeAdvanceToProduction).
    // 'installed' stays so the schedule still renders the recent install
    // history; 'complete' is excluded — completed jobs leave the swimlane.
    const { data: projData } = await supabase
      .from('projects')
      .select('id, name, client_name, stage, due_date')
      .eq('org_id', org.id)
      .in('stage', ['production', 'installed'])
      .order('name')

    const projs: Project[] = projData || []
    setProjects(projs)

    // Self-heal: any production project that advanced under the PR1 stub
    // (or before PR2 shipped, or via a path that skipped maybeAdvance) is
    // missing its department_allocations seed. Fire seedAllocationsForProduction
    // on each production-stage project before allocations load — the helper
    // is idempotent (bails if any allocations exist on the project's subs)
    // so projects already seeded are no-ops. Installed projects skipped
    // entirely (they shipped; nothing to schedule).
    await Promise.all(
      projs
        .filter(p => p.stage === 'production')
        .map(p => seedAllocationsForProduction(p.id)),
    )

    // Set default priorities
    const defaultPri: Record<string, number> = {}
    projs.forEach(p => { defaultPri[p.id] = 3 })
    setPriorities(defaultPri)

    // Load subprojects for all projects
    const subsMap: Record<string, Subproject[]> = {}
    const allSubIds: string[] = []

    for (const p of projs) {
      const { data: subs } = await supabase
        .from('subprojects')
        .select('id, name, sort_order')
        .eq('project_id', p.id)
        .order('sort_order')

      const subList: Subproject[] = (subs || []).map(s => ({ ...s, project_id: p.id }))
      subsMap[p.id] = subList
      subList.forEach(s => allSubIds.push(s.id))
    }
    setSubprojectsByProject(subsMap)

    // Load gate status (Phase 6 hard gate visualization)
    if (allSubIds.length > 0) {
      const statusMap = await loadSubprojectStatusMap(allSubIds)
      setSubStatusMap(statusMap)
    }

    // Load headcount per dept from orgs.team_members (the single source
    // shared with /team + /settings + the welcome walkthrough). Each
    // billable member contributes 1 to every dept their dept_assignments
    // includes. Non-billable members don't count toward capacity (they
    // still count toward shop-rate numerator via /settings).
    const setup = await loadShopRateSetup(org.id)
    const hcMap: Record<string, number> = {}
    for (const m of setup.team) {
      if (!m.billable) continue
      for (const deptId of m.dept_assignments || []) {
        hcMap[deptId] = (hcMap[deptId] || 0) + 1
      }
    }
    setHeadcountByDept(hcMap)

    // Load allocations
    if (allSubIds.length === 0) {
      setBlocks([])
      setDataLoaded(true)
      return
    }

    // Supabase IN filter has a limit, batch if needed
    const BATCH_SIZE = 100
    let allAllocations: Allocation[] = []
    for (let i = 0; i < allSubIds.length; i += BATCH_SIZE) {
      const batch = allSubIds.slice(i, i + BATCH_SIZE)
      const { data: allocData } = await supabase
        .from('department_allocations')
        .select('id, subproject_id, department_id, scheduled_date, scheduled_days, estimated_hours, crew_size, completed')
        .in('subproject_id', batch)

      if (allocData) allAllocations = allAllocations.concat(allocData)
    }

    // Build lookup maps
    const subToProject: Record<string, string> = {}
    const subToName: Record<string, string> = {}
    for (const [projId, subs] of Object.entries(subsMap)) {
      for (const s of subs) {
        subToProject[s.id] = projId
        subToName[s.id] = s.name
      }
    }
    const projNameMap: Record<string, string> = {}
    for (const p of projs) { projNameMap[p.id] = p.name }

    // Convert allocations to blocks
    const wz = getMonday(new Date())
    const newBlocks: Block[] = allAllocations.map(a => {
      const projId = subToProject[a.subproject_id] || ''
      const diffMs = a.scheduled_date ? new Date(a.scheduled_date + 'T00:00:00').getTime() - wz.getTime() : 0
      const weekIdx = a.scheduled_date ? Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) : 0
      return {
        id: a.id,
        project: projId,
        projectName: projNameMap[projId] || 'Unknown',
        sub: subToName[a.subproject_id] || 'Unknown',
        subId: a.subproject_id,
        dept: a.department_id,
        week: weekIdx,
        hours: a.estimated_hours,
      }
    })

    setBlocks(newBlocks)
    setDataLoaded(true)
  }

  // Resync the /capacity monthly calendar after a schedule edit. Auto
  // rows reflect the new week placements; manual rows the operator
  // pinned on /capacity stay put. Best-effort — failures log but
  // never block the schedule write.
  const triggerAutoSeedCapacity = useCallback(
    async (projectId: string | null | undefined) => {
      if (!org?.id || !projectId) return
      try {
        await autoSeedProjectMonthAllocations(org.id, projectId)
      } catch (err) {
        console.warn('autoSeedProjectMonthAllocations', err)
      }
    },
    [org?.id],
  )

  // --- Persistence ---
  const persistBlockMove = useCallback(async (blockId: string, newWeek: number) => {
    const dateStr = weekIndexToDate(newWeek)
    await supabase
      .from('department_allocations')
      .update({ scheduled_date: dateStr })
      .eq('id', blockId)
    // Drag updates the allocation's date on department_allocations;
    // the /capacity calendar is downstream of that, so push the new
    // monthly rollup. Block carries its project id.
    const blk = blocksRef.current.find((b) => b.id === blockId)
    if (blk) void triggerAutoSeedCapacity(blk.project)
  }, [weekIndexToDate, triggerAutoSeedCapacity])

  // Divide-block save: wipe the source allocation, insert N new rows with
  // explicit scheduled_date + estimated_hours (operator picked the
  // placement, so autoPlace is intentionally NOT called). All other fields
  // (org_id, subproject_id, department_id, crew_size) are copied off the
  // source row so future drags / displays read the same as the original.
  const handleDivideSave = useCallback(
    async (splits: Array<{ scheduledDate: string; hours: number }>) => {
      if (!divideBlock) return
      setDividing(true)
      try {
        // Pull the source row so we can copy crew_size + org_id forward
        // without trusting in-memory state. Single round-trip; trivial.
        const { data: source } = await supabase
          .from('department_allocations')
          .select('id, org_id, subproject_id, department_id, crew_size')
          .eq('id', divideBlock.id)
          .single()
        if (!source) return

        const inserts = splits.map((s) => ({
          org_id: source.org_id,
          subproject_id: source.subproject_id,
          department_id: source.department_id,
          estimated_hours: s.hours,
          scheduled_date: s.scheduledDate,
          crew_size: source.crew_size,
          completed: false,
        }))

        const { error: insErr } = await supabase
          .from('department_allocations')
          .insert(inserts)
        if (insErr) {
          console.error('handleDivideSave insert', insErr)
          return
        }

        const { error: delErr } = await supabase
          .from('department_allocations')
          .delete()
          .eq('id', source.id)
        if (delErr) {
          console.error('handleDivideSave delete', delErr)
          return
        }

        const projectIdToReseed = divideBlock.project
        setDivideBlock(null)
        await loadData()
        // Capacity calendar resync — divide rewrites the schedule for
        // this project's subproject × dept, so monthly rollups change.
        if (projectIdToReseed) void triggerAutoSeedCapacity(projectIdToReseed)
      } finally {
        setDividing(false)
      }
    },
    // loadData is a stable function defined below — declaring it as a
    // dep would close over a stale reference. Tracking divideBlock + org
    // is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [divideBlock, org?.id, triggerAutoSeedCapacity],
  )

  // Merge-with-adjacent: collapse a multi-row dept split (multiple
  // department_allocations for same subproject_id × department_id) back
  // into a single row. Sums hours + scheduled_days, keeps the earliest
  // scheduled_date, deletes the rest.
  const handleMerge = useCallback(
    async (block: Block) => {
      if (!org?.id) return
      const { data: rows, error: fetchErr } = await supabase
        .from('department_allocations')
        .select('id, scheduled_date, scheduled_days, estimated_hours')
        .eq('subproject_id', block.subId)
        .eq('department_id', block.dept)
      if (fetchErr || !rows || rows.length < 2) return

      const sortedByDate = [...rows].sort((a, b) => {
        const da = a.scheduled_date || '9999-12-31'
        const db = b.scheduled_date || '9999-12-31'
        return da.localeCompare(db)
      })
      const survivor = sortedByDate[0]
      const totalHours = rows.reduce((s, r) => s + (r.estimated_hours || 0), 0)
      const totalDays = rows.reduce((s, r) => s + (r.scheduled_days || 0), 0)

      const { error: updErr } = await supabase
        .from('department_allocations')
        .update({
          estimated_hours: totalHours,
          scheduled_days: totalDays,
          scheduled_date: survivor.scheduled_date,
        })
        .eq('id', survivor.id)
      if (updErr) {
        console.error('handleMerge update', updErr)
        return
      }

      const toDelete = rows.filter(r => r.id !== survivor.id).map(r => r.id)
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('department_allocations')
          .delete()
          .in('id', toDelete)
        if (delErr) {
          console.error('handleMerge delete', delErr)
          return
        }
      }

      await loadData()
      // Capacity calendar resync — merge collapses N rows into 1; the
      // monthly rollup for this project may have changed even when the
      // total hours are conserved (block now lands in fewer months).
      if (block.project) void triggerAutoSeedCapacity(block.project)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org?.id, triggerAutoSeedCapacity],
  )

  // --- FLOW VIEW DRAG ---
  const handlePointerDown = useCallback((e: React.PointerEvent, block: Block) => {
    if (whatIfBlocks) return
    e.preventDefault(); e.stopPropagation()
    // Snapshot blocks before drag so undo works
    preDragBlocks.current = [...blocks]
    setDragState({ blockId: block.id, subKey: getSubKey(block), startX: e.clientX, startWeek: block.week, independent: e.altKey })
  }, [whatIfBlocks, blocks])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragState) return
    const wd = Math.round((e.clientX - dragState.startX) / WEEK_WIDTH)
    if (wd === 0) return
    setBlocks(prev => {
      const db = prev.find(b => b.id === dragState.blockId)
      if (!db) return prev
      const nw = dragState.startWeek + wd
      if (nw < 0 || nw >= numWeeks) return prev
      const shift = nw - db.week
      if (!shift) return prev
      const di = deptIndex[db.dept] ?? 0
      const sk = getSubKey(db)

      let updated: Block[]
      if (dragState.independent) {
        // Alt held: move ONLY this one department block
        updated = prev.map(b => {
          if (b.id === dragState.blockId) return { ...b, week: Math.max(0, Math.min(numWeeks - 1, b.week + shift)) }
          return b
        })
      } else {
        // Default: move this dept's dragged block + STRICTLY-downstream
        // depts together. When a sub has multiple blocks of the same dept
        // (a divided allocation), the un-dragged siblings stay put — the
        // operator picked their dates explicitly via the divide modal.
        // Downstream cascade tracks the dept's max-end across all splits:
        // the new max-end may be smaller, equal, or greater than the old
        // max depending on which split was dragged where.
        const sameDept = prev.filter(b => getSubKey(b) === sk && (deptIndex[b.dept] ?? 0) === di)
        const oldMaxWeek = sameDept.length > 0 ? Math.max(...sameDept.map(b => b.week)) : db.week
        const newMaxWeek = sameDept.length > 0
          ? Math.max(...sameDept.map(b => b.id === dragState.blockId ? nw : b.week))
          : nw
        const downstreamShift = newMaxWeek - oldMaxWeek

        updated = prev.map(b => {
          if (getSubKey(b) !== sk) return b
          if (b.id === dragState.blockId) return { ...b, week: Math.max(0, Math.min(numWeeks - 1, nw)) }
          const bdi = deptIndex[b.dept] ?? 0
          if (bdi > di && downstreamShift !== 0) {
            return { ...b, week: Math.max(0, Math.min(numWeeks - 1, b.week + downstreamShift)) }
          }
          return b
        })
      }
      return enforceInstallSequencing(updated)
    })
    setDragState(ds => ds ? ({ ...ds, startX: e.clientX, startWeek: ds.startWeek + Math.round((e.clientX - ds.startX) / WEEK_WIDTH) }) : null)
  }, [dragState, numWeeks, deptIndex, enforceInstallSequencing])

  // Store pre-drag state so undo works
  const preDragBlocks = useRef<Block[] | null>(null)

  const handlePointerUp = useCallback(() => {
    if (dragState) {
      const currentBlocks = blocksRef.current
      const preBlocks = preDragBlocks.current

      // Check if anything actually moved
      if (preBlocks) {
        const preMap = new Map(preBlocks.map(b => [b.id, b.week]))
        const didChange = currentBlocks.some(b => preMap.get(b.id) !== b.week)

        if (didChange) {
          setHistory(prev => [...prev, preBlocks])
          // Persist moved blocks — only the rows that actually changed.
          // Cheaper than re-writing every same-sub row, and matters once
          // multi-split subs exist (un-dragged same-dept siblings stay put
          // and shouldn't trigger a no-op UPDATE).
          const movedBlock = currentBlocks.find(b => b.id === dragState.blockId)
          if (movedBlock) {
            if (dragState.independent) {
              persistBlockMove(movedBlock.id, movedBlock.week)
            } else {
              const sk = getSubKey(movedBlock)
              currentBlocks
                .filter(b => getSubKey(b) === sk && preMap.get(b.id) !== b.week)
                .forEach(b => {
                  persistBlockMove(b.id, b.week)
                })
            }
          }
        }
      }
      preDragBlocks.current = null
    }
    setDragState(null)
  }, [dragState, persistBlockMove])

  useEffect(() => {
    if (!dragState) return
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragState, handlePointerMove, handlePointerUp])

  // --- APPLY MOVES ---
  const applyMoves = useCallback((moves: any[], currentBlocks: Block[]) => {
    let updated = [...currentBlocks]
    for (const move of moves) {
      // The AI uses project keys — we need to find the matching project ID
      // The move.project could be the project ID or a short key; handle both
      const matchProject = (b: Block) => {
        if (b.project === move.project) return true
        // Try matching by project name lowercased
        if (b.projectName.toLowerCase().includes(move.project.toLowerCase())) return true
        return false
      }

      if (move.dept === 'ALL') {
        updated = updated.map(b => {
          if (matchProject(b) && b.sub === move.sub) {
            return { ...b, week: Math.max(0, Math.min(numWeeks - 1, move.toWeek + (deptIndex[b.dept] ?? 0))) }
          }
          return b
        })
      } else {
        const di = deptIndex[move.dept] ?? 0
        const target = updated.find(b => matchProject(b) && b.sub === move.sub && b.dept === move.dept)
        if (target) {
          const shift = move.toWeek - target.week
          updated = updated.map(b => {
            if (matchProject(b) && b.sub === move.sub && (deptIndex[b.dept] ?? 0) >= di) {
              return { ...b, week: Math.max(0, Math.min(numWeeks - 1, b.week + shift)) }
            }
            return b
          })
        }
      }
    }
    return enforceInstallSequencing(updated)
  }, [numWeeks, deptIndex, enforceInstallSequencing])

  // --- WHAT-IF ---
  const acceptWhatIf = useCallback(() => {
    if (!whatIfBlocks) return
    setHistory(prev => [...prev, blocks])
    setBlocks(whatIfBlocks)
    // Persist all changed blocks
    const diff = whatIfDiff
    if (diff) {
      whatIfBlocks.forEach(b => {
        if (diff.has(b.id)) {
          persistBlockMove(b.id, b.week)
        }
      })
    }
    setWhatIfBlocks(null); setWhatIfDiff(null); setPendingMoves(null)
    setMessages(prev => [...prev, { role: 'assistant', text: 'Done. Schedule updated.', type: 'applied', moveCount: whatIfDiff?.size || 0 }])
  }, [whatIfBlocks, whatIfDiff, blocks, persistBlockMove])

  const discardWhatIf = useCallback(() => {
    setWhatIfBlocks(null); setWhatIfDiff(null); setPendingMoves(null)
    setMessages(prev => [...prev, { role: 'assistant', text: 'Got it, left everything as-is. What else?', type: 'info' }])
  }, [])

  // --- SYSTEM PROMPT ---
  const buildSystemPrompt = useCallback((currentBlocks: Block[], currentPriorities: Record<string, number>, currentOverrides: Record<string, number>) => {
    const getWeekLabel = (i: number): string => {
      const d = new Date(weekZero)
      d.setDate(d.getDate() + i * 7)
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    const scheduleLines: string[] = []
    projects.forEach(p => {
      const pri = currentPriorities[p.id] || 3
      const subs = projectSubs[p.id] || []
      subs.forEach(sub => {
        const subBlocks = currentBlocks.filter(b => b.project === p.id && b.sub === sub).sort((a, b) => (deptIndex[a.dept] ?? 0) - (deptIndex[b.dept] ?? 0))
        const deptWeeks = subBlocks.map(b => `${deptShortMap[b.dept] || b.dept}:wk${b.week + 1}`).join(', ')
        const totalH = subBlocks.reduce((s, b) => s + b.hours, 0)
        scheduleLines.push(`${p.name} / ${sub} (${totalH}h, P${pri}): ${deptWeeks}`)
      })
    })

    const effectiveCap = (deptId: string) => currentOverrides[deptId] != null ? currentOverrides[deptId] : (deptCapacities[deptId] || 0)

    const deptCaps = departments.map(d => {
      const baseCap = deptCapacities[d.id] || 0
      const override = currentOverrides[d.id]
      const cap = override != null ? override : baseCap
      const label = override != null ? `${cap}h/wk (SIM, was ${baseCap}h)` : `${cap}h/wk`
      return `${d.name}("${d.id}"):${label}`
    })

    const overCap: string[] = []
    for (const dept of departments) {
      for (let w = 0; w < numWeeks; w++) {
        const cap = effectiveCap(dept.id)
        const total = currentBlocks.filter(b => b.dept === dept.id && b.week === w).reduce((s, b) => s + b.hours, 0)
        if (total > cap) {
          const who = currentBlocks.filter(b => b.dept === dept.id && b.week === w).map(b => `${b.projectName}/${b.sub}(${b.hours}h)`).join(', ')
          overCap.push(`${dept.name} Wk${w + 1}: ${total}/${cap}h - ${who}`)
        }
      }
    }

    const priLines = Object.entries(currentPriorities).sort((a, b) => a[1] - b[1]).map(([k, v]) => `P${v}: ${projectNames[k] || k}`).join(', ')

    const deptFlow = departments.map(d => d.name).join(' > ')
    const projectList = projects.map(p => `"${p.id}"=${p.name}`).join(', ')

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    return `You are the production scheduling assistant for a custom millwork shop. Think like a sharp production manager.

TODAY: ${today}. Weeks are 0-indexed internally (week 1 = index 0).

SHOP FLOW: ${deptFlow}. Each dept must follow the previous.

INSTALL RULE: The last department (${departments[departments.length - 1]?.name || 'Install'}) is SEQUENTIAL for same-project subprojects. No two subs from the same project in that dept the same week.

"Keep tight" = minimize gaps. "Prioritize" = pull earlier, push lower-priority later.

PRIORITIES (1=critical, 5=backlog): ${priLines}

DEPTS: ${deptCaps.join(' | ')}

WEEKS: ${Array.from({ length: numWeeks }, (_, i) => `Wk${i + 1}=${getWeekLabel(i)}(idx${i})`).join(', ')}

CURRENT SCHEDULE:
${scheduleLines.join('\n')}

${overCap.length > 0 ? `OVER-CAPACITY:\n${overCap.join('\n')}` : 'No over-capacity.'}

PROJECTS: ${projectList}

RESPONSE FORMAT -- ONLY a JSON object. No markdown. No backticks. Start with { end with }.

{
  "message": "2-5 sentences. Conversational. Reference dates and names.",
  "moves": [{"project": "projectId", "sub": "Name", "dept": "ALL", "toWeek": 0}],
  "needsConfirmation": true,
  "thinking": "Brief reasoning. Under 100 words."
}

RULES FOR MOVES:
- PREFER "dept": "ALL" over individual dept moves. "ALL" moves entire chain so first dept starts at toWeek, each subsequent dept +1.
- Only use individual dept moves when moving one department without the others.
- For individual dept moves, use the department UUID as the dept value.
- toWeek is 0-indexed.
- Return ALL moves needed in one response.
- ALWAYS respect install sequencing.
- Flag new over-capacity briefly.

WHEN TO SET needsConfirmation:
- TRUE for 3+ projects affected or meaningful tradeoffs.
- FALSE for simple moves, status questions, exact instructions.

PERSONALITY: Sharp production manager. Short sentences. Numbers and dates. No filler. Flag consequences. Keep "message" SHORT. Keep "thinking" under 100 words.

CRITICAL: Start with { end with }. No markdown. No backticks.`
  }, [weekZero, projects, projectSubs, deptIndex, deptShortMap, deptCapacities, departments, numWeeks, projectNames])

  // --- JSON PARSER ---
  const parseAIResponse = useCallback((raw: string) => {
    if (!raw || !raw.trim()) return null
    let cleaned = raw.trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*/gi, '').replace(/\s*```\s*$/gi, '').trim()
    cleaned = cleaned.replace(/^`+|`+$/g, '').trim()
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) cleaned = cleaned.substring(firstBrace, lastBrace + 1)
    try { return JSON.parse(cleaned) } catch (e) { /* continue */ }
    try { return JSON.parse(cleaned.replace(/,\s*([\]}])/g, '$1')) } catch (e) { /* continue */ }
    try {
      let t = cleaned
      const ob = (t.match(/\{/g) || []).length, cb = (t.match(/\}/g) || []).length
      const oB = (t.match(/\[/g) || []).length, cB = (t.match(/\]/g) || []).length
      if (oB > cB) { const lc = t.lastIndexOf(','); if (lc > 0) t = t.substring(0, lc) }
      for (let i = 0; i < oB - cB; i++) t += ']'
      t = t.replace(/,\s*$/, '')
      for (let i = 0; i < ob - cb; i++) t += '}'
      t = t.replace(/,\s*([\]}])/g, '$1')
      return JSON.parse(t)
    } catch (e) { /* continue */ }
    // NOTE: tsconfig target is es5 which rejects the `s` regex flag. Use
    // the equivalent character class instead so the pattern still matches
    // across newlines.
    const msgMatch = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/)
    const movesMatch = raw.match(/"moves"\s*:\s*(\[[\s\S]*?\])/)
    const confirmMatch = raw.match(/"needsConfirmation"\s*:\s*(true|false)/)
    const thinkMatch = raw.match(/"thinking"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/)
    if (msgMatch) {
      const result: any = { message: msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'), moves: [], needsConfirmation: confirmMatch ? confirmMatch[1] === 'true' : false, thinking: thinkMatch ? thinkMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : undefined }
      if (movesMatch) { try { result.moves = JSON.parse(movesMatch[1].replace(/,\s*\]/g, ']')) } catch (e) { /* continue */ } }
      return result
    }
    return null
  }, [])

  // --- SEND MESSAGE ---
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isThinking) return
    const userMsg: ChatMessage = { role: 'user', text: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setChatInput('')
    setIsThinking(true)
    try {
      const validMsgs = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && m.type !== 'error' && m.type !== 'greeting' && m.text && m.text !== 'Undone.' && !m.text.startsWith('Let me try') && !m.text.startsWith('Got it, left everything'))
      const recent = [...validMsgs, userMsg].slice(-10)
      const apiMessages = recent.map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.text }))

      const sysPrompt = buildSystemPrompt(blocks, priorities, capacityOverrides)
      const response = await fetch('/api/schedule-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: sysPrompt, messages: apiMessages }),
      })
      if (!response.ok) {
        const e = await response.text()
        console.error('API HTTP error:', response.status, e)
        setMessages(prev => [...prev, { role: 'assistant', text: `API returned ${response.status}. Check console.`, type: 'error' }])
        setIsThinking(false)
        return
      }
      const result = await response.json()
      console.log('API result:', result)
      if (result.error) {
        setMessages(prev => [...prev, { role: 'assistant', text: `API error: ${result.error.message || JSON.stringify(result.error)}`, type: 'error' }])
        setIsThinking(false)
        return
      }
      if (result.stop_reason === 'max_tokens') console.warn('Response truncated')
      const raw = (result.content || []).map((c: any) => c.text || '').join('')
      console.log('Raw AI:', raw.substring(0, 500))
      if (!raw.trim()) {
        setMessages(prev => [...prev, { role: 'assistant', text: 'Empty response from API.', type: 'error' }])
        setIsThinking(false)
        return
      }

      const data = parseAIResponse(raw)
      if (!data || !data.message) {
        console.error('Raw:', raw)
        setMessages(prev => [...prev, { role: 'assistant', text: `Parse failed. Preview:\n\n${raw.substring(0, 200)}...`, type: 'error' }])
        setIsThinking(false)
        return
      }

      const hasMoves = data.moves && data.moves.length > 0
      if (hasMoves && data.needsConfirmation) {
        const proposed = applyMoves(data.moves, blocks)
        const diff = computeDiff(blocks, proposed)
        setWhatIfBlocks(proposed); setWhatIfDiff(diff); setPendingMoves(data.moves)
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, thinking: data.thinking, type: 'proposal', moveCount: diff.size }])
      } else if (hasMoves) {
        const newBlocks = applyMoves(data.moves, blocks)
        setHistory(prev => [...prev, blocks])
        setBlocks(newBlocks)
        // Persist
        const diff = computeDiff(blocks, newBlocks)
        newBlocks.forEach(b => { if (diff.has(b.id)) persistBlockMove(b.id, b.week) })
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, thinking: data.thinking, type: 'applied', moveCount: data.moves.length }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: data.message, thinking: data.thinking, type: 'info' }])
      }
    } catch (err: any) {
      console.error('sendMessage:', err)
      setMessages(prev => [...prev, { role: 'assistant', text: `Connection error: ${err.message}`, type: 'error' }])
    }
    setIsThinking(false)
  }, [blocks, messages, isThinking, applyMoves, priorities, capacityOverrides, parseAIResponse, buildSystemPrompt, persistBlockMove])

  const undo = useCallback(() => {
    if (history.length === 0) return
    const prevBlocks = history[history.length - 1]
    if (!Array.isArray(prevBlocks)) return

    const currentBlocks = blocksRef.current
    const prevMap = new Map(prevBlocks.map(b => [b.id, b]))
    let revertCount = 0
    for (const curr of currentBlocks) {
      const prev = prevMap.get(curr.id)
      if (prev && prev.week !== curr.week) {
        persistBlockMove(prev.id, prev.week)
        revertCount++
      }
    }

    setBlocks(prevBlocks)
    setHistory(h => h.slice(0, -1))
    setWhatIfBlocks(null); setWhatIfDiff(null); setPendingMoves(null)
    setMessages(prev => [...prev, { role: 'assistant', text: `Undone. Reverted ${revertCount} block(s).`, type: 'info' }])
  }, [history, persistBlockMove])

  const adjustCapacity = useCallback((deptId: string, delta: number) => {
    setCapacityOverrides(prev => {
      const base = deptCapacities[deptId] || 0
      const current = prev[deptId] != null ? prev[deptId] : base
      const next = Math.max(0, current + delta)
      if (next === base) { const copy = { ...prev }; delete copy[deptId]; return copy }
      return { ...prev, [deptId]: next }
    })
  }, [deptCapacities])

  const resetSim = useCallback(() => { setCapacityOverrides({}); setSimMode(false) }, [])

  const totalHours = useMemo(() => displayBlocks.reduce((s, b) => s + b.hours, 0), [displayBlocks])
  const overCapCount = useMemo(() => {
    let c = 0
    for (const d of departments) { const cap = effectiveCapacity(d.id); for (let w = 0; w < numWeeks; w++) if ((capacityMap[`${d.id}::${w}`] || 0) > cap) c++ }
    return c
  }, [capacityMap, effectiveCapacity, departments, numWeeks])

  const handleHover = useCallback((block: Block) => { if (!dragState) setHoveredBlock(block) }, [dragState])
  const handleLeave = useCallback(() => { if (!dragState) setHoveredBlock(null) }, [dragState])
  const handleSelect = useCallback((sk: string) => { setSelectedSub(p => p === sk ? null : sk) }, [])

  // =====================================================
  // RENDER
  // =====================================================
  if (authLoading || !org) {
    return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}><Nav /><LoadingSkeleton /></div>
  }

  return (
    <PlanGate requires="schedule">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Nav />
      {!dataLoaded ? (
        <LoadingSkeleton />
      ) : (
        <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", background: '#FFF', flex: 1, color: '#111', display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Header */}
            <div style={{ padding: '12px 20px 0', borderBottom: '1px solid #E5E7EB', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', margin: 0 }}>Production</h1>
                    {/* View toggle */}
                    <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
                      <button onClick={() => setViewMode('flow')} style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 12px', border: 'none', cursor: 'pointer',
                        background: viewMode === 'flow' ? '#111' : '#FFF', color: viewMode === 'flow' ? '#FFF' : '#6B7280',
                        transition: 'all 0.15s',
                      }}>Dept Flow</button>
                      <button onClick={() => setViewMode('swimlane')} style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 12px', border: 'none', borderLeft: '1px solid #E5E7EB', cursor: 'pointer',
                        background: viewMode === 'swimlane' ? '#111' : '#FFF', color: viewMode === 'swimlane' ? '#FFF' : '#6B7280',
                        transition: 'all 0.15s',
                      }}>Swimlane</button>
                    </div>
                    {whatIfBlocks && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 6, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>WHAT-IF</span>}
                    {simMode && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 6, background: '#EDE9FE', color: '#5B21B6', border: '1px solid #C4B5FD' }}>SIM</span>}
                  </div>
                  <p style={{ fontSize: 12, color: '#6B7280', margin: '2px 0 0' }}>
                    {projects.length} projects &middot; <span style={{ fontFamily: "'SF Mono', monospace" }}>{totalHours.toLocaleString()}h</span>
                    {overCapCount > 0 && <span style={{ color: '#DC2626', marginLeft: 8 }}>{overCapCount} over-capacity</span>}
                    <span style={{ color: '#9CA3AF', marginLeft: 8 }}>Hold ⌥ to move dept independently</span>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <button
                    onPointerDown={e => { e.stopPropagation() }}
                    onClick={e => { e.stopPropagation(); e.preventDefault(); undo() }}
                    title={`Undo last change (${history.length} in history)`}
                    style={{
                      ...btnS('#FFF', history.length > 0 && !whatIfBlocks ? '#374151' : '#D1D5DB'),
                      padding: '5px 10px', cursor: history.length > 0 && !whatIfBlocks ? 'pointer' : 'default',
                      opacity: history.length > 0 && !whatIfBlocks ? 1 : 0.4,
                      pointerEvents: history.length > 0 && !whatIfBlocks ? 'auto' : 'none',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h13a4 4 0 0 1 0 8H7" /><path d="M3 10l4-4" /><path d="M3 10l4 4" /></svg>
                    <span style={{ fontSize: 11 }}>Undo</span>
                  </button>
                  {filter && <button onClick={() => setFilter(null)} style={btnS('#FEF3C7', '#92400E')}>Show All</button>}
                  <button onClick={() => setShowPriorityPanel(p => !p)} style={btnS(showPriorityPanel ? '#111' : '#FFF', showPriorityPanel ? '#FFF' : '#111')}>Priority</button>
                  {viewMode === 'flow' && <button onClick={() => { if (simMode) resetSim(); else setSimMode(true) }} style={btnS(simMode ? '#EDE9FE' : '#FFF', simMode ? '#5B21B6' : '#6B7280')}>{simMode ? 'Exit Sim' : 'Capacity Sim'}</button>}
                  <button onClick={() => setChatOpen(o => !o)} style={{ ...btnS(chatOpen ? '#111' : '#FFF', chatOpen ? '#FFF' : '#111'), display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    AI
                  </button>
                </div>
              </div>

              {/* Priority Panel */}
              {showPriorityPanel && (
                <div style={{ padding: '8px 0 10px', borderTop: '1px solid #F3F4F6', marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Project Priority</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {Object.entries(priorities).sort((a, b) => a[1] - b[1]).map(([pk, pri]) => {
                      const c = projectColors[pk] || COLOR_PALETTE[0]
                      return (
                        <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, background: '#FAFBFC' }}>
                          <div style={{ width: 22, fontSize: 11, fontWeight: 700, color: PRIORITY_COLORS[pri], textAlign: 'center' }}>P{pri}</div>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: c.bg }} />
                          <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#374151' }}>{projectNames[pk] || pk}</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginRight: 4 }}>{PRIORITY_LABELS[pri]}</div>
                          <button onClick={() => setPriorities(p => ({ ...p, [pk]: Math.max(1, pri - 1) }))} disabled={pri <= 1} style={{ background: 'none', border: 'none', cursor: pri > 1 ? 'pointer' : 'default', color: pri > 1 ? '#6B7280' : '#E5E7EB', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>{'\u25B2'}</button>
                          <button onClick={() => setPriorities(p => ({ ...p, [pk]: Math.min(5, pri + 1) }))} disabled={pri >= 5} style={{ background: 'none', border: 'none', cursor: pri < 5 ? 'pointer' : 'default', color: pri < 5 ? '#6B7280' : '#E5E7EB', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>{'\u25BC'}</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Project filter chips */}
              <div style={{ display: 'flex', gap: 5, paddingBottom: 8, flexWrap: 'wrap' }}>
                {projects.map(p => {
                  const c = projectColors[p.id] || COLOR_PALETTE[0]
                  const on = !filter || filter === p.id
                  const pri = priorities[p.id] || 3
                  return (
                    <button key={p.id} onClick={() => setFilter(f => f === p.id ? null : p.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 7,
                      border: `1.5px solid ${on ? c.bg : '#E5E7EB'}`, background: filter === p.id ? c.light : '#FFF',
                      cursor: 'pointer', opacity: on ? 1 : 0.35, transition: 'all 0.15s',
                    }}>
                      <div style={{ width: 7, height: 7, borderRadius: 2, background: c.bg }} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: c.text, whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: PRIORITY_COLORS[pri], marginLeft: 2 }}>P{pri}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* What-If bar */}
            {whatIfBlocks && (
              <div style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', borderBottom: '1px solid #FCD34D', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>Previewing {whatIfDiff?.size || 0} block move{whatIfDiff?.size !== 1 ? 's' : ''}</span>
                  <span style={{ fontSize: 11, color: '#B45309' }}>{(() => { if (!whatIfDiff) return ''; let e = 0, l = 0; whatIfDiff.forEach(d => { if (d.direction === 'earlier') e++; else l++ }); const p: string[] = []; if (e) p.push(`${e} earlier`); if (l) p.push(`${l} later`); return p.join(', ') })()}</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={discardWhatIf} style={{ fontSize: 12, fontWeight: 500, padding: '6px 16px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#FFF', color: '#6B7280', cursor: 'pointer' }}>Discard</button>
                  <button onClick={acceptWhatIf} style={{ fontSize: 12, fontWeight: 600, padding: '6px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#FFF', cursor: 'pointer' }}>Apply Changes</button>
                </div>
              </div>
            )}

            {/* Grid area */}
            <div ref={gridRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', userSelect: 'none' }}>
              {viewMode === 'flow' ? (
                <FlowView
                  blocks={displayBlocks} numWeeks={numWeeks} weekZero={weekZero}
                  departments={departments} deptColors={deptColors} projectColors={projectColors}
                  capacityMap={capacityMap} effectiveCapacity={effectiveCapacity}
                  filter={filter} highlightKey={highlightKey} dragState={dragState}
                  whatIfDiff={whatIfDiff} whatIfActive={!!whatIfBlocks}
                  onPointerDown={handlePointerDown} onHover={handleHover} onLeave={handleLeave} onSelect={handleSelect}
                  onDivide={(b) => setDivideBlock(b)}
                  onMerge={handleMerge}
                  siblingCounts={siblingCounts}
                  simMode={simMode} adjustCapacity={adjustCapacity} capacityOverrides={capacityOverrides}
                  deptCapacities={deptCapacities}
                  onWeekClick={(wi: number) => setSelectedWeek(sw => sw === wi ? null : wi)}
                />
              ) : (
                <SwimlaneView
                  blocks={displayBlocks} numWeeks={numWeeks} weekZero={weekZero}
                  departments={departments} deptColors={deptColors} projectColors={projectColors}
                  projectNames={projectNames} projectSubs={projectSubs}
                  subIdByKey={subIdByKey} subStatusMap={subStatusMap}
                  deptIndex={deptIndex} deptShortMap={deptShortMap}
                  capacityMap={capacityMap} effectiveCapacity={effectiveCapacity}
                  filter={filter} highlightKey={highlightKey} dragState={dragState}
                  whatIfDiff={whatIfDiff} whatIfActive={!!whatIfBlocks}
                  onPointerDown={handlePointerDown} onHover={handleHover} onLeave={handleLeave} onSelect={handleSelect}
                  onDivide={(b) => setDivideBlock(b)}
                  onMerge={handleMerge}
                  siblingCounts={siblingCounts}
                  priorities={priorities}
                  onWeekClick={(wi: number) => setSelectedWeek(sw => sw === wi ? null : wi)}
                />
              )}
            </div>
          </div>

          {/* Week Detail Panel — organized by department */}
          {selectedWeek !== null && (() => {
            const weekBlocks = displayBlocks.filter(b => b.week === selectedWeek)
            const weekDate = new Date(weekZero)
            weekDate.setDate(weekDate.getDate() + selectedWeek * 7)
            const weekLabel = weekDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            const totalH = weekBlocks.reduce((s, b) => s + b.hours, 0)

            return (
              <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', background: '#FFF', overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E7EB', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Week {selectedWeek + 1}</div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>{weekLabel}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'SF Mono', monospace", color: '#374151' }}>{totalH}h total</span>
                      <button onClick={() => setSelectedWeek(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                  {weekBlocks.length === 0 && (
                    <div style={{ padding: '20px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No work scheduled this week</div>
                  )}
                  {departments.map(dept => {
                    const deptBlocks = weekBlocks.filter(b => b.dept === dept.id)
                    if (deptBlocks.length === 0) return null
                    const deptH = deptBlocks.reduce((s, b) => s + b.hours, 0)
                    const cap = effectiveCapacity(dept.id)
                    const pct = cap > 0 ? Math.round((deptH / cap) * 100) : 0
                    const dc = deptColors[dept.id] || DEPT_COLOR_PALETTE[0]

                    return (
                      <div key={dept.id} style={{ marginBottom: 2 }}>
                        {/* Dept header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#FAFBFC', borderBottom: '1px solid #F3F4F6' }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: dc.bg, flexShrink: 0 }} />
                          <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#111' }}>{getDeptDisplayName(dept.name)}</div>
                          <span style={{ fontSize: 10, fontFamily: "'SF Mono', monospace", color: pct > 100 ? '#DC2626' : '#6B7280', fontWeight: pct > 100 ? 600 : 400 }}>{deptH}/{cap}h</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: pct > 100 ? '#DC2626' : pct > 80 ? '#D97706' : '#9CA3AF' }}>{pct}%</span>
                        </div>
                        {/* Projects in this dept this week */}
                        {deptBlocks.map(b => {
                          const pc = projectColors[b.project] || COLOR_PALETTE[0]
                          return (
                            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px 6px 32px', borderBottom: '1px solid #F9FAFB' }}>
                              <div style={{ width: 6, height: 6, borderRadius: 2, background: pc.bg, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.projectName}</div>
                                <div style={{ fontSize: 10, color: '#9CA3AF' }}>{b.sub}</div>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'SF Mono', monospace", color: '#6B7280', flexShrink: 0 }}>{b.hours}h</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Chat */}
          {chatOpen && (
            <ChatPanel
              messages={messages} isThinking={isThinking} chatInput={chatInput} setChatInput={setChatInput}
              sendMessage={sendMessage} whatIfBlocks={whatIfBlocks} whatIfDiff={whatIfDiff}
              acceptWhatIf={acceptWhatIf} discardWhatIf={discardWhatIf}
              onClose={() => setChatOpen(false)}
            />
          )}
        </div>
      )}

      {divideBlock && (
        <DivideBlockModal
          blockId={divideBlock.id}
          deptName={departments.find((d) => d.id === divideBlock.dept)?.name || 'Dept'}
          projectName={divideBlock.projectName}
          subprojectName={divideBlock.sub}
          totalHours={divideBlock.hours}
          initialWeekStartIso={weekIndexToDate(divideBlock.week)}
          saving={dividing}
          onCancel={() => setDivideBlock(null)}
          onSave={handleDivideSave}
        />
      )}
      </div>
    </PlanGate>
  )
}

'use client'

// ============================================================================
// /projects/[id]/takeoff — shop-facing BOM view
// ============================================================================
// Reads project_scope_items (populated by the /api/parse-drawings flow) and
// renders three rollups: sheet goods + solid stock + specialty (materials),
// hinges / slides / drawer systems / pulls / specialty (hardware), and finish
// sq ft grouped by spec.
//
// This is distinct from /projects/[id]/estimate which is the client-facing
// printable quote doc. When Phase 4 builds the real estimator editor, the
// BOM component here will be embedded as a side panel.
// ============================================================================

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import type { ProjectScopeItem } from '@/lib/types'
import { calculateMaterials, type MaterialLine } from '@/lib/bom/material-calc'
import { calculateHardware, type HardwareLine } from '@/lib/bom/hardware-calc'
import { calculateFinishes, type FinishLine } from '@/lib/bom/finish-calc'
import { ArrowLeft, AlertTriangle, FileText, Layers, Wrench, Paintbrush } from 'lucide-react'

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  base_cabinet: 'Base cabinet',
  upper_cabinet: 'Upper cabinet',
  full_height: 'Full height',
  vanity: 'Vanity',
  drawer_box: 'Drawer box',
  countertop: 'Countertop',
  panel: 'Panel',
  scribe: 'Scribe',
  led: 'LED',
  hardware: 'Hardware',
  custom: 'Custom',
  other: 'Other',
}

export default function TakeoffPage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [items, setItems] = useState<ProjectScopeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const [projRes, itemsRes] = await Promise.all([
        supabase.from('projects').select('id, name, client_name').eq('id', projectId).single(),
        supabase
          .from('project_scope_items')
          .select('*')
          .eq('project_id', projectId)
          .order('sort_order', { ascending: true }),
      ])
      if (cancelled) return
      if (projRes.error) {
        setError(projRes.error.message || 'Failed to load project')
      } else {
        setProject(projRes.data as ProjectRow)
      }
      if (itemsRes.error) {
        console.warn('takeoff: scope items load failed', itemsRes.error)
        setItems([])
      } else {
        setItems((itemsRes.data || []) as ProjectScopeItem[])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading takeoff…
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-sm">
        <div className="text-[#991B1B]">{error || 'Project not found'}</div>
        <button
          onClick={() => router.push('/projects')}
          className="text-[#2563EB] hover:underline"
        >
          Back to projects
        </button>
      </div>
    )
  }

  // ── Run the three aggregations ──
  const materials = calculateMaterials(items)
  const hardware = calculateHardware(items)
  const finishes = calculateFinishes(items)

  const totalSheets = materials
    .filter((m) => m.unit === 'sheets')
    .reduce((s, m) => s + m.quantity, 0)
  const reviewCount = items.filter((i) => i.needs_review).length

  // Group items by room for the "scope items" section
  const itemsByRoom = new Map<string, ProjectScopeItem[]>()
  for (const item of items) {
    const room = item.room || 'Other'
    const arr = itemsByRoom.get(room) || []
    arr.push(item)
    itemsByRoom.set(room, arr)
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Top bar */}
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to project
        </button>
        <div className="text-xs text-[#9CA3AF]">
          Shop-facing takeoff · BOM from parsed drawings
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
            Takeoff
          </div>
          <h1 className="text-2xl font-semibold text-[#111] mt-1">{project.name}</h1>
          {project.client_name && (
            <div className="text-sm text-[#6B7280] mt-0.5">{project.client_name}</div>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Scope items" value={items.length.toString()} />
          <Stat label="Rooms" value={itemsByRoom.size.toString()} />
          <Stat label="Sheet goods" value={totalSheets > 0 ? `${totalSheets} sheets` : '—'} />
          <Stat
            label="Needs review"
            value={reviewCount.toString()}
            variant={reviewCount > 0 ? 'warn' : 'default'}
          />
        </div>

        {/* Empty state */}
        {items.length === 0 && (
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center">
            <FileText className="w-6 h-6 text-[#9CA3AF] mx-auto mb-3" />
            <div className="text-sm font-medium text-[#111]">No scope items yet</div>
            <div className="text-[12px] text-[#6B7280] mt-1">
              Parse an architectural drawing on the{' '}
              <Link href="/sales" className="text-[#2563EB] hover:underline">
                sales dashboard
              </Link>{' '}
              to populate the takeoff.
            </div>
          </div>
        )}

        {/* Materials */}
        {materials.length > 0 && (
          <Section title="Materials" icon={<Layers className="w-4 h-4" />}>
            <Table
              headers={['Material', 'Group', 'Thickness', 'Qty', 'Unit', 'Sources']}
              rows={materials.map((m) => [
                m.name,
                m.group,
                m.thickness,
                m.quantity.toString(),
                m.unit,
                m.sourceItems.join(', '),
              ])}
            />
          </Section>
        )}

        {/* Hardware */}
        {hardware.length > 0 && (
          <Section title="Hardware" icon={<Wrench className="w-4 h-4" />}>
            <Table
              headers={['Description', 'Spec', 'Group', 'Qty', 'Sources']}
              rows={hardware.map((h) => [
                h.description,
                h.specification,
                h.group,
                h.quantity.toString(),
                h.sourceItems.join(', '),
              ])}
            />
          </Section>
        )}

        {/* Finishes */}
        {finishes.length > 0 && (
          <Section title="Finishes" icon={<Paintbrush className="w-4 h-4" />}>
            <Table
              headers={['Finish', 'Color', 'Sheen', 'Sides', 'Sq ft', 'Items']}
              rows={finishes.map((f) => [
                f.finishType || '—',
                f.stainColor || '—',
                f.sheen || '—',
                f.sidesToFinish || 'Exterior Only',
                f.surfaceAreaSqFt.toString(),
                f.itemNames.join(', '),
              ])}
            />
          </Section>
        )}

        {/* Scope items (grouped by room) */}
        {items.length > 0 && (
          <Section title="Scope items" icon={<FileText className="w-4 h-4" />}>
            <div className="bg-white border border-[#E5E7EB] rounded-xl divide-y divide-[#F3F4F6]">
              {Array.from(itemsByRoom.entries()).map(([room, roomItems]) => (
                <div key={room} className="p-4">
                  <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                    {room}
                  </div>
                  <div className="space-y-3">
                    {roomItems.map((item) => (
                      <div key={item.id} className="text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-[#111] flex items-center gap-2">
                              {item.name}
                              {item.needs_review && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded px-1.5 py-0.5">
                                  <AlertTriangle className="w-3 h-3" />
                                  Review
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#6B7280] mt-0.5">
                              {[
                                item.category ? CATEGORY_LABEL[item.category] || item.category : null,
                                item.item_type,
                                item.quality && item.quality !== 'unspecified' ? item.quality : null,
                                item.linear_feet != null ? `${item.linear_feet} LF` : null,
                                (item.quantity || 1) > 1 ? `qty ${item.quantity}` : null,
                                item.source_sheet ? `Sheet ${item.source_sheet}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {item.features?.notes && (
                              <div className="text-[11px] text-[#6B7280] mt-1 italic">
                                {item.features.notes}
                              </div>
                            )}
                          </div>
                          {item.parser_confidence != null && (
                            <div className="text-[10px] text-[#9CA3AF] font-mono tabular-nums shrink-0">
                              {Math.round(item.parser_confidence * 100)}%
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Presentational helpers ──

function Stat({
  label,
  value,
  variant = 'default',
}: {
  label: string
  value: string
  variant?: 'default' | 'warn'
}) {
  const cls =
    variant === 'warn' && value !== '0'
      ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
      : 'bg-white border-[#E5E7EB] text-[#111]'
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="text-[#6B7280]">{icon}</div>
        <h2 className="text-sm font-semibold text-[#111]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider px-4 py-2"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-2 text-[#111] ${j === 0 ? 'font-medium' : 'text-[#374151]'} ${
                    j === row.length - 1 ? 'text-[11px] text-[#6B7280]' : ''
                  }`}
                >
                  {cell || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

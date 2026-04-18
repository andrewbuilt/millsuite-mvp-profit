// POST /api/projects/[id]/rollup
// Recomputes projects.bid_total and projects.actual_total from current
// subprojects, time_entries, and invoices. Idempotent — safe to fire on any
// financial-input change.

import { NextRequest, NextResponse } from 'next/server'
import { rollupProject } from '@/lib/project-rollup'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params)
    const projectId = resolved.id
    if (!projectId) {
      return NextResponse.json({ error: 'Project id required' }, { status: 400 })
    }

    const totals = await rollupProject(projectId)
    if (!totals) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(totals)
  } catch (err: any) {
    console.error('rollup error:', err)
    return NextResponse.json({ error: err?.message || 'Rollup failed' }, { status: 500 })
  }
}

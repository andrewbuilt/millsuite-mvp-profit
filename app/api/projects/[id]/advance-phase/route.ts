// POST /api/projects/[id]/advance-phase
// Asks the phase engine whether conditions are met to move the project from
// pre_production → scheduling (or scheduling → in_production). Idempotent —
// safe to call after any selection change or time entry creation.

import { NextRequest, NextResponse } from 'next/server'
import { checkAndAdvanceProductionPhase } from '@/lib/phase'

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

    const newPhase = await checkAndAdvanceProductionPhase(projectId)
    return NextResponse.json({ production_phase: newPhase })
  } catch (err: any) {
    console.error('advance-phase error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to advance phase' },
      { status: 500 }
    )
  }
}

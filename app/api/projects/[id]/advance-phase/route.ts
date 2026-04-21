// POST /api/projects/[id]/advance-phase
// Asks the phase engine whether conditions are met to move the project from
// sold → production (i.e. every approval item and every latest drawing
// revision is approved across every subproject). Idempotent.

import { NextRequest, NextResponse } from 'next/server'
import { checkAndAdvanceProjectStage } from '@/lib/phase'

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

    const stage = await checkAndAdvanceProjectStage(projectId)
    return NextResponse.json({ stage })
  } catch (err: any) {
    console.error('advance-phase error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to advance stage' },
      { status: 500 }
    )
  }
}

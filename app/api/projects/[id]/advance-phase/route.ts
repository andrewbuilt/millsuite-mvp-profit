// POST /api/projects/[id]/advance-phase
// Asks the phase engine whether conditions are met to move the project from
// sold → production (i.e. every approval item and every latest drawing
// revision is approved across every subproject). Idempotent.

import { NextRequest, NextResponse } from 'next/server'
import { checkAndAdvanceProjectStage } from '@/lib/phase'
import {
  resolveApiCaller,
  unauthorized,
  notFound,
  projectBelongsToOrg,
} from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolved = await Promise.resolve(params)
    const projectId = resolved.id
    if (!projectId) {
      return NextResponse.json({ error: 'Project id required' }, { status: 400 })
    }

    // ── Auth + tenant isolation (M5) ──
    // Was reachable by anyone with a project UUID. Require a signed-in
    // caller and confirm the project belongs to their org (404 on miss
    // so we don't leak another org's project IDs).
    const caller = await resolveApiCaller(req)
    if (!caller) return unauthorized()
    if (!(await projectBelongsToOrg(projectId, caller.orgId))) return notFound()

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

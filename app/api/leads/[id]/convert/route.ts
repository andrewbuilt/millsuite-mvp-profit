// POST /api/leads/[id]/convert
// Converts a lead to a project — the "sold handoff" event. Creates the project,
// copies subprojects with all v2/v3 fields, explodes dept_hours into
// department_allocations, seeds selections, generates cash_flow_receivables,
// and sets up the client portal. Marks the lead as sold.

import { NextRequest, NextResponse } from 'next/server'
import { convertLeadToProject } from '@/lib/leads'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Next.js 15+ uses Promise-based params; 14 uses direct object. Handle both.
    const resolvedParams = await Promise.resolve(params)
    const leadId = resolvedParams.id

    if (!leadId) {
      return NextResponse.json({ error: 'Lead id required' }, { status: 400 })
    }

    const project = await convertLeadToProject(leadId)

    return NextResponse.json({
      project_id: project.id,
      project_name: project.name,
      portal_slug: project.portal_slug,
      message: `Converted to project: ${project.name}`,
    })
  } catch (err: any) {
    console.error('Error converting lead:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to convert lead' },
      { status: 500 }
    )
  }
}

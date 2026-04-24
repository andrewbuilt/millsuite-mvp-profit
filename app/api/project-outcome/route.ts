// POST /api/project-outcome
// Generates a locked financial outcome record when a project completes.
// Called when project status changes to 'complete'.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { project_id, org_id } = await req.json()
    if (!project_id || !org_id) return NextResponse.json({ error: 'project_id and org_id required' }, { status: 400 })

    // Check if outcome already exists
    const { data: existing } = await supabase
      .from('project_outcomes')
      .select('id')
      .eq('project_id', project_id)
      .maybeSingle()

    if (existing) return NextResponse.json({ message: 'Outcome already captured', id: existing.id })

    // Get project
    const { data: project } = await supabase
      .from('projects')
      .select('id, estimated_price, estimated_hours, locked_shop_rate')
      .eq('id', project_id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Get subprojects for material estimates
    const { data: subs } = await supabase
      .from('subprojects')
      .select('id, estimated_price, estimated_hours, material_cost')
      .eq('project_id', project_id)

    const estimatedMaterials = (subs || []).reduce((s, sub) => s + (sub.material_cost || 0), 0)
    const estimatedHours = project.estimated_hours || (subs || []).reduce((s, sub) => s + (sub.estimated_hours || 0), 0)
    const estimatedPrice = project.estimated_price || (subs || []).reduce((s, sub) => s + (sub.estimated_price || 0), 0)

    // Actual hours from time entries
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select('duration_minutes, user_id')
      .eq('project_id', project_id)

    const actualHours = (timeEntries || []).reduce((s, e) => s + (e.duration_minutes || 0), 0) / 60

    // Actual hours by department
    const subIds = (subs || []).map(s => s.id)
    let deptHoursActual: Record<string, number> = {}
    let deptHoursEstimated: Record<string, number> = {}

    if (subIds.length > 0) {
      const { data: allocations } = await supabase
        .from('department_allocations')
        .select('department_id, estimated_hours, actual_hours')
        .in('subproject_id', subIds)

      const { data: depts } = await supabase
        .from('departments')
        .select('id, name')

      const deptNameMap = new Map((depts || []).map(d => [d.id, d.name]))

      for (const alloc of (allocations || [])) {
        const name = deptNameMap.get(alloc.department_id) || 'Unknown'
        deptHoursEstimated[name] = (deptHoursEstimated[name] || 0) + (alloc.estimated_hours || 0)
        deptHoursActual[name] = (deptHoursActual[name] || 0) + (alloc.actual_hours || 0)
      }
    }

    // Actual revenue from cash_flow
    const { data: cashFlow } = await supabase
      .from('cash_flow')
      .select('amount, received_amount, status, type')
      .eq('project_id', project_id)

    const actualRevenue = (cashFlow || [])
      .filter(cf => ['received', 'partial'].includes(cf.status || ''))
      .reduce((s, cf) => s + (cf.received_amount || cf.amount || 0), 0)

    // Use estimated price as revenue if no QB payments tracked
    const revenue = actualRevenue > 0 ? actualRevenue : estimatedPrice

    // Actual material cost from parsed invoices (if available)
    const { data: invoices } = await supabase
      .from('invoices')
      .select('total')
      .eq('project_id', project_id)

    const actualMaterials = (invoices || []).reduce((s, inv) => s + (inv.total || 0), 0)
    const materials = actualMaterials > 0 ? actualMaterials : estimatedMaterials

    // Shop rate and utilization at completion
    const shopRate = project.locked_shop_rate ?? 0
    const actualLaborCost = actualHours * shopRate
    const actualMargin = revenue - actualLaborCost - materials
    const actualMarginPct = revenue > 0 ? (actualMargin / revenue) * 100 : 0

    // Variances
    const hoursVariance = actualHours - estimatedHours
    const hoursVariancePct = estimatedHours > 0 ? (hoursVariance / estimatedHours) * 100 : 0
    const materialVariance = materials - estimatedMaterials
    const materialVariancePct = estimatedMaterials > 0 ? (materialVariance / estimatedMaterials) * 100 : 0

    // Latest snapshot for utilization context
    const { data: latestSnapshot } = await supabase
      .from('weekly_snapshots')
      .select('utilization_actual, headcount')
      .eq('org_id', org_id)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()

    const outcome = {
      org_id,
      project_id,
      estimated_hours: Math.round(estimatedHours * 10) / 10,
      estimated_materials: Math.round(estimatedMaterials * 100) / 100,
      estimated_price: Math.round(estimatedPrice * 100) / 100,
      actual_hours: Math.round(actualHours * 10) / 10,
      actual_labor_cost: Math.round(actualLaborCost * 100) / 100,
      actual_materials: Math.round(materials * 100) / 100,
      actual_revenue: Math.round(revenue * 100) / 100,
      actual_margin: Math.round(actualMargin * 100) / 100,
      actual_margin_pct: Math.round(actualMarginPct * 10) / 10,
      hours_variance: Math.round(hoursVariance * 10) / 10,
      hours_variance_pct: Math.round(hoursVariancePct * 10) / 10,
      material_variance: Math.round(materialVariance * 100) / 100,
      material_variance_pct: Math.round(materialVariancePct * 10) / 10,
      dept_hours_estimated: deptHoursEstimated,
      dept_hours_actual: deptHoursActual,
      shop_rate_at_completion: shopRate,
      utilization_at_completion: latestSnapshot?.utilization_actual || null,
      headcount_at_completion: latestSnapshot?.headcount || null,
      change_order_count: 0,
      change_order_revenue: 0,
      completed_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('project_outcomes')
      .insert(outcome)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ outcome: data })
  } catch (err: any) {
    console.error('Project outcome error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

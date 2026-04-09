// POST /api/weekly-snapshot
// Captures a weekly snapshot of shop-wide metrics for the reporting timeline.
// Can be called manually or via cron. Idempotent — upserts on (org_id, week_start).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { org_id } = await req.json()
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    // Get the Monday of this week
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now)
    monday.setDate(diff)
    monday.setHours(0, 0, 0, 0)
    const weekStart = monday.toISOString().split('T')[0]

    // Trailing 7-day window for this snapshot
    const weekEnd = new Date(monday)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const weekEndStr = weekEnd.toISOString().split('T')[0]

    // 1. Shop rate from latest snapshot
    const { data: rateData } = await supabase
      .from('shop_rate_snapshots')
      .select('calculated_shop_rate, effective_rate')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const shopRate = rateData?.effective_rate || rateData?.calculated_shop_rate || null

    // 2. Org settings for utilization assumption
    const { data: org } = await supabase
      .from('orgs')
      .select('shop_rate')
      .eq('id', org_id)
      .single()

    // 3. Headcount — active users in this org
    const { count: headcount } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)

    // 4. Time entries this week → billable hours
    const { data: timeEntries } = await supabase
      .from('time_entries')
      .select('duration_minutes')
      .eq('org_id', org_id)
      .gte('started_at', `${weekStart}T00:00:00`)
      .lte('started_at', `${weekEndStr}T23:59:59`)

    const billableHours = (timeEntries || []).reduce((s, e) => s + (e.duration_minutes || 0), 0) / 60

    // Paid hours = headcount * 40 (standard work week)
    const paidHours = (headcount || 0) * 40

    // Utilization
    const utilizationActual = paidHours > 0 ? (billableHours / paidHours) * 100 : 0

    // 5. Revenue this week from cash_flow
    const { data: payments } = await supabase
      .from('cash_flow')
      .select('amount')
      .eq('project_id', org_id) // This won't work — need to join. Use projects instead.

    // Actually: get all projects for this org, then sum cash_flow payments this week
    const { data: projects } = await supabase
      .from('projects')
      .select('id')
      .eq('org_id', org_id)

    const projectIds = (projects || []).map(p => p.id)
    let totalRevenue = 0
    if (projectIds.length > 0) {
      const { data: weekPayments } = await supabase
        .from('cash_flow')
        .select('amount, received_amount')
        .in('project_id', projectIds)
        .in('status', ['received', 'partial'])
        .gte('payment_date', weekStart)
        .lte('payment_date', weekEndStr)

      totalRevenue = (weekPayments || []).reduce((s, p) => s + (p.received_amount || p.amount || 0), 0)
    }

    // 6. Material cost this week from invoices
    let totalMaterialCost = 0
    if (projectIds.length > 0) {
      const { data: weekInvoices } = await supabase
        .from('invoices')
        .select('total_amount')
        .in('project_id', projectIds)
        .gte('created_at', `${weekStart}T00:00:00`)
        .lte('created_at', `${weekEndStr}T23:59:59`)

      totalMaterialCost = (weekInvoices || []).reduce((s, inv) => s + (inv.total_amount || 0), 0)
    }

    // 7. Overhead from shop rate settings
    let totalOverhead = 0
    const { data: shopSettings } = await supabase
      .from('shop_rate_settings')
      .select('monthly_rent, monthly_utilities, monthly_insurance, monthly_equipment, monthly_misc_overhead, owner_salary')
      .eq('org_id', org_id)
      .maybeSingle()

    if (shopSettings) {
      const monthlyOverhead = (shopSettings.monthly_rent || 0) + (shopSettings.monthly_utilities || 0) +
        (shopSettings.monthly_insurance || 0) + (shopSettings.monthly_equipment || 0) +
        (shopSettings.monthly_misc_overhead || 0) + (shopSettings.owner_salary || 0)
      totalOverhead = Math.round(monthlyOverhead / 4.33) // Weekly portion of monthly overhead
    }

    // 8. Labor cost this week = billable hours * shop rate
    const totalLaborCost = billableHours * (shopRate || 75)

    // 9. Project counts
    const { count: activeCount } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)
      .in('status', ['active', 'pre_production', 'in_production'])

    const { count: shippedCount } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)
      .eq('status', 'complete')
      .gte('completed_at', `${weekStart}T00:00:00`)

    // 8. Gross margin
    const grossMarginPct = totalRevenue > 0
      ? ((totalRevenue - totalLaborCost) / totalRevenue) * 100
      : null

    // Upsert snapshot
    const snapshot = {
      org_id,
      week_start: weekStart,
      shop_rate: shopRate,
      utilization_assumed: 80, // TODO: make configurable per org
      utilization_actual: Math.round(utilizationActual * 10) / 10,
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_labor_cost: Math.round(totalLaborCost * 100) / 100,
      total_material_cost: Math.round(totalMaterialCost * 100) / 100,
      total_overhead: Math.round(totalOverhead * 100) / 100,
      gross_margin_pct: grossMarginPct ? Math.round(grossMarginPct * 10) / 10 : null,
      headcount: headcount || 0,
      billable_hours: Math.round(billableHours * 10) / 10,
      paid_hours: paidHours,
      projects_active: activeCount || 0,
      projects_shipped: shippedCount || 0,
    }

    const { data, error } = await supabase
      .from('weekly_snapshots')
      .upsert(snapshot, { onConflict: 'org_id,week_start' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ snapshot: data })
  } catch (err: any) {
    console.error('Weekly snapshot error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

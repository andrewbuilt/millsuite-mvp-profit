'use client'

// ============================================================================
// /team — Team & Departments
// ============================================================================
// Single source of truth for team comp + billable flag is now
// orgs.team_members (jsonb), the same column the welcome walkthrough +
// /settings shop-rate calculator read/write. /team mirrors that surface
// so a member added in any of the three appears in all three.
//
// users.hourly_cost and users.is_billable were the legacy storage shape;
// nothing else in the live app reads them after this PR. A follow-up
// migration can drop the columns.
//
// Department assignments stay on department_members (separate concern —
// scheduling / time-tracking categorization, not shop-rate denominator).
// To bridge the two: TeamMember.user_id is an optional FK to users.id,
// set on first dept-toggle. The first toggle auto-creates a users row
// whose name matches the team member, then writes the user_id back to
// team_members so subsequent dept toggles + scheduling-side reads share
// the same identity.
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import PlanGate from '@/components/plan-gate'
import { useAutosave } from '@/hooks/use-autosave'
import SaveStatus from '@/components/save-status'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { Trash2, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import HolidaysAndPtoSection from '@/components/team/HolidaysAndPtoSection'
import {
  saveShopRateInputs,
  saveShopRate,
  makeTeamMember,
  computeDerivedShopRate,
  sumOverheadAnnual,
  sumTeamAnnualComp,
  sumBillableHoursYear,
  type TeamMember,
  type OverheadInputs,
  type BillableHoursInputs,
} from '@/lib/shop-rate-setup'
import { loadProjectDeptHours } from '@/lib/project-hours'
import {
  loadPtoRequests,
  loadOrCreateDefaultPolicy,
  savePolicyRules,
  approvePtoRequest,
  denyPtoRequest,
  deletePtoRequest,
  computeBalance,
  type PtoRequest,
  type PtoPolicy,
  type PtoBand,
} from '@/lib/pto'

interface Department {
  id: string
  name: string
  color: string
  display_order: number
  hours_per_day: number
}

const DEPT_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#6B7280']

export default function TeamPage() {
  return (
    <>
      <PlanGate requires="team">
        <TeamContent />
      </PlanGate>
    </>
  )
}

function TeamContent() {
  const { org, user, refreshOrg } = useAuth()
  const { confirm, alert: showAlert } = useConfirm()
  const [departments, setDepartments] = useState<Department[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [ptoRequests, setPtoRequests] = useState<PtoRequest[]>([])
  const [ptoPolicy, setPtoPolicy] = useState<PtoPolicy | null>(null)
  // false once the PTO tables are confirmed missing (migration 062 not run
  // yet) so we hide the section instead of erroring the whole page.
  const [ptoReady, setPtoReady] = useState(true)
  const [overhead, setOverhead] = useState<OverheadInputs>({})
  const [billable, setBillable] = useState<BillableHoursInputs>({
    hrs_per_week: 40,
    weeks_per_year: 48,
    utilization_pct: 70,
  })
  const [shopRate, setShopRate] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // Owner-only: compensation figures. Server-authoritative (the /api/team/setup
  // route strips comp for non-owners) + a secure default of false.
  const [canSeeComp, setCanSeeComp] = useState(false)
  const [savingRate, setSavingRate] = useState(false)
  const [rateSavedAt, setRateSavedAt] = useState<number | null>(null)
  // Shop-rate extras (chunk C).
  const [snapshots, setSnapshots] = useState<Array<{ id: string; effective_rate: number; created_at: string }>>([])
  const [rateAlerts, setRateAlerts] = useState<Array<{ id: string; name: string; effRate: number; belowBreakEven: boolean }>>([])

  const [newDeptName, setNewDeptName] = useState('')
  const [addingDept, setAddingDept] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberComp, setNewMemberComp] = useState('')
  const [addingMember, setAddingMember] = useState(false)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      // Load via the server route so comp is stripped server-side for
      // non-owners (never ships to their client).
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/team/setup', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        // The derived shop rate is computed from this payload, and comp +
        // overhead are edited over on Settings — a cached response would show
        // a stale rate after coming back here.
        cache: 'no-store',
      })
      const setup = await res.json()
      const { data: depts } = await supabase
        .from('departments')
        .select('*')
        .eq('org_id', org.id)
        .order('display_order')
      if (cancelled) return
      setTeam(setup.team || [])
      setOverhead(setup.overhead || {})
      setBillable(setup.billable)
      setShopRate(setup.shopRate || 0)
      setCanSeeComp(!!setup.canSeeComp)
      setDepartments(depts || [])
      setLoaded(true)

      // Shop-rate snapshot history (chunk C). Table predates this (001).
      loadSnapshots()

      // PTO (chunk B). Guarded: if migration 062 hasn't run yet the tables
      // are missing — hide the section rather than erroring the page.
      try {
        const [reqs, policy] = await Promise.all([
          loadPtoRequests(org.id),
          loadOrCreateDefaultPolicy(org.id),
        ])
        if (cancelled) return
        setPtoRequests(reqs)
        setPtoPolicy(policy)
        setPtoReady(true)
      } catch (e) {
        if (!cancelled) setPtoReady(false)
        console.warn('PTO load skipped (migration 062 not run?)', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), [])

  async function reloadPto() {
    if (!org?.id) return
    try {
      setPtoRequests(await loadPtoRequests(org.id))
    } catch (e) {
      console.warn('PTO reload', e)
    }
  }

  async function approveRequest(req: PtoRequest) {
    if (!user?.id) return
    const member = team.find((m) => m.id === req.team_member_id)
    try {
      await approvePtoRequest(req, user.id, member, Number(billable.hrs_per_week) || 40)
      await reloadPto()
    } catch (e) {
      console.error('approve PTO', e)
    }
  }

  async function denyRequest(req: PtoRequest) {
    if (!user?.id) return
    try {
      await denyPtoRequest(req, user.id)
      await reloadPto()
    } catch (e) {
      console.error('deny PTO', e)
    }
  }

  async function removeRequest(req: PtoRequest) {
    const ok = await confirm({
      title: 'Delete request?',
      message: 'This removes the request and any capacity it blocked.',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deletePtoRequest(req)
      await reloadPto()
    } catch (e) {
      console.error('delete PTO', e)
    }
  }

  async function updatePolicyBands(rules: PtoBand[]) {
    if (!ptoPolicy) return
    setPtoPolicy({ ...ptoPolicy, rules })
    try {
      await savePolicyRules(ptoPolicy.id, rules)
    } catch (e) {
      console.error('save policy', e)
    }
  }

  // Debounced persist of team_members on any change. OWNER-ONLY: for
  // non-owners `team` has comp stripped to 0, so persisting it would wipe
  // everyone's comp — never write it. (Non-owners also don't get the editable
  // roster, so there's nothing to save.)
  //
  // useAutosave, not a raw setTimeout: the old version cancelled the pending
  // save on unmount, so editing a field and navigating away inside 600ms threw
  // the edit away silently (fix list 2, item 1). This flushes on the way out
  // and exposes `teamSave.status` for the indicator next to the roster.
  const orgId = org?.id
  const persistTeam = useCallback(
    (next: TeamMember[]) => saveShopRateInputs(orgId!, { team: next }),
    [orgId],
  )
  const teamSave = useAutosave(team, persistTeam, {
    enabled: !!orgId && loaded && canSeeComp,
    label: 'team save',
  })

  const derivedRate = useMemo(
    () => computeDerivedShopRate(overhead, team, billable),
    [overhead, team, billable],
  )
  // Break-even = the cost-covering derived rate. Projects should bid above
  // it; the alert strip flags anything under break-even × 1.15.
  const breakEven = derivedRate

  // Margin alert strip (chunk C2). Loads active projects' bid_total + est
  // hours (N parallel calls, fine at beta scale) and flags underpriced ones.
  useEffect(() => {
    if (!org?.id || !loaded || breakEven <= 0) {
      setRateAlerts([])
      return
    }
    let cancelled = false
    ;(async () => {
      const { data: projs } = await supabase
        .from('projects')
        .select('id, name, bid_total, stage')
        .eq('org_id', org.id)
        .in('stage', ['sold', 'production', 'installed'])
      const list = (projs || []) as Array<{ id: string; name: string; bid_total: number; stage: string }>
      const threshold = breakEven * 1.15
      const rows = await Promise.all(
        list.map(async (p) => {
          const { totalHours } = await loadProjectDeptHours(org.id, p.id)
          if (!totalHours || totalHours <= 0 || !p.bid_total) return null
          const effRate = p.bid_total / totalHours
          if (effRate >= threshold) return null
          return { id: p.id, name: p.name, effRate, belowBreakEven: effRate < breakEven }
        }),
      )
      if (cancelled) return
      setRateAlerts(
        rows.filter(Boolean).sort((a, b) => a!.effRate - b!.effRate) as Array<{
          id: string
          name: string
          effRate: number
          belowBreakEven: boolean
        }>,
      )
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id, loaded, breakEven])

  // ── Departments CRUD ──

  async function addDepartment() {
    if (!newDeptName.trim() || !org?.id) return
    // Colour + order come from what's ALREADY there, not from the count.
    // Counting breaks the moment a department is deleted (the length goes
    // back down and the next add reuses a colour and an order that are still
    // in use) — which is how Built ended up with four cyan depts all at
    // display_order 5.
    const used = new Set(departments.map((d) => d.color))
    const color =
      DEPT_COLORS.find((c) => !used.has(c)) ??
      DEPT_COLORS[departments.length % DEPT_COLORS.length]
    const displayOrder =
      departments.reduce((max, d) => Math.max(max, Number(d.display_order) || 0), 0) + 1
    const { data, error } = await supabase
      .from('departments')
      .insert({
        org_id: org.id,
        name: newDeptName.trim(),
        color,
        display_order: displayOrder,
      })
      .select()
      .single()
    if (error || !data) {
      console.warn('add department', error)
      await showAlert({
        title: 'Could not add the department',
        message: error?.message || 'The department was not created. Try again.',
      })
      return
    }
    setDepartments((prev) => [...prev, data as Department])
    setNewDeptName('')
    setAddingDept(false)
  }

  async function deleteDepartment(id: string) {
    const dept = departments.find((d) => d.id === id)
    const ok = await confirm({
      title: 'Delete department?',
      message: `${dept?.name ?? 'This department'} will be removed. Members assigned to it stay on the team but lose this dept tag.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    await supabase.from('departments').delete().eq('id', id)
    setDepartments((prev) => prev.filter((d) => d.id !== id))
    // Drop this dept from any team member's assignments so the schedule
    // capacity calc + UI stay consistent with the deleted dept.
    setTeam((prev) =>
      prev.map((m) => ({
        ...m,
        dept_assignments: (m.dept_assignments || []).filter((d) => d !== id),
      })),
    )
  }

  // ── Team CRUD (orgs.team_members jsonb) ──

  function addMember() {
    if (!newMemberName.trim()) return
    const comp = parseFloat(newMemberComp) || 0
    setTeam((prev) => [
      ...prev,
      makeTeamMember(newMemberName.trim(), comp, true),
    ])
    setNewMemberName('')
    setNewMemberComp('')
    setAddingMember(false)
  }

  function patchMember(id: string, patch: Partial<TeamMember>) {
    setTeam((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  async function deleteMember(id: string) {
    const member = team.find((m) => m.id === id)
    if (!member) return
    const ok = await confirm({
      title: 'Remove team member?',
      message: `${member.name || 'This team member'} will be removed from this team. Their dept assignments and time entries stay intact.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!ok) return
    setTeam((prev) => prev.filter((m) => m.id !== id))
    if (member.user_id) {
      // Cascade: drop scheduling identity rows associated with this team
      // member. The dept_assignments live on team_members so the local
      // state update above already cleared them.
      void supabase.from('department_members').delete().eq('user_id', member.user_id)
      void supabase.from('users').delete().eq('id', member.user_id)
    }
  }

  // Department toggle now writes to team_members.dept_assignments (jsonb).
  // Single source of truth: the schedule's capacity calc reads from the
  // same jsonb column, so a toggle here changes both the dept chip on
  // /team and the dept's hours/wk on /schedule. department_members rows
  // aren't touched by this toggle — that table stays for time-tracking
  // surfaces that key off users.id.
  function toggleDeptMember(member: TeamMember, deptId: string) {
    const has = (member.dept_assignments || []).includes(deptId)
    const next = has
      ? (member.dept_assignments || []).filter((d) => d !== deptId)
      : [...(member.dept_assignments || []), deptId]
    patchMember(member.id, { dept_assignments: next })
  }

  function getMembersForDept(deptId: string): TeamMember[] {
    return team.filter((m) => (m.dept_assignments || []).includes(deptId))
  }

  // ── Save derived rate as the org's shop rate + snapshot (chunk C) ──
  async function loadSnapshots() {
    if (!org?.id) return
    const { data } = await supabase
      .from('shop_rate_snapshots')
      .select('id, effective_rate, created_at')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(8)
    setSnapshots((data || []) as Array<{ id: string; effective_rate: number; created_at: string }>)
  }

  async function promoteDerivedRate() {
    if (!org?.id || derivedRate <= 0) return
    setSavingRate(true)
    // Round to cents, same as Settings' saveDerivedRate. Writing the raw
    // float stored things like 82.07932692307692, which then never quite
    // matched anything comparing against a displayed two-decimal rate.
    const rate = Math.round(derivedRate * 100) / 100
    try {
      await saveShopRate(org.id, rate)
      // refreshOrg is the whole point: `orgs.shop_rate` is read app-wide via
      // the auth context (rate book, composer, capacity, project rollups).
      // Without this the save landed in the database but every other page —
      // and Settings' own "current rate" — kept showing the OLD number until
      // a hard reload. That's the "shop rate on /team not updating" report.
      await refreshOrg()
      setShopRate(rate)
      setRateSavedAt(Date.now())
      setTimeout(() => setRateSavedAt((prev) => (prev && Date.now() - prev > 2400 ? null : prev)), 2600)
    } catch (e) {
      console.error('promoteDerivedRate', e)
      await showAlert({
        title: 'Could not save the shop rate',
        message: e instanceof Error ? e.message : 'The rate was not saved. Try again.',
      })
      setSavingRate(false)
      return
    }
    // Snapshot the inputs behind this rate (uses the existing 001 columns).
    // Non-fatal: the rate is already saved, so a snapshot failure must not
    // read as "the save failed".
    try {
      await supabase.from('shop_rate_snapshots').insert({
        org_id: org.id,
        effective_rate: rate,
        overhead_monthly: sumOverheadAnnual(overhead) / 12,
        labor_cost_monthly: sumTeamAnnualComp(team) / 12,
        billable_hours_monthly: sumBillableHoursYear(team, billable) / 12,
        utilization_pct: billable.utilization_pct,
      })
      await loadSnapshots()
    } catch (e) {
      console.warn('shop rate snapshot', e)
    } finally {
      setSavingRate(false)
    }
  }

  // ── Accounts (chunk A2) — the one explicit bridge to a login ──
  async function callAdminUsers(body: Record<string, unknown>) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || json.error || 'Request failed')
    return json as Record<string, string>
  }

  // Immediate persist (account actions are important enough not to wait on
  // the 600ms debounce). Writes the user_id bridge onto team_members.
  // Errors PROPAGATE — the login/unlink flows show them; swallowing here used
  // to leave a login whose user_id never made it onto the roster.
  async function persistTeamNow(next: TeamMember[]) {
    setTeam(next)
    if (org?.id) await saveShopRateInputs(org.id, { team: next })
  }

  async function createLogin(member: TeamMember, email: string, password: string) {
    const json = await callAdminUsers({
      action: 'create_login',
      email,
      name: member.name,
      password,
    })
    const next = team.map((m) =>
      m.id === member.id ? { ...m, user_id: json.user_id, email: json.email } : m,
    )
    await persistTeamNow(next)
  }

  async function resetPassword(member: TeamMember, password: string) {
    if (!member.user_id) return
    await callAdminUsers({ action: 'reset_password', user_id: member.user_id, password })
  }

  async function removeLogin(member: TeamMember) {
    if (!member.user_id) return
    const ok = await confirm({
      title: 'Remove login?',
      message: `${member.name || 'This member'} will lose access to the worker app. Their roster entry and time entries stay.`,
      confirmLabel: 'Remove login',
      variant: 'danger',
    })
    if (!ok) return
    await callAdminUsers({ action: 'unlink', user_id: member.user_id })
    const next = team.map((m) => (m.id === member.id ? { ...m, user_id: null } : m))
    await persistTeamNow(next)
  }

  if (!loaded) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">
        Loading...
      </div>
    )
  }

  const rateDriftCents = Math.abs(derivedRate - shopRate)
  const showRateBanner = derivedRate > 0 && rateDriftCents > 0.01

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mb-6">
        Team & Departments
      </h1>

      {/* Shop rate + comp are owner-only (money). Admins/managers see the
          roster, departments, and time-off without any dollar figures. */}
      {canSeeComp && showRateBanner && (
        <div className="mb-5 px-4 py-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-[#92400E]">
            Shop rate may have changed: current{' '}
            <span className="font-mono font-semibold">${shopRate.toFixed(2)}/hr</span> · derived{' '}
            <span className="font-mono font-semibold">${derivedRate.toFixed(2)}/hr</span>.
          </div>
          <button
            onClick={promoteDerivedRate}
            disabled={savingRate}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {savingRate ? 'Saving…' : 'Save as my shop rate'}
          </button>
        </div>
      )}
      {canSeeComp && rateSavedAt && !showRateBanner && (
        <div className="mb-5 px-4 py-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-sm text-[#065F46]">
          Shop rate saved at <span className="font-mono">${shopRate.toFixed(2)}/hr</span>.
        </div>
      )}

      {canSeeComp && (
        <ShopRatePanel
          breakEven={breakEven}
          shopRate={shopRate}
          saving={savingRate}
          onSave={promoteDerivedRate}
          snapshots={snapshots}
          alerts={rateAlerts}
        />
      )}

      {/* Departments + team roster (edits team_members, which carries comp) —
          owner-only. Managers/admins see just time-off below. */}
      {canSeeComp && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Departments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111]">Departments</h2>
            {!addingDept && (
              <button
                onClick={() => setAddingDept(true)}
                className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                + Add Department
              </button>
            )}
          </div>

          {addingDept && (
            <div className="flex gap-2 mb-3">
              <input
                autoFocus
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addDepartment()
                  if (e.key === 'Escape') setAddingDept(false)
                }}
                placeholder="Department name..."
                className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]"
              />
              <button
                onClick={addDepartment}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8]"
              >
                Add
              </button>
              <button
                onClick={() => setAddingDept(false)}
                className="px-3 py-2 text-sm text-[#6B7280]"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="space-y-2">
            {departments.map((dept) => {
              const members = getMembersForDept(dept.id)
              return (
                <div
                  key={dept.id}
                  className="bg-white border border-[#E5E7EB] rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ background: dept.color }} />
                      <span className="text-sm font-medium text-[#111]">{dept.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#9CA3AF]">{members.length} people</span>
                      <button
                        onClick={() => deleteDepartment(dept.id)}
                        className="text-[#D1D5DB] hover:text-[#DC2626] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <span
                        key={m.id}
                        className="text-xs bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full"
                      >
                        {m.name}
                      </span>
                    ))}
                    {members.length === 0 && (
                      <span className="text-xs text-[#D1D5DB] italic">
                        No members assigned
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {departments.length === 0 && !addingDept && (
              <div className="text-center py-8 text-sm text-[#9CA3AF]">
                Add your first department to start scheduling
              </div>
            )}
          </div>
        </div>

        {/* Team Members */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[#111]">Team Members</h2>
              {/* Roster edits autosave; this is the proof. */}
              <SaveStatus save={teamSave} />
            </div>
            {!addingMember && (
              <button
                onClick={() => setAddingMember(true)}
                className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                + Add Member
              </button>
            )}
          </div>

          {addingMember && (
            <div className="flex gap-2 mb-3">
              <input
                autoFocus
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMember()
                  if (e.key === 'Escape') setAddingMember(false)
                }}
                placeholder="Name..."
                className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]"
              />
              <input
                value={newMemberComp}
                onChange={(e) => setNewMemberComp(e.target.value)}
                placeholder="Annual $"
                inputMode="decimal"
                className="w-32 px-3 py-2 text-sm font-mono border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]"
              />
              <button
                onClick={addMember}
                className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8]"
              >
                Add
              </button>
              <button
                onClick={() => setAddingMember(false)}
                className="px-3 py-2 text-sm text-[#6B7280]"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="space-y-2">
            {team.map((member) => (
              <div
                key={member.id}
                className={`bg-white border border-[#E5E7EB] rounded-xl p-4 ${
                  member.active === false ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <input
                    type="text"
                    defaultValue={member.name}
                    // Commit as you type as well as on blur — see NumberCell.
                    onChange={(e) => patchMember(member.id, { name: e.target.value })}
                    onBlur={(e) => patchMember(member.id, { name: e.target.value })}
                    className="text-sm font-medium text-[#111] bg-transparent outline-none focus:bg-[#F9FAFB] rounded px-1 -mx-1"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        patchMember(member.id, { active: member.active === false })
                      }
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        member.active === false
                          ? 'border-[#E5E7EB] text-[#9CA3AF] hover:border-[#D1D5DB]'
                          : 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
                      }`}
                      title="Active members count toward capacity and the shop rate"
                    >
                      {member.active === false ? 'Inactive' : 'Active'}
                    </button>
                    <button
                      onClick={() => deleteMember(member.id)}
                      className="text-[#D1D5DB] hover:text-[#DC2626] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 mb-2">
                  {/* Annual Comp lives in Settings → Team & comp (owner-only),
                      not here — keeps salaries off the team page. */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        patchMember(member.id, { billable: !member.billable })
                      }
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        member.billable
                          ? 'bg-[#2563EB] border-[#2563EB]'
                          : 'border-[#D1D5DB] hover:border-[#9CA3AF]'
                      }`}
                    >
                      {member.billable && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={4}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>
                    <span className="text-xs text-[#9CA3AF]">Billable</span>
                  </div>
                </div>

                {/* Depth fields (chunk A1). Per-person hours/week feeds both
                    the shop-rate denominator and per-dept capacity. */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
                  <FieldInput
                    label="Title"
                    defaultValue={member.title ?? ''}
                    placeholder="e.g. Lead installer"
                    onCommit={(v) => patchMember(member.id, { title: v || null })}
                  />
                  <FieldInput
                    label="Hours / week"
                    defaultValue={member.hours_per_week != null ? String(member.hours_per_week) : ''}
                    placeholder={`${billable.hrs_per_week} (org default)`}
                    inputMode="decimal"
                    mono
                    onCommit={(v) => {
                      const trimmed = v.trim()
                      patchMember(member.id, {
                        hours_per_week: trimmed === '' ? undefined : parseFloat(trimmed) || 0,
                      })
                    }}
                  />
                  <FieldInput
                    label="Email"
                    type="email"
                    defaultValue={member.email ?? ''}
                    placeholder="name@shop.com"
                    onCommit={(v) => patchMember(member.id, { email: v.trim() || null })}
                  />
                  <FieldInput
                    label="Phone"
                    defaultValue={member.phone ?? ''}
                    placeholder="(555) 555-1234"
                    onCommit={(v) => patchMember(member.id, { phone: v.trim() || null })}
                  />
                  <FieldInput
                    label="Start date"
                    type="date"
                    defaultValue={member.start_date ?? ''}
                    onCommit={(v) => patchMember(member.id, { start_date: v || null })}
                  />
                </div>

                {departments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {departments.map((dept) => {
                      const isIn = (member.dept_assignments || []).includes(dept.id)
                      return (
                        <button
                          key={dept.id}
                          onClick={() => toggleDeptMember(member, dept.id)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            isIn
                              ? 'border-transparent text-white'
                              : 'border-[#E5E7EB] text-[#9CA3AF] hover:border-[#D1D5DB]'
                          }`}
                          style={isIn ? { background: dept.color } : {}}
                        >
                          {dept.name}
                        </button>
                      )
                    })}
                  </div>
                )}

                {ptoReady && ptoPolicy && (
                  <PtoBalanceLine
                    balance={computeBalance(member, ptoPolicy, ptoRequests, todayISO)}
                  />
                )}

                <AccountControls
                  member={member}
                  onCreate={(email, password) => createLogin(member, email, password)}
                  onReset={(password) => resetPassword(member, password)}
                  onRemove={() => removeLogin(member)}
                />
              </div>
            ))}
            {team.length === 0 && !addingMember && (
              <div className="text-center py-8 text-sm text-[#9CA3AF]">
                Add team members to assign to departments
              </div>
            )}
          </div>

          {team.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                View in Shop Rate Calculator <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
      )}

      {ptoReady && (
        <PtoSection
          requests={ptoRequests}
          policy={ptoPolicy}
          team={team}
          todayISO={todayISO}
          onApprove={approveRequest}
          onDeny={denyRequest}
          onDelete={removeRequest}
          onSaveBands={updatePolicyBands}
        />
      )}

      {/* Company holidays + manual PTO (moved here from owner-only Settings so
          managers can run time-off). Visible to all /team viewers. */}
      {org?.id && <HolidaysAndPtoSection orgId={org.id} team={team} />}
    </div>
  )
}

// Compact per-member PTO balance line + mini bar.
function PtoBalanceLine({
  balance,
}: {
  balance: { allowed: number; used: number; pending: number; remaining: number }
}) {
  const pct = balance.allowed > 0 ? Math.min(100, (balance.used / balance.allowed) * 100) : 0
  return (
    <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between text-[11px] text-[#6B7280] mb-1">
        <span>Time off</span>
        <span className="font-mono tabular-nums">
          {balance.used}/{balance.allowed} days
          {balance.pending > 0 && (
            <span className="text-[#B45309]"> · {balance.pending} pending</span>
          )}
        </span>
      </div>
      <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${balance.used > balance.allowed ? 'bg-[#DC2626]' : 'bg-[#10B981]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// PTO section — pending queue (approve/deny) + the tenure-band policy editor.
function PtoSection({
  requests,
  policy,
  team,
  todayISO,
  onApprove,
  onDeny,
  onDelete,
  onSaveBands,
}: {
  requests: PtoRequest[]
  policy: PtoPolicy | null
  team: TeamMember[]
  todayISO: string
  onApprove: (r: PtoRequest) => void
  onDeny: (r: PtoRequest) => void
  onDelete: (r: PtoRequest) => void
  onSaveBands: (rules: PtoBand[]) => void
}) {
  const nameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of team) m[t.id] = t.name || 'Team member'
    return m
  }, [team])

  const pending = requests.filter((r) => r.status === 'pending')
  const recent = requests.filter((r) => r.status !== 'pending').slice(0, 8)
  const fmt = (iso: string) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const range = (r: PtoRequest) =>
    r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`

  return (
    <div className="mt-8 pt-6 border-t border-[#E5E7EB]">
      <h2 className="text-sm font-semibold text-[#111] mb-3">Time off</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests */}
        <div>
          <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
            Pending ({pending.length})
          </div>
          {pending.length === 0 ? (
            <div className="text-xs text-[#9CA3AF] py-2">No requests waiting.</div>
          ) : (
            <div className="space-y-2">
              {pending.map((r) => (
                <div
                  key={r.id}
                  className="bg-white border border-[#E5E7EB] rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#111] truncate">
                      {nameById[r.team_member_id] || 'Team member'}
                    </div>
                    <div className="text-[11px] text-[#6B7280]">
                      {range(r)} · {r.reason}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => onApprove(r)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] hover:bg-[#D1FAE5]"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onDeny(r)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] hover:bg-[#FEE2E2]"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {recent.length > 0 && (
            <>
              <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mt-4 mb-2">
                Recent
              </div>
              <div className="space-y-1">
                {recent.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between text-[11px] text-[#6B7280] px-1"
                  >
                    <span className="truncate">
                      {nameById[r.team_member_id] || 'Team member'} · {range(r)}
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={
                          r.status === 'approved' ? 'text-[#065F46]' : 'text-[#991B1B]'
                        }
                      >
                        {r.status}
                      </span>
                      <button
                        onClick={() => onDelete(r)}
                        className="text-[#D1D5DB] hover:text-[#DC2626]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Policy editor */}
        <div>
          <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
            Policy — days per year by tenure
          </div>
          {policy ? (
            <PolicyEditor policy={policy} todayISO={todayISO} onSaveBands={onSaveBands} />
          ) : (
            <div className="text-xs text-[#9CA3AF]">No policy loaded.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Tenure-band editor: each row is { min_years, max_years, days_per_year }.
function PolicyEditor({
  policy,
  onSaveBands,
}: {
  policy: PtoPolicy
  todayISO: string
  onSaveBands: (rules: PtoBand[]) => void
}) {
  const bands = policy.rules || []
  function patch(i: number, key: keyof PtoBand, value: number) {
    const next = bands.map((b, idx) => (idx === i ? { ...b, [key]: value } : b))
    onSaveBands(next)
  }
  function addBand() {
    const last = bands[bands.length - 1]
    const min = last ? last.max_years : 0
    onSaveBands([...bands, { min_years: min, max_years: min + 1, days_per_year: 0 }])
  }
  function removeBand(i: number) {
    onSaveBands(bands.filter((_, idx) => idx !== i))
  }
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-3">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wide text-[#9CA3AF] mb-1 px-1">
        <span>From yr</span>
        <span>To yr</span>
        <span>Days/yr</span>
        <span />
      </div>
      <div className="space-y-1.5">
        {bands.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
            <NumberCell value={b.min_years} onCommit={(v) => patch(i, 'min_years', v)} />
            <NumberCell value={b.max_years} onCommit={(v) => patch(i, 'max_years', v)} />
            <NumberCell value={b.days_per_year} onCommit={(v) => patch(i, 'days_per_year', v)} />
            <button
              onClick={() => removeBand(i)}
              className="text-[#D1D5DB] hover:text-[#DC2626] justify-self-center"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addBand}
        className="mt-2 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
      >
        + Add band
      </button>
    </div>
  )
}

function NumberCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const commit = (raw: string) => onCommit(parseFloat(raw.replace(/[^0-9.]/g, '')) || 0)
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={String(value)}
      // Commit as you type as well as on blur: blur alone means anything typed
      // and then navigated away from (back button, keyboard nav) is lost before
      // it ever reaches state. The save itself stays debounced.
      onChange={(e) => commit(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
    />
  )
}

// Shop-rate cockpit (chunk C): margin ladder + save + snapshot history +
// margin alerts. Break-even is the cost-covering derived rate.
function ShopRatePanel({
  breakEven,
  shopRate,
  saving,
  onSave,
  snapshots,
  alerts,
}: {
  breakEven: number
  shopRate: number
  saving: boolean
  onSave: () => void
  snapshots: Array<{ id: string; effective_rate: number; created_at: string }>
  alerts: Array<{ id: string; name: string; effRate: number; belowBreakEven: boolean }>
}) {
  if (breakEven <= 0) return null
  const margins = [0, 0.15, 0.2, 0.25, 0.3]
  const money = (n: number) => `$${n.toFixed(2)}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Margin ladder */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#111]">Shop rate</h2>
          <span className="text-[11px] text-[#9CA3AF]">
            Current <span className="font-mono text-[#111]">{money(shopRate)}/hr</span>
          </span>
        </div>
        <div className="space-y-1">
          {margins.map((m) => {
            const rate = breakEven / (1 - m)
            const isCurrent = Math.abs(rate - shopRate) < 0.01
            return (
              <div
                key={m}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded-lg ${
                  isCurrent ? 'bg-[#EFF6FF]' : ''
                }`}
              >
                <span className="text-[#6B7280]">
                  {m === 0 ? 'Break-even' : `${Math.round(m * 100)}% margin`}
                </span>
                <span className="font-mono tabular-nums text-[#111]">{money(rate)}/hr</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#F3F4F6]">
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save break-even as my shop rate'}
          </button>
          {snapshots.length > 0 && (
            <span className="text-[11px] text-[#9CA3AF]">
              Last saved {fmtDate(snapshots[0].created_at)}
            </span>
          )}
        </div>
        {snapshots.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {snapshots.slice(0, 6).map((s) => (
              <span key={s.id} className="text-[10px] font-mono text-[#9CA3AF]">
                {fmtDate(s.created_at)}: {money(s.effective_rate)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Margin alerts */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[#111] mb-1">Margin alerts</h2>
        <p className="text-[11px] text-[#9CA3AF] mb-2">
          Active jobs priced under break-even × 1.15 ({money(breakEven * 1.15)}/hr).
        </p>
        {alerts.length === 0 ? (
          <div className="text-xs text-[#16A34A] font-medium py-2">
            All active jobs are priced above target.
          </div>
        ) : (
          <div className="space-y-1">
            {alerts.map((a) => (
              <Link
                key={a.id}
                href={`/projects/${a.id}`}
                className="flex items-center justify-between text-xs px-1 py-1 rounded hover:bg-[#F9FAFB]"
              >
                <span className="truncate text-[#111]">{a.name}</span>
                <span
                  className={`font-mono tabular-nums flex-shrink-0 ml-2 ${
                    a.belowBreakEven ? 'text-[#DC2626] font-semibold' : 'text-[#B45309]'
                  }`}
                >
                  {money(a.effRate)}/hr
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Small labeled input for the member detail grid. Uncontrolled
// (defaultValue) + commit on blur / Enter, matching the name/comp fields.
function FieldInput({
  label,
  defaultValue,
  placeholder,
  type = 'text',
  inputMode,
  mono,
  onCommit,
}: {
  label: string
  defaultValue: string
  placeholder?: string
  type?: string
  inputMode?: 'decimal' | 'email' | 'text'
  mono?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        // Commit as you type as well as on blur — see NumberCell.
        onChange={(e) => onCommit(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className={`px-2 py-1 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] transition-colors ${
          mono ? 'font-mono tabular-nums' : ''
        }`}
      />
    </label>
  )
}

// Random 10-char starter password the owner can copy and hand to the worker.
function generatePassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const rand =
    typeof crypto !== 'undefined' && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint32Array(10)))
      : Array.from({ length: 10 }, (_, i) => i * 2654435761)
  for (const n of rand) out += chars[n % chars.length]
  return out
}

// Per-member login controls (chunk A2). Unlinked → "Create login" form
// (email + starter password). Linked → reset password / remove login.
function AccountControls({
  member,
  onCreate,
  onReset,
  onRemove,
}: {
  member: TeamMember
  onCreate: (email: string, password: string) => Promise<void>
  onReset: (password: string) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const linked = !!member.user_id
  const [mode, setMode] = useState<null | 'create' | 'reset'>(null)
  const [email, setEmail] = useState(member.email ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  function reset() {
    setMode(null)
    setPassword('')
    setErr(null)
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'create') {
        await onCreate(email.trim(), password)
        setOkMsg('Login created')
      } else if (mode === 'reset') {
        await onReset(password)
        setOkMsg('Password updated')
      }
      reset()
      setTimeout(() => setOkMsg(null), 2400)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={`w-1.5 h-1.5 rounded-full ${linked ? 'bg-[#10B981]' : 'bg-[#D1D5DB]'}`}
          />
          <span className="text-[#6B7280]">{linked ? 'Login active' : 'No login'}</span>
          {okMsg && <span className="text-[#065F46]">· {okMsg}</span>}
        </div>
        <div className="flex items-center gap-2">
          {!linked && mode !== 'create' && (
            <button
              onClick={() => {
                setMode('create')
                setPassword(generatePassword())
              }}
              className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
            >
              Create login
            </button>
          )}
          {linked && mode !== 'reset' && (
            <>
              <button
                onClick={() => {
                  setMode('reset')
                  setPassword(generatePassword())
                }}
                className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
              >
                Reset password
              </button>
              <button
                onClick={onRemove}
                className="text-xs text-[#DC2626] hover:text-[#B91C1C] font-medium"
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {mode && (
        <div className="mt-2 flex flex-col gap-2">
          {mode === 'create' && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@shop.com"
              className="px-2 py-1.5 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
            />
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Starter password (8+ chars)"
              className="flex-1 px-2 py-1.5 text-xs font-mono border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
            />
            <button
              onClick={() => setPassword(generatePassword())}
              className="text-[11px] text-[#6B7280] hover:text-[#111] px-1"
              title="Generate a password"
            >
              Generate
            </button>
          </div>
          {err && <div className="text-[11px] text-[#DC2626]">{err}</div>}
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={busy || password.length < 8 || (mode === 'create' && !email.trim())}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {busy ? 'Saving…' : mode === 'create' ? 'Create login' : 'Save password'}
            </button>
            <button onClick={reset} className="text-xs text-[#6B7280] hover:text-[#111]">
              Cancel
            </button>
            <span className="text-[11px] text-[#9CA3AF]">
              Share this password with {member.name || 'the worker'} — they can change it later.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

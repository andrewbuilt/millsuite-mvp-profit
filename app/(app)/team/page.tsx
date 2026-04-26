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

import { useState, useEffect, useMemo } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { Trash2, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import {
  loadShopRateSetup,
  saveShopRateInputs,
  saveShopRate,
  makeTeamMember,
  computeDerivedShopRate,
  type TeamMember,
  type OverheadInputs,
  type BillableHoursInputs,
} from '@/lib/shop-rate-setup'

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
      <Nav />
      <PlanGate requires="team">
        <TeamContent />
      </PlanGate>
    </>
  )
}

function TeamContent() {
  const { org } = useAuth()
  const { confirm } = useConfirm()
  const [departments, setDepartments] = useState<Department[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [overhead, setOverhead] = useState<OverheadInputs>({})
  const [billable, setBillable] = useState<BillableHoursInputs>({
    hrs_per_week: 40,
    weeks_per_year: 48,
    utilization_pct: 70,
  })
  const [shopRate, setShopRate] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [savingRate, setSavingRate] = useState(false)
  const [rateSavedAt, setRateSavedAt] = useState<number | null>(null)

  const [newDeptName, setNewDeptName] = useState('')
  const [addingDept, setAddingDept] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberComp, setNewMemberComp] = useState('')
  const [addingMember, setAddingMember] = useState(false)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const setup = await loadShopRateSetup(org.id)
      const { data: depts } = await supabase
        .from('departments')
        .select('*')
        .eq('org_id', org.id)
        .order('display_order')
      if (cancelled) return
      setTeam(setup.team)
      setOverhead(setup.overhead)
      setBillable(setup.billable)
      setShopRate(setup.shopRate)
      setDepartments(depts || [])
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  // Debounced persist of team_members on any change. Mirrors the
  // /settings page's auto-save shape so the two surfaces stay in sync.
  useEffect(() => {
    if (!org?.id || !loaded) return
    const t = setTimeout(() => {
      saveShopRateInputs(org.id, { team }).catch((e) =>
        console.warn('team save', e),
      )
    }, 600)
    return () => clearTimeout(t)
  }, [team, org?.id, loaded])

  const derivedRate = useMemo(
    () => computeDerivedShopRate(overhead, team, billable),
    [overhead, team, billable],
  )

  // ── Departments CRUD ──

  async function addDepartment() {
    if (!newDeptName.trim() || !org?.id) return
    const color = DEPT_COLORS[departments.length % DEPT_COLORS.length]
    const { data } = await supabase
      .from('departments')
      .insert({
        org_id: org.id,
        name: newDeptName.trim(),
        color,
        display_order: departments.length,
      })
      .select()
      .single()
    if (data) setDepartments((prev) => [...prev, data as Department])
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

  // ── Save derived rate as the org's shop rate ──
  async function promoteDerivedRate() {
    if (!org?.id || derivedRate <= 0) return
    setSavingRate(true)
    try {
      await saveShopRate(org.id, derivedRate)
      setShopRate(derivedRate)
      setRateSavedAt(Date.now())
      setTimeout(() => setRateSavedAt((prev) => (prev && Date.now() - prev > 2400 ? null : prev)), 2600)
    } catch (e) {
      console.error('promoteDerivedRate', e)
    } finally {
      setSavingRate(false)
    }
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

      {showRateBanner && (
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
      {rateSavedAt && !showRateBanner && (
        <div className="mb-5 px-4 py-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-sm text-[#065F46]">
          Shop rate saved at <span className="font-mono">${shopRate.toFixed(2)}/hr</span>.
        </div>
      )}

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
            <h2 className="text-sm font-semibold text-[#111]">Team Members</h2>
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
                className="bg-white border border-[#E5E7EB] rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <input
                    type="text"
                    defaultValue={member.name}
                    onBlur={(e) => patchMember(member.id, { name: e.target.value })}
                    className="text-sm font-medium text-[#111] bg-transparent outline-none focus:bg-[#F9FAFB] rounded px-1 -mx-1"
                  />
                  <button
                    onClick={() => deleteMember(member.id)}
                    className="text-[#D1D5DB] hover:text-[#DC2626] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-[#9CA3AF]">Annual Comp</label>
                    <span className="text-xs text-[#9CA3AF]">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={member.annual_comp?.toString() || ''}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0
                        patchMember(member.id, { annual_comp: val })
                      }}
                      className="w-28 text-right text-sm font-mono tabular-nums px-2 py-1 bg-white border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] transition-colors"
                      placeholder="0"
                    />
                  </div>
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
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { Plus, Trash2, Users } from 'lucide-react'

interface Department {
  id: string
  name: string
  color: string
  display_order: number
  hours_per_day: number
}

interface TeamMember {
  id: string
  name: string
  email: string
  role: string
  employee_type: string | null
  hourly_cost: number | null
}

interface DeptMember {
  id: string
  department_id: string
  user_id: string
  is_primary: boolean
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
  const [departments, setDepartments] = useState<Department[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [deptMembers, setDeptMembers] = useState<DeptMember[]>([])
  const [loading, setLoading] = useState(true)

  // New department form
  const [newDeptName, setNewDeptName] = useState('')
  const [addingDept, setAddingDept] = useState(false)

  // New member form
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)

  useEffect(() => { if (org?.id) loadData() }, [org?.id])

  async function loadData() {
    setLoading(true)
    const [
      { data: depts },
      { data: users },
      { data: dm },
    ] = await Promise.all([
      supabase.from('departments').select('*').eq('org_id', org!.id).order('display_order'),
      supabase.from('users').select('*').eq('org_id', org!.id).order('name'),
      supabase.from('department_members').select('*').eq('org_id', org!.id),
    ])
    setDepartments(depts || [])
    setMembers(users || [])
    setDeptMembers(dm || [])
    setLoading(false)
  }

  async function addDepartment() {
    if (!newDeptName.trim() || !org?.id) return
    const color = DEPT_COLORS[departments.length % DEPT_COLORS.length]
    await supabase.from('departments').insert({
      org_id: org.id,
      name: newDeptName.trim(),
      color,
      display_order: departments.length,
    })
    setNewDeptName('')
    setAddingDept(false)
    loadData()
  }

  async function deleteDepartment(id: string) {
    if (!confirm('Delete this department?')) return
    await supabase.from('departments').delete().eq('id', id)
    loadData()
  }

  async function addMember() {
    if (!newMemberName.trim() || !org?.id) return
    await supabase.from('users').insert({
      org_id: org.id,
      name: newMemberName.trim(),
      email: newMemberEmail.trim() || `${newMemberName.trim().toLowerCase().replace(/\s+/g, '.')}@placeholder.com`,
      role: 'member',
    })
    setNewMemberName('')
    setNewMemberEmail('')
    setAddingMember(false)
    loadData()
  }

  async function toggleDeptMember(deptId: string, userId: string) {
    const existing = deptMembers.find(dm => dm.department_id === deptId && dm.user_id === userId)
    if (existing) {
      await supabase.from('department_members').delete().eq('id', existing.id)
    } else {
      await supabase.from('department_members').insert({
        org_id: org!.id,
        department_id: deptId,
        user_id: userId,
      })
    }
    loadData()
  }

  function getMembersForDept(deptId: string) {
    const memberIds = deptMembers.filter(dm => dm.department_id === deptId).map(dm => dm.user_id)
    return members.filter(m => memberIds.includes(m.id))
  }

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mb-6">Team & Departments</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Departments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111]">Departments</h2>
            {!addingDept && (
              <button onClick={() => setAddingDept(true)} className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium">
                + Add Department
              </button>
            )}
          </div>

          {addingDept && (
            <div className="flex gap-2 mb-3">
              <input autoFocus value={newDeptName} onChange={e => setNewDeptName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addDepartment(); if (e.key === 'Escape') setAddingDept(false) }}
                placeholder="Department name..." className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]" />
              <button onClick={addDepartment} className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8]">Add</button>
              <button onClick={() => setAddingDept(false)} className="px-3 py-2 text-sm text-[#6B7280]">Cancel</button>
            </div>
          )}

          <div className="space-y-2">
            {departments.map(dept => {
              const deptMembersList = getMembersForDept(dept.id)
              return (
                <div key={dept.id} className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm" style={{ background: dept.color }} />
                      <span className="text-sm font-medium text-[#111]">{dept.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#9CA3AF]">{deptMembersList.length} people</span>
                      <button onClick={() => deleteDepartment(dept.id)} className="text-[#D1D5DB] hover:text-[#DC2626] transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Member chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {deptMembersList.map(m => (
                      <span key={m.id} className="text-xs bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full">{m.name}</span>
                    ))}
                    {deptMembersList.length === 0 && <span className="text-xs text-[#D1D5DB] italic">No members assigned</span>}
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
              <button onClick={() => setAddingMember(true)} className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium">
                + Add Member
              </button>
            )}
          </div>

          {addingMember && (
            <div className="flex gap-2 mb-3">
              <input autoFocus value={newMemberName} onChange={e => setNewMemberName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addMember(); if (e.key === 'Escape') setAddingMember(false) }}
                placeholder="Name..." className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]" />
              <input value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)}
                placeholder="Email (optional)" className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB]" />
              <button onClick={addMember} className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8]">Add</button>
              <button onClick={() => setAddingMember(false)} className="px-3 py-2 text-sm text-[#6B7280]">Cancel</button>
            </div>
          )}

          <div className="space-y-2">
            {members.map(member => (
              <div key={member.id} className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-medium text-[#111]">{member.name}</span>
                    <span className="text-xs text-[#9CA3AF] ml-2">{member.role}</span>
                  </div>
                </div>
                {/* Department toggles */}
                {departments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {departments.map(dept => {
                      const isIn = deptMembers.some(dm => dm.department_id === dept.id && dm.user_id === member.id)
                      return (
                        <button key={dept.id} onClick={() => toggleDeptMember(dept.id, member.id)}
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
            {members.length === 0 && !addingMember && (
              <div className="text-center py-8 text-sm text-[#9CA3AF]">
                Add team members to assign to departments
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

// Leads Kanban — Pro-tier sales pipeline.
// Columns: New Lead → 50/50 → 90% → Sold → Lost.
// Drag a card into "Sold" to trigger convertLeadToProject: creates a project,
// copies subprojects + specs + selections, spins up the client portal, and
// redirects to the new project.

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import type { Lead, LeadStatus } from '@/lib/types'
import { Check, Copy, ExternalLink, X } from 'lucide-react'

const COLUMNS: { status: LeadStatus; label: string; hint: string }[] = [
  { status: 'new_lead',       label: 'New Lead',  hint: 'Just came in'          },
  { status: 'fifty_fifty',    label: '50 / 50',   hint: 'Could go either way'   },
  { status: 'ninety_percent', label: '90%',       hint: 'About to close'        },
  { status: 'sold',           label: 'Sold',      hint: 'Becomes a project'     },
  { status: 'lost',           label: 'Lost',      hint: 'Didn\u2019t happen'    },
]

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function LeadsPage() {
  return (
    <PlanGate requires="leads">
      <LeadsInner />
    </PlanGate>
  )
}

function LeadsInner() {
  const router = useRouter()
  const { org } = useAuth()

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState('')
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null)
  const [converting, setConverting] = useState<string | null>(null)
  const [soldModal, setSoldModal] = useState<{
    projectId: string
    projectName: string
    portalSlug: string | null
  } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // ── Load leads ──

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('leads')
        .select(`
          *,
          client:clients(id, name),
          contact:contacts(id, name, email, phone),
          lead_subprojects(id, name, estimated_price, estimated_hours, sequence_order)
        `)
        .eq('org_id', org.id)
        .order('created_at', { ascending: false })
      setLeads((data || []) as unknown as Lead[])
      setLoading(false)
    })()
  }, [org?.id])

  // ── Create lead ──

  async function createLead() {
    if (!newName.trim() || !org?.id) return
    setCreating(true)
    const { data, error } = await supabase
      .from('leads')
      .insert({
        org_id: org.id,
        lead_name: newName.trim(),
        client_name: newClient.trim() || null,
        status: 'new_lead',
      })
      .select()
      .single()

    if (error) {
      console.error('Create lead error:', error)
      alert(error.message)
    } else if (data) {
      setLeads(prev => [data as Lead, ...prev])
    }
    setNewName('')
    setNewClient('')
    setShowForm(false)
    setCreating(false)
  }

  // ── Drag & drop ──

  function handleDragStart(e: React.DragEvent, id: string) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragOver(e: React.DragEvent, status: LeadStatus) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(status)
  }

  function handleDragLeave() {
    setDragOver(null)
  }

  async function handleDrop(e: React.DragEvent, targetStatus: LeadStatus) {
    e.preventDefault()
    setDragOver(null)
    const leadId = e.dataTransfer.getData('text/plain')
    if (!leadId) return

    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.status === targetStatus) {
      setDragId(null)
      return
    }

    setDragId(null)

    // If dropped on "sold" — trigger the convert flow
    if (targetStatus === 'sold') {
      await convertToSold(lead)
      return
    }

    // Otherwise, just flip the status
    setLeads(prev =>
      prev.map(l => (l.id === leadId ? { ...l, status: targetStatus } : l))
    )
    await supabase.from('leads').update({ status: targetStatus }).eq('id', leadId)
  }

  function handleDragEnd() {
    setDragId(null)
    setDragOver(null)
  }

  // ── Sold handoff ──

  async function convertToSold(lead: Lead) {
    setConverting(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}/convert`, { method: 'POST' })
      const json = await res.json()

      if (!res.ok) {
        alert(json.error || 'Failed to convert lead')
        setConverting(null)
        return
      }

      // Optimistic: flip the lead to sold in-place
      setLeads(prev =>
        prev.map(l =>
          l.id === lead.id
            ? { ...l, status: 'sold' as LeadStatus, converted_to_project_id: json.project_id }
            : l
        )
      )

      // Show the portal credentials modal
      setSoldModal({
        projectId: json.project_id,
        projectName: json.project_name,
        portalSlug: json.portal_slug,
      })
    } catch (err: any) {
      alert(err?.message || 'Failed to convert lead')
    } finally {
      setConverting(null)
    }
  }

  // ── Render ──

  function leadsInColumn(status: LeadStatus): Lead[] {
    return leads.filter(l => l.status === status)
  }

  return (
    <>
      <Nav />
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
            <p className="text-sm text-[#6B7280] mt-0.5">
              Drag to update status. Drop on "Sold" to create a project.
            </p>
          </div>
          <button
            onClick={() => {
              setShowForm(true)
              setTimeout(() => nameInputRef.current?.focus(), 0)
            }}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors"
          >
            + New Lead
          </button>
        </div>

        {/* Inline create */}
        {showForm && (
          <div className="bg-white border border-[#2563EB] rounded-xl p-4 mb-5 shadow-sm">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Lead name
                </label>
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createLead()
                    if (e.key === 'Escape') { setShowForm(false); setNewName(''); setNewClient('') }
                  }}
                  placeholder="e.g. Smith Kitchen"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Client (optional)
                </label>
                <input
                  value={newClient}
                  onChange={e => setNewClient(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createLead()
                    if (e.key === 'Escape') { setShowForm(false); setNewName(''); setNewClient('') }
                  }}
                  placeholder="e.g. Jane Smith"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <button
                onClick={createLead}
                disabled={creating || !newName.trim()}
                className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setShowForm(false); setNewName(''); setNewClient('') }}
                className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Kanban columns */}
        {loading ? (
          <div className="text-center py-20 text-sm text-[#9CA3AF]">Loading…</div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {COLUMNS.map(col => {
              const colLeads = leadsInColumn(col.status)
              const isDragTarget = dragOver === col.status
              return (
                <div
                  key={col.status}
                  onDragOver={e => handleDragOver(e, col.status)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, col.status)}
                  className={`bg-[#F9FAFB] border rounded-xl transition-colors ${
                    isDragTarget ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB]'
                  }`}
                >
                  <div className="px-3 pt-3 pb-2 sticky top-0 bg-inherit rounded-t-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#111]">
                        {col.label}
                      </span>
                      <span className="text-[10px] text-[#9CA3AF] tabular-nums">
                        {colLeads.length}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#9CA3AF] mt-0.5">{col.hint}</div>
                  </div>

                  <div className="px-2 pb-3 space-y-1.5 min-h-[400px]">
                    {colLeads.map(lead => {
                      const isDragging = dragId === lead.id
                      const isConverting = converting === lead.id
                      const subs = lead.lead_subprojects || []
                      const subCount = subs.length
                      return (
                        <div
                          key={lead.id}
                          draggable={!isConverting}
                          onDragStart={e => handleDragStart(e, lead.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => {
                            if (lead.converted_to_project_id) {
                              router.push(`/projects/${lead.converted_to_project_id}`)
                            } else {
                              router.push(`/leads/${lead.id}`)
                            }
                          }}
                          className={`bg-white border border-[#E5E7EB] rounded-lg p-2.5 cursor-move hover:border-[#2563EB] hover:shadow-sm transition-all ${
                            isDragging ? 'opacity-40' : ''
                          } ${isConverting ? 'opacity-60 cursor-wait' : ''}`}
                        >
                          <div className="text-sm font-medium text-[#111] leading-tight truncate">
                            {lead.lead_name}
                          </div>
                          {(lead.client?.name || lead.client_name) && (
                            <div className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                              {lead.client?.name || lead.client_name}
                            </div>
                          )}
                          <div className="flex items-center justify-between mt-2 text-[11px]">
                            <span className="font-mono tabular-nums text-[#111]">
                              {fmtMoney(lead.estimated_price)}
                            </span>
                            <span className="text-[#9CA3AF]">
                              {subCount} {subCount === 1 ? 'line' : 'lines'}
                            </span>
                          </div>
                          {isConverting && (
                            <div className="mt-2 text-[10px] text-[#2563EB] font-medium">
                              Converting to project…
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sold handoff modal */}
      {soldModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#D1FAE5] flex items-center justify-center">
                  <Check className="w-4 h-4 text-[#065F46]" />
                </div>
                <h2 className="text-base font-semibold text-[#111]">Sold!</h2>
              </div>
              <button
                onClick={() => setSoldModal(null)}
                className="p-1 text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[#374151] leading-relaxed mb-4">
              <span className="font-medium">{soldModal.projectName}</span> is now a project. Subprojects
              copied, selections seeded, and the client portal is live.
            </p>

            {soldModal.portalSlug && (
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 mb-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                  Client portal
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-[#111] truncate">
                    /portal/{soldModal.portalSlug}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/portal/${soldModal.portalSlug}`)
                    }}
                    className="p-1.5 text-[#6B7280] hover:text-[#111] hover:bg-white rounded transition-colors"
                    title="Copy link"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSoldModal(null)
                  router.push(`/projects/${soldModal.projectId}`)
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
              >
                Open project
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setSoldModal(null)}
                className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

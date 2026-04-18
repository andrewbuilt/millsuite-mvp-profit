'use client'

import { useState } from 'react'
import { MLogo } from '@/components/logo'
import { CheckCircle2, Circle, Clock, FileText, ExternalLink } from 'lucide-react'

interface PortalProject {
  id: string
  name: string
  portalStep: string | null
  status: string
  productionPhase: string | null
  estimatedPrice: number | null
  driveFolderUrl: string | null
  clientName?: string
  contactName?: string
}

interface PortalSelection {
  id: string
  category: string
  label: string
  spec_value: string | null
  status: string
  confirmed_date: string | null
  client_signed_off_at?: string | null
  client_signed_off_by?: string | null
}

interface PortalDrawing {
  id: string
  revision_number: number
  status: string
  drive_file_url: string | null
  created_at: string
  client_signed_off_at?: string | null
}

interface PortalTimelineEvent {
  id: string
  created_at: string
  event_type: string
  event_label: string | null
  event_detail: string | null
  actor_type: 'shop' | 'client' | 'system' | null
}

const CATEGORY_LABELS: Record<string, string> = {
  cabinet_exterior: 'Cabinet Exterior',
  cabinet_interior: 'Cabinet Interior',
  drawer: 'Drawer',
  hardware: 'Hardware',
  custom: 'Custom',
}

export default function PortalView({
  slug,
  project,
  selections,
  drawings,
  timeline,
  portalSteps,
  stepLabels,
}: {
  slug: string
  project: PortalProject
  selections: PortalSelection[]
  drawings: PortalDrawing[]
  timeline: PortalTimelineEvent[]
  portalSteps: string[]
  stepLabels: Record<string, string>
}) {
  const [signoffId, setSignoffId] = useState<string | null>(null)
  const [signoffKind, setSignoffKind] = useState<'selection' | 'drawing'>('selection')
  const [signerName, setSignerName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localSelections, setLocalSelections] = useState(selections)
  const [localDrawings, setLocalDrawings] = useState(drawings)

  // De-duplicate portal steps for the stepper (down_payment appears as 3 triggers)
  const displaySteps = ['down_payment', 'approvals', 'scheduling', 'in_production', 'assembly', 'ready_for_install', 'complete']
  const currentIdx = project.portalStep
    ? displaySteps.findIndex(s => s === project.portalStep)
    : 0

  function openSignoff(kind: 'selection' | 'drawing', id: string) {
    setSignoffKind(kind)
    setSignoffId(id)
    setSignerName('')
    setError(null)
  }

  async function submitSignoff() {
    if (!signoffId || !signerName.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/${slug}/signoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: signoffKind, id: signoffId, signerName: signerName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Sign-off failed')
      }
      const now = new Date().toISOString()
      if (signoffKind === 'selection') {
        setLocalSelections(prev =>
          prev.map(s =>
            s.id === signoffId
              ? { ...s, status: 'confirmed', client_signed_off_at: now, client_signed_off_by: signerName.trim(), confirmed_date: now }
              : s
          )
        )
      } else {
        setLocalDrawings(prev =>
          prev.map(d =>
            d.id === signoffId
              ? { ...d, status: 'approved', client_signed_off_at: now }
              : d
          )
        )
      }
      setSignoffId(null)
    } catch (err: any) {
      setError(err?.message || 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const selectionsByCategory = localSelections.reduce<Record<string, PortalSelection[]>>((acc, s) => {
    const key = s.category
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  const confirmedCount = localSelections.filter(s => s.status === 'confirmed').length
  const totalSelections = localSelections.length

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Header */}
      <header className="bg-white border-b border-[#E5E7EB]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MLogo size={22} color="#111" />
            <span className="text-sm font-semibold tracking-tight text-[#111]">MillSuite</span>
            <span className="text-xs text-[#9CA3AF]">· Client Portal</span>
          </div>
          {project.clientName && (
            <span className="text-xs text-[#6B7280]">{project.clientName}</span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Project Title */}
        <div className="mb-8">
          <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1">
            Project
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#111]">{project.name}</h1>
          {project.estimatedPrice && project.estimatedPrice > 0 && (
            <p className="text-sm text-[#6B7280] mt-1">
              Estimated total: <span className="font-mono tabular-nums">${project.estimatedPrice.toLocaleString()}</span>
            </p>
          )}
        </div>

        {/* Status Stepper */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl p-6 mb-6">
          <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4">
            Project Status
          </div>
          <div className="flex items-center">
            {displaySteps.map((step, idx) => {
              const done = idx < currentIdx
              const current = idx === currentIdx
              return (
                <div key={step} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center ${
                        done
                          ? 'bg-[#059669] text-white'
                          : current
                          ? 'bg-[#2563EB] text-white ring-4 ring-[#DBEAFE]'
                          : 'bg-[#F3F4F6] text-[#9CA3AF]'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : current ? (
                        <Clock className="w-3.5 h-3.5" />
                      ) : (
                        <Circle className="w-3 h-3" />
                      )}
                    </div>
                    <div
                      className={`text-[10px] font-medium mt-1.5 text-center whitespace-nowrap ${
                        done || current ? 'text-[#111]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      {stepLabels[step] || step}
                    </div>
                  </div>
                  {idx < displaySteps.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 -mt-4 ${done ? 'bg-[#059669]' : 'bg-[#E5E7EB]'}`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Selections */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider">
                Selections
              </div>
              <p className="text-sm text-[#6B7280] mt-0.5">
                Review your selections and approve each one when you're ready.
              </p>
            </div>
            {totalSelections > 0 && (
              <span className="text-xs font-medium text-[#6B7280]">
                {confirmedCount} / {totalSelections} approved
              </span>
            )}
          </div>

          {totalSelections === 0 ? (
            <p className="text-sm text-[#9CA3AF] py-6 text-center">
              Your project lead will add selections here for your review.
            </p>
          ) : (
            <div className="space-y-4">
              {Object.entries(selectionsByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                    {CATEGORY_LABELS[cat] || cat}
                  </div>
                  <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                    {items.map((sel, idx) => {
                      const signedOff = !!sel.client_signed_off_at
                      return (
                        <div
                          key={sel.id}
                          className={`flex items-center gap-3 px-4 py-3 ${
                            idx !== items.length - 1 ? 'border-b border-[#F3F4F6]' : ''
                          }`}
                        >
                          {signedOff ? (
                            <CheckCircle2 className="w-5 h-5 text-[#059669] flex-shrink-0" />
                          ) : sel.status === 'pending_review' ? (
                            <Clock className="w-5 h-5 text-[#2563EB] flex-shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-[#D1D5DB] flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111]">{sel.label}</div>
                            {sel.spec_value && (
                              <div className="text-xs text-[#6B7280] mt-0.5">{sel.spec_value}</div>
                            )}
                            {signedOff && sel.client_signed_off_by && (
                              <div className="text-[10px] text-[#059669] font-medium mt-0.5">
                                Approved by {sel.client_signed_off_by} · {new Date(sel.client_signed_off_at!).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                          {!signedOff && (
                            <button
                              onClick={() => openSignoff('selection', sel.id)}
                              className="px-3 py-1.5 text-xs font-medium bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Drawings */}
        {localDrawings.length > 0 && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-6 mb-6">
            <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4">
              Drawings
            </div>
            <div className="space-y-2">
              {localDrawings.map(dr => {
                const approved = !!dr.client_signed_off_at || dr.status === 'approved'
                return (
                  <div
                    key={dr.id}
                    className="flex items-center gap-3 px-4 py-3 border border-[#E5E7EB] rounded-lg"
                  >
                    <FileText className="w-5 h-5 text-[#6B7280] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#111]">
                        Revision {dr.revision_number}
                      </div>
                      <div className="text-xs text-[#6B7280] mt-0.5">
                        {new Date(dr.created_at).toLocaleDateString()}
                        {approved && <span className="text-[#059669] ml-2">· Approved</span>}
                      </div>
                    </div>
                    {dr.drive_file_url && (
                      <a
                        href={dr.drive_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!approved && (
                      <button
                        onClick={() => openSignoff('drawing', dr.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors"
                      >
                        Approve
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-6 mb-6">
            <div className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-4">
              Activity
            </div>
            <div className="space-y-3">
              {timeline.slice(0, 12).map(evt => (
                <div key={evt.id} className="flex gap-3">
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${
                      evt.actor_type === 'client'
                        ? 'bg-[#059669]'
                        : evt.actor_type === 'shop'
                        ? 'bg-[#2563EB]'
                        : 'bg-[#9CA3AF]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#111]">
                      {evt.event_label || evt.event_type}
                    </div>
                    {evt.event_detail && (
                      <div className="text-xs text-[#6B7280] mt-0.5">{evt.event_detail}</div>
                    )}
                    <div className="text-[10px] text-[#9CA3AF] mt-0.5">
                      {new Date(evt.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Sign-off modal */}
      {signoffId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-[#111] mb-2">Confirm approval</h3>
            <p className="text-sm text-[#6B7280] mb-4">
              Type your name to approve this {signoffKind}. Your name will be recorded with the approval.
            </p>
            <input
              autoFocus
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            {error && (
              <div className="text-sm text-[#DC2626] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2 mt-3">
                {error}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setSignoffId(null)}
                disabled={submitting}
                className="flex-1 px-3 py-2 text-sm text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitSignoff}
                disabled={submitting || !signerName.trim()}
                className="flex-1 px-3 py-2 text-sm font-medium bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
              >
                {submitting ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

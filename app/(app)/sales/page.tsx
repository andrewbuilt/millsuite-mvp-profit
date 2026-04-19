'use client'

// ============================================================================
// /sales — parser-first sales dashboard (mockup #1)
// ============================================================================
// Replaces the Apr 18 /leads route. Leads are projects with a stage field
// (see migration 004 + lib/sales.ts). Three sections:
//   1. Drop zone hero — parser stub for V1 (creates a blank project at
//      stage='new_lead'; real PDF parsing is Phase 6+).
//   2. Pipeline tiles — 5 columns driven by projects.stage.
//   3. Recently parsed — the most recent projects, with their stage chip.
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import {
  SALES_STAGES,
  STAGE_LABEL,
  STAGE_SHORT,
  SalesProject,
  SalesStage,
  StageSummary,
  SubprojectSummary,
  createBlankLeadProject,
  loadSalesProjects,
  summarizePipeline,
} from '@/lib/sales'
import { Upload, FileText, ArrowRight, Plus, LayoutGrid } from 'lucide-react'
import Link from 'next/link'

function fmtMoney(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtMoneyFull(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtRelativeDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const STAGE_CHIP_CLASS: Record<SalesStage, string> = {
  new_lead: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
  fifty_fifty: 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]',
  ninety_percent: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
  sold: 'bg-[#ECFDF5] text-[#047857] border-[#6EE7B7]',
  lost: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]',
}

export default function SalesPage() {
  return (
    <PlanGate requires="leads">
      <SalesInner />
    </PlanGate>
  )
}

function SalesInner() {
  const router = useRouter()
  const { org } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projects, setProjects] = useState<SalesProject[]>([])
  const [summaries, setSummaries] = useState<Record<string, SubprojectSummary>>({})
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showBlankForm, setShowBlankForm] = useState(false)
  const [blankName, setBlankName] = useState('')
  const [blankClient, setBlankClient] = useState('')

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const { projects, summaries } = await loadSalesProjects(org.id)
      setProjects(projects)
      setSummaries(summaries)
      setLoading(false)
    })()
  }, [org?.id])

  const pipeline = summarizePipeline(projects)
  const recent = projects.slice(0, 6)

  async function handleBlankSubmit() {
    if (!org?.id || !blankName.trim() || creating) return
    setCreating(true)
    const p = await createBlankLeadProject({
      org_id: org.id,
      name: blankName.trim(),
      client_name: blankClient.trim() || null,
    })
    setCreating(false)
    if (p) router.push(`/projects/${p.id}`)
  }

  // Drop-zone parser stub — V1 just creates a blank project. Hooking this to
  // a real PDF parser is Phase 6+ per BUILD-PLAN.md.
  function handleDroppedFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    // For now we route the user to the blank-project form with a pre-filled
    // note that files were "uploaded" — a toast will eventually be replaced
    // by the real parser preview panel.
    const firstName = files[0].name.replace(/\.[^.]+$/, '').slice(0, 60)
    setBlankName(firstName)
    setShowBlankForm(true)
  }

  return (
    <>
      <Nav />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[#111]">Sales</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            New work starts here. Drop drawings and we'll start the project for you.
          </p>
        </div>

        {/* HERO: parser drop zone */}
        <div
          className={`relative bg-white border border-[#E5E7EB] rounded-2xl p-8 mb-8 overflow-hidden transition-colors ${
            dragOver ? 'border-[#2563EB] bg-[#F5F9FF]' : ''
          }`}
        >
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#F5F9FF] via-transparent to-transparent" />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-[#2563EB] mb-2">
              ◆ Start with drawings
            </div>
            <h2 className="text-xl font-semibold text-[#111] mb-2">
              Drop a PDF. We'll start the project for you.
            </h2>
            <p className="text-sm text-[#6B7280] max-w-xl mb-6">
              Parser pulls the client, address, and LF counts off the drawings, matches to your
              existing clients, and pre-fills the subprojects. (Full parser lands in a
              later release — for now drop a file to start a named project.)
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                handleDroppedFiles(e.dataTransfer.files)
              }}
              className={`border-2 border-dashed rounded-xl px-8 py-10 text-center cursor-pointer transition-all ${
                dragOver
                  ? 'border-[#2563EB] bg-[#EFF6FF]'
                  : 'border-[#D1D5DB] bg-[#F9FAFB] hover:border-[#9CA3AF] hover:bg-white'
              }`}
            >
              <Upload className="w-7 h-7 mx-auto mb-3 text-[#9CA3AF]" />
              <div className="text-sm font-medium text-[#111] mb-1">
                Drop drawings here to start a project
              </div>
              <div className="text-xs text-[#9CA3AF]">PDF, PNG, JPG · up to 10 files · 40 MB each</div>
              <div className="inline-block mt-4 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg text-xs font-medium text-[#6B7280]">
                Browse files
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => handleDroppedFiles(e.target.files)}
              />
            </div>

            <div className="mt-5 text-center text-xs text-[#6B7280]">
              No drawings yet?{' '}
              <button
                onClick={() => setShowBlankForm((v) => !v)}
                className="text-[#2563EB] hover:underline"
              >
                Start a blank project
              </button>
            </div>

            {showBlankForm && (
              <div className="mt-5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-5">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      Project name
                    </label>
                    <input
                      autoFocus
                      value={blankName}
                      onChange={(e) => setBlankName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleBlankSubmit() }}
                      placeholder="Henderson kitchen remodel"
                      className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      Client (optional)
                    </label>
                    <input
                      value={blankClient}
                      onChange={(e) => setBlankClient(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleBlankSubmit() }}
                      placeholder="Sarah Henderson"
                      className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowBlankForm(false); setBlankName(''); setBlankClient('') }}
                    className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBlankSubmit}
                    disabled={!blankName.trim() || creating}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                    {creating ? 'Creating…' : 'Create project & open editor'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PIPELINE */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest">
            Pipeline this month
          </h2>
          <Link
            href="/sales/kanban"
            className="inline-flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111]"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Open Kanban
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {SALES_STAGES.map((stage) => (
            <PipelineTile key={stage} stage={stage} summary={pipeline[stage]} />
          ))}
        </div>

        {/* RECENTLY PARSED */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest">
            Recently parsed
          </h2>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111]"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {loading ? (
          <div className="text-sm text-[#9CA3AF] py-12 text-center">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="bg-white border border-dashed border-[#E5E7EB] rounded-xl py-14 text-center">
            <FileText className="w-6 h-6 text-[#D1D5DB] mx-auto mb-2" />
            <div className="text-sm text-[#6B7280]">No projects yet.</div>
            <div className="text-xs text-[#9CA3AF] mt-1">
              Drop drawings above, or click "Start a blank project."
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recent.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="bg-white border border-[#E5E7EB] rounded-xl p-4 hover:border-[#9CA3AF] transition-colors"
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="text-sm font-semibold text-[#111] truncate">{p.name}</div>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${STAGE_CHIP_CLASS[p.stage]}`}
                  >
                    {STAGE_SHORT[p.stage]}
                  </span>
                </div>
                <div className="text-xs text-[#9CA3AF] mb-3 truncate">
                  {p.delivery_address || p.client_name || 'No client/address yet'} ·{' '}
                  {fmtRelativeDate(p.created_at)}
                </div>
                <div className="flex items-center gap-4 text-xs font-mono tabular-nums border-t border-[#F3F4F6] pt-2.5">
                  <span className="text-[#9CA3AF]">
                    subs <span className="text-[#111] font-semibold">{summaries[p.id]?.sub_count ?? 0}</span>
                  </span>
                  <span className="text-[#9CA3AF]">
                    LF <span className="text-[#111] font-semibold">{summaries[p.id]?.linear_feet ?? 0}</span>
                  </span>
                  <span className="text-[#9CA3AF]">
                    est.{' '}
                    <span className="text-[#111] font-semibold">
                      {fmtMoneyFull(p.bid_total || p.estimated_price)}
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── Pipeline tile ──

function PipelineTile({ stage, summary }: { stage: SalesStage; summary: StageSummary }) {
  const isTerminal = stage === 'sold' || stage === 'lost'
  const accent =
    stage === 'sold'
      ? 'border-[#A7F3D0] bg-[#F0FDF4]'
      : stage === 'lost'
      ? 'border-[#FCA5A5] bg-[#FEF2F2]'
      : 'border-[#E5E7EB] bg-white'
  const countClass =
    stage === 'sold'
      ? 'text-[#047857]'
      : stage === 'lost'
      ? 'text-[#DC2626]'
      : 'text-[#111]'
  return (
    <div className={`rounded-xl border px-4 py-3.5 ${accent}`}>
      <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-widest mb-1.5">
        {STAGE_LABEL[stage]}{isTerminal ? ' MTD' : ''}
      </div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${countClass}`}>
        {summary.count}
      </div>
      <div className="text-[11px] text-[#9CA3AF] font-mono tabular-nums mt-0.5">
        {fmtMoney(summary.value)} {isTerminal ? (stage === 'sold' ? 'booked' : 'missed') : 'pipeline'}
      </div>
      {summary.top && (
        <div className="text-[11px] text-[#6B7280] mt-2 pt-2 border-t border-[#E5E7EB] truncate">
          Top: {summary.top.name}
          {summary.top.amount > 0 && (
            <span className="text-[#9CA3AF] font-mono tabular-nums"> · {fmtMoneyFull(summary.top.amount)}</span>
          )}
        </div>
      )}
    </div>
  )
}

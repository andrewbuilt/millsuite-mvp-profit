'use client'

// ============================================================================
// /sales — parser-first sales dashboard (Phase 3)
// ============================================================================
// Leads are projects with a stage field (migration 004 + lib/sales.ts). Three
// sections:
//   1. Parser hero — drop PDF → lib/pdf-parser extracts candidates → the user
//      tags each chip with a role and hits Create. No drop → blank-form
//      fallback still available.
//   2. Pipeline tiles — 5 columns driven by projects.stage.
//   3. Recently parsed — the most recent projects, with stage chip + inline
//      actions (move stage, quick note, open rollup).
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
  addProjectNote,
  createBlankLeadProject,
  createParsedLeadProject,
  createRoomSubprojects,
  loadSalesProjects,
  summarizePipeline,
  updateProjectStage,
} from '@/lib/sales'
import {
  CandidateRole,
  ParsedCandidate,
  ParsedPdf,
  ROLE_LABEL,
  defaultRoleFor,
  parsePdfFile,
  roleOptionsFor,
} from '@/lib/pdf-parser'
import {
  Upload,
  FileText,
  ArrowRight,
  Plus,
  LayoutGrid,
  Loader2,
  X,
  Mail,
  Phone,
  MapPin,
  DollarSign,
  Calendar,
  User,
  Building,
  StickyNote,
  MoreHorizontal,
  Check,
} from 'lucide-react'
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
    <PlanGate requires="sales">
      <SalesInner />
    </PlanGate>
  )
}

function SalesInner() {
  const router = useRouter()
  const { org, user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projects, setProjects] = useState<SalesProject[]>([])
  const [summaries, setSummaries] = useState<Record<string, SubprojectSummary>>({})
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  // Parser flow state.
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedPdf | null>(null)
  const [roleByCand, setRoleByCand] = useState<Record<string, CandidateRole>>({})
  const [ignored, setIgnored] = useState<Record<string, boolean>>({})
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)

  // Fallback / manual-entry state (shown when parser returns nothing OR the
  // user clicks "Start a blank project").
  const [showBlankForm, setShowBlankForm] = useState(false)
  const [blankName, setBlankName] = useState('')
  const [blankClient, setBlankClient] = useState('')

  // Inline-note overlay state. Null = closed; otherwise the target project.
  const [noteFor, setNoteFor] = useState<SalesProject | null>(null)

  // Surface create-project failures so the user can see what went wrong.
  const [createError, setCreateError] = useState<string | null>(null)

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

  async function refreshProjects() {
    if (!org?.id) return
    const { projects, summaries } = await loadSalesProjects(org.id)
    setProjects(projects)
    setSummaries(summaries)
  }

  // ── Parser flow ──

  async function runParser(file: File) {
    setParsing(true)
    setParsed(null)
    try {
      const result = await parsePdfFile(file, org?.id)
      setParsed(result)
      // Seed per-candidate role dropdowns with sensible defaults.
      const seededRoles: Record<string, CandidateRole> = {}
      for (const c of result.candidates) seededRoles[c.id] = defaultRoleFor(c)
      setRoleByCand(seededRoles)
      setIgnored({})
      setProjectName(result.projectNameGuess || file.name.replace(/\.[^.]+$/, ''))
      // Parse-miss fallback: open the manual form pre-filled with the filename.
      if (!result.parseSucceeded) {
        setShowBlankForm(true)
        setBlankName(result.projectNameGuess || file.name.replace(/\.[^.]+$/, ''))
      } else {
        setShowBlankForm(false)
      }
    } catch (err) {
      console.error('parser failed', err)
      setShowBlankForm(true)
      setBlankName(file.name.replace(/\.[^.]+$/, ''))
    } finally {
      setParsing(false)
    }
  }

  function handleDroppedFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const first = files[0]
    // If the user drops an image or an unknown type we still try — the parser
    // will return a parse-miss result which we surface as the manual form.
    runParser(first)
  }

  function clearParser() {
    setParsed(null)
    setRoleByCand({})
    setIgnored({})
    setProjectName('')
    setShowBlankForm(false)
    setBlankName('')
    setBlankClient('')
  }

  async function handleBlankSubmit() {
    if (!org?.id || !blankName.trim() || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const p = await createBlankLeadProject({
        org_id: org.id,
        name: blankName.trim(),
        client_name: blankClient.trim() || null,
      })
      if (p) router.push(`/projects/${p.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleParsedSubmit() {
    if (!org?.id || !parsed || !projectName.trim() || creating) return
    setCreating(true)

    // Resolve role → value. For fields that can reasonably take multiple
    // candidates (amounts, addresses, etc.) we pick the first non-ignored one
    // the user mapped there.
    const pickFirst = (role: CandidateRole): string | null => {
      for (const c of parsed.candidates) {
        if (ignored[c.id]) continue
        if (roleByCand[c.id] === role) return c.value
      }
      return null
    }

    // Rooms can have many entries — we want all of them as subprojects.
    const pickAll = (role: CandidateRole): string[] => {
      const out: string[] = []
      for (const c of parsed.candidates) {
        if (ignored[c.id]) continue
        if (roleByCand[c.id] === role) out.push(c.value)
      }
      return out
    }

    const rooms = pickAll('room')
    const amountText = pickFirst('amount')
    const estimated_price =
      amountText != null ? Number(amountText.replace(/[$,]/g, '')) || null : null

    const intakeContext = {
      source: 'pdf_parser',
      file_name: parsed.fileName,
      page_count: parsed.pageCount,
      parsed_candidates: parsed.candidates.map((c) => ({
        id: c.id,
        kind: c.kind,
        value: c.value,
        role: ignored[c.id] ? 'other' : roleByCand[c.id] ?? null,
      })),
      role_assignments: {
        client_name: pickFirst('client_name'),
        client_company: pickFirst('client_company'),
        client_email: pickFirst('email'),
        client_phone: pickFirst('phone'),
        designer: pickFirst('designer'),
        gc: pickFirst('gc'),
        venue: pickFirst('venue'),
        address: pickFirst('address'),
        amount: amountText,
        date: pickFirst('date'),
      },
      parsed_at: new Date().toISOString(),
    }

    setCreateError(null)
    try {
      const p = await createParsedLeadProject({
        org_id: org.id,
        name: projectName.trim(),
        file_name: parsed.fileName,
        page_count: parsed.pageCount,
        client_name: pickFirst('client_name'),
        client_company: pickFirst('client_company'),
        client_email: pickFirst('email'),
        client_phone: pickFirst('phone'),
        designer_name: pickFirst('designer'),
        gc_name: pickFirst('gc'),
        delivery_address: pickFirst('address') || pickFirst('venue'),
        estimated_price,
        intake_context: intakeContext,
      })
      if (p) {
        // Seed subprojects from any room chips the user confirmed. Failures
        // here are logged but don't block navigation — the project exists.
        if (rooms.length > 0) {
          await createRoomSubprojects({
            org_id: org.id,
            project_id: p.id,
            rooms,
            consumable_markup_pct: (org as any).consumable_markup_pct ?? null,
            profit_margin_pct: (org as any).profit_margin_pct ?? null,
          })
        }
        router.push(`/projects/${p.id}`)
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  // ── Inline actions ──

  async function handleStageChange(project: SalesProject, stage: SalesStage) {
    // optimistic
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, stage } : p)))
    try {
      await updateProjectStage(project.id, stage)
    } catch {
      refreshProjects()
    }
  }

  async function handleAddNote(body: string) {
    if (!org?.id || !noteFor || !body.trim()) return
    await addProjectNote({
      org_id: org.id,
      project_id: noteFor.id,
      body: body.trim(),
      created_by: user?.id,
    })
    setNoteFor(null)
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
              Parser pulls the client, address, and dollar amounts off the drawings.
              Confirm the chips, assign roles, and we create the project.
            </p>

            {createError && (
              <div className="mb-4 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-sm text-[#991B1B] flex items-start gap-2">
                <span className="font-medium">Couldn&apos;t create project:</span>
                <span className="flex-1">{createError}</span>
                <button
                  onClick={() => setCreateError(null)}
                  className="text-[#991B1B] hover:text-[#7F1D1D]"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {!parsed && !parsing && !showBlankForm && (
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
                <div className="text-xs text-[#9CA3AF]">PDF · one file · 40 MB</div>
                <div className="inline-block mt-4 px-3 py-1.5 bg-white border border-[#E5E7EB] rounded-lg text-xs font-medium text-[#6B7280]">
                  Browse files
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => handleDroppedFiles(e.target.files)}
                />
              </div>
            )}

            {parsing && (
              <div className="border-2 border-dashed border-[#BFDBFE] bg-[#EFF6FF] rounded-xl px-8 py-10 text-center">
                <Loader2 className="w-6 h-6 mx-auto mb-3 text-[#2563EB] animate-spin" />
                <div className="text-sm font-medium text-[#111] mb-1">Reading the PDF…</div>
                <div className="text-xs text-[#6B7280]">
                  Extracting text and candidate entities.
                </div>
              </div>
            )}

            {parsed && parsed.parseSucceeded && !parsing && (
              <ParsePreview
                parsed={parsed}
                projectName={projectName}
                onProjectName={setProjectName}
                roleByCand={roleByCand}
                onRoleChange={(id, role) => setRoleByCand((r) => ({ ...r, [id]: role }))}
                ignored={ignored}
                onToggleIgnore={(id) => setIgnored((i) => ({ ...i, [id]: !i[id] }))}
                onCancel={clearParser}
                onSubmit={handleParsedSubmit}
                creating={creating}
              />
            )}

            {!parsed && !parsing && (
              <div className="mt-5 text-center text-xs text-[#6B7280]">
                No drawings yet?{' '}
                <button
                  onClick={() => setShowBlankForm((v) => !v)}
                  className="text-[#2563EB] hover:underline"
                >
                  Start a blank project
                </button>
              </div>
            )}

            {showBlankForm && (
              <div className="mt-5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-5">
                {parsed && !parsed.parseSucceeded && (
                  <div className="mb-3 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E]">
                    Couldn't read candidate entities from {parsed.fileName} — likely a
                    scanned drawing set. Fill in the basics and we'll open the project.
                  </div>
                )}
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
                    onClick={clearParser}
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
              <RecentCard
                key={p.id}
                project={p}
                summary={summaries[p.id]}
                onStageChange={(s) => handleStageChange(p, s)}
                onAddNote={() => setNoteFor(p)}
                onOpen={() => router.push(`/projects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {noteFor && (
        <QuickNoteModal
          project={noteFor}
          onClose={() => setNoteFor(null)}
          onSubmit={handleAddNote}
        />
      )}
    </>
  )
}

// ── Parse preview panel ──

function ParsePreview({
  parsed,
  projectName,
  onProjectName,
  roleByCand,
  onRoleChange,
  ignored,
  onToggleIgnore,
  onCancel,
  onSubmit,
  creating,
}: {
  parsed: ParsedPdf
  projectName: string
  onProjectName: (v: string) => void
  roleByCand: Record<string, CandidateRole>
  onRoleChange: (id: string, role: CandidateRole) => void
  ignored: Record<string, boolean>
  onToggleIgnore: (id: string) => void
  onCancel: () => void
  onSubmit: () => void
  creating: boolean
}) {
  const active = parsed.candidates.filter((c) => !ignored[c.id])
  const byRole = (role: CandidateRole) =>
    active.find((c) => roleByCand[c.id] === role) || null
  const allByRole = (role: CandidateRole) =>
    active.filter((c) => roleByCand[c.id] === role)
  const client = byRole('client_name') || byRole('client_company')
  const email = byRole('email')
  const phone = byRole('phone')
  const address = byRole('address') || byRole('venue')
  const amount = byRole('amount')
  const rooms = allByRole('room')

  return (
    <div className="border border-[#E5E7EB] rounded-xl bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" />
          <div className="text-sm font-semibold text-[#111] truncate">
            {parsed.fileName}
          </div>
          <div className="text-[11px] text-[#9CA3AF] flex-shrink-0">
            · {parsed.pageCount} {parsed.pageCount === 1 ? 'page' : 'pages'} ·
            {' '}{parsed.candidates.length} candidates
          </div>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
          aria-label="Discard parse"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {parsed.apiError && (
        <div className="mb-4 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E] flex items-start gap-2">
          <span className="font-semibold">AI parser failed —</span>
          <span className="flex-1">
            showing fallback chips from raw text scan. Reason: {parsed.apiError}
          </span>
        </div>
      )}
      {!parsed.apiError && parsed.source === 'api' && (
        <div className="mb-4 px-3 py-2 bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg text-[11px] text-[#047857] flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wider">AI parsed</span>
          <span className="text-[#065F46]">
            {parsed.items?.length
              ? `${parsed.items.length} scope ${parsed.items.length === 1 ? 'item' : 'items'} across ${parsed.candidates.filter((c) => c.kind === 'room').length} room${parsed.candidates.filter((c) => c.kind === 'room').length === 1 ? '' : 's'}`
              : 'intake fields extracted'}
          </span>
        </div>
      )}

      <div className="mb-4">
        <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
          Project name
        </label>
        <input
          value={projectName}
          onChange={(e) => onProjectName(e.target.value)}
          className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
        />
      </div>

      <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
        Parsed candidates — assign a role or ignore
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
        {parsed.candidates.map((c) => (
          <CandidateChip
            key={c.id}
            candidate={c}
            role={roleByCand[c.id]}
            ignored={!!ignored[c.id]}
            onRoleChange={(r) => onRoleChange(c.id, r)}
            onToggleIgnore={() => onToggleIgnore(c.id)}
          />
        ))}
      </div>

      {/* Summary strip — "this is what will land on the project" */}
      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 text-xs text-[#6B7280] mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
          Will save as
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Line label="Client" value={client?.value} />
          <Line label="Email" value={email?.value} />
          <Line label="Phone" value={phone?.value} />
          <Line label="Address" value={address?.value} />
          <Line label="Amount" value={amount?.value} />
        </div>
        {rooms.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#E5E7EB]">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] flex-shrink-0">
                Subprojects
              </span>
              <span className="text-xs text-[#111] font-mono">
                {rooms.map((r) => r.value).join(' · ')}
              </span>
            </div>
            <div className="text-[10px] text-[#9CA3AF] mt-1">
              One subproject will be created per room.
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
        >
          Discard
        </button>
        <button
          onClick={onSubmit}
          disabled={!projectName.trim() || creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          {creating ? 'Creating…' : 'Create project & open editor'}
        </button>
      </div>
    </div>
  )
}

function Line({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF] flex-shrink-0">
        {label}
      </span>
      <span className="text-xs text-[#111] truncate font-mono">{value || '—'}</span>
    </div>
  )
}

function CandidateIcon({ kind }: { kind: ParsedCandidate['kind'] }) {
  const cls = 'w-3.5 h-3.5 text-[#6B7280]'
  switch (kind) {
    case 'email': return <Mail className={cls} />
    case 'phone': return <Phone className={cls} />
    case 'address': return <MapPin className={cls} />
    case 'amount': return <DollarSign className={cls} />
    case 'date': return <Calendar className={cls} />
    case 'company': return <Building className={cls} />
    case 'name': return <User className={cls} />
    default: return <FileText className={cls} />
  }
}

function CandidateChip({
  candidate,
  role,
  ignored,
  onRoleChange,
  onToggleIgnore,
}: {
  candidate: ParsedCandidate
  role: CandidateRole | undefined
  ignored: boolean
  onRoleChange: (r: CandidateRole) => void
  onToggleIgnore: () => void
}) {
  const options = roleOptionsFor(candidate)
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-lg text-xs ${
        ignored
          ? 'bg-[#F3F4F6] border-[#E5E7EB] opacity-60'
          : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <CandidateIcon kind={candidate.kind} />
      <div className="font-mono text-[#111] truncate min-w-0 flex-1" title={candidate.value}>
        {candidate.value}
      </div>
      <select
        disabled={ignored}
        value={role ?? 'other'}
        onChange={(e) => onRoleChange(e.target.value as CandidateRole)}
        className="text-[11px] bg-[#F9FAFB] border border-[#E5E7EB] rounded px-1.5 py-0.5 text-[#6B7280] disabled:opacity-60 outline-none focus:border-[#2563EB]"
      >
        {options.map((r) => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </select>
      <button
        onClick={onToggleIgnore}
        className="p-0.5 text-[#9CA3AF] hover:text-[#111]"
        title={ignored ? 'Include' : 'Ignore'}
      >
        {ignored ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      </button>
    </div>
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

// ── Recently-parsed card with inline actions ──

function RecentCard({
  project,
  summary,
  onStageChange,
  onAddNote,
  onOpen,
}: {
  project: SalesProject
  summary: SubprojectSummary | undefined
  onStageChange: (s: SalesStage) => void
  onAddNote: () => void
  onOpen: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative bg-white border border-[#E5E7EB] rounded-xl p-4 hover:border-[#9CA3AF] transition-colors">
      <div className="flex items-start justify-between mb-1.5 gap-2">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm font-semibold text-[#111] truncate hover:underline"
        >
          {project.name}
        </Link>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${STAGE_CHIP_CLASS[project.stage]}`}
          >
            {STAGE_SHORT[project.stage]}
          </span>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
            aria-label="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="text-xs text-[#9CA3AF] mb-3 truncate">
        {project.delivery_address || project.client_name || 'No client/address yet'} ·{' '}
        {fmtRelativeDate(project.created_at)}
      </div>
      <div className="flex items-center gap-4 text-xs font-mono tabular-nums border-t border-[#F3F4F6] pt-2.5">
        <span className="text-[#9CA3AF]">
          subs <span className="text-[#111] font-semibold">{summary?.sub_count ?? 0}</span>
        </span>
        <span className="text-[#9CA3AF]">
          LF <span className="text-[#111] font-semibold">{summary?.linear_feet ?? 0}</span>
        </span>
        <span className="text-[#9CA3AF]">
          est.{' '}
          <span className="text-[#111] font-semibold">
            {fmtMoneyFull(project.bid_total || project.estimated_price)}
          </span>
        </span>
      </div>

      {menuOpen && (
        <>
          {/* click-off */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-3 top-10 z-20 w-52 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Move to
            </div>
            {SALES_STAGES.filter((s) => s !== project.stage).map((s) => (
              <button
                key={s}
                onClick={() => { setMenuOpen(false); onStageChange(s) }}
                className="w-full text-left px-3 py-1.5 text-xs text-[#111] hover:bg-[#F3F4F6]"
              >
                {STAGE_LABEL[s]}
              </button>
            ))}
            <div className="border-t border-[#F3F4F6] my-1" />
            <button
              onClick={() => { setMenuOpen(false); onAddNote() }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#111] hover:bg-[#F3F4F6] inline-flex items-center gap-2"
            >
              <StickyNote className="w-3.5 h-3.5 text-[#9CA3AF]" />
              Add a note
            </button>
            <button
              onClick={() => { setMenuOpen(false); onOpen() }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#111] hover:bg-[#F3F4F6] inline-flex items-center gap-2"
            >
              <ArrowRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
              Open project
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function QuickNoteModal({
  project,
  onClose,
  onSubmit,
}: {
  project: SalesProject
  onClose: () => void
  onSubmit: (body: string) => void
}) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!body.trim() || saving) return
    setSaving(true)
    await onSubmit(body)
    setSaving(false)
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Quick note
        </div>
        <div className="text-base font-semibold text-[#111] truncate">{project.name}</div>
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
          rows={4}
          placeholder="Left a VM. Sent revised quote on materials."
          className="mt-3 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] resize-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!body.trim() || saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save note (⌘↩)'}
          </button>
        </div>
      </div>
    </div>
  )
}

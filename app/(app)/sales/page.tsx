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
  deleteProject,
  loadSalesProjects,
  seedEstimateLinesFromParsed,
  summarizePipeline,
  updateProjectStage,
} from '@/lib/sales'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createNewClient,
  loadClients,
  setProjectClient,
  type Client,
} from '@/lib/clients'
import {
  CandidateRole,
  ParsedCandidate,
  ParsedPdf,
  ParsedScopeItem,
  ROLE_LABEL,
  defaultRoleFor,
  mergeParsedPdfs,
  parsePdfFile,
  roleOptionsFor,
} from '@/lib/pdf-parser'
import { loadParseUsage, type ParseUsage } from '@/lib/parse-cap'
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
  Trash2,
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
  const { confirm } = useConfirm()
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
  // Client picker state — typeahead against existing clients. blankClient
  // carries the displayed text; blankClientId is the linked id when the
  // user picked an existing row (or just-created one). Free-text without
  // an id is no longer a valid create input — the picker is the only
  // entry path.
  const [blankClient, setBlankClient] = useState('')
  const [blankClientId, setBlankClientId] = useState<string | null>(null)

  // Inline-note overlay state. Null = closed; otherwise the target project.
  const [noteFor, setNoteFor] = useState<SalesProject | null>(null)

  // Surface create-project failures so the user can see what went wrong.
  const [createError, setCreateError] = useState<string | null>(null)

  // Today's parse usage — drives the drop-zone counter and the 429
  // banner. Refreshed after each parse + after page navigations so the
  // counter stays accurate without polling.
  const [usage, setUsage] = useState<ParseUsage | null>(null)

  async function refreshUsage() {
    if (!org?.id) return
    try {
      setUsage(await loadParseUsage(org.id))
    } catch (e) {
      console.warn('loadParseUsage', e)
    }
  }

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const [{ projects, summaries }, u] = await Promise.all([
        loadSalesProjects(org.id),
        loadParseUsage(org.id),
      ])
      setProjects(projects)
      setSummaries(summaries)
      setUsage(u)
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

  // Multi-file progress: count parsed files vs total queued so the
  // drop-zone can show "1 of 3 parsed" while the rest are in flight.
  // Each file gets its own cap check on the server side; if the cap
  // hits mid-batch, the remaining files come back with rate-limited
  // errors and we surface them in the partial-success banner.
  const [parseProgress, setParseProgress] = useState<{
    total: number
    done: number
    failures: { file: string; error: string }[]
  } | null>(null)

  async function runParser(files: File[]) {
    if (files.length === 0) return
    setParsing(true)
    setParsed(null)
    setParseProgress({ total: files.length, done: 0, failures: [] })
    const failures: { file: string; error: string }[] = []
    try {
      const results = await Promise.all(
        files.map(async (f) => {
          try {
            const r = await parsePdfFile(f, org?.id, { keepPdf: true })
            setParseProgress((prev) =>
              prev ? { ...prev, done: prev.done + 1 } : prev,
            )
            return r
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'parse failed'
            failures.push({ file: f.name, error: msg })
            setParseProgress((prev) =>
              prev
                ? { ...prev, done: prev.done + 1, failures: [...prev.failures, { file: f.name, error: msg }] }
                : prev,
            )
            return null
          }
        }),
      )
      // Surface per-file API failures from the envelope (parseSucceeded=false
      // with apiError) alongside thrown errors. A scanned PDF whose vision
      // path failed lands here, as does a 429 cap-hit mid-batch.
      const successful: ParsedPdf[] = []
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (!r) continue
        if (!r.parseSucceeded && r.apiError) {
          failures.push({ file: files[i].name, error: r.apiError })
          continue
        }
        successful.push(r)
      }

      if (successful.length === 0) {
        // No file parsed successfully — drop into manual form with the
        // first file's name so the operator sees something useful.
        const seedName = files[0].name.replace(/\.[^.]+$/, '')
        setShowBlankForm(true)
        setBlankName(seedName)
        // Hold the empty result so the partial-success banner can still
        // render the failure list above the manual form.
        setParsed({
          fileName: files.map((f) => f.name).join(' + '),
          pageCount: 0,
          text: '',
          candidates: [],
          projectNameGuess: null,
          parseSucceeded: false,
          source: 'none',
          apiError:
            failures.length > 0
              ? `${failures.length} file${failures.length === 1 ? '' : 's'} failed`
              : 'No files parsed successfully',
          // Stash failures for the banner to render.
          ...({ multiFileFailures: failures } as any),
        })
        return
      }

      const merged = mergeParsedPdfs(successful)
      // Stash the per-file failure list on the merged envelope so the
      // ParsePreview banner can surface "2 of 3 files parsed
      // successfully. drawings_v2.pdf failed: ..."
      ;(merged as any).multiFileFailures = failures
      setParsed(merged)
      const seededRoles: Record<string, CandidateRole> = {}
      for (const c of merged.candidates) seededRoles[c.id] = defaultRoleFor(c)
      setRoleByCand(seededRoles)
      setIgnored({})
      setProjectName(
        merged.projectNameGuess || files[0].name.replace(/\.[^.]+$/, ''),
      )
      setShowBlankForm(false)
    } catch (err) {
      console.error('parser failed', err)
      setShowBlankForm(true)
      setBlankName(files[0].name.replace(/\.[^.]+$/, ''))
    } finally {
      setParsing(false)
      setParseProgress(null)
      // Always refresh — both successful and rate-limited calls bump
      // the counter, so the drop-zone display stays accurate.
      refreshUsage()
    }
  }

  function handleDroppedFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    runParser(Array.from(files))
  }

  function clearParser() {
    setParsed(null)
    setRoleByCand({})
    setIgnored({})
    setProjectName('')
    setShowBlankForm(false)
    setBlankName('')
    setBlankClient('')
    setBlankClientId(null)
  }

  async function handleBlankSubmit() {
    if (!org?.id || !blankName.trim() || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const p = await createBlankLeadProject({
        org_id: org.id,
        name: blankName.trim(),
        // Typeahead path: persist client_id (FK) and the cached
        // client_name. Free text without a picked id was the previous
        // dead-end behavior — we now require either a pick or no
        // client at all.
        client_id: blankClientId,
        client_name: blankClientId ? blankClient.trim() || null : null,
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
      // Storage paths in the parse-drawings bucket. The Re-parse button
      // on the project page reads these back to fetch the original
      // PDF(s) and re-run the parser. Empty when the parse went via
      // the inline base64 path (small files).
      source_pdf_paths: parsed.sourcePdfPaths || [],
      // Snapshot the parsed items + scope summary so the diff helper
      // can compare against this baseline on re-parse.
      parsed_items: parsed.items || [],
      scope_summary: parsed.scopeSummary || null,
      reparse_history: [] as any[],
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
        // Materialize the parsed client into the clients table and link
        // it to the project. Pre-fix the project saved client_name as
        // text but the clients row was never created and project.client_id
        // stayed null, leaving the project orphaned from the CRM.
        // Reuses an existing client when an exact name match already
        // exists in the org so we don't accumulate duplicates.
        const parsedClientName =
          pickFirst('client_name') || pickFirst('client_company')
        if (parsedClientName && parsedClientName.trim()) {
          try {
            const trimmed = parsedClientName.trim()
            const existing = await loadClients(org.id)
            const match = existing.find(
              (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
            )
            const client =
              match ??
              (await createNewClient({
                org_id: org.id,
                name: trimmed,
                phone: pickFirst('phone') ?? undefined,
                email: pickFirst('email') ?? undefined,
                address:
                  pickFirst('address') || pickFirst('venue') || undefined,
              }))
            await setProjectClient(p.id, { id: client.id, name: client.name })
          } catch (clientErr) {
            // Non-fatal — project still navigates; operator can pick
            // a client manually from the project page picker.
            console.warn('parsed client materialization failed', clientErr)
          }
        }

        // Seed subprojects from any room chips the user confirmed, then
        // seed estimate_lines per parsed item onto the matching subs so the
        // editor opens with real scope + finish specs instead of empty cards.
        // Failures are logged but don't block navigation — the project exists.
        let subsByRoom: Array<{ id: string; name: string }> = []
        if (rooms.length > 0) {
          subsByRoom = await createRoomSubprojects({
            org_id: org.id,
            project_id: p.id,
            rooms,
            consumable_markup_pct: (org as any).consumable_markup_pct ?? null,
          })
        }
        const parsedItems = parsed?.items || []
        if (subsByRoom.length > 0 && parsedItems.length > 0) {
          await seedEstimateLinesFromParsed({ subsByRoom, items: parsedItems })
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

            {usage && usage.used >= usage.cap && !parsed && !parsing && !showBlankForm && (
              <div className="mb-4 px-4 py-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg flex items-center justify-between gap-3">
                <div className="text-[12.5px] text-[#991B1B]">
                  <span className="font-semibold">
                    You&apos;ve hit today&apos;s parse limit ({usage.cap}).
                  </span>{' '}
                  <span className="text-[#7F1D1D]">
                    Resets at midnight your time.
                  </span>
                </div>
                <Link
                  href="/pricing"
                  className="flex-shrink-0 px-3 py-1.5 text-[12px] font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-md"
                >
                  Upgrade plan
                </Link>
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
                <div className="text-xs text-[#9CA3AF]">PDF · multiple files OK · 40 MB each</div>
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
            )}

            {usage && !parsed && !parsing && !showBlankForm && (
              <div className="mt-2 text-center text-[11px] text-[#9CA3AF]">
                {usage.used} / {usage.cap} parses used today
              </div>
            )}

            {parsing && (
              <div className="border-2 border-dashed border-[#BFDBFE] bg-[#EFF6FF] rounded-xl px-8 py-10 text-center">
                <Loader2 className="w-6 h-6 mx-auto mb-3 text-[#2563EB] animate-spin" />
                <div className="text-sm font-medium text-[#111] mb-1">
                  {parseProgress && parseProgress.total > 1
                    ? `Parsing ${parseProgress.total} files…`
                    : 'Reading the PDF…'}
                </div>
                <div className="text-xs text-[#6B7280]">
                  {parseProgress && parseProgress.total > 1
                    ? `${parseProgress.done} of ${parseProgress.total} parsed`
                    : 'Extracting text and candidate entities.'}
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
                    <NewProjectClientPicker
                      orgId={org?.id || null}
                      name={blankClient}
                      clientId={blankClientId}
                      onPick={(c) => {
                        if (c) {
                          setBlankClient(c.name)
                          setBlankClientId(c.id)
                        } else {
                          setBlankClient('')
                          setBlankClientId(null)
                        }
                      }}
                      onSubmitForm={handleBlankSubmit}
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
                onDelete={async () => {
                  const ok = await confirm({
                    title: 'Delete project?',
                    message: `Delete "${p.name}"? This removes all subprojects, estimate lines, time entries, invoices, and milestones for the project. This can't be undone.`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                  })
                  if (!ok) return
                  try {
                    await deleteProject(p.id)
                    setProjects((prev) => prev.filter((x) => x.id !== p.id))
                  } catch (err: any) {
                    alert(`Failed to delete: ${err?.message || 'unknown error'}`)
                  }
                }}
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

      {parsed.apiError && parsed.isScanned ? (
        <div className="mb-4 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E] flex items-start gap-2">
          <span className="font-semibold">Drawing parsing failed —</span>
          <span className="flex-1">
            try uploading the PDF again or fill in manually below. Reason:{' '}
            {parsed.apiError}
          </span>
        </div>
      ) : parsed.apiError ? (
        <div className="mb-4 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E] flex items-start gap-2">
          <span className="font-semibold">AI parser failed —</span>
          <span className="flex-1">
            showing fallback chips from raw text scan. Reason: {parsed.apiError}
          </span>
        </div>
      ) : null}

      {/* Multi-file partial-success banner. Surfaces the failure list
          when at least one file in the batch failed. The merge still
          went forward with the rest, so the operator can review what
          parsed and decide whether to retry the failures. */}
      {(() => {
        const failures = (parsed as any).multiFileFailures as
          | { file: string; error: string }[]
          | undefined
        if (!failures || failures.length === 0) return null
        return (
          <div className="mb-4 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-xs text-[#92400E]">
            <div className="font-semibold mb-1">
              {failures.length} file{failures.length === 1 ? '' : 's'} failed
              to parse
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11.5px] text-[#A16207]">
              {failures.map((f, i) => (
                <li key={i}>
                  <span className="font-mono">{f.file}</span> — {f.error}
                </li>
              ))}
            </ul>
          </div>
        )
      })()}
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

      {/* Parsed scope items — read-only preview with confidence
          indicators. Items flow into estimate lines on submit; this
          surface lets the operator scan for low-confidence calls
          before the project is created. */}
      <ScopeItemsPreview items={parsed.items} />

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

// ── Scope items preview ──────────────────────────────────────────────────
// Read-only list of the parsed scope items grouped by room. Confidence
// indicator per row: low → ⚠️ warning chip; medium → subtle gray dot;
// high → no marker. A summary strip at the bottom counts low-confidence
// items and offers a jump-to-first affordance.

function ScopeItemsPreview({
  items,
}: {
  items: ParsedScopeItem[] | undefined
}) {
  if (!items || items.length === 0) return null

  const lowCount = items.filter((it) => it.confidence === 'low').length
  // Render order: preserve API order (rooms appear naturally grouped
  // since the prompt asks for items grouped by room).

  function jumpToFirstFlag() {
    const first = document.querySelector(
      '[data-scope-confidence="low"]',
    ) as HTMLElement | null
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' })
      first.focus()
    }
  }

  return (
    <div className="mb-4">
      <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
        Parsed scope items ({items.length})
      </div>
      <div className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
        {items.map((it, i) => {
          const conf = it.confidence ?? 'medium'
          const isLow = conf === 'low'
          const isMed = conf === 'medium'
          return (
            <div
              key={i}
              tabIndex={isLow ? 0 : -1}
              data-scope-confidence={conf}
              className={`grid grid-cols-[110px_1fr_auto] gap-3 items-center px-3 py-2 text-[12.5px] border-b border-[#F3F4F6] last:border-b-0 ${
                isLow ? 'bg-[#FFFBEB]' : ''
              }`}
            >
              <div className="text-[#6B7280] truncate">{it.room || '—'}</div>
              <div className="text-[#111] truncate min-w-0">
                <div className="truncate">
                  {it.name}
                  {it.linear_feet != null && (
                    <span className="ml-2 text-[#9CA3AF] font-mono text-[11.5px]">
                      {it.linear_feet} LF
                    </span>
                  )}
                </div>
                {it.source_files && it.source_files.length > 1 && (
                  <div className="text-[10.5px] text-[#9CA3AF] truncate">
                    from {it.source_files.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isLow ? (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#FEF3C7] text-[#92400E]"
                    title="Low-confidence parse. Review and confirm before adding."
                  >
                    ⚠️ Low
                  </span>
                ) : isMed ? (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-[#D1D5DB]"
                    title="Medium-confidence parse"
                    aria-label="medium confidence"
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {lowCount > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg">
          <div className="text-[12px] text-[#92400E]">
            <span className="font-semibold">
              {lowCount} item{lowCount === 1 ? '' : 's'} need review
            </span>{' '}
            <span className="text-[#A16207]">
              — flagged below the &ldquo;suggest&rdquo; threshold; double-check before
              relying on the parse.
            </span>
          </div>
          <button
            type="button"
            onClick={jumpToFirstFlag}
            className="flex-shrink-0 px-2.5 py-1 text-[11.5px] font-medium text-[#92400E] border border-[#F59E0B] rounded-md hover:bg-[#FEF3C7]"
          >
            Review all flagged
          </button>
        </div>
      )}
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
  onDelete,
}: {
  project: SalesProject
  summary: SubprojectSummary | undefined
  onStageChange: (s: SalesStage) => void
  onAddNote: () => void
  onOpen: () => void
  onDelete: () => void
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
            <div className="border-t border-[#F3F4F6] my-1" />
            <button
              onClick={() => { setMenuOpen(false); onDelete() }}
              className="w-full text-left px-3 py-1.5 text-xs text-[#DC2626] hover:bg-[#FEF2F2] inline-flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete project
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

// ── New-project client picker ──
// Replaces the prior free-text input. Two modes:
//   1. Typeahead — shows org clients filtered by name substring as the
//      user types. Click a row → onPick({id, name}).
//   2. Inline +Add — tiny form (name / email / phone) that calls
//      createNewClient and then onPick the just-created row.
// The parent owns the displayed text + the linked id; the picker
// surfaces a tiny "× clear" affordance when an id is set so the
// operator can drop the link without retyping.

function NewProjectClientPicker({
  orgId,
  name,
  clientId,
  onPick,
  onSubmitForm,
}: {
  orgId: string | null
  name: string
  clientId: string | null
  onPick: (next: { id: string; name: string } | null) => void
  /** Enter on the search input submits the parent form when no client
   *  is being added inline. */
  onSubmitForm: () => void
}) {
  const { alert } = useConfirm()
  const [clients, setClients] = useState<Client[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const next = await loadClients(orgId)
      if (cancelled) return
      setClients(next)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Close the typeahead dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const matches = query.trim()
    ? clients.filter((c) =>
        c.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : clients
  const exactMatch = clients.find(
    (c) => c.name.trim().toLowerCase() === query.trim().toLowerCase(),
  )

  async function handleCreate() {
    if (!orgId || saving) return
    const trimmed = newName.trim()
    if (!trimmed) {
      await alert({
        title: 'Add a name',
        message: 'A client needs a name before it can be saved.',
      })
      return
    }
    setSaving(true)
    try {
      const created = await createNewClient({
        org_id: orgId,
        name: trimmed,
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
      })
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      onPick({ id: created.id, name: created.name })
      setAdding(false)
      setNewName('')
      setNewEmail('')
      setNewPhone('')
      setQuery('')
      setOpen(false)
    } catch (err) {
      console.error('createNewClient', err)
      await alert({
        title: 'Couldn’t create client',
        message:
          'Something went wrong inserting the client row. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  // Picked state: read-only chip with × clear. Operator can replace
  // the picked client by clicking ×, which reopens the typeahead.
  if (clientId) {
    return (
      <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
        <User className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />
        <span className="text-sm text-[#111] truncate flex-1">{name}</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label="Clear client"
          className="text-[#9CA3AF] hover:text-[#111] flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // Inline +Add form mode.
  if (adding) {
    return (
      <div className="mt-1 space-y-1.5 border border-[#2563EB] bg-[#EFF6FF] rounded-lg p-2.5">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
            if (e.key === 'Escape') setAdding(false)
          }}
          placeholder="Client name"
          className="w-full text-sm bg-white border border-[#E5E7EB] rounded-md px-2.5 py-1.5 outline-none focus:border-[#2563EB]"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email (optional)"
            className="text-xs bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 outline-none focus:border-[#2563EB]"
          />
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="text-xs bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 outline-none focus:border-[#2563EB]"
          />
        </div>
        <div className="flex justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-2.5 py-1 text-[12px] text-[#6B7280] hover:text-[#111] rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="px-3 py-1 text-[12px] font-medium text-white bg-[#2563EB] rounded hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add client'}
          </button>
        </div>
      </div>
    )
  }

  // Typeahead mode.
  return (
    <div ref={wrapRef} className="relative mt-1">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // If typeahead has an exact match, pick it. Otherwise let
            // the parent submit (a clientless project is fine).
            if (exactMatch) {
              e.preventDefault()
              onPick({ id: exactMatch.id, name: exactMatch.name })
              setOpen(false)
            } else {
              onSubmitForm()
            }
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Type a client name…"
        className="w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
      />
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-[#E5E7EB] rounded-lg shadow-lg">
          {!loaded ? (
            <div className="px-3 py-2 text-xs text-[#9CA3AF] italic">
              Loading clients…
            </div>
          ) : (
            <>
              {matches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[#9CA3AF] italic">
                  {query.trim() ? 'No matches' : 'No clients yet'}
                </div>
              ) : (
                matches.slice(0, 12).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onPick({ id: c.id, name: c.name })
                      setOpen(false)
                      setQuery('')
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] flex items-center gap-2"
                  >
                    <span className="flex-1 truncate text-[#111]">{c.name}</span>
                    {c.email && (
                      <span className="text-[11px] text-[#9CA3AF] truncate">
                        {c.email}
                      </span>
                    )}
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setNewName(query.trim())
                  setAdding(true)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm border-t border-[#F3F4F6] hover:bg-[#EFF6FF] flex items-center gap-2 text-[#2563EB]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add new client{query.trim() ? `: "${query.trim()}"` : ''}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

// ============================================================================
// ReparseModal — review-and-apply diff after re-running the parser
// ============================================================================
// Loads the project's stored PDFs from intake_context.source_pdf_paths,
// re-runs the parser, computes a diff against current estimate_lines,
// and presents three sections (New / Changed / Removed) for the
// operator to selectively accept. Apply path writes through
// lib/reparse.applyReparseDiff which also recomputes the bid total
// and appends the run to intake_context.reparse_history.
//
// Re-parses are NOT applied silently — this modal is the only path.
// ============================================================================

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  applyReparseDiff,
  loadCurrentScope,
  runReparse,
} from '@/lib/reparse'
import { computeReparseDiff, type ReparseDiff } from '@/lib/reparse-diff'
import type { ParsedPdf } from '@/lib/pdf-parser'

interface Props {
  projectId: string
  orgId: string
  onClose: () => void
  onApplied: (appliedCount: number) => void
}

export default function ReparseModal({
  projectId,
  orgId,
  onClose,
  onApplied,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedPdf | null>(null)
  const [diff, setDiff] = useState<ReparseDiff | null>(null)
  const [failures, setFailures] = useState<{ file: string; error: string }[]>([])

  // Per-item decisions. New items index by position; changed + removed
  // index by lineId. Default-on for new items + changed items so the
  // operator's first click is usually accept-all-then-trim. Removals
  // default-off — we don't want to nuke estimate lines unless the
  // operator explicitly opts in.
  const [acceptedNewIndexes, setAcceptedNewIndexes] = useState<Set<number>>(new Set())
  const [acceptedChangedIds, setAcceptedChangedIds] = useState<Set<string>>(new Set())
  const [acceptedRemovedIds] = useState<Set<string>>(new Set())
  const [, forceTick] = useState(0)
  const bumpRemoved = () => forceTick((n) => n + 1)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: proj, error: projErr } = await supabase
          .from('projects')
          .select('intake_context')
          .eq('id', projectId)
          .single()
        if (projErr || !proj) {
          throw new Error(projErr?.message || 'Project not found')
        }
        const intake = (proj as any).intake_context || {}
        const paths: string[] = Array.isArray(intake.source_pdf_paths)
          ? intake.source_pdf_paths
          : []
        if (paths.length === 0) {
          throw new Error(
            'No stored PDFs to re-parse. The project predates re-parse retention or was created manually.',
          )
        }

        const [{ parsed: reparsed, failures: failed }, currentScope] =
          await Promise.all([runReparse({ orgId, paths }), loadCurrentScope(projectId)])
        if (cancelled) return
        setParsed(reparsed)
        setFailures(failed)

        const computed = computeReparseDiff({
          currentScope,
          parsedItems: reparsed.items || [],
        })
        setDiff(computed)
        // Default-on selections for new + changed.
        setAcceptedNewIndexes(new Set(computed.newItems.map((_, i) => i)))
        setAcceptedChangedIds(new Set(computed.changedItems.map((c) => c.currentLineId)))
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Re-parse failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, orgId])

  const totalSelected =
    acceptedNewIndexes.size + acceptedChangedIds.size + acceptedRemovedIds.size

  function toggleNew(i: number) {
    setAcceptedNewIndexes((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }
  function toggleChanged(id: string) {
    setAcceptedChangedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleRemoved(id: string) {
    if (acceptedRemovedIds.has(id)) acceptedRemovedIds.delete(id)
    else acceptedRemovedIds.add(id)
    bumpRemoved()
  }
  function setAllNew(on: boolean) {
    if (!diff) return
    setAcceptedNewIndexes(on ? new Set(diff.newItems.map((_, i) => i)) : new Set())
  }
  function setAllChanged(on: boolean) {
    if (!diff) return
    setAcceptedChangedIds(on ? new Set(diff.changedItems.map((c) => c.currentLineId)) : new Set())
  }
  function setAllRemoved(on: boolean) {
    if (!diff) return
    acceptedRemovedIds.clear()
    if (on) for (const r of diff.removedItems) acceptedRemovedIds.add(r.currentLineId)
    bumpRemoved()
  }

  async function handleApply() {
    if (!diff || !parsed) return
    setApplying(true)
    setError(null)
    try {
      const sourceFileNames = parsed.fileName.split(' + ')
      const result = await applyReparseDiff({
        projectId,
        orgId,
        diff,
        decisions: {
          acceptedNewIndexes,
          acceptedChangedIds,
          acceptedRemovedIds,
        },
        parsedSourceFileNames: sourceFileNames,
      })
      onApplied(result.applied)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111]">Review re-parse</h3>
            <p className="text-[11.5px] text-[#9CA3AF] mt-0.5">
              Compare the new parse against your current scope. Pick which
              changes to apply.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={applying}
            className="text-[#9CA3AF] hover:text-[#111] p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[12.5px] text-[#6B7280] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Re-running the parser…
            </div>
          ) : error ? (
            <div className="px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
              {error}
            </div>
          ) : diff ? (
            <>
              {failures.length > 0 && (
                <div className="px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg text-[11.5px] text-[#92400E]">
                  <div className="font-semibold mb-1">
                    {failures.length} source PDF{failures.length === 1 ? '' : 's'} failed
                    to re-parse
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[#A16207]">
                    {failures.map((f, i) => (
                      <li key={i}>
                        <span className="font-mono">{f.file}</span> — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <DiffSection
                title="New items"
                count={diff.newItems.length}
                onAcceptAll={() => setAllNew(true)}
                onSkipAll={() => setAllNew(false)}
              >
                {diff.newItems.length === 0 ? (
                  <EmptyRow text="No new items." />
                ) : (
                  diff.newItems.map((it, i) => (
                    <DiffRow
                      key={i}
                      checked={acceptedNewIndexes.has(i)}
                      onToggle={() => toggleNew(i)}
                      title={`${it.room || 'Other'} · ${it.name}`}
                      sub={
                        it.linear_feet != null
                          ? `${it.linear_feet} LF`
                          : it.quantity != null
                            ? `${it.quantity}`
                            : null
                      }
                    />
                  ))
                )}
              </DiffSection>

              <DiffSection
                title="Changed items"
                count={diff.changedItems.length}
                onAcceptAll={() => setAllChanged(true)}
                onSkipAll={() => setAllChanged(false)}
              >
                {diff.changedItems.length === 0 ? (
                  <EmptyRow text="No changed items." />
                ) : (
                  diff.changedItems.map((c) => (
                    <DiffRow
                      key={c.currentLineId}
                      checked={acceptedChangedIds.has(c.currentLineId)}
                      onToggle={() => toggleChanged(c.currentLineId)}
                      title={`${c.current.room} · ${c.current.description}`}
                      changes={c.fieldDiffs.map(
                        (f) => `${f.field}: ${formatValue(f.from)} → ${formatValue(f.to)}`,
                      )}
                    />
                  ))
                )}
              </DiffSection>

              <DiffSection
                title="Removed items"
                count={diff.removedItems.length}
                tone="danger"
                onAcceptAll={() => setAllRemoved(true)}
                onSkipAll={() => setAllRemoved(false)}
                acceptLabel="Remove all"
                skipLabel="Keep all"
              >
                {diff.removedItems.length === 0 ? (
                  <EmptyRow text="No items missing from the new parse." />
                ) : (
                  diff.removedItems.map((r) => (
                    <DiffRow
                      key={r.currentLineId}
                      checked={acceptedRemovedIds.has(r.currentLineId)}
                      onToggle={() => toggleRemoved(r.currentLineId)}
                      title={`${r.room} · ${r.description}`}
                      sub="In current scope, not in new parse"
                      tone="danger"
                    />
                  ))
                )}
              </DiffSection>
            </>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying || loading || !diff || totalSelected === 0}
            className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md disabled:opacity-50"
          >
            {applying
              ? 'Applying…'
              : `Apply selected (${totalSelected} change${totalSelected === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>
    </div>
  )
}

function DiffSection({
  title,
  count,
  tone = 'default',
  onAcceptAll,
  onSkipAll,
  acceptLabel = 'Accept all',
  skipLabel = 'Skip all',
  children,
}: {
  title: string
  count: number
  tone?: 'default' | 'danger'
  onAcceptAll: () => void
  onSkipAll: () => void
  acceptLabel?: string
  skipLabel?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-[#374151]">
          {title}{' '}
          <span className="text-[#9CA3AF] font-normal">({count})</span>
        </div>
        {count > 0 && (
          <div className="flex items-center gap-3 text-[11.5px]">
            <button
              type="button"
              onClick={onAcceptAll}
              className={
                tone === 'danger'
                  ? 'text-[#DC2626] hover:underline'
                  : 'text-[#2563EB] hover:underline'
              }
            >
              {acceptLabel}
            </button>
            <button
              type="button"
              onClick={onSkipAll}
              className="text-[#6B7280] hover:underline"
            >
              {skipLabel}
            </button>
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}

function DiffRow({
  checked,
  onToggle,
  title,
  sub,
  changes,
  tone = 'default',
}: {
  checked: boolean
  onToggle: () => void
  title: string
  sub?: string | null
  changes?: string[]
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left px-4 py-2.5 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] ${
        checked ? (tone === 'danger' ? 'bg-[#FEF2F2]' : 'bg-[#EFF6FF]') : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          className={`mt-0.5 w-4 h-4 rounded border-[#D1D5DB] flex-shrink-0 ${
            tone === 'danger'
              ? 'text-[#DC2626] focus:ring-[#DC2626]'
              : 'text-[#2563EB] focus:ring-[#2563EB]'
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-[#111] truncate">{title}</div>
          {sub && (
            <div className="text-[11.5px] text-[#6B7280]">{sub}</div>
          )}
          {changes && changes.length > 0 && (
            <ul className="text-[11.5px] text-[#6B7280] mt-1 list-disc list-inside">
              {changes.map((c, i) => (
                <li key={i} className="font-mono">
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </button>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="px-4 py-3 text-[12px] text-[#9CA3AF] italic">{text}</div>
  )
}

function formatValue(v: any): string {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60)
  return String(v)
}

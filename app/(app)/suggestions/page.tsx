'use client'

// ============================================================================
// /suggestions — Phase 10 rate-book learning loop review surface
// ============================================================================
// Operators come here after a batch of jobs close. We've already scanned
// closed-job evidence in lib/suggestions.ts::regenerateSuggestions — this
// page is where they:
//
//   • Read the card for each active suggestion (type, rationale, evidence)
//   • Toggle source-job chips on/off to refine the mean before accepting
//   • Accept with an apply scope (this item / whole category / shop-wide)
//   • Dismiss with a signature so the same evidence doesn't re-surface
//   • For split suggestions, edit the two proposed item names/hours before
//     accepting
//
// The "Re-scan" button at the top re-runs regenerateSuggestions() against
// the current closed-job set. Tabs split active/dismissed/accepted.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import {
  listActiveSuggestions,
  listSuggestionsByStatus,
  regenerateSuggestions,
  acceptSuggestion,
  acceptSplit,
  dismissSuggestion,
  type SuggestionRow,
  type SuggestionStatus,
  type SuggestionType,
} from '@/lib/suggestions'
import type { LaborDept } from '@/lib/rate-book-seed'
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Scissors,
  Moon,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

type Tab = 'active' | 'accepted' | 'dismissed'

const DEPTS: LaborDept[] = ['eng', 'cnc', 'assembly', 'finish', 'install']

const TYPE_META: Record<SuggestionType, { label: string; tone: string; Icon: typeof TrendingUp }> = {
  big_up: { label: 'Big up', tone: 'bg-rose-50 text-rose-700 ring-rose-200', Icon: TrendingUp },
  big_down: { label: 'Big down', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', Icon: TrendingDown },
  minor: { label: 'Minor', tone: 'bg-amber-50 text-amber-700 ring-amber-200', Icon: Sparkles },
  split: { label: 'Split', tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200', Icon: Scissors },
  quiet: { label: 'Quiet', tone: 'bg-slate-50 text-slate-600 ring-slate-200', Icon: Moon },
}

function hrsFromMin(m: number): string {
  if (!m) return '0h'
  return `${(m / 60).toFixed(1)}h`
}

export default function SuggestionsPage() {
  const { org, user } = useAuth()
  const [tab, setTab] = useState<Tab>('active')
  const [rows, setRows] = useState<SuggestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [rescanning, setRescanning] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  // Per-row UI state (expanded, excluded job ids, edited split items).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [excludedByRow, setExcludedByRow] = useState<Record<string, string[]>>({})
  const [scopeByRow, setScopeByRow] = useState<Record<string, 'this' | 'category' | 'shop_wide'>>({})
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const fn = tab === 'active'
      ? () => listActiveSuggestions(org.id)
      : () => listSuggestionsByStatus(org.id, tab as SuggestionStatus)
    const data = await fn()
    setRows(data)
    setLoading(false)
  }, [org?.id, tab])

  useEffect(() => { void load() }, [load])

  const onRescan = async () => {
    if (!org?.id) return
    setRescanning(true)
    try {
      const r = await regenerateSuggestions(org.id)
      setBanner(`Scan complete: ${r.created} new · ${r.updated} updated · ${r.resurfaced} resurfaced · ${r.stale} retired.`)
      await load()
    } catch (e) {
      setBanner(`Scan failed: ${(e as Error).message}`)
    } finally {
      setRescanning(false)
    }
  }

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const toggleExcluded = (rowId: string, projectId: string) => {
    setExcludedByRow((prev) => {
      const current = prev[rowId] || []
      const next = current.includes(projectId)
        ? current.filter((p) => p !== projectId)
        : [...current, projectId]
      return { ...prev, [rowId]: next }
    })
  }

  const onAccept = async (row: SuggestionRow) => {
    if (!org?.id) return
    const excludedJobIds = excludedByRow[row.id] || []
    const reason = reasonByRow[row.id] || 'Accepted via suggestion'
    const applyScope = scopeByRow[row.id] || 'this'
    let result: { ok: boolean; error?: string } = { ok: false }
    if (row.suggestion_type === 'split') {
      const newItems = row.proposed_changes.new_items || []
      result = await acceptSplit({
        orgId: org.id,
        suggestionId: row.id,
        userId: user?.id || null,
        reason,
        newItems,
      })
    } else {
      result = await acceptSuggestion({
        orgId: org.id,
        suggestionId: row.id,
        userId: user?.id || null,
        reason,
        applyScope,
        excludedJobIds,
      })
    }
    if (!result.ok) {
      setBanner(`Accept failed: ${result.error || 'unknown error'}`)
    } else {
      setBanner('Suggestion accepted.')
    }
    await load()
  }

  const onDismiss = async (row: SuggestionRow) => {
    if (!org?.id) return
    await dismissSuggestion({
      orgId: org.id,
      suggestionId: row.id,
      userId: user?.id || null,
    })
    await load()
  }

  const tabCounts = useMemo(() => ({ active: rows.length }), [rows])

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Suggestions</h1>
            <p className="text-sm text-slate-600 mt-1">
              Rate-book nudges from closed-job evidence.
            </p>
          </div>
          <button
            onClick={onRescan}
            disabled={rescanning}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${rescanning ? 'animate-spin' : ''}`} />
            {rescanning ? 'Scanning…' : 'Re-scan closed jobs'}
          </button>
        </div>

        {banner && (
          <div className="mb-4 rounded-md bg-blue-50 text-blue-900 px-4 py-2 text-sm ring-1 ring-blue-200">
            {banner}
          </div>
        )}

        <div className="flex gap-1 mb-4 border-b border-slate-200">
          {(['active', 'accepted', 'dismissed'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'active' && tabCounts.active > 0 ? ` (${tabCounts.active})` : ''}
            </button>
          ))}
        </div>

        {loading && <div className="text-sm text-slate-500">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Nothing here. {tab === 'active' ? 'Run a re-scan once you have closed jobs with a rate-book history.' : ''}
          </div>
        )}

        <div className="space-y-3">
          {rows.map((row) => {
            const meta = TYPE_META[row.suggestion_type]
            const { Icon } = meta
            const isOpen = !!expanded[row.id]
            const excluded = excludedByRow[row.id] || []
            const scope = scopeByRow[row.id] || 'this'
            const reason = reasonByRow[row.id] || ''
            const changes = row.proposed_changes.field_changes || []
            return (
              <div
                key={row.id}
                className="rounded-lg bg-white ring-1 ring-slate-200 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{row.evidence.itemName}</div>
                      {row.rationale && (
                        <div className="text-sm text-slate-600 mt-0.5">{row.rationale}</div>
                      )}
                    </div>
                  </div>
                  {tab === 'active' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleExpanded(row.id)}
                        className="text-sm text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-md ring-1 ring-slate-200"
                      >
                        {isOpen ? 'Hide' : 'Review'}
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && tab === 'active' && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-4">
                    {/* Source-job toggles */}
                    <div>
                      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        Source jobs — click to include/exclude
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {row.evidence.jobs.map((j) => {
                          const off = excluded.includes(j.projectId)
                          return (
                            <button
                              key={`${j.projectId}-${j.estimateLineId}`}
                              onClick={() => toggleExcluded(row.id, j.projectId)}
                              className={`text-xs px-2 py-1 rounded-md ring-1 transition ${
                                off
                                  ? 'bg-slate-100 text-slate-400 ring-slate-200 line-through'
                                  : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-500'
                              }`}
                              title={`est ${hrsFromMin(j.estimatedMinutesTotal)} / act ${hrsFromMin(j.actualMinutesTotal)}`}
                            >
                              {j.projectName || j.projectId.slice(0, 8)}
                              {' · '}
                              <span className="text-slate-500">
                                {hrsFromMin(j.estimatedMinutesTotal)}→{hrsFromMin(j.actualMinutesTotal)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Per-dept preview of proposed change */}
                    {(row.suggestion_type === 'big_up' || row.suggestion_type === 'big_down' || row.suggestion_type === 'minor') && (
                      <div>
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                          Proposed per-dept hours
                        </div>
                        {changes.length === 0 ? (
                          <div className="text-sm text-slate-500">No per-dept changes within tolerance.</div>
                        ) : (
                          <table className="text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="text-left pr-4">Dept</th>
                                <th className="text-right pr-4">From</th>
                                <th className="text-right">To</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map((c) => (
                                <tr key={c.field}>
                                  <td className="pr-4 py-0.5 font-mono text-xs">{c.field.replace('base_labor_hours_', '')}</td>
                                  <td className="text-right pr-4 py-0.5">{c.from.toFixed(2)}h</td>
                                  <td className="text-right py-0.5 font-medium">{c.to.toFixed(2)}h</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {row.suggestion_type === 'split' && row.proposed_changes.new_items && (
                      <div>
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                          Proposed split into two items
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {row.proposed_changes.new_items.map((it, i) => (
                            <div key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                              <div className="font-medium">{it.name}</div>
                              <div className="text-xs text-slate-600 mt-1 space-x-2">
                                {DEPTS.map((d) => (
                                  <span key={d}>{d}: {(it.baseHoursByDept[d] || 0).toFixed(1)}h</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {row.suggestion_type === 'quiet' && (
                      <div className="text-sm text-slate-700">
                        Accepting will mark this item <code className="text-xs bg-slate-100 rounded px-1 py-0.5">active=false</code>.
                      </div>
                    )}

                    {/* Controls */}
                    <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100">
                      {row.suggestion_type !== 'split' && (
                        <label className="text-xs text-slate-600">
                          Apply to
                          <select
                            className="block mt-1 rounded-md ring-1 ring-slate-200 px-2 py-1 text-sm"
                            value={scope}
                            onChange={(e) =>
                              setScopeByRow((prev) => ({
                                ...prev,
                                [row.id]: e.target.value as 'this' | 'category' | 'shop_wide',
                              }))
                            }
                          >
                            <option value="this">This item only</option>
                            <option value="category">Whole category</option>
                            <option value="shop_wide">Shop-wide</option>
                          </select>
                        </label>
                      )}
                      <label className="text-xs text-slate-600 flex-1 min-w-[240px]">
                        Reason / note
                        <input
                          type="text"
                          className="block w-full mt-1 rounded-md ring-1 ring-slate-200 px-2 py-1 text-sm"
                          placeholder="What's prompting this?"
                          value={reason}
                          onChange={(e) =>
                            setReasonByRow((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                        />
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onDismiss(row)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md ring-1 ring-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <XCircle className="h-4 w-4" />
                          Dismiss
                        </button>
                        <button
                          onClick={() => onAccept(row)}
                          className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Accept
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {tab !== 'active' && (
                  <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 flex items-center gap-4">
                    {row.accepted_at && (
                      <span>
                        Accepted {new Date(row.accepted_at).toLocaleDateString()}
                      </span>
                    )}
                    {row.dismissed_at && (
                      <span>
                        Dismissed {new Date(row.dismissed_at).toLocaleDateString()}
                        {row.dismissed_signature === 'stale:no-evidence' ? ' — retired after re-scan found no evidence' : ''}
                      </span>
                    )}
                    <span>{row.source_job_ids.length} source job{row.source_job_ids.length === 1 ? '' : 's'}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

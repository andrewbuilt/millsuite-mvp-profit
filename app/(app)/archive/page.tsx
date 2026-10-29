'use client'

// ============================================================================
// /archive — THE archive (one page, Andrew 2026-10-22). Reached from Manage →
// Archive and from the kanban's Lost column ("Archive →"); /sales/lost, the
// old lost-only list, redirects here.
//
// Lists two things, merged (lib/project-archive.listArchivePage):
//   · every project archived by hand (archived_at, migration 119) — any stage;
//     Unarchive puts it back on the board / projects list.
//   · every LOST project, archived or not — lost cards leave the board on
//     their own when the month turns (2026-10-29), and this is where they live forever, with the
//     post-mortem columns the old page carried (source, reason, days in
//     pipeline).
// DISPLAY ONLY: reports and the sales report still count all of it.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { listArchivePage, unarchiveProject, type ArchivedProject } from '@/lib/project-archive'
import { matchesProjectSearch, normalizeQuery } from '@/lib/project-search'


function money(n: number): string {
  return n > 0 ? `$${Math.round(n).toLocaleString()}` : '—'
}

function monthLabel(ym: string): string {
  if (ym === 'unknown') return 'Date unknown'
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

type SectionKey = 'pipeline' | 'active' | 'complete' | 'lost'

const SECTIONS: Array<{ key: SectionKey; title: string }> = [
  { key: 'pipeline', title: 'In the pipeline' },
  { key: 'active', title: 'Sold & in progress' },
  { key: 'complete', title: 'Completed' },
  { key: 'lost', title: 'Lost' },
]

function sectionOf(r: ArchivedProject): SectionKey {
  if (r.stage === 'lost') return 'lost'
  if (r.stage === 'complete') return 'complete'
  if (['sold', 'production', 'installed'].includes(r.stage)) return 'active'
  return 'pipeline'
}

/** The month a row files under: when it was lost / completed, else when it
 *  was archived. Never a guess beyond those stamps. */
function monthOf(r: ArchivedProject): string {
  const stamp = r.stage === 'lost' ? r.lost_at : r.stage === 'complete' ? r.completed_at || r.archived_at : r.archived_at
  return (stamp || '').slice(0, 7) || 'unknown'
}

function groupByMonth(rows: ArchivedProject[]): Array<[string, ArchivedProject[]]> {
  const m = new Map<string, ArchivedProject[]>()
  for (const r of rows) {
    const k = monthOf(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return [...m.entries()].sort((a, b) =>
    a[0] === 'unknown' ? 1 : b[0] === 'unknown' ? -1 : b[0].localeCompare(a[0]),
  )
}

/** Whole days created → lost. Null when either stamp is missing. */
function daysInPipeline(r: ArchivedProject): number | null {
  if (!r.lost_at || !r.created_at) return null
  const ms = new Date(r.lost_at).getTime() - new Date(r.created_at).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms / 86400000)
}

/** A lost card nobody archived is still on the board in the month it was
 *  lost — the same this-calendar-month rule as the kanban's Lost column. */
function lostStillOnBoard(r: ArchivedProject): boolean {
  if (!r.lost_at) return false
  const d = new Date(r.lost_at)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export default function ArchivePage() {
  const { org } = useAuth()
  const [rows, setRows] = useState<ArchivedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    listArchivePage(org.id).then((r) => {
      if (cancelled) return
      setRows(r)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const visible = useMemo(() => {
    const q = normalizeQuery(query)
    return rows.filter((r) => matchesProjectSearch(r, q))
  }, [rows, query])

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({ ...s, groups: groupByMonth(visible.filter((r) => sectionOf(r) === s.key)) })).filter(
        (s) => s.groups.length > 0,
      ),
    [visible],
  )

  async function unarchive(r: ArchivedProject) {
    setBusy(r.id)
    try {
      await unarchiveProject(r.id)
      // A lost project stays listed here (lost work always is) — it just
      // loses its archived stamp. Anything else goes back to the board.
      setRows((prev) =>
        r.stage === 'lost'
          ? prev.map((x) => (x.id === r.id ? { ...x, archived_at: null } : x))
          : prev.filter((x) => x.id !== r.id),
      )
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not unarchive.')
    } finally {
      setBusy(null)
    }
  }

  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <div className="max-w-[900px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3">
        <Link
          href="/sales/kanban"
          className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          aria-label="Back to the board"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#111]">Archive</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            {rows.length} project{rows.length === 1 ? '' : 's'} ·{' '}
            <span className="font-mono tabular-nums">{money(total)}</span> — archived projects, plus every lost
            project (lost cards leave the board when the month ends). Everything here still counts in
            reports.
          </p>
        </div>
      </div>

      <div className="relative mt-4 max-w-sm">
        <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the archive"
          className="w-full pl-9 pr-8 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white outline-none focus:border-[#2563EB]"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#111]"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">
          Nothing archived yet. Use Archive in a card&apos;s ⋯ menu on the board, or on a completed job&apos;s card on
          Projects.
        </div>
      ) : sections.length === 0 ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">Nothing in the archive matches that search.</div>
      ) : (
        sections.map((sec) => (
          <div key={sec.key} className="mt-8">
            <h2 className="text-sm font-semibold text-[#111]">{sec.title}</h2>
            {sec.groups.map(([month, list]) => (
              <section key={month} className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-2">
                  {monthLabel(month)}{' '}
                  <span className="text-[#D1D5DB] normal-case tracking-normal">
                    · {list.length} · {money(list.reduce((s, r) => s + r.value, 0))}
                  </span>
                </div>
                <div className="bg-white border border-[#E5E7EB] rounded-xl divide-y divide-[#F3F4F6]">
                  {list.map((r) => {
                    const days = r.stage === 'lost' ? daysInPipeline(r) : null
                    return (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                        <Link href={`/projects/${r.id}`} className="min-w-0 flex-1 group">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13.5px] font-medium text-[#111] group-hover:underline">{r.name}</span>
                            {r.client_name && <span className="text-[11px] text-[#6B7280]">{r.client_name}</span>}
                            {r.lead_source && r.stage === 'lost' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
                                via {r.lead_source}
                              </span>
                            )}
                          </div>
                          {r.lost_reason && r.stage === 'lost' && (
                            <div className="mt-0.5 text-[12px] text-[#6B7280] leading-snug">{r.lost_reason}</div>
                          )}
                        </Link>
                        <div className="text-right flex-shrink-0">
                          <div className="text-[12.5px] font-mono tabular-nums text-[#374151]">{money(r.value)}</div>
                          {r.stage === 'lost' && (
                            <div className="text-[10.5px] text-[#9CA3AF] mt-0.5">
                              {days != null ? `${days}d in pipeline` : '—'}
                            </div>
                          )}
                        </div>
                        <div className="w-[96px] flex-shrink-0 text-right">
                          {r.archived_at ? (
                            <button
                              onClick={() => unarchive(r)}
                              disabled={busy === r.id}
                              className="px-2.5 py-1 text-[11.5px] font-semibold rounded-md border border-[#E5E7EB] text-[#374151] hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-50"
                            >
                              {busy === r.id ? 'Restoring…' : 'Unarchive'}
                            </button>
                          ) : (
                            <span className="text-[10.5px] text-[#9CA3AF]">
                              {lostStillOnBoard(r) ? 'Still on the board' : 'Off the board'}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

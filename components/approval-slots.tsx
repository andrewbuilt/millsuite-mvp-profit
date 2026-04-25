// ============================================================================
// approval-slots.tsx — Phase 1 UI for pre-prod approval slots
// ============================================================================
// Renders the slot cards from /mnt/code/built-os/preprod-approval-mockup.html
// against real data for a given subproject. Covers the Phase 1 scope from
// BUILD-PLAN.md: three states + transitions + timestamps, ball-in-court chip
// (D5), custom slot creation with baseline (D7), linked slot support with
// suggestion chip (D4).
//
// Not in scope (later phases):
//   - Change orders (Phase 4)
//   - Drawings track (Phase 2)
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, Send, RotateCcw, Link2, Lock, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'
import {
  ApprovalItem,
  ApprovalState,
  BallInCourt,
  approve,
  ballChipTone,
  daysSinceStateChange,
  loadApprovalItemsForSubproject,
  requestChange,
  revNumber,
  submitSample,
} from '@/lib/approvals'

interface Props {
  subprojectId: string
  projectId: string
  /** Optional, used as actor_user_id on item_revisions rows. */
  actorUserId?: string
  /** Called after every successful state mutation (approve / reject /
   *  submit / change-material). Lets the parent re-fetch project-wide
   *  data sourced elsewhere — subproject_approval_status view counts,
   *  the ready-for-scheduling header, the right-rail aggregate. Without
   *  this, local approve clicks updated the slot card but left the
   *  header / counts stale until a manual reload. */
  onChange?: () => void
}

export default function ApprovalSlots({ subprojectId, projectId, actorUserId, onChange }: Props) {
  const { alert } = useConfirm()
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const reload = useCallback(async () => {
    setLoading(true)
    const next = await loadApprovalItemsForSubproject(subprojectId)
    setItems(next)
    setLoading(false)
  }, [subprojectId])

  useEffect(() => {
    reload()
  }, [reload])

  const approvedCount = items.filter((i) => i.state === 'approved').length

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runTransition = async (
    fn: (id: string, args: { actorUserId?: string }) => Promise<void>,
    itemId: string
  ) => {
    setBusyItemId(itemId)
    try {
      await fn(itemId, { actorUserId })
      await reload()
      onChange?.()
    } catch (err) {
      console.error(err)
      await alert({
        title: 'Couldn’t update spec',
        message: 'Something went wrong saving that spec change. Open the browser console for the full error and try again.',
      })
    } finally {
      setBusyItemId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading approvals…</div>
  }

  return (
    <div className="space-y-3">
      {/* Section header — specs are derived from the locked estimate.
          Adding a spec post-sale means making a change order, which is
          authored on a line in the subproject editor. */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-neutral-700">
          Specs
          <span className="ml-2 text-neutral-500 font-normal">
            {approvedCount} of {items.length} approved
          </span>
          {items.length > 0 && (
            <span className="ml-2 text-neutral-400 font-normal">· pulled from estimate lines</span>
          )}
        </div>
        <Link
          href={`/projects/${projectId}/subprojects/${subprojectId}`}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700"
        >
          <Plus className="w-3 h-3" />
          New change order
        </Link>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded p-4">
          No specs yet. Specs are created from estimate-line finish specs when a subproject is marked sold.
        </div>
      )}

      {/* Slot list. Approval-state buttons only — content edits (material
          / finish swap) go through a CO authored on the line. */}
      {items.map((item) => (
        <SlotCard
          key={item.id}
          item={item}
          isExpanded={expanded.has(item.id)}
          isBusy={busyItemId === item.id}
          onToggleExpanded={() => toggleExpanded(item.id)}
          onSubmit={() => runTransition(submitSample, item.id)}
          onApprove={() => runTransition(approve, item.id)}
          onRequestChange={() => runTransition(requestChange, item.id)}
        />
      ))}
    </div>
  )
}

// ── Slot card ──

interface SlotCardProps {
  item: ApprovalItem
  isExpanded: boolean
  isBusy: boolean
  onToggleExpanded: () => void
  onSubmit: () => void
  onApprove: () => void
  onRequestChange: () => void
}

function SlotCard(p: SlotCardProps) {
  const { item } = p
  const rev = revNumber(item)
  const days = daysSinceStateChange(item)
  const tone = ballChipTone(item)

  return (
    <div className={`rounded border ${stateBorderClass(item.state)} bg-white overflow-hidden`}>
      {/* Row 1 */}
      <div className="p-3 flex items-start gap-3">
        <StateDot state={item.state} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-neutral-900 text-sm">{item.label}</div>
          <div className="text-xs text-neutral-600 mt-0.5">
            {[item.material, item.finish].filter(Boolean).join(' · ') || <span className="italic text-neutral-400">material + finish not set</span>}
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            {sourceLabel(item)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rev > 0 && (
            <span className="text-xs text-neutral-500">rev {rev}</span>
          )}
          <StateBadge state={item.state} />
          {item.state !== 'approved' && item.ball_in_court && (
            <BallChip party={item.ball_in_court} tone={tone} days={days} />
          )}
          <button onClick={p.onToggleExpanded} className="text-neutral-500 hover:text-neutral-800 p-1">
            {p.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {p.isExpanded && (
        <div className="px-3 pb-3 border-t border-neutral-100">
          <div className="grid grid-cols-2 gap-3 pt-3">
            <KV label="Material" value={item.material || '—'} />
            <KV label="Finish" value={item.finish || '—'} />
          </div>

          {/* Custom-slot baseline visibility per D7 */}
          {item.is_custom && (
            <CustomBaselineSummary item={item} />
          )}

          {/* Linked-slot indicator. Read-only post-sale: linking + unlinking
              were content mutations that don't make sense once the estimate
              is locked — the link state was set during pre-sale and is just
              displayed here for context. */}
          {item.linked_to_item_id && (
            <div className="mt-3 text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
              <Link2 className="w-3 h-3" />
              Linked — approval mirrors the source spec
            </div>
          )}

          {/* Revision timeline */}
          {item.revisions && item.revisions.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-neutral-700 mb-1">Sample history</div>
              <ol className="text-xs space-y-1">
                {item.revisions.map((r) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-400 mt-1.5" />
                    <div>
                      <span className="text-neutral-800">{actionLabel(r.action)}</span>
                      {r.note && <span className="text-neutral-500"> — {r.note}</span>}
                      <span className="text-neutral-400 ml-1">{fmtTimestamp(r.occurred_at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Actions — approval-workflow only. Content swaps go through CO. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <SlotActions
              state={item.state}
              isBusy={p.isBusy}
              onSubmit={p.onSubmit}
              onApprove={p.onApprove}
              onRequestChange={p.onRequestChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SlotActions({
  state,
  isBusy,
  onSubmit,
  onApprove,
  onRequestChange,
}: {
  state: ApprovalState
  isBusy: boolean
  onSubmit: () => void
  onApprove: () => void
  onRequestChange: () => void
}) {
  if (state === 'pending') {
    return (
      <button
        onClick={onSubmit}
        disabled={isBusy}
        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 text-white hover:bg-neutral-900 disabled:opacity-40"
      >
        <Send className="w-3 h-3" />
        Sample submitted
      </button>
    )
  }
  if (state === 'in_review') {
    return (
      <>
        <button
          onClick={onApprove}
          disabled={isBusy}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          <CheckCircle2 className="w-3 h-3" />
          Client approved
        </button>
        <button
          onClick={onRequestChange}
          disabled={isBusy}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700 disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" />
          Client requested change
        </button>
      </>
    )
  }
  // approved — terminal state. Content edits go through a CO authored on
  // the line in the subproject editor; the previous "Material changed —
  // reopen" button was a content mutation and has been removed.
  return null
}

// ── Sub-components ──

function StateDot({ state }: { state: ApprovalState }) {
  const cls =
    state === 'approved'
      ? 'bg-emerald-500'
      : state === 'in_review'
      ? 'bg-amber-500'
      : 'bg-neutral-300'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} mt-1.5`} />
}

function StateBadge({ state }: { state: ApprovalState }) {
  if (state === 'approved') {
    // Item 3 of the post-sale dogfood pass: emphasise that the value is
    // final unless a CO touches it. Once a CO approves with a different
    // value, applyApprovedCo bumps the rev and resets state to pending,
    // at which point this badge naturally falls through to "Pending".
    return (
      <span className="text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 inline-flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Approved · locked
      </span>
    )
  }
  const label = state === 'in_review' ? 'In review' : 'Pending'
  const cls =
    state === 'in_review'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-neutral-100 text-neutral-600 border-neutral-200'
  return <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>{label}</span>
}

function BallChip({ party, tone, days }: { party: BallInCourt; tone: 'neutral' | 'warning' | 'red'; days: number }) {
  const cls =
    tone === 'red'
      ? 'bg-red-50 text-red-700 border-red-200'
      : tone === 'warning'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-neutral-50 text-neutral-600 border-neutral-200'
  const label = party === 'client' ? 'with client' : party === 'shop' ? 'with shop' : 'with vendor'
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cls} inline-flex items-center gap-1`}>
      <Clock className="w-3 h-3" />
      {label} · {days}d
    </span>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-800 mt-0.5">{value}</div>
    </div>
  )
}

function CustomBaselineSummary({ item }: { item: ApprovalItem }) {
  const totalLaborHours =
    (item.custom_labor_hours_eng || 0) +
    (item.custom_labor_hours_cnc || 0) +
    (item.custom_labor_hours_assembly || 0) +
    (item.custom_labor_hours_finish || 0) +
    (item.custom_labor_hours_install || 0)
  const hasBaseline =
    item.custom_material_cost_per_lf != null || totalLaborHours > 0

  if (!hasBaseline) {
    return (
      <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
        Custom spec has no pricing baseline. CO repricing on this spec will require manual entry.
      </div>
    )
  }
  return (
    <div className="mt-3 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded px-2 py-1.5">
      Custom baseline: ${item.custom_material_cost_per_lf ?? 0}/LF · {totalLaborHours.toFixed(1)}h labor
    </div>
  )
}

// AddCustomSlotModal + LinkSlotModal + LabelInput + NumField removed in
// the post-sale dogfood pass. Custom-spec creation and slot-linking were
// content mutations that don't fit a locked, post-sold estimate; the path
// to add or alter a spec post-sale is a CO authored on a line. The
// underlying lib helpers (createCustomSlot, linkSlot, unlinkSlot,
// loadLinkSuggestionsForLabel) are kept in lib/approvals.ts for now and
// flagged for deletion in a follow-up.

// ── Helpers ──

function sourceLabel(item: ApprovalItem): React.ReactNode {
  if (item.linked_to_item_id) {
    return <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> linked spec</span>
  }
  if (item.is_custom) return 'custom spec'
  if (item.source_estimate_line_id) {
    return <>↳ from estimate line</>
  }
  return 'manual add'
}

function stateBorderClass(state: ApprovalState): string {
  if (state === 'approved') return 'border-emerald-200'
  if (state === 'in_review') return 'border-amber-200'
  return 'border-neutral-200'
}

function actionLabel(action: string): string {
  switch (action) {
    case 'submitted':
      return 'Sample submitted'
    case 'client_requested_change':
      return 'Client requested change'
    case 'approved':
      return 'Approved'
    case 'material_changed':
      return 'Material changed — reopened'
    default:
      return action
  }
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

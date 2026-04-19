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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, Send, RotateCcw, Link2, Link2Off, Plus, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react'
import {
  ApprovalItem,
  ApprovalState,
  BallInCourt,
  approve,
  ballChipTone,
  changeMaterial,
  createCustomSlot,
  daysSinceStateChange,
  linkSlot,
  loadApprovalItemsForSubproject,
  loadLinkSuggestionsForLabel,
  requestChange,
  revNumber,
  submitSample,
  unlinkSlot,
} from '@/lib/approvals'

interface Props {
  subprojectId: string
  projectId: string
  /** Optional, used as actor_user_id on item_revisions rows. */
  actorUserId?: string
}

export default function ApprovalSlots({ subprojectId, projectId, actorUserId }: Props) {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [linkingItemId, setLinkingItemId] = useState<string | null>(null)

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
    } catch (err) {
      console.error(err)
      alert('Failed to update slot. See console.')
    } finally {
      setBusyItemId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading approvals…</div>
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-neutral-700">
          Approval items
          <span className="ml-2 text-neutral-500 font-normal">
            {approvedCount} of {items.length} approved
          </span>
          {items.length > 0 && (
            <span className="ml-2 text-neutral-400 font-normal">· pulled from estimate callouts</span>
          )}
        </div>
        <button
          onClick={() => setShowAddCustom(true)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700"
        >
          <Plus className="w-3 h-3" />
          Add custom slot
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded p-4">
          No approval slots yet. Slots are created from estimate-line callouts when a subproject is marked sold.
        </div>
      )}

      {/* Slot list */}
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
          onChangeMaterial={() => runTransition(changeMaterial, item.id)}
          onStartLink={() => setLinkingItemId(item.id)}
          onUnlink={async () => {
            setBusyItemId(item.id)
            try {
              await unlinkSlot(item.id)
              await reload()
            } finally {
              setBusyItemId(null)
            }
          }}
        />
      ))}

      {/* Custom-slot creation modal */}
      {showAddCustom && (
        <AddCustomSlotModal
          subprojectId={subprojectId}
          onClose={() => setShowAddCustom(false)}
          onCreated={async () => {
            setShowAddCustom(false)
            await reload()
          }}
        />
      )}

      {/* Link-suggestion modal */}
      {linkingItemId && (
        <LinkSlotModal
          item={items.find((i) => i.id === linkingItemId)!}
          projectId={projectId}
          onClose={() => setLinkingItemId(null)}
          onLinked={async () => {
            setLinkingItemId(null)
            await reload()
          }}
        />
      )}
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
  onChangeMaterial: () => void
  onStartLink: () => void
  onUnlink: () => void
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

          {/* Linked-slot indicator */}
          {item.linked_to_item_id && (
            <div className="mt-3 text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700">
              <Link2 className="w-3 h-3" />
              Linked — approval mirrors the source slot
              <button
                onClick={p.onUnlink}
                disabled={p.isBusy}
                className="ml-1 text-blue-900 underline disabled:opacity-40"
              >
                unlink
              </button>
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

          {/* Actions */}
          <div className="mt-3 flex flex-wrap gap-2">
            <SlotActions
              state={item.state}
              isBusy={p.isBusy}
              onSubmit={p.onSubmit}
              onApprove={p.onApprove}
              onRequestChange={p.onRequestChange}
              onChangeMaterial={p.onChangeMaterial}
            />
            {!item.linked_to_item_id && (
              <button
                onClick={p.onStartLink}
                disabled={p.isBusy}
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700 disabled:opacity-40"
              >
                <Link2 className="w-3 h-3" />
                Link to existing slot
              </button>
            )}
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
  onChangeMaterial,
}: {
  state: ApprovalState
  isBusy: boolean
  onSubmit: () => void
  onApprove: () => void
  onRequestChange: () => void
  onChangeMaterial: () => void
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
  // approved
  return (
    <button
      onClick={onChangeMaterial}
      disabled={isBusy}
      className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700 disabled:opacity-40"
    >
      <RotateCcw className="w-3 h-3" />
      Material changed — reopen
    </button>
  )
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
  const label = state === 'in_review' ? 'In review' : state === 'approved' ? 'Approved' : 'Pending'
  const cls =
    state === 'approved'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : state === 'in_review'
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
        Custom slot has no pricing baseline. CO repricing on this slot will require manual entry.
      </div>
    )
  }
  return (
    <div className="mt-3 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded px-2 py-1.5">
      Custom baseline: ${item.custom_material_cost_per_lf ?? 0}/LF · {totalLaborHours.toFixed(1)}h labor
    </div>
  )
}

// ── Custom-slot creation modal ──

function AddCustomSlotModal({
  subprojectId,
  onClose,
  onCreated,
}: {
  subprojectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [label, setLabel] = useState('')
  const [material, setMaterial] = useState('')
  const [finish, setFinish] = useState('')
  const [includeBaseline, setIncludeBaseline] = useState(false)
  const [baseline, setBaseline] = useState({
    material_cost_per_lf: 0,
    labor_hours_eng: 0,
    labor_hours_cnc: 0,
    labor_hours_assembly: 0,
    labor_hours_finish: 0,
    labor_hours_install: 0,
  })
  const [saving, setSaving] = useState(false)

  const canSave = label.trim() && material.trim()

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await createCustomSlot(subprojectId, {
        label: label.trim(),
        material: material.trim(),
        finish: finish.trim() || null,
        baseline: includeBaseline ? baseline : undefined,
      })
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div className="font-medium">Add custom approval slot</div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <LabelInput label="Slot label" placeholder="e.g. metal toe kick" value={label} onChange={setLabel} />
          <LabelInput label="Material" placeholder="e.g. Blackened steel" value={material} onChange={setMaterial} />
          <LabelInput label="Finish (optional)" placeholder="e.g. Clear matte lacquer" value={finish} onChange={setFinish} />

          <label className="flex items-center gap-2 text-sm text-neutral-700 mt-2">
            <input
              type="checkbox"
              checked={includeBaseline}
              onChange={(e) => setIncludeBaseline(e.target.checked)}
            />
            Add pricing baseline (enables CO repricing later)
          </label>
          {includeBaseline && (
            <div className="space-y-2 pt-1">
              <NumField label="Material cost per LF" value={baseline.material_cost_per_lf} onChange={(v) => setBaseline({ ...baseline, material_cost_per_lf: v })} />
              <div className="grid grid-cols-5 gap-2">
                <NumField compact label="Eng" value={baseline.labor_hours_eng} onChange={(v) => setBaseline({ ...baseline, labor_hours_eng: v })} />
                <NumField compact label="CNC" value={baseline.labor_hours_cnc} onChange={(v) => setBaseline({ ...baseline, labor_hours_cnc: v })} />
                <NumField compact label="Assy" value={baseline.labor_hours_assembly} onChange={(v) => setBaseline({ ...baseline, labor_hours_assembly: v })} />
                <NumField compact label="Fin" value={baseline.labor_hours_finish} onChange={(v) => setBaseline({ ...baseline, labor_hours_finish: v })} />
                <NumField compact label="Inst" value={baseline.labor_hours_install} onChange={(v) => setBaseline({ ...baseline, labor_hours_install: v })} />
              </div>
            </div>
          )}
        </div>
        <div className="p-3 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-700">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave || saving}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Add slot'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LabelInput({ label, placeholder, value, onChange }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">{label}</div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
      />
    </div>
  )
}

function NumField({ label, value, onChange, compact }: { label: string; value: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wide text-neutral-500 ${compact ? '' : 'mb-1'}`}>{label}</div>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
      />
    </div>
  )
}

// ── Link modal ──

function LinkSlotModal({
  item,
  projectId,
  onClose,
  onLinked,
}: {
  item: ApprovalItem
  projectId: string
  onClose: () => void
  onLinked: () => void
}) {
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof loadLinkSuggestionsForLabel>>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadLinkSuggestionsForLabel(projectId, item.label, item.id).then((s) => {
      setSuggestions(s)
      setLoading(false)
    })
  }, [projectId, item.label, item.id])

  const doLink = async (targetId: string) => {
    setSaving(true)
    try {
      await linkSlot(item.id, targetId)
      onLinked()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <div>
            <div className="font-medium">Link "{item.label}"</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              Approval on the target slot will mirror to this one.
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="text-sm text-neutral-500">Searching…</div>
          ) : suggestions.length === 0 ? (
            <div className="text-sm text-neutral-500">
              No other slots on this project share this label.
            </div>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => doLink(s.id)}
                    disabled={saving}
                    className="w-full text-left border border-neutral-200 hover:border-neutral-400 rounded p-2 text-sm disabled:opacity-40"
                  >
                    <div className="font-medium">{s.subproject_name} · {s.label}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">current state: {s.state}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──

function sourceLabel(item: ApprovalItem): React.ReactNode {
  if (item.linked_to_item_id) {
    return <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> linked slot</span>
  }
  if (item.is_custom) return 'custom slot'
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

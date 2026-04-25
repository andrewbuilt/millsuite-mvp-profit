// ============================================================================
// change-orders.tsx — Phase 4 CO panel UI (manual V1)
// ============================================================================
// CO list per project, create modal with line-diff form, state transitions
// (draft → sent → approved/rejected/void), QB handoff marking (D3, default
// separate_invoice, manual). Net_change comes from the cost math in
// lib/change-orders.ts — original and proposed snapshots are stored verbatim
// so reports can reconstruct the diff later.
//
// Not in scope (V1):
//   - Portal signing (Phase 6+)
//   - Auto-email nudges (Phase 6+)
//   - QB API push (Phase 6+)
// ============================================================================

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  Send,
  CheckCircle2,
  XCircle,
  FileText,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Archive,
} from 'lucide-react'
import {
  ChangeOrder,
  CoState,
  LineSnapshot,
  PricingInputs,
  QbHandoffState,
  approveCo,
  computeNetChange,
  createChangeOrder,
  loadChangeOrdersForProject,
  markQbHandoff,
  openCoCount,
  qbReconciliationText,
  rejectCo,
  sendCoToClient,
  sumApprovedNetChange,
  voidCo,
} from '@/lib/change-orders'
import {
  computeBreakdown,
  PREFINISHED_FINISH_ID,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerRateBook,
  type ComposerSlots,
} from '@/lib/composer'
import { type ProductKey } from '@/lib/products'

interface Props {
  projectId: string
  /** Project name, used in the QB reconciliation copy block. */
  projectName?: string
  /** Pricing inputs snapshot from the project's org defaults. */
  pricing: PricingInputs
  /** Subproject list for the "CO against which subproject" picker. */
  subprojects: { id: string; name: string }[]
  /** Called after any CO state change so the parent can refresh its own CO-sum. */
  onChange?: () => void
}

export default function ChangeOrders({ projectId, projectName, pricing, subprojects, onChange }: Props) {
  const [cos, setCos] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [busyCoId, setBusyCoId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // The standalone "+ New CO" trigger has been removed (post-sale dogfood
  // pass): the only path to create a CO is from a subproject line row,
  // which uses the seed-aware CreateCoModal mounted on the subproject page
  // (Issue 21). Top-level free-form creation produced unscoped COs that
  // couldn't be auto-priced.

  // reload() just refetches — it does NOT call onChange. If onChange fired on
  // every reload, any parent that reloads in response (e.g. pre-production
  // uses the CO gate to derive project readiness) would bounce us back into
  // another reload and the whole tree would oscillate indefinitely.
  const reload = useCallback(async () => {
    setLoading(true)
    const next = await loadChangeOrdersForProject(projectId)
    setCos(next)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    reload()
  }, [reload])

  const netApproved = useMemo(() => sumApprovedNetChange(cos), [cos])
  const openCount = useMemo(() => openCoCount(cos), [cos])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // State-changing actions still fan out to the parent — the gate / counts
  // on pre-production care about draft → sent → approved transitions.
  const runTransition = async (fn: (id: string) => Promise<void>, coId: string) => {
    setBusyCoId(coId)
    try {
      await fn(coId)
      await reload()
      onChange?.()
    } catch (err) {
      console.error(err)
      alert('Failed to update CO. See console.')
    } finally {
      setBusyCoId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading change orders…</div>
  }

  return (
    <div className="space-y-3">
      {/* Section header — listing only. Creation lives on the subproject
          line row's CO button (Issue 21). */}
      <div className="text-sm font-medium text-neutral-700">
        Change orders
        <span className="ml-2 text-neutral-500 font-normal">
          {cos.length === 0
            ? 'none yet'
            : `${cos.length} total · ${openCount} open · ${fmtMoney(netApproved)} approved`}
        </span>
      </div>

      {/* Empty state */}
      {cos.length === 0 && (
        <div className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded p-4">
          No change orders yet. Open a subproject and click <b>CO</b> on any
          line row to draft one.
        </div>
      )}

      {/* CO list */}
      {cos.map((co) => (
        <CoCard
          key={co.id}
          co={co}
          projectName={projectName}
          subprojects={subprojects}
          isExpanded={expanded.has(co.id)}
          isBusy={busyCoId === co.id}
          onToggleExpanded={() => toggleExpanded(co.id)}
          onSend={() => runTransition(sendCoToClient, co.id)}
          onApprove={(note) =>
            runTransition(async (id) => approveCo(id, note), co.id)
          }
          onReject={(note) =>
            runTransition(async (id) => rejectCo(id, note), co.id)
          }
          onVoid={() => runTransition(voidCo, co.id)}
          onSetQbHandoff={(state, note) =>
            runTransition(async (id) => markQbHandoff(id, state, note), co.id)
          }
        />
      ))}

      {/* CreateCoModal mount removed — the modal export still ships for
          the line-row CO entry (rendered on the subproject page); this
          panel no longer hosts an unscoped trigger. */}
    </div>
  )
}

// ── CO card ──

interface CoCardProps {
  co: ChangeOrder
  projectName?: string
  subprojects: { id: string; name: string }[]
  isExpanded: boolean
  isBusy: boolean
  onToggleExpanded: () => void
  onSend: () => void
  onApprove: (note?: string) => void
  onReject: (note?: string) => void
  onVoid: () => void
  onSetQbHandoff: (state: QbHandoffState, note?: string) => void
}

function CoCard({
  co,
  projectName,
  subprojects,
  isExpanded,
  isBusy,
  onToggleExpanded,
  onSend,
  onApprove,
  onReject,
  onVoid,
  onSetQbHandoff,
}: CoCardProps) {
  const subName = co.subproject_id
    ? subprojects.find((s) => s.id === co.subproject_id)?.name
    : null

  return (
    <div className={`border rounded ${coBorderClass(co.state)}`}>
      <button
        onClick={onToggleExpanded}
        className="w-full px-4 py-3 flex items-start justify-between gap-3 hover:bg-neutral-50 text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-neutral-500 flex-shrink-0" />
            <div className="font-medium text-sm truncate">{co.title}</div>
            <CoStateBadge state={co.state} />
            {co.no_price_change && (
              <span className="text-[10px] uppercase tracking-wider text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">
                No $ change
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
            {subName && <span>{subName}</span>}
            <span>{fmtDate(co.created_at)}</span>
            <QbHandoffChip state={co.qb_handoff_state} />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div
            className={`text-sm font-mono tabular-nums font-semibold ${
              co.net_change > 0
                ? 'text-emerald-700'
                : co.net_change < 0
                ? 'text-rose-700'
                : 'text-neutral-500'
            }`}
          >
            {co.net_change > 0 ? '+' : ''}
            {fmtMoney(co.net_change)}
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-neutral-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-neutral-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-neutral-200 px-4 py-3 space-y-3">
          {/* Original vs proposed diff */}
          <div className="grid grid-cols-2 gap-3">
            <SnapshotBlock title="Original" snap={co.original_line_snapshot} />
            <SnapshotBlock title="Proposed" snap={co.proposed_line} highlight />
          </div>

          {/* Client response note */}
          {co.client_response_note && (
            <div className="bg-neutral-50 rounded px-3 py-2 text-xs">
              <span className="font-medium">Client response:</span> {co.client_response_note}
            </div>
          )}

          {/* State transition buttons */}
          <CoActions
            state={co.state}
            isBusy={isBusy}
            onSend={onSend}
            onApprove={onApprove}
            onReject={onReject}
            onVoid={onVoid}
          />

          {/* QB reconciliation copy block — Phase 7 D3 (plain English, copyable) */}
          {co.state === 'approved' && (
            <QbReconciliationBlock
              co={co}
              projectName={projectName}
              subprojectName={subName}
            />
          )}

          {/* QB handoff section */}
          {co.state === 'approved' && (
            <QbHandoffControls co={co} isBusy={isBusy} onSet={onSetQbHandoff} />
          )}
        </div>
      )}
    </div>
  )
}

function SnapshotBlock({
  title,
  snap,
  highlight,
}: {
  title: string
  snap: LineSnapshot
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded border px-3 py-2 ${
        highlight ? 'bg-blue-50 border-blue-200' : 'bg-neutral-50 border-neutral-200'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{title}</div>
      {snap.label && <div className="text-xs font-medium">{snap.label}</div>}
      {(snap.material || snap.finish) && (
        <div className="text-xs text-neutral-700 mt-0.5">
          {[snap.material, snap.finish].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="text-[11px] text-neutral-600 mt-1 space-y-0.5">
        {snap.linear_feet != null && <div>{snap.linear_feet} LF</div>}
        {snap.material_cost_per_lf != null && (
          <div>${Number(snap.material_cost_per_lf).toFixed(2)}/LF material</div>
        )}
        {snap.is_custom && <div className="text-amber-700">Custom slot</div>}
      </div>
      {snap.notes && <div className="text-[11px] text-neutral-600 mt-1 italic">{snap.notes}</div>}
    </div>
  )
}

// ── Action buttons per state ──

interface CoActionsProps {
  state: CoState
  isBusy: boolean
  onSend: () => void
  onApprove: (note?: string) => void
  onReject: (note?: string) => void
  onVoid: () => void
}

function CoActions({ state, isBusy, onSend, onApprove, onReject, onVoid }: CoActionsProps) {
  if (state === 'draft') {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          disabled={isBusy}
          onClick={onSend}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          <Send className="w-3 h-3" /> Send to client
        </button>
        <button
          disabled={isBusy}
          onClick={onVoid}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          <Archive className="w-3 h-3" /> Void
        </button>
      </div>
    )
  }
  if (state === 'sent_to_client') {
    return (
      <ApprovalControls isBusy={isBusy} onApprove={onApprove} onReject={onReject} />
    )
  }
  return null
}

function ApprovalControls({
  isBusy,
  onApprove,
  onReject,
}: {
  isBusy: boolean
  onApprove: (note?: string) => void
  onReject: (note?: string) => void
}) {
  const [note, setNote] = useState('')
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Client response note (optional, e.g. 'Approved via email 4/22')"
        className="w-full text-xs border border-neutral-300 rounded px-2 py-1.5"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={isBusy}
          onClick={() => onApprove(note || undefined)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 className="w-3 h-3" /> Client approved
        </button>
        <button
          disabled={isBusy}
          onClick={() => onReject(note || undefined)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          <XCircle className="w-3 h-3" /> Client rejected
        </button>
      </div>
    </div>
  )
}

// ── QB handoff controls (D3) ──

function QbHandoffControls({
  co,
  isBusy,
  onSet,
}: {
  co: ChangeOrder
  isBusy: boolean
  onSet: (state: QbHandoffState, note?: string) => void
}) {
  const [note, setNote] = useState(co.qb_handoff_note || '')

  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded px-3 py-2 space-y-2">
      <div className="flex items-center gap-1 text-xs font-medium text-neutral-700">
        <DollarSign className="w-3 h-3" /> QuickBooks handoff
      </div>
      <div className="flex flex-wrap gap-1">
        {(
          [
            { key: 'not_yet', label: 'Not yet' },
            { key: 'separate_invoice', label: 'Separate invoice' },
            { key: 'invoice_edited', label: 'Edited existing invoice' },
            { key: 'not_applicable', label: 'N/A' },
          ] as { key: QbHandoffState; label: string }[]
        ).map((opt) => {
          const active = co.qb_handoff_state === opt.key
          return (
            <button
              key={opt.key}
              disabled={isBusy}
              onClick={() => onSet(opt.key, note || undefined)}
              className={`text-[11px] px-2 py-1 rounded border disabled:opacity-50 ${
                active
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== (co.qb_handoff_note || '')) {
            onSet(co.qb_handoff_state, note || undefined)
          }
        }}
        placeholder="Handoff note (e.g. 'Added to invoice #1234 on 4/22')"
        className="w-full text-xs border border-neutral-300 rounded px-2 py-1.5"
      />
    </div>
  )
}

function QbReconciliationBlock({
  co,
  projectName,
  subprojectName,
}: {
  co: ChangeOrder
  projectName?: string
  subprojectName: string | null | undefined
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const text = useMemo(
    () => qbReconciliationText(co, { projectName, subprojectName }),
    [co, projectName, subprojectName]
  )
  const onCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2400)
    } catch (e) {
      console.error(e)
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2400)
    }
  }
  return (
    <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-blue-800">
          QuickBooks reconciliation note
        </div>
        <button
          onClick={onCopy}
          className={`text-[11px] px-2 py-1 rounded border ${
            copyState === 'copied'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : copyState === 'error'
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white text-blue-800 border-blue-300 hover:border-blue-500'
          }`}
        >
          {copyState === 'copied' ? 'Copied ✓' : copyState === 'error' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] text-neutral-800 whitespace-pre-wrap font-mono leading-snug">
        {text}
      </pre>
    </div>
  )
}

function QbHandoffChip({ state }: { state: QbHandoffState }) {
  const label =
    state === 'not_yet'
      ? 'QB: not yet'
      : state === 'separate_invoice'
      ? 'QB: separate invoice'
      : state === 'invoice_edited'
      ? 'QB: invoice edited'
      : 'QB: N/A'
  const tone = state === 'not_yet' ? 'text-amber-700' : 'text-neutral-500'
  return <span className={`text-[10px] ${tone}`}>{label}</span>
}

// ── State badges + helpers ──

function CoStateBadge({ state }: { state: CoState }) {
  const map: Record<CoState, string> = {
    draft: 'bg-neutral-200 text-neutral-700',
    sent_to_client: 'bg-amber-100 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
    void: 'bg-neutral-100 text-neutral-500',
  }
  return (
    <span
      className={`text-[10px] uppercase tracking-wider rounded font-medium px-1.5 py-0.5 ${map[state]}`}
    >
      {state.replace('_', ' ')}
    </span>
  )
}

function coBorderClass(state: CoState): string {
  if (state === 'approved') return 'border-emerald-300'
  if (state === 'rejected') return 'border-rose-300'
  if (state === 'sent_to_client') return 'border-amber-300'
  if (state === 'void') return 'border-neutral-200 opacity-60'
  return 'border-neutral-300'
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return n < 0 ? `-$${abs}` : `$${abs}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Create CO modal ──

/** Seed for "Create CO from a line" — opens the modal pre-populated
 *  with the source line's identity + product slots. Issue 21 reshapes
 *  this from a flat material-swap form into a slot-aware editor: the
 *  operator picks WHICH slot is changing (qty / carcass material /
 *  door style / etc.) and only fills in the proposed value for that
 *  slot. Net change is recomputed via composer math.
 *  When null/undefined, the modal opens in legacy mode with the
 *  title required + the subproject picker + free-form fields. */
export interface CreateCoModalSeed {
  subprojectId: string
  subprojectName: string
  lineId: string
  productKey: ProductKey
  productSlots: ComposerSlots
  qty: number
  /** "Base cabinet" / "Upper cabinet" / "Full height" for the modal
   *  header. */
  productLabel: string
  /** The line's display description, used in the modal header AND as
   *  the snapshot label so the CO list reads cleanly. */
  description: string
}

/** Slot keys an operator can target in a slot-aware CO. Mirrors
 *  ComposerSlots minus `notes` (notes can't be a CO target). */
type SlotKey =
  | 'qty'
  | 'carcassMaterial'
  | 'doorStyle'
  | 'doorMaterial'
  | 'interiorFinish'
  | 'exteriorFinish'
  | 'endPanels'
  | 'fillers'

const SLOT_LABELS: Record<SlotKey, string> = {
  qty: 'Quantity (LF)',
  carcassMaterial: 'Carcass material',
  doorStyle: 'Door style',
  doorMaterial: 'Door/drawer material',
  interiorFinish: 'Interior finish',
  exteriorFinish: 'Exterior finish',
  endPanels: 'End panels (count)',
  fillers: 'Fillers (count)',
}

interface CreateCoModalProps {
  projectId: string
  pricing: PricingInputs
  subprojects: { id: string; name: string }[]
  /** When provided, the modal opens in line-seeded slot-aware mode.
   *  Requires composerRateBook + composerDefaults to be passed too —
   *  the modal recomputes the net change via composer math. */
  seed?: CreateCoModalSeed | null
  /** Required when seed is non-null. */
  composerRateBook?: ComposerRateBook | null
  composerDefaults?: ComposerDefaults | null
  onClose: () => void
  onCreated: () => Promise<void>
}

export function CreateCoModal({
  projectId,
  pricing,
  subprojects,
  seed,
  composerRateBook,
  composerDefaults,
  onClose,
  onCreated,
}: CreateCoModalProps) {
  const isSeeded = !!seed && !!composerRateBook && !!composerDefaults
  if (isSeeded) {
    return (
      <SeededSlotCoEditor
        projectId={projectId}
        seed={seed!}
        rateBook={composerRateBook!}
        defaults={composerDefaults!}
        onClose={onClose}
        onCreated={onCreated}
      />
    )
  }
  return (
    <LegacyCoEditor
      projectId={projectId}
      pricing={pricing}
      subprojects={subprojects}
      onClose={onClose}
      onCreated={onCreated}
    />
  )
}

// ── Legacy free-form CO editor (top-level "+ New CO" button) ──

function LegacyCoEditor({
  projectId,
  pricing,
  subprojects,
  onClose,
  onCreated,
}: {
  projectId: string
  pricing: PricingInputs
  subprojects: { id: string; name: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [subprojectId, setSubprojectId] = useState<string>(
    subprojects[0]?.id || '',
  )
  const [noPriceChange, setNoPriceChange] = useState(false)
  const [manualNet, setManualNet] = useState<string>('')

  const [origLabel, setOrigLabel] = useState('')
  const [origMaterial, setOrigMaterial] = useState('')
  const [origLF, setOrigLF] = useState<string>('')
  const [origMatCostLF, setOrigMatCostLF] = useState<string>('')

  const [propMaterial, setPropMaterial] = useState('')
  const [propLF, setPropLF] = useState<string>('')
  const [propMatCostLF, setPropMatCostLF] = useState<string>('')

  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // V1 scope: simple material-swap CO. Labor hours come across at zero delta
  // by default; user can add them into manualNet if labor shifts materially.
  // This keeps the modal small. Estimate-line-integrated repricing comes
  // through the approval slot "material changed" flow (follow-up).
  const origSnap: LineSnapshot = {
    label: origLabel || title,
    material: origMaterial,
    linear_feet: origLF ? Number(origLF) : null,
    material_cost_per_lf: origMatCostLF ? Number(origMatCostLF) : null,
    labor_hours_eng: 0,
    labor_hours_cnc: 0,
    labor_hours_assembly: 0,
    labor_hours_finish: 0,
    labor_hours_install: 0,
  }
  const propSnap: LineSnapshot = {
    label: origLabel || title,
    material: propMaterial,
    linear_feet: propLF ? Number(propLF) : origLF ? Number(origLF) : null,
    material_cost_per_lf: propMatCostLF ? Number(propMatCostLF) : null,
    labor_hours_eng: 0,
    labor_hours_cnc: 0,
    labor_hours_assembly: 0,
    labor_hours_finish: 0,
    labor_hours_install: 0,
    notes: notes || undefined,
  }

  const computed = noPriceChange
    ? 0
    : manualNet
    ? Number(manualNet)
    : computeNetChange(origSnap, propSnap, pricing)

  const canSave = title.trim().length > 0 && computed !== null && !saving

  const save = async () => {
    if (!canSave || computed === null) return
    setSaving(true)
    try {
      const result = await createChangeOrder({
        project_id: projectId,
        subproject_id: subprojectId || null,
        title: title.trim(),
        original_line_snapshot: origSnap,
        proposed_line: propSnap,
        net_change: computed,
        no_price_change: noPriceChange,
      })
      if (!result) {
        alert('Failed to create CO. See console.')
        return
      }
      await onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 sticky top-0 bg-white">
          <div className="font-medium text-sm">New change order</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-700 block mb-1">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Island cabinet material change, walnut to white oak"
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          </div>

          {subprojects.length > 1 && (
            <div>
              <label className="text-xs font-medium text-neutral-700 block mb-1">Subproject</label>
              <select
                value={subprojectId}
                onChange={(e) => setSubprojectId(e.target.value)}
                className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
              >
                <option value="">Project-level (no subproject)</option>
                {subprojects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={noPriceChange}
              onChange={(e) => setNoPriceChange(e.target.checked)}
            />
            No price change (documentation-only)
          </label>

          {!noPriceChange && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                    Original
                  </div>
                  <input
                    type="text"
                    value={origLabel}
                    onChange={(e) => setOrigLabel(e.target.value)}
                    placeholder="Label (e.g. Cabinet faces)"
                    className="w-full border border-neutral-300 rounded px-2 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={origMaterial}
                    onChange={(e) => setOrigMaterial(e.target.value)}
                    placeholder="Material (e.g. Walnut slab)"
                    className="w-full border border-neutral-300 rounded px-2 py-1.5 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={origLF}
                      onChange={(e) => setOrigLF(e.target.value)}
                      placeholder="LF"
                      className="flex-1 border border-neutral-300 rounded px-2 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      value={origMatCostLF}
                      onChange={(e) => setOrigMatCostLF(e.target.value)}
                      placeholder="$/LF"
                      className="flex-1 border border-neutral-300 rounded px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-blue-600">
                    Proposed
                  </div>
                  <div className="text-xs text-neutral-400 px-2 py-1.5 border border-dashed border-neutral-200 rounded">
                    (same label)
                  </div>
                  <input
                    type="text"
                    value={propMaterial}
                    onChange={(e) => setPropMaterial(e.target.value)}
                    placeholder="Material (e.g. White oak rift)"
                    className="w-full border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={propLF}
                      onChange={(e) => setPropLF(e.target.value)}
                      placeholder={origLF || 'LF'}
                      className="flex-1 border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      value={propMatCostLF}
                      onChange={(e) => setPropMatCostLF(e.target.value)}
                      placeholder="$/LF"
                      className="flex-1 border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-neutral-700 block mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Context for the client or future-you…"
                  className="w-full border border-neutral-300 rounded px-2 py-1.5 text-xs"
                />
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Net change
                </div>
                {computed === null ? (
                  <div className="text-xs text-amber-700">
                    Not enough info to auto-price. Enter a manual amount:
                    <input
                      type="number"
                      value={manualNet}
                      onChange={(e) => setManualNet(e.target.value)}
                      placeholder="0"
                      className="ml-2 w-28 border border-neutral-300 rounded px-2 py-1 text-xs"
                    />
                  </div>
                ) : (
                  <div
                    className={`text-sm font-mono tabular-nums font-semibold ${
                      computed > 0
                        ? 'text-emerald-700'
                        : computed < 0
                        ? 'text-rose-700'
                        : 'text-neutral-700'
                    }`}
                  >
                    {computed > 0 ? '+' : ''}
                    {fmtMoney(computed)}
                    <span className="ml-2 text-[10px] text-neutral-500 font-normal">
                      incl. {pricing.consumableMarkupPct}% consumables,{' '}
                      {pricing.profitMarginPct}% margin
                    </span>
                  </div>
                )}
                <label className="flex items-center gap-2 text-[11px] text-neutral-600 mt-2">
                  <input
                    type="checkbox"
                    checked={manualNet !== ''}
                    onChange={(e) => {
                      if (!e.target.checked) setManualNet('')
                      else setManualNet(String(computed ?? 0))
                    }}
                  />
                  Override with manual amount
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="text-xs px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create as draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Seeded slot-aware CO editor (line click → "Create CO") ──
//
// Operator picks ONE slot to change on the source line. The modal
// recomputes the line's price via composer math (computeBreakdown) for
// both the original and the proposed slot value, and the net change is
// the delta of the two line totals. The change_orders schema doesn't
// know about slots; we flatten the slot detail into the existing
// LineSnapshot.material text field for display.

function SeededSlotCoEditor({
  projectId,
  seed,
  rateBook,
  defaults,
  onClose,
  onCreated,
}: {
  projectId: string
  seed: CreateCoModalSeed
  rateBook: ComposerRateBook
  defaults: ComposerDefaults
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [slotKey, setSlotKey] = useState<SlotKey | ''>('')
  // proposedValue holds whatever the right input is currently typing /
  // selecting. For dropdown slots: the picked option's id (or
  // PREFINISHED_FINISH_ID for the sentinel). For numeric slots: the
  // raw string from the input.
  const [proposedValue, setProposedValue] = useState<string>('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [noPriceChange, setNoPriceChange] = useState(false)
  const [saving, setSaving] = useState(false)

  // Drafts.
  const originalDraft: ComposerDraft = useMemo(
    () => ({
      productId: seed.productKey,
      qty: seed.qty,
      slots: seed.productSlots,
    }),
    [seed],
  )
  const proposedDraft: ComposerDraft | null = useMemo(() => {
    if (!slotKey || proposedValue === '') return null
    if (slotKey === 'qty') {
      const n = Number(proposedValue)
      if (!Number.isFinite(n) || n <= 0) return null
      return { ...originalDraft, qty: n }
    }
    if (slotKey === 'endPanels' || slotKey === 'fillers') {
      const n = Number(proposedValue)
      if (!Number.isFinite(n) || n < 0) return null
      return {
        ...originalDraft,
        slots: { ...originalDraft.slots, [slotKey]: Math.round(n) },
      }
    }
    return {
      ...originalDraft,
      slots: { ...originalDraft.slots, [slotKey]: proposedValue },
    }
  }, [slotKey, proposedValue, originalDraft])

  const originalBreakdown = useMemo(
    () => computeBreakdown(originalDraft, rateBook, defaults),
    [originalDraft, rateBook, defaults],
  )
  const proposedBreakdown = useMemo(
    () =>
      proposedDraft ? computeBreakdown(proposedDraft, rateBook, defaults) : null,
    [proposedDraft, rateBook, defaults],
  )
  const netChange = noPriceChange
    ? 0
    : proposedBreakdown
      ? proposedBreakdown.totals.total - originalBreakdown.totals.total
      : null

  // Display labels for the picked slot's original + proposed values.
  const origValueLabel = slotKey ? slotValueLabel(slotKey, seed.productSlots, seed.qty, rateBook) : ''
  const propValueLabel =
    slotKey && proposedDraft
      ? slotValueLabel(slotKey, proposedDraft.slots, proposedDraft.qty, rateBook)
      : ''

  const derivedTitle =
    slotKey && propValueLabel
      ? `${SLOT_LABELS[slotKey]}: ${origValueLabel} → ${propValueLabel}`
      : ''
  const effectiveTitle = title.trim() || derivedTitle

  const canSave =
    !!slotKey &&
    !!proposedDraft &&
    netChange !== null &&
    !!effectiveTitle &&
    !saving

  const save = async () => {
    if (!canSave || netChange === null || !proposedDraft || !slotKey) return
    setSaving(true)
    try {
      const slotLabel = SLOT_LABELS[slotKey]
      const origSnap: LineSnapshot = {
        label: seed.description,
        material: `${slotLabel}: ${origValueLabel}`,
        linear_feet: seed.qty,
        material_cost_per_lf: null,
        labor_hours_eng: 0,
        labor_hours_cnc: 0,
        labor_hours_assembly: 0,
        labor_hours_finish: 0,
        labor_hours_install: 0,
      }
      const propSnap: LineSnapshot = {
        label: seed.description,
        material: `${slotLabel}: ${propValueLabel}`,
        linear_feet: proposedDraft.qty,
        material_cost_per_lf: null,
        labor_hours_eng: 0,
        labor_hours_cnc: 0,
        labor_hours_assembly: 0,
        labor_hours_finish: 0,
        labor_hours_install: 0,
        notes: notes || undefined,
      }
      const result = await createChangeOrder({
        project_id: projectId,
        subproject_id: seed.subprojectId,
        title: effectiveTitle,
        original_line_snapshot: origSnap,
        proposed_line: propSnap,
        net_change: netChange,
        no_price_change: noPriceChange,
      })
      if (!result) {
        alert('Failed to create CO. See console.')
        return
      }
      await onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 sticky top-0 bg-white">
          <div className="font-medium text-sm">New change order</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Header — line context. */}
          <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">
              Change order on
            </div>
            <div className="font-medium text-neutral-900">
              {seed.productLabel} · {seed.qty} LF
            </div>
            <div className="text-neutral-600 mt-0.5">{seed.description}</div>
            <div className="text-[10.5px] text-neutral-500 mt-1">
              Subproject: {seed.subprojectName}
            </div>
          </div>

          {/* Slot picker. */}
          <div>
            <label className="text-xs font-medium text-neutral-700 block mb-1">
              What's changing? <span className="text-red-600">*</span>
            </label>
            <select
              value={slotKey}
              onChange={(e) => {
                setSlotKey(e.target.value as SlotKey | '')
                setProposedValue('')
              }}
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
              autoFocus
            >
              <option value="">Pick a slot…</option>
              {(Object.keys(SLOT_LABELS) as SlotKey[]).map((k) => (
                <option key={k} value={k}>
                  {SLOT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {slotKey && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Original
                </div>
                <div className="px-2 py-1.5 bg-neutral-50 border border-neutral-200 rounded text-xs text-neutral-900">
                  {origValueLabel || '(none)'}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-blue-600">
                  Proposed
                </div>
                <ProposedSlotInput
                  slotKey={slotKey}
                  value={proposedValue}
                  rateBook={rateBook}
                  onChange={setProposedValue}
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-700 block mb-1">
              Title <span className="text-neutral-400">(auto-generated)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={derivedTitle || 'Pick a slot first'}
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={noPriceChange}
              onChange={(e) => setNoPriceChange(e.target.checked)}
            />
            No price change (documentation-only)
          </label>

          {!noPriceChange && (
            <div>
              <label className="text-xs font-medium text-neutral-700 block mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Context for the client or future-you…"
                className="w-full border border-neutral-300 rounded px-2 py-1.5 text-xs"
              />
            </div>
          )}

          {!noPriceChange && (
            <div className="bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                Net change
              </div>
              {netChange === null ? (
                <div className="text-xs text-neutral-500 italic">
                  Pick a proposed value to see the price delta.
                </div>
              ) : (
                <div
                  className={`text-sm font-mono tabular-nums font-semibold ${
                    netChange > 0
                      ? 'text-emerald-700'
                      : netChange < 0
                        ? 'text-rose-700'
                        : 'text-neutral-700'
                  }`}
                >
                  {netChange > 0 ? '+' : ''}
                  {fmtMoney(netChange)}
                  <span className="ml-2 text-[10px] text-neutral-500 font-normal">
                    via composer math
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="text-xs px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create as draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Resolve a slot's current value into a human-readable label for the
// modal's "Original" panel + auto-title.
function slotValueLabel(
  slotKey: SlotKey,
  slots: ComposerSlots,
  qty: number,
  rb: ComposerRateBook,
): string {
  switch (slotKey) {
    case 'qty':
      return `${qty} LF`
    case 'carcassMaterial':
      return rb.carcassMaterials.find((m) => m.id === slots.carcassMaterial)?.name || '(none)'
    case 'doorStyle':
      return rb.doorStyles.find((d) => d.id === slots.doorStyle)?.name || '(none)'
    case 'doorMaterial':
      return rb.extMaterials.find((m) => m.id === slots.doorMaterial)?.name || '(none)'
    case 'interiorFinish':
      if (slots.interiorFinish === PREFINISHED_FINISH_ID) return 'Prefinished'
      return rb.finishes.find((f) => f.id === slots.interiorFinish)?.name || '(none)'
    case 'exteriorFinish':
      return rb.finishes.find((f) => f.id === slots.exteriorFinish)?.name || '(none)'
    case 'endPanels':
      return `${slots.endPanels} each`
    case 'fillers':
      return `${slots.fillers} each`
  }
}

function ProposedSlotInput({
  slotKey,
  value,
  rateBook,
  onChange,
}: {
  slotKey: SlotKey
  value: string
  rateBook: ComposerRateBook
  onChange: (v: string) => void
}) {
  if (slotKey === 'qty') {
    return (
      <input
        type="number"
        min="0"
        step="0.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="LF"
        className="w-full border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
        autoFocus
      />
    )
  }
  if (slotKey === 'endPanels' || slotKey === 'fillers') {
    return (
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="each"
        className="w-full border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
        autoFocus
      />
    )
  }
  // Dropdown slots.
  let options: Array<{ id: string; name: string }> = []
  if (slotKey === 'carcassMaterial') {
    options = rateBook.carcassMaterials.map((m) => ({ id: m.id, name: m.name }))
  } else if (slotKey === 'doorStyle') {
    options = rateBook.doorStyles.map((d) => ({ id: d.id, name: d.name }))
  } else if (slotKey === 'doorMaterial') {
    options = rateBook.extMaterials.map((m) => ({ id: m.id, name: m.name }))
  } else if (slotKey === 'interiorFinish') {
    options = rateBook.finishes
      .filter((f) => f.application === 'interior')
      .map((f) => ({ id: f.id, name: f.name }))
  } else if (slotKey === 'exteriorFinish') {
    options = rateBook.finishes
      .filter((f) => f.application === 'exterior')
      .map((f) => ({ id: f.id, name: f.name }))
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-blue-200 bg-blue-50 rounded px-2 py-1.5 text-xs"
      autoFocus
    >
      <option value="">Pick…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  )
}

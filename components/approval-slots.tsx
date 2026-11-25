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

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Send, RotateCcw, Link2, Lock, ChevronDown, ChevronUp, Pencil, Trash2, Plus, ExternalLink, X } from 'lucide-react'
import { ITEM_KINDS, KIND_LABEL, groupByKind, guessItemKind, normalizeItemKind, safeHttpUrl, shortLinkLabel, type ItemKind } from '@/lib/approval-kind'
import { deleteApprovalPhoto, listApprovalPhotos, uploadApprovalPhoto, type ApprovalPhoto } from '@/lib/preapproval-admin'
import { useConfirm } from '@/components/confirm-dialog'
import { announce, type TourEvent } from '@/lib/tour-events'
import {
  ApprovalItem,
  ApprovalState,
  BallInCourt,
  approve,
  unapprove,
  ballChipTone,
  createCustomSlot,
  daysSinceStateChange,
  dismissApprovalCallout,
  loadApprovalItemsForSubproject,
  updateApprovalCallout,
  requestChange,
  revNumber,
  submitSample,
} from '@/lib/approvals'

interface Props {
  subprojectId: string
  /** Optional, used as actor_user_id on item_revisions rows. */
  actorUserId?: string
  /** Called after every successful state mutation (approve / reject /
   *  submit / change-material). Lets the parent re-fetch project-wide
   *  data sourced elsewhere — subproject_approval_status view counts,
   *  the ready-for-scheduling header, the right-rail aggregate. Without
   *  this, local approve clicks updated the slot card but left the
   *  header / counts stale until a manual reload. */
  onChange?: () => void
  /** Spec-CO redesign (post-sale dogfood pass): clicking "+ CO" on a
   *  spec card calls this with the approval_item id. The parent
   *  (pre-prod page) resolves the underlying composer line, builds a
   *  CreateCoModalSeed with source='spec' + preSelectedSlot, and mounts
   *  the modal. Buttons hide entirely when this prop isn't provided. */
  onCreateSpecCo?: (approvalItemId: string) => void
  /** data-tour hook for the WHOLE spec list. Passed by the pre-prod page for
   *  its first subproject alone (one tag per value, always). The list, not a
   *  card: cards change position and expand/collapse as states move, so a
   *  ring on one card ends up pointing at the wrong thing mid-flow. */
  tourTag?: string
  /** Approval-item id the parent wants opened — set when the pre-production
   *  punch list is clicked, so the operator lands on the slot already
   *  expanded instead of scrolled near a collapsed row. Additive: it expands
   *  the card, it never collapses anything the operator opened themselves. */
  focusItemId?: string | null
  /** Drop the component's own "Specs · N of M approved" line. The
   *  pre-production card already prints an APPROVALS column head and a
   *  "4 / 6 approved" badge, so rendering it here too stacked two headings
   *  on top of each other. */
  hideHeader?: boolean
}

/** Map an approval_items.label to the composer slot key the spec drives.
 *  Spec labels come from proposeSlotsFromComposerLine in lib/approvals.ts.
 *  Anything else (freeform spec_label, legacy callouts) returns null and
 *  the per-spec "+ CO" button hides. */
function slotKeyForApprovalLabel(label: string): string | null {
  if (label === 'Carcass material') return 'carcassMaterial'
  if (label === 'Door/drawer material') return 'doorMaterialId'
  if (label === 'Exterior finish') return 'doorFinishId'
  return null
}

export default function ApprovalSlots({ subprojectId, actorUserId, onChange, onCreateSpecCo, tourTag, focusItemId, hideHeader }: Props) {
  const { alert, confirm } = useConfirm()
  // Add / edit callouts by hand (2026-10-26, 122). One form at a time.
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Open a slot the parent pointed at. Only acts when the item is in THIS
  // subproject's list, so the other cards on the page ignore it. Additive —
  // it never closes anything the operator opened.
  useEffect(() => {
    if (!focusItemId) return
    if (!items.some((i) => i.id === focusItemId)) return
    setExpanded((prev) => (prev.has(focusItemId) ? prev : new Set(prev).add(focusItemId)))
  }, [focusItemId, items])

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
    itemId: string,
    /** Announced only after the transition + reload succeed — the sell-it
     *  guide waits on the approval actually landing. */
    announceOnSuccess?: TourEvent
  ) => {
    setBusyItemId(itemId)
    try {
      await fn(itemId, { actorUserId })
      await reload()
      onChange?.()
      if (announceOnSuccess) announce(announceOnSuccess)
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

  async function saveNew(v: CalloutValues) {
    setFormErr(null)
    if (!v.label.trim()) return setFormErr('A callout needs a label.')
    const created = await createCustomSlot(subprojectId, {
      label: v.label.trim(),
      material: v.material.trim(),
      finish: v.finish.trim() || null,
      item_kind: v.kind,
      link_url: v.link.trim() || null,
    })
    if (!created) return setFormErr('Could not add the callout.')
    setAdding(false)
    await reload()
    onChange?.()
  }

  async function saveEdit(item: ApprovalItem, v: CalloutValues) {
    setFormErr(null)
    const specChanged = (item.material || '') !== v.material.trim() || (item.finish || '') !== v.finish.trim()
    if (specChanged && item.state !== 'pending') {
      const ok = await confirm({
        title: 'Change an approved callout?',
        message: `"${item.label}" is ${item.state === 'approved' ? 'approved' : 'in review'}. Changing its material or finish puts it back to pending — the client approved the old spec, not this one.`,
        confirmLabel: 'Change it',
      })
      if (!ok) return
    }
    try {
      await updateApprovalCallout(
        item,
        { label: v.label, material: v.material, finish: v.finish, item_kind: v.kind, link_url: v.link.trim() || null },
        actorUserId,
      )
      setEditingId(null)
      await reload()
      onChange?.()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  async function remove(item: ApprovalItem) {
    // Pending = one click. Anything further along asks first — and is kept on
    // the project timeline either way (the row is a tombstone, not deleted).
    if (item.state !== 'pending') {
      const ok = await confirm({
        title: 'Delete an approval callout?',
        message: `"${item.label}" is ${item.state === 'approved' ? 'already approved' : 'in review with the client'}. It will leave the approvals list and stop counting toward the gate. Its history stays on the project timeline.`,
        confirmLabel: 'Delete',
        variant: 'danger',
      })
      if (!ok) return
    }
    setBusyItemId(item.id)
    try {
      await dismissApprovalCallout(item, actorUserId)
      await reload()
      onChange?.()
    } catch (e) {
      await alert({ title: 'Couldn’t delete', message: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setBusyItemId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading approvals…</div>
  }

  return (
    <div data-tour={tourTag} className="space-y-3">
      {/* Section header — specs are derived from the locked estimate.
          Per-spec CO entry lives on each card now; the page-level
          "+ New change order" link was redundant. */}
      {!hideHeader && (
        <div className="text-sm font-medium text-neutral-700">
          Specs
          <span className="ml-2 text-neutral-500 font-normal">
            {approvedCount} of {items.length} approved
          </span>
          {items.length > 0 && (
            <span className="ml-2 text-neutral-400 font-normal">· pulled from estimate lines</span>
          )}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !adding && (
        <div className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded p-4">
          No callouts yet. They come from the estimate&apos;s finish specs when a job sells — or add the materials and
          finishes the client needs to approve by hand below.
        </div>
      )}

      {/* Slot list. Approval-state buttons + per-spec "+ CO" entry.
          A material / finish swap on a non-approved spec opens the
          spec-CO modal (parent decides). When the spec lands as
          approved, any draft CO targeting it auto-finalizes (see
          lib/change-orders.finalizeSpecCosOnApproval). */}
      {/* 135 — grouped by TYPE (Finishes / Hardware / Drawings / Other), the
          same hierarchy, in the same order, the client's portal shows. */}
      {groupByKind(items).map((group) => (
        <div key={group.kind} data-kind-group={group.kind} className="space-y-3">
          <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em] px-1.5 pt-1">
            {group.label}
          </div>
      {group.rows.map((item) => {
        const slotKey = slotKeyForApprovalLabel(item.label)
        // Spec-CO is only meaningful when:
        //   1. The parent wired onCreateSpecCo (pre-prod page does;
        //      the project-detail Client picker doesn't).
        //   2. The spec is composer-derived (slotKey resolves).
        //   3. The spec isn't already approved (locked).
        const canCreateCo =
          !!onCreateSpecCo && !!slotKey && item.state !== 'approved'
        if (editingId === item.id) {
          return (
            <CalloutForm
              key={item.id}
              initial={{
                label: item.label,
                material: item.material || '',
                finish: item.finish || '',
                kind: normalizeItemKind(item.item_kind),
                link: item.link_url || '',
              }}
              submitLabel="Save"
              error={formErr}
              onCancel={() => {
                setEditingId(null)
                setFormErr(null)
              }}
              onSubmit={(v) => saveEdit(item, v)}
            />
          )
        }
        return (
          <SlotCard
            key={item.id}
            item={item}
            onEdit={() => {
              setAdding(false)
              setFormErr(null)
              setEditingId(item.id)
            }}
            onDelete={() => void remove(item)}
            isExpanded={expanded.has(item.id)}
            isBusy={busyItemId === item.id}
            canCreateCo={canCreateCo}
            onToggleExpanded={() => toggleExpanded(item.id)}
            onSubmit={() => runTransition(submitSample, item.id, 'ms:spec-submitted')}
            onApprove={() => runTransition(approve, item.id, 'ms:spec-approved')}
            onUnapprove={() => runTransition(unapprove, item.id)}
            onRequestChange={() => runTransition(requestChange, item.id)}
            onCreateCo={() => onCreateSpecCo?.(item.id)}
          />
        )
      })}
        </div>
      ))}

      {/* + Add callout — manual and derived callouts share this list and gate
          identically (slots_total / slots_approved count both). */}
      {adding ? (
        <CalloutForm
          initial={{ label: '', material: '', finish: '', kind: null, link: '' }}
          submitLabel="Add callout"
          error={formErr}
          onCancel={() => {
            setAdding(false)
            setFormErr(null)
          }}
          onSubmit={saveNew}
        />
      ) : (
        <button
          onClick={() => {
            setEditingId(null)
            setFormErr(null)
            setAdding(true)
          }}
          className="text-xs inline-flex items-center gap-1 text-[#2563EB] hover:underline"
        >
          <Plus className="w-3 h-3" /> Add callout
        </button>
      )}
    </div>
  )
}

interface CalloutValues {
  label: string
  material: string
  finish: string
  kind: ItemKind
  link: string
}

/** Plain-text callout editor — type · label · material · finish (+ a product
 *  link for hardware). `kind: null` on a new callout means "not picked yet":
 *  the picker follows the words as they're typed until someone clicks a type,
 *  after which it stays where they put it. */
function CalloutForm({
  initial,
  submitLabel,
  error,
  onCancel,
  onSubmit,
}: {
  initial: Omit<CalloutValues, 'kind'> & { kind: ItemKind | null }
  submitLabel: string
  error: string | null
  onCancel: () => void
  onSubmit: (v: CalloutValues) => void | Promise<void>
}) {
  const [text, setV] = useState({ label: initial.label, material: initial.material, finish: initial.finish, link: initial.link })
  const [picked, setPicked] = useState<ItemKind | null>(initial.kind)
  const kind: ItemKind = picked ?? guessItemKind(text)
  const v: CalloutValues = { ...text, kind }
  const [busy, setBusy] = useState(false)
  const field = 'w-full px-2 py-1.5 text-sm border border-neutral-300 rounded focus:outline-none focus:border-[#2563EB]'
  return (
    <div className="rounded-[10px] border border-[#BFDBFE] bg-[#F8FAFF] p-3 space-y-2">
      {/* TYPE picker (135) — writes approval_items.item_kind. */}
      <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Type">
        <span className="text-[11px] text-neutral-500 mr-0.5">Type</span>
        {ITEM_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            data-kind={k}
            onClick={() => setPicked(k)}
            className={
              'text-xs px-2.5 py-1 rounded-full border transition-colors ' +
              (kind === k
                ? 'bg-[#2563EB] border-[#2563EB] text-white'
                : 'bg-white border-neutral-300 text-neutral-700 hover:border-[#93C5FD]')
            }
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input
        value={v.label}
        onChange={(e) => setV({ ...text, label: e.target.value })}
        placeholder="What it is — e.g. Countertop, Cabinet paint, Pulls"
        className={field}
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={v.material}
          onChange={(e) => setV({ ...text, material: e.target.value })}
          placeholder="Material — e.g. Calacatta quartz"
          className={field}
        />
        <input
          value={v.finish}
          onChange={(e) => setV({ ...text, finish: e.target.value })}
          placeholder="Finish (optional)"
          className={field}
        />
      </div>
      {/* Product link — offered for hardware (and kept visible if one is
          already set, so re-filing a callout never hides its link). */}
      {(kind === 'hardware' || v.link.trim()) && (
        <input
          value={v.link}
          onChange={(e) => setV({ ...text, link: e.target.value })}
          placeholder="Product link (optional) — the client can open it"
          inputMode="url"
          className={field}
        />
      )}
      {error && <div className="text-xs text-red-700">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs px-2 py-1 rounded text-neutral-700 hover:bg-neutral-100">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSubmit(v)
            } finally {
              setBusy(false)
            }
          }}
          className="text-xs px-2.5 py-1 rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}

// ── Slot card ──

interface SlotCardProps {
  item: ApprovalItem
  isExpanded: boolean
  isBusy: boolean
  /** Pre-resolved gate: parent wired up + composer-derived spec +
   *  state !== approved. Hides the button when false. */
  canCreateCo: boolean
  onToggleExpanded: () => void
  onSubmit: () => void
  onApprove: () => void
  /** Undo an approval marked by mistake (approved → in review). */
  onUnapprove: () => void
  onRequestChange: () => void
  onCreateCo: () => void
  onEdit: () => void
  onDelete: () => void
}

function SlotCard(p: SlotCardProps) {
  const { item } = p
  const rev = revNumber(item)
  const days = daysSinceStateChange(item)
  const tone = ballChipTone(item)

  return (
    <div
      id={`slot-${item.id}`}
      className={`rounded-[10px] border ${stateBorderClass(item.state)} bg-white overflow-hidden transition-colors hover:border-[#93C5FD]`}
    >
      {/* Row 1 — the WHOLE row toggles (wave-2 item 4). The chevron stays as
          the affordance; it's now a visual cue rather than the only target,
          which on a dense list was a 16px hit area per spec. Keyboard users
          get the same thing because the row is a real button. */}
      <div
        role="button"
        tabIndex={0}
        onClick={p.onToggleExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            p.onToggleExpanded()
          }
        }}
        className="p-3 flex items-start gap-3 cursor-pointer text-left w-full hover:bg-[#FAFCFF] transition-colors"
      >
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
          {/* The per-spec "+ CO" button was retired — change orders are
              created from the "Change order" button in the subproject header. */}
          <span aria-hidden className="text-neutral-500 p-1">
            {p.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </div>

      {/* Expanded. stopPropagation because the body sits INSIDE the clickable
          row's sibling — without it, using any action button in here would
          also collapse the card out from under the click. */}
      {p.isExpanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="px-3 pb-3 border-t border-neutral-100"
        >
          <div className="grid grid-cols-2 gap-3 pt-3">
            <KV label="Material" value={item.material || '—'} />
            <KV label="Finish" value={item.finish || '—'} />
          </div>

          {safeHttpUrl(item.link_url) && (
            <a
              href={safeHttpUrl(item.link_url)!}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 text-xs inline-flex items-center gap-1 text-[#2563EB] hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {shortLinkLabel(safeHttpUrl(item.link_url)!)}
            </a>
          )}

          {/* Photos (135) — same private bucket the client's portal shows. */}
          <SlotPhotos itemId={item.id} />

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
                      {r.actor_name && <span className="text-neutral-800"> by {r.actor_name} (portal)</span>}
                      {r.note && <span className="text-neutral-500"> — {r.note}</span>}
                      <span className="text-neutral-400 ml-1">{fmtTimestamp(r.occurred_at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Actions — the approval workflow, then edit / delete (122). */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SlotActions
              state={item.state}
              isBusy={p.isBusy}
              onSubmit={p.onSubmit}
              onApprove={p.onApprove}
              onUnapprove={p.onUnapprove}
              onRequestChange={p.onRequestChange}
            />
            <span className="flex-1" />
            <button
              onClick={p.onEdit}
              disabled={p.isBusy}
              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={p.onDelete}
              disabled={p.isBusy}
              className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded text-neutral-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Photo strip for one callout. Uploads and reads go through the shop's
 *  authenticated route (the bucket is private) — the client sees the same
 *  photos on the portal, and can add their own there. */
function SlotPhotos({ itemId }: { itemId: string }) {
  const [photos, setPhotos] = useState<ApprovalPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void listApprovalPhotos(itemId).then((p) => live && setPhotos(p))
    return () => {
      live = false
    }
  }, [itemId])

  async function run(fn: () => Promise<ApprovalPhoto[]>) {
    setBusy(true)
    setErr(null)
    try {
      setPhotos(await fn())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3" data-slot-photos>
      <div className="text-xs font-medium text-neutral-700 mb-1">
        Photos <span className="font-normal text-neutral-400">· the client sees these on the portal</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative group">
            <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.fromClient ? `From ${p.addedBy || 'the client'}` : p.addedBy || ''}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || 'Finish photo'} className="w-14 h-14 rounded-lg object-cover border border-neutral-200" />
            </a>
            {p.fromClient && (
              <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded bg-amber-500 text-white">client</span>
            )}
            <button
              onClick={() => void run(() => deleteApprovalPhoto(p.id))}
              disabled={busy}
              aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800 text-white hidden group-hover:flex items-center justify-center"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-14 h-14 rounded-lg border border-dashed border-neutral-300 text-neutral-400 hover:border-[#2563EB] hover:text-[#2563EB] flex items-center justify-center disabled:opacity-40"
          aria-label="Add a photo"
        >
          <Plus className="w-4 h-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            if (files.length === 0) return
            void run(async () => {
              let last: ApprovalPhoto[] = photos
              for (const f of files) last = await uploadApprovalPhoto(itemId, f)
              return last
            })
          }}
        />
      </div>
      {err && <div className="text-xs text-red-700 mt-1">{err}</div>}
    </div>
  )
}

function SlotActions({
  state,
  isBusy,
  onSubmit,
  onApprove,
  onUnapprove,
  onRequestChange,
}: {
  state: ApprovalState
  isBusy: boolean
  onSubmit: () => void
  onApprove: () => void
  onUnapprove: () => void
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
  // approved — content edits still go through a CO. The one way back is
  // "Undo approval" for an approval clicked by mistake: it returns the
  // item to In review (logged in the sample history).
  return (
    <button
      onClick={onUnapprove}
      disabled={isBusy}
      className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700 disabled:opacity-40"
    >
      <RotateCcw className="w-3 h-3" />
      Undo approval
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

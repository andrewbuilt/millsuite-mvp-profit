// ============================================================================
// drawings-track.tsx — Phase 2 UI for drawing revisions
// ============================================================================
// Upload revision (URL paste for V1), list revisions with state badges,
// transition revisions through pending → in_review → approved. Latest
// revision is highlighted; older revisions collapse to a dim "superseded"
// row. Per D8, approval is the shop user marking it on the client's behalf
// after verbal/email sign-off. No client-facing surface in V1.
//
// Not in scope (later phases):
//   - Blob storage upload (V1: URL paste)
//   - Inline PDF preview
//   - Phase 3 ties this into the scheduling gate
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Send,
  RotateCcw,
  Upload,
  ExternalLink,
  FileText,
  X,
} from 'lucide-react'
import {
  DrawingRevision,
  approveRevision,
  isDrawingsGateGreen,
  loadDrawingRevisions,
  reopenRevision,
  submitRevisionForReview,
  uploadNewRevision,
} from '@/lib/drawings'
import type { ApprovalState } from '@/lib/approvals'

interface Props {
  subprojectId: string
  /** Optional, set as uploaded_by_user_id on new revision rows. */
  actorUserId?: string
}

export default function DrawingsTrack({ subprojectId, actorUserId }: Props) {
  const [revs, setRevs] = useState<DrawingRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [busyRevId, setBusyRevId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const next = await loadDrawingRevisions(subprojectId)
    setRevs(next)
    setLoading(false)
  }, [subprojectId])

  useEffect(() => {
    reload()
  }, [reload])

  const runTransition = async (
    fn: (id: string) => Promise<void>,
    revId: string
  ) => {
    setBusyRevId(revId)
    try {
      await fn(revId)
      await reload()
    } catch (err) {
      console.error(err)
      alert('Failed to update revision. See console.')
    } finally {
      setBusyRevId(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-neutral-500 py-4">Loading drawings…</div>
  }

  const latest = revs.find((r) => r.is_latest)
  const superseded = revs.filter((r) => !r.is_latest)
  const gateGreen = isDrawingsGateGreen(revs)

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-neutral-700">
          Drawings
          {latest ? (
            <span className="ml-2 text-neutral-500 font-normal">
              R{latest.revision_number}
              {gateGreen ? (
                <span className="ml-2 text-emerald-600">· approved</span>
              ) : (
                <span className="ml-2 text-neutral-400">· {latest.state.replace('_', ' ')}</span>
              )}
            </span>
          ) : (
            <span className="ml-2 text-neutral-400 font-normal">no revisions yet</span>
          )}
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 hover:border-neutral-500 text-neutral-700"
        >
          <Upload className="w-3 h-3" />
          Upload revision
        </button>
      </div>

      {/* Empty state */}
      {revs.length === 0 && (
        <div className="text-sm text-neutral-500 border border-dashed border-neutral-300 rounded p-4">
          No drawings uploaded yet. Upload the first revision when shop drawings are ready for client review.
        </div>
      )}

      {/* Latest revision */}
      {latest && (
        <RevisionCard
          rev={latest}
          isLatest
          isBusy={busyRevId === latest.id}
          onSubmit={() => runTransition(submitRevisionForReview, latest.id)}
          onApprove={() => runTransition(approveRevision, latest.id)}
          onReopen={() => runTransition(reopenRevision, latest.id)}
        />
      )}

      {/* Superseded revisions (collapsed) */}
      {superseded.length > 0 && (
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1">
            Superseded
          </div>
          <div className="space-y-1">
            {superseded.map((r) => (
              <SupersededRow key={r.id} rev={r} />
            ))}
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadRevisionModal
          subprojectId={subprojectId}
          actorUserId={actorUserId}
          onClose={() => setShowUpload(false)}
          onUploaded={async () => {
            setShowUpload(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

// ── Revision card ──

interface RevisionCardProps {
  rev: DrawingRevision
  isLatest: boolean
  isBusy: boolean
  onSubmit: () => void
  onApprove: () => void
  onReopen: () => void
}

function RevisionCard({
  rev,
  isLatest,
  isBusy,
  onSubmit,
  onApprove,
  onReopen,
}: RevisionCardProps) {
  return (
    <div
      className={`border rounded px-4 py-3 ${
        isLatest ? stateBorderClass(rev.state) : 'border-neutral-200 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-neutral-500" />
            <div className="font-medium text-sm">Revision {rev.revision_number}</div>
            <StateBadge state={rev.state} />
            {isLatest && (
              <span className="text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                Latest
              </span>
            )}
          </div>
          {rev.file_url && (
            <a
              href={rev.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 truncate max-w-full"
            >
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{rev.file_url}</span>
            </a>
          )}
          {rev.notes && (
            <div className="mt-1 text-xs text-neutral-600">{rev.notes}</div>
          )}
          <div className="mt-2 text-[11px] text-neutral-500 flex flex-wrap gap-x-3 gap-y-0.5">
            {rev.submitted_at && (
              <span>Submitted {fmtTimestamp(rev.submitted_at)}</span>
            )}
            {rev.responded_at && (
              <span>Responded {fmtTimestamp(rev.responded_at)}</span>
            )}
          </div>
        </div>

        {isLatest && (
          <RevisionActions
            state={rev.state}
            isBusy={isBusy}
            onSubmit={onSubmit}
            onApprove={onApprove}
            onReopen={onReopen}
          />
        )}
      </div>
    </div>
  )
}

function SupersededRow({ rev }: { rev: DrawingRevision }) {
  return (
    <div className="flex items-center justify-between text-xs text-neutral-500 px-3 py-1.5 rounded bg-neutral-50">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="w-3 h-3 flex-shrink-0" />
        <span className="font-medium">R{rev.revision_number}</span>
        <StateBadge state={rev.state} small />
        {rev.file_url && (
          <a
            href={rev.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-blue-600 hover:text-blue-800"
          >
            {rev.file_url}
          </a>
        )}
      </div>
      <span className="text-[10px]">{fmtTimestamp(rev.responded_at || rev.submitted_at || rev.created_at)}</span>
    </div>
  )
}

// ── Action buttons per state ──

interface RevisionActionsProps {
  state: ApprovalState
  isBusy: boolean
  onSubmit: () => void
  onApprove: () => void
  onReopen: () => void
}

function RevisionActions({
  state,
  isBusy,
  onSubmit,
  onApprove,
  onReopen,
}: RevisionActionsProps) {
  if (state === 'pending') {
    return (
      <button
        disabled={isBusy}
        onClick={onSubmit}
        className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        <Send className="w-3 h-3" /> Sent to client
      </button>
    )
  }
  if (state === 'in_review') {
    return (
      <div className="flex gap-1 flex-shrink-0">
        <button
          disabled={isBusy}
          onClick={onApprove}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 className="w-3 h-3" /> Client approved
        </button>
        <button
          disabled={isBusy}
          onClick={onReopen}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" /> Needs rework
        </button>
      </div>
    )
  }
  // approved — no primary action. New revision comes via the upload button.
  return (
    <div className="text-[11px] text-neutral-400 flex-shrink-0">
      Upload a new revision to supersede
    </div>
  )
}

// ── State badge + helpers ──

function StateBadge({ state, small }: { state: ApprovalState; small?: boolean }) {
  const tone =
    state === 'approved'
      ? 'bg-emerald-100 text-emerald-800'
      : state === 'in_review'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-neutral-200 text-neutral-700'
  const size = small ? 'text-[9px] px-1 py-0' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span className={`${size} uppercase tracking-wider rounded font-medium ${tone}`}>
      {state.replace('_', ' ')}
    </span>
  )
}

function stateBorderClass(state: ApprovalState): string {
  if (state === 'approved') return 'border-emerald-300'
  if (state === 'in_review') return 'border-amber-300'
  return 'border-neutral-300'
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Upload modal ──

interface UploadModalProps {
  subprojectId: string
  actorUserId?: string
  onClose: () => void
  onUploaded: () => Promise<void>
}

function UploadRevisionModal({
  subprojectId,
  actorUserId,
  onClose,
  onUploaded,
}: UploadModalProps) {
  const [fileUrl, setFileUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = fileUrl.trim().length > 0 && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const result = await uploadNewRevision(subprojectId, {
        file_url: fileUrl.trim(),
        notes: notes.trim() || undefined,
        uploaded_by_user_id: actorUserId,
      })
      if (!result) {
        alert('Failed to upload revision. See console.')
        return
      }
      await onUploaded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <div className="font-medium text-sm">Upload drawing revision</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-700 block mb-1">
              File URL <span className="text-red-600">*</span>
            </label>
            <input
              type="url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://drive.google.com/… or https://dropbox.com/…"
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Paste a share link. Make sure the client has view access.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-700 block mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What changed since the last revision?"
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="text-[11px] text-neutral-500 bg-neutral-50 rounded px-2 py-1.5">
            <Clock className="w-3 h-3 inline mr-1" />
            Starts in <span className="font-medium">pending</span>. Mark as sent once you've shared it with the client.
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-200">
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
            {saving ? 'Uploading…' : 'Upload revision'}
          </button>
        </div>
      </div>
    </div>
  )
}

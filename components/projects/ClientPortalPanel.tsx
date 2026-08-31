'use client'

// ============================================================================
// components/projects/ClientPortalPanel.tsx — the shop's control of the portal
// ============================================================================
// Everything the shop does FOR the client portal, on the project page:
//   • copy (and regenerate) the client's portal link
//   • post shop photos to the "From the shop" feed
//   • flip the Finishing phase, which has no stored stage to derive it from
//
// The link is per CLIENT, not per project, so the copy button is disabled until
// a client is attached — and it says why, since "nothing happens" on a project
// with no client would read as a broken button.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadProjectPhotos,
  uploadProjectPhoto,
  deleteProjectPhoto,
  getPortalLink,
  setProjectFinishing,
  type ProjectPhoto,
} from '@/lib/portal-admin'

export default function ClientPortalPanel({
  projectId,
  orgId,
  clientId,
  finishingAt,
  stage,
  onToast,
}: {
  projectId: string
  /** Belt-and-braces org scoping on the finishing write. Null is safe — RLS
   *  already confines the update to the caller's org. */
  orgId: string | null
  clientId: string | null
  finishingAt: string | null
  stage: string
  onToast?: (msg: string) => void
}) {
  const [photos, setPhotos] = useState<ProjectPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [caption, setCaption] = useState('')
  const [finishing, setFinishing] = useState(!!finishingAt)
  const [link, setLink] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const toast = useCallback((m: string) => onToast?.(m), [onToast])

  useEffect(() => {
    void loadProjectPhotos(projectId).then(setPhotos)
  }, [projectId])

  // Keep in step if the project reloads under us (e.g. after a stage change).
  useEffect(() => setFinishing(!!finishingAt), [finishingAt])

  async function copyLink(regenerate = false) {
    if (!clientId) return
    setBusy(true)
    const res = await getPortalLink(clientId, regenerate)
    setBusy(false)
    if (!res) return toast('Could not get the portal link')
    setLink(res.url)
    try {
      await navigator.clipboard.writeText(res.url)
      toast(regenerate ? 'New link copied. The old one no longer works.' : 'Portal link copied')
    } catch {
      // Clipboard is blocked in some browsers/contexts. The link is shown
      // below either way, so this is a downgrade, not a failure.
      toast('Portal link ready — copy it below')
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setBusy(true)
    let added = 0
    for (const f of files) {
      const photo = await uploadProjectPhoto(projectId, f, caption)
      if (photo) {
        setPhotos((prev) => [photo, ...prev])
        added += 1
      }
    }
    setBusy(false)
    setCaption('')
    if (fileRef.current) fileRef.current.value = ''
    toast(
      added === files.length
        ? `${added} photo${added === 1 ? '' : 's'} posted to the client portal`
        : `${added} of ${files.length} uploaded — the rest were rejected (over 10 MB, or not an image)`,
    )
  }

  async function removePhoto(id: string) {
    const ok = await deleteProjectPhoto(projectId, id)
    if (!ok) return toast('Could not remove that photo')
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    toast('Photo removed')
  }

  async function toggleFinishing() {
    const next = !finishing
    setFinishing(next)
    const ok = await setProjectFinishing(projectId, next, orgId ?? undefined)
    if (!ok) {
      setFinishing(!next)
      return toast('Could not save that')
    }
    toast(next ? 'Client portal now shows Finishing' : 'Back to In production')
  }

  // The toggle only means anything once the job is actually being built.
  const canFinish = stage === 'production'

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm mt-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-[#111]">Client portal</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => copyLink(false)}
            disabled={!clientId || busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#111] text-white disabled:opacity-40"
          >
            Copy portal link
          </button>
          {link ? (
            <button
              type="button"
              onClick={() => {
                if (confirm('Make a new link? Any link you already sent this client will stop working.')) {
                  void copyLink(true)
                }
              }}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] disabled:opacity-40"
            >
              Regenerate
            </button>
          ) : null}
        </div>
      </div>

      {!clientId ? (
        <p className="text-xs text-[#6B7280] mt-2">
          Attach a client to this project first — the portal link covers every project that client has with you.
        </p>
      ) : link ? (
        <p className="text-[11px] text-[#6B7280] mt-2 break-all font-mono">{link}</p>
      ) : (
        <p className="text-xs text-[#6B7280] mt-2">
          One link per client, covering all of their projects. Anyone with it can see this project.
        </p>
      )}

      {/* ── Finishing phase ─────────────────────────────────────────────── */}
      <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
        <label className={`flex items-start gap-2.5 ${canFinish ? 'cursor-pointer' : 'opacity-50'}`}>
          <input
            type="checkbox"
            checked={finishing}
            onChange={toggleFinishing}
            disabled={!canFinish}
            className="mt-0.5 accent-[#111]"
          />
          <span>
            <span className="text-xs font-medium text-[#111] block">In finishing</span>
            <span className="text-[11px] text-[#6B7280] block mt-0.5">
              {canFinish
                ? 'Moves the client portal to phase 5. Display only — it changes nothing else.'
                : 'Available once the project is in production.'}
            </span>
          </span>
        </label>
      </div>

      {/* ── Shop photos ─────────────────────────────────────────────────── */}
      <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-[#111]">
            From the shop{photos.length > 0 ? ` · ${photos.length}` : ''}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] disabled:opacity-40"
          >
            {busy ? 'Uploading…' : '+ Add photos'}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPick}
          className="hidden"
        />
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption for the next upload (optional)"
          className="mt-2 w-full text-xs border border-[#E5E7EB] rounded-lg px-2.5 py-1.5"
        />

        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {photos.map((p) => (
              <figure key={p.id} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase
                    storage URLs; next/image would need the host allowlisted. */}
                <img
                  src={p.url}
                  alt={p.caption || 'Shop photo'}
                  loading="lazy"
                  className="h-20 w-full object-cover rounded-lg bg-[#F3F4F6]"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  title="Remove"
                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white text-[11px] leading-none opacity-0 group-hover:opacity-100"
                >
                  ×
                </button>
                {p.caption ? (
                  <figcaption className="text-[10px] text-[#6B7280] mt-1 truncate">{p.caption}</figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[#6B7280] mt-2">
            Nothing posted yet. Photos show up in the client&apos;s portal, newest first.
          </p>
        )}
      </div>
    </div>
  )
}

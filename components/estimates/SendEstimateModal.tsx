'use client'

// ============================================================================
// SendEstimateModal — pick a template, download the estimate PDF
// ============================================================================
// Download-and-send-yourself: there's no in-app email send and no status
// machine (the PDF route stamps estimate_sent_at on download). The email
// subject/body composer was removed 2026-09-04 (round 3 item A) — no email is
// connected, so the fields were dead weight; resurrect from git if email ever
// lands. An embedded live preview is deferred to the design pass —
// "Download PDF" opens the real rendered PDF in a new tab.
//
// Layout contract: future presentation options (toggles/sections) stack in the
// presentation block under the cover line — add rows there, no redesign.
// ============================================================================

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { downloadEstimatePdf, type EstimatePdfPayload } from '@/lib/estimate-pdf'
import { supabase } from '@/lib/supabase'
// ⛔ From lib/, NOT from EstimatePresentationPdf. This is a client component;
// importing it from the PDF module pulls lib/estimate-fonts (node:fs, node:path)
// into the browser bundle and fails the production build. See the note in
// lib/estimate-headline.
import { estimateHeadlineFor } from '@/lib/estimate-headline'

export default function SendEstimateModal({
  projectId,
  payload,
  clientName,
  projectName,
  defaultTemplate,
  orgId,
  onClose,
}: {
  projectId: string
  payload: EstimatePdfPayload
  clientName: string | null
  projectName: string
  /** The project's STAMPED template, if it was sent before. Wins over the org
   *  default — a resend should reproduce what the client already has. */
  defaultTemplate?: string | null
  /** Used to look up the org default when the project has no stamp yet. */
  orgId?: string | null
  onClose: () => void
}) {
  const [template, setTemplate] = useState<'standard' | 'presentation'>(
    defaultTemplate === 'presentation' ? 'presentation' : 'standard',
  )
  // Auto-generated, then editable. Only the presentation template prints it.
  // Shares the generator with the PDF so the preview and the fallback can't
  // drift — including the conditional "the" (a household needs it, a person's
  // name doesn't).
  const [headline, setHeadline] = useState(estimateHeadlineFor(clientName || projectName))
  // The org default is read HERE, in its own tiny select, rather than being
  // threaded through the pages' shared org object. Adding the column to that
  // shared read would take the whole app down on a pre-095 database, since
  // PostgREST fails the entire select on one unknown column. Any error just
  // leaves the picker on Standard.
  useEffect(() => {
    if (defaultTemplate || !orgId) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('orgs')
        .select('estimate_template_default')
        .eq('id', orgId)
        .maybeSingle()
      if (cancelled || error || !data) return
      if ((data as { estimate_template_default?: string }).estimate_template_default === 'presentation') {
        setTemplate('presentation')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [defaultTemplate, orgId])

  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    try {
      await downloadEstimatePdf(projectId, {
        ...payload,
        template,
        // Sent only with the template that uses it, so a standard estimate
        // can't quietly stamp a headline it never printed.
        headline: template === 'presentation' ? headline.trim() || null : null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate the estimate PDF')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111]">Send estimate</h3>
            <p className="text-[11.5px] text-[#9CA3AF] mt-0.5">
              Pick a template and download the PDF — you attach and send it yourself.
            </p>
          </div>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#111] p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Template picker. Per-estimate, because Built sends premium
              documents to homeowners and plain ones to builders — the choice
              belongs to the estimate, not the shop. The route STAMPS it so a
              regenerate months later reproduces this document. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5">
              Template
            </div>
            <div className="flex items-center gap-1.5">
              {([
                { key: 'standard' as const, label: 'Standard' },
                { key: 'presentation' as const, label: 'Presentation' },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplate(t.key)}
                  className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
                    template === t.key
                      ? 'bg-[#111] text-white border-[#111]'
                      : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Presentation options. Future template options (toggles/sections)
              stack HERE, under the cover line — rows in this block, no
              redesign. */}
          {template === 'presentation' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  Cover line
                </label>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  className="mt-1.5 w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                />
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Prints large on the cover. Saved with the estimate.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="px-3 py-1.5 text-[12.5px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Generating…' : 'Download PDF'}
            </button>
            <span className="text-[11.5px] text-[#9CA3AF]">
              Opens in a new tab. Save it and send it to your client.
            </span>
          </div>

          {error && (
            <div className="px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

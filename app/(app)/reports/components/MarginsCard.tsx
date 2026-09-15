'use client'

// ============================================================================
// MarginsCard — shop rate ladder, snapshot history, margin alerts
// ============================================================================
// ⛔ MOVED HERE FROM /team, VERBATIM. Andrew: "those should live somewhere
// else." It is financial monitoring, not roster management, and /reports is
// where the shop's numbers already live (the AI report landed there too).
//
// ⛔ AND IT CARRIES ITS OWN-ONLY GATE WITH IT. On /team this panel rendered
// behind `canSeeComp`, which comes from /api/team/setup — the endpoint strips
// every money figure server-side for non-owners. /reports has NO role check of
// its own, so relocating this without the gate would have handed break-even,
// the margin ladder and per-project effective rates to every manager who can
// open the page. The caller fetches the SAME endpoint; do not swap it for a
// client-side read of `orgs`.
//
// The shop-rate SETUP inputs (overhead, team comp, billable hours) stay on
// /team and Settings — this is the readout, not the editor.
// ============================================================================

import Link from 'next/link'
export default function MarginsCard({
  breakEven,
  shopRate,
  saving,
  onSave,
  snapshots,
  alerts,
}: {
  breakEven: number
  shopRate: number
  saving: boolean
  onSave: () => void
  snapshots: Array<{ id: string; effective_rate: number; created_at: string }>
  alerts: Array<{ id: string; name: string; effRate: number; belowBreakEven: boolean }>
}) {
  if (breakEven <= 0) return null
  const margins = [0, 0.15, 0.2, 0.25, 0.3]
  const money = (n: number) => `$${n.toFixed(2)}`
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Margin ladder */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#111]">Shop rate</h2>
          <span className="text-[11px] text-[#9CA3AF]">
            Current <span className="font-mono text-[#111]">{money(shopRate)}/hr</span>
          </span>
        </div>
        <div className="space-y-1">
          {margins.map((m) => {
            const rate = breakEven / (1 - m)
            const isCurrent = Math.abs(rate - shopRate) < 0.01
            return (
              <div
                key={m}
                className={`flex items-center justify-between text-sm px-2 py-1 rounded-lg ${
                  isCurrent ? 'bg-[#EFF6FF]' : ''
                }`}
              >
                <span className="text-[#6B7280]">
                  {m === 0 ? 'Break-even' : `${Math.round(m * 100)}% margin`}
                </span>
                <span className="font-mono tabular-nums text-[#111]">{money(rate)}/hr</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#F3F4F6]">
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save break-even as my shop rate'}
          </button>
          {snapshots.length > 0 && (
            <span className="text-[11px] text-[#9CA3AF]">
              Last saved {fmtDate(snapshots[0].created_at)}
            </span>
          )}
        </div>
        {snapshots.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            {snapshots.slice(0, 6).map((s) => (
              <span key={s.id} className="text-[10px] font-mono text-[#9CA3AF]">
                {fmtDate(s.created_at)}: {money(s.effective_rate)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Margin alerts */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-[#111] mb-1">Margin alerts</h2>
        <p className="text-[11px] text-[#9CA3AF] mb-2">
          Active jobs priced under break-even × 1.15 ({money(breakEven * 1.15)}/hr).
        </p>
        {alerts.length === 0 ? (
          <div className="text-xs text-[#16A34A] font-medium py-2">
            All active jobs are priced above target.
          </div>
        ) : (
          <div className="space-y-1">
            {alerts.map((a) => (
              <Link
                key={a.id}
                href={`/projects/${a.id}`}
                className="flex items-center justify-between text-xs px-1 py-1 rounded hover:bg-[#F9FAFB]"
              >
                <span className="truncate text-[#111]">{a.name}</span>
                <span
                  className={`font-mono tabular-nums flex-shrink-0 ml-2 ${
                    a.belowBreakEven ? 'text-[#DC2626] font-semibold' : 'text-[#B45309]'
                  }`}
                >
                  {money(a.effRate)}/hr
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

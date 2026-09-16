'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { CompletedProject } from '@/lib/reports/gradeCalculations'

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/** 0.5h → "0.5h", 13h → "13h". Never "13.0h" — that is false precision. */
function hrs(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`
}

/**
 * Actual as a percentage of estimate.
 *
 * ⛔ RETURNS NULL WHEN THERE IS NO ESTIMATE TO BE OVER. A department with 0h
 * estimated and 6h tracked is not "600% over", and it is certainly not "0%" —
 * it is work nobody planned for, which is the most interesting row in the
 * table. Division here would either blow up or quietly lie.
 */
function pctOf(actual: number, estimated: number): number | null {
  if (!estimated || estimated <= 0) return null
  return (actual / estimated) * 100
}

function varianceColor(pct: number | null): string {
  if (pct === null) return '#6B7280'
  if (pct > 105) return '#DC2626'
  if (pct < 95) return '#059669'
  return '#6B7280'
}

export default function DiagnosticDrawer({
  project,
  onClose,
}: {
  project: CompletedProject | null
  onClose: () => void
}) {
  // Close on Escape
  useEffect(() => {
    if (!project) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [project, onClose])

  if (!project) return null

  // ⛔ THE PER-DEPARTMENT NUMBERS ARE A SNAPSHOT ON THE OUTCOME ROW, NOT A LIVE
  // QUERY. `dept_hours_estimated` / `dept_hours_actual` are written by
  // /api/project-outcome when the job closes, keyed by department NAME.
  // Re-deriving them live would let this table drift from the `actualHours`
  // printed inches above it: rename a department, or log one stray hour against
  // a closed job, and the rows stop adding up to the total. Checked on prod —
  // all 7 outcome rows foot to `actual_hours` within 0.6h.
  const estByDept = project.deptHoursEstimated || {}
  const actByDept = project.deptHoursActual || {}
  // Union of both sides: a department that was estimated but never worked
  // matters as much as one that was worked but never estimated.
  const deptNames = Array.from(new Set([...Object.keys(estByDept), ...Object.keys(actByDept)])).sort(
    (a, b) => (actByDept[b] || 0) - (actByDept[a] || 0),
  )
  const hasDeptRows = deptNames.length > 0

  const deptEstTotal = deptNames.reduce((s, d) => s + (estByDept[d] || 0), 0)
  const deptActTotal = deptNames.reduce((s, d) => s + (actByDept[d] || 0), 0)

  // ⚠️ Foot the table against the headline figures, and SAY SO WHEN IT DOESN'T.
  // A breakdown that quietly sums to something other than the total it sits
  // under is exactly what a shop owner finds with a calculator.
  const footsHours = Math.abs(deptActTotal - project.actualHours) <= 0.6

  const matBudget = project.estimatedMaterials ?? 0
  const matActual = project.actualMaterials ?? 0
  const matDelta = matActual - matBudget
  // ⛔ /api/project-outcome computes `actual = invoiceTotal > 0 ? invoiceTotal
  // : estimated`, so AN EXACT TIE IS THE SIGNATURE OF NOTHING BEING RECORDED —
  // not of a job that landed precisely on budget. Rendering that as "$0 over,
  // on budget" would assert a fact this app does not have.
  const matUnrecorded = matBudget > 0 && matActual === matBudget

  const hoursPct = pctOf(project.actualHours, project.estimatedHours)
  const onEstimate = hoursPct !== null && Math.abs(hoursPct - 100) <= 5

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} className="fixed inset-0 bg-black/30 z-40 transition-opacity" />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[560px] bg-white z-50 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-0.5">Diagnostic</div>
            <h2 className="text-lg font-semibold text-[#111] truncate">{project.name}</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Delivered{' '}
              {new Date(project.completionDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="flex items-start gap-3 flex-shrink-0">
            <div className="text-right">
              <div className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide">Profit</div>
              <div
                className="text-lg font-semibold font-mono tabular-nums"
                style={{ color: project.profit >= 0 ? '#059669' : '#DC2626' }}
              >
                {fmtMoney(project.profit)}
              </div>
              <div className="text-[11px] text-[#6B7280] font-mono tabular-nums">
                {project.marginPct >= 0 ? '+' : ''}
                {project.marginPct.toFixed(1)}%
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mt-1 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ═══ HOURS ═══ */}
        <div className="px-6 py-5 border-b border-[#E5E7EB]">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Hours</div>
            {/* ⛔ `projectId`, NOT `id`. `id` is the `project_outcomes` row id;
                /time filters on `projects.id`. Passing the outcome id would
                match zero entries and render as "nobody tracked time on this
                job" — a wrong answer in the shape of a real one. */}
            <Link
              href={`/time?project=${project.projectId}`}
              className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
            >
              See the entries →
            </Link>
          </div>

          {hasDeptRows ? (
            <table className="w-full">
              <thead>
                <tr className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                  <th className="text-left font-medium pb-1.5">Department</th>
                  <th className="text-right font-medium pb-1.5 w-[64px]">Est</th>
                  <th className="text-right font-medium pb-1.5 w-[72px]">Actual</th>
                  <th className="text-right font-medium pb-1.5 w-[76px]">%</th>
                </tr>
              </thead>
              <tbody>
                {deptNames.map(dept => {
                  const est = estByDept[dept] || 0
                  const act = actByDept[dept] || 0
                  const pct = pctOf(act, est)
                  return (
                    <tr key={dept} className="border-t border-[#F3F4F6]">
                      <td className="py-1.5 text-sm text-[#111]">{dept}</td>
                      <td className="py-1.5 text-sm text-right text-[#6B7280] font-mono tabular-nums">{hrs(est)}</td>
                      <td className="py-1.5 text-sm text-right text-[#111] font-mono tabular-nums">{hrs(act)}</td>
                      <td
                        className="py-1.5 text-sm text-right font-medium font-mono tabular-nums"
                        style={{ color: varianceColor(pct) }}
                      >
                        {/* ⚠️ Not "0%" when nothing was estimated — work that was
                            never planned is not work that came in on plan. */}
                        {pct === null ? (act > 0 ? 'unplanned' : '—') : `${pct.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t-2 border-[#E5E7EB]">
                  <td className="pt-2 text-sm font-semibold text-[#111]">Total</td>
                  <td className="pt-2 text-sm text-right font-semibold text-[#6B7280] font-mono tabular-nums">
                    {hrs(project.estimatedHours)}
                  </td>
                  <td className="pt-2 text-sm text-right font-semibold text-[#111] font-mono tabular-nums">
                    {hrs(project.actualHours)}
                  </td>
                  <td
                    className="pt-2 text-sm text-right font-semibold font-mono tabular-nums"
                    style={{ color: varianceColor(hoursPct) }}
                  >
                    {hoursPct === null ? '—' : `${hoursPct.toFixed(0)}%`}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            // ⚠️ An empty breakdown is reported as empty. A table of zeros would
            // read as "every department took no time", which is a claim.
            <div className="text-sm text-[#6B7280]">
              {hrs(project.actualHours)} tracked against {hrs(project.estimatedHours)} estimated.
              <span className="block text-xs mt-1">
                No per-department breakdown was recorded for this job.
              </span>
            </div>
          )}

          {hasDeptRows && !footsHours && (
            // ⛔ Never let the rows quietly disagree with the total above them.
            <div className="mt-2 text-xs text-[#A32D2D]">
              Departments add to {hrs(deptActTotal)}, {hrs(Math.abs(deptActTotal - project.actualHours))}{' '}
              {deptActTotal > project.actualHours ? 'more' : 'less'} than the tracked total — some time was
              logged without a department.
            </div>
          )}
          {hasDeptRows && Math.abs(deptEstTotal - project.estimatedHours) > 0.6 && (
            <div className="mt-1 text-xs text-[#6B7280]">
              Estimated by department adds to {hrs(deptEstTotal)} against {hrs(project.estimatedHours)} on the
              estimate.
            </div>
          )}
        </div>

        {/* ═══ MATERIALS ═══ */}
        <div className="px-6 py-5 border-b border-[#E5E7EB]">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Materials</div>
            {/* ⚠️ THIS LINKS TO THE ESTIMATE — THE BUDGET'S MANIFEST, NOT THE
                SPEND'S. There is no per-project material purchase view anywhere
                in the app, and the `invoices` table that spend is read from is
                empty org-wide. Linking the half that exists, and saying so
                below, beats a "see the spend" link that opens nothing. */}
            <Link
              href={`/projects/${project.projectId}`}
              className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
            >
              See the estimate →
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-0.5">Budget</div>
              <div className="text-base font-medium font-mono tabular-nums text-[#111]">{fmtMoney(matBudget)}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-0.5">Spend</div>
              <div className="text-base font-medium font-mono tabular-nums text-[#111]">
                {matUnrecorded ? '—' : fmtMoney(matActual)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-0.5">
                Over / under
              </div>
              <div
                className="text-base font-medium font-mono tabular-nums"
                style={{
                  color: matUnrecorded
                    ? '#6B7280'
                    : matDelta > 0
                      ? '#DC2626'
                      : matDelta < 0
                        ? '#059669'
                        : '#6B7280',
                }}
              >
                {matUnrecorded ? '—' : `${matDelta > 0 ? '+' : ''}${fmtMoney(matDelta)}`}
              </div>
            </div>
          </div>

          {matUnrecorded && (
            // ⛔ THE HONEST RENDERING OF A MISSING NUMBER. The outcome writer
            // substitutes the budget when no material invoice is attached, so
            // showing "$0 over — on budget" here would invent a fact.
            <p className="mt-3 text-xs text-[#6B7280] leading-relaxed">
              No material invoices are attached to this job, so actual spend was never recorded. The margin
              above was calculated using the budget figure in its place.
            </p>
          )}
        </div>

        {/* ═══ ESTIMATE HIT / MISS ═══ */}
        <div className="px-6 py-5">
          <div
            className="rounded-xl p-4 border"
            style={{
              background: onEstimate ? '#EAF3DE' : '#FAECE7',
              borderColor: onEstimate ? '#97C459' : '#F09595',
            }}
          >
            <div
              className="text-xs font-medium uppercase tracking-wide mb-1"
              style={{ color: onEstimate ? '#3B6D11' : '#A32D2D' }}
            >
              {onEstimate ? 'Estimate hit' : 'Estimate miss'}
            </div>
            <p className="text-sm" style={{ color: onEstimate ? '#3B6D11' : '#A32D2D' }}>
              {hoursPct === null
                ? 'No hours were estimated for this job, so there is nothing to compare the tracked time against.'
                : onEstimate
                  ? 'Within 5% of estimated hours. Execution matched the plan.'
                  : `${Math.abs(hoursPct - 100).toFixed(0)}% ${
                      project.actualHours > project.estimatedHours ? 'over' : 'under'
                    } estimated hours. ${
                      project.actualHours > project.estimatedHours
                        ? 'Either the estimate was low or execution ran long — or both.'
                        : 'Either the estimate was padded or the crew moved fast.'
                    }`}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

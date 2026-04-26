'use client'

import type { ShopGradeResult } from '@/lib/reports/gradeCalculations'

export default function ShopGrade({ grade }: { grade: ShopGradeResult }) {
  const { estimating, utilization } = grade
  // Need at least 3 completed projects before a grade is meaningful.
  // Below the floor we render the placeholder card so the section still
  // anchors the page but doesn't lie about a non-existent shop grade.
  if (estimating.totalCount < 3) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
        <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-4">
          Shop grade
        </div>
        <div className="flex items-start gap-6">
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-medium bg-[#F3F4F6] text-[#9CA3AF]">
              —
            </div>
            <span className="text-xs text-[#9CA3AF]">Overall</span>
          </div>
          <div className="flex-1 text-sm text-[#374151] leading-relaxed">
            Need at least 3 completed projects to grade your shop.
            You have <span className="font-semibold text-[#111]">{estimating.totalCount}</span>.
          </div>
        </div>
      </div>
    )
  }
  const estBarWidth = estimating.score
  const utilBarWidth = utilization.isCapped ? estimating.score : utilization.rawScore

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-4">Shop grade</div>
      <div className="flex items-start gap-6">
        {/* Grade letter */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <div
            className="w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-medium"
            style={{ background: grade.colors.bg, color: grade.colors.text }}
          >
            {grade.grade}
          </div>
          <span className="text-xs text-[#9CA3AF]">Overall</span>
        </div>

        {/* Bars */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Estimating accuracy */}
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-medium text-[#111]">Estimating accuracy</span>
              <span className="text-sm font-medium" style={{ color: estimating.colors.text }}>
                {estimating.grade}
              </span>
            </div>
            <div className="h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(estBarWidth, 3)}%`, background: estimating.colors.fill }}
              />
            </div>
            <div className="text-xs text-[#6B7280] mt-1">
              {estimating.hitCount} of {estimating.totalCount} projects within 5% of estimate
              {estimating.avgVariancePct !== 0 && (
                <> &middot; avg {Math.abs(estimating.avgVariancePct)}% {estimating.avgVariancePct > 0 ? 'over' : 'under'} on hours</>
              )}
            </div>
          </div>

          {/* Cap indicator */}
          {utilization.isCapped && (
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-dashed border-[#D1D5DB]" />
              <span className="text-[11px] text-[#9CA3AF] whitespace-nowrap">utilization capped here</span>
              <div className="flex-1 border-t border-dashed border-[#D1D5DB]" />
            </div>
          )}

          {/* Crew utilization */}
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-medium text-[#111]">Crew utilization</span>
              <span className="text-sm font-medium" style={{ color: utilization.colors.text }}>
                {utilization.cappedGrade}
                {utilization.isCapped && (
                  <span className="text-xs font-normal text-[#9CA3AF] ml-1">
                    (raw: {utilization.utilizationPct}%)
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(utilBarWidth, 3)}%`,
                  background: utilization.colors.fill,
                }}
              />
            </div>
            <div className="text-xs text-[#6B7280] mt-1">
              {utilization.isCapped
                ? `${utilization.utilizationPct}% utilization would be a ${utilization.rawGrade} on its own, but capped by estimating accuracy`
                : `${utilization.utilizationPct}% crew utilization`
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

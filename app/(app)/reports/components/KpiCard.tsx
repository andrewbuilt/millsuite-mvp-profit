'use client'

export default function KpiCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
  return (
    <div className="bg-[#F9FAFB] rounded-xl px-4 py-3.5">
      <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1">{label}</div>
      <div
        className="text-xl font-medium font-mono tabular-nums"
        style={{ color: valueColor || '#111' }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-[#6B7280] mt-0.5">{sub}</div>}
    </div>
  )
}

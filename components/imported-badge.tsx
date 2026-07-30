// ============================================================================
// ImportedBadge — marks a project that came from Built OS (6c item 2).
// ============================================================================
// Imported jobs were priced in Built's rate book, not MillSuite's composer, so
// their estimate internals won't look like native work. The badge keeps that
// obvious wherever a project is listed (dashboard cards, sales kanban) or
// opened (project detail header).
// ============================================================================

export default function ImportedBadge({
  importedAt,
  className = '',
}: {
  importedAt?: string | null
  className?: string
}) {
  if (!importedAt) return null
  const when = (() => {
    try {
      return new Date(importedAt).toLocaleDateString()
    } catch {
      return null
    }
  })()
  return (
    <span
      title={
        when
          ? `Imported from Built OS on ${when} — priced in Built, not the MillSuite composer`
          : 'Imported from Built OS — priced in Built, not the MillSuite composer'
      }
      className={
        'inline-flex items-center shrink-0 text-[9.5px] font-semibold uppercase tracking-wider ' +
        'px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] ' +
        className
      }
    >
      Imported
    </span>
  )
}

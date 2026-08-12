// ============================================================================
// PracticeBadge — marks a project the first-job walkthrough created.
// ============================================================================
// Deliberately louder than ImportedBadge (amber, not grey): an imported job is
// real work with an unusual history, while a practice job is not work at all.
// Anyone looking at a list needs to know at a glance which numbers count.
// ============================================================================

// Unlike ImportedBadge this takes no timestamp: practice ids are read as a set
// (see hooks/usePracticeProjects for why practice_at can't ride along in the
// page's own select), so the caller already knows the answer and there's
// nothing useful to render from the date.
export default function PracticeBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Practice project from a walkthrough — left out of reports, capacity and the dashboard. Delete it from Manage → Guides."
      className={
        'inline-flex items-center shrink-0 text-[9.5px] font-semibold uppercase tracking-wider ' +
        'px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] ' +
        className
      }
    >
      Practice
    </span>
  )
}

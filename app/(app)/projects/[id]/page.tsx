// ============================================================================
// /projects/[id] — the project cover
// ============================================================================
// Phase A of the big estimating rebuild collapsed projects.status +
// projects.production_phase into a single projects.stage field (migration 016)
// and killed the 900-line legacy Excel-style detail page this slot used to
// hold. The rollup page already matches the mockup shape (subproject cards,
// sticky financial panel, QB preview, custom milestones, mark-as-sold) so we
// route here → /rollup until Phase B merges the two into one stage-aware
// surface with the 5-node stage strip on top.
// ============================================================================

import { redirect } from 'next/navigation'

export default async function ProjectCoverPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string }
}) {
  const { id } = await Promise.resolve(params)
  redirect(`/projects/${id}/rollup`)
}

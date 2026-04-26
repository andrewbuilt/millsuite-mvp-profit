// ============================================================================
// lib/schedule-seed.ts — seed department_allocations on auto-advance
// ============================================================================
// Stub for PR1 of the schedule overhaul. Real implementation lands in PR2:
// reads subproject hours, fans out one allocation row per (subproject × dept),
// then runs the existing schedule-engine placement to land each row in the
// next available slot. Until PR2 ships, the no-op keeps maybeAdvanceToProduction
// callable end-to-end so the stage flip + toast can be verified independently.
// ============================================================================

export async function seedAllocationsForProduction(projectId: string): Promise<void> {
  void projectId
}

import { assertOperationalMemoryEntry, type OperationalMemoryEntry } from "./contracts";

export type ReplacementContinuationPhase =
  | "handoff_published"
  | "replacement_started"
  | "replacement_healthy"
  | "handoff_acknowledged"
  | "old_parent_retired"
  | "failed";

export interface ReplacementContinuationEvidence {
  phase: ReplacementContinuationPhase;
  lastCompletedPhase: Exclude<ReplacementContinuationPhase, "failed"> | null;
  replacementLocated: boolean;
  oldParentRetired: boolean;
  handoff?: OperationalMemoryEntry;
}

export interface ReplacementFirstContinuationOptions<Replacement, Session> {
  publishTypedHandoff(): Promise<void>;
  locateReplacement?(): Promise<Replacement | undefined>;
  launchReplacement(): Promise<Replacement>;
  verifyReplacementHealth(replacement: Replacement): Promise<void>;
  createReplacementSession(replacement: Replacement): Promise<Session>;
  acknowledgeHandoff(replacement: Replacement, session: Session): Promise<OperationalMemoryEntry>;
  retireOldParent(): Promise<void>;
  persistEvidence(evidence: ReplacementContinuationEvidence): void | Promise<void>;
}

export async function continueWithReplacementFirst<Replacement, Session>(
  options: ReplacementFirstContinuationOptions<Replacement, Session>,
): Promise<{ replacement: Replacement; session: Session; handoff: OperationalMemoryEntry }> {
  let lastCompletedPhase: Exclude<ReplacementContinuationPhase, "failed"> | null = null;
  let replacementLocated = false;
  let oldParentRetired = false;
  let acknowledgedHandoff: OperationalMemoryEntry | undefined;

  const persist = async (
    phase: Exclude<ReplacementContinuationPhase, "failed">,
    handoff?: OperationalMemoryEntry,
  ): Promise<void> => {
    lastCompletedPhase = phase;
    await options.persistEvidence({ phase, lastCompletedPhase, replacementLocated, oldParentRetired, handoff });
  };

  try {
    await options.publishTypedHandoff();
    await persist("handoff_published");

    const located = await options.locateReplacement?.();
    const replacement = located ?? await options.launchReplacement();
    replacementLocated = true;
    await persist("replacement_started");

    await options.verifyReplacementHealth(replacement);
    await persist("replacement_healthy");

    const session = await options.createReplacementSession(replacement);
    const handoff = await options.acknowledgeHandoff(replacement, session);
    assertOperationalMemoryEntry(handoff);
    acknowledgedHandoff = handoff;
    await persist("handoff_acknowledged", handoff);

    await options.retireOldParent();
    oldParentRetired = true;
    await persist("old_parent_retired", handoff);
    return { replacement, session, handoff };
  } catch (error) {
    try {
      await options.persistEvidence({
        phase: "failed",
        lastCompletedPhase,
        replacementLocated,
        oldParentRetired,
        handoff: acknowledgedHandoff,
      });
    } catch {}
    throw error;
  }
}

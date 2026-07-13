import type { TilingPolicy, WindowFact, WindowInspection } from "./contracts.js";
import { copyRect } from "./geometry.js";
import { classifyParticipation, effectiveParticipation } from "./participation.js";

export function inspectWindowFact(
  fact: WindowFact,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>,
  previous?: WindowInspection
): WindowInspection {
  const classification = classifyParticipation(fact, policy);
  const manualParticipation = previous?.manualParticipation;
  const candidate: WindowInspection = {
    id: fact.id,
    surfaceId: fact.surfaceId,
    participating: false,
    policyParticipation: classification.participating,
    policyParticipationSource: classification.source,
    ...(manualParticipation !== undefined ? { manualParticipation } : {}),
    participationSource: manualParticipation === undefined ? classification.source : "manual",
    available: fact.available,
    frame: copyRect(fact.frame),
    capabilities: { ...fact.capabilities },
    ...(fact.applicationId ? { applicationId: fact.applicationId } : {}),
    ...(fact.title ? { title: fact.title } : {}),
    ...(fact.role ? { role: fact.role } : {}),
    ...(fact.transientParentId ? { transientParentId: fact.transientParentId } : {}),
    ...(fact.resizable !== undefined ? { resizable: fact.resizable } : {}),
    tags: [...(fact.tags ?? [])],
    reconcileAttempts: previous?.reconcileAttempts ?? 0,
  };
  return {
    ...candidate,
    participating: effectiveParticipation(candidate, policy, availableSurfaces),
  };
}

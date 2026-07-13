import type {
  TilingEvent,
  TilingInspection,
  TilingIntention,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { copyPolicy } from "./copy.js";
import { copyRect, deriveContainerPlans, deriveWindowPlans, sameRect } from "./geometry.js";
import { changedContainerIntentions } from "./intentions.js";
import { classifyParticipation, effectiveParticipation } from "./participation.js";
import { normalizeTopology, tilingSurfaceIds } from "./transition-helpers.js";

type PolicyEvent = Extract<TilingEvent, { type: "PolicyReplaced" }>;
type CommitCandidate = (candidate: TilingInspection) => void;

export function applyPolicy(
  inspection: TilingInspection,
  event: PolicyEvent,
  commitCandidate: CommitCandidate
): TilingTransition {
  if (JSON.stringify(event.policy) === JSON.stringify(inspection.policy)) {
    return {
      status: "ignored",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [],
    };
  }

  const nextPolicy = copyPolicy(event.policy);
  const availableSurfaces = tilingSurfaceIds(inspection.surfaces);
  const participationChanges: Array<{
    windowId: WindowInspection["id"];
    participating: boolean;
  }> = [];
  const placementHints = [...inspection.placementHints];
  const windows = inspection.windows.map((window) => {
    const classification = classifyParticipation(window, nextPolicy);
    const classifiedWindow = {
      ...window,
      policyParticipation: classification.participating,
      policyParticipationSource: classification.source,
      participationSource:
        window.manualParticipation === undefined ? classification.source : "manual",
    };
    const participating = effectiveParticipation(classifiedWindow, nextPolicy, availableSurfaces);
    if (participating === window.participating) {
      return { ...classifiedWindow, participating };
    }
    participationChanges.push({ windowId: window.id, participating });
    if (!participating) {
      placementHints.push({
        windowId: window.id,
        surfaceId: window.surfaceId,
        ...(window.parentId ? { parentId: window.parentId } : {}),
        selected: false,
      });
      return { ...classifiedWindow, participating: false, parentId: undefined };
    }
    const surface = inspection.surfaces.find((candidate) => candidate.id === window.surfaceId);
    const hintedParent = [...placementHints]
      .reverse()
      .find(
        (hint) =>
          hint.windowId === window.id &&
          hint.surfaceId === window.surfaceId &&
          inspection.containers.some(
            (container) =>
              container.id === hint.parentId && container.surfaceId === window.surfaceId
          )
      )?.parentId;
    return {
      ...classifiedWindow,
      participating: true,
      parentId: hintedParent ?? surface?.rootId,
    };
  });
  const containers = normalizeTopology(
    inspection.containers.map((container) => {
      const desired = windows
        .filter((window) => window.participating && window.parentId === container.id)
        .map((window) => window.id);
      const nested = inspection.containers
        .filter((candidate) => candidate.parentId === container.id)
        .map((candidate) => candidate.id);
      const desiredSet = new Set<string>([...desired, ...nested]);
      const retained = container.childIds.filter((id) => desiredSet.has(id));
      const retainedSet = new Set<string>(retained);
      return {
        ...container,
        childIds: [
          ...retained,
          ...nested.filter((id) => !retainedSet.has(id)),
          ...desired.filter((id) => !retainedSet.has(id)),
        ],
      };
    }),
    windows
  );
  const revision = inspection.revision + 1;
  const windowPlans = deriveWindowPlans(inspection.surfaces, windows, containers, nextPolicy);
  const intentions: TilingIntention[] = [
    ...participationChanges.map((change) => ({
      type: "WindowParticipationChanged" as const,
      revision,
      ordinal: 0,
      ...change,
    })),
    ...windowPlans
      .filter((plan) => {
        const previous = inspection.renderPlan.windows.find((window) => window.id === plan.id);
        return (
          !previous ||
          previous.surfaceId !== plan.surfaceId ||
          !sameRect(previous.frame, plan.frame)
        );
      })
      .map((plan) => ({
        type: "PlaceWindow" as const,
        revision,
        ordinal: 0,
        windowId: plan.id,
        surfaceId: plan.surfaceId,
        frame: copyRect(plan.frame),
      })),
  ].map((intention, ordinal) => ({ ...intention, ordinal }));
  const containerPlans = deriveContainerPlans(inspection.surfaces, windows, containers, nextPolicy);
  intentions.push(
    ...changedContainerIntentions(
      inspection.renderPlan.containers,
      containerPlans,
      revision,
      intentions.length
    )
  );

  commitCandidate({
    ...inspection,
    revision,
    policy: nextPolicy,
    windows,
    containers,
    operations: inspection.operations.filter(
      (operation) =>
        !participationChanges.some((change) =>
          operation.affectedWindowIds.includes(change.windowId)
        )
    ),
    placementHints,
    renderPlan: {
      ...inspection.renderPlan,
      revision,
      windows: windowPlans,
      containers: containerPlans,
    },
  });
  return { status: "committed", revision, intentions, diagnostics: [] };
}

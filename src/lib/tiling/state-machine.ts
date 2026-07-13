import type {
  ContainerId,
  ContainerInspection,
  SurfaceInspection,
  TilingEvent,
  TilingInspection,
  TilingPolicy,
  TilingStateMachine,
  TilingTransition,
  WindowFact,
  WindowInspection,
} from "./contracts.js";
import { copyInspection, copyPolicy } from "./copy.js";
import { copyRect, deriveWindowPlans, sameRect } from "./geometry.js";
import { validateSurfaces } from "./validation.js";

function shouldParticipate(
  window: WindowFact,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>
): boolean {
  if (!policy.enabled || !availableSurfaces.has(window.surfaceId)) return false;
  return policy.surfaceTiling[window.surfaceId] !== false;
}

function inspectionShouldParticipate(
  window: WindowInspection,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>
): boolean {
  if (!policy.enabled || !availableSurfaces.has(window.surfaceId)) return false;
  return policy.surfaceTiling[window.surfaceId] !== false;
}

export function createTilingStateMachine(initialPolicy: TilingPolicy): TilingStateMachine {
  const policy = copyPolicy(initialPolicy);
  let nextContainer = 1;
  let inspection: TilingInspection = {
    schemaVersion: 1,
    revision: 0,
    policy,
    surfaces: [],
    windows: [],
    containers: [],
    operations: [],
    placementHints: [],
    evacuationHints: [],
    renderPlan: {
      revision: 0,
      surfaces: [],
      windows: [],
      containers: [],
      previews: [],
    },
    diagnostics: [],
  };

  return {
    dispatch(event: TilingEvent): TilingTransition {
      if (event.type === "PolicyReplaced") {
        if (JSON.stringify(event.policy) === JSON.stringify(inspection.policy)) {
          return {
            status: "ignored",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [],
          };
        }

        const nextPolicy = copyPolicy(event.policy);
        const availableSurfaces = new Set(inspection.surfaces.map((surface) => surface.id));
        const participationChanges: Array<{
          windowId: WindowInspection["id"];
          participating: boolean;
        }> = [];
        const placementHints = [...inspection.placementHints];
        const windows = inspection.windows.map((window) => {
          const participating = inspectionShouldParticipate(window, nextPolicy, availableSurfaces);
          if (participating === window.participating) return window;
          participationChanges.push({ windowId: window.id, participating });
          if (!participating) {
            placementHints.push({
              windowId: window.id,
              surfaceId: window.surfaceId,
              ...(window.parentId ? { parentId: window.parentId } : {}),
              selected: false,
            });
            return { ...window, participating: false, parentId: undefined };
          }
          const surface = inspection.surfaces.find(
            (candidate) => candidate.id === window.surfaceId
          );
          return { ...window, participating: true, parentId: surface?.rootId };
        });
        const containers = inspection.containers.map((container) => ({
          ...container,
          childIds: windows
            .filter((window) => window.participating && window.parentId === container.id)
            .map((window) => window.id),
        }));
        const revision = inspection.revision + 1;
        const windowPlans = deriveWindowPlans(inspection.surfaces, windows, containers, nextPolicy);
        const intentions = [
          ...participationChanges.map((change) => ({
            type: "WindowParticipationChanged" as const,
            revision,
            ordinal: 0,
            ...change,
          })),
          ...windowPlans
            .filter((plan) => {
              const previous = inspection.renderPlan.windows.find(
                (window) => window.id === plan.id
              );
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

        inspection = {
          ...inspection,
          revision,
          policy: nextPolicy,
          windows,
          containers,
          placementHints,
          renderPlan: {
            ...inspection.renderPlan,
            revision,
            windows: windowPlans,
            containers: inspection.renderPlan.containers.map((container) => {
              const stateContainer = containers.find((candidate) => candidate.id === container.id)!;
              return { ...container, layout: stateContainer.layout };
            }),
          },
        };
        return { status: "committed", revision, intentions, diagnostics: [] };
      }

      if (event.type === "FactsObserved") {
        const windows: WindowInspection[] = [...inspection.windows];
        let changed = false;
        for (const fact of event.facts) {
          if (fact.type === "WindowAvailabilityObserved") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0 || windows[index].available === fact.available) continue;
            windows[index] = { ...windows[index], available: fact.available };
            changed = true;
          }
        }
        if (!changed) {
          return {
            status: "ignored",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [],
          };
        }

        const revision = inspection.revision + 1;
        const windowPlans = deriveWindowPlans(
          inspection.surfaces,
          windows,
          inspection.containers,
          inspection.policy
        );
        const intentions = windowPlans
          .filter((plan) => {
            const previous = inspection.renderPlan.windows.find((window) => window.id === plan.id);
            return (
              !previous ||
              previous.surfaceId !== plan.surfaceId ||
              !sameRect(previous.frame, plan.frame)
            );
          })
          .map((plan, ordinal) => ({
            type: "PlaceWindow" as const,
            revision,
            ordinal,
            windowId: plan.id,
            surfaceId: plan.surfaceId,
            frame: copyRect(plan.frame),
          }));
        inspection = {
          ...inspection,
          revision,
          windows,
          renderPlan: { ...inspection.renderPlan, revision, windows: windowPlans },
        };
        return { status: "committed", revision, intentions, diagnostics: [] };
      }

      if (event.type === "PlatformSnapshotObserved") {
        const invalid = validateSurfaces(event.snapshot.surfaces);
        if (invalid) {
          return {
            status: "rejected",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [{ code: "invalid-surface", message: invalid }],
          };
        }

        const revision = inspection.revision + 1;
        const surfaces: SurfaceInspection[] = [];
        const containers: ContainerInspection[] = [];
        const surfaceRoots = new Map<string, ContainerId>();
        for (const surface of [...event.snapshot.surfaces].sort((a, b) =>
          a.id.localeCompare(b.id)
        )) {
          const rootId = `container:${nextContainer++}` as ContainerId;
          surfaces.push({
            id: surface.id,
            workArea: copyRect(surface.workArea),
            rootId,
            neighbors: { ...surface.neighbors },
          });
          containers.push({
            id: rootId,
            surfaceId: surface.id,
            layout: policy.defaultLayout,
            childIds: [],
            weights: {},
          });
          surfaceRoots.set(surface.id, rootId);
        }

        const surfaceIds = new Set(surfaces.map((surface) => surface.id));
        const windows: WindowInspection[] = [...event.snapshot.windows]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((window) => {
            const participating = shouldParticipate(window, policy, surfaceIds);
            const parentId = participating ? surfaceRoots.get(window.surfaceId) : undefined;
            if (parentId) {
              const parentIndex = containers.findIndex((container) => container.id === parentId);
              const parent = containers[parentIndex];
              containers[parentIndex] = { ...parent, childIds: [...parent.childIds, window.id] };
            }
            return {
              id: window.id,
              surfaceId: window.surfaceId,
              ...(parentId ? { parentId } : {}),
              participating,
              available: window.available,
              frame: copyRect(window.frame),
            };
          });

        const windowPlans = deriveWindowPlans(surfaces, windows, containers, policy);

        const intentions = [
          ...windows
            .filter((window) => window.participating)
            .map((window) => ({
              type: "WindowParticipationChanged" as const,
              revision,
              ordinal: 0,
              windowId: window.id,
              participating: true,
            })),
          ...windowPlans.map((window) => ({
            type: "PlaceWindow" as const,
            revision,
            ordinal: 0,
            windowId: window.id,
            surfaceId: window.surfaceId,
            frame: copyRect(window.frame),
          })),
        ].map((intention, ordinal) => ({ ...intention, ordinal }));

        inspection = {
          ...inspection,
          revision,
          surfaces,
          windows,
          containers,
          renderPlan: {
            revision,
            surfaces: surfaces.map((surface) => ({
              id: surface.id,
              workArea: copyRect(surface.workArea),
            })),
            windows: windowPlans,
            containers: containers.map((container) => ({
              id: container.id,
              surfaceId: container.surfaceId,
              rect: copyRect(
                surfaces.find((surface) => surface.id === container.surfaceId)!.workArea
              ),
              layout: container.layout,
              stackingOrder: [],
            })),
            previews: [],
          },
        };
        return { status: "committed", revision, intentions, diagnostics: [] };
      }
      return {
        status: "ignored",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [],
      };
    },
    inspect(): TilingInspection {
      return copyInspection(inspection);
    },
  };
}

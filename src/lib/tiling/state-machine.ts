import type {
  ContainerId,
  ContainerInspection,
  SurfaceInspection,
  TilingEvent,
  TilingInspection,
  TilingPolicy,
  TilingStateMachine,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { copyInspection, copyPolicy } from "./copy.js";
import { copyRect, deriveContainerPlans, deriveWindowPlans, sameRect } from "./geometry.js";
import { changedPlacementIntentions } from "./intentions.js";
import { applyOperation } from "./operations.js";
import { classifyParticipation, effectiveParticipation } from "./participation.js";
import { reconcile } from "./reconciliation.js";
import { validateSurfaces } from "./validation.js";

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
      if (event.type === "ReconcileRequested") {
        const result = reconcile(inspection, event.surfaceId);
        inspection = result.inspection;
        return result.transition;
      }

      if (
        event.type === "OperationStarted" ||
        event.type === "OperationUpdated" ||
        event.type === "OperationCommitted" ||
        event.type === "OperationCancelled"
      ) {
        const result = applyOperation(inspection, event);
        inspection = result.inspection;
        return result.transition;
      }

      if (event.type === "CommandRequested") {
        const command = event.command;
        if (command.type === "SetParticipation") {
          const windowIndex = inspection.windows.findIndex(
            (candidate) => candidate.id === command.windowId
          );
          if (windowIndex < 0) {
            return {
              status: "rejected",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [
                {
                  code: "unknown-window",
                  message: "SetParticipation requires a known window",
                  identity: command.windowId,
                },
              ],
            };
          }
          const current = inspection.windows[windowIndex];
          const manualParticipation = command.participating ?? undefined;
          if (manualParticipation === current.manualParticipation) {
            return {
              status: "ignored",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [],
            };
          }
          const availableSurfaces = new Set(inspection.surfaces.map((surface) => surface.id));
          const candidate: WindowInspection = {
            ...current,
            manualParticipation,
            participationSource:
              manualParticipation === undefined ? current.policyParticipationSource : "manual",
          };
          const participating = effectiveParticipation(
            candidate,
            inspection.policy,
            availableSurfaces
          );
          let placementHints = [...inspection.placementHints];
          if (current.participating && !participating) {
            placementHints = placementHints.filter((hint) => hint.windowId !== current.id);
            placementHints.push({
              windowId: current.id,
              surfaceId: current.surfaceId,
              ...(current.parentId ? { parentId: current.parentId } : {}),
              selected: false,
            });
          }
          const surface = inspection.surfaces.find(
            (candidateSurface) => candidateSurface.id === current.surfaceId
          );
          const nextWindow: WindowInspection = {
            ...candidate,
            participating,
            ...(participating && surface ? { parentId: surface.rootId } : { parentId: undefined }),
          };
          const windows = [...inspection.windows];
          windows[windowIndex] = nextWindow;
          const containers = inspection.containers.map((container) => {
            const childIds = container.childIds.filter((id) => id !== current.id);
            return container.id === nextWindow.parentId
              ? { ...container, childIds: [...childIds, current.id] }
              : { ...container, childIds };
          });
          const revision = inspection.revision + 1;
          const windowPlans = deriveWindowPlans(
            inspection.surfaces,
            windows,
            containers,
            inspection.policy
          );
          const participationIntentions =
            participating === current.participating
              ? []
              : [
                  {
                    type: "WindowParticipationChanged" as const,
                    revision,
                    ordinal: 0,
                    windowId: current.id,
                    participating,
                  },
                ];
          const placementIntentions = changedPlacementIntentions(
            inspection.renderPlan.windows,
            windowPlans,
            revision,
            participationIntentions.length
          );
          inspection = {
            ...inspection,
            revision,
            windows,
            containers,
            operations: inspection.operations.filter(
              (operation) =>
                operation.windowId !== current.id && operation.neighborWindowId !== current.id
            ),
            placementHints,
            renderPlan: {
              ...inspection.renderPlan,
              revision,
              windows: windowPlans,
              containers: deriveContainerPlans(inspection.surfaces, containers),
            },
          };
          return {
            status: "committed",
            revision,
            intentions: [...participationIntentions, ...placementIntentions],
            diagnostics: [],
          };
        }

        if (command.type === "FocusDirection") {
          const window = inspection.windows.find((candidate) => candidate.id === command.windowId);
          const containerIndex = inspection.containers.findIndex(
            (container) => container.id === window?.parentId
          );
          if (!window?.participating || containerIndex < 0) {
            return {
              status: "rejected",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [
                {
                  code: "invalid-focus-command",
                  message: "FocusDirection requires a participating window",
                  identity: command.windowId,
                },
              ],
            };
          }
          const container = inspection.containers[containerIndex];
          const candidates = container.childIds.filter((id) =>
            inspection.windows.some(
              (candidate) => candidate.id === id && candidate.participating && candidate.available
            )
          );
          const currentIndex = candidates.indexOf(window.id);
          const delta = command.direction === "left" || command.direction === "up" ? -1 : 1;
          const targetId = candidates[currentIndex + delta];
          if (!targetId) {
            return {
              status: "ignored",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [],
            };
          }
          const revision = inspection.revision + 1;
          const containers = [...inspection.containers];
          containers[containerIndex] = { ...container, selectedChildId: targetId };
          inspection = {
            ...inspection,
            revision,
            containers,
            renderPlan: {
              ...inspection.renderPlan,
              revision,
              containers: inspection.renderPlan.containers.map((plan) =>
                plan.id === container.id ? { ...plan, selectedChildId: targetId } : plan
              ),
            },
          };
          return {
            status: "committed",
            revision,
            intentions: [
              {
                type: "FocusWindow",
                revision,
                ordinal: 0,
                windowId: targetId as WindowInspection["id"],
              },
            ],
            diagnostics: [],
          };
        }

        if (command.type === "MoveDirection" || command.type === "SwapDirection") {
          const window = inspection.windows.find((candidate) => candidate.id === command.windowId);
          const containerIndex = inspection.containers.findIndex(
            (container) => container.id === window?.parentId
          );
          if (!window?.participating || containerIndex < 0) {
            return {
              status: "rejected",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [
                {
                  code: "invalid-move-command",
                  message: `${command.type} requires a participating window`,
                  identity: command.windowId,
                },
              ],
            };
          }
          const container = inspection.containers[containerIndex];
          const horizontal = container.layout === "horizontal";
          const compatible = horizontal
            ? command.direction === "left" || command.direction === "right"
            : command.direction === "up" || command.direction === "down";
          const delta = command.direction === "left" || command.direction === "up" ? -1 : 1;
          const currentIndex = container.childIds.indexOf(window.id);
          const targetIndex = currentIndex + delta;
          if (!compatible || targetIndex < 0 || targetIndex >= container.childIds.length) {
            return {
              status: "ignored",
              revision: inspection.revision,
              intentions: [],
              diagnostics: [],
            };
          }
          const childIds = [...container.childIds];
          [childIds[currentIndex], childIds[targetIndex]] = [
            childIds[targetIndex],
            childIds[currentIndex],
          ];
          const containers = [...inspection.containers];
          containers[containerIndex] = { ...container, childIds };
          const revision = inspection.revision + 1;
          const windowPlans = deriveWindowPlans(
            inspection.surfaces,
            inspection.windows,
            containers,
            inspection.policy
          );
          const intentions = changedPlacementIntentions(
            inspection.renderPlan.windows,
            windowPlans,
            revision
          );
          inspection = {
            ...inspection,
            revision,
            containers,
            renderPlan: {
              ...inspection.renderPlan,
              revision,
              windows: windowPlans,
              containers: inspection.renderPlan.containers.map((plan) =>
                plan.id === container.id ? { ...plan, stackingOrder: childIds } : plan
              ),
            },
          };
          return { status: "committed", revision, intentions, diagnostics: [] };
        }

        const window = inspection.windows.find((candidate) => candidate.id === command.windowId);
        const containerIndex = inspection.containers.findIndex(
          (container) => container.id === window?.parentId
        );
        if (
          !window?.participating ||
          containerIndex < 0 ||
          !inspection.policy.allowedLayouts.includes(command.layout)
        ) {
          return {
            status: "rejected",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [
              {
                code: "invalid-layout-command",
                message: "SetLayout requires a participating window and an allowed layout",
                identity: command.windowId,
              },
            ],
          };
        }
        const current = inspection.containers[containerIndex];
        if (current.layout === command.layout) {
          return {
            status: "ignored",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [],
          };
        }
        const containers = [...inspection.containers];
        containers[containerIndex] = { ...current, layout: command.layout };
        const revision = inspection.revision + 1;
        const windowPlans = deriveWindowPlans(
          inspection.surfaces,
          inspection.windows,
          containers,
          inspection.policy
        );
        const placement = changedPlacementIntentions(
          inspection.renderPlan.windows,
          windowPlans,
          revision
        );
        const present = {
          type: "PresentContainer" as const,
          revision,
          ordinal: placement.length,
          containerId: current.id,
          surfaceId: current.surfaceId,
          layout: command.layout,
          ...(current.selectedChildId ? { selectedChildId: current.selectedChildId } : {}),
          stackingOrder: [...current.childIds],
        };
        inspection = {
          ...inspection,
          revision,
          containers,
          renderPlan: {
            ...inspection.renderPlan,
            revision,
            windows: windowPlans,
            containers: inspection.renderPlan.containers.map((container) =>
              container.id === current.id
                ? {
                    ...container,
                    layout: command.layout,
                    stackingOrder: [...current.childIds],
                  }
                : container
            ),
          },
        };
        return {
          status: "committed",
          revision,
          intentions: [...placement, present],
          diagnostics: [],
        };
      }

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
          const classification = classifyParticipation(window, nextPolicy);
          const classifiedWindow = {
            ...window,
            policyParticipation: classification.participating,
            policyParticipationSource: classification.source,
            participationSource:
              window.manualParticipation === undefined ? classification.source : "manual",
          };
          const participating = effectiveParticipation(
            classifiedWindow,
            nextPolicy,
            availableSurfaces
          );
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
          const surface = inspection.surfaces.find(
            (candidate) => candidate.id === window.surfaceId
          );
          return { ...classifiedWindow, participating: true, parentId: surface?.rootId };
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
        let surfaces = [...inspection.surfaces];
        let containers = [...inspection.containers];
        let placementHints = [...inspection.placementHints];
        let evacuationHints = [...inspection.evacuationHints];
        let operations = [...inspection.operations];
        const participationChanges: Array<{
          windowId: WindowInspection["id"];
          participating: boolean;
        }> = [];
        let changed = false;
        for (const fact of event.facts) {
          if (fact.type === "WindowAvailabilityObserved") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0 || windows[index].available === fact.available) continue;
            windows[index] = { ...windows[index], available: fact.available };
            if (!fact.available) {
              operations = operations.filter(
                (operation) =>
                  operation.windowId !== fact.windowId &&
                  operation.neighborWindowId !== fact.windowId
              );
            }
            changed = true;
          }
          if (fact.type === "FrameObserved") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0) continue;
            const window = windows[index];
            if (sameRect(window.frame, fact.frame) && window.reconcileAttempts === 0) continue;
            windows[index] = {
              ...window,
              frame: copyRect(fact.frame),
              reconcileAttempts: 0,
            };
            changed = true;
          }
          if (fact.type === "WindowWithdrawn") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0) continue;
            windows.splice(index, 1);
            containers = containers.map((container) => ({
              ...container,
              childIds: container.childIds.filter((id) => id !== fact.windowId),
              ...(container.selectedChildId === fact.windowId
                ? { selectedChildId: undefined }
                : {}),
            }));
            placementHints = placementHints.filter((hint) => hint.windowId !== fact.windowId);
            operations = operations.filter(
              (operation) =>
                operation.windowId !== fact.windowId && operation.neighborWindowId !== fact.windowId
            );
            evacuationHints = evacuationHints.map((hint) => ({
              ...hint,
              windowIds: hint.windowIds.filter((id) => id !== fact.windowId),
              childIds: hint.childIds.filter((id) => id !== fact.windowId),
            }));
            changed = true;
          }
          if (fact.type === "SurfaceWithdrawn") {
            const surfaceIndex = surfaces.findIndex((surface) => surface.id === fact.surfaceId);
            if (surfaceIndex < 0) continue;
            const surface = surfaces[surfaceIndex];
            const root = containers.find((container) => container.id === surface.rootId);
            const affected = windows.filter((window) => window.surfaceId === fact.surfaceId);
            evacuationHints = evacuationHints.filter((hint) => hint.surfaceId !== fact.surfaceId);
            evacuationHints.push({
              surfaceId: fact.surfaceId,
              windowIds: affected.map((window) => window.id),
              layout: root?.layout ?? inspection.policy.defaultLayout,
              childIds: root ? [...root.childIds] : affected.map((window) => window.id),
              weights: root ? { ...root.weights } : {},
              ...(root?.selectedChildId ? { selectedChildId: root.selectedChildId } : {}),
            });
            for (let index = 0; index < windows.length; index += 1) {
              const window = windows[index];
              if (window.surfaceId !== fact.surfaceId) continue;
              if (window.participating) {
                participationChanges.push({ windowId: window.id, participating: false });
              }
              windows[index] = { ...window, participating: false, parentId: undefined };
            }
            surfaces.splice(surfaceIndex, 1);
            const removedContainerIds = new Set(
              containers
                .filter((container) => container.surfaceId === fact.surfaceId)
                .map((container) => container.id)
            );
            operations = operations.filter(
              (operation) => !removedContainerIds.has(operation.containerId)
            );
            containers = containers.filter((container) => container.surfaceId !== fact.surfaceId);
            changed = true;
          }
          if (fact.type === "SurfaceObserved") {
            const surfaceIndex = surfaces.findIndex((surface) => surface.id === fact.surface.id);
            if (surfaceIndex >= 0) {
              const current = surfaces[surfaceIndex];
              if (
                sameRect(current.workArea, fact.surface.workArea) &&
                JSON.stringify(current.neighbors) === JSON.stringify(fact.surface.neighbors) &&
                JSON.stringify(current.capabilities) === JSON.stringify(fact.surface.capabilities)
              ) {
                continue;
              }
              surfaces[surfaceIndex] = {
                ...current,
                workArea: copyRect(fact.surface.workArea),
                neighbors: { ...fact.surface.neighbors },
                capabilities: { ...fact.surface.capabilities },
              };
              const affectedContainerIds = new Set(
                containers
                  .filter((container) => container.surfaceId === fact.surface.id)
                  .map((container) => container.id)
              );
              operations = operations.filter(
                (operation) => !affectedContainerIds.has(operation.containerId)
              );
              changed = true;
              continue;
            }

            const hint = evacuationHints.find(
              (candidate) => candidate.surfaceId === fact.surface.id
            );
            const rootId = `container:${nextContainer++}` as ContainerId;
            const knownWindowIds = new Set(
              windows
                .filter((window) => window.surfaceId === fact.surface.id)
                .map((window) => window.id)
            );
            const childIds = hint
              ? hint.childIds.filter((id) => knownWindowIds.has(id as WindowInspection["id"]))
              : [...knownWindowIds].sort();
            surfaces.push({
              id: fact.surface.id,
              workArea: copyRect(fact.surface.workArea),
              rootId,
              neighbors: { ...fact.surface.neighbors },
              capabilities: { ...fact.surface.capabilities },
            });
            containers.push({
              id: rootId,
              surfaceId: fact.surface.id,
              layout: hint?.layout ?? inspection.policy.defaultLayout,
              childIds,
              weights: hint ? { ...hint.weights } : {},
              ...(hint?.selectedChildId && childIds.includes(hint.selectedChildId)
                ? { selectedChildId: hint.selectedChildId }
                : {}),
            });
            const availableSurfaces = new Set([...surfaces.map((surface) => surface.id)]);
            for (let index = 0; index < windows.length; index += 1) {
              const window = windows[index];
              if (window.surfaceId !== fact.surface.id) continue;
              const participating = effectiveParticipation(
                window,
                inspection.policy,
                availableSurfaces
              );
              if (participating !== window.participating) {
                participationChanges.push({ windowId: window.id, participating });
              }
              windows[index] = {
                ...window,
                participating,
                ...(participating ? { parentId: rootId } : { parentId: undefined }),
              };
            }
            evacuationHints = evacuationHints.filter(
              (candidate) => candidate.surfaceId !== fact.surface.id
            );
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

        const invalid = validateSurfaces(surfaces);
        if (invalid) {
          return {
            status: "rejected",
            revision: inspection.revision,
            intentions: [],
            diagnostics: [{ code: "invalid-surface", message: invalid }],
          };
        }

        surfaces = surfaces.sort((left, right) => left.id.localeCompare(right.id));
        containers = containers.sort((left, right) => left.id.localeCompare(right.id));
        windows.sort((left, right) => left.id.localeCompare(right.id));
        evacuationHints.sort((left, right) => left.surfaceId.localeCompare(right.surfaceId));
        const revision = inspection.revision + 1;
        const windowPlans = deriveWindowPlans(surfaces, windows, containers, inspection.policy);
        const participationIntentions = participationChanges.map((change, ordinal) => ({
          type: "WindowParticipationChanged" as const,
          revision,
          ordinal,
          ...change,
        }));
        const placementIntentions = changedPlacementIntentions(
          inspection.renderPlan.windows,
          windowPlans,
          revision,
          participationIntentions.length
        );
        const intentions = [...participationIntentions, ...placementIntentions];
        inspection = {
          ...inspection,
          revision,
          surfaces,
          windows,
          containers,
          operations,
          placementHints,
          evacuationHints,
          renderPlan: {
            ...inspection.renderPlan,
            revision,
            surfaces: surfaces.map((surface) => ({
              id: surface.id,
              workArea: copyRect(surface.workArea),
            })),
            windows: windowPlans,
            containers: deriveContainerPlans(surfaces, containers),
          },
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
            capabilities: { ...surface.capabilities },
          });
          containers.push({
            id: rootId,
            surfaceId: surface.id,
            layout: inspection.policy.defaultLayout,
            childIds: [],
            weights: {},
          });
          surfaceRoots.set(surface.id, rootId);
        }

        const surfaceIds = new Set(surfaces.map((surface) => surface.id));
        const windows: WindowInspection[] = [...event.snapshot.windows]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((window) => {
            const classification = classifyParticipation(window, inspection.policy);
            const classifiedWindow: WindowInspection = {
              id: window.id,
              surfaceId: window.surfaceId,
              participating: false,
              policyParticipation: classification.participating,
              policyParticipationSource: classification.source,
              participationSource: classification.source,
              available: window.available,
              frame: copyRect(window.frame),
              capabilities: { ...window.capabilities },
              ...(window.applicationId ? { applicationId: window.applicationId } : {}),
              ...(window.title ? { title: window.title } : {}),
              ...(window.role ? { role: window.role } : {}),
              ...(window.transientParentId ? { transientParentId: window.transientParentId } : {}),
              ...(window.resizable !== undefined ? { resizable: window.resizable } : {}),
              tags: [...(window.tags ?? [])],
              reconcileAttempts: 0,
            };
            const participating = effectiveParticipation(
              classifiedWindow,
              inspection.policy,
              surfaceIds
            );
            const parentId = participating ? surfaceRoots.get(window.surfaceId) : undefined;
            if (parentId) {
              const parentIndex = containers.findIndex((container) => container.id === parentId);
              const parent = containers[parentIndex];
              containers[parentIndex] = { ...parent, childIds: [...parent.childIds, window.id] };
            }
            return {
              ...classifiedWindow,
              ...(parentId ? { parentId } : {}),
              participating,
            };
          });

        const windowPlans = deriveWindowPlans(surfaces, windows, containers, inspection.policy);

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

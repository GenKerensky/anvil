import type {
  ContainerId,
  TilingEvent,
  TilingInspection,
  TilingPolicy,
  TilingStateMachine,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { copyInspection, copyPolicy } from "./copy.js";
import { copyRect, deriveContainerPlans, deriveWindowPlans, sameRect } from "./geometry.js";
import { changedTransitionIntentions } from "./intentions.js";
import { assertTilingInvariants } from "./invariants.js";
import { applyOperation } from "./operations.js";
import { effectiveParticipation } from "./participation.js";
import { reconcile } from "./reconciliation.js";
import { validateSurfaces } from "./validation.js";
import { applyCommand } from "./commands.js";
import { applyPolicy } from "./policy.js";
import {
  cancelOperationsForChangedTopology,
  createInitialInspection,
  normalizeSelections,
  tilingSurfaceIds,
} from "./transition-helpers.js";
import { applyBootstrap } from "./bootstrap.js";
import { inspectWindowFact } from "./window-facts.js";

export function createTilingStateMachine(initialPolicy: TilingPolicy): TilingStateMachine {
  const policy = copyPolicy(initialPolicy);
  let nextContainer = 1;
  let inspection: TilingInspection = createInitialInspection(policy);
  const commitCandidate = (candidate: TilingInspection): void => {
    assertTilingInvariants(candidate);
    inspection = candidate;
  };

  return {
    dispatch(event: TilingEvent): TilingTransition {
      if (event.type === "ReconcileRequested") {
        const result = reconcile(inspection, event.surfaceId);
        commitCandidate(result.inspection);
        return result.transition;
      }

      if (
        event.type === "OperationStarted" ||
        event.type === "OperationUpdated" ||
        event.type === "OperationCommitted" ||
        event.type === "OperationCancelled"
      ) {
        const result = applyOperation(inspection, event);
        commitCandidate(result.inspection);
        return result.transition;
      }

      if (event.type === "CommandRequested") {
        return applyCommand(inspection, event, commitCandidate);
      }

      if (event.type === "PolicyReplaced") {
        return applyPolicy(inspection, event, commitCandidate);
      }

      if (event.type === "FactsObserved") {
        let candidateNextContainer = nextContainer;
        const windows: WindowInspection[] = [...inspection.windows];
        let focusedWindowId = inspection.focusedWindowId;
        let surfaces = [...inspection.surfaces];
        let containers = [...inspection.containers];
        let placementHints = [...inspection.placementHints];
        let evacuationHints = [...inspection.evacuationHints];
        let operations = [...inspection.operations];
        let diagnostics = [...inspection.diagnostics];
        const eventDiagnostics: TilingInspection["diagnostics"][number][] = [];
        const participationChanges: Array<{
          windowId: WindowInspection["id"];
          participating: boolean;
        }> = [];
        let changed = false;
        for (const fact of event.facts) {
          if (fact.type === "EffectFailed") {
            if (fact.causalToken.revision > inspection.revision) continue;
            const diagnostic = {
              code: `effect-failed:${fact.code}`,
              message: `Platform effect ${fact.causalToken.revision}:${fact.causalToken.ordinal} failed`,
              ...(fact.identity ? { identity: fact.identity } : {}),
            };
            eventDiagnostics.push(diagnostic);
            diagnostics = [...diagnostics, diagnostic].slice(-50);
            changed = true;
          }
          if (fact.type === "FocusObserved") {
            if (
              fact.windowId !== undefined &&
              !windows.some((window) => window.id === fact.windowId)
            ) {
              continue;
            }
            if (fact.windowId === focusedWindowId) continue;
            focusedWindowId = fact.windowId;
            if (focusedWindowId) {
              const focused = windows.find((window) => window.id === focusedWindowId);
              if (focused?.participating && focused.parentId) {
                containers = containers.map((container) =>
                  container.id === focused.parentId
                    ? { ...container, selectedChildId: focusedWindowId }
                    : container
                );
              }
            }
            changed = true;
          }
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
          if (fact.type === "WindowObserved") {
            const index = windows.findIndex((window) => window.id === fact.window.id);
            const previous = index >= 0 ? windows[index] : undefined;
            const availableSurfaces = tilingSurfaceIds(surfaces);
            const observed = inspectWindowFact(
              fact.window,
              inspection.policy,
              availableSurfaces,
              previous
            );
            const surface = surfaces.find((candidate) => candidate.id === observed.surfaceId);
            const next: WindowInspection = {
              ...observed,
              ...(observed.participating && surface
                ? { parentId: surface.rootId }
                : { parentId: undefined }),
            };
            if (previous && JSON.stringify(previous) === JSON.stringify(next)) continue;
            if (
              (previous !== undefined && previous.participating !== next.participating) ||
              (previous === undefined && next.participating)
            ) {
              participationChanges.push({
                windowId: next.id,
                participating: next.participating,
              });
            }
            containers = containers.map((container) => {
              if (container.id === next.parentId && container.childIds.includes(next.id)) {
                return container;
              }
              const childIds = container.childIds.filter((id) => id !== next.id);
              return container.id === next.parentId
                ? { ...container, childIds: [...childIds, next.id] }
                : { ...container, childIds };
            });
            if (index >= 0) windows[index] = next;
            else windows.push(next);
            operations = operations.filter(
              (operation) =>
                operation.windowId !== next.id && operation.neighborWindowId !== next.id
            );
            changed = true;
          }
          if (fact.type === "WindowSurfaceObserved") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0 || windows[index].surfaceId === fact.surfaceId) continue;
            const previous = windows[index];
            if (previous.parentId) {
              placementHints = placementHints.filter((hint) => hint.windowId !== previous.id);
              placementHints.push({
                windowId: previous.id,
                surfaceId: previous.surfaceId,
                parentId: previous.parentId,
                selected: false,
              });
            }
            const candidate = { ...previous, surfaceId: fact.surfaceId };
            const availableSurfaces = tilingSurfaceIds(surfaces);
            const participating = effectiveParticipation(
              candidate,
              inspection.policy,
              availableSurfaces
            );
            const surface = surfaces.find((item) => item.id === fact.surfaceId);
            const next: WindowInspection = {
              ...candidate,
              participating,
              ...(participating && surface
                ? { parentId: surface.rootId }
                : { parentId: undefined }),
            };
            if (previous.participating !== participating) {
              participationChanges.push({ windowId: next.id, participating });
            }
            windows[index] = next;
            containers = containers.map((container) => {
              const childIds = container.childIds.filter((id) => id !== next.id);
              return container.id === next.parentId
                ? { ...container, childIds: [...childIds, next.id] }
                : { ...container, childIds };
            });
            operations = operations.filter(
              (operation) =>
                operation.windowId !== next.id && operation.neighborWindowId !== next.id
            );
            changed = true;
          }
          if (fact.type === "WindowWithdrawn") {
            const index = windows.findIndex((window) => window.id === fact.windowId);
            if (index < 0) continue;
            windows.splice(index, 1);
            if (focusedWindowId === fact.windowId) focusedWindowId = undefined;
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
              const availableSurfaces = tilingSurfaceIds(surfaces);
              for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
                const window = windows[windowIndex];
                if (window.surfaceId !== fact.surface.id) continue;
                const participating = effectiveParticipation(
                  window,
                  inspection.policy,
                  availableSurfaces
                );
                if (participating !== window.participating) {
                  participationChanges.push({ windowId: window.id, participating });
                }
                windows[windowIndex] = {
                  ...window,
                  participating,
                  ...(participating ? { parentId: current.rootId } : { parentId: undefined }),
                };
              }
              containers = containers.map((container) => {
                const assigned = windows
                  .filter((window) => window.participating && window.parentId === container.id)
                  .map((window) => window.id);
                const assignedSet = new Set<string>(assigned);
                const retained = container.childIds.filter((id) => assignedSet.has(id));
                const retainedSet = new Set<string>(retained);
                return {
                  ...container,
                  childIds: [...retained, ...assigned.filter((id) => !retainedSet.has(id))],
                };
              });
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
            const rootId = `container:${candidateNextContainer++}` as ContainerId;
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
            const availableSurfaces = tilingSurfaceIds(surfaces);
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
        containers = normalizeSelections(containers, windows).sort((left, right) =>
          left.id.localeCompare(right.id)
        );
        operations = cancelOperationsForChangedTopology(
          inspection.containers,
          containers,
          operations
        );
        windows.sort((left, right) => left.id.localeCompare(right.id));
        evacuationHints.sort((left, right) => left.surfaceId.localeCompare(right.surfaceId));
        const revision = inspection.revision + 1;
        const windowPlans = deriveWindowPlans(surfaces, windows, containers, inspection.policy);
        const containerPlans = deriveContainerPlans(surfaces, containers);
        const intentions = changedTransitionIntentions(
          inspection.renderPlan.windows,
          windowPlans,
          inspection.renderPlan.containers,
          containerPlans,
          participationChanges,
          revision
        );
        commitCandidate({
          ...inspection,
          revision,
          focusedWindowId,
          surfaces,
          windows,
          containers,
          operations,
          placementHints,
          evacuationHints,
          diagnostics,
          renderPlan: {
            ...inspection.renderPlan,
            revision,
            surfaces: surfaces.map((surface) => ({
              id: surface.id,
              workArea: copyRect(surface.workArea),
            })),
            windows: windowPlans,
            containers: containerPlans,
          },
        });
        nextContainer = candidateNextContainer;
        return { status: "committed", revision, intentions, diagnostics: eventDiagnostics };
      }

      if (event.type === "PlatformSnapshotObserved") {
        return applyBootstrap(
          inspection,
          event,
          nextContainer,
          (candidate) => {
            nextContainer = candidate;
          },
          commitCandidate
        );
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

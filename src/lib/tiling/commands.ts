import type {
  ContainerId,
  TilingEvent,
  TilingInspection,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { copyRect, deriveContainerPlans, deriveWindowPlans } from "./geometry.js";
import { changedContainerIntentions, changedPlacementIntentions } from "./intentions.js";
import { effectiveParticipation } from "./participation.js";
import { normalizeTopology, tilingSurfaceIds } from "./transition-helpers.js";

type CommandEvent = Extract<TilingEvent, { type: "CommandRequested" }>;
type CommitCandidate = (candidate: TilingInspection) => void;

export function applyCommand(
  inspection: TilingInspection,
  event: CommandEvent,
  currentNextContainer: number,
  commitNextContainer: (nextContainer: number) => void,
  commitCandidate: CommitCandidate
): TilingTransition {
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
    const availableSurfaces = tilingSurfaceIds(inspection.surfaces);
    const candidate: WindowInspection = {
      ...current,
      manualParticipation,
      participationSource:
        manualParticipation === undefined ? current.policyParticipationSource : "manual",
    };
    const participating = effectiveParticipation(candidate, inspection.policy, availableSurfaces);
    const participationSurface = inspection.surfaces.find((item) => item.id === current.surfaceId);
    if (
      participating &&
      (!current.capabilities.move ||
        !current.capabilities.resize ||
        !participationSurface?.capabilities.move ||
        !participationSurface.capabilities.resize)
    ) {
      return {
        status: "rejected",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [
          {
            code: "capability-unsupported",
            message: "Tiling participation requires move and resize capabilities",
            identity: current.id,
          },
        ],
      };
    }
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
    const containers = normalizeTopology(
      inspection.containers.map((container) => {
        const childIds = container.childIds.filter((id) => id !== current.id);
        return container.id === nextWindow.parentId
          ? { ...container, childIds: [...childIds, current.id] }
          : { ...container, childIds };
      }),
      windows
    );
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
    const containerPlans = deriveContainerPlans(
      inspection.surfaces,
      windows,
      containers,
      inspection.policy
    );
    const containerIntentions = changedContainerIntentions(
      inspection.renderPlan.containers,
      containerPlans,
      revision,
      participationIntentions.length + placementIntentions.length
    );
    commitCandidate({
      ...inspection,
      revision,
      windows,
      containers,
      operations: inspection.operations.filter(
        (operation) => !operation.affectedWindowIds.includes(current.id)
      ),
      placementHints,
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        windows: windowPlans,
        containers: containerPlans,
      },
    });
    return {
      status: "committed",
      revision,
      intentions: [...participationIntentions, ...placementIntentions, ...containerIntentions],
      diagnostics: [],
    };
  }

  if (command.type === "Split") {
    const windowIndex = inspection.windows.findIndex(
      (candidate) => candidate.id === command.windowId
    );
    const window = inspection.windows[windowIndex];
    const parentIndex = inspection.containers.findIndex(
      (container) => container.id === window?.parentId
    );
    const parent = inspection.containers[parentIndex];
    const surface = inspection.surfaces.find((candidate) => candidate.id === parent?.surfaceId);
    if (
      !window?.participating ||
      !parent ||
      parent.layout === "stacked" ||
      parent.layout === "tabbed" ||
      !inspection.policy.allowedLayouts.includes(command.layout)
    ) {
      return {
        status: "rejected",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [
          {
            code: "invalid-split-command",
            message: "Split requires a participating window in a split container",
            identity: command.windowId,
          },
        ],
      };
    }
    if (
      !window.capabilities.move ||
      !window.capabilities.resize ||
      !surface?.capabilities.move ||
      !surface.capabilities.resize
    ) {
      return {
        status: "rejected",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [
          {
            code: "capability-unsupported",
            message: "Split requires move and resize capabilities",
            identity: command.windowId,
          },
        ],
      };
    }

    let candidateNextContainer = currentNextContainer;
    let containers = [...inspection.containers];
    let windows = [...inspection.windows];
    if (parent.childIds.length === 1) {
      if (parent.layout === command.layout) {
        return {
          status: "ignored",
          revision: inspection.revision,
          intentions: [],
          diagnostics: [],
        };
      }
      containers[parentIndex] = { ...parent, layout: command.layout };
    } else {
      const nestedId = `container:${candidateNextContainer++}` as ContainerId;
      const childIndex = parent.childIds.indexOf(window.id);
      const childIds = [...parent.childIds];
      childIds[childIndex] = nestedId;
      const weights = { ...parent.weights };
      const inheritedWeight = weights[window.id];
      delete weights[window.id];
      if (inheritedWeight !== undefined) weights[nestedId] = inheritedWeight;
      containers[parentIndex] = {
        ...parent,
        childIds,
        weights,
        ...(parent.selectedChildId === window.id ? { selectedChildId: nestedId } : {}),
      };
      containers.push({
        id: nestedId,
        surfaceId: parent.surfaceId,
        parentId: parent.id,
        layout: command.layout,
        childIds: [window.id],
        weights: {},
        selectedChildId: window.id,
      });
      windows[windowIndex] = { ...window, parentId: nestedId };
    }

    containers = containers.sort((left, right) => left.id.localeCompare(right.id));
    windows = windows.sort((left, right) => left.id.localeCompare(right.id));
    const revision = inspection.revision + 1;
    const windowPlans = deriveWindowPlans(
      inspection.surfaces,
      windows,
      containers,
      inspection.policy
    );
    const placement = changedPlacementIntentions(
      inspection.renderPlan.windows,
      windowPlans,
      revision
    );
    const containerPlans = deriveContainerPlans(
      inspection.surfaces,
      windows,
      containers,
      inspection.policy
    );
    const presentation = changedContainerIntentions(
      inspection.renderPlan.containers,
      containerPlans,
      revision,
      placement.length
    );
    commitCandidate({
      ...inspection,
      revision,
      windows,
      containers,
      operations: inspection.operations.filter(
        (operation) =>
          !operation.affectedContainerIds.includes(parent.id) &&
          !operation.affectedWindowIds.includes(command.windowId)
      ),
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        windows: windowPlans,
        containers: containerPlans,
      },
    });
    commitNextContainer(candidateNextContainer);
    return {
      status: "committed",
      revision,
      intentions: [...placement, ...presentation],
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
    const target = inspection.windows.find((candidate) => candidate.id === targetId);
    const surface = inspection.surfaces.find((candidate) => candidate.id === target?.surfaceId);
    if (!target?.capabilities.focus || !surface?.capabilities.focus) {
      return {
        status: "rejected",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [
          {
            code: "capability-unsupported",
            message: "Focus target does not support platform focus",
            identity: targetId,
          },
        ],
      };
    }
    const revision = inspection.revision + 1;
    const containers = [...inspection.containers];
    containers[containerIndex] = { ...container, selectedChildId: targetId };
    const containerPlans = deriveContainerPlans(
      inspection.surfaces,
      inspection.windows,
      containers,
      inspection.policy
    );
    const presentation = changedContainerIntentions(
      inspection.renderPlan.containers,
      containerPlans,
      revision,
      1
    );
    commitCandidate({
      ...inspection,
      revision,
      containers,
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        containers: containerPlans,
      },
    });
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
        ...presentation,
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
    const surface = inspection.surfaces.find((candidate) => candidate.id === container.surfaceId);
    const placementUnsupported = container.childIds.some((id) => {
      const child = inspection.windows.find((candidate) => candidate.id === id);
      return child && (!child.capabilities.move || !child.capabilities.resize);
    });
    if (placementUnsupported || !surface?.capabilities.move || !surface.capabilities.resize) {
      return {
        status: "rejected",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [
          {
            code: "capability-unsupported",
            message: `${command.type} requires move and resize capabilities`,
            identity: command.windowId,
          },
        ],
      };
    }
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
    const containerPlans = deriveContainerPlans(
      inspection.surfaces,
      inspection.windows,
      containers,
      inspection.policy
    );
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
      containers,
      operations: inspection.operations.filter(
        (operation) => !operation.affectedContainerIds.includes(container.id)
      ),
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        windows: windowPlans,
        containers: containerPlans,
      },
    });
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
  const surface = inspection.surfaces.find((candidate) => candidate.id === current.surfaceId);
  const placementUnsupported = current.childIds.some((id) => {
    const child = inspection.windows.find((candidate) => candidate.id === id);
    return child && (!child.capabilities.move || !child.capabilities.resize);
  });
  if (placementUnsupported || !surface?.capabilities.move || !surface.capabilities.resize) {
    return {
      status: "rejected",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [
        {
          code: "capability-unsupported",
          message: "SetLayout requires move and resize capabilities",
          identity: command.windowId,
        },
      ],
    };
  }
  if (current.layout === command.layout) {
    return {
      status: "ignored",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [],
    };
  }
  const containers = [...inspection.containers];
  const availableChild = current.childIds.find((id) =>
    inspection.windows.some(
      (candidate) => candidate.id === id && candidate.participating && candidate.available
    )
  );
  const nextContainer = {
    ...current,
    layout: command.layout,
    ...(command.layout === "stacked" || command.layout === "tabbed"
      ? { selectedChildId: current.selectedChildId ?? availableChild }
      : {}),
  };
  containers[containerIndex] = nextContainer;
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
  const containerPlans = deriveContainerPlans(
    inspection.surfaces,
    inspection.windows,
    containers,
    inspection.policy
  );
  const nextPlan = containerPlans.find((container) => container.id === current.id);
  const present = {
    type: "PresentContainer" as const,
    revision,
    ordinal: placement.length,
    containerId: current.id,
    surfaceId: current.surfaceId,
    layout: command.layout,
    ...(nextPlan?.headerRect ? { headerRect: copyRect(nextPlan.headerRect) } : {}),
    ...(nextContainer.selectedChildId ? { selectedChildId: nextContainer.selectedChildId } : {}),
    stackingOrder: [...current.childIds],
  };
  commitCandidate({
    ...inspection,
    revision,
    containers,
    operations: inspection.operations.filter(
      (operation) => !operation.affectedContainerIds.includes(current.id)
    ),
    renderPlan: {
      ...inspection.renderPlan,
      revision,
      windows: windowPlans,
      containers: containerPlans,
    },
  });
  return {
    status: "committed",
    revision,
    intentions: [...placement, present],
    diagnostics: [],
  };
}

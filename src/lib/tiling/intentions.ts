import type {
  ContainerPlan,
  TilingIntention,
  TilingRevision,
  WindowId,
  WindowPlan,
} from "./contracts.js";
import { copyRect, sameRect } from "./geometry.js";

export function changedPlacementIntentions(
  previous: readonly WindowPlan[],
  next: readonly WindowPlan[],
  revision: TilingRevision,
  ordinalOffset = 0
): TilingIntention[] {
  return next
    .filter((plan) => {
      const old = previous.find((window) => window.id === plan.id);
      return !old || old.surfaceId !== plan.surfaceId || !sameRect(old.frame, plan.frame);
    })
    .map((plan, index) => ({
      type: "PlaceWindow",
      revision,
      ordinal: ordinalOffset + index,
      windowId: plan.id,
      surfaceId: plan.surfaceId,
      frame: copyRect(plan.frame),
    }));
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((identity, index) => identity === right[index]);
}

export function changedContainerIntentions(
  previous: readonly ContainerPlan[],
  next: readonly ContainerPlan[],
  revision: TilingRevision,
  ordinalOffset = 0
): TilingIntention[] {
  const removals: TilingIntention[] = previous
    .filter((old) => {
      const wasPresented = old.layout === "stacked" || old.layout === "tabbed";
      const plan = next.find((candidate) => candidate.id === old.id);
      const presented = plan?.layout === "stacked" || plan?.layout === "tabbed";
      return wasPresented && !presented;
    })
    .map((old, index) => ({
      type: "RemoveContainerPresentation",
      revision,
      ordinal: ordinalOffset + index,
      containerId: old.id,
    }));
  const presentations: TilingIntention[] = next
    .filter((plan) => {
      const old = previous.find((container) => container.id === plan.id);
      const presented = plan.layout === "stacked" || plan.layout === "tabbed";
      if (!presented) return false;
      return (
        !old ||
        old.layout !== plan.layout ||
        !(
          (!old.headerRect && !plan.headerRect) ||
          (old.headerRect && plan.headerRect && sameRect(old.headerRect, plan.headerRect))
        ) ||
        old.selectedChildId !== plan.selectedChildId ||
        old.selectedWindowId !== plan.selectedWindowId ||
        !sameOrder(old.windowIds, plan.windowIds) ||
        !sameOrder(old.stackingOrder, plan.stackingOrder)
      );
    })
    .map((plan, index) => ({
      type: "PresentContainer",
      revision,
      ordinal: ordinalOffset + removals.length + index,
      containerId: plan.id,
      surfaceId: plan.surfaceId,
      layout: plan.layout,
      ...(plan.headerRect ? { headerRect: copyRect(plan.headerRect) } : {}),
      ...(plan.selectedChildId ? { selectedChildId: plan.selectedChildId } : {}),
      ...(plan.selectedWindowId ? { selectedWindowId: plan.selectedWindowId } : {}),
      windowIds: [...plan.windowIds],
      stackingOrder: [...plan.stackingOrder],
    }));
  const raises: TilingIntention[] = next
    .filter((plan) => {
      if (plan.layout !== "stacked" && plan.layout !== "tabbed") return false;
      const old = previous.find((container) => container.id === plan.id);
      return !old || !sameOrder(old.stackingOrder, plan.stackingOrder);
    })
    .map((plan, index) => ({
      type: "RaiseWindows",
      revision,
      ordinal: ordinalOffset + removals.length + presentations.length + index,
      containerId: plan.id,
      windowIds: [...plan.stackingOrder],
    }));
  return [...removals, ...presentations, ...raises];
}

export function changedTransitionIntentions(
  previousWindows: readonly WindowPlan[],
  nextWindows: readonly WindowPlan[],
  previousContainers: readonly ContainerPlan[],
  nextContainers: readonly ContainerPlan[],
  participationChanges: readonly Readonly<{
    windowId: WindowId;
    participating: boolean;
  }>[],
  revision: TilingRevision
): TilingIntention[] {
  const participation: TilingIntention[] = participationChanges.map((change, ordinal) => ({
    type: "WindowParticipationChanged",
    revision,
    ordinal,
    ...change,
  }));
  const placement = changedPlacementIntentions(
    previousWindows,
    nextWindows,
    revision,
    participation.length
  );
  const presentation = changedContainerIntentions(
    previousContainers,
    nextContainers,
    revision,
    participation.length + placement.length
  );
  return [...participation, ...placement, ...presentation];
}

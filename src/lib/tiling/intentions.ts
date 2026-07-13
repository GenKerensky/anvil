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
  return next
    .filter((plan) => {
      const old = previous.find((container) => container.id === plan.id);
      const presented = plan.layout === "stacked" || plan.layout === "tabbed";
      const wasPresented = old?.layout === "stacked" || old?.layout === "tabbed";
      if (!presented && !wasPresented) return false;
      return (
        !old ||
        old.layout !== plan.layout ||
        !(
          (!old.headerRect && !plan.headerRect) ||
          (old.headerRect && plan.headerRect && sameRect(old.headerRect, plan.headerRect))
        ) ||
        old.selectedChildId !== plan.selectedChildId ||
        !sameOrder(old.stackingOrder, plan.stackingOrder)
      );
    })
    .map((plan, index) => ({
      type: "PresentContainer",
      revision,
      ordinal: ordinalOffset + index,
      containerId: plan.id,
      surfaceId: plan.surfaceId,
      layout: plan.layout,
      ...(plan.headerRect ? { headerRect: copyRect(plan.headerRect) } : {}),
      ...(plan.selectedChildId ? { selectedChildId: plan.selectedChildId } : {}),
      stackingOrder: [...plan.stackingOrder],
    }));
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

import type { TilingIntention, TilingRevision, WindowPlan } from "./contracts.js";
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

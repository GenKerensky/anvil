import type { TilingInspection, TilingTransition } from "./contracts.js";
import { copyRect, sameRect } from "./geometry.js";

export type ReconciliationResult = Readonly<{
  inspection: TilingInspection;
  transition: TilingTransition;
}>;

export function reconcile(inspection: TilingInspection, surfaceId?: string): ReconciliationResult {
  const mismatches = inspection.renderPlan.windows.filter((plan) => {
    if (surfaceId !== undefined && plan.surfaceId !== surfaceId) return false;
    const window = inspection.windows.find((candidate) => candidate.id === plan.id);
    return (
      window !== undefined &&
      window.participating &&
      window.available &&
      !sameRect(window.frame, plan.frame) &&
      window.reconcileAttempts < inspection.policy.reconcileAttempts
    );
  });
  if (mismatches.length === 0) {
    return {
      inspection,
      transition: {
        status: "ignored",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [],
      },
    };
  }

  const revision = inspection.revision + 1;
  const mismatchIds = new Set(mismatches.map((plan) => plan.id));
  const windows = inspection.windows.map((window) =>
    mismatchIds.has(window.id)
      ? { ...window, reconcileAttempts: window.reconcileAttempts + 1 }
      : window
  );
  const intentions = mismatches.map((plan, ordinal) => ({
    type: "PlaceWindow" as const,
    revision,
    ordinal,
    windowId: plan.id,
    surfaceId: plan.surfaceId,
    frame: copyRect(plan.frame),
  }));
  const next = {
    ...inspection,
    revision,
    windows,
    renderPlan: { ...inspection.renderPlan, revision },
  };
  return {
    inspection: next,
    transition: { status: "committed", revision, intentions, diagnostics: [] },
  };
}

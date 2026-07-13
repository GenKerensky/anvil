import type {
  TilingEvent,
  TilingInspection,
  TilingPolicy,
  TilingStateMachine,
  TilingTransition,
} from "./contracts.js";

function copyPolicy(policy: TilingPolicy): TilingPolicy {
  return {
    ...policy,
    surfaceTiling: { ...policy.surfaceTiling },
    allowedLayouts: [...policy.allowedLayouts],
    constraints: Object.fromEntries(
      Object.entries(policy.constraints).map(([id, constraint]) => [id, { ...constraint }])
    ),
    participationRules: policy.participationRules.map((rule) => ({
      ...rule,
      tags: rule.tags ? [...rule.tags] : undefined,
    })),
  };
}

export function createTilingStateMachine(initialPolicy: TilingPolicy): TilingStateMachine {
  const policy = copyPolicy(initialPolicy);
  const inspection: TilingInspection = {
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
    dispatch(_event: TilingEvent): TilingTransition {
      return {
        status: "ignored",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [],
      };
    },
    inspect(): TilingInspection {
      return {
        ...inspection,
        policy: copyPolicy(inspection.policy),
        surfaces: [],
        windows: [],
        containers: [],
        operations: [],
        placementHints: [],
        evacuationHints: [],
        renderPlan: { ...inspection.renderPlan },
        diagnostics: [],
      };
    },
  };
}

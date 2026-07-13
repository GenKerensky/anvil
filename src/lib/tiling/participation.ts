import type { ParticipationRule, TilingPolicy, WindowFact, WindowInspection } from "./contracts.js";

type WindowDescriptor = Pick<
  WindowFact,
  "id" | "applicationId" | "title" | "role" | "transientParentId" | "resizable" | "tags"
>;

function matchesText(value: string | undefined, pattern: string): boolean {
  const actual = value ?? "";
  if (pattern.startsWith("=")) return actual === pattern.slice(1);
  if (pattern.startsWith("!")) return !actual.includes(pattern.slice(1));
  return actual.includes(pattern);
}

function matches(window: WindowDescriptor, rule: ParticipationRule): boolean {
  if (rule.windowId !== undefined && rule.windowId !== window.id) return false;
  if (rule.applicationId !== undefined && rule.applicationId !== window.applicationId) return false;
  if (rule.title !== undefined && !matchesText(window.title, rule.title)) return false;
  if (rule.role !== undefined && rule.role !== window.role) return false;
  if (rule.transient !== undefined && rule.transient !== (window.transientParentId !== undefined)) {
    return false;
  }
  if (rule.resizable !== undefined && rule.resizable !== window.resizable) return false;
  if (rule.tags !== undefined) {
    const tags = new Set(window.tags ?? []);
    if (!rule.tags.every((tag) => tags.has(tag))) return false;
  }
  return true;
}

export function classifyParticipation(
  window: WindowDescriptor,
  policy: TilingPolicy
): Readonly<{ participating: boolean; source: string }> {
  const explicitTile = policy.participationRules.find(
    (rule) => rule.windowId === window.id && rule.action === "tile" && matches(window, rule)
  );
  if (explicitTile) return { participating: true, source: `rule:${explicitTile.id}` };
  const rule = policy.participationRules.find((candidate) => matches(window, candidate));
  if (!rule) return { participating: true, source: "default" };
  return { participating: rule.action === "tile", source: `rule:${rule.id}` };
}

export function effectiveParticipation(
  window: Pick<WindowInspection, "surfaceId" | "manualParticipation" | "policyParticipation">,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>
): boolean {
  const decision = window.manualParticipation ?? window.policyParticipation;
  return (
    decision &&
    policy.enabled &&
    availableSurfaces.has(window.surfaceId) &&
    policy.surfaceTiling[window.surfaceId] !== false
  );
}

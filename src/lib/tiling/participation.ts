import type { ParticipationRule, TilingPolicy, WindowFact, WindowInspection } from "./contracts.js";

type WindowDescriptor = Pick<
  WindowFact,
  "id" | "applicationId" | "title" | "role" | "transientParentId" | "resizable" | "tags"
>;

function matchesText(value: string | undefined, pattern: string): boolean {
  const actual = (value ?? "").toLowerCase();
  return pattern.split(",").some((candidate) => {
    const normalized = candidate.toLowerCase();
    if (normalized.startsWith("=")) return actual === normalized.slice(1);
    if (normalized.startsWith("!")) return !actual.includes(normalized.slice(1));
    return actual.includes(normalized.startsWith("~") ? normalized.slice(1) : normalized);
  });
}

function matchesApplication(value: string | undefined, pattern: string): boolean {
  const actual = value ?? "";
  const normalized = pattern.trim();
  if (normalized.toLowerCase().startsWith("re:")) {
    try {
      return new RegExp(normalized.slice(3), "i").test(actual);
    } catch {
      return false;
    }
  }
  if (normalized.includes("*") || normalized.includes("?")) {
    const escaped = normalized
      .toLowerCase()
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      return new RegExp(`^${escaped}$`, "i").test(actual);
    } catch {
      return false;
    }
  }
  if (normalized.startsWith("~")) {
    return actual.toLowerCase().includes(normalized.slice(1).toLowerCase());
  }
  return actual.toLowerCase() === normalized.toLowerCase();
}

function matches(window: WindowDescriptor, rule: ParticipationRule): boolean {
  if (rule.windowId !== undefined && rule.windowId !== window.id) return false;
  if (
    rule.applicationId !== undefined &&
    !matchesApplication(window.applicationId, rule.applicationId)
  ) {
    return false;
  }
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
    (rule) => rule.action === "tile" && matches(window, rule)
  );
  if (explicitTile) return { participating: true, source: `rule:${explicitTile.id}` };
  const rule = policy.participationRules.find((candidate) => matches(window, candidate));
  if (!rule) return { participating: true, source: "default" };
  return { participating: rule.action === "tile", source: `rule:${rule.id}` };
}

export function effectiveParticipation(
  window: Pick<
    WindowInspection,
    "surfaceId" | "manualParticipation" | "policyParticipation" | "capabilities"
  >,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>
): boolean {
  const decision = window.manualParticipation ?? window.policyParticipation;
  return (
    decision &&
    window.capabilities.move &&
    window.capabilities.resize &&
    policy.enabled &&
    availableSurfaces.has(window.surfaceId) &&
    policy.surfaceTiling[window.surfaceId] !== false
  );
}

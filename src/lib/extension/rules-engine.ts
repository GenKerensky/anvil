/*
 * RulesEngine — ordered float/tile classification for Meta windows.
 *
 * Single owner for float/tile decisions (JSON overrides + built-in rules).
 * WindowManager is a thin facade; do not reintroduce parallel exempt logic.
 *
 * Evaluation order (behavior-preserving; do not reorder casually):
 *   1. null window              → float exempt
 *   2. TILE JSON override       → not exempt (beats all built-ins — Bug #294)
 *   3. Ephemeral helpers        → float exempt
 *   4. Built-in PIP title       → float exempt
 *   5. Built-in Blender class   → float exempt
 *   6. Built-in Steam class     → float exempt
 *   7. Type heuristics OR FLOAT JSON override → float exempt if either matches
 *   8. else                     → tile (not exempt)
 *
 * Title match mini-language (comma-separated patterns; any match wins):
 *   foo   — title contains "foo" (case-insensitive)
 *   =foo  — title equals "foo"
 *   !foo  — title does NOT contain "foo"
 *   " "   — exact match to single-space title (special case)
 *
 * Class matching uses cfg.includes(reported) substring (legacy; B12-3).
 *
 * @see codebase-review.md F5 Stage 2, architecture rule 6
 */

import Meta from "gi://Meta";

import { Logger } from "../shared/logger.js";
import type { ConfigManager, WindowConfig, WindowOverride } from "../shared/settings.js";
import * as Utils from "./utils.js";

export type RuleSource =
  | "null-window"
  | "tile-override"
  | "ephemeral"
  | "builtin-pip"
  | "builtin-blender"
  | "builtin-steam"
  | "type-heuristic"
  | "float-override"
  | "default-tile";

export type RuleMatch = {
  /** Same meaning as historical isFloatingExempt === true */
  floatExempt: boolean;
  source: RuleSource;
};

/**
 * Title match mini-language for window override rules.
 * See module header for grammar.
 */
export function windowTitleMatchesOverride(
  windowTitle: string | null,
  overrideTitle: string
): boolean {
  if (overrideTitle === " ") {
    return overrideTitle === windowTitle;
  }

  const lowerWindowTitle = (windowTitle || "").toLowerCase();
  if (!lowerWindowTitle) return false;

  return (
    overrideTitle.split(",").filter((titlePattern: string) => {
      const lowerPattern = titlePattern.toLowerCase();
      if (lowerPattern.startsWith("!")) {
        return !lowerWindowTitle.includes(lowerPattern.slice(1));
      }
      if (lowerPattern.startsWith("=")) {
        return lowerWindowTitle === lowerPattern.slice(1);
      }
      return lowerWindowTitle.includes(lowerPattern);
    }).length > 0
  );
}

function classMatches(reportedClass: string | null, cfgClass: string): boolean {
  const reported = (reportedClass || "").toLowerCase();
  const cfg = cfgClass.toLowerCase();
  return reported.length > 0 && cfg.includes(reported);
}

function overrideMatchesWindow(override: WindowOverride, metaWindow: Meta.Window): boolean {
  const windowTitle = metaWindow.get_title();
  const wmClass = metaWindow.get_wm_class();

  if (override.wmClass) {
    if (!classMatches(wmClass, override.wmClass)) return false;
  }
  if (override.wmTitle) {
    if (!windowTitleMatchesOverride(windowTitle, override.wmTitle)) return false;
  }
  if (override.wmId) {
    if (override.wmId !== String(metaWindow.get_id())) return false;
  }
  return true;
}

export class RulesEngine {
  /** Cached WindowConfig — same object reference as ConfigManager after reload. */
  windowProps: WindowConfig;

  constructor(initial?: WindowConfig | null) {
    this.windowProps = initial ?? { overrides: [] };
  }

  /**
   * Ordered float/tile classification.
   * Prefer this over isFloatingExempt when the rule source is useful.
   */
  match(metaWindow: Meta.Window | null): RuleMatch {
    if (!metaWindow) {
      return { floatExempt: true, source: "null-window" };
    }

    const windowTitle = metaWindow.get_title();
    const windowType = metaWindow.get_window_type();
    const wmClass = metaWindow.get_wm_class();
    const overrides = this.windowProps.overrides;

    // Bug #294: explicit TILE overrides take precedence over all built-in float rules.
    for (const override of overrides) {
      if (override.mode !== "tile") continue;
      if (!overrideMatchesWindow(override, metaWindow)) continue;
      return { floatExempt: false, source: "tile-override" };
    }

    if (Utils.isEphemeralHelperWindow(metaWindow)) {
      return { floatExempt: true, source: "ephemeral" };
    }

    // Bug #383: Firefox PIP (Picture-in-Picture) windows should always float
    if (windowTitle && windowTitle.toLowerCase().includes("picture-in-picture")) {
      return { floatExempt: true, source: "builtin-pip" };
    }

    // Bug #260: Blender has rendering issues with tiling (cogl_framebuffer errors)
    if (wmClass && wmClass.toLowerCase().includes("blender")) {
      return { floatExempt: true, source: "builtin-blender" };
    }

    // Bug #271: Steam app has overlapping/sizing issues when tiled
    if (
      wmClass &&
      (wmClass.toLowerCase().includes("steam") || wmClass.toLowerCase() === "steamwebhelper")
    ) {
      return { floatExempt: true, source: "builtin-steam" };
    }

    const hasIdentity = !!(wmClass || windowTitle);
    const trans = metaWindow.get_transient_for();
    const resizable = metaWindow.allows_resize();
    const isDialogType =
      windowType === Meta.WindowType.DIALOG || windowType === Meta.WindowType.MODAL_DIALOG;
    const hasTransient = hasIdentity && trans !== null;
    const noResize = hasIdentity && !resizable;
    const floatByType = isDialogType || hasTransient || noResize;

    if (floatByType) {
      return { floatExempt: true, source: "type-heuristic" };
    }

    const knownFloats = overrides.filter((wprop) => wprop.mode === "float");
    const floatOverride = knownFloats.some((kf) => overrideMatchesWindow(kf, metaWindow));

    if (floatOverride) {
      return { floatExempt: true, source: "float-override" };
    }

    return { floatExempt: false, source: "default-tile" };
  }

  /** Same boolean semantics as historical WindowManager.isFloatingExempt. */
  isFloatingExempt(metaWindow: Meta.Window | null): boolean {
    return this.match(metaWindow).floatExempt;
  }

  addFloatOverride(metaWindow: Meta.Window, withWmId: boolean, configMgr: ConfigManager): void {
    const currentProps = configMgr.windowProps;
    if (!currentProps) return;
    const overrides = currentProps.overrides;
    const wmClass = metaWindow.get_wm_class() ?? "";
    const wmId = metaWindow.get_id();

    for (const override of overrides) {
      // if the window is already floating
      if (
        override.wmClass === wmClass &&
        override.mode === "float" &&
        !override.wmTitle &&
        (!withWmId || override.wmId === String(wmId))
      )
        return;
    }
    overrides.push({
      wmClass,
      wmId: withWmId ? String(wmId) : undefined,
      mode: "float",
    });

    currentProps.overrides = overrides;
    configMgr.windowProps = currentProps;
    // Keep engine cache on the same object when possible.
    this.windowProps = currentProps;
  }

  removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean, configMgr: ConfigManager): void {
    const currentProps = configMgr.windowProps;
    if (!currentProps) return;
    let overrides = currentProps.overrides;
    const wmClass = metaWindow.get_wm_class() ?? "";
    const wmId = String(metaWindow.get_id());
    overrides = overrides.filter(
      (override) =>
        !(
          override.wmClass === wmClass &&
          // rules with a Title are written by the user and persistent
          !override.wmTitle &&
          (!withWmId || override.wmId === wmId)
        )
    );

    currentProps.overrides = overrides;
    configMgr.windowProps = currentProps;
    this.windowProps = currentProps;
  }

  /**
   * Reload window overrides from ConfigManager.
   * Strips runtime wmId rules (session-only float toggles).
   */
  reloadFromConfig(configMgr: ConfigManager): void {
    const freshProps = configMgr.windowProps;
    if (freshProps) {
      this.windowProps = freshProps;
      this.windowProps.overrides = this.windowProps.overrides.filter((override) => !override.wmId);
      Logger.info(`Reloaded ${this.windowProps.overrides.length} window overrides from file`);
    }
  }
}

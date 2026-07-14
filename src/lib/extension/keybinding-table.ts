/*
 * Declarative keybinding table: GSettings schema key → AnvilAction.
 *
 * Static actions are plain objects; dynamic actions (e.g. resize amount) are
 * factories evaluated at invoke time.
 *
 * @see .agents/rules/architecture.md rule 3
 */

import type Gio from "gi://Gio";
import type { AnvilAction } from "./window/actions.js";

export type BindingCtx = {
  settings: Gio.Settings;
  kbdSettings: Gio.Settings;
};

export type BindingSpec =
  | { key: string; action: AnvilAction }
  | { key: string; action: (ctx: BindingCtx) => AnvilAction };

const FLOAT_CENTER: AnvilAction = {
  name: "FloatToggle",
  mode: "float",
  x: "center",
  y: "center",
  width: 0.65,
  height: 0.75,
};

const FLOAT_CLASS_CENTER: AnvilAction = {
  name: "FloatClassToggle",
  mode: "float",
  x: "center",
  y: "center",
  width: 0.65,
  height: 0.75,
};

function resizeAmount(ctx: BindingCtx): number {
  return ctx.settings.get_uint("resize-amount");
}

/** Schema key → AnvilAction (static or factory). */
export const KEYBINDING_TABLE: BindingSpec[] = [
  { key: "window-toggle-float", action: FLOAT_CENTER },
  { key: "window-toggle-always-float", action: FLOAT_CLASS_CENTER },
  { key: "window-focus-left", action: { name: "Focus", direction: "Left" } },
  { key: "window-focus-down", action: { name: "Focus", direction: "Down" } },
  { key: "window-focus-up", action: { name: "Focus", direction: "Up" } },
  { key: "window-focus-right", action: { name: "Focus", direction: "Right" } },
  { key: "window-swap-left", action: { name: "Swap", direction: "Left" } },
  { key: "window-swap-down", action: { name: "Swap", direction: "Down" } },
  { key: "window-swap-up", action: { name: "Swap", direction: "Up" } },
  { key: "window-swap-right", action: { name: "Swap", direction: "Right" } },
  { key: "window-move-left", action: { name: "Move", direction: "Left" } },
  { key: "window-move-down", action: { name: "Move", direction: "Down" } },
  { key: "window-move-up", action: { name: "Move", direction: "Up" } },
  { key: "window-move-right", action: { name: "Move", direction: "Right" } },
  { key: "con-split-layout-toggle", action: { name: "LayoutToggle" } },
  { key: "con-split-vertical", action: { name: "Split", orientation: "vertical" } },
  { key: "con-split-horizontal", action: { name: "Split", orientation: "horizontal" } },
  { key: "con-stacked-layout-toggle", action: { name: "LayoutStackedToggle" } },
  { key: "con-tabbed-layout-toggle", action: { name: "LayoutTabbedToggle" } },
  {
    key: "con-tabbed-showtab-decoration-toggle",
    action: { name: "ShowTabDecorationToggle" },
  },
  { key: "focus-border-toggle", action: { name: "FocusBorderToggle" } },
  { key: "prefs-tiling-toggle", action: { name: "TilingModeToggle" } },
  { key: "window-gap-size-increase", action: { name: "GapSize", amount: 1 } },
  { key: "window-gap-size-decrease", action: { name: "GapSize", amount: -1 } },
  { key: "workspace-active-tile-toggle", action: { name: "WorkspaceActiveTileToggle" } },
  { key: "window-close", action: { name: "WindowClose" } },
  { key: "prefs-open", action: { name: "PrefsOpen" } },
  { key: "window-swap-last-active", action: { name: "WindowSwapLastActive" } },
  {
    key: "window-snap-one-third-right",
    action: { name: "SnapLayoutMove", direction: "Right", amount: 1 / 3 },
  },
  {
    key: "window-snap-two-third-right",
    action: { name: "SnapLayoutMove", direction: "Right", amount: 2 / 3 },
  },
  {
    key: "window-snap-one-third-left",
    action: { name: "SnapLayoutMove", direction: "Left", amount: 1 / 3 },
  },
  {
    key: "window-snap-two-third-left",
    action: { name: "SnapLayoutMove", direction: "Left", amount: 2 / 3 },
  },
  {
    key: "window-snap-center",
    action: { name: "SnapLayoutMove", direction: "Center" },
  },
  {
    key: "window-resize-top-increase",
    action: (ctx) => ({ name: "WindowResize", direction: "Top", amount: resizeAmount(ctx) }),
  },
  {
    key: "window-resize-top-decrease",
    action: (ctx) => ({
      name: "WindowResize",
      direction: "Top",
      amount: -1 * resizeAmount(ctx),
    }),
  },
  {
    key: "window-resize-bottom-increase",
    action: (ctx) => ({ name: "WindowResize", direction: "Bottom", amount: resizeAmount(ctx) }),
  },
  {
    key: "window-resize-bottom-decrease",
    action: (ctx) => ({
      name: "WindowResize",
      direction: "Bottom",
      amount: -1 * resizeAmount(ctx),
    }),
  },
  {
    key: "window-resize-left-increase",
    action: (ctx) => ({ name: "WindowResize", direction: "Left", amount: resizeAmount(ctx) }),
  },
  {
    key: "window-resize-left-decrease",
    action: (ctx) => ({
      name: "WindowResize",
      direction: "Left",
      amount: -1 * resizeAmount(ctx),
    }),
  },
  {
    key: "window-resize-right-increase",
    action: (ctx) => ({ name: "WindowResize", direction: "Right", amount: resizeAmount(ctx) }),
  },
  {
    key: "window-resize-right-decrease",
    action: (ctx) => ({
      name: "WindowResize",
      direction: "Right",
      amount: -1 * resizeAmount(ctx),
    }),
  },
];

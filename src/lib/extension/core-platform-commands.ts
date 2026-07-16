/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Gio from "gi://Gio";
import Meta from "gi://Meta";

import * as Utils from "./utils.js";
import { computeSnapLayout } from "./snap-layout.js";
import type { TilingShadow } from "./tiling-shadow.js";
import type { AnvilAction } from "./window/actions.js";
import type { RectLike } from "./tree.js";

export interface CorePlatformCommandsHost {
  readonly settings: Gio.Settings;
  readonly prefsTitle: string;
  readonly focusMetaWindow: Meta.Window | null;
  openPreferences(): void;
  move(metaWindow: Meta.Window, rect: RectLike): void;
  moveCenter(metaWindow: Meta.Window): void;
  observe(name: string, callback: (shadow: TilingShadow) => void): void;
  isFloatingExempt(metaWindow: Meta.Window): boolean;
  addFloatOverride(metaWindow: Meta.Window): void;
  removeFloatOverride(metaWindow: Meta.Window): void;
}

/** Handles shell-owned actions that never enter the portable tiling state machine. */
export class CorePlatformCommands {
  constructor(private readonly host: CorePlatformCommandsHost) {}

  handle(action: AnvilAction): boolean {
    const host = this.host;
    if (action.name === "FocusBorderToggle") {
      const enabled = host.settings.get_boolean("focus-border-toggle");
      host.settings.set_boolean("focus-border-toggle", !enabled);
      return true;
    }
    if (action.name === "GapSize") {
      const current = host.settings.get_uint("window-gap-size-increment");
      host.settings.set_uint(
        "window-gap-size-increment",
        Math.max(0, Math.min(8, current + action.amount))
      );
      host.observe("gap-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "TilingModeToggle") {
      const enabled = host.settings.get_boolean("tiling-mode-enabled");
      host.settings.set_boolean("tiling-mode-enabled", !enabled);
      host.observe("tiling-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "WorkspaceActiveTileToggle") {
      const active = `${global.workspace_manager.get_active_workspace_index()}`;
      const skipped = host.settings.get_string("workspace-skip-tile").split(",").filter(Boolean);
      const next = skipped.includes(active)
        ? skipped.filter((workspace) => workspace !== active)
        : [...skipped, active];
      host.settings.set_string("workspace-skip-tile", next.join(","));
      host.observe("workspace-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "CancelOperation") {
      host.observe("cancel-operation", (shadow) => shadow.cancelOperation());
      return true;
    }
    if (action.name === "PrefsOpen") {
      const existing = Utils.findWindowWith(host.prefsTitle, Utils.PREFERENCES_WINDOW_CLASS);
      if (existing?.get_workspace()) {
        existing.get_workspace()!.activate_with_focus(existing, global.display.get_current_time());
        host.moveCenter(existing);
      } else {
        host.openPreferences();
      }
      return true;
    }
    if (action.name === "WindowClose") {
      host.focusMetaWindow?.delete(global.display.get_current_time());
      return true;
    }
    if (action.name === "WindowSwapLastActive") {
      const focused = host.focusMetaWindow;
      if (!focused) return true;
      const target = global.display.get_tab_next(
        Meta.TabList.NORMAL,
        global.display.get_workspace_manager().get_active_workspace(),
        focused,
        false
      );
      if (target) {
        host.observe("swap-last-active", (shadow) => shadow.observeWindowSwap(focused, target));
      }
      return true;
    }
    if (action.name === "WindowResize") {
      const metaWindow = host.focusMetaWindow;
      if (!metaWindow) return true;
      const grabOp = {
        Right: Meta.GrabOp.KEYBOARD_RESIZING_E,
        Left: Meta.GrabOp.KEYBOARD_RESIZING_W,
        Top: Meta.GrabOp.KEYBOARD_RESIZING_N,
        Bottom: Meta.GrabOp.KEYBOARD_RESIZING_S,
      }[action.direction];
      host.observe("keyboard-resize", (shadow) =>
        shadow.observeKeyboardResize(metaWindow, grabOp, action.amount)
      );
      return true;
    }
    if (action.name === "SnapLayoutMove") {
      this.handleSnapLayoutMove(action);
      return true;
    }
    if (action.name === "ShowTabDecorationToggle") {
      if (!host.settings.get_boolean("tabbed-tiling-mode-enabled")) return true;
      const showTabs = host.settings.get_boolean("showtab-decoration-enabled");
      host.settings.set_boolean("showtab-decoration-enabled", !showTabs);
      host.observe("tab-decoration-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name !== "FloatClassToggle") return false;
    const metaWindow = host.focusMetaWindow;
    if (!metaWindow) return true;
    if (host.isFloatingExempt(metaWindow)) host.removeFloatOverride(metaWindow);
    else host.addFloatOverride(metaWindow);
    host.observe("float-class-policy", (shadow) => shadow.observePolicy());
    return true;
  }

  private handleSnapLayoutMove(action: Extract<AnvilAction, { name: "SnapLayoutMove" }>): void {
    const host = this.host;
    const metaWindow = host.focusMetaWindow;
    if (!metaWindow) return;
    const snap = computeSnapLayout(
      action.direction,
      metaWindow.get_work_area_current_monitor(),
      action.amount,
      metaWindow.get_frame_rect()
    );
    if (!snap) return;

    const requested = snap.rect;
    const request = {
      x: requested.x,
      y: requested.y,
      width: requested.width,
      height: requested.height,
    };
    let rect = {
      x: Utils.resolveX(request, metaWindow),
      y: Utils.resolveY(request, metaWindow),
      width: requested.width,
      height: requested.height,
    };
    if (snap.processGap) {
      const gap =
        host.settings.get_uint("window-gap-size") *
        host.settings.get_uint("window-gap-size-increment");
      if (rect.width > gap * 2 && rect.height > gap * 2) {
        rect = {
          x: rect.x + gap,
          y: rect.y + gap,
          width: rect.width - gap * 2,
          height: rect.height - gap * 2,
        };
      }
    }
    if (!host.isFloatingExempt(metaWindow)) host.addFloatOverride(metaWindow);
    host.observe("snap-policy", (shadow) => shadow.observePolicy());
    host.move(metaWindow, rect);
  }
}

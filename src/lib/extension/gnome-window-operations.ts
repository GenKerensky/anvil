/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Meta from "gi://Meta";

import * as Utils from "./utils.js";
import { NODE_TYPES, type Node, type RectLike } from "./tree.js";
import { WINDOW_MODES } from "./window/constants.js";
import type { AnvilWindowActor } from "./window/types.js";

/** Owns imperative Mutter frame movement and monitor-space projection. */
export class GnomeWindowOperations {
  move(metaWindow: Meta.Window | null, rect: RectLike): void {
    if (!metaWindow || (metaWindow as Meta.Window & { grabbed?: boolean }).grabbed) return;
    try {
      metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
      metaWindow.unmaximize();
    } catch {
      // GNOME 48 and older accepted explicit flags on unmaximize().
      const legacyWindow = metaWindow as unknown as {
        unmaximize(flags: Meta.MaximizeFlags): void;
      };
      legacyWindow.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
      legacyWindow.unmaximize(Meta.MaximizeFlags.VERTICAL);
      legacyWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;
    windowActor.remove_all_transitions();
    metaWindow.move_frame(true, rect.x, rect.y);
    metaWindow.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
  }

  moveCenter(metaWindow: Meta.Window | null): void {
    if (!metaWindow) return;
    const frameRect = metaWindow.get_frame_rect();
    const request = {
      x: "center",
      y: "center",
      width: frameRect.width,
      height: frameRect.height,
    };
    this.move(metaWindow, {
      x: Utils.resolveX(request, metaWindow),
      y: Utils.resolveY(request, metaWindow),
      width: Utils.resolveWidth(request, metaWindow),
      height: Utils.resolveHeight(request, metaWindow),
    });
  }

  rectForMonitor(node: Node | null, targetMonitor: number): RectLike | null {
    if (!node || node.nodeType !== NODE_TYPES.WINDOW || targetMonitor < 0) return null;
    const metaWindow = node.nodeValue as Meta.Window;
    const currentWorkArea = metaWindow.get_work_area_current_monitor();
    const targetWorkArea = metaWindow.get_work_area_for_monitor(targetMonitor);
    if (!currentWorkArea || !targetWorkArea) return null;

    let rect: RectLike | null = node.rect;
    if (!rect && node.mode === WINDOW_MODES.FLOAT) rect = metaWindow.get_frame_rect();
    if (!rect) return null;

    const projected = { ...rect };
    projected.height *= targetWorkArea.height / currentWorkArea.height;
    projected.width *= targetWorkArea.width / currentWorkArea.width;

    if (targetWorkArea.y < currentWorkArea.y) {
      projected.y =
        ((targetWorkArea.y + projected.y - currentWorkArea.y) / currentWorkArea.height) *
        targetWorkArea.height;
    } else if (targetWorkArea.y > currentWorkArea.y) {
      projected.y =
        (projected.y / currentWorkArea.height) * targetWorkArea.height + targetWorkArea.y;
    }

    if (targetWorkArea.x < currentWorkArea.x) {
      projected.x =
        ((targetWorkArea.x + projected.x - currentWorkArea.x) / currentWorkArea.width) *
        targetWorkArea.width;
    } else if (targetWorkArea.x > currentWorkArea.x) {
      projected.x = (projected.x / currentWorkArea.width) * targetWorkArea.width + targetWorkArea.x;
    }
    return projected;
  }
}

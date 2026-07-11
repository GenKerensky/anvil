/*
 * Geometry and direction/grab pure helpers (B11-1).
 */
import Meta from "gi://Meta";
import { ORIENTATION_TYPES, LAYOUT_TYPES, POSITION } from "../tree.js";
import { GRAB_TYPES } from "../window/constants.js";

export function resolveX(
  rectRequest: Record<string, string | number | undefined>,
  metaWindow: Meta.Window
): number {
  const metaRect = metaWindow.get_frame_rect();
  const monitorRect = metaWindow.get_work_area_current_monitor();
  let val = metaRect.x;
  const x = rectRequest.x;
  switch (typeof x) {
    case "string":
      switch (x) {
        case "center":
          val = monitorRect.width * 0.5 - resolveWidth(rectRequest, metaWindow) * 0.5;
          break;
        case "left":
          val = 0;
          break;
        case "right":
          val = monitorRect.width - resolveWidth(rectRequest, metaWindow);
          break;
        default:
          break;
      }
      break;
    case "number":
      val = x;
      break;
    default:
      break;
  }
  val = monitorRect.x + val;
  return val;
}

export function resolveY(
  rectRequest: Record<string, string | number | undefined>,
  metaWindow: Meta.Window
): number {
  const metaRect = metaWindow.get_frame_rect();
  const monitorRect = metaWindow.get_work_area_current_monitor();
  let val = metaRect.y;
  const y = rectRequest.y;
  switch (typeof y) {
    case "string":
      switch (y) {
        case "center":
          val = monitorRect.height * 0.5 - resolveHeight(rectRequest, metaWindow) * 0.5;
          break;
        case "top":
          val = 0;
          break;
        case "bottom":
          val = monitorRect.height - resolveHeight(rectRequest, metaWindow);
          break;
        default:
          break;
      }
      break;
    case "number":
      val = y;
      break;
    default:
      break;
  }
  val = monitorRect.y + val;
  return val;
}

export function resolveWidth(
  rectRequest: Record<string, string | number | undefined>,
  metaWindow: Meta.Window
): number {
  const metaRect = metaWindow.get_frame_rect();
  const monitorRect = metaWindow.get_work_area_current_monitor();
  let val = metaRect.width;
  const width = rectRequest.width;
  switch (typeof width) {
    case "number":
      if (Number.isInteger(width) && width != 1) {
        val = width;
      } else {
        const monitorWidth = monitorRect.width;
        val = monitorWidth * width;
      }
      break;
    default:
      break;
  }
  return val;
}

export function resolveHeight(
  rectRequest: Record<string, string | number | undefined>,
  metaWindow: Meta.Window
): number {
  const metaRect = metaWindow.get_frame_rect();
  const monitorRect = metaWindow.get_work_area_current_monitor();
  let val = metaRect.height;
  const height = rectRequest.height;
  switch (typeof height) {
    case "number":
      if (Number.isInteger(height) && height != 1) {
        val = height;
      } else {
        const monitorHeight = monitorRect.height;
        val = monitorHeight * height;
      }
      break;
    default:
      break;
  }
  return val;
}

export function orientationFromDirection(direction: Meta.MotionDirection) {
  return direction === Meta.MotionDirection.LEFT || direction === Meta.MotionDirection.RIGHT
    ? ORIENTATION_TYPES.HORIZONTAL
    : ORIENTATION_TYPES.VERTICAL;
}

export function orientationFromLayout(layout: string) {
  switch (layout) {
    case LAYOUT_TYPES.HSPLIT:
    case LAYOUT_TYPES.TABBED:
      return ORIENTATION_TYPES.HORIZONTAL;
    case LAYOUT_TYPES.VSPLIT:
    case LAYOUT_TYPES.STACKED:
      return ORIENTATION_TYPES.VERTICAL;
    default:
      break;
  }
}

export function positionFromDirection(direction: Meta.MotionDirection) {
  return direction === Meta.MotionDirection.LEFT || direction === Meta.MotionDirection.UP
    ? POSITION.BEFORE
    : POSITION.AFTER;
}

export function resolveDirection(directionString: string) {
  if (directionString) {
    directionString = directionString.toUpperCase();

    if (directionString === "LEFT") {
      return Meta.MotionDirection.LEFT;
    }

    if (directionString === "RIGHT") {
      return Meta.MotionDirection.RIGHT;
    }

    if (directionString === "UP") {
      return Meta.MotionDirection.UP;
    }

    if (directionString === "DOWN") {
      return Meta.MotionDirection.DOWN;
    }
  }

  return null;
}

export function directionFrom(position: string, orientation: string) {
  if (position === POSITION.AFTER) {
    if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
      return Meta.DisplayDirection.RIGHT;
    } else {
      return Meta.DisplayDirection.DOWN;
    }
  } else if (position === POSITION.BEFORE) {
    if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
      return Meta.DisplayDirection.LEFT;
    } else {
      return Meta.DisplayDirection.UP;
    }
  }
}

/** Wayland paste/selection helpers — must not participate in tiling. */
export function rectContainsPoint(
  rect: { x: number; y: number; width: number; height: number },
  pointP: [number, number]
) {
  if (!(rect && pointP)) return false;
  return (
    rect.x <= pointP[0] &&
    pointP[0] <= rect.x + rect.width &&
    rect.y <= pointP[1] &&
    pointP[1] <= rect.y + rect.height
  );
}

export function metaWindowAtPoint(
  pointer: [number, number],
  windows: Meta.Window[]
): Meta.Window | null {
  for (const metaWindow of windows) {
    const metaRect = metaWindow.get_frame_rect();
    if (rectContainsPoint(metaRect, pointer)) {
      return metaWindow;
    }
  }
  return null;
}

export function orientationFromGrab(grabOp: Meta.GrabOp) {
  if (
    grabOp === Meta.GrabOp.RESIZING_N ||
    grabOp === Meta.GrabOp.RESIZING_S ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S
  ) {
    return ORIENTATION_TYPES.VERTICAL;
  } else if (
    grabOp === Meta.GrabOp.RESIZING_E ||
    grabOp === Meta.GrabOp.RESIZING_W ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W
  ) {
    return ORIENTATION_TYPES.HORIZONTAL;
  }
  return ORIENTATION_TYPES.NONE;
}

export function positionFromGrabOp(grabOp: Meta.GrabOp) {
  if (
    grabOp === Meta.GrabOp.RESIZING_W ||
    grabOp === Meta.GrabOp.RESIZING_N ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N
  ) {
    return POSITION.BEFORE;
  } else if (
    grabOp === Meta.GrabOp.RESIZING_E ||
    grabOp === Meta.GrabOp.RESIZING_S ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S
  ) {
    return POSITION.AFTER;
  }
  return POSITION.UNKNOWN;
}

export function allowResizeGrabOp(grabOp: Meta.GrabOp) {
  grabOp &= ~1024; // ignore META_GRAB_OP_WINDOW_FLAG_UNCONSTRAINED
  return (
    grabOp === Meta.GrabOp.RESIZING_N ||
    grabOp === Meta.GrabOp.RESIZING_E ||
    grabOp === Meta.GrabOp.RESIZING_W ||
    grabOp === Meta.GrabOp.RESIZING_S ||
    grabOp === Meta.GrabOp.RESIZING_NE ||
    grabOp === Meta.GrabOp.RESIZING_NW ||
    grabOp === Meta.GrabOp.RESIZING_SE ||
    grabOp === Meta.GrabOp.RESIZING_SW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_NE ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_NW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_SE ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_SW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN
  );
}

export function grabMode(grabOp: Meta.GrabOp) {
  grabOp &= ~1024; // ignore META_GRAB_OP_WINDOW_FLAG_UNCONSTRAINED
  if (
    grabOp === Meta.GrabOp.RESIZING_N ||
    grabOp === Meta.GrabOp.RESIZING_E ||
    grabOp === Meta.GrabOp.RESIZING_W ||
    grabOp === Meta.GrabOp.RESIZING_S ||
    grabOp === Meta.GrabOp.RESIZING_NE ||
    grabOp === Meta.GrabOp.RESIZING_NW ||
    grabOp === Meta.GrabOp.RESIZING_SE ||
    grabOp === Meta.GrabOp.RESIZING_SW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_NE ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_NW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_SE ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_SW ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W ||
    grabOp === Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN
  ) {
    return GRAB_TYPES.RESIZING;
  } else if (
    grabOp === Meta.GrabOp.KEYBOARD_MOVING ||
    grabOp === Meta.GrabOp.MOVING ||
    grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED
  ) {
    return GRAB_TYPES.MOVING;
  }
  return GRAB_TYPES.UNKNOWN;
}

export function decomposeGrabOp(grabOp: Meta.GrabOp) {
  grabOp &= ~1024; // ignore META_GRAB_OP_WINDOW_FLAG_UNCONSTRAINED
  switch (grabOp) {
    case Meta.GrabOp.RESIZING_NE:
    case Meta.GrabOp.KEYBOARD_RESIZING_NE:
      return [Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_E];
    case Meta.GrabOp.RESIZING_NW:
    case Meta.GrabOp.KEYBOARD_RESIZING_NW:
      return [Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_W];
    case Meta.GrabOp.RESIZING_SE:
    case Meta.GrabOp.KEYBOARD_RESIZING_SE:
      return [Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_E];
    case Meta.GrabOp.RESIZING_SW:
    case Meta.GrabOp.KEYBOARD_RESIZING_SW:
      return [Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_W];
    default:
      return [grabOp];
  }
}

export function directionFromGrab(grabOp: Meta.GrabOp) {
  if (grabOp === Meta.GrabOp.RESIZING_E || grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E) {
    return Meta.MotionDirection.RIGHT;
  } else if (grabOp === Meta.GrabOp.RESIZING_W || grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W) {
    return Meta.MotionDirection.LEFT;
  } else if (grabOp === Meta.GrabOp.RESIZING_N || grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N) {
    return Meta.MotionDirection.UP;
  } else if (grabOp === Meta.GrabOp.RESIZING_S || grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S) {
    return Meta.MotionDirection.DOWN;
  }
}

export function removeGapOnRect(
  rectWithGap: { x: number; y: number; width: number; height: number },
  gap: number
) {
  rectWithGap.x = rectWithGap.x -= gap;
  rectWithGap.y = rectWithGap.y -= gap;
  rectWithGap.width = rectWithGap.width += gap * 2;
  rectWithGap.height = rectWithGap.height += gap * 2;
  return rectWithGap;
}

// Credits: PopShell
export function oppositeDirectionOf(direction: Meta.MotionDirection) {
  if (direction === Meta.MotionDirection.LEFT) {
    return Meta.MotionDirection.RIGHT;
  } else if (direction === Meta.MotionDirection.RIGHT) {
    return Meta.MotionDirection.LEFT;
  } else if (direction === Meta.MotionDirection.UP) {
    return Meta.MotionDirection.DOWN;
  } else if (direction === Meta.MotionDirection.DOWN) {
    return Meta.MotionDirection.UP;
  }
}

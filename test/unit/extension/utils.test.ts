import { describe, it, expect } from "vitest";
import {
  createEnum,
  rectContainsPoint,
  monitorIndex,
  removeGapOnRect,
  oppositeDirectionOf,
  orientationFromDirection,
  positionFromDirection,
  orientationFromLayout,
  directionFrom,
  orientationFromGrab,
  positionFromGrabOp,
  allowResizeGrabOp,
  grabMode,
  decomposeGrabOp,
  directionFromGrab,
  resolveDirection,
  isGnome,
  isGnomeGTE,
} from "../../../src/lib/extension/utils.js";
import Meta from "gi://Meta";

// Replicate the string enums from tree.js / window.js for use in assertions.
// These are created via createEnum() in the source, so values are the key names.
const ORIENTATION_TYPES = Object.freeze({
  NONE: "NONE",
  HORIZONTAL: "HORIZONTAL",
  VERTICAL: "VERTICAL",
} as const);

const LAYOUT_TYPES = Object.freeze({
  STACKED: "STACKED",
  TABBED: "TABBED",
  ROOT: "ROOT",
  HSPLIT: "HSPLIT",
  VSPLIT: "VSPLIT",
  PRESET: "PRESET",
} as const);

const POSITION = Object.freeze({
  BEFORE: "BEFORE",
  AFTER: "AFTER",
  UNKNOWN: "UNKNOWN",
} as const);

const GRAB_TYPES = Object.freeze({
  RESIZING: "RESIZING",
  MOVING: "MOVING",
  UNKNOWN: "UNKNOWN",
} as const);

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [number, number];

describe("createEnum", () => {
  it("creates an object with each value mapped to itself", () => {
    const result = createEnum(["A", "B", "C"]);
    expect(result.A).toBe("A");
    expect(result.B).toBe("B");
    expect(result.C).toBe("C");
  });

  it("returns a frozen object", () => {
    const result = createEnum(["X", "Y"]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("handles empty array", () => {
    const result = createEnum([]);
    expect(Object.keys(result)).toHaveLength(0);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("handles single element", () => {
    const result = createEnum(["ONLY"]);
    expect(result.ONLY).toBe("ONLY");
    expect(Object.keys(result)).toHaveLength(1);
  });
});

describe("rectContainsPoint", () => {
  const rect: Rect = { x: 10, y: 20, width: 100, height: 50 };

  it("returns true for a point inside the rect", () => {
    expect(rectContainsPoint(rect, [50, 40] as Point)).toBe(true);
  });

  it("returns true for a point on the top-left corner", () => {
    expect(rectContainsPoint(rect, [10, 20] as Point)).toBe(true);
  });

  it("returns true for a point on the bottom-right corner", () => {
    expect(rectContainsPoint(rect, [110, 70] as Point)).toBe(true);
  });

  it("returns false for a point outside to the left", () => {
    expect(rectContainsPoint(rect, [5, 40] as Point)).toBe(false);
  });

  it("returns false for a point outside to the right", () => {
    expect(rectContainsPoint(rect, [111, 40] as Point)).toBe(false);
  });

  it("returns false for a point outside above", () => {
    expect(rectContainsPoint(rect, [50, 19] as Point)).toBe(false);
  });

  it("returns false for a point outside below", () => {
    expect(rectContainsPoint(rect, [50, 71] as Point)).toBe(false);
  });

  it("returns false when rect is null", () => {
    expect(rectContainsPoint(null as any, [50, 40] as Point)).toBe(false);
  });

  it("returns false when point is null", () => {
    expect(rectContainsPoint(rect, null as any)).toBe(false);
  });

  it("returns false when both are null", () => {
    expect(rectContainsPoint(null as any, null as any)).toBe(false);
  });

  it("returns false when rect is undefined", () => {
    expect(rectContainsPoint(undefined as any, [50, 40] as Point)).toBe(false);
  });
});

describe("monitorIndex", () => {
  it("extracts monitor index from standard format", () => {
    expect(monitorIndex("mo0ws0")).toBe(0);
  });

  it("extracts monitor index 1", () => {
    expect(monitorIndex("mo1ws0")).toBe(1);
  });

  it("extracts monitor index with multi-digit monitor", () => {
    expect(monitorIndex("mo12ws3")).toBe(12);
  });

  it("returns -1 for null input", () => {
    expect(monitorIndex(null as any)).toBe(-1);
  });

  it("returns -1 for undefined input", () => {
    expect(monitorIndex(undefined as any)).toBe(-1);
  });

  it("returns -1 for empty string", () => {
    expect(monitorIndex("")).toBe(-1);
  });
});

describe("removeGapOnRect", () => {
  it("expands rect by the gap amount on all sides", () => {
    const rect: Rect = { x: 20, y: 30, width: 100, height: 80 };
    const gap = 5;
    const result: Rect = removeGapOnRect(rect, gap);
    expect(result.x).toBe(15);
    expect(result.y).toBe(25);
    expect(result.width).toBe(110);
    expect(result.height).toBe(90);
  });

  it("handles gap of 0", () => {
    const rect: Rect = { x: 10, y: 10, width: 50, height: 50 };
    const result: Rect = removeGapOnRect(rect, 0);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
    expect(result.width).toBe(50);
    expect(result.height).toBe(50);
  });

  it("mutates and returns the same object", () => {
    const rect: Rect = { x: 10, y: 10, width: 50, height: 50 };
    const result = removeGapOnRect(rect, 3);
    expect(result).toBe(rect);
  });

  it("handles larger gap values", () => {
    const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
    const gap = 10;
    const result: Rect = removeGapOnRect(rect, gap);
    expect(result.x).toBe(90);
    expect(result.y).toBe(90);
    expect(result.width).toBe(220);
    expect(result.height).toBe(170);
  });
});

describe("oppositeDirectionOf", () => {
  it("returns RIGHT for LEFT", () => {
    expect(oppositeDirectionOf(Meta.MotionDirection.LEFT)).toBe(Meta.MotionDirection.RIGHT);
  });

  it("returns LEFT for RIGHT", () => {
    expect(oppositeDirectionOf(Meta.MotionDirection.RIGHT)).toBe(Meta.MotionDirection.LEFT);
  });

  it("returns DOWN for UP", () => {
    expect(oppositeDirectionOf(Meta.MotionDirection.UP)).toBe(Meta.MotionDirection.DOWN);
  });

  it("returns UP for DOWN", () => {
    expect(oppositeDirectionOf(Meta.MotionDirection.DOWN)).toBe(Meta.MotionDirection.UP);
  });

  it("returns undefined for unknown direction", () => {
    expect(oppositeDirectionOf(999)).toBeUndefined();
  });
});

describe("orientationFromDirection", () => {
  it("returns HORIZONTAL for LEFT", () => {
    expect(orientationFromDirection(Meta.MotionDirection.LEFT)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns HORIZONTAL for RIGHT", () => {
    expect(orientationFromDirection(Meta.MotionDirection.RIGHT)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns VERTICAL for UP", () => {
    expect(orientationFromDirection(Meta.MotionDirection.UP)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns VERTICAL for DOWN", () => {
    expect(orientationFromDirection(Meta.MotionDirection.DOWN)).toBe(ORIENTATION_TYPES.VERTICAL);
  });
});

describe("positionFromDirection", () => {
  it("returns BEFORE for LEFT", () => {
    expect(positionFromDirection(Meta.MotionDirection.LEFT)).toBe(POSITION.BEFORE);
  });

  it("returns BEFORE for UP", () => {
    expect(positionFromDirection(Meta.MotionDirection.UP)).toBe(POSITION.BEFORE);
  });

  it("returns AFTER for RIGHT", () => {
    expect(positionFromDirection(Meta.MotionDirection.RIGHT)).toBe(POSITION.AFTER);
  });

  it("returns AFTER for DOWN", () => {
    expect(positionFromDirection(Meta.MotionDirection.DOWN)).toBe(POSITION.AFTER);
  });
});

describe("orientationFromLayout", () => {
  it("returns HORIZONTAL for HSPLIT", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.HSPLIT)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns HORIZONTAL for TABBED", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.TABBED)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns VERTICAL for VSPLIT", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.VSPLIT)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns VERTICAL for STACKED", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.STACKED)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns undefined for ROOT", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.ROOT)).toBeUndefined();
  });

  it("returns undefined for PRESET", () => {
    expect(orientationFromLayout(LAYOUT_TYPES.PRESET)).toBeUndefined();
  });
});

describe("directionFrom", () => {
  it("returns RIGHT for AFTER + HORIZONTAL", () => {
    expect(directionFrom(POSITION.AFTER, ORIENTATION_TYPES.HORIZONTAL)).toBe(
      Meta.DisplayDirection.RIGHT
    );
  });

  it("returns DOWN for AFTER + VERTICAL", () => {
    expect(directionFrom(POSITION.AFTER, ORIENTATION_TYPES.VERTICAL)).toBe(
      Meta.DisplayDirection.DOWN
    );
  });

  it("returns LEFT for BEFORE + HORIZONTAL", () => {
    expect(directionFrom(POSITION.BEFORE, ORIENTATION_TYPES.HORIZONTAL)).toBe(
      Meta.DisplayDirection.LEFT
    );
  });

  it("returns UP for BEFORE + VERTICAL", () => {
    expect(directionFrom(POSITION.BEFORE, ORIENTATION_TYPES.VERTICAL)).toBe(
      Meta.DisplayDirection.UP
    );
  });

  it("returns undefined for UNKNOWN position", () => {
    expect(directionFrom(POSITION.UNKNOWN, ORIENTATION_TYPES.HORIZONTAL)).toBeUndefined();
  });
});

describe("orientationFromGrab", () => {
  it("returns VERTICAL for RESIZING_N", () => {
    expect(orientationFromGrab(Meta.GrabOp.RESIZING_N)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns VERTICAL for RESIZING_S", () => {
    expect(orientationFromGrab(Meta.GrabOp.RESIZING_S)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns VERTICAL for KEYBOARD_RESIZING_N", () => {
    expect(orientationFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_N)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns VERTICAL for KEYBOARD_RESIZING_S", () => {
    expect(orientationFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_S)).toBe(ORIENTATION_TYPES.VERTICAL);
  });

  it("returns HORIZONTAL for RESIZING_E", () => {
    expect(orientationFromGrab(Meta.GrabOp.RESIZING_E)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns HORIZONTAL for RESIZING_W", () => {
    expect(orientationFromGrab(Meta.GrabOp.RESIZING_W)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns HORIZONTAL for KEYBOARD_RESIZING_E", () => {
    expect(orientationFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_E)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns HORIZONTAL for KEYBOARD_RESIZING_W", () => {
    expect(orientationFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_W)).toBe(ORIENTATION_TYPES.HORIZONTAL);
  });

  it("returns NONE for MOVING", () => {
    expect(orientationFromGrab(Meta.GrabOp.MOVING)).toBe(ORIENTATION_TYPES.NONE);
  });

  it("returns NONE for diagonal grabs like RESIZING_NE", () => {
    expect(orientationFromGrab(Meta.GrabOp.RESIZING_NE)).toBe(ORIENTATION_TYPES.NONE);
  });
});

describe("positionFromGrabOp", () => {
  it("returns BEFORE for RESIZING_W", () => {
    expect(positionFromGrabOp(Meta.GrabOp.RESIZING_W)).toBe(POSITION.BEFORE);
  });

  it("returns BEFORE for RESIZING_N", () => {
    expect(positionFromGrabOp(Meta.GrabOp.RESIZING_N)).toBe(POSITION.BEFORE);
  });

  it("returns BEFORE for KEYBOARD_RESIZING_W", () => {
    expect(positionFromGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_W)).toBe(POSITION.BEFORE);
  });

  it("returns BEFORE for KEYBOARD_RESIZING_N", () => {
    expect(positionFromGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_N)).toBe(POSITION.BEFORE);
  });

  it("returns AFTER for RESIZING_E", () => {
    expect(positionFromGrabOp(Meta.GrabOp.RESIZING_E)).toBe(POSITION.AFTER);
  });

  it("returns AFTER for RESIZING_S", () => {
    expect(positionFromGrabOp(Meta.GrabOp.RESIZING_S)).toBe(POSITION.AFTER);
  });

  it("returns AFTER for KEYBOARD_RESIZING_E", () => {
    expect(positionFromGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_E)).toBe(POSITION.AFTER);
  });

  it("returns AFTER for KEYBOARD_RESIZING_S", () => {
    expect(positionFromGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_S)).toBe(POSITION.AFTER);
  });

  it("returns UNKNOWN for MOVING", () => {
    expect(positionFromGrabOp(Meta.GrabOp.MOVING)).toBe(POSITION.UNKNOWN);
  });

  it("returns UNKNOWN for diagonal grabs", () => {
    expect(positionFromGrabOp(Meta.GrabOp.RESIZING_NE)).toBe(POSITION.UNKNOWN);
  });
});

describe("allowResizeGrabOp", () => {
  it("returns true for RESIZING_N", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_N)).toBe(true);
  });

  it("returns true for RESIZING_E", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_E)).toBe(true);
  });

  it("returns true for RESIZING_S", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_S)).toBe(true);
  });

  it("returns true for RESIZING_W", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_W)).toBe(true);
  });

  it("returns true for RESIZING_NE", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_NE)).toBe(true);
  });

  it("returns true for RESIZING_NW", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_NW)).toBe(true);
  });

  it("returns true for RESIZING_SE", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_SE)).toBe(true);
  });

  it("returns true for RESIZING_SW", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_SW)).toBe(true);
  });

  it("returns true for KEYBOARD_RESIZING_N", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_N)).toBe(true);
  });

  it("returns true for KEYBOARD_RESIZING_E", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_E)).toBe(true);
  });

  it("returns true for KEYBOARD_RESIZING_S", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_S)).toBe(true);
  });

  it("returns true for KEYBOARD_RESIZING_W", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_W)).toBe(true);
  });

  it("returns true for KEYBOARD_RESIZING_UNKNOWN", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN)).toBe(true);
  });

  it("returns false for MOVING", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.MOVING)).toBe(false);
  });

  it("returns false for KEYBOARD_MOVING", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.KEYBOARD_MOVING)).toBe(false);
  });

  it("returns false for MOVING_UNCONSTRAINED", () => {
    expect(allowResizeGrabOp(Meta.GrabOp.MOVING_UNCONSTRAINED)).toBe(false);
  });

  it("strips the unconstrained flag and still detects resize", () => {
    // RESIZING_N (3) | 1024 = 1027
    expect(allowResizeGrabOp(Meta.GrabOp.RESIZING_N | 1024)).toBe(true);
  });
});

describe("grabMode", () => {
  it("returns RESIZING for RESIZING_N", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_N)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_E", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_E)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_S", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_S)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_W", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_W)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_NE", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_NE)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_NW", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_NW)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_SE", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_SE)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for RESIZING_SW", () => {
    expect(grabMode(Meta.GrabOp.RESIZING_SW)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for KEYBOARD_RESIZING_N", () => {
    expect(grabMode(Meta.GrabOp.KEYBOARD_RESIZING_N)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns RESIZING for KEYBOARD_RESIZING_UNKNOWN", () => {
    expect(grabMode(Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN)).toBe(GRAB_TYPES.RESIZING);
  });

  it("returns MOVING for MOVING", () => {
    expect(grabMode(Meta.GrabOp.MOVING)).toBe(GRAB_TYPES.MOVING);
  });

  it("returns MOVING for KEYBOARD_MOVING", () => {
    expect(grabMode(Meta.GrabOp.KEYBOARD_MOVING)).toBe(GRAB_TYPES.MOVING);
  });

  it("returns MOVING for MOVING_UNCONSTRAINED", () => {
    expect(grabMode(Meta.GrabOp.MOVING_UNCONSTRAINED)).toBe(GRAB_TYPES.MOVING);
  });

  it("returns UNKNOWN for unrecognized grab op", () => {
    expect(grabMode(999)).toBe(GRAB_TYPES.UNKNOWN);
  });

  it("strips unconstrained flag and returns correct mode", () => {
    // RESIZING_E (6) | 1024 = 1030
    expect(grabMode(Meta.GrabOp.RESIZING_E | 1024)).toBe(GRAB_TYPES.RESIZING);
  });
});

describe("decomposeGrabOp", () => {
  it("decomposes RESIZING_NE into RESIZING_N and RESIZING_E", () => {
    const result: number[] = decomposeGrabOp(Meta.GrabOp.RESIZING_NE);
    expect(result).toEqual([Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_E]);
  });

  it("decomposes RESIZING_NW into RESIZING_N and RESIZING_W", () => {
    const result: number[] = decomposeGrabOp(Meta.GrabOp.RESIZING_NW);
    expect(result).toEqual([Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_W]);
  });

  it("decomposes RESIZING_SE into RESIZING_S and RESIZING_E", () => {
    const result: number[] = decomposeGrabOp(Meta.GrabOp.RESIZING_SE);
    expect(result).toEqual([Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_E]);
  });

  it("decomposes RESIZING_SW into RESIZING_S and RESIZING_W", () => {
    const result: number[] = decomposeGrabOp(Meta.GrabOp.RESIZING_SW);
    expect(result).toEqual([Meta.GrabOp.RESIZING_S, Meta.GrabOp.RESIZING_W]);
  });

  it("returns single-element array for non-diagonal grabs", () => {
    expect(decomposeGrabOp(Meta.GrabOp.RESIZING_N)).toEqual([Meta.GrabOp.RESIZING_N]);
  });

  it("returns single-element array for MOVING", () => {
    expect(decomposeGrabOp(Meta.GrabOp.MOVING)).toEqual([Meta.GrabOp.MOVING]);
  });

  it("strips unconstrained flag before decomposing", () => {
    // RESIZING_NE (4) | 1024 = 1028
    const result: number[] = decomposeGrabOp(Meta.GrabOp.RESIZING_NE | 1024);
    expect(result).toEqual([Meta.GrabOp.RESIZING_N, Meta.GrabOp.RESIZING_E]);
  });
});

describe("directionFromGrab", () => {
  it("returns RIGHT for RESIZING_E", () => {
    expect(directionFromGrab(Meta.GrabOp.RESIZING_E)).toBe(Meta.MotionDirection.RIGHT);
  });

  it("returns RIGHT for KEYBOARD_RESIZING_E", () => {
    expect(directionFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_E)).toBe(Meta.MotionDirection.RIGHT);
  });

  it("returns LEFT for RESIZING_W", () => {
    expect(directionFromGrab(Meta.GrabOp.RESIZING_W)).toBe(Meta.MotionDirection.LEFT);
  });

  it("returns LEFT for KEYBOARD_RESIZING_W", () => {
    expect(directionFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_W)).toBe(Meta.MotionDirection.LEFT);
  });

  it("returns UP for RESIZING_N", () => {
    expect(directionFromGrab(Meta.GrabOp.RESIZING_N)).toBe(Meta.MotionDirection.UP);
  });

  it("returns UP for KEYBOARD_RESIZING_N", () => {
    expect(directionFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_N)).toBe(Meta.MotionDirection.UP);
  });

  it("returns DOWN for RESIZING_S", () => {
    expect(directionFromGrab(Meta.GrabOp.RESIZING_S)).toBe(Meta.MotionDirection.DOWN);
  });

  it("returns DOWN for KEYBOARD_RESIZING_S", () => {
    expect(directionFromGrab(Meta.GrabOp.KEYBOARD_RESIZING_S)).toBe(Meta.MotionDirection.DOWN);
  });

  it("returns undefined for MOVING", () => {
    expect(directionFromGrab(Meta.GrabOp.MOVING)).toBeUndefined();
  });
});

describe("resolveDirection", () => {
  it("resolves 'left' to Meta.MotionDirection.LEFT", () => {
    expect(resolveDirection("left")).toBe(Meta.MotionDirection.LEFT);
  });

  it("resolves 'RIGHT' to Meta.MotionDirection.RIGHT", () => {
    expect(resolveDirection("RIGHT")).toBe(Meta.MotionDirection.RIGHT);
  });

  it("resolves 'Up' to Meta.MotionDirection.UP", () => {
    expect(resolveDirection("Up")).toBe(Meta.MotionDirection.UP);
  });

  it("resolves 'down' to Meta.MotionDirection.DOWN", () => {
    expect(resolveDirection("down")).toBe(Meta.MotionDirection.DOWN);
  });

  it("is case-insensitive", () => {
    expect(resolveDirection("LeFt")).toBe(Meta.MotionDirection.LEFT);
  });

  it("returns null for null input", () => {
    expect(resolveDirection(null as any)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(resolveDirection(undefined as any)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveDirection("")).toBeNull();
  });

  it("returns null for unknown direction string", () => {
    expect(resolveDirection("diagonal")).toBeNull();
  });
});

describe("isGnome", () => {
  // PACKAGE_VERSION mock returns '47.0', so major = 47
  it("returns true for matching major version", () => {
    expect(isGnome(47)).toBe(true);
  });

  it("returns false for non-matching major version", () => {
    expect(isGnome(46)).toBe(false);
  });

  it("returns false for higher version", () => {
    expect(isGnome(48)).toBe(false);
  });
});

describe("isGnomeGTE", () => {
  // PACKAGE_VERSION mock returns '47.0', so major = 47
  it("returns true for same major version", () => {
    expect(isGnomeGTE(47)).toBe(true);
  });

  it("returns true for lower major version", () => {
    expect(isGnomeGTE(45)).toBe(true);
  });

  it("returns true for much lower version", () => {
    expect(isGnomeGTE(40)).toBe(true);
  });

  it("returns false for higher major version", () => {
    expect(isGnomeGTE(48)).toBe(false);
  });

  it("returns false for much higher version", () => {
    expect(isGnomeGTE(50)).toBe(false);
  });
});

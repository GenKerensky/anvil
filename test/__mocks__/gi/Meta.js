import { vi } from "vitest";

export const MotionDirection = {
  UP: 1,
  DOWN: 2,
  LEFT: 3,
  RIGHT: 4,
};

export const DisplayDirection = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
};

export const GrabOp = {
  MOVING: 1,
  RESIZING_NW: 2,
  RESIZING_N: 3,
  RESIZING_NE: 4,
  RESIZING_E: 6,
  RESIZING_SW: 8,
  RESIZING_S: 9,
  RESIZING_SE: 10,
  RESIZING_W: 12,
  KEYBOARD_MOVING: 13,
  KEYBOARD_RESIZING_UNKNOWN: 14,
  KEYBOARD_RESIZING_NW: 15,
  KEYBOARD_RESIZING_N: 16,
  KEYBOARD_RESIZING_NE: 17,
  KEYBOARD_RESIZING_E: 19,
  KEYBOARD_RESIZING_SW: 21,
  KEYBOARD_RESIZING_S: 22,
  KEYBOARD_RESIZING_SE: 23,
  KEYBOARD_RESIZING_W: 25,
  MOVING_UNCONSTRAINED: 1025,
};

export const TabList = {
  NORMAL_ALL: 0,
};

export const KeyBindingFlags = {
  NONE: 0,
  PER_WINDOW: 1,
  BUILTIN: 2,
  IS_REVERSED: 4,
  NON_MASKABLE: 8,
  IGNORE_AUTOREPEAT: 16,
  NO_AUTO_GRAB: 32,
};

export const KeyBindingAction = {
  NONE: 0,
  WORKSPACE_1: 1,
  WORKSPACE_2: 2,
  MOVE_TO_WORKSPACE_1: 3,
  MOVE_TO_WORKSPACE_2: 4,
};

export default {
  MotionDirection,
  DisplayDirection,
  GrabOp,
  TabList,
  KeyBindingFlags,
  KeyBindingAction,
};

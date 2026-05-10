import { vi } from "vitest";

export const ActorAlign = {
  FILL: 0,
  START: 1,
  CENTER: 2,
  END: 3,
};

export const ModifierType = {
  SHIFT_MASK: 1,
  CONTROL_MASK: 4,
  MOD1_MASK: 8,
  SUPER_MASK: 67108864,
};

export const Event = class Event {
  constructor() {}
  get_state() {
    return 0;
  }
  get_coords() {
    return [0, 0];
  }
};

export default {
  ActorAlign,
  ModifierType,
  Event,
};

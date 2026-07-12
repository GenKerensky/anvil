import { vi } from "vitest";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

export const SignalFlags = {
  RUN_FIRST: 1 << 0,
  RUN_LAST: 1 << 1,
  RUN_CLEANUP: 1 << 2,
  NO_RECURSE: 1 << 3,
  DETAILED: 1 << 4,
  ACTION: 1 << 5,
  NO_HOOKS: 1 << 6,
};

class GObjectBase extends withSignals() {
  constructor() {
    super();
  }
}

export { GObjectBase as Object };

export function registerClass(...args) {
  return args.at(-1);
}

export default {
  Object: GObjectBase,
  registerClass,
  SignalFlags,
  ParamSpec: {
    string: vi.fn(() => ({})),
    int: vi.fn(() => ({})),
    boolean: vi.fn(() => ({})),
    double: vi.fn(() => ({})),
    flags: vi.fn(() => ({})),
    enum: vi.fn(() => ({})),
    object: vi.fn(() => ({})),
  },
  ParamFlags: {
    READABLE: 1,
    WRITABLE: 2,
    READWRITE: 3,
  },
  TYPE_BOOLEAN: "gboolean",
  TYPE_INT: "gint",
  TYPE_STRING: "gchararray",
  TYPE_DOUBLE: "gdouble",
};

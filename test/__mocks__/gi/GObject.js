import { vi } from "vitest";

class GObjectBase {
  constructor() {}

  connect() {
    return 0;
  }

  disconnect() {}

  notify() {}
}

export default {
  Object: GObjectBase,
  registerClass(klass) {
    // Make the class behave as if it were registered with GObject
    return klass;
  },
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

import { vi } from "vitest";

export const panel = {
  statusArea: {
    quickSettings: {
      addExternalIndicator: () => {},
    },
  },
};

export const wm = {
  addKeybinding: () => {},
  removeKeybinding: () => {},
  allowKeybinding: () => {},
};

export const layoutManager = {
  monitors: [],
  primaryIndex: 0,
  uiGroup: {
    add_child: vi.fn(),
  },
};

export const pushModal = vi.fn(() => ({}));
export const popModal = vi.fn();

export const overview = {
  connect: () => 0,
  disconnect: () => {},
};

export const sessionMode = {
  currentMode: "user",
  parentMode: "user",
  connect: () => 0,
  disconnect: () => {},
};

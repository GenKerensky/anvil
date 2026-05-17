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
};

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

/**
 * Helper factory for creating mock Meta.Windows
 * Ported from jcrussell/forge
 */

// eslint-disable-next-line vitest/no-mocks-import
import { Window, Rectangle, WindowType } from "../../__mocks__/gi/Meta.js";

export function createMockWindow(overrides = {}) {
  return new Window({
    id: overrides.id ?? `win-${Date.now()}-${Math.random()}`,
    rect: new Rectangle(overrides.rect ?? {}),
    wm_class: "wm_class" in overrides ? overrides.wm_class : "TestApp",
    title: "title" in overrides ? overrides.title : "Test Window",
    window_type: "window_type" in overrides ? overrides.window_type : WindowType.NORMAL,
    transient_for: "transient_for" in overrides ? overrides.transient_for : null,
    allows_resize: "allows_resize" in overrides ? overrides.allows_resize : true,
    ...overrides,
  });
}

export function createMockWindowArray(count, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    createMockWindow({ ...baseOverrides, id: `win-${i}` })
  );
}

export default {
  createMockWindow,
  createMockWindowArray,
};

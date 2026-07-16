import { describe, expect, it, vi } from "vitest";

import { PrefsThemeManager } from "../../../src/lib/prefs/prefs-theme-manager.js";

describe("PrefsThemeManager", () => {
  it("uses a unique css-updated token for every successful reload request", () => {
    const settings = { set_string: vi.fn((_key: string, _value: string) => true) };
    const manager = new PrefsThemeManager({ configMgr: {} as any, settings: settings as any });

    expect(manager.reloadStylesheet()).toBe(true);
    expect(manager.reloadStylesheet()).toBe(true);

    expect(settings.set_string).toHaveBeenCalledTimes(2);
    expect(settings.set_string.mock.calls[0][1]).not.toBe(settings.set_string.mock.calls[1][1]);
  });

  it("reports a failed settings notification", () => {
    const settings = { set_string: vi.fn((_key: string, _value: string) => false) };
    const manager = new PrefsThemeManager({ configMgr: {} as any, settings: settings as any });

    expect(manager.reloadStylesheet()).toBe(false);
  });
});

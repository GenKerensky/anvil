/*
 * SettingsBridge handler routing tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsBridge } from "../../../src/lib/extension/settings-bridge.js";

describe("SettingsBridge", () => {
  let host: any;
  let bridge: SettingsBridge;

  beforeEach(() => {
    host = {
      settings: {
        get_boolean: vi.fn(() => true),
        connect: vi.fn(() => 99),
        disconnect: vi.fn(),
      },
      tree: {
        getNodeByLayout: vi.fn(() => []),
      },
      reloadWindowOverrides: vi.fn(),
      bordersEnabled: vi.fn(() => true),
      ensureAllBorderActors: vi.fn(),
      updateBorderLayout: vi.fn(),
      destroyAllBorderActors: vi.fn(),
      pointerPolicyNeeded: vi.fn(() => false),
      ensurePointerPolicy: vi.fn(),
      teardownPointerPolicy: vi.fn(),
      setHoverFocusEnabled: vi.fn(),
      renderTree: vi.fn(),
      determineSplitLayout: vi.fn(() => "HSPLIT"),
      reloadStylesheet: vi.fn(),
      cleanupAlwaysFloat: vi.fn(),
      restoreAlwaysFloat: vi.fn(),
      clearResizedWindows: vi.fn(),
      observePortablePolicy: vi.fn(),
    };
    bridge = new SettingsBridge(host);
  });

  it("enable connects settings changed; disable disconnects once", () => {
    bridge.enable();
    expect(host.settings.connect).toHaveBeenCalledWith("changed", expect.any(Function));
    bridge.enable(); // no double connect
    expect(host.settings.connect).toHaveBeenCalledTimes(1);

    bridge.disable();
    expect(host.settings.disconnect).toHaveBeenCalledWith(99);
    bridge.disable();
    expect(host.settings.disconnect).toHaveBeenCalledTimes(1);
  });

  it("monitor-constraints clears resized windows and re-renders", () => {
    bridge.handleChanged("monitor-constraints");
    expect(host.clearResizedWindows).toHaveBeenCalled();
    expect(host.renderTree).toHaveBeenCalledWith("monitor-constraints", true);
  });

  it("observes a complete portable policy before legacy settings effects", () => {
    bridge.handleChanged("tiling-mode-enabled");

    expect(host.observePortablePolicy).toHaveBeenCalledOnce();
    expect(host.observePortablePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      host.renderTree.mock.invocationCallOrder[0]
    );
  });

  it("window-overrides-reload-trigger reloads overrides", () => {
    bridge.handleChanged("window-overrides-reload-trigger");
    expect(host.reloadWindowOverrides).toHaveBeenCalled();
  });

  it("unknown key is a no-op", () => {
    expect(() => bridge.handleChanged("not-a-real-key")).not.toThrow();
    expect(host.renderTree).not.toHaveBeenCalled();
  });

  it("focus-border-toggle ensures borders when enabled", () => {
    host.bordersEnabled.mockReturnValue(true);
    bridge.handleChanged("focus-border-toggle");
    expect(host.ensureAllBorderActors).toHaveBeenCalled();
    expect(host.updateBorderLayout).toHaveBeenCalled();
  });

  it("focus-border-toggle destroys borders when disabled", () => {
    host.bordersEnabled.mockReturnValue(false);
    bridge.handleChanged("focus-border-toggle");
    expect(host.destroyAllBorderActors).toHaveBeenCalled();
  });

  it("refreshes border geometry after a stylesheet update", () => {
    bridge.handleChanged("css-updated");
    expect(host.reloadStylesheet).toHaveBeenCalled();
    expect(host.updateBorderLayout).toHaveBeenCalled();
  });
});

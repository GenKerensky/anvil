/*
 * SettingsBridge handler routing tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsBridge } from "../../../src/lib/extension/settings-bridge.js";

describe("SettingsBridge", () => {
  let host: any;
  let bridge: SettingsBridge;
  let changedCallback: ((settings: unknown, key: string) => void) | undefined;

  beforeEach(() => {
    host = {
      settings: {
        get_boolean: vi.fn(() => true),
        get_string: vi.fn(() => ""),
        connect: vi.fn((_signal, callback) => {
          changedCallback = callback;
          return 99;
        }),
        disconnect: vi.fn(),
      },
      tree: {
        getNodeByLayout: vi.fn(() => []),
      },
      reloadWindowOverrides: vi.fn(),
      updateBorderLayout: vi.fn(),
      pointerPolicyNeeded: vi.fn(() => false),
      ensurePointerPolicy: vi.fn(),
      teardownPointerPolicy: vi.fn(),
      setHoverFocusEnabled: vi.fn(),
      renderTree: vi.fn(),
      determineSplitLayout: vi.fn(() => "HSPLIT"),
      refreshStylesheet: vi.fn(),
      cleanupAlwaysFloat: vi.fn(),
      restoreAlwaysFloat: vi.fn(),
      clearResizedWindows: vi.fn(),
      suspendGrabResizeTilingEffects: vi.fn(),
      observePortablePolicy: vi.fn(),
      startWindowPicker: vi.fn(),
      cancelWindowPicker: vi.fn(),
    };
    bridge = new SettingsBridge(host);
  });

  function emitChanged(key: string): void {
    bridge.enable();
    changedCallback!(host.settings, key);
  }

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
    emitChanged("monitor-constraints");
    expect(host.clearResizedWindows).toHaveBeenCalled();
    expect(host.renderTree).toHaveBeenCalledWith("monitor-constraints", true);
  });

  it("observes a complete portable policy before legacy settings effects", () => {
    emitChanged("tiling-mode-enabled");

    expect(host.observePortablePolicy).toHaveBeenCalledOnce();
    expect(host.observePortablePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      host.renderTree.mock.invocationCallOrder[0]
    );
  });

  it("suspends Anvil resize effects when tiling is disabled", () => {
    host.settings.get_boolean.mockReturnValue(false);

    emitChanged("tiling-mode-enabled");

    expect(host.suspendGrabResizeTilingEffects).toHaveBeenCalledOnce();
    expect(host.renderTree).toHaveBeenCalledWith("tiling-mode-enabled");
  });

  it("does not suspend resize effects when tiling is enabled", () => {
    host.settings.get_boolean.mockReturnValue(true);

    emitChanged("tiling-mode-enabled");

    expect(host.suspendGrabResizeTilingEffects).not.toHaveBeenCalled();
  });

  it("window-overrides-reload-trigger reloads overrides", () => {
    emitChanged("window-overrides-reload-trigger");
    expect(host.reloadWindowOverrides).toHaveBeenCalled();
    expect(host.reloadWindowOverrides.mock.invocationCallOrder[0]).toBeLessThan(
      host.observePortablePolicy.mock.invocationCallOrder[0]
    );
  });

  it("routes valid window picker requests and ignores malformed messages", () => {
    host.settings.get_string.mockReturnValue(
      JSON.stringify({ version: 1, id: "pick-1", action: "pick" })
    );
    emitChanged("window-picker-request");
    expect(host.startWindowPicker).toHaveBeenCalledWith("pick-1");

    host.settings.get_string.mockReturnValue(
      JSON.stringify({ version: 1, id: "pick-1", action: "cancel" })
    );
    changedCallback!(host.settings, "window-picker-request");
    expect(host.cancelWindowPicker).toHaveBeenCalledWith("pick-1");

    host.settings.get_string.mockReturnValue("not json");
    changedCallback!(host.settings, "window-picker-request");
    expect(host.startWindowPicker).toHaveBeenCalledTimes(1);
    expect(host.cancelWindowPicker).toHaveBeenCalledTimes(1);
  });

  it("unknown key is a no-op", () => {
    expect(() => emitChanged("not-a-real-key")).not.toThrow();
    expect(host.renderTree).not.toHaveBeenCalled();
  });

  it("focus-border-toggle reconciles registered decorations when enabled", () => {
    emitChanged("focus-border-toggle");
    expect(host.updateBorderLayout).toHaveBeenCalled();
  });

  it("focus-border-toggle reconciles without destroying lifecycle state when disabled", () => {
    emitChanged("focus-border-toggle");
    expect(host.updateBorderLayout).toHaveBeenCalled();
  });

  it("refreshes border geometry after a stylesheet update", () => {
    emitChanged("css-updated");
    expect(host.refreshStylesheet).toHaveBeenCalled();
    expect(host.updateBorderLayout).toHaveBeenCalled();
    expect(host.refreshStylesheet.mock.invocationCallOrder[0]).toBeLessThan(
      host.updateBorderLayout.mock.invocationCallOrder[0]
    );
  });
});

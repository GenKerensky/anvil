import { beforeEach, describe, expect, it, vi } from "vitest";
import Meta from "gi://Meta";

import {
  CorePlatformCommands,
  type CorePlatformCommandsHost,
} from "../../../src/lib/extension/core-platform-commands.js";
import type { TilingShadow } from "../../../src/lib/extension/tiling-shadow.js";
import type { AnvilAction } from "../../../src/lib/extension/window/actions.js";
import { PREFERENCES_WINDOW_CLASS } from "../../../src/lib/extension/utils.js";
import { createMockSettings, createMockWindow } from "../mocks/helpers/index.js";

describe("CorePlatformCommands", () => {
  let host: CorePlatformCommandsHost;
  let commands: CorePlatformCommands;
  let shadow: Record<string, ReturnType<typeof vi.fn>>;
  let activeWorkspace: { activate_with_focus: ReturnType<typeof vi.fn> };
  let workspaceManager: {
    get_n_workspaces: ReturnType<typeof vi.fn>;
    get_workspace_by_index: ReturnType<typeof vi.fn>;
    get_active_workspace: ReturnType<typeof vi.fn>;
  };
  let getActiveWorkspaceIndex: ReturnType<typeof vi.fn>;
  let getTabList: ReturnType<typeof vi.fn>;
  let getTabNext: ReturnType<typeof vi.fn>;

  function setFocusedWindow(metaWindow: Meta.Window | null): void {
    Object.defineProperty(host, "focusMetaWindow", { value: metaWindow });
  }

  beforeEach(() => {
    shadow = {
      observePolicy: vi.fn(),
      cancelOperation: vi.fn(),
      observeWindowSwap: vi.fn(),
      observeKeyboardResize: vi.fn(),
    };
    host = {
      settings: createMockSettings() as unknown as CorePlatformCommandsHost["settings"],
      prefsTitle: "Anvil",
      focusMetaWindow: null,
      openPreferences: vi.fn(),
      move: vi.fn(),
      moveCenter: vi.fn(),
      observe: vi.fn((_name, callback) => callback(shadow as unknown as TilingShadow)),
      isFloatingExempt: vi.fn(() => false),
      addFloatOverride: vi.fn(),
      removeFloatOverride: vi.fn(),
    };
    commands = new CorePlatformCommands(host);

    activeWorkspace = { activate_with_focus: vi.fn() };
    workspaceManager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn(() => activeWorkspace),
      get_active_workspace: vi.fn(() => activeWorkspace),
    };
    getActiveWorkspaceIndex = vi.fn(() => 0);
    getTabList = vi.fn(() => []);
    getTabNext = vi.fn(() => null);

    Object.assign(global.display, {
      get_workspace_manager: vi.fn(() => workspaceManager),
      get_tab_list: getTabList,
      get_tab_next: getTabNext,
      get_current_time: vi.fn(() => 2468),
    });
    Object.assign(global.workspace_manager, {
      get_active_workspace_index: getActiveWorkspaceIndex,
    });
  });

  describe("portable command boundary", () => {
    const portableActions = [
      { name: "Focus", direction: "Left" },
      { name: "Move", direction: "Right" },
      { name: "Swap", direction: "Top" },
      { name: "Split", orientation: "horizontal" },
      { name: "FloatToggle" },
      { name: "FloatNonPersistentToggle" },
      { name: "LayoutToggle" },
      { name: "LayoutStackedToggle" },
      { name: "LayoutTabbedToggle" },
    ] as const;

    it.each(portableActions)("returns false for $name", (action) => {
      expect(commands.handle(action)).toBe(false);
      expect(host.observe).not.toHaveBeenCalled();
    });

    it("returns false for an unrecognized command", () => {
      const action = { name: "NonExistentAction" } as unknown as AnvilAction;

      expect(commands.handle(action)).toBe(false);
      expect(host.observe).not.toHaveBeenCalled();
    });
  });

  describe("setting commands", () => {
    it.each([
      [true, false],
      [false, true],
    ])("toggles focus border from %s to %s", (current, expected) => {
      host.settings.set_boolean("focus-border-toggle", current);

      expect(commands.handle({ name: "FocusBorderToggle" })).toBe(true);

      expect(host.settings.get_boolean("focus-border-toggle")).toBe(expected);
      expect(host.observe).not.toHaveBeenCalled();
    });

    it.each([
      [7, 4, 8],
      [1, -4, 0],
      [2, 3, 5],
    ])("clamps gap increment %i plus %i to %i", (current, amount, expected) => {
      host.settings.set_uint("window-gap-size-increment", current);

      expect(commands.handle({ name: "GapSize", amount })).toBe(true);

      expect(host.settings.get_uint("window-gap-size-increment")).toBe(expected);
      expect(host.observe).toHaveBeenCalledExactlyOnceWith("gap-policy", expect.any(Function));
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });

    it.each([
      [true, false],
      [false, true],
    ])("toggles tiling mode from %s to %s", (current, expected) => {
      host.settings.set_boolean("tiling-mode-enabled", current);

      expect(commands.handle({ name: "TilingModeToggle" })).toBe(true);

      expect(host.settings.get_boolean("tiling-mode-enabled")).toBe(expected);
      expect(host.observe).toHaveBeenCalledExactlyOnceWith("tiling-policy", expect.any(Function));
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });

    it("adds the active workspace to the skip list", () => {
      getActiveWorkspaceIndex.mockReturnValue(2);
      host.settings.set_string("workspace-skip-tile", "0,1");

      expect(commands.handle({ name: "WorkspaceActiveTileToggle" })).toBe(true);

      expect(host.settings.get_string("workspace-skip-tile")).toBe("0,1,2");
      expect(host.observe).toHaveBeenCalledExactlyOnceWith(
        "workspace-policy",
        expect.any(Function)
      );
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });

    it("removes every active-workspace entry from the skip list", () => {
      getActiveWorkspaceIndex.mockReturnValue(1);
      host.settings.set_string("workspace-skip-tile", "0,1,1,2");

      expect(commands.handle({ name: "WorkspaceActiveTileToggle" })).toBe(true);

      expect(host.settings.get_string("workspace-skip-tile")).toBe("0,2");
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });
  });

  it("cancels the active operation through the portable owner", () => {
    expect(commands.handle({ name: "CancelOperation" })).toBe(true);

    expect(host.observe).toHaveBeenCalledExactlyOnceWith("cancel-operation", expect.any(Function));
    expect(shadow.cancelOperation).toHaveBeenCalledOnce();
  });

  describe("preferences", () => {
    it("activates and centers an existing preferences window", () => {
      const existing = createMockWindow({
        title: host.prefsTitle,
        wm_class: PREFERENCES_WINDOW_CLASS,
        workspace: activeWorkspace,
      });
      getTabList.mockReturnValue([existing]);

      expect(commands.handle({ name: "PrefsOpen" })).toBe(true);

      expect(activeWorkspace.activate_with_focus).toHaveBeenCalledExactlyOnceWith(existing, 2468);
      expect(host.moveCenter).toHaveBeenCalledExactlyOnceWith(existing);
      expect(host.openPreferences).not.toHaveBeenCalled();
    });

    it("opens preferences when no existing window matches", () => {
      getTabList.mockReturnValue([]);

      expect(commands.handle({ name: "PrefsOpen" })).toBe(true);

      expect(host.openPreferences).toHaveBeenCalledOnce();
      expect(activeWorkspace.activate_with_focus).not.toHaveBeenCalled();
      expect(host.moveCenter).not.toHaveBeenCalled();
    });
  });

  describe("window close", () => {
    it("deletes the focused window with the display timestamp", () => {
      const metaWindow = createMockWindow();
      const deleteWindow = vi.spyOn(metaWindow, "delete");
      setFocusedWindow(metaWindow);

      expect(commands.handle({ name: "WindowClose" })).toBe(true);

      expect(deleteWindow).toHaveBeenCalledExactlyOnceWith(2468);
    });

    it("is handled without a focused window", () => {
      expect(commands.handle({ name: "WindowClose" })).toBe(true);
      expect(host.observe).not.toHaveBeenCalled();
    });
  });

  describe("swap last active", () => {
    it("swaps the focused window with the next tab target", () => {
      const focused = createMockWindow({ id: 1 });
      const target = createMockWindow({ id: 2 });
      setFocusedWindow(focused);
      getTabNext.mockReturnValue(target);

      expect(commands.handle({ name: "WindowSwapLastActive" })).toBe(true);

      expect(getTabNext).toHaveBeenCalledExactlyOnceWith(
        Meta.TabList.NORMAL,
        activeWorkspace,
        focused,
        false
      );
      expect(host.observe).toHaveBeenCalledExactlyOnceWith(
        "swap-last-active",
        expect.any(Function)
      );
      expect(shadow.observeWindowSwap).toHaveBeenCalledExactlyOnceWith(focused, target);
    });

    it("does not publish a swap when there is no target", () => {
      setFocusedWindow(createMockWindow());
      getTabNext.mockReturnValue(null);

      expect(commands.handle({ name: "WindowSwapLastActive" })).toBe(true);

      expect(getTabNext).toHaveBeenCalledOnce();
      expect(host.observe).not.toHaveBeenCalled();
      expect(shadow.observeWindowSwap).not.toHaveBeenCalled();
    });

    it("does not query for a target when there is no focused window", () => {
      expect(commands.handle({ name: "WindowSwapLastActive" })).toBe(true);

      expect(getTabNext).not.toHaveBeenCalled();
      expect(host.observe).not.toHaveBeenCalled();
    });
  });

  describe("keyboard resize", () => {
    it.each([
      ["Right", Meta.GrabOp.KEYBOARD_RESIZING_E],
      ["Left", Meta.GrabOp.KEYBOARD_RESIZING_W],
      ["Top", Meta.GrabOp.KEYBOARD_RESIZING_N],
      ["Bottom", Meta.GrabOp.KEYBOARD_RESIZING_S],
    ] as const)("maps %s to grab operation %i", (direction, grabOp) => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);

      expect(commands.handle({ name: "WindowResize", direction, amount: 12 })).toBe(true);

      expect(host.observe).toHaveBeenCalledExactlyOnceWith("keyboard-resize", expect.any(Function));
      expect(shadow.observeKeyboardResize).toHaveBeenCalledExactlyOnceWith(metaWindow, grabOp, 12);
    });

    it("is handled without publishing a resize when no window is focused", () => {
      expect(commands.handle({ name: "WindowResize", direction: "Right", amount: 12 })).toBe(true);

      expect(host.observe).not.toHaveBeenCalled();
      expect(shadow.observeKeyboardResize).not.toHaveBeenCalled();
    });
  });

  describe("snap layout move", () => {
    it("adds a float override, publishes policy, and moves to a valid layout", () => {
      const metaWindow = createMockWindow({
        rect: { x: 100, y: 200, width: 400, height: 300 },
      });
      setFocusedWindow(metaWindow);

      expect(commands.handle({ name: "SnapLayoutMove", direction: "Left", amount: 0.5 })).toBe(
        true
      );

      expect(host.addFloatOverride).toHaveBeenCalledExactlyOnceWith(metaWindow);
      expect(host.observe).toHaveBeenCalledExactlyOnceWith("snap-policy", expect.any(Function));
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
      expect(host.move).toHaveBeenCalledExactlyOnceWith(metaWindow, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
    });

    it("applies the configured gap on all sides", () => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);
      host.settings.set_uint("window-gap-size", 5);
      host.settings.set_uint("window-gap-size-increment", 2);

      commands.handle({ name: "SnapLayoutMove", direction: "Right", amount: 0.25 });

      expect(host.move).toHaveBeenCalledExactlyOnceWith(metaWindow, {
        x: 1450,
        y: 10,
        width: 460,
        height: 1060,
      });
    });

    it("does not shrink a snap rect below an oversized gap", () => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);
      host.settings.set_uint("window-gap-size", 600);
      host.settings.set_uint("window-gap-size-increment", 1);

      commands.handle({ name: "SnapLayoutMove", direction: "Left", amount: 0.5 });

      expect(host.move).toHaveBeenCalledExactlyOnceWith(metaWindow, {
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
      });
    });

    it("centers a window without applying the configured gap", () => {
      const metaWindow = createMockWindow({
        rect: { x: 20, y: 30, width: 400, height: 300 },
      });
      setFocusedWindow(metaWindow);
      host.settings.set_uint("window-gap-size", 10);
      host.settings.set_uint("window-gap-size-increment", 8);

      commands.handle({ name: "SnapLayoutMove", direction: "Center" });

      expect(host.move).toHaveBeenCalledExactlyOnceWith(metaWindow, {
        x: 760,
        y: 390,
        width: 400,
        height: 300,
      });
    });

    it("does not add a duplicate float override for an exempt window", () => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);
      vi.mocked(host.isFloatingExempt).mockReturnValue(true);

      commands.handle({ name: "SnapLayoutMove", direction: "Left", amount: 0.5 });

      expect(host.addFloatOverride).not.toHaveBeenCalled();
      expect(host.observe).toHaveBeenCalledExactlyOnceWith("snap-policy", expect.any(Function));
      expect(host.move).toHaveBeenCalledOnce();
    });

    it("does nothing for an invalid snap direction", () => {
      setFocusedWindow(createMockWindow());

      expect(commands.handle({ name: "SnapLayoutMove", direction: "Up", amount: 0.5 })).toBe(true);

      expect(host.addFloatOverride).not.toHaveBeenCalled();
      expect(host.observe).not.toHaveBeenCalled();
      expect(host.move).not.toHaveBeenCalled();
    });

    it("does nothing when no window is focused", () => {
      expect(commands.handle({ name: "SnapLayoutMove", direction: "Left", amount: 0.5 })).toBe(
        true
      );

      expect(host.isFloatingExempt).not.toHaveBeenCalled();
      expect(host.addFloatOverride).not.toHaveBeenCalled();
      expect(host.observe).not.toHaveBeenCalled();
      expect(host.move).not.toHaveBeenCalled();
    });
  });

  describe("tab decoration", () => {
    it.each([
      [true, false],
      [false, true],
    ])("toggles decoration from %s to %s when tabbed mode is enabled", (current, expected) => {
      host.settings.set_boolean("tabbed-tiling-mode-enabled", true);
      host.settings.set_boolean("showtab-decoration-enabled", current);

      expect(commands.handle({ name: "ShowTabDecorationToggle" })).toBe(true);

      expect(host.settings.get_boolean("showtab-decoration-enabled")).toBe(expected);
      expect(host.observe).toHaveBeenCalledExactlyOnceWith(
        "tab-decoration-policy",
        expect.any(Function)
      );
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });

    it("does not change decoration or policy when tabbed mode is disabled", () => {
      host.settings.set_boolean("tabbed-tiling-mode-enabled", false);
      host.settings.set_boolean("showtab-decoration-enabled", true);

      expect(commands.handle({ name: "ShowTabDecorationToggle" })).toBe(true);

      expect(host.settings.get_boolean("showtab-decoration-enabled")).toBe(true);
      expect(host.observe).not.toHaveBeenCalled();
      expect(shadow.observePolicy).not.toHaveBeenCalled();
    });
  });

  describe("class float override", () => {
    it("is handled without a focused window", () => {
      expect(commands.handle({ name: "FloatClassToggle" })).toBe(true);

      expect(host.isFloatingExempt).not.toHaveBeenCalled();
      expect(host.addFloatOverride).not.toHaveBeenCalled();
      expect(host.removeFloatOverride).not.toHaveBeenCalled();
      expect(host.observe).not.toHaveBeenCalled();
    });

    it("adds a class override for a tiled window", () => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);

      expect(commands.handle({ name: "FloatClassToggle" })).toBe(true);

      expect(host.addFloatOverride).toHaveBeenCalledExactlyOnceWith(metaWindow);
      expect(host.removeFloatOverride).not.toHaveBeenCalled();
      expect(host.observe).toHaveBeenCalledExactlyOnceWith(
        "float-class-policy",
        expect.any(Function)
      );
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });

    it("removes a class override for an exempt window", () => {
      const metaWindow = createMockWindow();
      setFocusedWindow(metaWindow);
      vi.mocked(host.isFloatingExempt).mockReturnValue(true);

      expect(commands.handle({ name: "FloatClassToggle" })).toBe(true);

      expect(host.removeFloatOverride).toHaveBeenCalledExactlyOnceWith(metaWindow);
      expect(host.addFloatOverride).not.toHaveBeenCalled();
      expect(shadow.observePolicy).toHaveBeenCalledOnce();
    });
  });
});

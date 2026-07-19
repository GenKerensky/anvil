import { beforeEach, describe, expect, it, vi } from "vitest";
import Gio from "gi://Gio";

import type { WindowOverride } from "../../../src/lib/shared/settings.js";
import {
  formatWindowPickerResult,
  parseWindowPickerRequest,
  WINDOW_PICKER_REQUEST_KEY,
  WINDOW_PICKER_RESULT_KEY,
} from "../../../src/lib/shared/window-picker-protocol.js";

const configState = vi.hoisted(() => ({
  props: { overrides: [] as WindowOverride[] },
  writes: [] as WindowOverride[][],
}));

vi.mock("../../../src/lib/shared/settings.js", () => ({
  ConfigManager: class {
    get windowProps() {
      return configState.props;
    }

    set windowProps(value: { overrides: WindowOverride[] }) {
      configState.props = { overrides: value.overrides };
      configState.writes.push(value.overrides);
    }

    loadDefaultWindowConfigContents() {
      return { overrides: [] };
    }
  },
}));

import { FloatingPage } from "../../../src/lib/prefs/floating.js";

describe("FloatingPage window picker", () => {
  let settings: Gio.Settings;
  let page: FloatingPage;

  beforeEach(() => {
    configState.props = { overrides: [] };
    configState.writes = [];
    settings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.anvil" } as any);
    page = new FloatingPage({ settings, dir: {} as Gio.File });
  });

  function startPicker(): string {
    const button = (page as any).addWindowButton;
    button.emit("clicked");
    expect(button.icon_name).toBe("selection-mode-symbolic");
    expect(button.label).toBeUndefined();
    const request = parseWindowPickerRequest(settings.get_string(WINDOW_PICKER_REQUEST_KEY));
    expect(request?.action).toBe("pick");
    if (!request) throw new Error("Expected a valid picker request");
    return request.id;
  }

  function sendResult(result: Parameters<typeof formatWindowPickerResult>[0]): void {
    settings.set_string(WINDOW_PICKER_RESULT_KEY, formatWindowPickerResult(result));
    (settings as any).emit(`changed::${WINDOW_PICKER_RESULT_KEY}`);
  }

  it("turns the add button into selection state and persists the selected class", () => {
    const requestId = startPicker();

    sendResult({
      version: 1,
      id: requestId,
      status: "selected",
      wmClass: "org.example.App",
      wmTitle: "Example Document",
    });

    expect((page as any).addWindowButton.icon_name).toBe("list-add-symbolic");
    expect(configState.props.overrides).toEqual([{ wmClass: "org.example.App", mode: "float" }]);
    expect(settings.get_uint("window-overrides-reload-trigger")).toBe(1);
    expect((page as any).rows).toHaveLength(1);
    expect((page as any).rows[0].title).toBe("org.example.App");
  });

  it("does not add a duplicate class-wide floating rule", () => {
    configState.props = {
      overrides: [{ wmClass: "org.example.App", mode: "float" }],
    };
    page.run_dispose();
    page = new FloatingPage({ settings, dir: {} as Gio.File });
    const requestId = startPicker();

    sendResult({
      version: 1,
      id: requestId,
      status: "selected",
      wmClass: "ORG.EXAMPLE.APP",
    });

    expect(configState.writes).toEqual([]);
    expect((page as any).rows).toHaveLength(1);
  });

  it("replaces a conflicting class-wide tile rule so the picked exception takes effect", () => {
    const unrelatedTitleRule: WindowOverride = {
      wmClass: "org.example.App",
      wmTitle: "Keep tiled",
      mode: "tile",
    };
    configState.props = {
      overrides: [{ wmClass: "org.example.App", mode: "tile" }, unrelatedTitleRule],
    };
    page.run_dispose();
    page = new FloatingPage({ settings, dir: {} as Gio.File });
    const requestId = startPicker();

    sendResult({
      version: 1,
      id: requestId,
      status: "selected",
      wmClass: "org.example.App",
    });

    expect(configState.props.overrides).toEqual([
      unrelatedTitleRule,
      { wmClass: "org.example.App", mode: "float" },
    ]);
  });

  it("returns to idle on cancellation and lets an unserved request be cancelled from the button", () => {
    const requestId = startPicker();
    sendResult({ version: 1, id: requestId, status: "cancelled" });
    expect((page as any).addWindowButton.icon_name).toBe("list-add-symbolic");
    expect(configState.writes).toEqual([]);

    const unservedRequestId = startPicker();
    (page as any).addWindowButton.emit("clicked");
    expect(parseWindowPickerRequest(settings.get_string(WINDOW_PICKER_REQUEST_KEY))).toEqual({
      version: 1,
      id: unservedRequestId,
      action: "cancel",
    });
    expect((page as any).addWindowButton.icon_name).toBe("list-add-symbolic");
  });

  it("cancels an active picker and disconnects the result signal when disposed", () => {
    const requestId = startPicker();

    page.run_dispose();

    expect(parseWindowPickerRequest(settings.get_string(WINDOW_PICKER_REQUEST_KEY))).toEqual({
      version: 1,
      id: requestId,
      action: "cancel",
    });
    expect((settings as any).hasHandlers(`changed::${WINDOW_PICKER_RESULT_KEY}`)).toBe(false);
  });

  it("removes only the selected override and always advances the reload trigger", () => {
    const selected: WindowOverride = { wmClass: "App", mode: "float" };
    const titleRule: WindowOverride = { wmClass: "App", wmTitle: "Dialog", mode: "float" };
    const tileRule: WindowOverride = { wmClass: "App", mode: "tile" };
    configState.props = { overrides: [selected, titleRule, tileRule] };
    page.run_dispose();
    page = new FloatingPage({ settings, dir: {} as Gio.File });

    (page as any).onRemoveHandler(selected, (page as any).rows[0]);
    expect(configState.props.overrides).toEqual([titleRule, tileRule]);
    expect(settings.get_uint("window-overrides-reload-trigger")).toBe(1);

    (page as any).saveOverrides([titleRule, tileRule]);
    expect(settings.get_uint("window-overrides-reload-trigger")).toBe(2);
  });
});

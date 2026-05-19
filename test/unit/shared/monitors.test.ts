import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";

import { MonitorsPage } from "../../../src/lib/prefs/monitors.js";

function createSettings(initialValues: Record<string, unknown> = {}) {
  const settings = new Gio.Settings("org.gnome.shell.extensions.anvil" as any);
  for (const [key, value] of Object.entries(initialValues)) {
    settings.set_value(key, value as any);
  }
  return settings;
}

describe("MonitorsPage", () => {
  let settings: Gio.Settings;

  beforeEach(() => {
    (Gdk as any)._resetDisplay();
  });

  describe("constructor", () => {
    it("creates page with title and icon", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      expect(page.title).toBe("Monitors");
      expect(page.icon_name).toBe("video-display-symbolic");
    });

    it("creates drawing area and control widgets", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });

      expect((page as any)._drawingArea).toBeDefined();
      expect((page as any)._monitorGroup).toBeDefined();
      expect((page as any)._enableSwitch).toBeDefined();
      expect((page as any)._maxWidthSpin).toBeDefined();
      expect((page as any)._maxHeightSpin).toBeDefined();
      expect((page as any)._exemptSwitch).toBeDefined();
    });

    it("queries monitors from Gdk display", () => {
      settings = createSettings();
      const display = Gdk.Display.get_default() as any;
      display._addMonitor({
        connector: "DP-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      });
      display._addMonitor({
        connector: "HDMI-1",
        geometry: { x: 1920, y: 0, width: 2560, height: 1440 },
      });

      const page = new MonitorsPage({ settings });
      expect((page as any)._monitors).toHaveLength(2);
      expect((page as any)._monitors[0].connector).toBe("DP-1");
      expect((page as any)._monitors[1].connector).toBe("HDMI-1");
    });

    it("connects settings changed handler", () => {
      settings = createSettings();
      const connectSpy = vi.spyOn(settings, "connect");
      new MonitorsPage({ settings });
      expect(connectSpy).toHaveBeenCalledWith("changed::monitor-constraints", expect.any(Function));
    });
  });

  describe("_readConstraints / _writeConstraints", () => {
    it("round-trips constraint data through settings", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const constraints: Array<[string, number, number, boolean, boolean]> = [
        ["DP-1", 1920, 1080, true, false],
        ["HDMI-1", 2560, 1440, true, true],
      ];

      (page as any)._writeConstraints(constraints);
      const readBack = (page as any)._readConstraints();

      expect(readBack).toEqual(constraints);
    });

    it("returns empty array when no constraints stored", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const constraints = (page as any)._readConstraints();
      expect(constraints).toEqual([]);
    });
  });

  describe("_getConstraint", () => {
    it("finds existing constraint by connector", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._writeConstraints([["DP-1", 1920, 1080, true, false]]);

      const result = (page as any)._getConstraint("DP-1");
      expect(result).toEqual(["DP-1", 1920, 1080, true, false]);
    });

    it("returns undefined for missing connector", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._writeConstraints([["DP-1", 1920, 1080, true, false]]);

      const result = (page as any)._getConstraint("HDMI-1");
      expect(result).toBeUndefined();
    });

    it("returns undefined when no constraints exist", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const result = (page as any)._getConstraint("DP-1");
      expect(result).toBeUndefined();
    });
  });

  describe("_setConstraintField", () => {
    it("updates existing constraint field", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._writeConstraints([["DP-1", 1920, 1080, true, false]]);

      (page as any)._setConstraintField("DP-1", 1, 2560);
      const result = (page as any)._getConstraint("DP-1");
      expect(result?.[1]).toBe(2560);
      expect(result?.[2]).toBe(1080);
      expect(result?.[3]).toBe(true);
    });

    it("creates new entry with defaults when connector not found", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });

      (page as any)._setConstraintField("DP-1", 1, 1920);
      const result = (page as any)._getConstraint("DP-1");
      expect(result).toEqual(["DP-1", 1920, 0, true, false]);
    });

    it("creates new entry with enable=true as default", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });

      (page as any)._setConstraintField("DP-1", 3, false);
      const result = (page as any)._getConstraint("DP-1");
      expect(result).toEqual(["DP-1", 0, 0, false, false]);
    });

    it("preserves other existing constraints when adding a new one", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._writeConstraints([["DP-1", 1920, 1080, true, false]]);

      (page as any)._setConstraintField("HDMI-1", 1, 2560);
      const all = (page as any)._readConstraints();
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(["DP-1", 1920, 1080, true, false]);
      expect(all[1]).toEqual(["HDMI-1", 2560, 0, true, false]);
    });

    it("writes to gsettings on every call", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const setValueSpy = vi.spyOn(settings, "set_value");

      (page as any)._setConstraintField("DP-1", 1, 1920);
      expect(setValueSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("_refreshControls", () => {
    it("sets controls from existing constraint", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._writeConstraints([["DP-1", 3440, 1440, true, true]]);

      (page as any)._refreshControls();
      expect((page as any)._enableSwitch.active).toBe(true);
      expect((page as any)._maxWidthSpin.value).toBe(3440);
      expect((page as any)._maxHeightSpin.value).toBe(1440);
      expect((page as any)._exemptSwitch.active).toBe(true);
    });

    it("defaults enableSwitch to false when no constraint exists (BUG FIX)", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";

      (page as any)._refreshControls();
      expect((page as any)._enableSwitch.active).toBe(false);
    });

    it("defaults spin buttons to 0 and exempt to false when no constraint", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";

      (page as any)._refreshControls();
      expect((page as any)._maxWidthSpin.value).toBe(0);
      expect((page as any)._maxHeightSpin.value).toBe(0);
      expect((page as any)._exemptSwitch.active).toBe(false);
    });

    it("sets _updating = true before controls and false after", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = false;

      let observedDuring = false;
      const orig = (page as any)._enableSwitch;
      vi.spyOn(orig, "active", "set").mockImplementation(function (this: any, v: boolean) {
        observedDuring = (page as any)._updating;
      });

      (page as any)._refreshControls();
      expect(observedDuring).toBe(true);
      expect((page as any)._updating).toBe(false);
    });

    it("handles null boundConnector", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });

      (page as any)._refreshControls();
      expect((page as any)._updating).toBe(false);
    });

    it("reads maxWidth / maxHeight correctly for disabled constraint", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._writeConstraints([["DP-1", 1920, 1080, false, false]]);

      (page as any)._refreshControls();
      expect((page as any)._enableSwitch.active).toBe(false);
      expect((page as any)._maxWidthSpin.value).toBe(1920);
      expect((page as any)._maxHeightSpin.value).toBe(1080);
    });
  });

  describe("_selectMonitor", () => {
    it("updates selectedConnector and boundConnector", () => {
      settings = createSettings();
      const display = Gdk.Display.get_default() as any;
      display._addMonitor({
        connector: "DP-1",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      });

      const page = new MonitorsPage({ settings });
      expect((page as any)._selectedConnector).toBeNull();
      expect((page as any)._boundConnector).toBeNull();

      (page as any)._selectMonitor("DP-1");
      expect((page as any)._selectedConnector).toBe("DP-1");
      expect((page as any)._boundConnector).toBe("DP-1");
    });

    it("updates monitor group title", () => {
      settings = createSettings();
      const display = Gdk.Display.get_default() as any;
      display._addMonitor({
        connector: "DP-1",
        description: "My Monitor",
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      });

      const page = new MonitorsPage({ settings });
      (page as any)._selectMonitor("DP-1");
      expect((page as any)._monitorGroup.title).toContain("My Monitor");
    });

    it("refreshes controls on selection", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const refreshSpy = vi.spyOn(page as any, "_refreshControls");

      (page as any)._selectMonitor("DP-1");
      expect(refreshSpy).toHaveBeenCalled();
    });

    it("queues drawing area redraw", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const drawSpy = vi.spyOn((page as any)._drawingArea, "queue_draw");

      (page as any)._selectMonitor("DP-1");
      expect(drawSpy).toHaveBeenCalled();
    });
  });

  describe("signal handlers", () => {
    it("enableSwitch notify::active calls _setConstraintField", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = false;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      // Switch starts at false; toggle to true to trigger notify::active
      (page as any)._enableSwitch.active = true;

      expect(setFieldSpy).toHaveBeenCalledWith("DP-1", 3, true);
    });

    it("enableSwitch notify::active skips when _updating is true", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = true;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      // Switch starts at false; even though value changes, _updating blocks the handler
      (page as any)._enableSwitch.active = true;

      expect(setFieldSpy).not.toHaveBeenCalled();
    });

    it("enableSwitch notify::active skips when _boundConnector is null", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = null;
      (page as any)._updating = false;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      (page as any)._enableSwitch.active = true;

      expect(setFieldSpy).not.toHaveBeenCalled();
    });

    it("maxWidthSpin value-changed calls _setConstraintField", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = false;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      (page as any)._maxWidthSpin.value = 3840;

      expect(setFieldSpy).toHaveBeenCalledWith("DP-1", 1, 3840);
    });

    it("maxWidthSpin value-changed skips when _updating", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = true;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      (page as any)._maxWidthSpin.value = 3840;

      expect(setFieldSpy).not.toHaveBeenCalled();
    });

    it("maxHeightSpin value-changed calls _setConstraintField", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = false;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      (page as any)._maxHeightSpin.value = 2160;

      expect(setFieldSpy).toHaveBeenCalledWith("DP-1", 2, 2160);
    });

    it("exemptSwitch notify::active calls _setConstraintField", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      (page as any)._boundConnector = "DP-1";
      (page as any)._updating = false;
      const setFieldSpy = vi.spyOn(page as any, "_setConstraintField");

      (page as any)._exemptSwitch.active = true;

      expect(setFieldSpy).toHaveBeenCalledWith("DP-1", 4, true);
    });

    it("settings changed::monitor-constraints refreshes controls and redraws", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });
      const refreshSpy = vi.spyOn(page as any, "_refreshControls");
      const drawSpy = vi.spyOn((page as any)._drawingArea, "queue_draw");

      settings.emit("changed::monitor-constraints");

      expect(refreshSpy).toHaveBeenCalled();
      expect(drawSpy).toHaveBeenCalled();
    });
  });

  describe("setValue with GLib.Variant", () => {
    it("_writeConstraints round-trips correctly using Gio.set_value", () => {
      settings = createSettings();
      const page = new MonitorsPage({ settings });

      // Create a Variant (as the real code does) and store it
      const constraints: Array<[string, number, number, boolean, boolean]> = [
        ["DP-1", 3440, 1440, true, false],
      ];
      const variant = new GLib.Variant("a(suubb)", constraints);
      settings.set_value("monitor-constraints", variant);

      // Read back (should call deep_unpack automatically)
      const readBack = (page as any)._readConstraints();
      expect(readBack).toEqual(constraints);
    });
  });
});

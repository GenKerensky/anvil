/*
 * RulesEngine pure unit tests — title grammar and evaluation order.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import {
  RulesEngine,
  windowTitleMatchesOverride,
  classMatches,
} from "../../../src/lib/extension/rules-engine.js";
import { createMockWindow } from "../mocks/helpers/index.js";

describe("classMatches", () => {
  it("matches exact (case-insensitive)", () => {
    expect(classMatches("Firefox", "firefox")).toBe(true);
    expect(classMatches("Firefox", "Fire")).toBe(false);
  });

  it("matches contains with ~ prefix", () => {
    expect(classMatches("org.gnome.Nautilus", "~nautilus")).toBe(true);
    expect(classMatches("Firefox", "~chrome")).toBe(false);
  });

  it("matches simple globs", () => {
    expect(classMatches("steamwebhelper", "steam*")).toBe(true);
    expect(classMatches("steam", "steam*")).toBe(true);
    expect(classMatches("other", "steam*")).toBe(false);
  });

  it("matches re: regex", () => {
    expect(classMatches("FooBar", "re:^foo")).toBe(true);
    expect(classMatches("BarFoo", "re:^foo")).toBe(false);
  });
});

describe("windowTitleMatchesOverride", () => {
  it("matches substring (case-insensitive)", () => {
    expect(windowTitleMatchesOverride("Hello World", "world")).toBe(true);
    expect(windowTitleMatchesOverride("Hello", "xyz")).toBe(false);
  });

  it("matches exact with = prefix", () => {
    expect(windowTitleMatchesOverride("Open", "=Open")).toBe(true);
    expect(windowTitleMatchesOverride("Open File", "=Open")).toBe(false);
  });

  it("matches negation with ! prefix", () => {
    expect(windowTitleMatchesOverride("Document", "!root")).toBe(true);
    expect(windowTitleMatchesOverride("root shell", "!root")).toBe(false);
  });

  it("matches comma-separated patterns (any wins)", () => {
    expect(windowTitleMatchesOverride("Preferences", "Settings,Preferences")).toBe(true);
    expect(windowTitleMatchesOverride("About", "Settings,Preferences")).toBe(false);
  });

  it("handles single-space special case", () => {
    expect(windowTitleMatchesOverride(" ", " ")).toBe(true);
    expect(windowTitleMatchesOverride("", " ")).toBe(false);
    expect(windowTitleMatchesOverride("x", " ")).toBe(false);
  });

  it("returns false for empty window title (except space special case)", () => {
    expect(windowTitleMatchesOverride(null, "foo")).toBe(false);
    expect(windowTitleMatchesOverride("", "foo")).toBe(false);
  });
});

describe("RulesEngine", () => {
  let engine: RulesEngine;

  beforeEach(() => {
    engine = new RulesEngine({ overrides: [] });
  });

  describe("match order", () => {
    it("null window is float exempt", () => {
      const m = engine.match(null);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("null-window");
    });

    it("TILE override beats built-in PIP float", () => {
      engine.windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Picture-in-Picture", mode: "tile" },
      ];
      const win = createMockWindow({
        wm_class: "Firefox",
        title: "Picture-in-Picture",
      });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(false);
      expect(m.source).toBe("tile-override");
    });

    it("PIP title floats with builtin-pip source", () => {
      const win = createMockWindow({
        wm_class: "Firefox",
        title: "Picture-in-Picture",
      });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("builtin-pip");
    });

    it("Blender class floats with builtin-blender source", () => {
      const win = createMockWindow({ wm_class: "Blender", title: "Scene" });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("builtin-blender");
    });

    it("Steam class floats with builtin-steam source", () => {
      const win = createMockWindow({ wm_class: "steam", title: "Steam" });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("builtin-steam");
    });

    it("dialog type uses type-heuristic", () => {
      const win = createMockWindow({
        wm_class: "App",
        title: "Dialog",
        window_type: Meta.WindowType.DIALOG,
      });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("type-heuristic");
    });

    it("float JSON override matches with float-override source", () => {
      engine.windowProps.overrides = [{ wmClass: "Calculator", mode: "float" }];
      const win = createMockWindow({
        wm_class: "Calculator",
        title: "Calc",
        allows_resize: true,
      });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(true);
      expect(m.source).toBe("float-override");
    });

    it("normal resizable window defaults to tile", () => {
      const win = createMockWindow({
        wm_class: "NormalApp",
        title: "Doc",
        allows_resize: true,
      });
      const m = engine.match(win);
      expect(m.floatExempt).toBe(false);
      expect(m.source).toBe("default-tile");
    });
  });

  describe("isFloatingExempt", () => {
    it("matches match().floatExempt", () => {
      const win = createMockWindow({
        wm_class: "NormalApp",
        title: "Doc",
        allows_resize: true,
      });
      expect(engine.isFloatingExempt(win)).toBe(engine.match(win).floatExempt);
    });
  });

  describe("override CRUD", () => {
    it("addFloatOverride appends and is idempotent without wmId", () => {
      const configMgr = { windowProps: { overrides: [] as any[] } };
      const win = createMockWindow({ wm_class: "App", id: 42 });
      engine.addFloatOverride(win, false, configMgr as any);
      engine.addFloatOverride(win, false, configMgr as any);
      expect(configMgr.windowProps.overrides).toHaveLength(1);
      expect(configMgr.windowProps.overrides[0]).toMatchObject({
        wmClass: "App",
        mode: "float",
      });
      expect(configMgr.windowProps.overrides[0].wmId).toBeUndefined();
    });

    it("addFloatOverride with wmId stores id", () => {
      const configMgr = { windowProps: { overrides: [] as any[] } };
      const win = createMockWindow({ wm_class: "App", id: 99 });
      engine.addFloatOverride(win, true, configMgr as any);
      expect(configMgr.windowProps.overrides[0].wmId).toBe("99");
    });

    it("does not cache or persist an override before wm_class is available", () => {
      const storedProps = { overrides: [{ wmClass: "Existing", mode: "float" as const }] };
      const write = vi.fn();
      const configMgr = {
        get windowProps() {
          return storedProps;
        },
        set windowProps(value) {
          write(value);
        },
      };
      const engineProps = engine.windowProps;
      const win = createMockWindow({ wm_class: null, id: 99 });

      engine.addFloatOverride(win, true, configMgr as any);

      expect(storedProps.overrides).toEqual([{ wmClass: "Existing", mode: "float" }]);
      expect(write).not.toHaveBeenCalled();
      expect(engine.windowProps).toBe(engineProps);
      expect(engine.windowProps.overrides).toEqual([]);
    });

    it("removeFloatOverride drops matching class rule", () => {
      const configMgr = {
        windowProps: {
          overrides: [
            { wmClass: "App", mode: "float" },
            { wmClass: "Other", mode: "float" },
          ],
        },
      };
      const win = createMockWindow({ wm_class: "App", id: 1 });
      engine.removeFloatOverride(win, false, configMgr as any);
      expect(configMgr.windowProps.overrides).toEqual([{ wmClass: "Other", mode: "float" }]);
    });

    it("reloadFromConfig strips wmId rules and shares object", () => {
      const props = {
        overrides: [
          { wmClass: "A", mode: "float" },
          { wmClass: "B", wmId: "1", mode: "float" },
        ],
      };
      const configMgr = { windowProps: props };
      engine.reloadFromConfig(configMgr as any);
      expect(engine.windowProps).toBe(props);
      expect(engine.windowProps.overrides).toHaveLength(1);
      expect(engine.windowProps.overrides[0].wmClass).toBe("A");
    });
  });
});

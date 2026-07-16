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

    it("modal dialogs, transient windows, and non-resizable windows use type heuristics", () => {
      const parent = createMockWindow({ id: 1 });
      const windows = [
        createMockWindow({
          wm_class: "App",
          title: "Modal",
          window_type: Meta.WindowType.MODAL_DIALOG,
        }),
        createMockWindow({
          wm_class: "App",
          title: "Transient",
          transient_for: parent,
        }),
        createMockWindow({
          wm_class: "App",
          title: "Fixed",
          allows_resize: false,
        }),
      ];

      for (const win of windows) {
        expect(engine.match(win)).toEqual({ floatExempt: true, source: "type-heuristic" });
      }
    });

    it.each([
      { wm_class: null, title: "Late class" },
      { wm_class: "App", title: null },
      { wm_class: "App", title: "" },
    ])("does not float a normal window solely for late identity fields: %o", (identity) => {
      const win = createMockWindow({
        ...identity,
        window_type: Meta.WindowType.NORMAL,
        allows_resize: true,
      });

      expect(engine.match(win)).toEqual({ floatExempt: false, source: "default-tile" });
    });

    it("classifies ephemeral helper windows before built-in and user float rules", () => {
      engine.windowProps.overrides = [{ wmClass: "wl-clipboard", mode: "float" }];
      const win = createMockWindow({
        wm_class: "wl-clipboard",
        title: "wl-clipboard",
        rect: { x: 0, y: 0, width: 1, height: 1 },
      });

      expect(engine.match(win)).toEqual({ floatExempt: true, source: "ephemeral" });
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

    it.each([
      { wm_class: "bLeNdEr-bin", source: "builtin-blender" },
      { wm_class: "STEAM-overlay", source: "builtin-steam" },
      { wm_class: "SteamWebHelper", source: "builtin-steam" },
    ] as const)("matches built-in class variants: $wm_class", ({ wm_class, source }) => {
      const win = createMockWindow({ wm_class, title: "Tool", allows_resize: true });

      expect(engine.match(win)).toEqual({ floatExempt: true, source });
    });
  });

  describe("override contracts", () => {
    it("requires every supplied class, title, and id field to match", () => {
      engine.windowProps.overrides = [
        { wmClass: "Firefox", wmTitle: "Private", wmId: "123", mode: "float" },
      ];
      const matching = createMockWindow({
        id: 123,
        wm_class: "Firefox",
        title: "Private Browsing",
        allows_resize: true,
      });
      const wrongClass = createMockWindow({
        id: 123,
        wm_class: "Chrome",
        title: "Private Browsing",
        allows_resize: true,
      });
      const wrongTitle = createMockWindow({
        id: 123,
        wm_class: "Firefox",
        title: "Normal Browsing",
        allows_resize: true,
      });
      const wrongId = createMockWindow({
        id: 456,
        wm_class: "Firefox",
        title: "Private Browsing",
        allows_resize: true,
      });

      expect(engine.match(matching).source).toBe("float-override");
      for (const win of [wrongClass, wrongTitle, wrongId]) {
        expect(engine.match(win).source).toBe("default-tile");
      }
    });

    it("lets a TILE rule beat a matching FLOAT rule and a type heuristic", () => {
      engine.windowProps.overrides = [
        { wmClass: "CustomApp", mode: "float" },
        { wmClass: "CustomApp", mode: "tile" },
      ];
      const win = createMockWindow({
        wm_class: "CustomApp",
        title: "Fixed",
        allows_resize: false,
      });

      expect(engine.match(win)).toEqual({ floatExempt: false, source: "tile-override" });
    });

    it("applies a TILE instance rule only to the matching built-in-float window", () => {
      engine.windowProps.overrides = [{ wmClass: "Blender", wmId: "111", mode: "tile" }];
      const selected = createMockWindow({ id: 111, wm_class: "Blender", title: "Main" });
      const other = createMockWindow({ id: 222, wm_class: "Blender", title: "Secondary" });

      expect(engine.match(selected).source).toBe("tile-override");
      expect(engine.match(other).source).toBe("builtin-blender");
    });

    it("falls through to a type heuristic when a TILE title constraint does not match", () => {
      engine.windowProps.overrides = [{ wmClass: "Terminal", wmTitle: "vim", mode: "tile" }];
      const win = createMockWindow({
        wm_class: "Terminal",
        title: "bash",
        allows_resize: false,
      });

      expect(engine.match(win)).toEqual({ floatExempt: true, source: "type-heuristic" });
    });
  });

  describe("Inkscape default override contract", () => {
    beforeEach(() => {
      engine.windowProps.overrides = [
        { wmClass: "inkscape", wmTitle: " - Inkscape", mode: "tile" },
        { wmClass: "org.inkscape.Inkscape", wmTitle: " - Inkscape", mode: "tile" },
        { wmClass: "inkscape", wmTitle: "=Open", mode: "float" },
        { wmClass: "org.inkscape.Inkscape", wmTitle: "=Open", mode: "float" },
      ];
    });

    it.each(["inkscape", "org.inkscape.Inkscape"])(
      "tiles document windows for class %s",
      (wmClass) => {
        const win = createMockWindow({
          wm_class: wmClass,
          title: "Open plan.svg - Inkscape",
          allows_resize: true,
        });

        expect(engine.match(win)).toEqual({ floatExempt: false, source: "tile-override" });
      }
    );

    it("lets the document TILE rule beat the non-resizable heuristic", () => {
      const win = createMockWindow({
        wm_class: "org.inkscape.Inkscape",
        title: "diagram.svg - Inkscape",
        allows_resize: false,
      });

      expect(engine.match(win)).toEqual({ floatExempt: false, source: "tile-override" });
    });

    it("floats only the exact dialog title", () => {
      const dialog = createMockWindow({
        wm_class: "org.inkscape.Inkscape",
        title: "Open",
        allows_resize: true,
      });

      expect(engine.match(dialog)).toEqual({ floatExempt: true, source: "float-override" });
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

    it("addFloatOverride permits separate instance rules for one class", () => {
      const configMgr = { windowProps: { overrides: [] as any[] } };
      engine.addFloatOverride(createMockWindow({ wm_class: "App", id: 1 }), true, configMgr as any);
      engine.addFloatOverride(createMockWindow({ wm_class: "App", id: 2 }), true, configMgr as any);

      expect(configMgr.windowProps.overrides.map((override) => override.wmId)).toEqual(["1", "2"]);
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

    it("removeFloatOverride preserves titled user rules", () => {
      const configMgr = {
        windowProps: {
          overrides: [
            { wmClass: "App", wmTitle: "User Rule", mode: "float" },
            { wmClass: "App", mode: "float" },
          ],
        },
      };

      engine.removeFloatOverride(
        createMockWindow({ wm_class: "App", id: 1 }),
        false,
        configMgr as any
      );

      expect(configMgr.windowProps.overrides).toEqual([
        { wmClass: "App", wmTitle: "User Rule", mode: "float" },
      ]);
    });

    it("removeFloatOverride filters by id only when requested", () => {
      const configMgr = {
        windowProps: {
          overrides: [
            { wmClass: "App", mode: "float" },
            { wmClass: "App", wmId: "1", mode: "float" },
            { wmClass: "App", wmId: "2", mode: "float" },
          ],
        },
      };

      engine.removeFloatOverride(
        createMockWindow({ wm_class: "App", id: 1 }),
        true,
        configMgr as any
      );

      expect(configMgr.windowProps.overrides).toEqual([
        { wmClass: "App", mode: "float" },
        { wmClass: "App", wmId: "2", mode: "float" },
      ]);

      engine.removeFloatOverride(
        createMockWindow({ wm_class: "App", id: 2 }),
        false,
        configMgr as any
      );
      expect(configMgr.windowProps.overrides).toEqual([]);
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

    it("reloadFromConfig preserves titled and TILE rules", () => {
      const props = {
        overrides: [
          { wmClass: "A", wmTitle: "Dialog", mode: "float" },
          { wmClass: "B", mode: "tile" },
          { wmClass: "C", wmId: "3", mode: "float" },
        ],
      };

      engine.reloadFromConfig({ windowProps: props } as any);

      expect(engine.windowProps.overrides).toEqual([
        { wmClass: "A", wmTitle: "Dialog", mode: "float" },
        { wmClass: "B", mode: "tile" },
      ]);
    });
  });
});

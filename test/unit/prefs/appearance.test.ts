import { beforeEach, describe, expect, it, vi } from "vitest";

type ColorRowParams = {
  init: string;
  onChange: (value: string) => void;
  title: string;
};

type SpinButtonRowParams = {
  init: number;
  onChange: (value: number) => void;
  range: [number, number, number];
  title: string;
};

const widgetState = vi.hoisted(() => ({
  colorRows: [] as Array<{
    colorButton: { set_rgba: ReturnType<typeof vi.fn> };
    params: ColorRowParams;
  }>,
  resetCallbacks: [] as Array<() => void>,
  spinRows: [] as Array<{
    activatable_widget: { value: number };
    params: SpinButtonRowParams;
  }>,
}));

const pageState = vi.hoisted(() => ({
  groups: [] as Array<{ children: unknown[]; description?: string; title: string }>,
  setCssProperty: vi.fn(),
}));

vi.mock("../../../src/lib/shared/settings.js", () => ({
  ConfigManager: class {},
}));

vi.mock("../../../src/lib/prefs/prefs-theme-manager.js", () => ({
  PrefsThemeManager: class {
    defaultPalette = {
      floated: { color: "rgba(180, 167, 214, 1)", "border-width": 3 },
      split: { color: "rgba(255, 246, 108, 1)", "border-width": 3 },
      stacked: { color: "rgba(247, 162, 43, 1)", "border-width": 3 },
      tabbed: { color: "rgba(17, 199, 224, 1)", "border-width": 3 },
      tiled: { color: "rgba(236, 94, 94, 1)", "border-width": 3 },
    };

    initializeStylesheet() {
      return { contentsChanged: false };
    }

    reloadStylesheet() {}

    addPx(value: string) {
      return `${value}px`;
    }

    removePx(value: string) {
      return value.replace("px", "");
    }

    getColorSchemeBySelector(selector: string) {
      return selector.split("-")[1];
    }

    getCssProperty(selector: string, property: string) {
      if (property === "border-radius") return { value: "18px" };
      if (property === "border-width") return { value: "3px" };
      if (property === "border-color") return { value: "rgba(1, 2, 3, 1)" };
      if (selector === ".window-focused-shadow") {
        return { value: "0 4px 18px 2px rgba(0, 0, 0, 0.35)" };
      }
      return { value: "0 3px 12px 0 rgba(0, 0, 0, 0.22)" };
    }

    setCssProperty(selector: string, property: string, value: string) {
      pageState.setCssProperty(selector, property, value);
    }
  },
}));

vi.mock("../../../src/lib/prefs/widgets.js", () => {
  class PreferencesPage {
    add_group(group: { children: unknown[]; description?: string; title: string }) {
      pageState.groups.push(group);
    }
  }

  class ResetButton {
    constructor({ onReset }: { onReset: () => void }) {
      widgetState.resetCallbacks.push(onReset);
    }
  }

  class SpinButtonRow {
    activatable_widget = { value: 0 };
    params;

    constructor(params: SpinButtonRowParams) {
      this.params = params;
      this.activatable_widget.value = params.init;
      widgetState.spinRows.push(this);
    }

    add_suffix() {}
  }

  class ColorRow {
    colorButton = { set_rgba: vi.fn() };
    params;

    constructor(params: ColorRowParams) {
      this.params = params;
      widgetState.colorRows.push(this);
    }

    add_suffix() {}
  }

  return {
    ColorRow,
    PreferencesPage,
    ResetButton,
    SpinButtonRow,
    SwitchRow: class {},
  };
});

vi.mock("gi://Adw", () => ({
  default: {
    ExpanderRow: class {
      rows: unknown[] = [];
      title: string;

      constructor({ title }: { title: string }) {
        this.title = title;
      }

      add_row(row: unknown) {
        this.rows.push(row);
      }
    },
  },
}));

vi.mock("gi://Gdk", () => {
  class RGBA {
    alpha = 1;
    value = "";

    parse(value: string) {
      this.value = value;
      this.alpha = 1;
      return true;
    }

    copy() {
      const copy = new RGBA();
      copy.value = this.value;
      copy.alpha = this.alpha;
      return copy;
    }

    to_string() {
      return `${this.value}@${this.alpha}`;
    }
  }

  return { default: { RGBA } };
});

import { AppearancePage } from "../../../src/lib/prefs/appearance.js";
import {
  DEFAULT_FOCUSED_SHADOW,
  DEFAULT_UNFOCUSED_SHADOW,
} from "../../../src/lib/prefs/shadow-style.js";

describe("AppearancePage", () => {
  beforeEach(() => {
    widgetState.colorRows.length = 0;
    widgetState.resetCallbacks.length = 0;
    widgetState.spinRows.length = 0;
    pageState.groups.length = 0;
    pageState.setCssProperty.mockClear();
  });

  it("adds focused and unfocused shadow controls and keeps their radii aligned", () => {
    new AppearancePage({ settings: {} as never, dir: {} as never });

    expect(pageState.groups.map((group) => group.title)).toEqual([
      "Gaps",
      "Style",
      "Color",
      "Shadows",
    ]);
    const shadows = pageState.groups[3].children as Array<{ title: string }>;
    expect(shadows.map((row) => row.title)).toEqual(["Focused window", "Unfocused window"]);

    const borderRadius = widgetState.spinRows.find((row) => row.params.title === "Border radius");
    borderRadius?.params.onChange(22);

    expect(pageState.setCssProperty).toHaveBeenCalledWith(
      ".window-focused-shadow",
      "border-radius",
      "22px"
    );
    expect(pageState.setCssProperty).toHaveBeenCalledWith(
      ".window-unfocused-shadow",
      "border-radius",
      "22px"
    );
  });

  it("resets border width and color from the theme manager's default palette", () => {
    const theme = {
      addPx: (value: string) => `${value}px`,
      defaultPalette: {
        tiled: { color: "rgba(12, 34, 56, 0.9)", "border-width": 4 },
      },
      getColorSchemeBySelector: vi.fn(() => "tiled"),
      getCssProperty: vi.fn((_selector: string, property: string) => ({
        value: property === "border-width" ? "2px" : "rgba(1, 2, 3, 1)",
      })),
      removePx: (value: string) => value.replace("px", ""),
      setCssProperty: vi.fn(),
    };

    AppearancePage.prototype._createColorOptionWidget.call(
      { themeMgr: theme } as unknown as AppearancePage,
      "window-tiled-border"
    );

    expect(widgetState.resetCallbacks).toHaveLength(2);
    widgetState.resetCallbacks[0]();
    expect(theme.setCssProperty).toHaveBeenCalledWith(
      ".window-tiled-border",
      "border-width",
      "4px"
    );
    expect(widgetState.spinRows[0].activatable_widget.value).toBe(4);

    theme.setCssProperty.mockClear();
    widgetState.resetCallbacks[1]();
    expect(theme.setCssProperty).toHaveBeenCalledWith(
      ".window-tiled-border",
      "border-color",
      "rgba(12, 34, 56, 0.9)@1"
    );
    expect(theme.setCssProperty).toHaveBeenCalledWith(
      ".window-tilepreview-tiled",
      "border-color",
      "rgba(12, 34, 56, 0.9)@0.3"
    );
    expect(theme.setCssProperty).toHaveBeenCalledWith(
      ".window-tilepreview-tiled",
      "background-color",
      "rgba(12, 34, 56, 0.9)@0.2"
    );
    expect(widgetState.colorRows[0].colorButton.set_rgba).toHaveBeenCalledOnce();
  });

  it.each([
    {
      defaults: DEFAULT_FOCUSED_SHADOW,
      initial: "0 4px 18px 2px rgba(0, 0, 0, 0.35)",
      initialNumbers: [0, 4, 18, 2],
      selector: ".window-focused-shadow",
      title: "Focused window",
    },
    {
      defaults: DEFAULT_UNFOCUSED_SHADOW,
      initial: "0 3px 12px 0 rgba(0, 0, 0, 0.22)",
      initialNumbers: [0, 3, 12, 0],
      selector: ".window-unfocused-shadow",
      title: "Unfocused window",
    },
  ])(
    "initializes, updates, and resets every $title control",
    ({ defaults, initial, initialNumbers, selector, title }) => {
      const theme = {
        getCssProperty: vi.fn(() => ({ value: initial })),
        setCssProperty: vi.fn(),
      };

      AppearancePage.prototype._createShadowOptionWidget.call(
        { themeMgr: theme } as unknown as AppearancePage,
        selector,
        title,
        defaults
      );

      expect(widgetState.colorRows[0].params.init).toBe(defaults.color);
      expect(widgetState.spinRows.map((row) => row.params.init)).toEqual(initialNumbers);
      expect(widgetState.spinRows.map((row) => row.params.range)).toEqual([
        [-32, 32, 1],
        [-32, 32, 1],
        [0, 64, 1],
        [-32, 32, 1],
      ]);

      widgetState.colorRows[0].params.onChange("rgba(12, 34, 56, 0.5)");
      expect(theme.setCssProperty).toHaveBeenLastCalledWith(
        selector,
        "box-shadow",
        `${initialNumbers[0]}px ${initialNumbers[1]}px ${initialNumbers[2]}px ${initialNumbers[3]}px rgba(12, 34, 56, 0.5)`
      );

      const values = [-3, 6, 24, -2];
      for (const [index, value] of values.entries()) {
        widgetState.spinRows[index].params.onChange(value);
      }
      expect(theme.setCssProperty).toHaveBeenLastCalledWith(
        selector,
        "box-shadow",
        "-3px 6px 24px -2px rgba(12, 34, 56, 0.5)"
      );

      theme.setCssProperty.mockClear();
      for (const reset of widgetState.resetCallbacks) reset();

      expect(theme.setCssProperty).toHaveBeenLastCalledWith(
        selector,
        "box-shadow",
        `${defaults.xOffset}px ${defaults.yOffset}px ${defaults.blurRadius}px ${defaults.spreadRadius}px ${defaults.color}`
      );
      expect(widgetState.colorRows[0].colorButton.set_rgba).toHaveBeenCalledOnce();
      expect(widgetState.spinRows.map((row) => row.activatable_widget.value)).toEqual(
        initialNumbers
      );
    }
  );

  it("falls back without writing unsupported CSS", () => {
    const theme = {
      getCssProperty: vi.fn(() => ({ value: "none" })),
      setCssProperty: vi.fn(),
    };

    AppearancePage.prototype._createShadowOptionWidget.call(
      { themeMgr: theme } as unknown as AppearancePage,
      ".window-unfocused-shadow",
      "Unfocused window",
      DEFAULT_UNFOCUSED_SHADOW
    );

    expect(theme.setCssProperty).not.toHaveBeenCalled();
    expect(widgetState.colorRows[0].params.init).toBe("rgba(0, 0, 0, 0.22)");
    expect(widgetState.spinRows.map((row) => row.params.init)).toEqual([0, 3, 12, 0]);
  });
});

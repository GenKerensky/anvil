import { beforeEach, describe, expect, it, vi } from "vitest";

const widgetState = vi.hoisted(() => ({
  colorRows: [] as Array<{ colorButton: { set_rgba: ReturnType<typeof vi.fn> } }>,
  resetCallbacks: [] as Array<() => void>,
  spinRows: [] as Array<{ activatable_widget: { value: number } }>,
}));

vi.mock("../../../src/lib/prefs/widgets.js", () => {
  class PreferencesPage {}

  class ResetButton {
    constructor({ onReset }: { onReset: () => void }) {
      widgetState.resetCallbacks.push(onReset);
    }
  }

  class SpinButtonRow {
    activatable_widget = { value: 0 };

    constructor() {
      widgetState.spinRows.push(this);
    }

    add_suffix() {}
  }

  class ColorRow {
    colorButton = { set_rgba: vi.fn() };

    constructor() {
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

describe("AppearancePage", () => {
  beforeEach(() => {
    widgetState.colorRows.length = 0;
    widgetState.resetCallbacks.length = 0;
    widgetState.spinRows.length = 0;
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
});

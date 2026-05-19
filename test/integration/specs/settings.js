/**
 * Settings specs
 *
 * Replaces: features/settings.feature (@agent)
 *
 * Verifies that all documented GSettings keys can be read and written.
 */

import { getSettings } from "./helpers.js";

describe("Settings", function () {
  /** @type {any} */
  let s;
  beforeAll(function () {
    s = getSettings();
  });

  // --- uint settings ---

  it("window-gap-size can be modified", function () {
    s.set_uint("window-gap-size", 8);
    expect(s.get_uint("window-gap-size")).toBe(8);
    // restore default
    s.set_uint("window-gap-size", 4);
  });

  // --- boolean settings: toggle false→true ---

  const booleanToggleKeys = [
    "tiling-mode-enabled",
    "float-always-on-top-enabled",
    "focus-border-toggle",
    "split-border-toggle",
    "preview-hint-enabled",
    "showtab-decoration-enabled",
    "window-gap-hidden-on-single",
    "move-pointer-focus-enabled",
    "focus-on-hover-enabled",
    "auto-exit-tabbed",
  ];

  describe("Boolean settings can be toggled", function () {
    for (const key of booleanToggleKeys) {
      it("can toggle " + key, function () {
        s.set_boolean(key, false);
        expect(s.get_boolean(key)).toBe(false);
        s.set_boolean(key, true);
        expect(s.get_boolean(key)).toBe(true);
      });
    }
  });

  // --- existence checks ---

  describe("Effect settings are accessible", function () {
    it("focus-border-size setting exists", function () {
      expect(s.get_value("focus-border-size")).not.toBeNull();
    });

    it("split-border-color setting exists", function () {
      expect(s.get_value("split-border-color")).not.toBeNull();
    });
  });
});

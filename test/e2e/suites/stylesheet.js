/**
 * Real-Shell stylesheet migration and settings-bridge smoke.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  closeAllWindows,
  getExtensionErrors,
  getSettings,
  launchApp,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

const UUID = "anvil@GenKerensky.github.com";
const STATE_ACTIVE = 1;
const STATE_INACTIVE = 2;

/** @param {number} state */
async function waitForExtensionState(state) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (Main.extensionManager.lookup(UUID)?.state === state) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for extension state ${state}`);
}

describe("Stylesheet lifecycle", function () {
  it("preserves custom bytes across re-enable and accepts a prefs-style reload signal", async function () {
    const path = GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "anvil",
      "stylesheet",
      "anvil",
      "stylesheet.css",
    ]);
    const file = Gio.File.new_for_path(path);
    expect(file.query_exists(null)).toBe(true);
    const [loaded, originalBytes, originalEtag] = file.load_contents(null);
    expect(loaded).toBe(true);

    const firstSentinel =
      "/* e2e custom sentinel */\n" +
      ".window-tiled-border { border-width: 4px; }\n" +
      ".anvil-e2e-reload { color: rgb(17, 34, 51); }\n";
    const secondSentinel =
      "/* e2e custom sentinel after prefs-style edit */\n" +
      ".window-tiled-border { border-width: 5px; }\n" +
      ".anvil-e2e-reload { color: rgb(68, 85, 102); }\n";
    /** @type {St.Widget | null} */
    let probe = null;

    try {
      const [written] = file.replace_contents(
        firstSentinel,
        originalEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      expect(written).toBe(true);

      Main.extensionManager.disableExtension(UUID);
      await waitForExtensionState(STATE_INACTIVE);
      Main.extensionManager.enableExtension(UUID);
      await waitForExtensionState(STATE_ACTIVE);

      const [reloaded, preservedBytes] = file.load_contents(null);
      expect(reloaded).toBe(true);
      expect(GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, preservedBytes)).toBe(
        GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, firstSentinel)
      );
      expect(getExtensionErrors()).toEqual([]);

      probe = new St.Widget({ style_class: "anvil-e2e-reload" });
      global.stage.add_child(probe);
      await sleep(100);
      const before = probe.get_theme_node().get_foreground_color();
      expect([before.red, before.green, before.blue]).toEqual([17, 34, 51]);

      const [, , activeEtag] = file.load_contents(null);
      const [edited] = file.replace_contents(
        secondSentinel,
        activeEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      expect(edited).toBe(true);

      const settings = /** @type {Gio.Settings} */ (/** @type {any} */ (global).__anvil_settings);
      const token = GLib.uuid_string_random();
      expect(settings.set_string("css-updated", token)).toBe(true);
      await sleep(500);
      expect(settings.get_string("css-updated")).toBe(token);
      const after = probe.get_theme_node().get_foreground_color();
      expect([after.red, after.green, after.blue]).toEqual([68, 85, 102]);
      expect(getExtensionErrors()).toEqual([]);
    } finally {
      probe?.destroy();
      if (Main.extensionManager.lookup(UUID)?.state === STATE_ACTIVE) {
        Main.extensionManager.disableExtension(UUID);
        await waitForExtensionState(STATE_INACTIVE);
      }

      const [, , currentEtag] = file.load_contents(null);
      const [restored] = file.replace_contents(
        originalBytes,
        currentEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      expect(restored).toBe(true);
      Main.extensionManager.enableExtension(UUID);
      await waitForExtensionState(STATE_ACTIVE);
    }
  });

  it("refreshes the computed style of an existing replacement shadow", async function () {
    const path = GLib.build_filenamev([
      GLib.get_user_config_dir(),
      "anvil",
      "stylesheet",
      "anvil",
      "stylesheet.css",
    ]);
    const file = Gio.File.new_for_path(path);
    const [loaded, originalBytes, originalEtag] = file.load_contents(null);
    expect(loaded).toBe(true);
    const originalCss = new TextDecoder().decode(originalBytes);
    const focusedShadowPattern = /(\.window-focused-shadow\s*\{[^}]*box-shadow:\s*)[^;]+(;)/s;
    expect(focusedShadowPattern.test(originalCss)).toBe(true);
    const editedCss = originalCss.replace(
      focusedShadowPattern,
      "$1 0 4px 18px 2px rgba(128, 0, 255, 0.8)$2"
    );
    expect(editedCss).toContain("rgba(128, 0, 255, 0.8)");

    const settings = getSettings();
    const originalFocusBorder = settings.get_boolean("focus-border-toggle");
    let currentEtag = originalEtag;
    try {
      settings.set_boolean("focus-border-toggle", true);
      await closeAllWindows();
      await launchApp("org.gnome.Nautilus.desktop");
      await waitForWindowCount(1, 5000);
      await sleep(500);

      const window = global.display.get_focus_window();
      expect(window).not.toBeNull();
      const actor = /** @type {any} */ (window.get_compositor_private());
      const shadow = actor.cornerShadow;
      expect(shadow).not.toBeNull();
      expect(shadow.style_class).toBe("window-focused-shadow");
      shadow.ensure_style();
      const before = shadow.get_theme_node().get_box_shadow();
      expect([before.color.red, before.color.green, before.color.blue]).not.toEqual([128, 0, 255]);

      const [written, editedEtag] = file.replace_contents(
        editedCss,
        currentEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      expect(written).toBe(true);
      currentEtag = editedEtag;
      expect(settings.set_string("css-updated", GLib.uuid_string_random())).toBe(true);
      await sleep(700);

      expect(actor.cornerShadow).toBe(shadow);
      shadow.ensure_style();
      const after = shadow.get_theme_node().get_box_shadow();
      expect([after.color.red, after.color.green, after.color.blue, after.color.alpha]).toEqual([
        128, 0, 255, 204,
      ]);
      expect(getExtensionErrors()).toEqual([]);
    } finally {
      const [restored] = file.replace_contents(
        originalBytes,
        currentEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      expect(restored).toBe(true);
      settings.set_string("css-updated", GLib.uuid_string_random());
      settings.set_boolean("focus-border-toggle", originalFocusBorder);
      await closeAllWindows();
    }
  });
});

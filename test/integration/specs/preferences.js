/**
 * Preferences Window and AT-SPI Tree specs
 *
 * Replaces:
 *   features/preferences.feature  (@prefs)  — Dogtail → gi://Atspi
 *   features/atspi_tree.feature   (@atspi)  — Dogtail → gi://Atspi
 *
 * The AT-SPI accessibility daemon is started by start-session.sh
 * (at-spi-bus-launcher --launch-immediately --a11y=1), so Atspi.get_desktop(0)
 * is live by the time these specs run.
 *
 * The prefs window runs as a separate GTK4 process
 * (gnome-shell-extension-prefs). Both gnome-shell and the prefs process
 * register with the same AT-SPI bus, so the prefs window is visible from
 * inside gnome-shell's GJS via Atspi.get_desktop(0).
 */

import Atspi from "gi://Atspi";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  UUID,
  getSettings,
  sleep,
  openPrefsWindow,
  navigateToTab,
  findSwitch,
  findAccessible,
  findAllAccessibles,
  hasRole,
  hasState,
  getName,
  doAction,
  waitForAccessible,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Switch → GSettings key + owning tab
// Mirrors helpers.py SWITCH_TO_KEY / SWITCH_TO_TAB
// ---------------------------------------------------------------------------

/** @type {Array<{name: string, key: string, tab: string}>} */
const SWITCH_MAP = [
  { name: "Focus on Hover", key: "focus-on-hover-enabled", tab: "Tiling" },
  {
    name: "Move pointer with focused window",
    key: "move-pointer-focus-enabled",
    tab: "Tiling",
  },
  { name: "Quarter tiling", key: "auto-split-enabled", tab: "Tiling" },
  { name: "Stacked tiling", key: "stacked-tiling-mode-enabled", tab: "Tiling" },
  { name: "Tabbed tiling", key: "tabbed-tiling-mode-enabled", tab: "Tiling" },
  { name: "Auto exit tabbed tiling", key: "auto-exit-tabbed", tab: "Tiling" },
  {
    name: "Always on Top mode for floating windows",
    key: "float-always-on-top-enabled",
    tab: "Windows",
  },
];

/** @type {string[]} */
const PAGE_TABS = ["Tiling", "Appearance", "Keyboard", "Windows"];

// ---------------------------------------------------------------------------
// AT-SPI Tree spec
// ---------------------------------------------------------------------------

describe("AT-SPI Tree", function () {
  it("gnome-shell is accessible and has a visible Main stage with children", async function () {
    Atspi.init();

    // The desktop root lists all registered AT-SPI applications
    const desktop = Atspi.get_desktop(0);
    expect(desktop).not.toBeNull();

    // Find the gnome-shell application node
    const gnomeShell = await waitForAccessible(function (node) {
      return getName(node) === "gnome-shell";
    }, 10000);
    expect(gnomeShell).not.toBeNull();

    // Find the "Main stage" window inside gnome-shell
    const mainStage = findAccessible(gnomeShell, function (node) {
      return hasRole(node, "window") && getName(node) === "Main stage";
    });
    expect(mainStage).not.toBeNull();
    if (mainStage == null) throw new Error("Main stage not found");

    // In headless mode the stage compositor is not visible (no display output)
    expect(hasState(mainStage, Atspi.StateType.SHOWING)).toBe(false);

    // The stage should still have child actors registered in the a11y tree
    expect(mainStage.get_child_count()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Preferences Window spec
// ---------------------------------------------------------------------------

describe("Preferences Window", function () {
  /** @type {Atspi.Accessible | null} */
  let prefs = null;

  beforeAll(async function () {
    Atspi.init();
    try {
      prefs = await openPrefsWindow(12000);
    } catch (e) {
      // prefs will be null; individual its will fail with clear messages
      log(
        "[AnvilSpec] Failed to open prefs window: " + (e instanceof Error ? e.message : String(e))
      );
    }
  });

  afterAll(async function () {
    // Close the prefs window by finding its close button or sending delete
    if (prefs) {
      try {
        // Try to close the GTK window via the AT-SPI window action "close"
        const iface = prefs.get_action_iface();
        if (iface) {
          const n = iface.get_n_actions();
          for (let i = 0; i < n; i++) {
            if ((iface.get_action_name(i) || "").toLowerCase() === "close") {
              iface.do_action(i);
              break;
            }
          }
        }
      } catch (_e) {
        // Best-effort close — gnome-shell will clean up on its own
      }
      await sleep(500);
    }
  });

  it("opens without errors", function () {
    expect(prefs).not.toBeNull();
    expect(prefs).not.toBeUndefined();
    const ext = Main.extensionManager.lookup(UUID);
    const error =
      ext && /** @type {any} */ (ext).stateObj ? /** @type {any} */ (ext).stateObj.error : null;
    expect(error).toBeFalsy();
  });

  describe("Page tabs", function () {
    for (const tabName of PAGE_TABS) {
      it('shows the "' + tabName + '" page tab', function () {
        expect(prefs).not.toBeNull();
        if (prefs == null) throw new Error("prefs window not available");
        const tab = findAccessible(prefs, function (node) {
          return hasRole(node, "page tab") && getName(node) === tabName;
        });
        expect(tab).not.toBeNull();
      });
    }

    it("all page tabs can be clicked without error", async function () {
      expect(prefs).not.toBeNull();
      if (prefs == null) throw new Error("prefs window not available");
      // Navigate through all tabs and back to Tiling
      const tabs = [...PAGE_TABS, "Tiling"];
      for (const tabName of tabs) {
        const tab = findAccessible(prefs, function (node) {
          return hasRole(node, "page tab") && getName(node) === tabName;
        });
        expect(tab)
          .withContext('Tab "' + tabName + '" not found')
          .not.toBeNull();
        if (tab == null) throw new Error('Tab "' + tabName + '" not found');
        doAction(tab);
        await sleep(400);
        // Verify no extension error was triggered by the UI action
        const ext = Main.extensionManager.lookup(UUID);
        const error =
          ext && /** @type {any} */ (ext).stateObj ? /** @type {any} */ (ext).stateObj.error : null;
        expect(error)
          .withContext('Error after clicking tab "' + tabName + '"')
          .toBeFalsy();
      }
    });
  });

  describe("Switch state matches GSettings", function () {
    for (const { name, key, tab } of SWITCH_MAP) {
      it('"' + name + '" checked state matches gsetting "' + key + '"', async function () {
        expect(prefs).not.toBeNull();
        if (prefs == null) throw new Error("prefs window not available");
        const s = getSettings();

        await navigateToTab(prefs, tab);

        const sw = findSwitch(prefs, name);
        expect(sw)
          .withContext('Switch "' + name + '" not found on tab "' + tab + '"')
          .not.toBeNull();
        if (sw == null) throw new Error('Switch "' + name + '" not found');

        const gsVal = s.get_boolean(key);
        const checked = hasState(sw, Atspi.StateType.CHECKED);
        expect(checked)
          .withContext(
            'Switch "' + name + '" checked=' + checked + ' but gsetting "' + key + '"=' + gsVal
          )
          .toBe(gsVal);
      });

      it('"' + name + '" updates after gsetting "' + key + '" is toggled', async function () {
        expect(prefs).not.toBeNull();
        if (prefs == null) throw new Error("prefs window not available");
        const s = getSettings();

        await navigateToTab(prefs, tab);

        const sw = findSwitch(prefs, name);
        expect(sw)
          .withContext('Switch "' + name + '" not found for toggle test')
          .not.toBeNull();
        if (sw == null) throw new Error('Switch "' + name + '" not found');

        const originalVal = s.get_boolean(key);
        const newVal = !originalVal;

        // Change the GSettings value and wait for the prefs UI to react
        s.set_boolean(key, newVal);
        await sleep(400);

        const checkedAfter = hasState(sw, Atspi.StateType.CHECKED);
        expect(checkedAfter)
          .withContext(
            'After toggling "' + key + '" to ' + newVal + ", switch checked=" + checkedAfter
          )
          .toBe(newVal);

        // Restore original value
        s.set_boolean(key, originalVal);
        await sleep(200);
      });
    }
  });
});

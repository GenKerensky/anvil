/**
 * Shared helpers for Anvil integration Jasmine specs.
 *
 * All helpers run inside gnome-shell's GJS process (automation-script context),
 * so gi:// imports and global Shell APIs are available.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Atspi from "gi://Atspi";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export const UUID = "anvil@GenKerensky.github.com";
export const SCHEMA_ID = "org.gnome.shell.extensions.anvil";

// ---------------------------------------------------------------------------
// Re-export shared commands (common between E2E and integration)
// ---------------------------------------------------------------------------

import {
  sleep,
  getSettings,
  getExtension,
  launchApp,
  openWindow,
  getWindowCount,
  getWindowGeometries,
  getFocusedWindowTitle,
  getMonitorWorkArea,
  closeFocusedWindow,
  closeAllWindows,
  windowsOverlap,
  windowsFillWorkArea,
  sendKeyCombo,
  sendAnvilCommand,
  getAnvilWM,
  getAnvilSettings,
  getNodePercents,
  clearResizedWindows,
  clearMonitorConstraints,
  setMonitorConstraint,
  takeScreenshot,
  formatWindowState,
  isExtensionActive,
  getExtensionErrors,
} from "../../lib/shared-commands.js";

export {
  sleep,
  getSettings,
  getExtension,
  launchApp,
  openWindow,
  getWindowCount,
  getWindowGeometries,
  getFocusedWindowTitle,
  getMonitorWorkArea,
  closeFocusedWindow,
  closeAllWindows,
  windowsOverlap,
  windowsFillWorkArea,
  sendKeyCombo,
  sendAnvilCommand,
  getAnvilWM,
  getAnvilSettings,
  getNodePercents,
  clearResizedWindows,
  clearMonitorConstraints,
  setMonitorConstraint,
  takeScreenshot,
  formatWindowState,
  isExtensionActive,
  getExtensionErrors,
};

// ---------------------------------------------------------------------------
// AT-SPI helpers
// ---------------------------------------------------------------------------

/**
 * Walk the AT-SPI accessible tree starting at `node`, calling `predicate`
 * on each node. Returns the first node for which predicate returns true,
 * or null if none found within maxDepth.
 *
 * @param {Atspi.Accessible} node
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [maxDepth=12]
 * @returns {Atspi.Accessible|null}
 */
export function findAccessible(node, predicate, maxDepth = 12) {
  if (maxDepth < 0) return null;
  try {
    if (predicate(node)) return node;
    const count = node.get_child_count();
    for (let i = 0; i < count; i++) {
      const child = node.get_child_at_index(i);
      if (!child) continue;
      const found = findAccessible(child, predicate, maxDepth - 1);
      if (found) return found;
    }
  } catch (_e) {
    // Stale/inaccessible node — skip
  }
  return null;
}

/**
 * Find all AT-SPI nodes under `node` that match `predicate`.
 *
 * @param {Atspi.Accessible} node
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [maxDepth=12]
 * @returns {Atspi.Accessible[]}
 */
export function findAllAccessibles(node, predicate, maxDepth = 12) {
  /** @type {Atspi.Accessible[]} */
  const results = [];

  /**
   * @param {Atspi.Accessible} n
   * @param {number} depth
   */
  function walk(n, depth) {
    if (depth < 0) return;
    try {
      if (predicate(n)) results.push(n);
      const count = n.get_child_count();
      for (let i = 0; i < count; i++) {
        const child = n.get_child_at_index(i);
        if (child) walk(child, depth - 1);
      }
    } catch (_e) {
      // Stale node — skip
    }
  }
  walk(node, maxDepth);
  return results;
}

/**
 * Poll the AT-SPI desktop until a node matching `predicate` appears,
 * or until `timeoutMs` is exceeded.
 *
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<Atspi.Accessible>}
 */
export async function waitForAccessible(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const desktop = Atspi.get_desktop(0);
    if (desktop) {
      const found = findAccessible(desktop, predicate);
      if (found) return found;
    }
    await sleep(300);
  }
  throw new Error("Timed out waiting for accessible node after " + timeoutMs + "ms");
}

/**
 * Returns true if the node's state set contains the given Atspi.StateType.
 * @param {Atspi.Accessible} node
 * @param {number} stateType - An Atspi.StateType value
 * @returns {boolean}
 */
export function hasState(node, stateType) {
  try {
    return node.get_state_set().contains(stateType);
  } catch (_e) {
    return false;
  }
}

/**
 * Returns true if the node's role name matches (case-insensitive).
 * @param {Atspi.Accessible} node
 * @param {string} roleName
 * @returns {boolean}
 */
export function hasRole(node, roleName) {
  try {
    return (node.get_role_name() || "").toLowerCase() === roleName.toLowerCase();
  } catch (_e) {
    return false;
  }
}

/**
 * Returns the node's accessible name, or "" if unavailable.
 * @param {Atspi.Accessible} node
 * @returns {string}
 */
export function getName(node) {
  try {
    return node.get_name() || "";
  } catch (_e) {
    return "";
  }
}

/**
 * Perform the default action (index 0) on an accessible node.
 * @param {Atspi.Accessible} node
 * @returns {boolean}
 */
export function doAction(node) {
  try {
    const iface = node.get_action_iface();
    if (iface) {
      iface.do_action(0);
      return true;
    }
  } catch (_e) {
    // ignore
  }
  return false;
}

// ---------------------------------------------------------------------------
// Preferences window helpers
// ---------------------------------------------------------------------------

/**
 * Opens the Anvil preferences window via D-Bus and waits for it to appear
 * in the AT-SPI tree.
 *
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<Atspi.Accessible>} The prefs window accessible node.
 */
export async function openPrefsWindow(timeoutMs = 10000) {
  // Initialize the AT-SPI subsystem (safe to call multiple times)
  Atspi.init();

  // Open the prefs window via the gnome-shell Extensions D-Bus API
  Gio.DBus.session.call_sync(
    "org.gnome.Shell",
    "/org/gnome/Shell",
    "org.gnome.Shell.Extensions",
    "OpenExtensionPrefs",
    new GLib.Variant("(ssa{sv})", [UUID, "", {}]),
    null,
    Gio.DBusCallFlags.NONE,
    5000,
    null
  );

  // Poll the AT-SPI tree for a frame/window whose name contains "Anvil"
  return waitForAccessible(function (node) {
    const role = (node.get_role_name() || "").toLowerCase();
    if (role !== "frame" && role !== "window") return false;
    const name = node.get_name() || "";
    return name.includes("Anvil");
  }, timeoutMs);
}

/**
 * Navigate to a named page tab in the prefs window by clicking it.
 *
 * @param {Atspi.Accessible} prefsWindow
 * @param {string} tabName
 */
export async function navigateToTab(prefsWindow, tabName) {
  const tab = findAccessible(prefsWindow, function (node) {
    return hasRole(node, "page tab") && getName(node) === tabName;
  });
  if (!tab) throw new Error("Page tab '" + tabName + "' not found");
  doAction(tab);
  await sleep(500);
}

/**
 * Find a switch/toggle-button by name in the prefs window.
 *
 * @param {Atspi.Accessible} prefsWindow
 * @param {string} switchName
 * @returns {Atspi.Accessible|null}
 */
export function findSwitch(prefsWindow, switchName) {
  return findAccessible(prefsWindow, function (node) {
    const role = (node.get_role_name() || "").toLowerCase();
    const isSwitch = role === "toggle button" || role === "check box" || role === "switch";
    return isSwitch && getName(node) === switchName;
  });
}

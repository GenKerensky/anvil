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

// Re-export shared commands
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
  waitForWindowCount,
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
  waitForWindowCount,
};

/**
 * @param {Atspi.Accessible} node
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [maxDepth]
 * @returns {Atspi.Accessible | null}
 */
export function findAccessible(node, predicate, maxDepth = 12) {
  if (maxDepth < 0) return null;
  try {
    if (predicate(node)) return node;
    const count = node.get_child_count();
    for (let i = 0; i < count; i++) {
      const child = node.get_child_at_index(i);
      if (!child) continue;
      /** @type {Atspi.Accessible | null} */
      const found = findAccessible(child, predicate, maxDepth - 1);
      if (found) return found;
    }
  } catch (_e) {}
  return null;
}

/**
 * @param {Atspi.Accessible} node
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [maxDepth]
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
    } catch (_e) {}
  }
  walk(node, maxDepth);
  return results;
}

/**
 * @param {(node: Atspi.Accessible) => boolean} predicate
 * @param {number} [timeoutMs]
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
 * @param {Atspi.Accessible} node
 * @param {Atspi.StateType} stateType
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
  } catch (_e) {}
  return false;
}

// Preferences window helpers
/**
 * @param {number} [timeoutMs]
 * @returns {Promise<Atspi.Accessible>}
 */
export async function openPrefsWindow(timeoutMs = 10000) {
  // Initialize AT‑SPI
  Atspi.init();

  // Try D‑Bus first
  try {
    Gio.DBus.session.call_sync(
      "org.gnome.Shell",
      "/org/gnome/Shell",
      "org.gnome.Shell.Extensions",
      "OpenExtensionPrefs",
      new GLib.Variant("(ssa{sv})", [UUID, "", {}]),
      null,
      Gio.DBusCallFlags.NONE,
      15000,
      null
    );
  } catch (_e) {}

  // Wait for the prefs window
  const atspiResult = await waitForAccessible((node) => {
    const role = (node.get_role_name() || "").toLowerCase();
    if (role !== "frame" && role !== "window") return false;
    const name = node.get_name() || "";
    return name.includes("Anvil");
  }, timeoutMs);

  if (!atspiResult) {
    const ext = /** @type {{ openPreferences?: () => void } | null} */ (
      Main.extensionManager.lookup(UUID)
    );
    if (ext && typeof ext.openPreferences === "function") {
      try {
        ext.openPreferences();
      } catch {}
      // Wait again
      return await waitForAccessible((node) => {
        const role = (node.get_role_name() || "").toLowerCase();
        if (role !== "frame" && role !== "window") return false;
        const name = node.get_name() || "";
        return name.includes("Anvil");
      }, timeoutMs);
    }
  }

  return atspiResult;
}

/**
 * @param {Atspi.Accessible} prefsWindow
 * @param {string} tabName
 * @returns {Promise<void>}
 */
export async function navigateToTab(prefsWindow, tabName) {
  const tab = findAccessible(prefsWindow, (node) => {
    return hasRole(node, "page tab") && getName(node) === tabName;
  });
  if (!tab) throw new Error(`Page tab "${tabName}" not found`);
  doAction(tab);
  await sleep(500);
}

/**
 * @param {Atspi.Accessible} prefsWindow
 * @param {string} switchName
 * @returns {Atspi.Accessible | null}
 */
export function findSwitch(prefsWindow, switchName) {
  return findAccessible(prefsWindow, (node) => {
    const role = (node.get_role_name() || "").toLowerCase();
    const isSwitch = role === "toggle button" || role === "check box" || role === "switch";
    return isSwitch && getName(node) === switchName;
  });
}

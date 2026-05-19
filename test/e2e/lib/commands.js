/**
 * Shared helpers for Anvil E2E tests running inside GNOME Shell.
 *
 * All functions execute in the gnome-shell JS context and have direct
 * access to global.display, Meta, Main, Clutter, etc.
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { sleep } from "../../lib/shared-commands.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";

/* ── Application management ──────────────────────────────────────────── */

/**
 * @param {string} desktopFile
 */
export async function launchApp(desktopFile) {
  const appSystem = Shell.AppSystem.get_default();
  const app = appSystem.lookup_app(desktopFile);
  if (!app) throw new Error("Desktop file not found: " + desktopFile);

  const before = getWindowCount();
  log("[E2E] Launching " + desktopFile + " (windows before=" + before + ")");
  app.open_new_window(-1);

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await sleep(300);
    const count = getWindowCount();
    if (count > before) {
      log("[E2E] Window appeared for " + desktopFile + " (windows now=" + count + ")");
      await sleep(500);
      return;
    }
  }
  const after = getWindowCount();
  log("[E2E] Timeout launching " + desktopFile + " (windows now=" + after + ")");
  throw new Error("No new window appeared after launching " + desktopFile);
}

/* ── Window geometry queries ────────────────────────────────────────── */

/**
 * @returns {Array<{title: string | null, x: number, y: number, width: number, height: number, minimized: boolean}>}
 */
export function getWindowGeometries() {
  const workspace = global.display.get_workspace_manager().get_active_workspace();
  const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
  return windows.map(function (w) {
    const rect = w.get_frame_rect();
    return {
      title: w.get_title(),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      minimized: w.minimized,
    };
  });
}

/** @returns {number} */
export function getWindowCount() {
  return getWindowGeometries().filter(function (w) {
    return !w.minimized;
  }).length;
}

/** @returns {string | null} */
export function getFocusedWindowTitle() {
  const w = global.display.get_focus_window();
  return w ? w.get_title() : "";
}

/** @returns {{ x: number, y: number, width: number, height: number }} */
export function getMonitorWorkArea() {
  const workspace = global.display.get_workspace_manager().get_active_workspace();
  const area = workspace.get_work_area_for_monitor(0);
  const r = { x: area.x, y: area.y, width: area.width, height: area.height };
  log("[E2E] Work area: x=" + r.x + " y=" + r.y + " w=" + r.width + " h=" + r.height);
  return r;
}

/* ── Overlap / fill checks ─────────────────────────────────────────── */

/**
 * @param {Array<{x: number, y: number, width: number, height: number}>} wins
 * @returns {boolean}
 */
export function windowsOverlap(wins) {
  for (let i = 0; i < wins.length; i++) {
    for (let j = i + 1; j < wins.length; j++) {
      const a = wins[i];
      const b = wins[j];
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      )
        return true;
    }
  }
  return false;
}

/**
 * @param {Array<{width: number, height: number}>} wins
 * @param {number} tolerance
 * @returns {boolean}
 */
export function windowsFillWorkArea(wins, tolerance) {
  const area = getMonitorWorkArea();
  const total = wins.reduce(function (sum, w) {
    return sum + w.width * w.height;
  }, 0);
  const work = area.width * area.height;
  const ratio = Math.abs(total - work) / work;
  return ratio <= tolerance;
}

/* ── Action triggers ───────────────────────────────────────────────── */

/** @type {{ [key: string]: { name: string; direction?: string; mode?: string; x?: string; y?: string; width?: number; height?: number } }} */
const COMBO_ACTIONS = {
  "super+h": { name: "LayoutToggle" },
  "super+j": { name: "Focus", direction: "Right" },
  "super+c": {
    name: "FloatToggle",
    mode: "float",
    x: "center",
    y: "center",
    width: 0.65,
    height: 0.75,
  },
  "alt+f4": { name: "WindowClose" },
};

/**
 * @param {string} combo
 */
export function sendKeyCombo(combo) {
  const key = combo.toLowerCase().replace(/\s+/g, "");
  const action = COMBO_ACTIONS[key];
  if (!action) throw new Error("Unknown combo: " + combo);

  // Try global.__anvil_extWm first (set always by extension's enable())
  const g = /** @type {any} */ (global);
  let wm = g.__anvil_extWm;

  // Fallback: global.__anvil_test_state (set when test-mode is enabled)
  if (!wm) {
    if (g.__anvil_test_state && g.__anvil_test_state.extWm) wm = g.__anvil_test_state.extWm;
  }

  if (!wm) {
    log(
      "[E2E] sendKeyCombo: __anvil_extWm=" +
        (g.__anvil_extWm ? "set" : "null") +
        " __anvil_test_state=" +
        (g.__anvil_test_state ? "found" : "null")
    );
    // Try to re-enable the extension — may have been disabled between suites
    let ext = Main.extensionManager.lookup(UUID);
    if (ext && ext.state !== 1) {
      log("[E2E] Re-enabling extension…");
      try {
        Main.extensionManager.enableExtension(UUID);
      } catch (e) {
        log("[E2E] Re-enable failed: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    wm = g.__anvil_extWm;
    if (!wm) throw new Error("Anvil extension not loaded, cannot send key combo");
  }
  wm.command(action);
  sleep(500);
}

export async function closeFocusedWindow() {
  const w = global.display.get_focus_window();
  if (w) w.delete(global.display.get_current_time());
  await sleep(500);
}

export async function closeAllWindows() {
  const workspace = global.display.get_workspace_manager().get_active_workspace();
  const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
  windows.forEach(function (w) {
    w.delete(global.display.get_current_time());
  });
  await sleep(500);
}

/* ── Extension queries ─────────────────────────────────────────────── */

/** @returns {boolean} */
export function isExtensionActive() {
  const ext = Main.extensionManager.lookup(UUID);
  return ext && ext.state === 1;
}

/** @returns {string[]} */
export function getExtensionErrors() {
  const ext = Main.extensionManager.lookup(UUID);
  if (!ext) return ["Extension not loaded"];
  return /** @type {any} */ (ext).errors || [];
}

/* ── Screenshot ────────────────────────────────────────────────────── */

/**
 * @param {string} path
 */
export function takeScreenshot(path) {
  try {
    const connection = Gio.DBus.session;
    connection.call_sync(
      "org.gnome.Shell.Screenshot",
      "/org/gnome/Shell/Screenshot",
      "org.gnome.Shell.Screenshot",
      "Screenshot",
      new GLib.Variant("(bbs)", [false, false, path]),
      null,
      Gio.DBusCallFlags.NONE,
      15000,
      null
    );
  } catch (e) {
    /* screenshot may fail silently in devkit */
  }
}

/* ── Anvil extension internals ─────────────────────────────────────── */

/** @returns {any} */
export function getAnvilWM() {
  // In GNOME 50+, Main.extensionManager.lookup() returns a proxy that only
  // exposes base Extension properties — custom fields/methods are not forwarded.
  // The extension always sets global.__anvil_extWm in enable() for E2E access.
  const g = /** @type {any} */ (global);
  if (g.__anvil_extWm) return g.__anvil_extWm;

  // Fallback: global.__anvil_test_state (set when test-mode is enabled)
  const state = g.__anvil_test_state;
  if (state && state.extWm) return state.extWm;

  throw new Error("Anvil extWm not available");
}

/**
 * @param {{ name: string, [key: string]: any }} action
 */
export function sendAnvilCommand(action) {
  const wm = getAnvilWM();
  wm.command(action);
}

/**
 * @returns {Array<{title: string | null, percent: number, rect: {x: number, y: number, width: number, height: number} | null, parentLayout: any}>}
 */
export function getNodePercents() {
  const wm = getAnvilWM();
  const tree = wm.tree;
  if (!tree) throw new Error("Anvil tree not available");
  const windows = /** @type {any[]} */ (tree.getNodeByType("WINDOW"));
  return windows.map(function (node) {
    const metaWin = node.nodeValue;
    const rect = metaWin ? metaWin.get_frame_rect() : null;
    return {
      title: metaWin ? metaWin.get_title() : "(no meta)",
      percent: node.percent,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      parentLayout: node.parentNode ? node.parentNode.nodeValue : "(no parent)",
    };
  });
}

/** @returns {any} */
export function getAnvilSettings() {
  const ext = Main.extensionManager.lookup(UUID);
  if (!ext) throw new Error("Anvil extension not found");
  const settings = /** @type {any} */ (ext).getSettings();
  if (!settings) throw new Error("Anvil extension settings not available");
  return settings;
}

/* ── Monitor constraint management ─────────────────────────────────────── */

export function clearResizedWindows() {
  try {
    const wm = getAnvilWM();
    if (wm && wm._resizedWindows) {
      wm._resizedWindows.clear();
    }
  } catch (e) {
    log("[E2E] clearResizedWindows: " + (e instanceof Error ? e.message : String(e)));
  }
}

export function clearMonitorConstraints() {
  try {
    const settings = /** @type {any} */ (global).__anvil_settings;
    if (!settings) return;
    const variant = new GLib.Variant("a(suubb)", []);
    settings.set_value("monitor-constraints", variant);
  } catch (e) {
    log("[E2E] clearMonitorConstraints: " + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * @param {string} connector
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @param {boolean} enabled
 * @param {boolean} resizeExempt
 */
export function setMonitorConstraint(connector, maxWidth, maxHeight, enabled, resizeExempt) {
  try {
    const settings = /** @type {any} */ (global).__anvil_settings;
    if (!settings) return;
    const variant = new GLib.Variant("a(suubb)", [
      [connector, maxWidth, maxHeight, enabled, resizeExempt],
    ]);
    settings.set_value("monitor-constraints", variant);
  } catch (e) {
    log("[E2E] setMonitorConstraint: " + (e instanceof Error ? e.message : String(e)));
  }
}

/* ── Formatting ────────────────────────────────────────────────────── */

/**
 * @param {Array<{title: string | null, x: number, y: number, width: number, height: number}>} wins
 * @returns {string}
 */
export function formatWindowState(wins) {
  const lines = ["Windows (" + wins.length + "):"];
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i];
    lines.push(
      "  [" +
        (i + 1) +
        "] '" +
        w.title +
        "' @ (" +
        w.x +
        "," +
        w.y +
        ") " +
        w.width +
        "x" +
        w.height
    );
  }
  return lines.join("\n");
}

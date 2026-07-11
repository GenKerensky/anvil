/**
 * Shared test helpers for Anvil — usable by E2E suites and the agent debug loop.
 *
 * All functions execute in the gnome-shell JS context and have direct
 * access to global.display, Meta, Main, Clutter, etc.
 *
 * Import in E2E suites: import { ... } from "../../lib/shared-commands.js";
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Async sleep using GLib timeout (safe inside GJS main loop).
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(function (resolve) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, function () {
      resolve(undefined);
      return GLib.SOURCE_REMOVE;
    });
  });
}

// ---------------------------------------------------------------------------
// GSettings
// ---------------------------------------------------------------------------

/** @type {Gio.Settings | null} */
let _settings = null;

/** @returns {Gio.Settings} */
export function getSettings() {
  if (!_settings) {
    _settings = new Gio.Settings({ schema_id: SCHEMA_ID });
  }
  return _settings;
}

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

/** @returns {any} */
export function getExtension() {
  return Main.extensionManager.lookup(UUID);
}

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

// ---------------------------------------------------------------------------
// Application / window management
// ---------------------------------------------------------------------------

/**
 * Launch an application by desktop file and wait for a window to appear.
 * @param {string} desktopFile
 * @param {number} [timeoutMs=10000]
 */
export async function launchApp(desktopFile, timeoutMs = 10000) {
  const appSystem = Shell.AppSystem.get_default();
  const app = appSystem.lookup_app(desktopFile);
  if (!app) throw new Error("Desktop file not found: " + desktopFile);

  const before = getWindowCount();
  log("[SharedCommands] Launching " + desktopFile + " (windows before=" + before + ")");
  app.open_new_window(-1);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(300);
    const count = getWindowCount();
    if (count > before) {
      log("[SharedCommands] Window appeared for " + desktopFile + " (windows now=" + count + ")");
      // In headless environments, the new window may not receive focus
      // automatically. Explicitly activate it so tests can interact.
      const wins = global.display.get_tab_list(
        Meta.TabList.NORMAL_ALL,
        global.display.get_workspace_manager().get_active_workspace()
      );
      for (let i = wins.length - 1; i >= 0; i--) {
        if (!wins[i].minimized) {
          wins[i].activate(global.get_current_time());
          break;
        }
      }
      // Force a render pass — first-frame tracking can lag behind map.
      try {
        getAnvilWM().renderTree("e2e-launch", true);
      } catch {
        /* extWm may not be ready for the first window yet */
      }
      await waitForGeometryStable(1800);
      return;
    }
  }
  throw new Error("No new window appeared after launching " + desktopFile);
}

/**
 * Poll until window geometries stop changing. Optionally prefers a full-tile
 * single window for a short grace period, then accepts any stable geometry.
 * @param {number} [timeoutMs=2000]
 * @returns {Promise<void>}
 */
export async function waitForGeometryStable(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  const preferFullUntil = Date.now() + Math.min(1200, timeoutMs);
  let prev = "";
  let stableCount = 0;
  try {
    getAnvilWM().renderTree("e2e-settle", true);
  } catch {
    /* ignore */
  }
  while (Date.now() < deadline) {
    const area = getMonitorWorkArea();
    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized && w.width > 0 && w.height > 0;
    });

    if (wins.length === 1 && Date.now() < preferFullUntil) {
      const w = wins[0];
      const full = w.width >= area.width * 0.8 && w.height >= area.height * 0.75;
      if (!full) {
        stableCount = 0;
        prev = "";
        await sleep(150);
        continue;
      }
    }

    const sig = wins
      .map(function (w) {
        return w.x + "," + w.y + "," + w.width + "," + w.height;
      })
      .join("|");
    if (sig && sig === prev && wins.length > 0) {
      stableCount++;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
      prev = sig;
    }
    await sleep(120);
  }
}

/**
 * Convenience: open gnome-text-editor.
 * @param {number} [timeoutMs=10000]
 */
export async function openWindow(timeoutMs = 10000) {
  return launchApp("org.gnome.Nautilus.desktop", timeoutMs);
}

/** @returns {number} non-minimized windows on the active workspace */
export function getWindowCount() {
  return getWindowGeometries().filter(function (w) {
    return !w.minimized;
  }).length;
}

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

/** @returns {string | null} */
export function getFocusedWindowTitle() {
  const w = global.display.get_focus_window();
  return w ? w.get_title() : null;
}

/** @returns {number | null} */
export function getFocusedWindowId() {
  const w = global.display.get_focus_window();
  return w ? w.get_id() : null;
}

/** @returns {{ x: number, y: number, width: number, height: number }} */
export function getMonitorWorkArea() {
  const workspace = global.display.get_workspace_manager().get_active_workspace();
  const area = workspace.get_work_area_for_monitor(0);
  return { x: area.x, y: area.y, width: area.width, height: area.height };
}

/**
 * @param {number} target
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
export async function waitForWindowCount(target, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getWindowCount() === target) return;
    await sleep(200);
  }
  throw new Error(
    "Timed out waiting for window count: expected " +
      target +
      ", got " +
      getWindowCount() +
      " after " +
      timeoutMs +
      "ms"
  );
}

/**
 * @param {(geometries: Array<{title: string | null, x: number, y: number, width: number, height: number, minimized: boolean}>) => boolean} predicate
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<Array<{title: string | null, x: number, y: number, width: number, height: number, minimized: boolean}>>}
 */
export async function waitForGeometry(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const geo = getWindowGeometries();
    if (predicate(geo)) return geo;
    await sleep(200);
  }
  throw new Error("Timed out waiting for geometry predicate after " + timeoutMs + "ms");
}

/**
 * @param {number | null} previousId
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<number | null>}
 */
export async function waitForFocusChange(previousId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = getFocusedWindowId();
    if (id !== previousId) return id;
    await sleep(200);
  }
  throw new Error(
    "Timed out waiting for focus to change from window " + previousId + " after " + timeoutMs + "ms"
  );
}

/**
 * @param {number | null} expectedId
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<number | null>}
 */
export async function waitForFocusWindow(expectedId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = getFocusedWindowId();
    if (id === expectedId) return id;
    await sleep(200);
  }
  throw new Error(
    "Timed out waiting for window " + expectedId + " to be focused after " + timeoutMs + "ms"
  );
}

/**
 * Close the currently focused window and wait for it to disappear.
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
export async function closeFocusedWindow(timeoutMs = 5000) {
  const w = global.display.get_focus_window();
  if (!w) throw new Error("No focused window to close");
  const before = getWindowCount();
  w.delete(global.display.get_current_time());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(200);
    if (getWindowCount() < before) return;
  }
  throw new Error("Timed out waiting for focused window to close after " + timeoutMs + "ms");
}

export async function closeAllWindows() {
  const ws = global.display.get_workspace_manager().get_active_workspace();
  const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, ws);
  const t = global.display.get_current_time_roundtrip();
  windows.forEach(function (w) {
    w.delete(t);
  });
  // Poll until all windows are closed
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(200);
    if (getWindowCount() === 0) return;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * @param {Array<{x: number, y: number, width: number, height: number}>} wins
 * @returns {boolean}
 */
/**
 * Axis-aligned overlap test. Uses a 2px inset so shared tile edges do not
 * count as overlap (common with gapless layouts / rounding).
 * @param {Array<{x:number,y:number,width:number,height:number}>} wins
 * @param {number} [inset=2]
 * @returns {boolean}
 */
export function windowsOverlap(wins, inset = 2) {
  for (let i = 0; i < wins.length; i++) {
    for (let j = i + 1; j < wins.length; j++) {
      const a = wins[i];
      const b = wins[j];
      if (
        a.x + inset < b.x + b.width - inset &&
        a.x + a.width - inset > b.x + inset &&
        a.y + inset < b.y + b.height - inset &&
        a.y + a.height - inset > b.y + inset
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

// ---------------------------------------------------------------------------
// Action triggers (keyboard shortcuts via wm.command)
// ---------------------------------------------------------------------------

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
  sendAnvilCommand(action);
}

/**
 * @param {{ name: string, [key: string]: any }} action
 */
export function sendAnvilCommand(action) {
  const wm = getAnvilWM();
  wm.command(action);
}

/**
 * Send a command and wait for tiling geometry to settle.
 * @param {{ name: string, [key: string]: any }} action
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<void>}
 */
export async function sendAnvilCommandAndSettle(action, timeoutMs = 3000) {
  sendAnvilCommand(action);
  await waitForGeometryStable(timeoutMs);
}

// ---------------------------------------------------------------------------
// Anvil extension internals
// ---------------------------------------------------------------------------

/** @returns {any} */
export function getAnvilWM() {
  const g = /** @type {any} */ (global);
  if (g.__anvil_extWm) return g.__anvil_extWm;

  const state = g.__anvil_test_state;
  if (state && state.extWm) return state.extWm;

  throw new Error("Anvil extWm not available");
}

/** @returns {any} */
export function getAnvilSettings() {
  const g = /** @type {any} */ (global);
  if (g.__anvil_settings) return g.__anvil_settings;

  const ext = Main.extensionManager.lookup(UUID);
  if (!ext) throw new Error("Anvil extension not found");
  const settings = /** @type {any} */ (ext).getSettings();
  if (!settings) throw new Error("Anvil extension settings not available");
  return settings;
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

/**
 * Remove runtime float overrides for a window class so toggle-based specs start
 * from a known (non-floated) state. `FloatClassToggle` is a toggle: if a prior
 * spec left a class float override, the next toggle un-floats instead of
 * floating, making the spec order-dependent. Strips overrides with no wmTitle
 * (runtime-added) matching `wmClass`; keeps user-written (wmTitle) rules.
 * @param {string} wmClass
 */
export function clearFloatOverridesForClass(wmClass) {
  try {
    const wm = getAnvilWM();
    const rules = wm._rules;
    const configMgr = wm.ext && wm.ext.configMgr;
    const props = (rules && rules.windowProps) || (configMgr && configMgr.windowProps);
    if (!props || !Array.isArray(props.overrides)) return;
    const before = props.overrides.length;
    props.overrides = props.overrides.filter(
      /** @param {{ wmClass?: string, wmTitle?: string, mode?: string }} o */ function (o) {
        return !(o.wmClass === wmClass && !o.wmTitle && o.mode === "float");
      }
    );
    if (props.overrides.length === before) return; // nothing to remove
    // Persist the removal: the configMgr.windowProps setter writes windows.json
    // back to disk so the removed override does not bleed into later runs.
    if (configMgr) configMgr.windowProps = props;
    if (rules) {
      rules.windowProps = props;
      if (typeof rules.invalidateClassificationCache === "function") {
        rules.invalidateClassificationCache();
      }
    }
  } catch (e) {
    log(
      "[SharedCommands] clearFloatOverridesForClass: " +
        (e instanceof Error ? e.message : String(e))
    );
  }
}

// ---------------------------------------------------------------------------
// Monitor constraint management
// ---------------------------------------------------------------------------

export function clearResizedWindows() {
  try {
    const wm = getAnvilWM();
    // Resize counts are owned by GrabResizeSession (architecture rule §2).
    // Clear through the owner interface, not the removed WM._resizedWindows map.
    if (wm && wm._grab && typeof wm._grab.clearResizedWindows === "function") {
      wm._grab.clearResizedWindows();
    }
  } catch (e) {
    log("[SharedCommands] clearResizedWindows: " + (e instanceof Error ? e.message : String(e)));
  }
}

export function clearMonitorConstraints() {
  try {
    const settings = /** @type {any} */ (global).__anvil_settings;
    if (!settings) return;
    const variant = new GLib.Variant("a(suubb)", []);
    settings.set_value("monitor-constraints", variant);
  } catch (e) {
    log(
      "[SharedCommands] clearMonitorConstraints: " + (e instanceof Error ? e.message : String(e))
    );
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
    log("[SharedCommands] setMonitorConstraint: " + (e instanceof Error ? e.message : String(e)));
  }
}

// ---------------------------------------------------------------------------
// Screenshot (devkit only — fails silently in --headless)
// ---------------------------------------------------------------------------

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
  } catch {
    /* screenshot may fail silently in headless */
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

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

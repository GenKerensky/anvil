/**
 * Anvil Test Agent — D-Bus service inside GNOME Shell.
 *
 * Loaded by gnome-shell --automation-script.
 * Registers org.gnome.Shell.AnvilTest so the bash test harness can call
 * extension methods directly (replaces fragile Shell.Eval calls).
 *
 * Methods:
 *   Command(s action_json)       — call extWm.command(JSON.parse(action_json))
 *   GetTestState()               — return JSON from getTestState()
 *   GetWindowGeometries()        — return JSON array of window rects
 *   CloseAllWindows()            — delete all windows on active workspace
 *   Eval(s code)                 — evaluate JS in agent scope (safe eval)
 *   Ping()                       — health check, returns "pong"
 *
 * NOTE: Uses module-level code rather than `export async function run()`
 * because only `gnome-shell --devkit` calls the `run()` function, while
 * `--headless --wayland --automation-script` only evaluates the module.
 * Module-level code works in both modes.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";
const SERVICE_NAME = "org.gnome.Shell.AnvilTest";
const OBJECT_PATH = "/org/gnome/Shell/AnvilTest";
const READY_MARKER = "/tmp/anvil-agent-ready";

const IFACE_XML = `<node>
  <interface name="org.gnome.Shell.AnvilTest">
    <method name="Command">
      <arg type="s" name="action_json" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="GetTestState">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="GetWindowGeometries">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="CloseAllWindows">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="Eval">
      <arg type="s" name="code" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="Ping">
      <arg type="s" name="result" direction="out"/>
    </method>
  </interface>
</node>`;

function waitForMain() {
  return new Promise(function (resolve) {
    function check() {
      if (Main.extensionManager) {
        resolve();
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, check);
  });
}

function ensureExtension() {
  return new Promise(function (resolve) {
    function check() {
      const ext = Main.extensionManager.lookup(UUID);

      // Check if test state is available (extWm via __anvil_test_state)
      const g = global;
      const hasTestState =
        g.__anvil_test_state !== undefined &&
        g.__anvil_test_state !== null &&
        g.__anvil_test_state.extWm !== undefined &&
        g.__anvil_test_state.extWm !== null;

      if (ext && ext.state === 1 && hasTestState) {
        log("[AnvilAgent] Extension ACTIVE with __anvil_test_state.extWm");
        resolve();
        return GLib.SOURCE_REMOVE;
      }

      if (ext && ext.state === 1 && !hasTestState) {
        log("[AnvilAgent] Extension ACTIVE but __anvil_test_state not ready — re-enabling");
        try {
          Main.extensionManager.disableExtension(UUID);
        } catch (e) {
          log("[AnvilAgent] disableExtension failed: " + e.message);
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, function () {
          try {
            Main.extensionManager.enableExtension(UUID);
          } catch (e) {
            log("[AnvilAgent] enableExtension failed: " + e.message);
          }
          return GLib.SOURCE_REMOVE;
        });
      } else if (ext && ext.state !== 1) {
        try {
          Main.extensionManager.enableExtension(UUID);
        } catch (e) {
          log("[AnvilAgent] enableExtension failed: " + e.message);
        }
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, check);
  });
}

function registerDBusService() {
  return new Promise(function (resolve, reject) {
    try {
      const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML);
      const ifaceInfo = nodeInfo.interfaces[0];

      // Use gnome-shell's existing session bus connection
      const connection = Gio.DBus.session;
      if (!connection) {
        log("[AnvilAgent] No session bus connection available");
        reject(new Error("No session bus connection"));
        return;
      }
      log("[AnvilAgent] Got session bus connection");

      // Request the well-known name
      const variant = connection.call_sync(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "RequestName",
        new GLib.Variant("(su)", [SERVICE_NAME, 4]), // 4 = DBUS_NAME_FLAG_REPLACE_EXISTING
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null
      );
      const result = variant.deep_unpack()[0];
      log("[AnvilAgent] RequestName result=" + result);

      // Register the object on the same connection
      const regId = connection.register_object(
        OBJECT_PATH,
        ifaceInfo,
        methodCallHandler,
        null,
        null
      );
      log("[AnvilAgent] register_object id=" + regId);

      if (regId === 0) {
        reject(new Error("register_object returned 0"));
        return;
      }

      log("[AnvilAgent] D-Bus service ready at " + SERVICE_NAME + OBJECT_PATH);
      resolve();
    } catch (e) {
      log("[AnvilAgent] Failed to register D-Bus service: " + e.message);
      log("[AnvilAgent] Stack: " + e.stack);
      reject(e);
    }
  });
}

function methodCallHandler(
  connection,
  sender,
  objectPath,
  ifaceName,
  methodName,
  params,
  invocation
) {
  try {
    let result;
    switch (methodName) {
      case "Ping":
        invocation.return_value(new GLib.Variant("(s)", ["pong"]));
        return;

      case "Command": {
        const [actionJson] = params.deep_unpack();
        getWm().command(JSON.parse(actionJson));
        invocation.return_value(new GLib.Variant("(s)", ["ok"]));
        return;
      }

      case "GetTestState": {
        const g = global;
        if (g.__anvil_test_state) {
          const raw = g.__anvil_test_state.getTestState();
          invocation.return_value(new GLib.Variant("(s)", [raw || "null"]));
        } else {
          invocation.return_value(new GLib.Variant("(s)", ['{"error":"test-mode not set"}']));
        }
        return;
      }

      case "GetWindowGeometries": {
        const wins = collectWindows();
        invocation.return_value(new GLib.Variant("(s)", [JSON.stringify(wins)]));
        return;
      }

      case "CloseAllWindows": {
        const workspace = global.display.get_workspace_manager().get_active_workspace();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
        windows.forEach(function (w) {
          w.delete(global.display.get_current_time());
        });
        invocation.return_value(new GLib.Variant("(s)", "ok"));
        return;
      }

      case "Eval": {
        const [code] = params.deep_unpack();
        result = String(eval(code));
        invocation.return_value(new GLib.Variant("(s)", [result]));
        return;
      }

      default:
        invocation.return_value(null);
    }
  } catch (e) {
    log("[AnvilAgent] Error in " + methodName + ": " + e.message);
    log("[AnvilAgent] Stack: " + e.stack);
    invocation.return_value(new GLib.Variant("(s)", ["error: " + e.message]));
  }
}

function getWm() {
  const ext = Main.extensionManager.lookup(UUID);
  if (ext && ext.extWm) return ext.extWm;
  const g = global;
  if (g.__anvil_test_state && g.__anvil_test_state.extWm) return g.__anvil_test_state.extWm;
  throw new Error("extWm not available");
}

function collectWindows() {
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
    };
  });
}

// ── Module-level startup (works without --devkit calling run()) ──

log("[AnvilAgent] Starting agent…");

waitForMain()
  .then(function () {
    log("[AnvilAgent] Main.extensionManager ready");

    try {
      const settings = new Gio.Settings({ schema_id: SCHEMA_ID });
      settings.set_boolean("test-mode", true);
      log("[AnvilAgent] test-mode enabled via Gio.Settings");
    } catch (e) {
      log("[AnvilAgent] Warning: could not set test-mode: " + e.message);
    }

    return ensureExtension();
  })
  .then(function () {
    log("[AnvilAgent] Extension is active");
    return registerDBusService();
  })
  .then(function () {
    GLib.file_set_contents(READY_MARKER, "ready");
    log("[AnvilAgent] Ready marker written to " + READY_MARKER);
  })
  .catch(function (err) {
    log("[AnvilAgent] Fatal error: " + (err.message || String(err)));
  });

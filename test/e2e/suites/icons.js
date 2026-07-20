/**
 * Installed-payload icon resolution in the two processes that consume icons.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

const UUID = "anvil@GenKerensky.github.com";
const SHELL_ICON_PATH = [
  "resources",
  "icons",
  "hicolor",
  "symbolic",
  "apps",
  "org.gnome.shell.extensions.anvil-symbolic.svg",
];
const SYSTEM_SHELL_ICON = "window-close-symbolic";

Gio._promisify(Gio.Subprocess.prototype, "communicate_utf8_async", "communicate_utf8_finish");

function installedExtensionRoot() {
  return GLib.build_filenamev([
    GLib.get_home_dir(),
    ".local",
    "share",
    "gnome-shell",
    "extensions",
    UUID,
  ]);
}

describe("Installed icon resolution", function () {
  it("resolves every live local preferences icon through GTK", async function () {
    const e2eDir = GLib.getenv("ANVIL_E2E_DIR");
    if (!e2eDir) throw new Error("ANVIL_E2E_DIR is not set");
    const probe = GLib.build_filenamev([e2eDir, "fixtures", "preferences-icon-smoke.js"]);
    const iconRoot = GLib.build_filenamev([installedExtensionRoot(), "resources", "icons"]);
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    const subprocess = launcher.spawnv(["gjs", "-m", probe, iconRoot]);
    const [stdout, stderr] = await subprocess.communicate_utf8_async(null, null);

    expect(subprocess.get_successful()).toBe(true, stderr);
    expect(stdout).toContain("resolved 3 packaged and 11 system preference icons");
  });

  it("resolves the live Quick Settings icon from the installed file through St", function () {
    const runtime = /** @type {any} */ (global).__anvil_runtime;
    const indicator = runtime.ext.indicator;
    expect(indicator).not.toBeNull();
    const iconPath = GLib.build_filenamev([installedExtensionRoot(), ...SHELL_ICON_PATH]);
    const panelIcon = indicator._indicator.gicon;
    const tileIcon = indicator.quickSettingsItems[0].gicon;
    expect(panelIcon.get_file().get_path()).toBe(iconPath);
    expect(tileIcon.get_file().get_path()).toBe(iconPath);
    expect(indicator._indicator.is_symbolic).toBe(true);

    const actor = St.TextureCache.get_default().load_gicon(null, panelIcon, 32, 1, 1);
    if (!actor) throw new Error(`St could not load ${iconPath}`);
    actor.destroy();

    const systemIcon = new Gio.ThemedIcon({ name: SYSTEM_SHELL_ICON });
    const systemActor = St.TextureCache.get_default().load_gicon(null, systemIcon, 32, 1, 1);
    if (!systemActor) throw new Error(`St could not resolve ${SYSTEM_SHELL_ICON}`);
    systemActor.destroy();
  });
});

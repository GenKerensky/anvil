/**
 * Installed-payload icon resolution in the two processes that consume icons.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

const UUID = "anvil@GenKerensky.github.com";
const ICON_NAME = "view-grid-symbolic";

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
    expect(stdout).toContain("resolved 6 installed preference icons");
  });

  it("resolves the live Quick Settings tile and header icon through St", function () {
    const runtime = /** @type {any} */ (global).__anvil_runtime;
    const indicator = runtime.ext.indicator;
    expect(indicator).not.toBeNull();
    expect(indicator._indicator.icon_name).toBe(ICON_NAME);
    expect(indicator.quickSettingsItems[0].icon_name).toBe(ICON_NAME);

    const themedIcon = new Gio.ThemedIcon({ name: ICON_NAME });
    const actor = St.TextureCache.get_default().load_gicon(null, themedIcon, 32, 1, 1);
    if (!actor) throw new Error(`St could not resolve ${ICON_NAME}`);
    actor.destroy();
  });
});

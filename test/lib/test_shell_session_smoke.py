"""Smoke tests for HeadlessShellSession (require gnome-shell on host)."""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from shell_session import (
    SCHEMA_ID,
    UUID,
    HeadlessShellSession,
    gnome_shell_available,
)

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DIST_DIR = PROJECT_ROOT / "dist"


def _dist_built() -> bool:
    return (DIST_DIR / "extension.js").is_file() and (
        DIST_DIR / "schemas" / "gschemas.compiled"
    ).is_file()


@unittest.skipUnless(gnome_shell_available(), "gnome-shell not available")
@unittest.skipUnless(shutil.which("gdbus"), "gdbus not available")
@unittest.skipUnless(shutil.which("gsettings"), "gsettings not available")
class HeadlessShellSessionSmokeTests(unittest.TestCase):
    def test_e2e_parity_launch_and_teardown(self) -> None:
        """PR 1a: isolate_xdg=False — dbus ready, clean teardown."""
        with tempfile.TemporaryDirectory(prefix="anvil-shell-smoke.") as tmp:
            session_dir = pathlib.Path(tmp)
            with HeadlessShellSession(
                session_dir=session_dir,
                extension_dir=DIST_DIR if _dist_built() else PROJECT_ROOT / "dist",
                isolate_xdg=False,
                enable_before_ready=False,
            ) as info:
                self.assertTrue(info.dbus_addr)
                self.assertRegex(info.wayland_display, r"^wayland-\d+$")
                self.assertGreater(info.shell_pid, 0)

    @unittest.skipUnless(_dist_built(), "dist/ not built; run make build debug")
    def test_isolated_xdg_launch(self) -> None:
        """PR 1b: launcher-style isolation, gsettings, extension enable."""
        with tempfile.TemporaryDirectory(prefix="anvil-shell-isolated.") as tmp:
            session_dir = pathlib.Path(tmp)
            with HeadlessShellSession(
                session_dir=session_dir,
                extension_dir=DIST_DIR,
                isolate_xdg=True,
                project_root=PROJECT_ROOT,
            ) as info:
                config_home = session_dir / "config"
                self.assertTrue(config_home.is_dir())
                ext_link = (
                    session_dir
                    / "data"
                    / "gnome-shell"
                    / "extensions"
                    / UUID
                )
                self.assertTrue(ext_link.is_symlink())
                self.assertEqual(
                    ext_link.resolve(),
                    DIST_DIR.resolve(),
                )
                gschemas = DIST_DIR / "schemas" / "gschemas.compiled"
                self.assertTrue(gschemas.is_file())

                env = {
                    **os.environ,
                    "DBUS_SESSION_BUS_ADDRESS": info.dbus_addr,
                    "XDG_CONFIG_HOME": str(config_home),
                    "GSETTINGS_SCHEMA_DIR": str(DIST_DIR / "schemas"),
                }
                r = subprocess.run(
                    ["gsettings", "get", SCHEMA_ID, "test-mode"],
                    env=env,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn("true", r.stdout)

                ext_info = subprocess.run(
                    [
                        "gdbus",
                        "call",
                        "--session",
                        "--dest",
                        "org.gnome.Shell",
                        "--object-path",
                        "/org/gnome/Shell",
                        "--method",
                        "org.gnome.Shell.Extensions.GetExtensionInfo",
                        UUID,
                    ],
                    env={**os.environ, "DBUS_SESSION_BUS_ADDRESS": info.dbus_addr},
                    capture_output=True,
                    text=True,
                )
                self.assertTrue(
                    "'enabled': <true>" in ext_info.stdout
                    or "<1>" in ext_info.stdout
                    or "'state': <1.0>" in ext_info.stdout,
                    ext_info.stdout,
                )


if __name__ == "__main__":
    unittest.main()
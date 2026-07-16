"""Smoke tests for HeadlessShellSession (require gnome-shell on host)."""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from shell_session import (
    SCHEMA_ID,
    UUID,
    HeadlessShellSession,
    gnome_shell_available,
)

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
HOST_SMOKE_ENABLED = os.environ.get("ANVIL_RUN_HOST_SMOKE") == "1"


def _dist_built() -> bool:
    return (DIST_DIR / "extension.js").is_file() and (
        DIST_DIR / "schemas" / "gschemas.compiled"
    ).is_file()


class HeadlessShellSessionEnvironmentTests(unittest.TestCase):
    def test_forces_wayland_when_host_environment_prefers_x11(self) -> None:
        session = HeadlessShellSession(
            session_dir=pathlib.Path("/tmp/anvil-env-test"),
            extension_dir=DIST_DIR,
            isolate_xdg=False,
            enable_before_ready=False,
        )

        with mock.patch.dict(os.environ, {"GDK_BACKEND": "x11"}):
            env = session._build_session_env("unix:path=/tmp/test-bus")

        self.assertEqual(env["GDK_BACKEND"], "wayland")

    def test_propagates_wayland_backend_to_dbus_activated_apps(self) -> None:
        session = HeadlessShellSession(
            session_dir=pathlib.Path("/tmp/anvil-env-test"),
            extension_dir=DIST_DIR,
            isolate_xdg=False,
            enable_before_ready=False,
        )
        session.display_name = "wayland-9"
        session.x11_display = ":12"

        with mock.patch("shell_session.subprocess.run") as run:
            session._update_activation_environment(
                {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/test-bus"}
            )

        command = run.call_args.args[0]
        self.assertIn("'GDK_BACKEND': 'wayland'", command[-1])

    def test_publishes_isolated_xdg_paths_before_display_discovery(self) -> None:
        session = HeadlessShellSession(
            session_dir=pathlib.Path("/tmp/anvil-env-test"),
            extension_dir=DIST_DIR,
            isolate_xdg=True,
            enable_before_ready=False,
        )

        with mock.patch("shell_session.subprocess.run") as run:
            session._update_activation_environment(
                {
                    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/test-bus",
                    "XDG_CONFIG_HOME": "/tmp/anvil-env-test/config",
                    "GSETTINGS_SCHEMA_DIR": "/tmp/anvil-env-test/schemas",
                }
            )

        serialized_env = run.call_args.args[0][-1]
        self.assertIn("'XDG_CONFIG_HOME': '/tmp/anvil-env-test/config'", serialized_env)
        self.assertIn(
            "'GSETTINGS_SCHEMA_DIR': '/tmp/anvil-env-test/schemas'",
            serialized_env,
        )
        self.assertNotIn("WAYLAND_DISPLAY", serialized_env)


@unittest.skipUnless(
    HOST_SMOKE_ENABLED,
    "host smoke is opt-in; run npm run test:tooling:host",
)
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

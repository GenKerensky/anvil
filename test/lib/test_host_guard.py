"""Unit tests for host_guard.py (no gnome-shell required)."""

from __future__ import annotations

import os
import pathlib
import tempfile
import unittest
from unittest import mock

from host_guard import (
    HostSessionError,
    assert_bus_isolated,
    assert_debug_loop_sentinel,
    assert_host_safe,
    assert_no_host_bus_without_isolation,
    assert_xdg_under_session,
    get_host_bus_fingerprint,
    is_safe_teardown_target,
)


class HostGuardTests(unittest.TestCase):
    def test_debug_loop_sentinel_required(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(HostSessionError):
                assert_debug_loop_sentinel()

        with mock.patch.dict(os.environ, {"ANVIL_DEBUG_LOOP": "1"}, clear=True):
            assert_debug_loop_sentinel()

    def test_bus_fingerprint_capture(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus"},
            clear=True,
        ):
            self.assertEqual(
                get_host_bus_fingerprint(),
                "unix:path=/run/user/1000/bus",
            )

    def test_bus_isolated_rejects_host_match(self) -> None:
        host = "unix:path=/run/user/1000/bus"
        with self.assertRaises(HostSessionError):
            assert_bus_isolated(host, host)

    def test_bus_isolated_rejects_host_socket_path(self) -> None:
        with self.assertRaises(HostSessionError):
            assert_bus_isolated(None, "unix:path=/run/user/1000/bus")

    def test_bus_isolated_accepts_temp_socket(self) -> None:
        assert_bus_isolated(
            "unix:path=/run/user/1000/bus",
            "unix:path=/tmp/dbus-abc123",
        )

    def test_xdg_prefix_under_session_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            data = session / "data"
            runtime = session / "runtime"
            data.mkdir()
            runtime.mkdir()
            assert_xdg_under_session(
                session,
                xdg_data=str(data),
                xdg_runtime=str(runtime),
            )

    def test_xdg_prefix_rejects_host_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            with self.assertRaises(HostSessionError):
                assert_xdg_under_session(session, xdg_config="/home/user/.config")

    def test_xdg_prefix_rejects_host_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            with self.assertRaises(HostSessionError):
                assert_xdg_under_session(session, xdg_runtime="/run/user/1000")

    def test_no_host_bus_allows_temp_bus_before_isolation(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/dbus-test"},
            clear=True,
        ):
            assert_no_host_bus_without_isolation(
                "unix:path=/tmp/dbus-test",
                has_isolated_daemon=False,
            )

    def test_no_host_bus_rejects_host_socket_without_isolation(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus"},
            clear=True,
        ):
            with self.assertRaises(HostSessionError):
                assert_no_host_bus_without_isolation(None, has_isolated_daemon=False)

    def test_teardown_rejects_host_bus_in_child_environ(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            with mock.patch("host_guard._read_proc_cmdline", return_value="gnome-shell --headless"):
                with mock.patch(
                    "host_guard._read_proc_environ",
                    return_value={
                        "ANVIL_ISOLATED_SESSION": "1",
                        "ANVIL_DEBUG_LOOP": "1",
                        "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
                        "XDG_RUNTIME_DIR": str(session / "runtime"),
                        "XDG_DATA_HOME": str(session / "data"),
                        "XDG_CONFIG_HOME": str(session / "config"),
                        "XDG_CACHE_HOME": str(session / "cache"),
                    },
                ):
                    with mock.patch("host_guard.os.kill", return_value=None):
                        self.assertFalse(
                            is_safe_teardown_target(
                                12345,
                                session_dir=session,
                                meta={"isolatedBusFingerprint": "unix:path=/tmp/bus"},
                                role="shell",
                            )
                        )

    def test_assert_host_safe_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            env = {
                "ANVIL_DEBUG_LOOP": "1",
                "DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/dbus-test",
            }
            with mock.patch.dict(os.environ, env, clear=True):
                result = assert_host_safe(session, require_isolated_xdg=False)
            self.assertTrue(result["hostBusBlocked"])
            self.assertEqual(result["sessionModel"], "e2e-parity")


if __name__ == "__main__":
    unittest.main()

"""Unit tests for debug_loop_utils and display-unset guardrails."""

from __future__ import annotations

import os
import pathlib
import stat
import tempfile
import unittest
from unittest import mock

from debug_loop_utils import (
    SESSION_DIR_MODE,
    ensure_private_session_dir,
    repo_relative_path,
    stage_repro_script,
    validate_script_path,
)
from host_guard import HostSessionError, assert_launch_display_unset, is_safe_teardown_target

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent


class DebugLoopUtilsTests(unittest.TestCase):
    def test_validate_script_path_accepts_examples(self) -> None:
        script = PROJECT_ROOT / "test/debug/examples/minimal-repro.js"
        if script.is_file():
            resolved = validate_script_path(script, PROJECT_ROOT)
            self.assertEqual(resolved, script.resolve())

    def test_validate_script_path_rejects_symlink(self) -> None:
        script = PROJECT_ROOT / "test/debug/examples/minimal-repro.js"
        if not script.is_file():
            self.skipTest("minimal-repro.js not present")
        with tempfile.TemporaryDirectory() as tmp:
            link = pathlib.Path(tmp) / "linked-repro.js"
            link.symlink_to(script)
            with self.assertRaises(ValueError):
                validate_script_path(link, PROJECT_ROOT)

    def test_validate_script_path_rejects_outside_debug(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as tmp:
            outside = pathlib.Path(tmp.name)
        try:
            with self.assertRaises(ValueError):
                validate_script_path(outside, PROJECT_ROOT)
        finally:
            outside.unlink(missing_ok=True)

    def test_validate_script_path_missing_file(self) -> None:
        missing = PROJECT_ROOT / "test/debug/local/does-not-exist.js"
        with self.assertRaises(FileNotFoundError):
            validate_script_path(missing, PROJECT_ROOT)

    def test_repo_relative_path(self) -> None:
        rel = repo_relative_path(PROJECT_ROOT / "test/debug/examples/minimal-repro.js", PROJECT_ROOT)
        self.assertEqual(rel, "test/debug/examples/minimal-repro.js")

    def test_ensure_private_session_dir_mode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp) / "nested" / "session"
            ensure_private_session_dir(session)
            mode = stat.S_IMODE(session.stat().st_mode)
            self.assertEqual(mode, SESSION_DIR_MODE)

    def test_stage_repro_script_creates_staged_layout(self) -> None:
        script = PROJECT_ROOT / "test/debug/examples/minimal-repro.js"
        if not script.is_file():
            self.skipTest("minimal-repro.js not present")
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            ensure_private_session_dir(session)
            staged = stage_repro_script(session, script, PROJECT_ROOT)
            self.assertEqual(staged, session / "test" / "debug" / "local" / "repro.js")
            self.assertTrue(staged.is_file())
            self.assertTrue((session / "repro.js").is_file())
            self.assertTrue((session / "test" / "lib").is_symlink())

    def test_assert_launch_display_unset_blocks_wayland(self) -> None:
        with mock.patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}, clear=True):
            with self.assertRaises(HostSessionError):
                assert_launch_display_unset()

    def test_assert_launch_display_unset_blocks_display(self) -> None:
        with mock.patch.dict(os.environ, {"DISPLAY": ":0"}, clear=True):
            with self.assertRaises(HostSessionError):
                assert_launch_display_unset()


class TeardownPidValidationTests(unittest.TestCase):
    def test_invalid_pid_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            self.assertFalse(
                is_safe_teardown_target(
                    0,
                    session_dir=session,
                    meta={"isolatedBusFingerprint": "unix:path=/tmp/bus"},
                    role="shell",
                )
            )

    def test_missing_process_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session = pathlib.Path(tmp)
            self.assertFalse(
                is_safe_teardown_target(
                    999999999,
                    session_dir=session,
                    meta={"isolatedBusFingerprint": "unix:path=/tmp/bus"},
                    role="shell",
                )
            )


if __name__ == "__main__":
    unittest.main()
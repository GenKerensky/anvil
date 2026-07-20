import json
import os
import pathlib
import tempfile
import threading
import unittest
from unittest import mock

from runner_utils import start_dbus_session, wait_for_results


class _ExitedProcess:
    def poll(self) -> int:
        return 0


class DbusSessionTests(unittest.TestCase):
    def test_starts_tracked_daemon_without_host_session_environment(self) -> None:
        process = mock.Mock()
        process.stdout.readline.return_value = "unix:path=/tmp/dbus-test\n"
        host_env = {
            "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
            "WAYLAND_DISPLAY": "wayland-0",
            "DISPLAY": ":0",
            "XDG_RUNTIME_DIR": "/tmp/anvil-runtime",
        }

        with mock.patch("runner_utils.subprocess.Popen", return_value=process) as popen:
            returned_process, address = start_dbus_session(env=host_env)

        command = popen.call_args.args[0]
        daemon_env = popen.call_args.kwargs["env"]
        self.assertIn("--nofork", command)
        self.assertNotIn("--fork", command)
        self.assertNotIn("DBUS_SESSION_BUS_ADDRESS", daemon_env)
        self.assertNotIn("WAYLAND_DISPLAY", daemon_env)
        self.assertNotIn("DISPLAY", daemon_env)
        self.assertEqual(daemon_env["XDG_RUNTIME_DIR"], "/tmp/anvil-runtime")
        self.assertIs(returned_process, process)
        self.assertEqual(address, "unix:path=/tmp/dbus-test")

    def test_returned_process_owns_the_live_daemon(self) -> None:
        process, _address = start_dbus_session(env={**os.environ})
        try:
            self.assertIsNone(process.poll(), "dbus-daemon forked away from its Popen owner")
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=2)
            if process.stdout is not None:
                process.stdout.close()

        self.assertIsNotNone(process.returncode)


class WaitForResultsTests(unittest.TestCase):
    def test_accepts_result_that_becomes_visible_just_after_process_exit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result_path = pathlib.Path(directory) / "results.json"
            expected = {"totalPassed": 1, "totalFailed": 0, "results": []}
            writer = threading.Timer(0.05, result_path.write_text, args=(json.dumps(expected),))
            writer.start()
            try:
                self.assertEqual(
                    wait_for_results(result_path, timeout=1.0, watched_process=_ExitedProcess()),
                    expected,
                )
            finally:
                writer.cancel()
                writer.join()


if __name__ == "__main__":
    unittest.main()

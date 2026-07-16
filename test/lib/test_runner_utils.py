import json
import pathlib
import tempfile
import threading
import unittest

from runner_utils import wait_for_results


class _ExitedProcess:
    def poll(self) -> int:
        return 0


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

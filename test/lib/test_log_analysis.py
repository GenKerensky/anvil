"""Unit tests for log_analysis.py."""

from __future__ import annotations

import pathlib
import tempfile
import unittest

from log_analysis import (
    SIGNATURE_HINTS,
    analyze_log,
    build_excerpt,
    classify_signature,
    line_matches_anvil,
    parse_log_lines,
    write_excerpt_snip,
)
from runner_utils import parse_repro_results


class LogAnalysisTests(unittest.TestCase):
    SAMPLE = """\
[Anvil] [DEBUG] boot
[Anvil] [WARN] resize clamp applied
[Anvil] [ERROR] resize failed for window 42
_resizedWindows size=1
JS ERROR: test failure
backtrace-warnings: stack here
"""

    def test_line_matches_anvil(self) -> None:
        self.assertTrue(line_matches_anvil("[Anvil] [ERROR] boom"))
        self.assertFalse(line_matches_anvil("unrelated log line"))

    def test_parse_log_lines_counts(self) -> None:
        stats = parse_log_lines(self.SAMPLE.splitlines())
        self.assertEqual(stats.total_lines, 6)
        self.assertGreaterEqual(stats.anvil_lines, 3)
        self.assertGreaterEqual(stats.errors, 1)

    def test_classify_resize_signature(self) -> None:
        sig, matched, markers = classify_signature(self.SAMPLE)
        self.assertEqual(sig, "resize-clamp")
        self.assertTrue(matched)
        self.assertIn("backtrace-warnings", markers)

    def test_signature_hints_populated(self) -> None:
        self.assertIn("resize-clamp", SIGNATURE_HINTS)
        self.assertTrue(SIGNATURE_HINTS["resize-clamp"])

    def test_analyze_log_and_write_snip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log = pathlib.Path(tmp) / "gnome-shell.log"
            snip = pathlib.Path(tmp) / "iteration-001.log.snip"
            log.write_text(self.SAMPLE, encoding="utf-8")
            analysis = write_excerpt_snip(log, snip)
            self.assertEqual(analysis.signature, "resize-clamp")
            self.assertTrue(snip.is_file())
            self.assertIn("[Anvil]", snip.read_text(encoding="utf-8"))

    def test_build_excerpt_includes_stacks(self) -> None:
        excerpt = build_excerpt(self.SAMPLE.splitlines())
        joined = "\n".join(excerpt)
        self.assertIn("JS ERROR", joined)

    def test_analyze_missing_log(self) -> None:
        analysis = analyze_log(pathlib.Path("/nonexistent/gnome-shell.log"))
        self.assertIsNone(analysis.signature)
        self.assertEqual(analysis.stats.total_lines, 0)

    def test_parse_repro_results_debug_loop_v1(self) -> None:
        passed, msg = parse_repro_results({"passed": True, "message": "ok"})
        self.assertTrue(passed)
        self.assertEqual(msg, "ok")

    def test_parse_repro_results_jasmine_fallback(self) -> None:
        passed, msg = parse_repro_results({"totalPassed": 5, "totalFailed": 0})
        self.assertTrue(passed)
        self.assertIn("Jasmine", msg)


if __name__ == "__main__":
    unittest.main()
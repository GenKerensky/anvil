"""Regression tests for fresh installed-extension payload replacement."""

from __future__ import annotations

import pathlib
import subprocess
import tempfile
import unittest


PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
INSTALL_SCRIPT = PROJECT_ROOT / "scripts" / "install-extension.sh"
MAKEFILE = PROJECT_ROOT / "Makefile"
E2E_RUNNER = PROJECT_ROOT / "test" / "e2e" / "run.py"
UUID = "anvil@GenKerensky.github.com"


class InstallExtensionTests(unittest.TestCase):
    def test_replaces_payload_without_touching_user_configuration(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-install-test.") as tmp:
            root = pathlib.Path(tmp)
            source = root / "dist"
            destination = root / ".local" / "share" / "gnome-shell" / "extensions" / UUID
            user_config = root / ".config" / "anvil" / "stylesheet" / "anvil" / "stylesheet.css"

            (source / "resources").mkdir(parents=True)
            (source / "extension.js").write_text("fresh extension\n", encoding="utf-8")
            (source / "resources" / "fresh.svg").write_text("<svg/>\n", encoding="utf-8")

            (destination / "resources").mkdir(parents=True)
            (destination / "removed.js").write_text("stale payload\n", encoding="utf-8")
            (destination / "resources" / "removed.svg").write_text("<svg/>\n", encoding="utf-8")

            user_config.parent.mkdir(parents=True)
            user_config.write_text("user stylesheet\n", encoding="utf-8")

            subprocess.run(
                ["bash", str(INSTALL_SCRIPT), str(source), str(destination)],
                cwd=PROJECT_ROOT,
                check=True,
            )

            self.assertEqual(
                (destination / "extension.js").read_text(encoding="utf-8"),
                "fresh extension\n",
            )
            self.assertTrue((destination / "resources" / "fresh.svg").is_file())
            self.assertFalse((destination / "removed.js").exists())
            self.assertFalse((destination / "resources" / "removed.svg").exists())
            self.assertEqual(user_config.read_text(encoding="utf-8"), "user stylesheet\n")

    def test_missing_source_leaves_existing_payload_untouched(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-install-test.") as tmp:
            root = pathlib.Path(tmp)
            missing_source = root / "missing-dist"
            destination = root / "installed" / UUID
            destination.mkdir(parents=True)
            sentinel = destination / "extension.js"
            sentinel.write_text("existing extension\n", encoding="utf-8")

            result = subprocess.run(
                ["bash", str(INSTALL_SCRIPT), str(missing_source), str(destination)],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("install source is not a directory", result.stderr)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "existing extension\n")

    def test_refuses_an_unexpected_destination_basename(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-install-test.") as tmp:
            root = pathlib.Path(tmp)
            source = root / "dist"
            destination = root / "unrelated-directory"
            source.mkdir()
            (source / "extension.js").write_text("fresh extension\n", encoding="utf-8")
            destination.mkdir()
            sentinel = destination / "keep.txt"
            sentinel.write_text("keep\n", encoding="utf-8")

            result = subprocess.run(
                ["bash", str(INSTALL_SCRIPT), str(source), str(destination)],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unexpected basename", result.stderr)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep\n")

    def test_make_install_uses_fresh_payload_installer(self) -> None:
        makefile = MAKEFILE.read_text(encoding="utf-8")

        self.assertIn(
            'install: build\n\tbash scripts/install-extension.sh dist "$(INSTALL_PATH)"',
            makefile,
        )

    def test_e2e_install_uses_fresh_payload_installer(self) -> None:
        runner = E2E_RUNNER.read_text(encoding="utf-8")

        self.assertIn(
            '["bash", str(INSTALL_SCRIPT), str(staged_payload), str(ext_dir)]',
            runner,
        )


if __name__ == "__main__":
    unittest.main()

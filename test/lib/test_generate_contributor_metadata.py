"""Tests for the shared contributor metadata generator."""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
import unittest


PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
GENERATOR = PROJECT_ROOT / "scripts" / "generate-contributor-metadata.mjs"
MAKEFILE = PROJECT_ROOT / "Makefile"
QUICK_BUILD = (
    PROJECT_ROOT
    / ".agents"
    / "skills"
    / "gnome-shell-debug"
    / "scripts"
    / "quick-debug-build.sh"
)


class ContributorMetadataTests(unittest.TestCase):
    def _git(self, repository: pathlib.Path, *args: str, env: dict[str, str] | None = None) -> None:
        subprocess.run(
            ["git", "-C", str(repository), *args],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )

    def _commit(self, repository: pathlib.Path, name: str, email: str, message: str) -> None:
        marker = repository / "history.txt"
        with marker.open("a", encoding="utf-8") as stream:
            stream.write(f"{message}\n")
        self._git(repository, "add", "history.txt")
        env = os.environ.copy()
        env.update(
            {
                "GIT_AUTHOR_NAME": name,
                "GIT_AUTHOR_EMAIL": email,
                "GIT_COMMITTER_NAME": name,
                "GIT_COMMITTER_EMAIL": email,
            }
        )
        self._git(repository, "commit", "-m", message, env=env)

    def test_generates_filtered_deduplicated_module_outside_repository(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-metadata-test.") as tmp:
            root = pathlib.Path(tmp)
            repository = root / "repository"
            repository.mkdir()
            self._git(repository, "init", "--quiet")
            self._commit(repository, "Alice", "alice@example.com", "alice one")
            self._commit(repository, "Alice", "alice@example.com", "alice two")
            self._commit(repository, "Alicia", "alice@example.com", "same email")
            self._commit(repository, "dependabot[bot]", "bot@example.com", "dependency")
            self._commit(repository, "GitHub", "123+noreply@github.com", "noreply")

            output = root / "generated" / "metadata.mjs"
            subprocess.run(
                [
                    "node",
                    str(GENERATOR),
                    "--repository",
                    str(repository),
                    "--output",
                    str(output),
                ],
                cwd=root,
                check=True,
            )

            generated = output.read_text(encoding="utf-8")
            self.assertEqual(generated.count("alice@example.com"), 1)
            self.assertIn("Alice <alice@example.com>", generated)
            self.assertNotIn("Alicia", generated)
            self.assertNotIn("dependabot", generated.lower())
            self.assertNotIn("noreply", generated.lower())

            imported = subprocess.run(
                [
                    "node",
                    "--input-type=module",
                    "--eval",
                    f"import({output.as_uri()!r}).then(m => console.log(JSON.stringify(m.developers)))",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(imported.stdout.strip(), '["Alice <alice@example.com>"]')

    def test_empty_history_still_generates_a_valid_module(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-metadata-empty.") as tmp:
            root = pathlib.Path(tmp)
            repository = root / "repository"
            repository.mkdir()
            self._git(repository, "init", "--quiet")
            output = root / "metadata.mjs"

            subprocess.run(
                [
                    "node",
                    str(GENERATOR),
                    "--repository",
                    str(repository),
                    "--output",
                    str(output),
                ],
                cwd=root,
                check=True,
            )

            self.assertEqual(output.read_text(encoding="utf-8"), "export const developers = [];\n")
            subprocess.run(["node", "--check", str(output)], check=True)

    def test_generation_is_byte_reproducible(self) -> None:
        with tempfile.TemporaryDirectory(prefix="anvil-metadata-reproducible.") as tmp:
            root = pathlib.Path(tmp)
            repository = root / "repository"
            repository.mkdir()
            self._git(repository, "init", "--quiet")
            self._commit(repository, "Alice", "alice@example.com", "initial history")

            outputs = [root / "normal.mjs", root / "quick.mjs"]
            for output in outputs:
                subprocess.run(
                    [
                        "node",
                        str(GENERATOR),
                        "--repository",
                        str(repository),
                        "--output",
                        str(output),
                    ],
                    cwd=root,
                    check=True,
                )

            self.assertEqual(outputs[0].read_bytes(), outputs[1].read_bytes())

    def test_make_and_quick_build_use_the_shared_generator(self) -> None:
        generator_command = "node scripts/generate-contributor-metadata.mjs"
        self.assertIn(generator_command, MAKEFILE.read_text(encoding="utf-8"))
        quick_build = QUICK_BUILD.read_text(encoding="utf-8")
        self.assertIn(generator_command, quick_build)
        self.assertIn('$INSTALL_DIR/schemas/gschemas.compiled', quick_build)
        self.assertNotRegex(quick_build, r"(?m)^[ \t]*glib-compile-schemas\b")


if __name__ == "__main__":
    unittest.main()

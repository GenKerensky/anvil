"""Shared helpers for the agent debug loop orchestrator."""

from __future__ import annotations

import pathlib
import shutil

DEBUG_SCRIPT_ROOT_NAME = "test/debug"
SESSION_DIR_MODE = 0o700


def validate_script_path(script: pathlib.Path, project_root: pathlib.Path) -> pathlib.Path:
    """Require repro scripts under test/debug/; reject symlinks."""
    debug_root = (project_root / DEBUG_SCRIPT_ROOT_NAME).resolve()
    if script.is_symlink():
        raise ValueError(f"Repro script must not be a symlink: {script}")
    resolved = script.resolve()
    if resolved.is_symlink():
        raise ValueError(f"Repro script must not be a symlink: {resolved}")
    try:
        resolved.relative_to(debug_root)
    except ValueError as exc:
        raise ValueError(
            f"Repro script must live under {debug_root}; got {resolved}"
        ) from exc
    if not resolved.is_file():
        raise FileNotFoundError(f"Repro script not found: {resolved}")
    return resolved


def ensure_private_session_dir(session_dir: pathlib.Path) -> None:
    """Create or reuse a session directory with owner-only permissions."""
    session_dir.mkdir(parents=True, exist_ok=True, mode=SESSION_DIR_MODE)
    session_dir.chmod(SESSION_DIR_MODE)


def stage_repro_script(session_dir: pathlib.Path, source: pathlib.Path, project_root: pathlib.Path) -> pathlib.Path:
    """
    Copy repro into the session and return the staged automation-script path.

    Mirrors ``test/debug/local/repro.js`` under session_dir so ESM imports resolve
    via a session-local ``test/lib`` symlink (avoids TOCTOU on the source path).
    """
    staged = session_dir / "test" / "debug" / "local" / "repro.js"
    staged.parent.mkdir(parents=True, exist_ok=True, mode=SESSION_DIR_MODE)
    lib_link = session_dir / "test" / "lib"
    if not lib_link.exists():
        lib_link.symlink_to((project_root / "test" / "lib").resolve())
    shutil.copyfile(source, staged)
    shutil.copyfile(source, session_dir / "repro.js")
    return staged


def repo_relative_path(path: pathlib.Path, project_root: pathlib.Path) -> str:
    """Return repo-relative path when possible, else absolute."""
    try:
        return str(path.resolve().relative_to(project_root.resolve()))
    except ValueError:
        return str(path.resolve())
"""
runner_utils.py — Shared utilities for Anvil test orchestrators.

Used by:
  test/e2e/run.py          — host headless (gnome-shell --headless --virtual-monitor)
  test/lib/shell_session.py / agent debug loop

What lives here
===============
- ANSI colour helpers (_info, _pass, _fail)
- dbusmock stub launchers (start_dbus_session, start_mocks)
- Results file polling (wait_for_results)
- Results display (print_results)

What does NOT live here
========================
- Session-specific lifecycle (DevkitSession / HeadlessShellSession)
- Display discovery / stderr threading
- Extension build / install (each runner owns its own strategy)
- Path constants (callers define UUID, PROJECT_ROOT, OUTPUT_DIR)

The dbusmock stubs need the same five services before gnome-shell will start
cleanly. The SessionManager template requires a Setenv method; the others just
need their bus names to exist.
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

# ── ANSI colours ──────────────────────────────────────────────────────────────

RED, GREEN, YELLOW, RESET = "\033[0;31m", "\033[0;32m", "\033[1;33m", "\033[0m"


def _info(msg: str) -> None:
    print(f"  {YELLOW}→{RESET} {msg}", flush=True)


def _pass(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}", flush=True)


def _fail(msg: str) -> None:
    print(f"  {RED}✗{RESET} {msg}", flush=True)


# ── SessionManager dbusmock template ──────────────────────────────────────────

# gnome-shell calls Setenv("WAYLAND_DISPLAY", ...) on startup; without it the
# shell emits a steady stream of warnings that bury real errors.
_SESSIONMANAGER_TEMPLATE = '''
"""Minimal org.gnome.SessionManager stub."""
import dbusmock

BUS_NAME = "org.gnome.SessionManager"
MAIN_OBJ = "/org/gnome/SessionManager"
MAIN_IFACE = "org.gnome.SessionManager"
SYSTEM_BUS = False


def load(mock, parameters):
    mock.AddMethods(
        MAIN_IFACE,
        [
            ("Setenv", "ss", "", ""),
            ("RegisterClient", "ss", "o", \'ret = "/org/gnome/SessionManager/Client0"\'),
            ("UnregisterClient", "o", "", ""),
            ("IsSessionRunning", "", "b", "ret = True"),
        ],
    )
'''


# ── D-Bus session ──────────────────────────────────────────────────────────────


def start_dbus_session() -> tuple[subprocess.Popen, str]:
    """
    Launch ``dbus-daemon --session --print-address --fork``.

    Returns ``(process, address_string)``.  The address is read synchronously
    from stdout — this is what avoids the bash ``dbus-run-session`` shell-game.
    """
    proc = subprocess.Popen(
        ["/usr/bin/dbus-daemon", "--session", "--print-address", "--fork"],
        stdout=subprocess.PIPE,
        text=True,
    )
    addr = proc.stdout.readline().strip()  # type: ignore[union-attr]
    if not addr:
        raise RuntimeError("dbus-daemon did not print an address")
    return proc, addr


# ── dbusmock stubs ────────────────────────────────────────────────────────────


def start_mocks(dbus_addr: str) -> list[subprocess.Popen]:
    """
    Spawn ``python3 -m dbusmock`` subprocesses for every D-Bus service that
    gnome-shell requires at startup.  They inherit ``DBUS_SESSION_BUS_ADDRESS``
    so they auto-register on the isolated bus.

    All five services must be up before gnome-shell is launched.
    """
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
    procs: list[subprocess.Popen] = []
    python = sys.executable

    # Generic stubs — gnome-shell only needs the bus names to exist.
    stubs = [
        ("org.freedesktop.UPower",         "/org/freedesktop/UPower",         "org.freedesktop.UPower"),
        ("org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager", "org.freedesktop.NetworkManager"),
        ("net.hadess.PowerProfiles",       "/net/hadess/PowerProfiles",       "net.hadess.PowerProfiles"),
        ("org.freedesktop.Accounts",       "/org/freedesktop/Accounts",       "org.freedesktop.Accounts"),
    ]
    for name, path, iface in stubs:
        procs.append(
            subprocess.Popen([python, "-m", "dbusmock", name, path, iface], env=env)
        )

    # SessionManager needs a Setenv method — use a custom template.
    sm_template = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False)
    sm_template.write(_SESSIONMANAGER_TEMPLATE)
    sm_template.close()
    procs.append(
        subprocess.Popen(
            [python, "-m", "dbusmock", "--template", sm_template.name],
            env=env,
        )
    )

    # Give the stubs time to claim their bus names before gnome-shell starts.
    time.sleep(1.5)
    return procs


# ── Shell D-Bus readiness poll ────────────────────────────────────────────────


def wait_for_shell_dbus(dbus_addr: str, timeout: float = 40.0) -> None:
    """
    Poll until ``org.gnome.Shell`` appears on the given session bus.

    Used by both runners: the devkit runner polls its private dbus-daemon;
    the container runner polls the fixed container bus.
    """
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.NameHasOwner",
                "org.gnome.Shell",
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        if "(true,)" in r.stdout:
            _pass("GNOME Shell D-Bus ready")
            return
        time.sleep(1)
    raise TimeoutError(f"org.gnome.Shell did not appear on D-Bus within {timeout}s")


# ── Results file polling ──────────────────────────────────────────────────────


def wait_for_results(
    results_path: pathlib.Path,
    timeout: float = 600.0,
    watched_process: subprocess.Popen | None = None,
) -> dict:
    """
    Poll until the JS test runner writes a results JSON file at ``results_path``.

    Deletes the file after reading so re-runs start clean.
    """
    deadline = time.monotonic() + timeout
    process_exit_deadline: float | None = None
    while time.monotonic() < deadline:
        if results_path.is_file():
            try:
                with results_path.open() as f:
                    data = json.load(f)
                # Preserve a copy for post-run diagnosis before unlinking.
                try:
                    import pathlib as _p, tempfile as _tf
                    _cp = _p.Path(_tf.gettempdir()) / "anvil-e2e-results-last.json"
                    _cp.write_text(json.dumps(data, indent=2))
                except Exception:
                    pass
                results_path.unlink()
                return data
            except (json.JSONDecodeError, OSError):
                pass
        if watched_process is not None:
            return_code = watched_process.poll()
            if return_code is not None:
                # The automation script writes immediately before the headless
                # Shell exits. Give the filesystem a short visibility/read
                # grace instead of racing the process-status observation.
                process_exit_deadline = process_exit_deadline or (time.monotonic() + 1.0)
                if time.monotonic() >= process_exit_deadline:
                    raise RuntimeError(
                        "GNOME Shell exited before writing E2E results "
                        f"(status {return_code})"
                    )
                time.sleep(0.05)
                continue
        time.sleep(0.5)
    raise TimeoutError(f"Results file {results_path} did not appear within {timeout}s")


# ── Results display ───────────────────────────────────────────────────────────


def print_results(results: dict, title: str = "Anvil Test Results") -> int:
    """
    Pretty-print a coloured pass/fail summary.

    Accepts the JSON schema written by both JS runners:
    ``{ "results": [...suites...], "totalPassed": N, "totalFailed": N,
        "fatalError": null|str, "timestamp": str }``

    Each suite: ``{ "name": str, "tests": [...], "passed": N, "failed": N }``
    Each test:  ``{ "name": str, "passed": bool, "pending": bool, "error": str|null }``

    Returns 0 if all tests passed, 1 otherwise.
    """
    total_passed = results.get("totalPassed", 0)
    total_failed = results.get("totalFailed", 0)
    fatal = results.get("fatalError")

    print("")
    print("═" * 50)
    print(f"  {title}")
    print("═" * 50)

    if fatal:
        _fail(f"Fatal error: {fatal}")
        print("═" * 50)
        return 1

    for suite in results.get("results", []):
        suite_passed = suite.get("passed", 0)
        suite_failed = suite.get("failed", 0)
        if suite_failed:
            print(f"\n  {RED}✗{RESET} {suite['name']} ({suite_passed} passed, {suite_failed} failed)")
        else:
            print(f"\n  {GREEN}✓{RESET} {suite['name']} ({suite_passed} passed)")

        for test in suite.get("tests", []):
            if test.get("pending"):
                print(f"    {YELLOW}-{RESET} {test['name']} (pending)")
            elif test.get("passed"):
                print(f"    {GREEN}✓{RESET} {test['name']}")
            else:
                print(f"    {RED}✗{RESET} {test['name']}")
                if test.get("error"):
                    for line in test["error"].splitlines():
                        print(f"      {line}")

    print("")
    print("═" * 50)
    print(f"  Total:  {total_passed + total_failed}")
    print(f"  Passed: {GREEN}{total_passed}{RESET}")
    print(f"  Failed: {RED}{total_failed}{RESET}")
    print("═" * 50)
    print("")

    return 0 if total_failed == 0 else 1


# ── Debug-loop repro results ───────────────────────────────────────────────────


def parse_repro_results(data: dict) -> tuple[bool, str]:
    """Return (passed, message). Supports debug-loop-v1 and Jasmine fallback."""

    if "passed" in data:
        return bool(data["passed"]), str(data.get("message", ""))

    if "totalFailed" in data:
        failed = int(data.get("totalFailed", 1))
        return failed == 0, f"Jasmine: {data.get('totalPassed', 0)} passed, {failed} failed"

    return False, "Unrecognized results schema"

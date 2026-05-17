#!/usr/bin/env python3
"""
Anvil Devkit E2E Test Runner  (replaces run.sh + start-session.sh)

Architecture (read this first)
==============================

We need to start a *nested* GNOME Shell compositor (devkit mode) and run
Behave BDD tests inside it.  The dependency chain looks like this:

    run.py
      │
      ├─► dbus-daemon --session --print-address     (isolated D-Bus)
      │     │
      │     ├─► dbusmock stubs (UPower, NM, SessionManager …)
      │     │       └─ must register BEFORE gnome-shell starts
      │     │
      │     └─► gnome-shell --wayland --devkit
      │           │
      │           ├─ announces: "Using Wayland display name 'wayland-1'"
      │           │       └─ we PARSE this from stderr in real time
      │           │
      │           └─ creates socket /run/user/1000/wayland-1
      │                   └─ must exist before wtype/gtk-launch work
      │
      ├─► install + enable Anvil extension
      │
      └─► behave  (reads DBUS_SESSION_BUS_ADDRESS + WAYLAND_DISPLAY env)

Why Python instead of Bash?
===========================
Bash has only two concurrency primitives:  "&" (fire-and-forget background job)
and "sleep" (blind wait).  We need to:

  1. Start gnome-shell
  2. Read its stderr *simultaneously* to discover the Wayland socket name
  3. Poll for the socket file to appear
  4. Poll for the D-Bus service to respond

Python's subprocess + threading gives us exact sequencing without race
conditions.

Concurrency model (for Node / C# readers)
=========================================

Python's ``threading`` module is conceptually identical to C# ``System.Threading``:

  ``threading.Thread(target=fn, daemon=True)``  ==  ``new Thread(fn) { IsBackground = true }``
  ``threading.Event()``                         ==  ``ManualResetEventSlim``
  ``event.set()``                               ==  ``event.Set()``
  ``event.wait(timeout=30)``                  ==  ``event.Wait(TimeSpan.FromSeconds(30))``

There is NO event loop / async-await in this file.  We use plain OS threads
and blocking I/O because the problem is simple: start a process, read its
stderr in a background thread, signal the main thread when we see the magic
string.

Dict merging for environment variables
========================================

In Python ``{**a, **b}`` is equivalent to JS ``{...a, ...b}`` or C# LINQ
``a.Concat(b).ToDictionary(...)``.  We use it to inject ``DBUS_SESSION_BUS_ADDRESS``
into every subprocess's environment without mutating the global ``os.environ``.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

# ── Configuration ──────────────────────────────────────────────────────

UUID = "anvil@GenKerensky.github.com"
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
E2E_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = E2E_DIR / "output"



# SessionManager needs a Setenv method or gnome-shell spams warnings.
# We write a tiny dbusmock template file and load it.
SESSIONMANAGER_TEMPLATE = '''
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
            ("Setenv", "ss", "", ""),          # gnome-shell calls this for WAYLAND_DISPLAY
            ("RegisterClient", "ss", "o", 'ret = "/org/gnome/SessionManager/Client0"'),
            ("UnregisterClient", "o", "", ""),
            ("IsSessionRunning", "", "b", "ret = True"),
        ],
    )
'''

# ANSI colour helpers (same idea as chalk or ConsoleColor in C#)
RED, GREEN, YELLOW, RESET = "\033[0;31m", "\033[0;32m", "\033[1;33m", "\033[0m"


def _info(msg: str) -> None:
    print(f"  {YELLOW}→{RESET} {msg}", flush=True)


def _pass(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}", flush=True)


def _fail(msg: str) -> None:
    print(f"  {RED}✗{RESET} {msg}", flush=True)


# ── Step 2: Build extension ────────────────────────────────────────────

def build_extension() -> None:
    """Run ``make dist`` from the project root."""
    _info("Building extension…")
    subprocess.run(["make", "-C", str(PROJECT_ROOT), "dist"], check=True)


# ── Step 3: Start isolated D-Bus session ───────────────────────────────

def start_dbus_session() -> tuple[subprocess.Popen, str]:
    """
    Launch ``dbus-daemon --session --print-address --fork``.

    Returns ``(process, address_string)``.  The address is read synchronously
    from stdout (line 1) — this is the trick that avoids the bash
    ``dbus-run-session`` shell-game.
    """
    proc = subprocess.Popen(
        ["/usr/bin/dbus-daemon", "--session", "--print-address", "--fork"],
        stdout=subprocess.PIPE,
        text=True,
    )
    # Read the first line of stdout — this is the D-Bus address.
    # ``readline()`` blocks until the daemon prints it (guaranteed by --print-address).
    addr = proc.stdout.readline().strip()  # type: ignore[arg-type]
    if not addr:
        raise RuntimeError("dbus-daemon did not print an address")
    return proc, addr


# ── Step 4: Start dbusmock stubs ───────────────────────────────────────

def start_mocks(dbus_addr: str) -> list[subprocess.Popen]:
    """
    Spawn ``python3 -m dbusmock`` subprocesses for every service gnome-shell
    expects.  They inherit ``DBUS_SESSION_BUS_ADDRESS`` so they auto-register
    on our isolated bus.
    """
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
    procs: list[subprocess.Popen] = []
    python = "/usr/bin/python3"

    # Generic dbusmock stubs — gnome-shell only needs the bus names to exist.
    # Using --template is unnecessary and can trigger policy errors.
    stubs = [
        ("org.freedesktop.UPower",          "/org/freedesktop/UPower",          "org.freedesktop.UPower"),
        ("org.freedesktop.NetworkManager",  "/org/freedesktop/NetworkManager",  "org.freedesktop.NetworkManager"),
        ("net.hadess.PowerProfiles",        "/net/hadess/PowerProfiles",        "net.hadess.PowerProfiles"),
        ("org.freedesktop.Accounts",        "/org/freedesktop/Accounts",        "org.freedesktop.Accounts"),
    ]
    for name, path, iface in stubs:
        procs.append(
            subprocess.Popen([python, "-m", "dbusmock", name, path, iface], env=env)
        )

    # SessionManager needs a Setenv method or gnome-shell spams warnings.
    # We use a custom template file (bus name/path/interface are inside the template).
    sm_template = tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False)
    sm_template.write(SESSIONMANAGER_TEMPLATE)
    sm_template.close()
    procs.append(
        subprocess.Popen(
            [python, "-m", "dbusmock", "--template", sm_template.name],
            env=env,
        )
    )

    # Give the stubs time to claim their bus names (same idea as Task.Delay in C#)
    time.sleep(1.5)
    return procs


# ── Step 5: Start gnome-shell devkit ───────────────────────────────────

def start_gnome_shell(
    dbus_addr: str,
    automation_script: pathlib.Path,
    extra_env: dict[str, str] | None = None,
) -> subprocess.Popen:
    """
    Launch ``gnome-shell --wayland --devkit --automation-script <path>``
    inside the isolated session.

    We pipe stderr so a background thread can scan it for the Wayland display
    name announcement.
    """
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
    # Point GSettings to the extension's schemas so the automation script
    # can create a Gio.Settings for the extension's schema ID.
    ext_schemas = str(pathlib.Path.home() /
        ".local/share/gnome-shell/extensions" / UUID / "schemas")
    if pathlib.Path(ext_schemas).is_dir():
        env["GSETTINGS_SCHEMA_DIR"] = ext_schemas
    # Suppress the GNOME welcome tour so it doesn't steal focus
    env.pop("WAYLAND_DISPLAY", None)  # let gnome-shell pick its own
    if extra_env:
        env |= extra_env

    return subprocess.Popen(
        [
            "/usr/bin/gnome-shell",
            "--wayland",
            "--devkit",
            "--automation-script",
            str(automation_script),
        ],
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def discover_displays(shell_proc: subprocess.Popen, timeout: float = 30.0) -> tuple[str, str]:
    """
    Read gnome-shell's stderr in a background thread until we see both lines:

        Using Wayland display name 'wayland-N'
        Using public X11 display :M

    Returns (wayland_display_name, x11_display_name)  e.g. ("wayland-1", ":2").

    Background-thread pattern (C# equivalent):
        var displayReady = new ManualResetEventSlim();
        string displayName = null;
        new Thread(() => { … displayReady.Set(); }) { IsBackground = true }.Start();
        if (!displayReady.Wait(TimeSpan.FromSeconds(30))) throw …;
    """
    display_ready = threading.Event()
    display_name: str | None = None
    x11_display: str | None = None

    def _tail_stderr() -> None:
        nonlocal display_name, x11_display
        # ``shell_proc.stderr`` is a file-like object (TextIOWrapper).
        # Iterating yields one line at a time, blocking until the next line arrives.
        for line in shell_proc.stderr:  # type: ignore[union-attr]
            sys.stderr.write(line)        # passthrough so we still see logs
            sys.stderr.flush()
            m = re.search(r"Using Wayland display name '(wayland-\d+)'", line)
            if m:
                display_name = m.group(1)
            m2 = re.search(r"Using public X11 display (:\d+)", line)
            if m2:
                x11_display = m2.group(1)
            if display_name and x11_display:
                display_ready.set()
                # CRITICAL: keep reading stderr so the pipe buffer doesn't fill
                # up and block gnome-shell.  Just discard after the signal.

    # daemon=True == IsBackground = true in C#; thread dies with main process
    threading.Thread(target=_tail_stderr, daemon=True).start()

    if not display_ready.wait(timeout=timeout):
        raise TimeoutError(
            f"gnome-shell did not announce displays within {timeout}s "
            f"(wayland={display_name}, x11={x11_display})"
        )
    assert display_name is not None
    assert x11_display is not None
    return display_name, x11_display


# ── Step 6: Poll for readiness ───────────────────────────────────────────

def wait_for_wayland_socket(display_name: str, timeout: float = 30.0) -> None:
    """Poll until the Wayland socket file appears in XDG_RUNTIME_DIR."""
    runtime_dir = pathlib.Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    sock = runtime_dir / display_name
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if sock.is_socket():
            _pass(f"Wayland socket {display_name} ready")
            return
        time.sleep(0.2)
    raise TimeoutError(f"Wayland socket {sock} did not appear within {timeout}s")


def wait_for_shell_dbus(dbus_addr: str, timeout: float = 40.0) -> None:
    """Poll until the org.gnome.Shell name appears on the isolated bus."""
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
    raise TimeoutError("GNOME Shell D-Bus did not become ready")


# ── Step 7: Extension install + enable ─────────────────────────────────

def install_extension_files() -> None:
    """Extract the built .zip into the per-user extensions directory."""
    zip_path = PROJECT_ROOT / f"{UUID}.zip"
    if not zip_path.is_file():
        raise FileNotFoundError(f"Extension zip not found: {zip_path}")
    ext_dir = pathlib.Path.home() / ".local" / "share" / "gnome-shell" / "extensions" / UUID
    ext_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["unzip", "-q", "-o", str(zip_path), "-d", str(ext_dir)], check=True)


def enable_extension(dbus_addr: str) -> None:
    """Enable the extension via the org.gnome.Shell.Extensions D-Bus API."""
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}

    _info("Enabling extension…")
    enable_r = subprocess.run(
        [
            "gdbus", "call", "--session",
            "--dest", "org.gnome.Shell",
            "--object-path", "/org/gnome/Shell",
            "--method", "org.gnome.Shell.Extensions.EnableExtension",
            UUID,
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    _info(f"EnableExtension → {enable_r.stdout.strip()}")
    if enable_r.returncode != 0:
        _fail(f"EnableExtension failed: {enable_r.stderr.strip()}")

    _info("Verifying extension state…")
    last_output = ""
    for _ in range(10):
        r = subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.gnome.Shell",
                "--object-path", "/org/gnome/Shell",
                "--method", "org.gnome.Shell.Extensions.GetExtensionInfo",
                UUID,
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        last_output = r.stdout
        _info(f"GetExtensionInfo → {r.stdout.strip()[:200]}")
        # Output looks like: ({'name': <'Anvil'>, ..., 'state': <1>, ...})
        if "state" in r.stdout and "<1>" in r.stdout:
            _pass("Extension is ACTIVE")
            return
        time.sleep(1)

    raise RuntimeError(f"Extension not ACTIVE. GetExtensionInfo output:\n{last_output}")


# ── Step 8: Wait for JS test results ──────────────────────────────────

RESULTS_PATH = pathlib.Path("/tmp/anvil-e2e-results.json")


def wait_for_results(timeout: float = 120.0) -> dict:
    """Poll until the JS test runner writes the results JSON file."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if RESULTS_PATH.is_file():
            try:
                with RESULTS_PATH.open() as f:
                    data = json.load(f)
                RESULTS_PATH.unlink()
                return data
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.5)
    raise TimeoutError(f"Results file did not appear within {timeout}s")


def print_results(results: dict) -> int:
    """Pretty-print coloured summary and return exit code (0 = all passed)."""
    total_passed = results.get("totalPassed", 0)
    total_failed = results.get("totalFailed", 0)
    fatal = results.get("fatalError")

    print("")
    print("═" * 50)
    print("  Anvil Devkit E2E Results")
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
            if test["passed"]:
                print(f"    {GREEN}✓{RESET} {test['name']}")
            else:
                print(f"    {RED}✗{RESET} {test['name']}")
                print(f"      → {test.get('error', 'Unknown error')}")

    print("")
    print("═" * 50)
    print(f"  Total:  {total_passed + total_failed}")
    print(f"  Passed: {GREEN}{total_passed}{RESET}")
    print(f"  Failed: {RED}{total_failed}{RESET}")
    print("═" * 50)
    print("")

    return 0 if total_failed == 0 else 1


# ── Main orchestrator (context-manager style) ────────────────────────────

class DevkitSession:
    """
    Context manager that owns the entire devkit lifecycle.

    Usage (Python ``with`` == C# ``using``):

        with DevkitSession() as session:
            session.dbus_addr      # "unix:path=/tmp/dbus-XXXXXX"
            session.display_name   # "wayland-1"
            # … run tests …
        # cleanup happens automatically on exit, even if an exception is raised
    """

    def __init__(self, tag_filter: str = "") -> None:
        self.dbus_proc: subprocess.Popen | None = None
        self.dbus_addr: str = ""
        self.mocks: list[subprocess.Popen] = []
        self.shell_proc: subprocess.Popen | None = None
        self.display_name: str = ""
        self.x11_display: str = ""
        self.tag_filter: str = tag_filter

    def __enter__(self) -> "DevkitSession":
        # 1. D-Bus
        self.dbus_proc, self.dbus_addr = start_dbus_session()

        # 2. Mocks (must be up before gnome-shell asks for them)
        self.mocks = start_mocks(self.dbus_addr)

        # 3. gsettings tweaks (affects the isolated session's gsettings DB)
        env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": self.dbus_addr}
        subprocess.run(
            ["gsettings", "set", "org.gnome.shell", "welcome-dialog-last-shown-version", "999"],
            env=env, capture_output=True,
        )
        subprocess.run(
            ["gsettings", "set", "org.gnome.mutter", "center-new-windows", "true"],
            env=env, capture_output=True,
        )

        # 4. gnome-shell --devkit --automation-script
        self.shell_proc = start_gnome_shell(
            self.dbus_addr,
            E2E_DIR / "runner.js",
            extra_env={
                "ANVIL_E2E_DIR": str(E2E_DIR),
                "ANVIL_E2E_TAG": self.tag_filter,
                "ANVIL_E2E_OUTPUT_DIR": str(OUTPUT_DIR),
            },
        )

        # 5. Discover the Wayland + X11 display names from stderr
        self.display_name, self.x11_display = discover_displays(self.shell_proc)

        # 6. Wait for socket file + D-Bus
        wait_for_wayland_socket(self.display_name)
        wait_for_shell_dbus(self.dbus_addr)

        # 7. Extra settle time
        time.sleep(2)

        # 8. Tell the D-Bus daemon to inject WAYLAND_DISPLAY / DISPLAY into the
        #    activation environment of all D-Bus-activated services.
        #    UpdateActivationEnvironment expects a{ss} (string→string), not a{sv}.
        #    Without this, GTK apps launched by gtk-launch open on the HOST
        #    compositor because they re-read WAYLAND_DISPLAY from the D-Bus
        #    daemon, not from our env.
        subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.UpdateActivationEnvironment",
                f"{{'WAYLAND_DISPLAY': '{self.display_name}', 'DISPLAY': '{self.x11_display}'}}",
            ],
            env=env,
            capture_output=True,
        )

        return self

    def __exit__(self, *_exc: object) -> None:
        """Kill everything in reverse order.  Runs even if an exception was raised."""
        _info("Cleaning up…")
        if self.shell_proc is not None:
            self.shell_proc.terminate()
            try:
                self.shell_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.shell_proc.kill()
                self.shell_proc.wait()
        for p in self.mocks:
            p.terminate()
        if self.dbus_proc is not None:
            self.dbus_proc.terminate()
            try:
                self.dbus_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.dbus_proc.kill()
        _info("Done")


# ── Entry point ────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Anvil Devkit E2E Test Runner")
    parser.add_argument("--no-build", action="store_true", help="Skip make dist")
    parser.add_argument("--tag", action="append", default=[], help="behave --tags filter")
    args = parser.parse_args()

    print("")
    print("══════════════════════════════════")
    print("  Anvil Devkit E2E Tests")
    print("══════════════════════════════════")
    print("")

    # Clean up stale results file from a previous run
    if RESULTS_PATH.exists():
        RESULTS_PATH.unlink()

    if not args.no_build:
        build_extension()

    tag_filter = ",".join(args.tag) if args.tag else ""

    install_extension_files()

    with DevkitSession(tag_filter=tag_filter) as session:
        _info("Running E2E tests inside devkit…")
        results = wait_for_results()
        exit_code = print_results(results)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())

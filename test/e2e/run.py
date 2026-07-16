#!/usr/bin/env python3
"""
Anvil Devkit E2E Test Runner

Architecture (read this first)
==============================

We need to start a *nested* GNOME Shell compositor (devkit mode) with a
virtual Wayland display and run the Jasmine automation-script inside it.
The dependency chain looks like this:

    run.py
      │
      ├─► dbus-daemon --session --print-address     (isolated D-Bus)
      │     │
      │     ├─► dbusmock stubs (UPower, NM, SessionManager …)
      │     │       └─ must register BEFORE gnome-shell starts
      │     │
      │     └─► gnome-shell --wayland --headless
      │           │
      │           ├─ announces: "Using Wayland display name 'wayland-1'"
      │           │       └─ we PARSE this from stderr in real time
      │           │
      │           └─ creates socket /run/user/1000/wayland-1
      │                   └─ must exist before wtype/gtk-launch work
      │
      ├─► install + enable Anvil extension
      │
      └─► wait for a unique result file under test/e2e/output/

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
  ``event.wait(timeout=30)``                    ==  ``event.Wait(TimeSpan.FromSeconds(30))``

There is NO event loop / async-await in this file.  We use plain OS threads
and blocking I/O because the problem is simple: start a process, read its
stderr in a background thread, signal the main thread when we see the magic
string.
"""

import argparse
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

# ── Shared utilities ───────────────────────────────────────────────────────────
# Add the test/lib package to sys.path so runner_utils is importable regardless
# of the working directory from which this script is invoked.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))

from runner_utils import (  # noqa: E402
    _info,
    _pass,
    _fail,
    start_dbus_session,
    start_mocks,
    wait_for_shell_dbus,
    wait_for_results,
    print_results,
)

# ── Configuration ──────────────────────────────────────────────────────────────

UUID = "anvil@GenKerensky.github.com"
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
E2E_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = E2E_DIR / "output"

JASMINE_BOOT = pathlib.Path("/usr/share/jasmine-gjs/jasmineBoot.js")


def require_jasmine_gjs() -> None:
    """Fail early with install instructions if jasmine-gjs is missing."""
    if JASMINE_BOOT.is_file():
        return
    _fail(
        "jasmine-gjs not found at /usr/share/jasmine-gjs/\n"
        "  E2E tests need jasmine-gjs installed system-wide. From source:\n"
        "    git clone --depth=1 https://github.com/ptomato/jasmine-gjs.git\n"
        "    cd jasmine-gjs && meson setup _build --prefix=/usr\n"
        "    ninja -C _build && sudo ninja -C _build install\n"
        "  On immutable hosts (Bazzite), install inside a distrobox with gnome-shell."
    )
    raise SystemExit(1)


# ── Step 2: Build extension ────────────────────────────────────────────────────

def build_extension() -> None:
    """Run ``make dist`` from the project root."""
    _info("Building extension…")
    subprocess.run(["make", "-C", str(PROJECT_ROOT), "dist"], check=True)


# ── Step 3: Extension install ──────────────────────────────────────────────────

def install_extension_files() -> None:
    """Extract the built .zip into the per-user extensions directory."""
    zip_path = PROJECT_ROOT / f"{UUID}.zip"
    if not zip_path.is_file():
        raise FileNotFoundError(f"Extension zip not found: {zip_path}")
    ext_dir = pathlib.Path.home() / ".local" / "share" / "gnome-shell" / "extensions" / UUID
    ext_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["unzip", "-q", "-o", str(zip_path), "-d", str(ext_dir)], check=True)


# ── Step 4: Start gnome-shell devkit ──────────────────────────────────────────

def start_gnome_shell(
    dbus_addr: str,
    automation_script: pathlib.Path,
    virtual_monitors: int = 1,
    extra_env: dict[str, str] | None = None,
) -> subprocess.Popen:
    """
    Launch ``gnome-shell --wayland --headless --automation-script <path>``
    inside the isolated session.

    Stderr is piped so a background thread can scan it for the Wayland display
    name announcement.
    """
    env = {
        **os.environ,
        "DBUS_SESSION_BUS_ADDRESS": dbus_addr,
        # Distrobox commonly inherits GDK_BACKEND=x11. The nested compositor
        # has a private Wayland socket, while its Xauthority is not owned by
        # this runner, so E2E clients must use Wayland.
        "GDK_BACKEND": "wayland",
    }
    ext_schemas = str(
        pathlib.Path.home() / ".local/share/gnome-shell/extensions" / UUID / "schemas"
    )
    if pathlib.Path(ext_schemas).is_dir():
        env["GSETTINGS_SCHEMA_DIR"] = ext_schemas
    env.pop("WAYLAND_DISPLAY", None)  # let gnome-shell pick its own socket name
    if extra_env:
        env |= extra_env

    command = ["/usr/bin/gnome-shell", "--wayland", "--headless"]
    for _ in range(virtual_monitors):
        command.extend(["--virtual-monitor", "1920x1080"])
    command.extend(["--automation-script", str(automation_script)])
    return subprocess.Popen(
        command,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def discover_displays(
    shell_proc: subprocess.Popen, timeout: float = 30.0
) -> tuple[str, str]:
    """
    Read gnome-shell's stderr in a background thread until we see both lines:

        Using Wayland display name 'wayland-N'
        Using public X11 display :M

    Returns (wayland_display_name, x11_display_name) e.g. ("wayland-1", ":2").

    Background-thread pattern (C# equivalent):
        var displayReady = new ManualResetEventSlim();
        new Thread(() => { … displayReady.Set(); }) { IsBackground = true }.Start();
        if (!displayReady.Wait(TimeSpan.FromSeconds(30))) throw …;
    """
    display_ready = threading.Event()
    display_name: str | None = None
    x11_display: str | None = None

    def _tail_stderr() -> None:
        nonlocal display_name, x11_display
        for line in shell_proc.stderr:  # type: ignore[union-attr]
            sys.stderr.write(line)
            sys.stderr.flush()
            m = re.search(r"Using Wayland display name '(wayland-\d+)'", line)
            if m:
                display_name = m.group(1)
            m2 = re.search(r"Using public X11 display (:\d+)", line)
            if m2:
                x11_display = m2.group(1)
            if display_name and x11_display:
                display_ready.set()
                # Keep reading so the pipe buffer doesn't fill and block gnome-shell.

    threading.Thread(target=_tail_stderr, daemon=True).start()

    if not display_ready.wait(timeout=timeout):
        raise TimeoutError(
            f"gnome-shell did not announce displays within {timeout}s "
            f"(wayland={display_name}, x11={x11_display})"
        )
    assert display_name is not None
    assert x11_display is not None
    return display_name, x11_display


def wait_for_wayland_socket(display_name: str, timeout: float = 30.0) -> None:
    """Poll until the Wayland socket file appears in XDG_RUNTIME_DIR."""
    runtime_dir = pathlib.Path(
        os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    )
    sock = runtime_dir / display_name
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if sock.is_socket():
            _pass(f"Wayland socket {display_name} ready")
            return
        time.sleep(0.2)
    raise TimeoutError(f"Wayland socket {sock} did not appear within {timeout}s")


# ── Step 5: Enable extension ───────────────────────────────────────────────────

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
        if "state" in r.stdout and "<1>" in r.stdout:
            _pass("Extension is ACTIVE")
            return
        time.sleep(1)

    raise RuntimeError(f"Extension not ACTIVE. GetExtensionInfo output:\n{last_output}")


# ── Main orchestrator (context-manager style) ──────────────────────────────────

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

    def __init__(
        self, tag_filter: str = "", engine: str = "legacy", virtual_monitors: int = 1
    ) -> None:
        self.dbus_proc: subprocess.Popen | None = None
        self.dbus_addr: str = ""
        self.mocks: list[subprocess.Popen] = []
        self.shell_proc: subprocess.Popen | None = None
        self.display_name: str = ""
        self.x11_display: str = ""
        self.tag_filter: str = tag_filter
        self.engine: str = engine
        self.virtual_monitors: int = virtual_monitors
        self._xdg_config: tempfile.TemporaryDirectory[str] | None = None
        self._results_path: pathlib.Path | None = None

    @property
    def results_path(self) -> pathlib.Path:
        if self._results_path is None:
            raise RuntimeError("E2E results path requested outside an active session")
        return self._results_path

    def __enter__(self) -> "DevkitSession":
        self._xdg_config = tempfile.TemporaryDirectory(prefix="anvil-e2e-config-")
        # Keep the result handoff on the repository mount. A nested Shell may
        # see a different /tmp namespace than the Python runner, while both
        # processes share test/e2e/output. PID + monotonic time also lets
        # independent E2E sessions run without clobbering one another.
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        self._results_path = (
            OUTPUT_DIR / f"results-{os.getpid()}-{time.monotonic_ns()}.json"
        )
        try:
            return self._start()
        except Exception:
            self.__exit__()
            raise

    def _start(self) -> "DevkitSession":

        # 1. Isolated D-Bus
        self.dbus_proc, self.dbus_addr = start_dbus_session()

        # 2. dbusmock stubs (must be up before gnome-shell asks for them)
        self.mocks = start_mocks(self.dbus_addr)

        # 3. gsettings tweaks on the isolated session
        env = {
            **os.environ,
            "DBUS_SESSION_BUS_ADDRESS": self.dbus_addr,
            "GDK_BACKEND": "wayland",
            "XDG_CONFIG_HOME": self._xdg_config.name,
        }
        subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.UpdateActivationEnvironment",
                f"{{'XDG_CONFIG_HOME': '{self._xdg_config.name}', "
                "'GDK_BACKEND': 'wayland'}",
            ],
            env=env,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["gsettings", "set", "org.gnome.shell",
             "welcome-dialog-last-shown-version", "999"],
            env=env, capture_output=True,
        )
        subprocess.run(
            ["gsettings", "set", "org.gnome.mutter", "center-new-windows", "true"],
            env=env, capture_output=True,
        )

        # 4. gnome-shell --headless --automation-script
        self.shell_proc = start_gnome_shell(
            self.dbus_addr,
            E2E_DIR / "runner.js",
            virtual_monitors=self.virtual_monitors,
            extra_env={
                "ANVIL_E2E_DIR": str(E2E_DIR),
                "ANVIL_E2E_TAG": self.tag_filter,
                "ANVIL_E2E_OUTPUT_DIR": str(OUTPUT_DIR),
                "ANVIL_E2E_RESULTS_PATH": str(self.results_path),
                "ANVIL_TILING_ENGINE": "core" if self.engine == "core" else "shadow",
                "ANVIL_E2E_VIRTUAL_MONITORS": str(self.virtual_monitors),
                "XDG_CONFIG_HOME": self._xdg_config.name,
            },
        )

        # 5. Discover the Wayland + X11 display names from stderr
        self.display_name, self.x11_display = discover_displays(self.shell_proc)

        # 6. Wait for socket file + D-Bus
        wait_for_wayland_socket(self.display_name)
        wait_for_shell_dbus(self.dbus_addr)

        # 7. Settle time
        time.sleep(2)

        # 8. Inject WAYLAND_DISPLAY / DISPLAY into the D-Bus activation environment
        #    so GTK apps launched via D-Bus open on the nested compositor, not the host.
        subprocess.run(
            [
                "gdbus", "call", "--session",
                "--dest", "org.freedesktop.DBus",
                "--object-path", "/org/freedesktop/DBus",
                "--method", "org.freedesktop.DBus.UpdateActivationEnvironment",
                f"{{'WAYLAND_DISPLAY': '{self.display_name}', "
                f"'DISPLAY': '{self.x11_display}', 'GDK_BACKEND': 'wayland', "
                f"'XDG_CONFIG_HOME': '{self._xdg_config.name}'}}",
            ],
            env=env,
            capture_output=True,
        )

        return self

    def __exit__(self, *_exc: object) -> None:
        """Kill everything in reverse order. Runs even if an exception was raised."""
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
        if self._xdg_config is not None:
            self._xdg_config.cleanup()
            self._xdg_config = None
        if self._results_path is not None:
            self._results_path.unlink(missing_ok=True)
        self._results_path = None
        _info("Done")


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Anvil Devkit E2E Test Runner")
    parser.add_argument("--no-build", action="store_true", help="Skip make dist")
    parser.add_argument("--tag", action="append", default=[], help="Suite tag filter")
    parser.add_argument(
        "--results-timeout",
        type=float,
        default=900.0,
        metavar="SECONDS",
        help="Maximum time to wait for the in-Shell result file (default: 900)",
    )
    parser.add_argument(
        "--engine",
        choices=("legacy", "core"),
        default="legacy",
        help="Tiling writer used by the extension (default: legacy)",
    )
    parser.add_argument(
        "--virtual-monitors",
        type=int,
        default=1,
        choices=range(1, 5),
        metavar="COUNT",
        help="Persistent virtual monitors to create (default: 1)",
    )
    args = parser.parse_args()
    if args.results_timeout <= 0:
        parser.error("--results-timeout must be greater than zero")

    print("")
    print("══════════════════════════════════")
    print("  Anvil E2E Tests (headless)")
    print("══════════════════════════════════")
    print("")

    require_jasmine_gjs()

    if not args.no_build:
        build_extension()

    tag_filter = ",".join(args.tag) if args.tag else ""

    install_extension_files()

    with DevkitSession(
        tag_filter=tag_filter,
        engine=args.engine,
        virtual_monitors=args.virtual_monitors,
    ) as session:
        _info("Running E2E tests inside headless gnome-shell…")
        results = wait_for_results(
            session.results_path, timeout=args.results_timeout, watched_process=session.shell_proc
        )
        exit_code = print_results(results, title="Anvil E2E Results")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())

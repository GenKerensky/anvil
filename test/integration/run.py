#!/usr/bin/env python3
"""
Anvil Integration Test Runner

Architecture
============

The test session runs gnome-shell --headless --wayland *inside a Podman
container* managed by this script. The Jasmine automation-script (runner.js)
runs inside gnome-shell and writes its results to a JSON file that we poll
for from the host.

Dependency chain:

    run.py
      │
      ├─► podman run …  (starts container with systemd init)
      │     │
      │     └─► gnome-headless.service  (systemd, starts automatically)
      │           │
      │           └─► start-session.sh
      │                 ├─► dbus-daemon  (session bus at /run/user/1000/bus)
      │                 ├─► python3 -m dbusmock  (5 service stubs)
      │                 ├─► at-spi-bus-launcher
      │                 └─► gnome-shell --headless --wayland [--automation-script]
      │
      ├─► install + restart + enable Anvil extension
      │
      └─► poll /tmp/anvil-jasmine-results.json (written by runner.js)

Why Python instead of Bash?
===========================
The bash run-tests.sh required three separate python3 forks just to parse
JSON, and had scattered ``|| true`` error handling.  Python gives us:

  - Deterministic ``try/finally`` cleanup via context manager (ContainerSession)
  - A single JSON parse with proper error reporting (print_results)
  - subprocess.run(..., check=True) instead of ``$?`` checks
  - Shared utilities with test/e2e/run.py via test/lib/runner_utils.py

Note: the threading / stderr-parsing machinery from run.py is NOT needed
here. The container's gnome-shell socket name is always ``wayland-0``
(predictable), and gnome-shell is managed by systemd inside the container —
we never hold a direct reference to the gnome-shell process.
"""

from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
import sys
import time

# ── Shared utilities ───────────────────────────────────────────────────────────
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "lib"))

from runner_utils import (  # noqa: E402
    _info,
    _pass,
    _fail,
    wait_for_results,
    print_results,
)

# ── Configuration ──────────────────────────────────────────────────────────────

UUID = "anvil@GenKerensky.github.com"
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
INTEGRATION_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = INTEGRATION_DIR / "output"

# Path to the results file *inside* the container.
CONTAINER_RESULTS_PATH = "/tmp/anvil-jasmine-results.json"

# After pulling the file out of the container, we write it here on the host.
HOST_RESULTS_PATH = pathlib.Path("/tmp/anvil-jasmine-results.json")

# Fixed session bus address used by start-session.sh and set-env.sh.
CONTAINER_DBUS_ADDR = "unix:path=/run/user/1000/bus"

# Wayland socket name: gnome-shell always picks wayland-0 when XDG_RUNTIME_DIR
# is clean (which it is on every fresh container start).
WAYLAND_SOCKET = "/run/user/1000/wayland-0"

RUNNER_DIR = "/usr/local/share/anvil-tests"


# ── Low-level podman helpers ───────────────────────────────────────────────────

def _pod_exec(pod: str, *cmd: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """
    Run a command inside the container as the gnomeshell user, with the
    correct XDG/D-Bus/Wayland environment sourced from set-env.sh.
    """
    return subprocess.run(
        ["podman", "exec", "--user", "gnomeshell", "--workdir", "/home/gnomeshell",
         pod, "set-env.sh", *cmd],
        check=check,
        capture_output=capture,
        text=True,
    )


def _pod_exec_root(pod: str, *cmd: str) -> subprocess.CompletedProcess:
    """Run a command inside the container as root (for chmod/systemctl)."""
    return subprocess.run(
        ["podman", "exec", pod, *cmd],
        check=True,
        capture_output=True,
        text=True,
    )


def _pod_cp(pod: str, src: pathlib.Path | str, dest: str) -> None:
    """Copy a file or directory from the host into the container."""
    subprocess.run(["podman", "cp", str(src), f"{pod}:{dest}"], check=True)


# ── Session readiness polling ──────────────────────────────────────────────────

def _wait_for_wayland_socket(pod: str, timeout: float = 40.0) -> None:
    """Poll until gnome-shell's Wayland socket exists inside the container."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = _pod_exec(pod, "test", "-S", WAYLAND_SOCKET, check=False, capture=True)
        if r.returncode == 0:
            _pass(f"Wayland socket ready ({WAYLAND_SOCKET})")
            return
        time.sleep(1)
    raise TimeoutError(f"Wayland socket {WAYLAND_SOCKET} did not appear within {timeout}s")


def _wait_for_shell_dbus(pod: str, timeout: float = 40.0) -> None:
    """
    Poll until org.gnome.Shell is present on the container's session bus.

    Uses gdbus NameHasOwner rather than Shell.Eval (which is broken system-wide).
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = _pod_exec(
            pod,
            "gdbus", "call", "--session",
            "--dest", "org.freedesktop.DBus",
            "--object-path", "/org/freedesktop/DBus",
            "--method", "org.freedesktop.DBus.NameHasOwner",
            "org.gnome.Shell",
            check=False, capture=True,
        )
        if r.returncode == 0 and "(true,)" in r.stdout:
            _pass("GNOME Shell D-Bus ready")
            return
        time.sleep(1)
    raise TimeoutError(f"org.gnome.Shell did not appear on D-Bus within {timeout}s")


def _wait_for_results_in_container(pod: str, timeout: float = 180.0) -> str:
    """
    Poll inside the container until runner.js writes the Jasmine results JSON.

    Returns the raw JSON string.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = _pod_exec(
            pod, "test", "-f", CONTAINER_RESULTS_PATH,
            check=False, capture=True,
        )
        if r.returncode == 0:
            out = _pod_exec(pod, "cat", CONTAINER_RESULTS_PATH, capture=True)
            _pass("Jasmine results available")
            return out.stdout
        time.sleep(1)
    raise TimeoutError(f"Jasmine results did not appear within {timeout}s")


# ── Container session context manager ─────────────────────────────────────────

class ContainerSession:
    """
    Context manager that owns the full container lifecycle.

    Usage (Python ``with`` == C# ``using``):

        with ContainerSession(fedora_version="44") as session:
            session.pod   # short container ID
            # … drive the container …
        # podman stop runs automatically on exit, even if an exception was raised

    Steps performed in __enter__:
      1.  podman run (start container with systemd init)
      2.  Wait for user D-Bus socket (wait-user-bus.sh)
      3.  gsettings tweaks (suppress welcome tour, centre windows)
      4.  Wait for initial gnome-shell startup (Wayland socket + D-Bus)
      5.  Install extension zip + push session scripts
      6.  Push Jasmine runner.js + specs/
      7.  Write automation-script marker → restart gnome-headless.service
      8.  Wait for gnome-shell to come back up after restart
      9.  Enable extension via gnome-extensions CLI
    """

    def __init__(self, fedora_version: str = "44", keep: bool = False) -> None:
        self.fedora_version = fedora_version
        self.keep = keep
        self.pod: str = ""
        self._image = f"anvil-test-pod:fedora-{fedora_version}"

    # ── context manager entry ──────────────────────────────────────────────────

    def __enter__(self) -> "ContainerSession":
        # 1. Start container (systemd init, auto-starts gnome-headless.service)
        _info(f"Starting container ({self._image})…")
        result = subprocess.run(
            ["podman", "run", "--rm", "--cap-add=SYS_NICE", "--cap-add=IPC_LOCK",
             "-td", self._image],
            check=True, capture_output=True, text=True,
        )
        self.pod = result.stdout.strip()
        _pass(f"Container: {self.pod[:12]}")

        # 2. Wait for the user D-Bus socket inside the container.
        #    wait-user-bus.sh blocks until /run/user/1000/bus exists.
        _info("Waiting for user D-Bus socket…")
        _pod_exec(self.pod, "wait-user-bus.sh")
        time.sleep(2)

        # 3. Suppress the GNOME welcome tour and centre new windows.
        _info("Applying gsettings tweaks…")
        _pod_exec(self.pod, "gsettings", "set", "org.gnome.shell",
                  "welcome-dialog-last-shown-version", "999", check=False)
        _pod_exec(self.pod, "gsettings", "set", "org.gnome.mutter",
                  "center-new-windows", "true", check=False)

        # 4. Wait for the initial gnome-shell startup (started by systemd).
        _info("Waiting for initial GNOME Shell startup…")
        _wait_for_wayland_socket(self.pod)
        _wait_for_shell_dbus(self.pod)
        time.sleep(2)

        # 5. Install the extension and push updated session scripts.
        #    Installation must happen after gnome-shell is running so the
        #    shell discovers the extension on the next restart.
        _info("Installing extension…")
        zip_path = PROJECT_ROOT / f"{UUID}.zip"
        _pod_cp(self.pod, zip_path, f"/home/gnomeshell/{UUID}.zip")
        _pod_exec(self.pod, "gnome-extensions", "install", "--force", f"{UUID}.zip")

        # Push current start-session.sh and set-env.sh so in-tree edits take
        # effect without rebuilding the container image.
        _info("Pushing session scripts…")
        _pod_cp(self.pod, INTEGRATION_DIR / "start-session.sh",
                "/usr/local/bin/start-session.sh")
        _pod_cp(self.pod, INTEGRATION_DIR / "set-env.sh",
                "/usr/local/bin/set-env.sh")
        _pod_exec_root(self.pod, "chmod", "0755",
                       "/usr/local/bin/start-session.sh",
                       "/usr/local/bin/set-env.sh")

        # 6. Push Jasmine runner and spec files.
        #    Overwriting the baked-in copies means spec changes don't require
        #    a container image rebuild.
        _info("Pushing Jasmine runner and specs…")
        _pod_cp(self.pod, INTEGRATION_DIR / "runner.js",
                f"{RUNNER_DIR}/runner.js")
        _pod_cp(self.pod, INTEGRATION_DIR / "specs",
                f"{RUNNER_DIR}/specs")
        _pod_cp(self.pod, PROJECT_ROOT / "test" / "lib" / "shared-commands.js",
                f"{RUNNER_DIR}/lib/shared-commands.js")
        _pod_exec_root(self.pod, "chmod", "0755", f"{RUNNER_DIR}/runner.js")
        _pod_exec_root(self.pod, "chmod", "-R", "0755", f"{RUNNER_DIR}/specs")
        _pod_exec_root(self.pod, "chmod", "0755", f"{RUNNER_DIR}/lib/shared-commands.js")

        # 7. Write the automation-script marker file and restart gnome-shell.
        #    start-session.sh reads this file and passes --automation-script
        #    to gnome-shell if it exists and points to a real file.
        _info("Restarting gnome-shell with automation-script…")
        _pod_exec(self.pod, "bash", "-c",
                  f"echo '{RUNNER_DIR}/runner.js' > /tmp/anvil-automation-script")
        _pod_exec_root(self.pod, "systemctl", "restart", "gnome-headless.service")
        time.sleep(2)

        # 8. Re-wait for gnome-shell after restart.
        _info("Waiting for gnome-shell after restart…")
        _wait_for_shell_dbus(self.pod)
        time.sleep(1)

        # 9. Enable the extension.
        _info("Enabling extension…")
        _pod_exec(self.pod, "gnome-extensions", "enable", UUID, check=False)
        time.sleep(3)

        return self

    # ── context manager exit ───────────────────────────────────────────────────

    def __exit__(self, *_exc: object) -> None:
        """Stop the container. Runs even if an exception was raised."""
        if not self.pod:
            return
        if self.keep:
            _info(f"Container left running: {self.pod[:12]}")
            _info(f"To stop: podman stop {self.pod[:12]}")
        else:
            _info("Stopping container…")
            subprocess.run(["podman", "stop", self.pod],
                           capture_output=True, check=False)
            _info("Done")

    # ── diagnostics helpers ────────────────────────────────────────────────────

    def save_journal(self, output_path: pathlib.Path) -> None:
        """Write the gnome-headless service journal to a file on the host."""
        try:
            r = _pod_exec(
                self.pod,
                "journalctl", "-u", "gnome-headless.service", "--no-pager",
                check=False, capture=True,
            )
            output_path.write_text(r.stdout + r.stderr)
            _info(f"Journal saved to {output_path}")
        except Exception as e:
            _fail(f"Could not save journal: {e}")

    def screenshot(self, name: str = "screenshot") -> None:
        """Capture the Wayland framebuffer. Non-fatal — may not work headless."""
        dest = OUTPUT_DIR / f"{name}.png"
        try:
            _pod_exec(self.pod, "grim", f"/tmp/{name}.png",
                      check=False, capture=True)
            subprocess.run(
                ["podman", "cp", f"{self.pod}:/tmp/{name}.png", str(dest)],
                check=False, capture_output=True,
            )
        except Exception:
            pass  # grim may not work in headless


# ── Entry point ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Anvil Integration Test Runner")
    parser.add_argument(
        "-v", "--fedora-version", default="44",
        metavar="VERSION", help="Fedora version (42, 43, 44). Default: 44",
    )
    parser.add_argument(
        "-k", "--keep", action="store_true",
        help="Keep the container running after tests (useful for debugging)",
    )
    args = parser.parse_args()

    fedora_version = args.fedora_version
    image = f"anvil-test-pod:fedora-{fedora_version}"

    print("")
    print("══════════════════════════════════")
    print(f"  Anvil Integration Tests — Fedora {fedora_version} / headless Wayland")
    print("══════════════════════════════════")
    print("")

    # Pre-flight checks
    if not _command_exists("podman"):
        _fail("podman is not installed or not in PATH")
        return 1

    r = subprocess.run(["podman", "image", "exists", image],
                       capture_output=True, check=False)
    if r.returncode != 0:
        _fail(f"Container image '{image}' not found.")
        print(f"  Build it with: ./test/integration/build-container.sh {fedora_version}")
        return 1

    zip_path = PROJECT_ROOT / f"{UUID}.zip"
    if not zip_path.is_file():
        _fail(f"Extension archive '{zip_path.name}' not found in project root.")
        print("  Build it with: make dist")
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Clean up stale results from a previous run
    HOST_RESULTS_PATH.unlink(missing_ok=True)

    exit_code = 1
    with ContainerSession(fedora_version=fedora_version, keep=args.keep) as session:
        try:
            _info("Waiting for Jasmine test results…")
            raw_json = _wait_for_results_in_container(session.pod)
        except TimeoutError as e:
            _fail(str(e))
            session.save_journal(OUTPUT_DIR / "journal.log")
            session.screenshot("timeout")
            return 1

        # Save results JSON to the output directory
        import json
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        results_file = OUTPUT_DIR / f"jasmine-results-{timestamp}.json"
        results_file.write_text(raw_json)

        # Write to the canonical host path so wait_for_results() can read it
        HOST_RESULTS_PATH.write_text(raw_json)

        try:
            results = wait_for_results(HOST_RESULTS_PATH, timeout=10.0)
        except (TimeoutError, json.JSONDecodeError) as e:
            _fail(f"Could not parse results: {e}")
            return 1

        exit_code = print_results(results, title=f"Anvil Integration Results (Fedora {fedora_version})")

        if exit_code != 0:
            session.save_journal(OUTPUT_DIR / "journal.log")
            session.screenshot("fail-summary")

    return exit_code


def _command_exists(name: str) -> bool:
    return subprocess.run(["which", name], capture_output=True).returncode == 0


if __name__ == "__main__":
    sys.exit(main())

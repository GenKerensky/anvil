"""
Host-session guardrails for the agent debug loop.

Fail closed before spawning gnome-shell on the user's real GNOME session.
"""

from __future__ import annotations

import os
import pathlib
import re


class HostSessionError(RuntimeError):
    """Raised when a guardrail would touch the host GNOME session."""


_HOST_BUS_RE = re.compile(r"^unix:path=/run/user/\d+/bus$")


def get_host_bus_fingerprint() -> str | None:
    """Capture host session bus before mutating environment."""
    return os.environ.get("DBUS_SESSION_BUS_ADDRESS")


def assert_debug_loop_sentinel() -> None:
    if os.environ.get("ANVIL_DEBUG_LOOP") != "1":
        raise HostSessionError(
            "ANVIL_DEBUG_LOOP=1 not set; refuse to run outside debug loop wrapper"
        )


def assert_launch_display_unset() -> None:
    if os.environ.get("WAYLAND_DISPLAY"):
        raise HostSessionError(
            f"WAYLAND_DISPLAY={os.environ['WAYLAND_DISPLAY']!r} set; "
            "unset before launching isolated shell"
        )
    if os.environ.get("DISPLAY"):
        raise HostSessionError(
            f"DISPLAY={os.environ['DISPLAY']!r} set; "
            "unset before launching isolated shell"
        )


def assert_bus_isolated(host_bus: str | None, isolated_bus: str) -> None:
    if host_bus and host_bus == isolated_bus:
        raise HostSessionError(
            f"Isolated D-Bus address matches host session bus: {host_bus}"
        )
    if _HOST_BUS_RE.match(isolated_bus):
        raise HostSessionError(
            f"Isolated bus still points at host session socket: {isolated_bus}"
        )


def assert_no_host_bus_without_isolation(
    host_bus: str | None, *, has_isolated_daemon: bool
) -> None:
    """Refuse when the orchestrator would use the host session bus without isolation."""
    del host_bus  # captured for callers; check uses live env only
    if has_isolated_daemon:
        return
    current = os.environ.get("DBUS_SESSION_BUS_ADDRESS")
    if current and _HOST_BUS_RE.match(current):
        raise HostSessionError(
            "DBUS_SESSION_BUS_ADDRESS is the host session bus "
            "and no isolated dbus-daemon was created"
        )


def assert_xdg_under_session(
    session_dir: pathlib.Path,
    *,
    xdg_data: str | None = None,
    xdg_config: str | None = None,
    xdg_cache: str | None = None,
) -> None:
    session_resolved = session_dir.resolve()
    for label, value in (
        ("XDG_DATA_HOME", xdg_data),
        ("XDG_CONFIG_HOME", xdg_config),
        ("XDG_CACHE_HOME", xdg_cache),
    ):
        if not value:
            continue
        path = pathlib.Path(value).resolve()
        try:
            path.relative_to(session_resolved)
        except ValueError as exc:
            raise HostSessionError(
                f"{label}={value!r} is not under session_dir {session_dir}"
            ) from exc


def assert_isolated_session_sentinel(expected_session_dir: pathlib.Path) -> None:
    if os.environ.get("ANVIL_ISOLATED_SESSION") != "1":
        raise HostSessionError("ANVIL_ISOLATED_SESSION=1 not set in child environment")
    for var in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
        if not os.environ.get(var):
            raise HostSessionError(f"{var} not set for isolated session")
    assert_xdg_under_session(
        expected_session_dir,
        xdg_data=os.environ.get("XDG_DATA_HOME"),
        xdg_config=os.environ.get("XDG_CONFIG_HOME"),
        xdg_cache=os.environ.get("XDG_CACHE_HOME"),
    )


def _read_proc_cmdline(pid: int) -> str:
    cmdline_path = pathlib.Path(f"/proc/{pid}/cmdline")
    if not cmdline_path.is_file():
        return ""
    raw = cmdline_path.read_bytes()
    return raw.replace(b"\0", b" ").decode(errors="replace").strip()


def _read_proc_environ(pid: int) -> dict[str, str]:
    environ_path = pathlib.Path(f"/proc/{pid}/environ")
    if not environ_path.is_file():
        return {}
    raw = environ_path.read_bytes()
    env: dict[str, str] = {}
    for entry in raw.split(b"\0"):
        if not entry or b"=" not in entry:
            continue
        key, _, val = entry.partition(b"=")
        try:
            env[key.decode()] = val.decode()
        except UnicodeDecodeError:
            continue
    return env


def assert_shell_child_isolated(session_dir: pathlib.Path, pid: int) -> None:
    """Verify gnome-shell child inherited isolated-session sentinels and XDG paths."""
    child = _read_proc_environ(pid)
    if child.get("ANVIL_ISOLATED_SESSION") != "1":
        raise HostSessionError(
            f"gnome-shell pid {pid} missing ANVIL_ISOLATED_SESSION=1 in /proc environ"
        )
    for var in ("XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
        if not child.get(var):
            raise HostSessionError(f"gnome-shell pid {pid} missing {var} in /proc environ")
    assert_xdg_under_session(
        session_dir,
        xdg_data=child.get("XDG_DATA_HOME"),
        xdg_config=child.get("XDG_CONFIG_HOME"),
        xdg_cache=child.get("XDG_CACHE_HOME"),
    )


def assert_shell_child_env(pid: int, host_bus: str | None) -> None:
    child = _read_proc_environ(pid)
    child_bus = child.get("DBUS_SESSION_BUS_ADDRESS")
    if not child_bus:
        raise HostSessionError(f"gnome-shell pid {pid} has no DBUS_SESSION_BUS_ADDRESS")
    if host_bus and child_bus == host_bus:
        raise HostSessionError(
            f"gnome-shell pid {pid} inherited host session bus {host_bus}"
        )
    if _HOST_BUS_RE.match(child_bus):
        raise HostSessionError(
            f"gnome-shell pid {pid} uses host session bus socket: {child_bus}"
        )
    if child.get("WAYLAND_DISPLAY") and os.environ.get("WAYLAND_DISPLAY"):
        host_wl = os.environ.get("WAYLAND_DISPLAY")
        if child.get("WAYLAND_DISPLAY") == host_wl:
            raise HostSessionError(
                f"gnome-shell pid {pid} shares host WAYLAND_DISPLAY={host_wl}"
            )


def is_safe_teardown_target(
    pid: int,
    *,
    session_dir: pathlib.Path,
    meta: dict[str, object],
    role: str,
) -> bool:
    """
    Return True only when ``pid`` looks like an isolated debug-loop process.

    Refuses host gnome-shell / stale PIDs planted via tampered meta.json.
    """
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False

    cmdline = _read_proc_cmdline(pid)
    env = _read_proc_environ(pid)
    expected_bus = meta.get("isolatedBusFingerprint")
    child_bus = env.get("DBUS_SESSION_BUS_ADDRESS")

    if expected_bus and child_bus and child_bus != expected_bus:
        return False
    if child_bus and _HOST_BUS_RE.match(child_bus):
        return False

    if role == "shell":
        if "gnome-shell" not in cmdline:
            return False
        if env.get("ANVIL_ISOLATED_SESSION") != "1":
            return False
        if env.get("ANVIL_DEBUG_LOOP") != "1":
            return False
        try:
            assert_xdg_under_session(
                session_dir,
                xdg_data=env.get("XDG_DATA_HOME"),
                xdg_config=env.get("XDG_CONFIG_HOME"),
                xdg_cache=env.get("XDG_CACHE_HOME"),
            )
        except HostSessionError:
            return False
        return True

    if role == "dbus":
        return "dbus-daemon" in cmdline

    if role == "mock":
        return "dbusmock" in cmdline

    return False


def assert_host_safe(
    session_dir: pathlib.Path,
    *,
    host_bus: str | None = None,
    isolated_bus: str | None = None,
    shell_pid: int | None = None,
    require_isolated_xdg: bool = True,
    xdg_data: str | None = None,
    xdg_config: str | None = None,
    xdg_cache: str | None = None,
) -> dict[str, object]:
    """
    Run guardrail checks for the current lifecycle phase.

    Returns a dict suitable for iteration JSON guardrails section.
    """
    assert_debug_loop_sentinel()
    if host_bus is None:
        host_bus = get_host_bus_fingerprint()
    assert_launch_display_unset()

    has_isolated = isolated_bus is not None
    assert_no_host_bus_without_isolation(host_bus, has_isolated_daemon=has_isolated)

    if isolated_bus is not None:
        assert_bus_isolated(host_bus, isolated_bus)

    if require_isolated_xdg and any((xdg_data, xdg_config, xdg_cache)):
        assert_xdg_under_session(
            session_dir,
            xdg_data=xdg_data,
            xdg_config=xdg_config,
            xdg_cache=xdg_cache,
        )

    if shell_pid is not None:
        assert_shell_child_env(shell_pid, host_bus)
        if require_isolated_xdg:
            assert_shell_child_isolated(session_dir, shell_pid)

    return {
        "hostBusBlocked": True,
        "isolatedXdg": require_isolated_xdg,
        "sessionModel": "launcher-style" if require_isolated_xdg else "e2e-parity",
        "sentinels": {
            "ANVIL_DEBUG_LOOP": os.environ.get("ANVIL_DEBUG_LOOP") == "1",
            "ANVIL_ISOLATED_SESSION": (
                os.environ.get("ANVIL_ISOLATED_SESSION") == "1" or require_isolated_xdg
            ),
        },
    }
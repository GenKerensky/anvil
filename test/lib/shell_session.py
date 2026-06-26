"""
HeadlessShellSession — shared headless gnome-shell lifecycle for agent debug loop and E2E.

Extracted from test/e2e/run.py DevkitSession with optional launcher-style XDG isolation.
"""

from __future__ import annotations

import os
import pathlib
import re
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any

from runner_utils import (
    _info,
    _pass,
    start_dbus_session,
    start_mocks,
    wait_for_shell_dbus,
)

UUID = "anvil@GenKerensky.github.com"
SCHEMA_ID = "org.gnome.shell.extensions.anvil"


@dataclass
class SessionInfo:
    session_dir: pathlib.Path
    dbus_addr: str
    wayland_display: str
    x11_display: str
    log_path: pathlib.Path
    shell_pid: int
    dbus_daemon_pid: int
    mock_pids: list[int]


class HeadlessShellSession:
    """Isolated headless gnome-shell with optional automation-script."""

    def __init__(
        self,
        *,
        session_dir: pathlib.Path,
        extension_dir: pathlib.Path,
        automation_script: pathlib.Path | None = None,
        virtual_monitor: str = "1920x1080",
        isolate_xdg: bool = True,
        extra_env: dict[str, str] | None = None,
        shell_debug: str = "backtrace-warnings",
        enable_before_ready: bool | None = None,
        project_root: pathlib.Path | None = None,
    ) -> None:
        self.session_dir = session_dir
        self.extension_dir = extension_dir
        self.automation_script = automation_script
        self.virtual_monitor = virtual_monitor
        self.isolate_xdg = isolate_xdg
        self.extra_env = extra_env or {}
        self.shell_debug = shell_debug
        if enable_before_ready is None:
            self.enable_before_ready = isolate_xdg
        else:
            self.enable_before_ready = enable_before_ready
        self.project_root = project_root

        self.dbus_proc: subprocess.Popen | None = None
        self.dbus_addr: str = ""
        self.mocks: list[subprocess.Popen] = []
        self.shell_proc: subprocess.Popen | None = None
        self.display_name: str = ""
        self.x11_display: str = ""
        self.log_path = session_dir / "gnome-shell.log"
        self._log_file: pathlib.Path | None = None
        self._log_handle: Any = None
        self._session_env: dict[str, str] = {}

    def _build_session_env(self, dbus_addr: str) -> dict[str, str]:
        env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
        env.pop("WAYLAND_DISPLAY", None)
        env.pop("DISPLAY", None)

        if self.isolate_xdg:
            data_home = self.session_dir / "data"
            config_home = self.session_dir / "config"
            cache_home = self.session_dir / "cache"
            env["XDG_DATA_HOME"] = str(data_home)
            env["XDG_CONFIG_HOME"] = str(config_home)
            env["XDG_CACHE_HOME"] = str(cache_home)
            env["ANVIL_ISOLATED_SESSION"] = "1"
            schemas = self.extension_dir / "schemas"
            if schemas.is_dir():
                env["GSETTINGS_SCHEMA_DIR"] = str(schemas)
        else:
            ext_schemas = (
                pathlib.Path.home()
                / ".local/share/gnome-shell/extensions"
                / UUID
                / "schemas"
            )
            if ext_schemas.is_dir():
                env["GSETTINGS_SCHEMA_DIR"] = str(ext_schemas)

        env["SHELL_DEBUG"] = self.shell_debug
        env["G_MESSAGES_DEBUG"] = "all"
        if self.project_root is not None:
            env["ANVIL_PROJECT_ROOT"] = str(self.project_root)

        env |= self.extra_env
        return env

    def _setup_xdg_layout(self) -> pathlib.Path:
        """Create XDG dirs and symlink extension when isolate_xdg=True."""
        self.session_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.session_dir, 0o700)
        data_home = self.session_dir / "data"
        config_home = self.session_dir / "config"
        cache_home = self.session_dir / "cache"
        ext_target = data_home / "gnome-shell" / "extensions" / UUID
        ext_target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        config_home.mkdir(parents=True, exist_ok=True, mode=0o700)
        cache_home.mkdir(parents=True, exist_ok=True, mode=0o700)

        if ext_target.exists() or ext_target.is_symlink():
            ext_target.unlink()
        ext_target.symlink_to(self.extension_dir.resolve())

        gschemas = self.extension_dir / "schemas" / "gschemas.compiled"
        if not gschemas.is_file():
            raise FileNotFoundError(
                f"gschemas.compiled required at {gschemas}; run 'make build debug' first"
            )
        return ext_target

    def _apply_gsettings_defaults(self, env: dict[str, str]) -> None:
        critical = [
            ["gsettings", "set", SCHEMA_ID, "test-mode", "true"],
        ]
        optional = [
            ["gsettings", "set", "org.gnome.shell", "welcome-dialog-last-shown-version", "999"],
            ["gsettings", "set", "org.gnome.mutter", "center-new-windows", "true"],
            ["gsettings", "set", "org.gnome.mutter", "auto-maximize", "false"],
        ]
        for cmd in critical:
            result = subprocess.run(cmd, env=env, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(
                    f"gsettings failed for {' '.join(cmd)}: {result.stderr.strip()}"
                )
        for cmd in optional:
            subprocess.run(cmd, env=env, capture_output=True, text=True)

    def _start_gnome_shell(self, env: dict[str, str]) -> subprocess.Popen:
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.log_path.write_text("")
        log_handle = self.log_path.open("a", encoding="utf-8")
        self._log_file = self.log_path
        self._log_handle = log_handle

        cmd = [
            "/usr/bin/gnome-shell",
            "--wayland",
            "--headless",
            "--virtual-monitor",
            self.virtual_monitor,
        ]
        if self.automation_script is not None:
            cmd.extend(["--automation-script", str(self.automation_script)])

        return subprocess.Popen(
            cmd,
            stdout=log_handle,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )

    def _discover_displays(
        self, shell_proc: subprocess.Popen, timeout: float = 30.0
    ) -> tuple[str, str]:
        display_ready = threading.Event()
        display_name: str | None = None
        x11_display: str | None = None

        def _tail_stderr() -> None:
            nonlocal display_name, x11_display
            assert shell_proc.stderr is not None
            with self.log_path.open("a", encoding="utf-8") as log_f:
                for line in shell_proc.stderr:
                    log_f.write(line)
                    log_f.flush()
                    m = re.search(r"Using Wayland display name '(wayland-\d+)'", line)
                    if m:
                        display_name = m.group(1)
                    m2 = re.search(r"Using public X11 display (:\d+)", line)
                    if m2:
                        x11_display = m2.group(1)
                    if display_name and x11_display:
                        display_ready.set()

        threading.Thread(target=_tail_stderr, daemon=True).start()

        if not display_ready.wait(timeout=timeout):
            raise TimeoutError(
                f"gnome-shell did not announce displays within {timeout}s "
                f"(wayland={display_name}, x11={x11_display})"
            )
        assert display_name is not None
        assert x11_display is not None
        return display_name, x11_display

    def _wait_for_wayland_socket(self, display_name: str, timeout: float = 30.0) -> None:
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

    def _update_activation_environment(self, env: dict[str, str]) -> None:
        subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.freedesktop.DBus",
                "--object-path",
                "/org/freedesktop/DBus",
                "--method",
                "org.freedesktop.DBus.UpdateActivationEnvironment",
                f"{{'WAYLAND_DISPLAY': '{self.display_name}', 'DISPLAY': '{self.x11_display}'}}",
            ],
            env=env,
            capture_output=True,
        )

    @staticmethod
    def _extension_info_active(output: str) -> bool:
        if "'enabled': <true>" in output or '"enabled": true' in output:
            return True
        return bool(
            re.search(r"'state': <1(?:\.0)?>", output)
            or re.search(r"state.*<1>", output)
            or "<uint32 1>" in output
        )

    def enable_extension(self, uuid: str = UUID) -> None:
        env = self._session_env
        _info("Enabling extension…")
        enable_r = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell",
                "--object-path",
                "/org/gnome/Shell",
                "--method",
                "org.gnome.Shell.Extensions.EnableExtension",
                uuid,
            ],
            env=env,
            capture_output=True,
            text=True,
        )
        if enable_r.returncode != 0:
            raise RuntimeError(f"EnableExtension failed: {enable_r.stderr.strip()}")

        last_output = ""
        for _ in range(50):
            r = subprocess.run(
                [
                    "gdbus",
                    "call",
                    "--session",
                    "--dest",
                    "org.gnome.Shell",
                    "--object-path",
                    "/org/gnome/Shell",
                    "--method",
                    "org.gnome.Shell.Extensions.GetExtensionInfo",
                    uuid,
                ],
                env=env,
                capture_output=True,
                text=True,
            )
            last_output = r.stdout
            if self._extension_info_active(r.stdout):
                _pass("Extension is ACTIVE")
                return
            time.sleep(0.2)

        raise RuntimeError(f"Extension not ACTIVE. GetExtensionInfo output:\n{last_output}")

    def set_gsettings(self, schema: str, key: str, value: str) -> None:
        subprocess.run(
            ["gsettings", "set", schema, key, value],
            env=self._session_env,
            capture_output=True,
            text=True,
            check=True,
        )

    def __enter__(self) -> SessionInfo:
        self.session_dir.mkdir(parents=True, exist_ok=True)

        if self.isolate_xdg:
            self._setup_xdg_layout()

        self.dbus_proc, self.dbus_addr = start_dbus_session()
        self.mocks = start_mocks(self.dbus_addr)
        self._session_env = self._build_session_env(self.dbus_addr)

        if self.isolate_xdg:
            self._apply_gsettings_defaults(self._session_env)

        self.shell_proc = self._start_gnome_shell(self._session_env)
        self.display_name, self.x11_display = self._discover_displays(self.shell_proc)
        self._wait_for_wayland_socket(self.display_name)
        wait_for_shell_dbus(self.dbus_addr)
        time.sleep(1)
        self._update_activation_environment(self._session_env)

        if self.enable_before_ready:
            self.enable_extension()

        assert self.shell_proc is not None
        assert self.dbus_proc is not None
        return SessionInfo(
            session_dir=self.session_dir,
            dbus_addr=self.dbus_addr,
            wayland_display=self.display_name,
            x11_display=self.x11_display,
            log_path=self.log_path,
            shell_pid=self.shell_proc.pid,
            dbus_daemon_pid=self.dbus_proc.pid,
            mock_pids=[p.pid for p in self.mocks if p.pid is not None],
        )

    def __exit__(self, *_exc: object) -> None:
        _info("Cleaning up headless shell session…")
        if self.shell_proc is not None:
            self.shell_proc.terminate()
            try:
                self.shell_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.shell_proc.kill()
                self.shell_proc.wait()
            if self.shell_proc.stderr is not None:
                try:
                    self.shell_proc.stderr.close()
                except OSError:
                    pass
            self.shell_proc = None
        if self._log_handle is not None:
            try:
                self._log_handle.close()
            except OSError:
                pass
            self._log_handle = None
        for proc in self.mocks:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        self.mocks = []
        if self.dbus_proc is not None:
            if self.dbus_proc.stdout is not None:
                try:
                    self.dbus_proc.stdout.close()
                except OSError:
                    pass
            self.dbus_proc.terminate()
            try:
                self.dbus_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.dbus_proc.kill()
            self.dbus_proc = None
        _info("Headless shell session teardown complete")


def gnome_shell_available() -> bool:
    return pathlib.Path("/usr/bin/gnome-shell").is_file()
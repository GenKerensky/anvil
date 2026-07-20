#!/usr/bin/env python3
"""
Agent-driven GNOME Shell debug loop orchestrator (single iteration per invoke).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "test" / "lib"))

from debug_loop_utils import (  # noqa: E402
    ensure_private_session_dir,
    repo_relative_path,
    stage_repro_script,
    validate_script_path,
)
from host_guard import (  # noqa: E402
    HostSessionError,
    assert_debug_loop_sentinel,
    assert_host_safe,
    assert_launch_display_unset,
    assert_xdg_under_session,
    get_host_bus_fingerprint,
    is_safe_teardown_target,
)
from log_analysis import ANVIL_PATTERNS, analyze_log, tail_lines, write_excerpt_snip  # noqa: E402
from runner_utils import _info, parse_repro_results  # noqa: E402
from shell_session import UUID, HeadlessShellSession  # noqa: E402

DEFAULT_RESULTS_BASENAME = "repro-results.json"
LEGACY_DEFAULT_RESULTS = "/tmp/anvil-debug-repro-results.json"
SCHEMA_VERSION = 1
TERMINAL_STATES = frozenset({"CRASH", "ABORT", "INTERRUPTED"})


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iteration_path(session_dir: pathlib.Path, n: int) -> pathlib.Path:
    return session_dir / f"iteration-{n:03d}.json"


def snip_path(session_dir: pathlib.Path, n: int) -> pathlib.Path:
    return session_dir / f"iteration-{n:03d}.log.snip"


def meta_path(session_dir: pathlib.Path) -> pathlib.Path:
    return session_dir / "meta.json"


def resolve_results_path(session_dir: pathlib.Path, results_arg: str | None) -> pathlib.Path:
    if results_arg and results_arg != LEGACY_DEFAULT_RESULTS:
        return pathlib.Path(results_arg)
    return session_dir / DEFAULT_RESULTS_BASENAME


def read_meta(session_dir: pathlib.Path) -> dict[str, Any]:
    path = meta_path(session_dir)
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def write_meta(session_dir: pathlib.Path, data: dict[str, Any]) -> None:
    meta_path(session_dir).write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )


def update_live_meta(
    session_dir: pathlib.Path,
    *,
    session_info: Any,
    host_bus: str | None,
    started: str,
    iteration: int,
) -> None:
    meta = read_meta(session_dir)
    meta.update(
        {
            "projectRoot": str(PROJECT_ROOT),
            "uuid": UUID,
            "sessionModel": "launcher-style",
            "created": meta.get("created", started),
            "lastIteration": iteration,
            "hostBusFingerprint": host_bus,
            "isolatedBusFingerprint": session_info.dbus_addr,
            "waylandDisplay": session_info.wayland_display,
            "shellPid": session_info.shell_pid,
            "dbusDaemonPid": session_info.dbus_daemon_pid,
            "mockPids": list(session_info.mock_pids),
        }
    )
    write_meta(session_dir, meta)


def clear_live_meta_pids(session_dir: pathlib.Path) -> None:
    meta = read_meta(session_dir)
    meta["shellPid"] = None
    meta["dbusDaemonPid"] = None
    meta["mockPids"] = []
    write_meta(session_dir, meta)


def pid_running(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def kill_pid(pid: int | None, sig: int = signal.SIGTERM) -> None:
    if pid and pid_running(pid):
        try:
            os.kill(pid, sig)
        except OSError:
            pass


def kill_pid_if_safe(
    pid: int | None,
    *,
    session_dir: pathlib.Path,
    meta: dict[str, Any],
    role: str,
    sig: int = signal.SIGTERM,
) -> bool:
    if not pid:
        return False
    if not is_safe_teardown_target(
        int(pid),
        session_dir=session_dir,
        meta=meta,
        role=role,
    ):
        return False
    kill_pid(int(pid), sig=sig)
    return True


def create_session_dir() -> pathlib.Path:
    session_dir = pathlib.Path(tempfile.mkdtemp(prefix="anvil-debug-loop."))
    ensure_private_session_dir(session_dir)
    return session_dir


def teardown_session(session_dir: pathlib.Path, *, rm_session_dir: bool = False) -> dict[str, Any]:
    meta = read_meta(session_dir)
    kill_pid_if_safe(meta.get("shellPid"), session_dir=session_dir, meta=meta, role="shell")
    for mock_pid in meta.get("mockPids", []):
        kill_pid_if_safe(mock_pid, session_dir=session_dir, meta=meta, role="mock")
    kill_pid_if_safe(meta.get("dbusDaemonPid"), session_dir=session_dir, meta=meta, role="dbus")

    meta["shellPid"] = None
    meta["dbusDaemonPid"] = None
    meta["mockPids"] = []
    if session_dir.is_dir():
        write_meta(session_dir, meta)
        if rm_session_dir:
            shutil.rmtree(session_dir, ignore_errors=True)
    return meta


def refresh_extension_symlink(session_dir: pathlib.Path) -> None:
    ext_target = session_dir / "data" / "gnome-shell" / "extensions" / UUID
    ext_target.parent.mkdir(parents=True, exist_ok=True)
    if ext_target.exists() or ext_target.is_symlink():
        ext_target.unlink()
    ext_target.symlink_to((PROJECT_ROOT / "dist").resolve())


def build_extension() -> None:
    _info("Building extension (make build debug)…")
    subprocess.run(
        ["make", "-C", str(PROJECT_ROOT), "build", "debug"],
        check=True,
    )


def start_log_tail_thread(log_path: pathlib.Path) -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()

    def _worker() -> None:
        pos = 0
        while not stop_event.is_set():
            if log_path.is_file():
                try:
                    with log_path.open(encoding="utf-8", errors="replace") as handle:
                        handle.seek(pos)
                        while not stop_event.is_set():
                            line = handle.readline()
                            if not line:
                                break
                            pos = handle.tell()
                except OSError:
                    pass
            stop_event.wait(0.3)

    thread = threading.Thread(target=_worker, daemon=True, name="debug-loop-log-tail")
    thread.start()
    return stop_event, thread


def wait_for_results_file(
    results_path: pathlib.Path,
    timeout: float,
    shell_pid: int,
) -> tuple[dict[str, Any] | None, str]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not pid_running(shell_pid):
            return None, "shell_crash"
        if results_path.is_file():
            try:
                data = json.loads(results_path.read_text(encoding="utf-8"))
                return data, "results_file"
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.5)
    return None, "timeout"


def get_extension_state(dbus_addr: str) -> tuple[str, list[str]]:
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": dbus_addr}
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
            UUID,
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    state = "UNKNOWN"
    if HeadlessShellSession._extension_info_active(r.stdout):
        state = "ACTIVE"
    elif "<2>" in r.stdout:
        state = "ERROR"
    errors: list[str] = []
    if re.search(r"'error': <'[^']+'", r.stdout):
        errors.append(r.stdout.strip()[:500])
    return state, errors


def _script_doc(
    script_source: pathlib.Path | None,
    session_dir: pathlib.Path,
    exit_reason: str,
    results_path: pathlib.Path,
) -> dict[str, Any]:
    return {
        "sourcePath": repo_relative_path(script_source, PROJECT_ROOT) if script_source else "",
        "auditCopyPath": str(session_dir / "repro.js"),
        "exitReason": exit_reason,
        "resultsPath": str(results_path),
    }


def cmd_preflight(args: argparse.Namespace) -> int:
    host_bus = get_host_bus_fingerprint()
    try:
        assert_debug_loop_sentinel()
        assert_launch_display_unset()
        guardrails = {
            "hostBusBlocked": True,
            "isolatedXdg": True,
            "sessionModel": "launcher-style",
            "sentinels": {"ANVIL_DEBUG_LOOP": True, "ANVIL_ISOLATED_SESSION": False},
        }
        session_validation: dict[str, Any] | None = None
        if args.session_dir:
            session_dir = pathlib.Path(args.session_dir)
            if session_dir.is_dir():
                data = session_dir / "data"
                config = session_dir / "config"
                cache = session_dir / "cache"
                runtime = session_dir / "runtime"
                if data.is_dir() and config.is_dir():
                    assert_xdg_under_session(
                        session_dir,
                        xdg_runtime=str(runtime),
                        xdg_data=str(data),
                        xdg_config=str(config),
                        xdg_cache=str(cache) if cache.is_dir() else str(cache),
                    )
                    session_validation = {
                        "sessionDir": str(session_dir),
                        "xdgValidated": True,
                    }
        payload = {
            "ok": True,
            "phase": "early",
            "hostBus": host_bus,
            "guardrails": guardrails,
            "sessionValidation": session_validation,
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print("Preflight OK (phase: early)")
        return 0
    except HostSessionError as exc:
        payload = {"ok": False, "phase": "early", "error": str(exc)}
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print(f"Preflight FAILED: {exc}", file=sys.stderr)
        return 2


def cmd_teardown(args: argparse.Namespace) -> int:
    try:
        assert_debug_loop_sentinel()
    except HostSessionError as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}))
        else:
            print(f"Teardown FAILED: {exc}", file=sys.stderr)
        return 2
    session_dir = pathlib.Path(args.session_dir)
    teardown_session(session_dir, rm_session_dir=args.rm_session_dir)
    if args.json:
        print(json.dumps({"ok": True, "sessionDir": str(session_dir)}))
    else:
        print(f"Teardown complete: {session_dir}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    session_dir = pathlib.Path(args.session_dir)
    if args.iteration:
        path = iteration_path(session_dir, args.iteration)
    else:
        paths = sorted(session_dir.glob("iteration-*.json"))
        if not paths:
            print("No iteration JSON found", file=sys.stderr)
            return 1
        path = paths[-1]
    if not path.is_file():
        print(f"Not found: {path}", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    if args.json:
        print(text, end="")
    else:
        print(text)
    return 0


def cmd_tail(args: argparse.Namespace) -> int:
    session_dir = pathlib.Path(args.session_dir)
    log_path = session_dir / "gnome-shell.log"
    filters = args.filter if args.filter else list(ANVIL_PATTERNS)

    if args.follow:
        if not log_path.is_file():
            log_path.touch()
        lineno = sum(1 for _ in log_path.open(encoding="utf-8", errors="replace"))
        with log_path.open(encoding="utf-8", errors="replace") as handle:
            handle.seek(0, os.SEEK_END)
            try:
                while True:
                    line = handle.readline()
                    if not line:
                        time.sleep(0.2)
                        continue
                    lineno += 1
                    if filters and not any(re.search(p, line, re.IGNORECASE) for p in filters):
                        continue
                    if args.json:
                        print(json.dumps({"line": line.rstrip("\n"), "lineno": lineno}))
                    else:
                        print(line, end="")
            except KeyboardInterrupt:
                return 130
        return 0

    rows = tail_lines(log_path, lines=args.lines, filters=filters)
    if args.json:
        for line_no, line in rows:
            print(json.dumps({"line": line, "lineno": line_no}))
    else:
        for _, line in rows:
            print(line)
    return 0


def _abort_iteration(
    iteration_doc: dict[str, Any],
    session_dir: pathlib.Path | None,
    args: argparse.Namespace,
    started: str,
    shell_ready: str | None,
    *,
    keep_session: bool,
    state: str = "ABORT",
    exit_code: int = 2,
    message: str = "",
) -> int:
    iteration_doc["state"] = state
    iteration_doc["exitCode"] = exit_code
    if message:
        iteration_doc["results"] = {"passed": False, "message": message}
    if session_dir:
        try:
            teardown_session(session_dir)
        except OSError:
            pass
        _finalize_iteration(iteration_doc, session_dir, args, started, shell_ready, args.iteration)
        if not keep_session:
            shutil.rmtree(session_dir, ignore_errors=True)
    else:
        _emit_iteration(iteration_doc, args.json, session_dir)
    return exit_code


def cmd_run(args: argparse.Namespace) -> int:
    host_bus = get_host_bus_fingerprint()
    started = utc_now()
    iteration_doc: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "iteration": args.iteration,
        "state": "ABORT",
        "seam": "headless",
        "timestamps": {"started": started, "shellReady": None, "ended": None},
        "session": {},
        "extension": {"uuid": UUID, "state": "UNKNOWN", "errors": []},
        "script": {},
        "results": {},
        "logs": {},
        "analysis": {},
        "guardrails": {},
        "exitCode": 1,
    }

    session_dir: pathlib.Path | None = None
    session_info = None
    shell_ready: str | None = None
    exit_reason = ""
    keep_session = args.keep_session_dir
    log_tail_stop: threading.Event | None = None
    log_tail_thread: threading.Thread | None = None

    try:
        assert_debug_loop_sentinel()
        assert_launch_display_unset()
    except HostSessionError as exc:
        return _abort_iteration(
            iteration_doc, None, args, started, None, keep_session=keep_session, message=str(exc)
        )

    if args.dry_run:
        iteration_doc["state"] = "PREFLIGHT"
        iteration_doc["exitCode"] = 0
        iteration_doc["results"] = {"passed": True, "message": "dry-run preflight only"}
        _emit_iteration(iteration_doc, args.json, session_dir)
        return 0

    script_source: pathlib.Path | None = None
    if args.script:
        try:
            script_source = validate_script_path(pathlib.Path(args.script), PROJECT_ROOT)
        except (ValueError, FileNotFoundError) as exc:
            return _abort_iteration(
                iteration_doc, None, args, started, None, keep_session=True, message=str(exc)
            )

    if not args.no_build:
        try:
            build_extension()
        except subprocess.CalledProcessError:
            return _abort_iteration(
                iteration_doc, None, args, started, None, keep_session=True, message="build failed"
            )

    dist_dir = PROJECT_ROOT / "dist"
    if not (dist_dir / "extension.js").is_file():
        return _abort_iteration(
            iteration_doc,
            None,
            args,
            started,
            None,
            keep_session=True,
            message=f"dist/ not built at {dist_dir}",
        )

    automation_script: pathlib.Path | None = None
    if args.session_dir:
        session_dir = pathlib.Path(args.session_dir)
        ensure_private_session_dir(session_dir)
        meta = read_meta(session_dir)
        if pid_running(meta.get("shellPid")) or pid_running(meta.get("dbusDaemonPid")):
            teardown_session(session_dir)
        refresh_extension_symlink(session_dir)
    else:
        session_dir = create_session_dir()

    results_path = resolve_results_path(session_dir, args.results_path)
    if results_path.exists():
        results_path.unlink()

    if script_source:
        automation_script = stage_repro_script(session_dir, script_source, PROJECT_ROOT)

    extra_env = {
        "ANVIL_DEBUG_LOOP": "1",
        "ANVIL_DEBUG_RESULTS": str(results_path),
        "ANVIL_PROJECT_ROOT": str(PROJECT_ROOT),
    }

    try:
        with HeadlessShellSession(
            session_dir=session_dir,
            extension_dir=dist_dir,
            automation_script=automation_script,
            isolate_xdg=True,
            extra_env=extra_env,
            project_root=PROJECT_ROOT,
        ) as session_info:
            shell_ready = utc_now()
            update_live_meta(
                session_dir,
                session_info=session_info,
                host_bus=host_bus,
                started=started,
                iteration=args.iteration,
            )

            xdg_data = str(session_dir / "data")
            xdg_config = str(session_dir / "config")
            xdg_cache = str(session_dir / "cache")
            xdg_runtime = str(session_dir / "runtime")
            guardrails = assert_host_safe(
                session_dir,
                host_bus=host_bus,
                isolated_bus=session_info.dbus_addr,
                shell_pid=session_info.shell_pid,
                require_isolated_xdg=True,
                xdg_runtime=xdg_runtime,
                xdg_data=xdg_data,
                xdg_config=xdg_config,
                xdg_cache=xdg_cache,
            )
            iteration_doc["guardrails"] = guardrails
            iteration_doc["session"] = {
                "dir": str(session_dir),
                "waylandDisplay": session_info.wayland_display,
                "dbusAddress": session_info.dbus_addr,
                "shellPid": session_info.shell_pid,
            }

            ext_state, ext_errors = get_extension_state(session_info.dbus_addr)
            iteration_doc["extension"]["state"] = ext_state
            iteration_doc["extension"]["errors"] = ext_errors

            if automation_script:
                iteration_doc["state"] = "RUN_SCRIPT"
                log_tail_stop, log_tail_thread = start_log_tail_thread(session_dir / "gnome-shell.log")
                results_data, exit_reason = wait_for_results_file(
                    results_path,
                    args.timeout,
                    session_info.shell_pid,
                )
            else:
                iteration_doc["state"] = "OBSERVE"
                exit_reason = "observe"
                time.sleep(args.observe)
                results_data = None

            if not pid_running(session_info.shell_pid) and exit_reason != "results_file":
                iteration_doc["state"] = "CRASH"
                iteration_doc["exitCode"] = 3
                iteration_doc["results"] = {
                    "passed": False,
                    "message": "gnome-shell crashed",
                }
                iteration_doc["script"] = _script_doc(
                    script_source, session_dir, exit_reason, results_path
                )
            elif results_data is not None:
                passed, message = parse_repro_results(results_data)
                iteration_doc["results"] = {
                    "passed": passed,
                    "message": message,
                    "schema": "debug-loop-v1",
                }
                iteration_doc["script"] = _script_doc(
                    script_source, session_dir, exit_reason, results_path
                )
                iteration_doc["exitCode"] = 0 if passed else 1
            elif automation_script:
                iteration_doc["results"] = {
                    "passed": False,
                    "message": f"Script timeout ({args.timeout}s)",
                }
                iteration_doc["script"] = _script_doc(
                    script_source, session_dir, exit_reason, results_path
                )
                iteration_doc["exitCode"] = 1
            else:
                iteration_doc["results"] = {
                    "passed": True,
                    "message": f"Observe mode ({args.observe}s)",
                }
                iteration_doc["exitCode"] = 0

    except HostSessionError as exc:
        return _abort_iteration(
            iteration_doc, session_dir, args, started, shell_ready, keep_session=keep_session, message=str(exc)
        )
    except KeyboardInterrupt:
        iteration_doc["state"] = "INTERRUPTED"
        iteration_doc["exitCode"] = 130
        iteration_doc["results"] = {"passed": False, "message": "Interrupted"}
        if session_dir:
            teardown_session(session_dir)
        _finalize_iteration(
            iteration_doc, session_dir, args, started, shell_ready, args.iteration
        )
        return 130
    except Exception as exc:
        return _abort_iteration(
            iteration_doc,
            session_dir,
            args,
            started,
            shell_ready,
            keep_session=keep_session,
            message=f"{type(exc).__name__}: {exc}",
        )
    finally:
        if log_tail_stop is not None:
            log_tail_stop.set()
        if log_tail_thread is not None:
            log_tail_thread.join(timeout=1)

    analysis = write_excerpt_snip(
        session_dir / "gnome-shell.log",
        snip_path(session_dir, args.iteration),
    )
    iteration_doc["logs"] = {
        "totalLines": analysis.stats.total_lines,
        "anvilLines": analysis.stats.anvil_lines,
        "warnings": analysis.stats.warnings,
        "errors": analysis.stats.errors,
        "jsStacks": analysis.stats.js_stacks,
        "excerptPath": snip_path(session_dir, args.iteration).name,
    }
    iteration_doc["analysis"] = {
        "signature": analysis.signature,
        "matchedPatterns": analysis.matched_patterns,
        "matchedMarkers": analysis.matched_markers,
        "suggestedNextSteps": analysis.suggested_next_steps,
    }

    if (
        args.success_pattern
        and exit_reason != "shell_crash"
        and iteration_doc["exitCode"] not in (1, 3)
        and re.search(
            args.success_pattern,
            "\n".join(analysis.excerpt_lines),
            re.IGNORECASE,
        )
    ):
        iteration_doc["results"]["passed"] = True
        iteration_doc["exitCode"] = 0

    _finalize_iteration(iteration_doc, session_dir, args, started, shell_ready, args.iteration)

    if not keep_session and session_dir:
        shutil.rmtree(session_dir, ignore_errors=True)

    return int(iteration_doc["exitCode"])


def _finalize_iteration(
    doc: dict[str, Any],
    session_dir: pathlib.Path | None,
    args: argparse.Namespace,
    started: str,
    shell_ready: str | None,
    iteration: int,
) -> None:
    doc["timestamps"]["ended"] = utc_now()
    if shell_ready:
        doc["timestamps"]["shellReady"] = shell_ready
    if doc["state"] not in TERMINAL_STATES:
        doc["state"] = "REPORT"
    if session_dir:
        iteration_path(session_dir, iteration).write_text(
            json.dumps(doc, indent=2) + "\n",
            encoding="utf-8",
        )
        clear_live_meta_pids(session_dir)
        meta = read_meta(session_dir)
        meta.update(
            {
                "projectRoot": str(PROJECT_ROOT),
                "uuid": UUID,
                "sessionModel": "launcher-style",
                "created": meta.get("created", started),
                "lastIteration": iteration,
                "hostBusFingerprint": get_host_bus_fingerprint(),
                "isolatedBusFingerprint": doc.get("session", {}).get("dbusAddress"),
                "waylandDisplay": doc.get("session", {}).get("waylandDisplay"),
            }
        )
        write_meta(session_dir, meta)
    _emit_iteration(doc, args.json, session_dir)


def _emit_iteration(
    doc: dict[str, Any],
    as_json: bool,
    session_dir: pathlib.Path | None,
) -> None:
    if as_json:
        print(json.dumps(doc, indent=2))
    elif session_dir:
        print(f"Iteration report: {iteration_path(session_dir, doc.get('iteration', 1))}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Anvil agent debug loop orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--json", action="store_true", help="Emit JSON")

    p_preflight = sub.add_parser("preflight", help="Run guardrails only")
    add_common(p_preflight)
    p_preflight.add_argument(
        "--session-dir",
        default="",
        help="Optional existing session dir for XDG layout validation",
    )

    p_run = sub.add_parser("run", help="Single debug iteration")
    add_common(p_run)
    p_run.add_argument("--script", help="Automation script under test/debug/")
    p_run.add_argument("--no-build", action="store_true")
    p_run.add_argument("--session-dir", help="Reuse session directory")
    p_run.add_argument(
        "--keep-session-dir",
        dest="keep_session_dir",
        action="store_true",
        default=True,
        help="Retain session dir on exit (default)",
    )
    p_run.add_argument(
        "--rm-session-dir",
        dest="keep_session_dir",
        action="store_false",
        help="Delete session dir on exit",
    )
    p_run.add_argument("--iteration", type=int, default=1)
    p_run.add_argument("--timeout", type=float, default=120.0)
    p_run.add_argument("--observe", type=float, default=30.0)
    p_run.add_argument("--success-pattern")
    p_run.add_argument(
        "--results-path",
        default=LEGACY_DEFAULT_RESULTS,
        help=f"Default: $SESSION_DIR/{DEFAULT_RESULTS_BASENAME}",
    )
    p_run.add_argument("--dry-run", action="store_true")

    p_tail = sub.add_parser("tail", help="Tail gnome-shell.log")
    add_common(p_tail)
    p_tail.add_argument("--session-dir", required=True)
    p_tail.add_argument("--follow", action="store_true")
    p_tail.add_argument("--lines", type=int, default=200)
    p_tail.add_argument("--filter", action="append")

    p_status = sub.add_parser("status", help="Print iteration JSON")
    add_common(p_status)
    p_status.add_argument("--session-dir", required=True)
    p_status.add_argument("--iteration", type=int)

    p_teardown = sub.add_parser("teardown", help="Kill orphaned processes")
    add_common(p_teardown)
    p_teardown.add_argument("--session-dir", required=True)
    p_teardown.add_argument("--rm-session-dir", action="store_true")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "preflight":
        return cmd_preflight(args)
    if args.command == "run":
        return cmd_run(args)
    if args.command == "tail":
        return cmd_tail(args)
    if args.command == "status":
        return cmd_status(args)
    if args.command == "teardown":
        return cmd_teardown(args)
    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

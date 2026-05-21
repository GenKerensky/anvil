#!/usr/bin/env python3
"""
Parallel Anvil Integration Test Runner — runs all Fedora versions concurrently.

Launches one container per Fedora version (42, 43, 44) in parallel,
prefixes each output line with the version tag for readability, and
aggregates exit codes.

Usage
=====

    python3 test/integration/run-all.py          # parallel: 42 + 43 + 44
    python3 test/integration/run-all.py --help   # full options

Without this script the three versions run sequentially and wall-clock time is
the *sum* of three ~70 s runs (~210 s).  With this script wall-clock time
drops to the *max* of three overlapping runs (~75 s = container startup +
longest test run).
"""

from __future__ import annotations

import argparse
import io
import pathlib
import subprocess
import sys
import threading

# ── Configuration ──────────────────────────────────────────────────────────────

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DEFAULT_VERSIONS = ["42", "43", "44"]


# ── Streaming version-prefixed output reader ──────────────────────────────────


def _reader_thread(
    stream: io.TextIOBase,
    version: str,
    lines: list[str],
    lock: threading.Lock,
) -> None:
    """Read a subprocess stdout/stderr line by line and append to ``lines``."""
    try:
        for line in iter(stream.readline, ""):
            with lock:
                print(f"[Fedora {version}] {line}", end="", flush=True)
                lines.append(line)
    except ValueError:
        pass  # stream closed
    finally:
        stream.close()


# ── Per-version runner ────────────────────────────────────────────────────────


def run_version(
    version: str,
    shard: int | None = None,
    total_shards: int | None = None,
) -> dict:
    """
    Run one Fedora version in a subprocess, streaming output with a version
    prefix in real time.
    """
    cmd = [sys.executable, str(SCRIPT_DIR / "run.py"), "-v", version]
    if shard is not None:
        cmd.extend(["--shard", str(shard), "--total-shards", str(total_shards or 1)])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    lines: list[str] = []
    lock = threading.Lock()

    thread = threading.Thread(
        target=_reader_thread,
        args=(proc.stdout, version, lines, lock),
        daemon=True,
    )
    thread.start()
    thread.join()
    proc.wait()

    return {"version": version, "returncode": proc.returncode}


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Anvil Integration Tests — Parallel (all Fedora versions)"
    )
    parser.add_argument(
        "--versions",
        default=",".join(DEFAULT_VERSIONS),
        help="Comma-separated Fedora versions (default: 42,43,44)",
    )
    parser.add_argument(
        "--shard", type=int, default=None,
        help="Shard index (1-based) — only applies when running a single version",
    )
    parser.add_argument(
        "--total-shards", type=int, default=1,
        help="Total number of shards (default: 1)",
    )

    args = parser.parse_args()
    versions = [v.strip() for v in args.versions.split(",") if v.strip()]

    print("")
    print("╔══════════════════════════════════════════════════════════════╗")
    print(f"║  Anvil Integration Tests — Parallel ({len(versions)} versions)          ║")
    print(f"║  Fedora: {', '.join(versions)}                                       ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print("")

    # ── Pre-flight checks (just once) ──
    if not _command_exists("podman"):
        print("  ✗ podman is not installed or not in PATH", flush=True)
        return 1

    # ── Launch all versions in parallel ──
    threads: list[threading.Thread] = []
    results: list[dict] = []
    results_lock = threading.Lock()

    def _run(ver: str) -> None:
        r = run_version(ver, args.shard, args.total_shards)
        with results_lock:
            results.append(r)

    for v in versions:
        t = threading.Thread(target=_run, args=(v,), daemon=True)
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # ── Summary ──
    print("")
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  Summary                                                    ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print("")
    exit_code = 0
    # Build a lookup keyed by version for ordered display
    result_map: dict[str, int] = {}
    for r in results:
        result_map[r["version"]] = r["returncode"]
    for v in versions:
        rc = result_map.get(v, -1)
        status = "PASS" if rc == 0 else "FAIL"
        if rc != 0:
            exit_code = 1
        print(f"  Fedora {v}: {status}", flush=True)

    print("")
    return exit_code


def _command_exists(name: str) -> bool:
    return subprocess.run(["which", name], capture_output=True).returncode == 0


if __name__ == "__main__":
    sys.exit(main())

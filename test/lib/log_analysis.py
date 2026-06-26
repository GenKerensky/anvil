"""
Anvil-specific log grep, stack extraction, and failure signature classification.
"""

from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass, field

ANVIL_PATTERNS = [
    r"\[Anvil\].*",
    r"extension.*anvil@GenKerensky\.github\.com.*error",
    r"clutter_critical|JS ERROR|Unhandled promise rejection",
    r"backtrace-warnings",
    r"\[SharedCommands\].*",
    r"\[DEBUG_LOOP\].*",
]

SIGNATURE_RULES: list[tuple[str, str]] = [
    ("extension-crash", r"Extension error.*anvil"),
    ("resize-clamp", r"\[Anvil\].*resize|_resizedWindows"),
    ("wl-clipboard", r"wl-clipboard|isEphemeralHelperWindow"),
    ("proxy-blocked", r"getSettings|extWm.*null"),
]

SIGNATURE_HINTS: dict[str, list[str]] = {
    "extension-crash": [
        "Check Extensions tab errors via GetExtensionInfo D-Bus",
        "Grep gnome-shell.log for JS stack after 'Extension error'",
    ],
    "resize-clamp": [
        "Inspect _resizedWindows Map in src/lib/extension/window.ts",
        "Verify count ≥ 2 before resize exemption (decisions.md)",
    ],
    "wl-clipboard": [
        "Confirm Utils.isEphemeralHelperWindow() matches wm class",
        "Check src/config/windows.json float entry for wl-clipboard",
    ],
    "proxy-blocked": [
        "Use global.__anvil_extWm / global.__anvil_settings, not ext.extWm",
        "Ensure test-mode=true before enable in isolated session",
    ],
}

_STACK_MARKERS = (
    "JS ERROR",
    "backtrace-warnings",
    "Unhandled promise rejection",
    "clutter_critical",
    "===== JS stack trace =====",
    "Extension error",
)


@dataclass
class LogStats:
    total_lines: int = 0
    anvil_lines: int = 0
    warnings: int = 0
    errors: int = 0
    js_stacks: int = 0


@dataclass
class LogAnalysis:
    stats: LogStats = field(default_factory=LogStats)
    signature: str | None = None
    matched_patterns: list[str] = field(default_factory=list)
    matched_markers: list[str] = field(default_factory=list)
    suggested_next_steps: list[str] = field(default_factory=list)
    excerpt_lines: list[str] = field(default_factory=list)


def _compiled_anvil_patterns() -> list[re.Pattern[str]]:
    return [re.compile(p, re.IGNORECASE) for p in ANVIL_PATTERNS]


def line_matches_anvil(line: str, patterns: list[re.Pattern[str]] | None = None) -> bool:
    pats = patterns or _compiled_anvil_patterns()
    return any(p.search(line) for p in pats)


def parse_log_lines(lines: list[str]) -> LogStats:
    stats = LogStats(total_lines=len(lines))
    anvil_pats = _compiled_anvil_patterns()
    for line in lines:
        if line_matches_anvil(line, anvil_pats):
            stats.anvil_lines += 1
        if re.search(r"\[Anvil\].*\[WARN\]", line, re.IGNORECASE) or re.search(
            r"\[DEBUG_LOOP\].*\[WARN\]", line, re.IGNORECASE
        ):
            stats.warnings += 1
        if (
            re.search(r"\[Anvil\].*\[ERROR\]", line, re.IGNORECASE)
            or re.search(r"\[DEBUG_LOOP\].*\[ERROR\]", line, re.IGNORECASE)
            or re.search(r"JS ERROR|clutter_critical|Extension error", line, re.IGNORECASE)
        ):
            stats.errors += 1
        if any(marker in line for marker in _STACK_MARKERS):
            stats.js_stacks += 1
    return stats


def classify_signature(text: str) -> tuple[str | None, list[str], list[str]]:
    matched: list[str] = []
    markers: list[str] = []
    for name, pattern in SIGNATURE_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            matched.append(pattern)
            if "backtrace" in text.lower():
                markers.append("backtrace-warnings")
            return name, matched, markers
    return None, matched, markers


def build_excerpt(
    lines: list[str],
    *,
    max_anvil_lines: int = 200,
    include_stacks: bool = True,
) -> list[str]:
    anvil_pats = _compiled_anvil_patterns()
    anvil_hits = [ln for ln in lines if line_matches_anvil(ln, anvil_pats)]
    excerpt = anvil_hits[-max_anvil_lines:]
    if include_stacks:
        stack_lines = [ln for ln in lines if any(m in ln for m in _STACK_MARKERS)]
        seen = set(excerpt)
        for ln in stack_lines:
            if ln not in seen:
                excerpt.append(ln)
                seen.add(ln)
    return excerpt


def analyze_log(
    log_path: pathlib.Path,
    *,
    extra_patterns: list[str] | None = None,
    max_anvil_lines: int = 200,
) -> LogAnalysis:
    if not log_path.is_file():
        return LogAnalysis()

    lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    stats = parse_log_lines(lines)
    excerpt = build_excerpt(lines, max_anvil_lines=max_anvil_lines)
    full_text = "\n".join(lines)
    signature, matched, markers = classify_signature(full_text)
    if extra_patterns:
        for pat in extra_patterns:
            if re.search(pat, full_text, re.IGNORECASE):
                matched.append(pat)

    hints: list[str] = []
    if signature:
        hints = list(SIGNATURE_HINTS.get(signature, []))

    return LogAnalysis(
        stats=stats,
        signature=signature,
        matched_patterns=matched,
        matched_markers=markers,
        suggested_next_steps=hints,
        excerpt_lines=excerpt,
    )


def write_excerpt_snip(
    log_path: pathlib.Path,
    snip_path: pathlib.Path,
    *,
    max_anvil_lines: int = 200,
) -> LogAnalysis:
    analysis = analyze_log(log_path, max_anvil_lines=max_anvil_lines)
    snip_path.write_text("\n".join(analysis.excerpt_lines) + "\n", encoding="utf-8")
    return analysis


def tail_lines(
    log_path: pathlib.Path,
    *,
    lines: int = 200,
    filters: list[str] | None = None,
) -> list[tuple[int, str]]:
    if not log_path.is_file():
        return []
    all_lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    if filters:
        compiled = [re.compile(f, re.IGNORECASE) for f in filters]
        filtered = [
            (i + 1, ln) for i, ln in enumerate(all_lines) if any(p.search(ln) for p in compiled)
        ]
        return filtered[-lines:]
    return [(len(all_lines) - lines + i + 1, ln) for i, ln in enumerate(all_lines[-lines:])]
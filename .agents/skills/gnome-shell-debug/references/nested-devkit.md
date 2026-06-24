# Nested & Devkit Sessions

GJS cannot unload code — a **new GNOME Shell process** is required after every extension change.

## Default: isolated devkit (Anvil)

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```

This script:

- Runs `make build debug` unless `--no-build`
- Re-execs on the Bazzite host via `distrobox-host-exec` when invoked inside Distrobox
- Uses temporary XDG dirs so the real GNOME session is untouched
- Symlinks `dist/` as the extension, enables Anvil, auto-launches a terminal
- Writes logs to `$SESSION_DIR/gnome-shell.log` (path printed at start)

### Common flags

| Flag              | Effect                                     |
| ----------------- | ------------------------------------------ |
| `--no-build`      | Skip `make build debug`                    |
| `--no-terminal`   | Do not auto-launch a terminal              |
| `--terminal-cmd`  | Custom terminal command for nested session |
| `--keep-temp`     | Preserve temp XDG/log dir after exit       |
| `--shell-arg ARG` | Extra `gnome-shell` argument (repeatable)  |

Rebuild/retest loop:

```bash
make build debug
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh --no-build
```

## Manual nested shell

**GNOME 49+:**

```bash
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
dbus-run-session -- gnome-shell --devkit --wayland
```

**GNOME 48 and earlier:** replace `--devkit` with `--nested`.

## Alternative scripts

| Script                   | When to use                                                |
| ------------------------ | ---------------------------------------------------------- |
| `quick-debug-build.sh`   | Schema compile broken — installs debug build to `~/.local` |
| `start-debug-session.sh` | Quick capture to `/tmp/anvil-debug-session.log`            |
| `devkit-debug.sh`        | Legacy `make install` + devkit + log capture               |

## Headless vs devkit

See the **Headless Seam** section in the main [SKILL.md](../SKILL.md) for the authoritative differences, when to choose headless (explicit or self-sufficient tasks like settings toggles), `--virtual-monitor` usage, work-area notes, automation contract, and gotchas.

The Devkit Seam (default) is covered in detail above and in SKILL.md.

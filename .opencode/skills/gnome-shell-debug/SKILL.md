---
name: gnome-shell-debug
description: Debug GNOME Shell extensions and GJS code with logging, Looking Glass, nested sessions, GDB, and stack traces
license: MIT
compatibility: opencode
---

# GNOME Shell & GJS Debugging

Comprehensive debugging guide for GNOME Shell extensions running in GJS (GNOME's JavaScript runtime).

## Environment Variables

Enable additional debugging by setting `SHELL_DEBUG` before launching GNOME Shell:

| Value | Effect |
|---|---|
| `SHELL_DEBUG=backtrace-warnings` | Prints JS stack on `console.warn()` / `console.error()` |
| `SHELL_DEBUG=backtrace-segfaults` | Prints JS stack before exit on fatal crash |
| `SHELL_DEBUG=all` | Enables all debugging options |

Also useful: `G_MESSAGES_DEBUG=all` for verbose GLib output.

## Logging

Use the `console` API (built into GJS):

- `console.debug()` — development-only info (`GLib.LogLevelFlags.LEVEL_DEBUG`)
- `console.warn()` — unexpected errors, possible bugs (`LEVEL_WARNING`)
- `console.error()` — programmer errors, assertion failures (`LEVEL_CRITICAL`)

Logs go to `journalctl` (systemd) or `~/.xsession-errors`. View with:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Keep logging minimal — excessive output pollutes system logs.

## Looking Glass (REPL + Inspector)

Press `Alt+F2`, enter `lg` to open Looking Glass.

### Evaluator Tab (default)

Run arbitrary JS in the running GNOME Shell process. Pre-imported: `GLib`, `GObject`, `Gio`, `Clutter`, `Meta`, `St`, `Shell`, `Main`.

Built-in helpers:
- `r(index)` — retrieve a previous return value by index
- `inspect(x, y)` — get the `Clutter.Actor` at screen coordinates
- `stage` — alias for `global.stage`

Use the target icon (⌖) to click on screen elements and inspect them.

### Other Tabs

- **Windows**: List open windows, inspect `Meta.Window` or `Shell.App` objects
- **Extensions**: Show extension status, view errors, open source directory
- **Actors**: Browse the full Clutter actor tree
- **Flags**: Debug options for Clutter/Mutter (use with care)

## Running a Nested Shell

Start an isolated GNOME Shell in a window for rapid iteration:

**GNOME 49+**:
```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

**GNOME 48 and earlier**:
```bash
dbus-run-session -- gnome-shell --nested --wayland
```

Full script with debugging enabled:
```bash
#!/bin/sh -e
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
VERSION=$(gnome-shell --version | awk '{print int($3)}')
if [ "$VERSION" -ge 49 ]; then
    dbus-run-session -- gnome-shell --devkit --wayland
else
    dbus-run-session -- gnome-shell --nested --wayland
fi
```

**Important**: A new process is required for every code change — GJS cannot unload code.

## Restarting GNOME Shell (X11 only)

On X11: `Alt+F2` → `restart`. Reloads all extensions without logging out.

Wayland cannot restart while logged in. Log out and back in, or use a nested shell.

## GDB Debugging

Start GNOME Shell under GDB:
```bash
dbus-run-session -- gdb --args gnome-shell --devkit --wayland
(gdb) run
```

### Useful GDB commands

Print the JavaScript call stack:
```
(gdb) call (void)gjs_dumpstack()
```

Break on warnings/criticals:
```
(gdb) set env G_DEBUG=fatal-criticals
(gdb) set env G_DEBUG=fatal-warnings
```

Add a JS breakpoint programmatically in extension code:
```js
import { System } from 'gi://Gjs';  // or resource:///org/gnome/gjs/modules/system.js
System.breakpoint();  // triggers SIGTRAP halting the process
```

## Anvil-Specific Workflow

For this project (`anvil@GenKerensky.github.com`):

1. **Build + install**: `make dev` (builds and installs for dev)
2. **View logs**: `journalctl -f -o cat /usr/bin/gnome-shell | grep -i anvil`
3. **Check extension errors**: Open Looking Glass (`lg`) → Extensions tab → click "Errors" on Anvil
4. **Test in isolation**: Use the nested shell script above with `SHELL_DEBUG=all`
5. **Unit tests**: `npm run test:unit` (runs in Node.js with mocks — no GNOME runtime needed)
6. **E2E tests**: `make test-e2e` (headless Wayland in Podman)

The extension's entry point is `src/extension.ts`, with core logic in `src/lib/extension/`. The project logger is in `src/lib/shared/logger.ts`.

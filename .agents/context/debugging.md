# Headless / Devkit Debugging

## `--devkit` vs `--headless`

GNOME 49+ replaced `--nested` with `--devkit` (Wayland-native compositor, not X11-based).

| Flag         | Behavior                                              | Use case              |
| ------------ | ----------------------------------------------------- | --------------------- |
| `--devkit`   | Full Mutter Development Kit GUI + headless compositor | Interactive debugging |
| `--headless` | Headless compositor only, no devkit GUI               | CI / automated tests  |

Both support `--automation-script`. `--devkit` calls `export async function run()` on the script.

## Setting dummy monitor resolution

**Do NOT use `MUTTER_DEBUG_DUMMY_MODE_SPECS`** — only works for legacy `--nested` (X11). Use
`--virtual-monitor`:

```bash
# CORRECT: single 1920×1080 monitor
gnome-shell --wayland --headless --virtual-monitor 1920x1080 --automation-script test.js

# WRONG: --devkit adds a second unwanted 1280×800 monitor
gnome-shell --wayland --devkit --virtual-monitor 1920x1080 --automation-script test.js
```

`--headless` gives exactly the monitors you ask for. `--devkit` always adds 1280×800.

### Launch manually

```bash
dbus-run-session gnome-shell \
  --wayland --headless \
  --virtual-monitor 1920x1080 \
  --automation-script /tmp/my-test.js
```

Verify resolution inside the script:

```javascript
const display = global.display;
for (let i = 0; i < display.get_n_monitors(); i++) {
  const g = display.get_monitor_geometry(i);
  log(`Monitor ${i}: ${g.width}x${g.height}`);
}
```

## Gotchas

1. **Screenshots don't work in `--headless`** — use `--devkit` for visual debugging.
2. **`wtype` keyboard injection works in both** — when `WAYLAND_DISPLAY` points to the nested socket.
3. **Devkit steals focus** — mutter-devkit GTK window can interfere with automated key injection.
4. **`MUTTER_DEBUG_DUMMY_MODE_SPECS` is ignored** by headless/native backend.
5. **Multiple monitors**: `--virtual-monitor 1920x1080 --virtual-monitor 1280x720`.
6. **Work area ≠ monitor geometry** — top panel (32 px) reduces height. 1920×1080 → work area
   `{x:0, y:32, width:1920, height:1048}`.

For Looking Glass, GDB, and nested sessions, read `.agents/skills/gnome-shell-debug/SKILL.md`.

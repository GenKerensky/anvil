# Logging & Environment Variables

## SHELL_DEBUG

Set before launching GNOME Shell:

| Value                             | Effect                                           |
| --------------------------------- | ------------------------------------------------ |
| `SHELL_DEBUG=backtrace-warnings`  | JS stack on `console.warn()` / `console.error()` |
| `SHELL_DEBUG=backtrace-segfaults` | JS stack before exit on fatal crash              |
| `SHELL_DEBUG=all`                 | All debugging options                            |

Also useful: `G_MESSAGES_DEBUG=all` for verbose GLib output.

## console API (GJS)

- `console.debug()` — development info (`LEVEL_DEBUG`)
- `console.warn()` — unexpected errors (`LEVEL_WARNING`)
- `console.error()` — programmer errors (`LEVEL_CRITICAL`)

## Viewing logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell
journalctl -f -o cat /usr/bin/gnome-shell | grep -i anvil
```

Devkit sessions started by `scripts/run-devkit-session.sh` write to a temp log — path printed at launch.

## Gotchas

- Excessive logging pollutes system logs; gate verbose output behind `production` in `src/lib/shared/settings.js`.
- Anvil project logger: `src/lib/shared/logger.ts` — enable via GSettings `logging-enabled` / `log-level`.
- Wayland cannot `Alt+F2` → `restart`; use a nested/devkit session or log out to reload extension code.

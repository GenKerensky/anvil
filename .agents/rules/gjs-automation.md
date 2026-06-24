# GJS Automation-Script Pitfalls

When writing scripts for `gnome-shell --automation-script`:

- **Module-level code runs in both `--headless` and `--devkit`**, but `export async function run()`
  is only called by `--devkit`. Container runner uses top-level promise chains.
- **`GLib.Variant('(s)', value)`** for tuple types must wrap the string in an array: `['pong']` not
  `'pong'`. GJS 1.88 iterates a bare string, producing only the first character.
- **`Main.extensionManager.lookup(UUID).extWm`** can be `null` when state is ACTIVE; use
  `global.__anvil_test_state.extWm` (requires `test-mode=true` via Gio.Settings before enable).
- **`Gio.Settings({ schema_id })`** works when `GSETTINGS_SCHEMA_DIR` points to extension schemas —
  set in `start-session.sh` before launching gnome-shell.
- **jasmine-gjs bootstrap**: Import `file:///usr/share/jasmine-gjs/jasmineBoot.js`. Set
  `globalThis.jasmineImporter = imports['jasmine-gjs']` with correct `imports.searchPath`. Call
  `runner.installAPI(globalThis)`, then `env.execute()` — does NOT call `System.exit()`.
- **`gi://Atspi`**: Call `Atspi.init()` first. `Atspi.get_desktop(0)` for root. Check switches via
  `get_state_set().contains(Atspi.StateType.CHECKED)`. Click via `get_action_iface().do_action(0)`.
  Wrap in try/catch — stale nodes throw.

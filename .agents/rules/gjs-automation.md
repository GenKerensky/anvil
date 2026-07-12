# GJS Automation-Script Pitfalls

When writing scripts for `gnome-shell --automation-script`:

- **`export async function run()`** is the automation-script entrypoint on modern GNOME Shell
  (`--headless` and `--devkit` both call it). Implement E2E work in `run()` (see
  `test/e2e/runner.js`).
- **`GLib.Variant('(s)', value)`** for tuple types must wrap the string in an array: `['pong']` not
  `'pong'`. GJS 1.88 iterates a bare string, producing only the first character.
- **`Main.extensionManager.lookup(UUID).runtime`** can be `null` when state is ACTIVE; use
  `global.__anvil_test_state.runtime` or `global.__anvil_runtime` (requires `test-mode=true` via
  Gio.Settings before enable for test state).
- **`Gio.Settings({ schema_id })`** works when `GSETTINGS_SCHEMA_DIR` points to extension schemas.
- **jasmine-gjs bootstrap**: Import `file:///usr/share/jasmine-gjs/jasmineBoot.js`. Set
  `globalThis.jasmineImporter = imports['jasmine-gjs']` with correct `imports.searchPath`. Call
  `runner.installAPI(globalThis)`, then `env.execute()` — does NOT call `System.exit()`.

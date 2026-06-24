# Project Overview

Anvil is a GNOME Shell tiling extension (fork of Forge). It runs inside **GJS** (GNOME's JS
runtime), not Node.js. Source is **TypeScript**, compiled to JavaScript via `tsc` into the
`dist/` directory. Unit tests run in Node.js via vitest with hand-written mocks for all GJS/GNOME
APIs.

## GNOME Shell Runtime Model

### Process separation

| File                 | Process       | Available APIs                                | Unavailable                        |
| -------------------- | ------------- | --------------------------------------------- | ---------------------------------- |
| `src/extension.ts`   | gnome-shell   | Clutter, St, Meta, Shell, `global`, Gio, GLib | Gtk                                |
| `src/prefs.ts`       | isolated Gtk  | Gtk4, Adwaita, Gio, GLib                      | Clutter, St, Meta, Shell, `global` |
| `src/stylesheet.css` | Shell UI only | —                                             | Does NOT apply to prefs window     |

Once loaded, an extension effectively becomes part of GNOME Shell — it can access and modify **any**
internal Shell JS code or C library exposed via GObject-Introspection.

### Toolkit stack

```
St (buttons, entries, CSS)  →  builds on Clutter
Clutter (Actors, layouts)    →  base widget toolkit
Mutter / Meta                →  window/compositor API (displays, workspaces, windows)
Shell / global               →  Shell utilities + global state object
```

GObject-Introspection bridges all C libraries to GJS — `gi://Gio`, `gi://St`, etc.

### `extension.ts` lifecycle (critical)

1. `constructor(metadata)` — called **once** on load. Set up translations only. Do **NOT**
   connect signals, modify Shell, or create UI.
2. `enable()` — called on login, unlock, or manual enable. Create UI, connect signals, modify Shell
   behavior.
3. `disable()` — called on lock, disable, or uninstall. **Must undo everything from `enable()`**.
   Leaving stale signals/UI is the #1 reason extensions are rejected.

### `metadata.json` key fields

- `uuid`: `anvil@GenKerensky.github.com` — install folder must match
- `settings-schema`: e.g. `org.gnome.shell.extensions.anvil` — makes `getSettings()` work without args
- `session-modes`: `["user", "unlock-dialog"]` to persist through lock screen
- `shell-version`: array of strings, major version only since GNOME 40 (e.g.
  `["45","46","47","48","49","50","50.1"]`)

### Installed extension layout (matches `dist/` build output)

```
~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/
├── extension.js
├── metadata.json
├── prefs.js
├── stylesheet.css
├── schemas/
│   ├── gschemas.compiled
│   └── org.gnome.shell.extensions.anvil.gschema.xml
├── locale/<lang>/LC_MESSAGES/anvil.mo
├── config/windows.json
├── lib/
├── resources/
└── LICENSE
```

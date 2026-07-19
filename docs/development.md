# Development

This page is for contributors building or changing Anvil. User installation is documented in the root [README](../README.md#install).

## Requirements

- GNOME Shell 45 through 50.1
- Node.js 24 or newer and npm
- GNU Make
- TypeScript dependencies installed with `npm install`
- gettext
- GLib schema tools

## Common commands

```bash
npm install

# Build and install a development build.
make dev

# Build and install without changing the production flag.
make install

# Build a distributable ZIP.
make dist

# Format source and documentation.
npm run format

# Run the portable validation pipeline.
npm test
```

The installed extension lives at `~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/`.

## Reloading GNOME Shell

- On Wayland, log out and back in to restart the Shell process.
- On X11, press <kbd>Alt</kbd>+<kbd>F2</kbd>, enter `r`, and press <kbd>Enter</kbd>.
- For an isolated development session, use the devkit launcher documented in the [testing guide](testing/README.md#interactive-devkit-session).

## Source layout

| Path                 | Purpose                                   |
| -------------------- | ----------------------------------------- |
| `src/extension.ts`   | GNOME Shell extension entry point         |
| `src/prefs.ts`       | GTK/Adwaita preferences entry point       |
| `src/lib/extension/` | GNOME-facing tiling runtime and adapters  |
| `src/lib/tiling/`    | Platform-independent tiling state         |
| `src/lib/prefs/`     | Preferences pages and widgets             |
| `src/schemas/`       | GSettings schemas and default keybindings |
| `test/unit/`         | Vitest unit tests                         |
| `test/e2e/`          | GNOME Shell E2E suites                    |

See the repository's `.agents/context/architecture.md` for the detailed module map and `CONTEXT.md` for the current domain language.

## Contributing

Use Conventional Commits, keep TypeScript strict, and run `npm test` before submitting a change. Runtime or visual changes should also receive a focused E2E or devkit check where practical. Please keep discussions and issue reports welcoming and actionable.

Report Anvil problems in the [Anvil issue tracker](https://github.com/GenKerensky/anvil/issues). Bugs inherited from Forge can be cross-referenced to the [Forge issue tracker](https://github.com/forge-ext/forge/issues).

# GNOME Shell Upgrade

Step-by-step workflow for upgrading this extension to support a new GNOME Shell / Fedora release.

## Version Mapping

| Fedora | GNOME Shell | Status       |
| ------ | ----------- | ------------ |
| 42     | 48          | ✅ Supported |
| 43     | 49          | ✅ Supported |
| 44     | 50          | ✅ Primary   |
| 45     | 51          | Target next  |

Fedora major version = GNOME Shell major version - 6 (e.g. Fedora 45 → GNOME 51).

## Step 1: Determine the target version

Ask the user which version to target, or infer the next unreleased version from the mapping above. Default to the next major GNOME version after the current primary.

## Step 2: Fetch the migration guide

Fetch the upgrade guide for the target major version from gjs.guide:

```text
https://gjs.guide/extensions/upgrading/gnome-shell-<major version>.html
```

Example for GNOME Shell 51:

```text
https://gjs.guide/extensions/upgrading/gnome-shell-51.html
```

Read the entire page. Key things to look for:

- **API removals or renames** — functions, classes, or properties that were removed/changed
- **New deprecations** — things that still work but will break next cycle
- **Import path changes** — modules moved to new locations
- **Version checking changes** — `shell-version` validation changes
- **St/Clutter/Meta/Shell API changes** — widget, compositor, or window manager API changes
- **Preferences changes** — GTK version, Libadwaita changes, `fillPreferencesWindow` changes

Make a checklist of every change that affects this extension's codebase. Search the codebase for each affected API to find all usages.

## Step 3: Update GJS library type packages (`@girs/*`)

The project uses `@girs/*` npm packages for type definitions that mirror the GJS runtime libraries. These must be upgraded to match the target GNOME Shell version.

### Check current versions

Read `package.json` devDependencies. Key packages to update:

| Package             | Current Pattern       | Target Pattern                      |
| ------------------- | --------------------- | ----------------------------------- |
| `@girs/gnome-shell` | `^50.0.0`             | `^<target>.0.0`                     |
| `@girs/clutter-18`  | `^18.0.0-4.0.0-rc.15` | `^<target-clutter>.0.0-4.0.0-rc.15` |
| `@girs/gio-2.0`     | `^2.88.0-4.0.0-rc.15` | Check latest compatible             |
| `@girs/glib-2.0`    | `^2.88.0-4.0.0-rc.15` | Check latest compatible             |
| `@girs/gobject-2.0` | `^2.88.0-4.0.0-rc.15` | Check latest compatible             |
| `@girs/meta-18`     | `^18.0.0-4.0.0-rc.15` | `^<target-meta>.0.0-4.0.0-rc.15`    |
| `@girs/st-18`       | `^18.0.0-4.0.0-rc.15` | `^<target-st>.0.0-4.0.0-rc.15`      |
| `@girs/gtk-4.0`     | `^4.23.0-4.0.0-rc.15` | Check latest compatible             |
| `@girs/gdk-4.0`     | `^4.0.0-4.0.0-rc.15`  | Check latest compatible             |
| `@girs/adw-1`       | `^1.10.0-4.0.0-rc.15` | Check latest compatible             |
| `@girs/gjs`         | `^4.0.0-rc.15`        | Check latest compatible             |

### How to find the correct versions

1. Search npm for `@girs/gnome-shell` to find the latest version matching your target:
   ```bash
   npm view @girs/gnome-shell versions --json | grep '<target>'
   ```
2. For Mutter/Clutter/St (which share a version), the major version matches GNOME Shell's Mutter version.
   The Mutter version used by a GNOME Shell release can be found in the Fedora package changelog or by inspecting the container:
   ```bash
   podman run --rm fedora:<fedora> dnf info mutter | grep Version
   ```
3. GTK, GLib, GObject, GIO versions rarely change but should be checked against the Fedora target's package versions.
4. The `-4.0.0-rc.15` suffix is the `@girs` tooling version and may need updating if new APIs require it.

### Update packages

After determining the correct versions, update `package.json` and install:

```bash
npm install --save-dev @girs/gnome-shell@^<target>.0.0 @girs/clutter-18@^<mutter>.0.0-4.0.0-rc.15 @girs/meta-18@^<mutter>.0.0-4.0.0-rc.15 @girs/st-18@^<mutter>.0.0-4.0.0-rc.15
# ... and other packages as needed
npm install
```

### Verify type aliases

Check `vitest.config.js` — the `resolve.alias` mappings must match the import paths used in the source code. If GNOME renamed/reorganized modules (e.g. `gi://Meta` → `gi://Meta18`), update both the source imports and the vitest aliases.

Current aliases in `vitest.config.js`:

```text
gi://GObject, gi://Gio, gi://GLib, gi://Meta, gi://St, gi://Clutter, gi://Shell
```

### Verify after update

```bash
npm run typecheck   # must pass with new @girs packages
npm run test:unit   # must pass — mocks may need updates for new API shapes
```

## Step 4: Host shell compatibility notes

E2E runs on the **host** GNOME Shell (`make test-e2e`). When upgrading the workstation or
distrobox image:

- Confirm `gnome-shell --help` still documents `--headless` and `--virtual-monitor`
- Confirm `jasmine-gjs` still loads from `/usr/share/jasmine-gjs/jasmineBoot.js`
- Confirm `python3-dbusmock` stubs still satisfy the shell (UPower, NM, SessionManager, etc.)
- Check GNOME Shell CI for the target branch for new required D-Bus services:

```text
https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/gnome-<major>/.gitlab-ci.yml
```

### D-Bus mock stubs

`start-session.sh` launches python-dbusmock stubs for services GNOME Shell expects. New GNOME Shell versions may require additional D-Bus services. If the container build succeeds but GNOME Shell fails to start, check the journal:

```bash
podman exec <container> journalctl -u gnome-headless.service --no-pager
```

## Step 5: General compatibility review (always applicable)

In addition to version-specific changes, review these areas that commonly break:

### `metadata.json`

- `shell-version`: Add the new version string (e.g. `"51"`). Format: string, not number.
- `session-modes`: Typically `["user", "unlock-dialog"]`. Review if new modes are needed.
- Consider adding `"50.1"` style point-release entries if relevant.

### Import paths

Check that all GJS imports resolve correctly:

- `gi://Gio`, `gi://St`, `gi://Clutter`, `gi://Meta`, `gi://Shell`, `gi://GLib`, `gi://GObject`
- `resource:///org/gnome/shell/...` paths
- `resource:///org/gnome/gjs/...` paths
- Internal extension imports (`./lib/...`)

### Extension lifecycle

Verify `extension.ts` follows the correct lifecycle:

- `constructor(metadata)` — translations only, no signal connections
- `enable()` — create UI, connect signals, modify Shell
- `disable()` — **must undo everything** from `enable()` (disconnect signals, destroy UI)

### Feature detection

For APIs that differ between versions, use feature detection:

```js
if (someMethod) someMethod();
else fallbackMethod();
```

Or version detection:

```js
const { PACKAGE_VERSION } = imports.misc.config;
const [major] = PACKAGE_VERSION.split(".").map(Number);
if (major >= 51) doNewWay();
else doOldWay();
```

### Reference: Updates and Breakage

Extensions break because they monkey-patch internal GNOME Shell code. The more invasive the patching, the more likely breakage. Before upgrading:

- Identify all places the extension overrides or wraps Shell/Mutter internals
- Prefer stable GNOME Platform APIs (GLib, GObject, GIO) over Shell internals
- Use ESLint and TypeScript checking (`npm run lint`, `npm run typecheck`)

### Reference: Targeting Older GNOME

When targeting a new version while keeping support for older versions:

- Use feature/version detection (not hard if/else branches on every call)
- `metadata.json` `shell-version` array lists ALL supported versions
- GTK version can be checked at runtime with `Gtk.get_major_version()`
- The `fillPreferencesWindow` function takes priority over `buildPrefsWidget` (GNOME 42+)

## Step 6: Build the extension

```bash
make dist     # Build the .zip archive
make build    # Build to dist/ (for local testing)
```

Verify `npm run typecheck` and `npm run lint` pass.

## Step 7: Run tests on the host GNOME version

```bash
npm run test:unit
make test-e2e
```

E2E targets the **host** shell version only (no multi-Fedora container matrix).

## Step 8: Update documentation

Update `README.md` / `metadata.json` supported shell versions when the host upgrade lands.

## Step 9: Verification checklist

- [ ] Migration guide reviewed; all affected code updated
- [ ] `@girs/*` npm packages updated to match target GNOME version
- [ ] `metadata.json` `shell-version` includes new version
- [ ] `npm install` completes without errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:unit` passes
- [ ] `make dist` succeeds
- [ ] `make test-e2e` passes on the upgraded host shell
- [ ] `README.md` supported versions updated

## What NOT to do

- Do NOT remove support for currently-supported versions without explicit user request
- Do NOT commit changes unless the user explicitly asks
- Do NOT push to remote unless the user asks

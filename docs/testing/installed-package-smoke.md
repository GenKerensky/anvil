# Installed-package smoke test

Use this host-only checklist after changing preferences pages, icons, schemas, packaging, or the
stylesheet bridge. It tests the installed payload in the real user session; it is not part of
`npm test`.

Run `make test-e2e-stylesheet` first for an automated, isolated migration and live-reload check.
That target uses a temporary `XDG_CONFIG_HOME`; this checklist remains the final installed-package
validation against the real user session.

Run `make test-e2e-icons` after resource or packaging changes. It registers the installed icon path
in a standalone GTK preferences process, resolves all six live local icons from that payload, and
verifies that the active Shell resolves the Quick Settings tile/header icon through St.

The smoke changes Anvil settings and may initialize the user stylesheet. The preparation below
captures both so the cleanup can restore them.

## Prepare and install

Run from the repository root:

```bash
UUID=anvil@GenKerensky.github.com
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
CSS_FILE="${XDG_CONFIG_HOME:-${HOME}/.config}/anvil/stylesheet/anvil/stylesheet.css"
STATE_DIR="$(mktemp -d -t anvil-installed-smoke.XXXXXX)"
SMOKE_STARTED="$(date --iso-8601=seconds)"

dconf dump /org/gnome/shell/extensions/anvil/ > "${STATE_DIR}/anvil.dconf"
if gnome-extensions list --enabled | grep -Fxq "${UUID}"; then
  touch "${STATE_DIR}/was-enabled"
fi
if test -f "${CSS_FILE}"; then
  cp -- "${CSS_FILE}" "${STATE_DIR}/stylesheet.css"
else
  touch "${STATE_DIR}/css-was-absent"
fi

# Prove that installation replaces the payload instead of overlaying it. A stale file left by an
# older build would make the remainder of this smoke ambiguous.
mkdir -p "${INSTALL_DIR}"
touch "${INSTALL_DIR}/.anvil-stale-payload-probe"
make install

test ! -e "${INSTALL_DIR}/.anvil-stale-payload-probe" || {
  printf 'make install left a stale payload file in place\n' >&2
  exit 1
}

for file in \
  extension.js \
  prefs.js \
  stylesheet.css \
  schemas/gschemas.compiled \
  resources/icons/hicolor/scalable/actions/anvil-logo-symbolic.svg \
  resources/icons/hicolor/scalable/actions/bug-symbolic.svg \
  resources/icons/hicolor/scalable/actions/forge-logo-symbolic.svg \
  resources/icons/hicolor/scalable/actions/view-grid-symbolic.svg \
  resources/icons/hicolor/scalable/actions/brush-symbolic.svg \
  resources/icons/hicolor/scalable/actions/input-keyboard-symbolic.svg \
  resources/icons/hicolor/scalable/actions/window-symbolic.svg
do
  test -f "${INSTALL_DIR}/${file}" || {
    printf 'missing installed payload: %s\n' "${file}" >&2
    exit 1
  }
done

gnome-extensions disable "${UUID}" 2>/dev/null || true
gnome-extensions enable "${UUID}"
gnome-extensions info "${UUID}"
```

`make install` stages the complete `dist/` payload and replaces only `INSTALL_DIR`; it does not
overlay the previous extension directory. Dconf settings and the user stylesheet under
`${XDG_CONFIG_HOME:-${HOME}/.config}/anvil/` are outside that directory and are not removed.

Acceptance: the stale-payload probe is gone, the payload loop prints no missing-file error, and
extension information reports an enabled extension without a load error. On Wayland,
disable/enable is sufficient for extension files; restarting the whole Shell is not required.

## Preferences and icons

Open the installed preferences process:

```bash
gnome-extensions prefs "${UUID}"
```

Visit every page and verify that the page opens without an empty body or a broken-image glyph:

1. **Tiling** — `view-grid-symbolic`
2. **Appearance** — `brush-symbolic`
3. **Keyboard** — `input-keyboard-symbolic`
4. **Windows** — `window-symbolic`
5. **Monitors** — `video-display-symbolic` from the system icon theme

Also open **About** and confirm the Anvil logo renders. Experimental controls on **Tiling** and
**Appearance** must display their local `bug-symbolic` badge rather than a broken-image glyph.

Close the window, run the command again, and revisit **Monitors**. Controls and the monitor drawing
must refresh normally. This open/close/reopen pass also checks that the installed preferences
process does not leave a duplicate window or visibly stale page.

`forge-logo-symbolic.svg` is intentionally retained in the package as upstream attribution
artwork; it is not a live Anvil UI icon. This packaging contract keeps the attribution asset from
being mistaken for an orphaned UI resource.

## Quick Settings indicator

1. On **Appearance**, enable **Anvil in quick settings**.
2. Open the GNOME system menu. Verify that the **Tiling** tile and its grid icon render.
3. Expand the tile. Verify the **Anvil** header and its switches render.
4. Select **Settings** twice. The existing preferences window must be activated; a second window
   must not be created.

## Stylesheet reload

Before the visual check, prove that enabling a new package does not rewrite a customized user file.
This sentinel is temporary because the cleanup section restores the original captured bytes:

```bash
install -Dm644 /dev/stdin "${CSS_FILE}" <<'EOF'
/* anvil installed-smoke custom sentinel */
.window-tiled-border { border-width: 4px; }
EOF
CUSTOM_CSS_SHA256="$(sha256sum "${CSS_FILE}" | cut -d' ' -f1)"
gnome-extensions disable "${UUID}"
gnome-extensions enable "${UUID}"
test "$(sha256sum "${CSS_FILE}" | cut -d' ' -f1)" = "${CUSTOM_CSS_SHA256}"
```

Acceptance: enable succeeds and the checksum comparison is silent. The custom file is layered over
the packaged base, so packaged selectors absent from the sentinel remain available.

Restore the originally captured stylesheet before exercising the preferences editor:

```bash
if test -f "${STATE_DIR}/css-was-absent"; then
  rm -f -- "${CSS_FILE}"
else
  install -Dm644 "${STATE_DIR}/stylesheet.css" "${CSS_FILE}"
fi
gnome-extensions disable "${UUID}"
gnome-extensions enable "${UUID}"
```

1. Keep at least one tiled application window visible.
2. On **Appearance**, enable **Border around focused window**.
3. Expand **Tiled window**, note its **Border size**, and change it by one step.
4. Focus the tiled window. The new border width must appear without disabling the extension or
   restarting GNOME Shell.
5. With two tiled windows visible, expand **Shadows** and change the focused window's **Blur
   radius** by one step. Verify that the focused shadow changes immediately.
6. Change the unfocused window's **Blur radius** by one step, move focus to the other window, and
   verify that the newly unfocused shadow uses the updated style independently.
7. Use the reset buttons to restore both blur radii.
8. Confirm that the user stylesheet exists and changed during the smoke:

   ```bash
   test -s "${CSS_FILE}" && sha256sum "${CSS_FILE}"
   ```

9. Restore the original border size in preferences.

Inspect logs from the exact smoke window:

```bash
journalctl --user --since "${SMOKE_STARTED}" --output=short-iso \
  --grep 'Anvil|anvil@GenKerensky.github.com|JS ERROR|stylesheet'
```

Acceptance: the visual change is immediate, and the filtered journal contains no Anvil load,
stylesheet parsing, or JavaScript errors caused by the smoke.

## Restore the user state

Run cleanup in the same terminal that still has `STATE_DIR`, `CSS_FILE`, and `UUID` defined:

```bash
dconf reset -f /org/gnome/shell/extensions/anvil/
dconf load /org/gnome/shell/extensions/anvil/ < "${STATE_DIR}/anvil.dconf"

if test -f "${STATE_DIR}/css-was-absent"; then
  rm -f -- "${CSS_FILE}"
else
  install -Dm644 "${STATE_DIR}/stylesheet.css" "${CSS_FILE}"
fi

gnome-extensions disable "${UUID}" 2>/dev/null || true
if test -f "${STATE_DIR}/was-enabled"; then
  gnome-extensions enable "${UUID}"
fi
rm -rf -- "${STATE_DIR}"
```

This restores the prior settings, stylesheet bytes, and enabled/disabled state. It intentionally
leaves the newly installed package in place.

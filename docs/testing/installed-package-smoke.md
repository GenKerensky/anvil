# Installed-package smoke test

Use this host-only checklist after changing preferences pages, icons, schemas, packaging, or the
stylesheet bridge. It tests the installed payload in the real user session; it is not part of
`npm test`.

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

Close the window, run the command again, and revisit **Monitors**. Controls and the monitor drawing
must refresh normally. This open/close/reopen pass also checks that the installed preferences
process does not leave a duplicate window or visibly stale page.

## Quick Settings indicator

1. On **Appearance**, enable **Anvil in quick settings**.
2. Open the GNOME system menu. Verify that the **Tiling** tile and its grid icon render.
3. Expand the tile. Verify the **Anvil** header and its switches render.
4. Select **Settings** twice. The existing preferences window must be activated; a second window
   must not be created.

## Stylesheet reload

1. Keep at least one tiled application window visible.
2. On **Appearance**, enable **Border around focused window**.
3. Expand **Tiled window**, note its **Border size**, and change it by one step.
4. Focus the tiled window. The new border width must appear without disabling the extension or
   restarting GNOME Shell.
5. Confirm that the user stylesheet exists and changed during the smoke:

   ```bash
   test -s "${CSS_FILE}" && sha256sum "${CSS_FILE}"
   ```

6. Restore the original border size in preferences.

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

# Gaps

Anvil can leave breathing room around every tiled rectangle. The effective gap is the **Gap size** multiplied by the **Gap size multiplier**.

The shipped defaults are a base size of `4` and a multiplier of `1`.

## Configure gaps

Open **Anvil Preferences → Appearance → Gaps**:

- **Gap size** changes the base pixel value.
- **Gap size multiplier** scales the base value.
- **Disable gaps for single window** removes gaps when only one non-minimized tiled window is present on the monitor.

The single-window option is also available from the Anvil Quick Settings menu.

## Change gaps from the keyboard

- <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>+</kbd> increases the multiplier.
- <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>-</kbd> decreases the multiplier.

Keyboard changes clamp the multiplier between `0` and `8`. The preferences control supports a wider range for deliberate large-gap setups.

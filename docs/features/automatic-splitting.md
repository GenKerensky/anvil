# Automatic splitting

Automatic splitting—called **Quarter tiling** in preferences—chooses a split for the focused tile before Anvil admits a new window.

## Placement rule

- If the focused window is wider than it is tall, Anvil creates a horizontal, side-by-side split.
- If the focused window is taller than it is wide, Anvil creates a vertical, top-and-bottom split.
- Automatic splitting applies only to ordinary horizontal or vertical containers. It does not replace an active stacked or tabbed layout.

The result is a quarter-style pattern as successive windows open around the current focus.

## Configure it

Open **Anvil Preferences → Tiling → Behavior** and toggle **Quarter tiling**. It is enabled by default and currently marked experimental in the preferences UI.

For full control over where the next window appears, disable automatic splitting and choose a split manually before opening the window:

- <kbd>Super</kbd>+<kbd>Z</kbd> for a horizontal split
- <kbd>Super</kbd>+<kbd>V</kbd> for a vertical split

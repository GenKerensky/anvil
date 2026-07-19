# Multiple monitors

Anvil keeps a separate tiling surface for every workspace-and-monitor pair. Window focus and movement can follow GNOME's logical monitor arrangement, and the runtime updates its surfaces when monitor topology changes.

Horizontal and portrait monitor geometries are supported. Automatic root splits prefer side-by-side placement on landscape monitors and top-to-bottom placement on portrait monitors.

## Move between monitors

Use <kbd>Shift</kbd>+<kbd>Super</kbd> plus a direction key to move a window toward an adjacent monitor when there is no nearer target on the current monitor. Anvil projects the window into the destination work area and attaches it to that monitor's tiling tree.

The result depends on GNOME's configured logical monitor positions. Arrange displays under **GNOME Settings → Displays** before tuning the Anvil layout.

## Per-monitor size constraints

Open **Anvil Preferences → Monitors**, select a display in the visual monitor map, and configure:

- **Enable size constraints** — turn the selected monitor's rule on or off.
- **Max width** and **Max height** — cap a tiled window in pixels; zero means no limit.
- **Resize exemption** — allow a manually resized window to exceed the configured cap.

Constrained windows are centered inside the tile space that would otherwise exceed the cap. Rules use the monitor connector name, such as `DP-1` or `eDP-1`, so reconnecting the same output can reuse its limits.

> [!CAUTION]
> Per-monitor constraints are labeled as a new, potentially unpredictable feature in the preferences UI. Validate them with the applications and display topology you use.

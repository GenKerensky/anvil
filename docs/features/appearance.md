# Appearance

Anvil draws layout previews, focus hints, split hints, tab decoration, and window shadows inside GNOME Shell. Most visual settings can be edited live from **Anvil Preferences → Appearance**.

## Style controls

- Show or hide the drag-and-drop preview hint.
- Show or hide the focused-window border.
- Show or hide the split-direction border.
- Show or hide the Anvil Quick Settings tile.
- Set a shared corner radius; use `0` for square corners.

## Layout colors and borders

Anvil keeps separate visual schemes for:

- Tiled windows
- Tabbed windows
- Stacked windows
- Floating windows
- Split-direction hints

Each scheme has a configurable border color and width. Updating a scheme also updates its related drag preview; the tabbed scheme also colors tab decoration.

## Shadows

Focused and unfocused windows have independent shadow editors. Each editor controls:

- Color and opacity
- Horizontal and vertical offset
- Blur radius
- Spread radius

Reset buttons restore the shipped value for an individual visual control.

## Advanced styling

Preference changes are written to Anvil's user stylesheet. You can edit the stylesheet directly when you need selectors or properties the UI does not expose. See [Custom stylesheets](custom-stylesheets.md).

/*
 * Decoration cleanup helpers (B11-1).
 */
import Clutter from "gi://Clutter";

export function _disableDecorations() {
  const decos = global.window_group
    .get_children()
    .filter((a: Clutter.Actor & { type?: unknown }) => a.type != null);
  decos.forEach((d) => {
    global.window_group.remove_child(d);
    d.destroy();
  });
}

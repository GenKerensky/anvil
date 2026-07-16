/*
 * GNOME version / DPI helpers (B11-1).
 */
import St from "gi://St";
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

const [major] = PACKAGE_VERSION.split(".").map((s) => Number(s));

export function dpi() {
  return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export function isGnomeGTE(majorVersion: number) {
  return major >= majorVersion;
}

import Meta from "gi://Meta";
import * as Utils from "../utils.js";

export const WINDOW_MODES = Utils.createEnum(["FLOAT", "TILE", "GRAB_TILE", "DEFAULT"]);

// Simplify the grab modes
export const GRAB_TYPES = Utils.createEnum(["RESIZING", "MOVING", "UNKNOWN"]);

// Bug #351 fix: Window types that shouldn't be tiled (browser popups, tooltips, etc.)
// Ported from jcrussell/forge
export const INVALID_WINDOW_TYPES = new Set([
  Meta.WindowType.UTILITY,
  Meta.WindowType.POPUP_MENU,
  Meta.WindowType.DROPDOWN_MENU,
  Meta.WindowType.TOOLTIP,
]);

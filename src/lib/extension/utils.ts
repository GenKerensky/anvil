/*
 * Utils barrel — re-exports split modules (B11-1). Prefer importing from
 * geometry / window-filters / decorations / version for new code.
 */
export { createEnum } from "./utils/create-enum.js";
export * from "./utils/geometry.js";
export * from "./utils/window-filters.js";
export * from "./utils/decorations.js";
export * from "./utils/version.js";

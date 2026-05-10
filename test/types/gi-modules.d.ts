// TypeScript declarations for GNOME GObject Introspection (gi://) protocol modules
// These declarations map the gi:// protocol imports to our mock implementations
// so TypeScript can resolve them during type checking while Vitest resolves them
// via the alias configuration at runtime.

declare module "gi://Meta" {
  export * from "../__mocks__/gi/Meta.js";
  export { default } from "../__mocks__/gi/Meta.js";
}

declare module "gi://GObject" {
  export * from "../__mocks__/gi/GObject.js";
  export { default } from "../__mocks__/gi/GObject.js";
}

declare module "gi://Gio" {
  export * from "../__mocks__/gi/Gio.js";
  export { default } from "../__mocks__/gi/Gio.js";
}

declare module "gi://GLib" {
  export * from "../__mocks__/gi/GLib.js";
  export { default } from "../__mocks__/gi/GLib.js";
}

declare module "gi://St" {
  export * from "../__mocks__/gi/St.js";
  export { default } from "../__mocks__/gi/St.js";
}

declare module "gi://Clutter" {
  export * from "../__mocks__/gi/Clutter.js";
  export { default } from "../__mocks__/gi/Clutter.js";
}

declare module "gi://Shell" {
  export * from "../__mocks__/gi/Shell.js";
  export { default } from "../__mocks__/gi/Shell.js";
}

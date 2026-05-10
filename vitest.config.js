import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // GObject Introspection modules
      "gi://GObject": resolve(__dirname, "./test/__mocks__/gi/GObject.js"),
      "gi://Gio": resolve(__dirname, "./test/__mocks__/gi/Gio.js"),
      "gi://GLib": resolve(__dirname, "./test/__mocks__/gi/GLib.js"),
      "gi://Meta": resolve(__dirname, "./test/__mocks__/gi/Meta.js"),
      "gi://St": resolve(__dirname, "./test/__mocks__/gi/St.js"),
      "gi://Clutter": resolve(__dirname, "./test/__mocks__/gi/Clutter.js"),
      "gi://Shell": resolve(__dirname, "./test/__mocks__/gi/Shell.js"),

      // GNOME Shell resource imports
      "resource:///org/gnome/shell/ui/main.js": resolve(
        __dirname,
        "./test/__mocks__/shell/main.js"
      ),
      "resource:///org/gnome/shell/extensions/extension.js": resolve(
        __dirname,
        "./test/__mocks__/shell/extension.js"
      ),
      "resource:///org/gnome/shell/misc/config.js": resolve(
        __dirname,
        "./test/__mocks__/shell/config.js"
      ),
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.test.{js,ts}"],
    setupFiles: ["./test/setup.js"],
  },
});

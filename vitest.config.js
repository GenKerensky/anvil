import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // GObject Introspection modules
      "gi://GObject": resolve(__dirname, "./test/unit/__mocks__/gi/GObject.js"),
      "gi://Gio": resolve(__dirname, "./test/unit/__mocks__/gi/Gio.js"),
      "gi://GLib": resolve(__dirname, "./test/unit/__mocks__/gi/GLib.js"),
      "gi://Meta": resolve(__dirname, "./test/unit/__mocks__/gi/Meta.js"),
      "gi://St": resolve(__dirname, "./test/unit/__mocks__/gi/St.js"),
      "gi://Clutter": resolve(__dirname, "./test/unit/__mocks__/gi/Clutter.js"),
      "gi://Cogl": resolve(__dirname, "./test/unit/__mocks__/gi/Cogl.js"),
      "gi://Shell": resolve(__dirname, "./test/unit/__mocks__/gi/Shell.js"),
      "gi://Adw": resolve(__dirname, "./test/unit/__mocks__/gi/Adw.js"),
      "gi://Gtk": resolve(__dirname, "./test/unit/__mocks__/gi/Gtk.js"),
      "gi://Gdk": resolve(__dirname, "./test/unit/__mocks__/gi/Gdk.js"),
      "gi://cairo": resolve(__dirname, "./test/unit/__mocks__/gi/Cairo.js"),

      // GNOME Shell resource imports
      "resource:///org/gnome/shell/ui/main.js": resolve(
        __dirname,
        "./test/unit/__mocks__/shell/main.js"
      ),
      "resource:///org/gnome/shell/extensions/extension.js": resolve(
        __dirname,
        "./test/unit/__mocks__/shell/extension.js"
      ),
      "resource:///org/gnome/shell/misc/config.js": resolve(
        __dirname,
        "./test/unit/__mocks__/shell/config.js"
      ),
      "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js": resolve(
        __dirname,
        "./test/unit/__mocks__/shell/prefs.js"
      ),
    },
  },
  test: {
    globals: true,
    include: ["test/unit/**/*.test.{js,ts}"],
    setupFiles: ["./test/unit/setup.js"],
  },
});

/**
 * Global type augmentations for GJS test files.
 *
 * Imports @girs types to make `global`, `imports`, `log`, `print`, etc.
 * available in tsc's scope for checkJs=true JS files, then augments the
 * Shell.Global class (the type of the `global` object) with custom
 * properties set by src/extension.ts enable().
 */

import "@girs/gjs";
import "@girs/gjs/dom";
import "@girs/gnome-shell/ambient";
import "@girs/gnome-shell/extensions/global";

export {};

declare module "@girs/shell-18" {
  interface Global {
    __anvil_extWm: any;
    __anvil_settings: any;
    __anvil_test_state:
      | {
          extWm: any;
          getTestState(): string;
        }
      | undefined;
  }
}

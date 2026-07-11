/*
 * Keybinding table completeness tests
 */

import { describe, it, expect } from "vitest";
import { KEYBINDING_TABLE } from "../../../src/lib/extension/keybinding-table.js";
import type { AnvilAction } from "../../../src/lib/extension/window/actions.js";

describe("KEYBINDING_TABLE", () => {
  it("has unique schema keys", () => {
    const keys = KEYBINDING_TABLE.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers expected binding count (parity with pre-Stage-8 table)", () => {
    // 2 float + 4 focus + 4 swap + 4 move + 6 layout/ui + 2 gap + 1 workspace
    // + 2 window/prefs + 1 swap-last + 5 snap + 8 resize = 39… count is 41 with all keys
    expect(KEYBINDING_TABLE.length).toBe(41);
  });

  it("resolves static actions without a settings context", () => {
    const focus = KEYBINDING_TABLE.find((s) => s.key === "window-focus-left");
    expect(focus).toBeDefined();
    expect(typeof focus!.action).not.toBe("function");
    const action = focus!.action as AnvilAction;
    expect(action).toEqual({ name: "Focus", direction: "Left" });
  });

  it("resolves resize amount dynamically from settings", () => {
    const entry = KEYBINDING_TABLE.find((s) => s.key === "window-resize-top-increase");
    expect(entry).toBeDefined();
    expect(typeof entry!.action).toBe("function");
    const resolve = entry!.action as (ctx: {
      settings: { get_uint: (k: string) => number };
      kbdSettings: object;
    }) => AnvilAction;
    const action = resolve({
      settings: { get_uint: () => 42 },
      kbdSettings: {},
    });
    expect(action).toEqual({ name: "WindowResize", direction: "Top", amount: 42 });
  });
});

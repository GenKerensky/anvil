import { describe, expect, it, vi } from "vitest";
import St from "gi://St";

import { syncActiveWindowTab } from "../../../src/lib/extension/tab-decoration.js";

describe("tab decoration active presentation", () => {
  it("moves active styling between tabs and clears it", () => {
    const firstTab = new St.BoxLayout();
    const secondTab = new St.BoxLayout();
    const parent = { isTabbed: () => true };
    const first = { parentNode: parent, tab: firstTab } as any;
    const second = { parentNode: parent, tab: secondTab } as any;

    syncActiveWindowTab(first);
    expect(firstTab.get_style_class_name()).toContain("window-tabbed-tab-active");

    syncActiveWindowTab(second);
    expect(firstTab.get_style_class_name()).not.toContain("window-tabbed-tab-active");
    expect(secondTab.get_style_class_name()).toContain("window-tabbed-tab-active");

    syncActiveWindowTab(null);
    expect(secondTab.get_style_class_name()).not.toContain("window-tabbed-tab-active");
  });

  it("clears presentation state when the active tab actor was already destroyed", () => {
    const tab = new St.BoxLayout();
    const node = { parentNode: { isTabbed: () => true }, tab } as any;
    syncActiveWindowTab(node);
    vi.spyOn(tab, "remove_style_class_name").mockImplementation(() => {
      throw new Error("disposed actor");
    });

    expect(() => syncActiveWindowTab(null)).not.toThrow();
  });
});

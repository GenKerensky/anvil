import { describe, expect, it, vi } from "vitest";

import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import {
  DragPreviewPresenter,
  TreePresentation,
} from "../../../src/lib/extension/tree-presentation.js";
import { createMockWindow, installGnomeGlobals } from "../mocks/helpers/index.js";

describe("TreePresentation", () => {
  it("styles a focused window after its tab record is assigned", () => {
    const focused = createMockWindow({ id: 1 });
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => focused } });
    const presentation = new TreePresentation();
    const parent = new Node(NODE_TYPES.CON, "con-1");
    parent.layout = LAYOUT_TYPES.TABBED;
    const node = new Node(NODE_TYPES.WINDOW, focused);
    parent.appendChild(node);

    presentation.ensure(node);

    expect(presentation.tabStyleClassForTest(node)).toContain("window-tabbed-tab-active");
    presentation.destroy();
    globals.cleanup();
  });

  it("owns tab actors and moves active styling without storing actors on nodes", () => {
    const globals = installGnomeGlobals();
    const presentation = new TreePresentation();
    const parent = new Node(NODE_TYPES.CON, "con-1");
    parent.layout = LAYOUT_TYPES.TABBED;
    const first = new Node(NODE_TYPES.WINDOW, createMockWindow({ id: 1 }));
    const second = new Node(NODE_TYPES.WINDOW, createMockWindow({ id: 2 }));
    parent.appendChild(first);
    parent.appendChild(second);

    presentation.ensure(first);
    presentation.ensure(second);
    presentation.syncActiveTab(first);
    expect(presentation.tabStyleClassForTest(first)).toContain("window-tabbed-tab-active");
    presentation.syncActiveTab(second);
    expect(presentation.tabStyleClassForTest(first)).not.toContain("window-tabbed-tab-active");
    expect(presentation.tabStyleClassForTest(second)).toContain("window-tabbed-tab-active");
    expect("tab" in first).toBe(false);
    expect("decoration" in parent).toBe(false);

    presentation.destroy();
    globals.cleanup();
  });

  it("clears active state even when an old tab actor was already disposed", () => {
    const globals = installGnomeGlobals();
    const presentation = new TreePresentation();
    const parent = new Node(NODE_TYPES.CON, "con-1");
    parent.layout = LAYOUT_TYPES.TABBED;
    const node = new Node(NODE_TYPES.WINDOW, createMockWindow());
    parent.appendChild(node);
    presentation.ensure(node);
    presentation.syncActiveTab(node);
    const activeTab = (presentation as any)._activeTab;
    vi.spyOn(activeTab, "remove_style_class_name").mockImplementation(() => {
      throw new Error("disposed actor");
    });

    expect(() => presentation.syncActiveTab(null)).not.toThrow();
    presentation.destroy();
    globals.cleanup();
  });
});

describe("DragPreviewPresenter", () => {
  it("owns a single preview actor through show, hide, and destroy", () => {
    const globals = installGnomeGlobals();
    const presenter = new DragPreviewPresenter();

    presenter.show("window-tilepreview", { x: 1, y: 2, width: 300, height: 200 });
    expect(globals.windowGroup!._children).toHaveLength(1);
    presenter.hide();
    presenter.show("window-tilepreview-swap", { x: 3, y: 4, width: 100, height: 80 });
    expect(globals.windowGroup!._children).toHaveLength(1);
    presenter.destroy();
    expect(globals.windowGroup!._children).toHaveLength(0);

    globals.cleanup();
  });
});

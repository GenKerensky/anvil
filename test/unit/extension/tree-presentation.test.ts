import { describe, expect, it, vi } from "vitest";
import St from "gi://St";

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

    presentation.ensure(parent);
    presentation.ensure(node);
    presentation.layoutTabbedDecoration(parent, node, {
      x: 0,
      y: 0,
      width: 200,
      height: 35,
      visible: true,
    });

    const [decoration] = globals.windowGroup!._children as St.BoxLayout[];
    const [tab] = decoration.get_children() as St.BoxLayout[];
    expect(tab.get_style_class_name()).toContain("window-tabbed-tab-active");
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

    presentation.ensure(parent);
    presentation.ensure(first);
    presentation.ensure(second);
    const geometry = { x: 0, y: 0, width: 200, height: 35, visible: true };
    presentation.layoutTabbedDecoration(parent, first, geometry);
    presentation.layoutTabbedDecoration(parent, second, geometry);
    const [decoration] = globals.windowGroup!._children as St.BoxLayout[];
    const [firstTab, secondTab] = decoration.get_children() as St.BoxLayout[];
    presentation.syncActiveTab(first);
    expect(firstTab.get_style_class_name()).toContain("window-tabbed-tab-active");
    presentation.syncActiveTab(second);
    expect(firstTab.get_style_class_name()).not.toContain("window-tabbed-tab-active");
    expect(secondTab.get_style_class_name()).toContain("window-tabbed-tab-active");
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
    presentation.ensure(parent);
    presentation.ensure(node);
    presentation.layoutTabbedDecoration(parent, node, {
      x: 0,
      y: 0,
      width: 200,
      height: 35,
      visible: true,
    });
    presentation.syncActiveTab(node);
    const [decoration] = globals.windowGroup!._children as St.BoxLayout[];
    const [activeTab] = decoration.get_children() as St.BoxLayout[];
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

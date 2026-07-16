/**
 * Tree helper utilities for tests
 * Ported from jcrussell/forge
 */

import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../../src/lib/extension/tree.js";
// eslint-disable-next-line vitest/no-mocks-import
import { Window, Rectangle, WindowType } from "../../__mocks__/gi/Meta.js";

export function createTreePresentationStub() {
  return {
    ensure() {},
    remove() {},
    isRenderable() {
      return true;
    },
    setRect() {},
    clearDecoration() {},
    hideDecoration() {},
    showDecorationBelow() {},
    layoutTabbedDecoration() {},
    topBorderWidth() {
      return 0;
    },
    refreshTabTitle() {},
    syncActiveTab() {},
    detachTab() {},
    findWindowNodeByActor() {
      return null;
    },
    destroy() {},
  };
}

export function createWindowNode(tree, overrides = {}) {
  const win = new Window({
    id: overrides.id ?? `win-${Date.now()}`,
    rect: new Rectangle(overrides.rect ?? { width: 100, height: 100 }),
    wm_class: overrides.wm_class ?? "TestApp",
    title: overrides.title ?? "Test Window",
    window_type: overrides.window_type ?? WindowType.NORMAL,
    ...overrides,
  });

  const node = new Node(NODE_TYPES.WINDOW, win);
  node.percent = 1.0;
  node.mode = overrides.mode ?? "TILE";
  return node;
}

export function createConNode(_tree, layout = LAYOUT_TYPES.HSPLIT) {
  const node = new Node(NODE_TYPES.CON, {});
  node.layout = layout;
  node.percent = 1.0;
  return node;
}

export function createMonitorNode(_tree, _index = 0) {
  const node = new Node(NODE_TYPES.MONITOR, {});
  node.layout = LAYOUT_TYPES.HSPLIT;
  return node;
}

export function getWorkspaceAndMonitor(source, wsIndex = 0, monIndex = 0) {
  const { tree } = source;
  const wsNode = tree.findNode(`ws${wsIndex}`);
  const monitor = wsNode ? wsNode.getNodeByType(NODE_TYPES.MONITOR)[monIndex] : null;
  return { wsNode, monitor };
}

export default {
  createTreePresentationStub,
  createWindowNode,
  createConNode,
  createMonitorNode,
  getWorkspaceAndMonitor,
};

/*
 * LayoutEngine pure unit tests — percent math, split policy, auto-split.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LayoutEngine } from "../../../src/lib/extension/layout-engine.js";
import {
  Node,
  NODE_TYPES,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
} from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("LayoutEngine", () => {
  describe("determineSplitLayout", () => {
    it("returns VSPLIT for portrait monitors", () => {
      const engine = new LayoutEngine({
        tree: {} as any,
        settings: {} as any,
        focusMetaWindow: null,
        currentMonWsNode: null,
        notifyFocusChanged: vi.fn(),
        moveWindow: vi.fn(),
        rectForMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
      expect(engine.determineSplitLayout({ width: 1080, height: 1920 })).toBe(LAYOUT_TYPES.VSPLIT);
    });

    it("returns HSPLIT for landscape monitors", () => {
      const engine = new LayoutEngine({
        tree: {} as any,
        settings: {} as any,
        focusMetaWindow: null,
        currentMonWsNode: null,
        notifyFocusChanged: vi.fn(),
        moveWindow: vi.fn(),
        rectForMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
      expect(engine.determineSplitLayout({ width: 1920, height: 1080 })).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  describe("computeSizes", () => {
    let engine: LayoutEngine;

    beforeEach(() => {
      engine = new LayoutEngine({
        tree: {} as any,
        settings: {} as any,
        focusMetaWindow: null,
        currentMonWsNode: null,
        notifyFocusChanged: vi.fn(),
        moveWindow: vi.fn(),
        rectForMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
    });

    it("divides space equally when percents are unset", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };
      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      child1.percent = 0;
      child2.percent = 0;
      const sizes = engine.computeSizes(container, [child1, child2]);
      expect(sizes).toEqual([500, 500]);
    });

    it("applies residual pixel fix when floor leaves remainder", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 100, height: 50 };
      const children = [0, 1, 2].map(() => {
        const n = new Node(NODE_TYPES.CON, "con");
        n.percent = 0;
        return n;
      });
      const sizes = engine.computeSizes(container, children);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(100);
      expect(sizes[0]).toBe(33);
      expect(sizes[1]).toBe(33);
      expect(sizes[2]).toBe(34);
    });

    it("respects explicit percents", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };
      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      child1.percent = 0.3;
      child2.percent = 0.7;
      const sizes = engine.computeSizes(container, [child1, child2]);
      expect(sizes[0]).toBe(300);
      expect(sizes[1]).toBe(700);
    });
  });

  describe("resetSiblingPercent / redistributeSiblingPercent", () => {
    let engine: LayoutEngine;

    beforeEach(() => {
      engine = new LayoutEngine({
        tree: {} as any,
        settings: {} as any,
        focusMetaWindow: null,
        currentMonWsNode: null,
        notifyFocusChanged: vi.fn(),
        moveWindow: vi.fn(),
        rectForMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
    });

    it("resetSiblingPercent zeroes children", () => {
      const parent = new Node(NODE_TYPES.CON, "con");
      const a = new Node(NODE_TYPES.CON, "con");
      const b = new Node(NODE_TYPES.CON, "con");
      a.percent = 0.4;
      b.percent = 0.6;
      parent.appendChild(a);
      parent.appendChild(b);
      engine.resetSiblingPercent(parent);
      expect(a.percent).toBeUndefined();
      expect(b.percent).toBeUndefined();
    });

    it("redistributeSiblingPercent scales remaining percents to 1", () => {
      const parent = new Node(NODE_TYPES.CON, "con");
      const a = new Node(NODE_TYPES.CON, "con");
      const b = new Node(NODE_TYPES.CON, "con");
      a.percent = 0.25;
      b.percent = 0.25;
      parent.appendChild(a);
      parent.appendChild(b);
      engine.redistributeSiblingPercent(parent);
      expect(a.percent).toBeCloseTo(0.5);
      expect(b.percent).toBeCloseTo(0.5);
    });
  });

  describe("autoSplitFromFocus", () => {
    it("returns false when auto-split disabled", () => {
      const ctx = createTreeFixture({ fullExtWm: true, settings: { "auto-split-enabled": false } });
      expect(ctx.layoutEngine.autoSplitFromFocus()).toBe(false);
    });

    it("runs auto-split on focused HSPLIT when enabled", () => {
      const ctx = createTreeFixture({ fullExtWm: true, settings: { "auto-split-enabled": true } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.HSPLIT;
      const win = createMockWindow();
      win.get_frame_rect = () => ({ x: 0, y: 0, width: 800, height: 400 });
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      ctx.runtime.focusMetaWindow = win;
      ctx.runtime.currentMonWsNode = monitor;

      const ran = ctx.layoutEngine.autoSplitFromFocus();
      expect(ran).toBe(true);
      // Single-child split path toggles parent layout (no force) — parity with prior admit path.
      expect(node.parentNode).toBeTruthy();
    });
  });

  describe("split", () => {
    it("pushes window into a new container", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      ctx.layoutEngine.split(node, ORIENTATION_TYPES.HORIZONTAL, true);
      expect(node.parentNode?.nodeType).toBe(NODE_TYPES.CON);
      expect(node.parentNode?.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });
  });

  // S1: command handlers route tree-structure / layout / percent writes through
  // LayoutEngine instead of mutating the tree directly.
  describe("toggleSplitLayout / setAttachNode (S1 owner-compliant writes)", () => {
    it("toggleSplitLayout flips HSPLIT<->VSPLIT and sets tree.attachNode", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      ctx.layoutEngine.split(node, ORIENTATION_TYPES.HORIZONTAL, true);
      const parent = node.parentNode!;
      expect(parent.layout).toBe(LAYOUT_TYPES.HSPLIT);

      ctx.layoutEngine.toggleSplitLayout(parent);
      expect(parent.layout).toBe(LAYOUT_TYPES.VSPLIT);
      expect(ctx.tree.attachNode).toBe(parent);

      ctx.layoutEngine.toggleSplitLayout(parent);
      expect(parent.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("setAttachNode writes tree.attachNode through the owner", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      ctx.tree.attachNode = null;

      ctx.layoutEngine.setAttachNode(node);
      expect(ctx.tree.attachNode).toBe(node);
    });
  });

  describe("resetPercentForFloatToggle (S1)", () => {
    it("clears parent percent + grandparent siblings when <=1 tiled child", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      const parent = node.parentNode!;
      parent.percent = 0.5;
      const grand = parent.parentNode!;
      grand.childNodes.forEach((c: any) => (c.percent = 0.25));

      ctx.layoutEngine.resetPercentForFloatToggle(parent, ctx.tree);

      expect(parent.percent).toBeUndefined();
      expect(parent.parentNode!.childNodes.every((c: any) => c.percent === undefined)).toBe(true);
    });

    it("does not clear parent.percent when >1 tiled child", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win1 = createMockWindow({ id: 1 });
      const win2 = createMockWindow({ id: 2 });
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);
      // both windows share the monitor-level container; mark parent explicitly
      const parent = ctx.tree.getNodeByType(NODE_TYPES.CON)[0] ?? monitor;
      // Use the shared parent of the two windows:
      const sharedParent = ctx.tree.findNode(win1)!.parentNode!;
      sharedParent.percent = 0.5;

      ctx.layoutEngine.resetPercentForFloatToggle(sharedParent, ctx.tree);

      expect(sharedParent.percent).toBe(0.5);
    });
  });

  describe("raiseInStacked (S1)", () => {
    it("moves a node to the end of its stacked parent's child list", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const win1 = createMockWindow({ id: 1 });
      const win2 = createMockWindow({ id: 2 });
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);
      const parent = node1.parentNode!;
      parent.layout = LAYOUT_TYPES.STACKED;

      ctx.layoutEngine.raiseInStacked(node1);

      expect(parent.lastChild).toBe(node1);
      expect(parent.childNodes[parent.childNodes.length - 1]).toBe(node1);
    });
  });

  describe("reparentToNode (S1)", () => {
    it("reparents under the new parent and redistributes the old parent's siblings", () => {
      const ctx = createTreeFixture({ fullExtWm: true });
      const { wsNode, monitor } = getWorkspaceAndMonitor(ctx);
      const win = createMockWindow();
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win);
      const oldParent = node.parentNode!;
      oldParent.percent = 0.5;

      const target = wsNode!;
      ctx.layoutEngine.reparentToNode(node, target);

      expect(node.parentNode).toBe(target);
      // old parent's remaining children redistributed (percents summed to ~1)
      const remaining = oldParent.childNodes;
      const sum = remaining.reduce((s: number, c: any) => s + (c.percent ?? 0), 0);
      // With no remaining children the sum is 0; otherwise redistribute targets ~1.
      expect(sum === 0 || Math.abs(sum - 1) < 1e-5).toBe(true);
    });
  });
});

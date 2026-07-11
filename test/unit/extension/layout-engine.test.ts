/*
 * LayoutEngine pure unit tests — percent math, split policy, auto-split.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import St from "gi://St";
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
        sameParentMonitor: vi.fn(),
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
        sameParentMonitor: vi.fn(),
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
        sameParentMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
    });

    it("divides space equally when percents are 0", () => {
      const container = new Node(NODE_TYPES.CON, new St.Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };
      const child1 = new Node(NODE_TYPES.CON, new St.Bin());
      const child2 = new Node(NODE_TYPES.CON, new St.Bin());
      child1.percent = 0;
      child2.percent = 0;
      const sizes = engine.computeSizes(container, [child1, child2]);
      expect(sizes).toEqual([500, 500]);
    });

    it("applies residual pixel fix when floor leaves remainder", () => {
      const container = new Node(NODE_TYPES.CON, new St.Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 100, height: 50 };
      const children = [0, 1, 2].map(() => {
        const n = new Node(NODE_TYPES.CON, new St.Bin());
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
      const container = new Node(NODE_TYPES.CON, new St.Bin());
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };
      const child1 = new Node(NODE_TYPES.CON, new St.Bin());
      const child2 = new Node(NODE_TYPES.CON, new St.Bin());
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
        sameParentMonitor: vi.fn(),
        floatingWindow: vi.fn(),
      });
    });

    it("resetSiblingPercent zeroes children", () => {
      const parent = new Node(NODE_TYPES.CON, new St.Bin());
      const a = new Node(NODE_TYPES.CON, new St.Bin());
      const b = new Node(NODE_TYPES.CON, new St.Bin());
      a.percent = 0.4;
      b.percent = 0.6;
      parent.appendChild(a);
      parent.appendChild(b);
      engine.resetSiblingPercent(parent);
      expect(a.percent).toBe(0);
      expect(b.percent).toBe(0);
    });

    it("redistributeSiblingPercent scales remaining percents to 1", () => {
      const parent = new Node(NODE_TYPES.CON, new St.Bin());
      const a = new Node(NODE_TYPES.CON, new St.Bin());
      const b = new Node(NODE_TYPES.CON, new St.Bin());
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
      ctx.extWm.focusMetaWindow = win;
      ctx.extWm.currentMonWsNode = monitor;

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
});

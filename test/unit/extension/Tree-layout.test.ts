/**
 * Unit tests for TilingRender layout algorithms (processSplit, processStacked, processTabbed, computeSizes)
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { Tree, Node, NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import { TilingRender } from "../../../src/lib/extension/tiling-render.js";
import { LayoutEngine } from "../../../src/lib/extension/layout-engine.js";
import { createTreePresentationStub } from "../mocks/helpers/index.js";

const savedDisplay = (global as any).display;
const savedWindowGroup = (global as any).window_group;

afterAll(() => {
  (global as any).display = savedDisplay;
  (global as any).window_group = savedWindowGroup;
});

describe("TilingRender Layout Algorithms", () => {
  let tree: Tree;
  let tilingRender: TilingRender;
  let mockAnvilRuntime: Record<string, any>;

  beforeEach(() => {
    (global as any).display = {
      get_workspace_manager: vi.fn(() => ({
        get_n_workspaces: vi.fn(() => 1),
        get_workspace_by_index: vi.fn((i: number) => ({ index: () => i })),
        get_active_workspace: vi.fn(() => ({
          get_work_area_for_monitor: vi.fn(() => ({
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
          })),
        })),
      })),
      get_n_monitors: vi.fn(() => 1),
    } as any;

    (global as any).window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    } as any;

    const mockSettings = {
      get_boolean: vi.fn(() => false),
      get_uint: vi.fn(() => 0),
    };
    mockAnvilRuntime = {
      ext: {
        settings: mockSettings,
      },
      get settings() {
        return mockSettings;
      },
      focusMetaWindow: null,
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      floatingWindow: vi.fn(() => false),
      adjacentMonitor: vi.fn(() => null),
      notifyFocusChanged: vi.fn(),
      presentation: createTreePresentationStub(),
    };

    tree = new Tree(mockAnvilRuntime as any);
    tree.initialize();
    const workspace = tree.createNode(tree.nodeValue, NODE_TYPES.WORKSPACE, "ws0")!;
    workspace.layout = LAYOUT_TYPES.HSPLIT;
    const monitor = tree.createNode(workspace.nodeValue, NODE_TYPES.MONITOR, "mo0ws0")!;
    monitor.layout = LAYOUT_TYPES.HSPLIT;
    mockAnvilRuntime.layoutEngine = new LayoutEngine({
      get tree() {
        return tree;
      },
      get settings() {
        return mockAnvilRuntime.ext.settings as any;
      },
      get focusMetaWindow() {
        return null;
      },
      get currentMonWsNode() {
        return null;
      },
      notifyFocusChanged: vi.fn(),
      moveWindow: vi.fn(),
      rectForMonitor: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      floatingWindow: vi.fn(() => false),
    });
    tilingRender = new TilingRender({
      settings: mockAnvilRuntime.ext.settings as any,
      getTree: () => tree,
      moveWindow: vi.fn(),
      getAllNodeWindows: () => tree.getNodeByType(NODE_TYPES.WINDOW),
      isFloatingExempt: vi.fn(() => false),
      isActiveWindowWorkspaceTiled: vi.fn(() => true),
      getTiledChildren: (nodes) => tree.getTiledChildren(nodes),
      getResizeCount: () => 0,
      findParent: (node, type) => tree.findParent(node, type),
      computeSizes: (n, c) => mockAnvilRuntime.layoutEngine.computeSizes(n, c),
      presentation: mockAnvilRuntime.presentation,
    });
    mockAnvilRuntime.tilingRender = tilingRender;
  });

  describe("computeSizes", () => {
    it("should divide space equally for horizontal split", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, [child1, child2]);

      expect(sizes).toHaveLength(2);
      expect(sizes[0]).toBe(500);
      expect(sizes[1]).toBe(500);
    });

    it("should divide space equally for vertical split", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 600 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, [child1, child2]);

      expect(sizes).toHaveLength(2);
      expect(sizes[0]).toBe(300);
      expect(sizes[1]).toBe(300);
    });

    it("should respect custom percent values", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      child1.percent = 0.7;

      const child2 = new Node(NODE_TYPES.CON, "con");
      child2.percent = 0.3;

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, [child1, child2]);

      expect(sizes[0]).toBe(700);
      expect(sizes[1]).toBe(300);
    });

    it("should handle three children equally", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 900, height: 500 };

      const children = [
        new Node(NODE_TYPES.CON, "con"),
        new Node(NODE_TYPES.CON, "con"),
        new Node(NODE_TYPES.CON, "con"),
      ];

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, children);

      expect(sizes).toHaveLength(3);
      expect(sizes[0]).toBe(300);
      expect(sizes[1]).toBe(300);
      expect(sizes[2]).toBe(300);
    });

    it("should floor the sizes to integers", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };

      const children = [
        new Node(NODE_TYPES.CON, "con"),
        new Node(NODE_TYPES.CON, "con"),
        new Node(NODE_TYPES.CON, "con"),
      ];

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, children);

      sizes.forEach((size: number) => {
        expect(Number.isInteger(size)).toBe(true);
      });
    });

    it("should handle single child", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };

      const child1 = new Node(NODE_TYPES.CON, "con");

      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, [child1]);

      expect(sizes).toHaveLength(1);
      expect(sizes[0]).toBe(1000);
    });
  });

  describe("processSplit - Horizontal", () => {
    it("should split two windows horizontally", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 500 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");

      const params = { sizes: [500, 500] };

      tilingRender.processSplit(container, child1, params, 0);
      tilingRender.processSplit(container, child2, params, 1);

      expect(child1.rect!.x).toBe(0);
      expect(child1.rect!.y).toBe(0);
      expect(child1.rect!.width).toBe(500);
      expect(child1.rect!.height).toBe(500);

      expect(child2.rect!.x).toBe(500);
      expect(child2.rect!.y).toBe(0);
      expect(child2.rect!.width).toBe(500);
      expect(child2.rect!.height).toBe(500);
    });

    it("should split three windows with custom sizes", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 100, y: 50, width: 1200, height: 600 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      const child3 = new Node(NODE_TYPES.CON, "con");

      const params = { sizes: [300, 500, 400] };

      tilingRender.processSplit(container, child1, params, 0);
      tilingRender.processSplit(container, child2, params, 1);
      tilingRender.processSplit(container, child3, params, 2);

      expect(child1.rect!.x).toBe(100);
      expect(child2.rect!.x).toBe(400);
      expect(child3.rect!.x).toBe(900);

      expect(child1.rect!.height).toBe(600);
      expect(child2.rect!.height).toBe(600);
      expect(child3.rect!.height).toBe(600);

      expect(child1.rect!.width).toBe(300);
      expect(child2.rect!.width).toBe(500);
      expect(child3.rect!.width).toBe(400);
    });

    it("should handle offset container position", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 200, y: 100, width: 800, height: 400 };

      const child = new Node(NODE_TYPES.CON, "con");
      const params = { sizes: [800] };

      tilingRender.processSplit(container, child, params, 0);

      expect(child.rect!.x).toBe(200);
      expect(child.rect!.y).toBe(100);
    });
  });

  describe("processSplit - Vertical", () => {
    it("should split two windows vertically", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");

      const params = { sizes: [400, 400] };

      tilingRender.processSplit(container, child1, params, 0);
      tilingRender.processSplit(container, child2, params, 1);

      expect(child1.rect!.x).toBe(0);
      expect(child1.rect!.y).toBe(0);
      expect(child1.rect!.width).toBe(1000);
      expect(child1.rect!.height).toBe(400);

      expect(child2.rect!.x).toBe(0);
      expect(child2.rect!.y).toBe(400);
      expect(child2.rect!.width).toBe(1000);
      expect(child2.rect!.height).toBe(400);
    });

    it("should split three windows vertically", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.VSPLIT;
      container.rect = { x: 0, y: 0, width: 1000, height: 900 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      const child3 = new Node(NODE_TYPES.CON, "con");

      const params = { sizes: [300, 300, 300] };

      tilingRender.processSplit(container, child1, params, 0);
      tilingRender.processSplit(container, child2, params, 1);
      tilingRender.processSplit(container, child3, params, 2);

      expect(child1.rect!.y).toBe(0);
      expect(child2.rect!.y).toBe(300);
      expect(child3.rect!.y).toBe(600);

      expect(child1.rect!.width).toBe(1000);
      expect(child2.rect!.width).toBe(1000);
      expect(child3.rect!.width).toBe(1000);
    });
  });

  describe("processStacked", () => {
    it("should stack single window with full container size", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.STACKED;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };
      container.childNodes = [new Node(NODE_TYPES.CON, "con")];

      const child = new Node(NODE_TYPES.CON, "con");
      const params = {};

      tilingRender.processStacked(container, child, params, 0);

      expect(child.rect!.x).toBe(0);
      expect(child.rect!.y).toBe(0);
      expect(child.rect!.width).toBe(1000);
      expect(child.rect!.height).toBe(800);
    });

    it("should stack multiple windows with tabs", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.STACKED;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      const child3 = new Node(NODE_TYPES.CON, "con");

      container.childNodes = [child1, child2, child3];

      const params = {};
      const stackHeight = tree.defaultStackHeight;

      tilingRender.processStacked(container, child1, params, 0);
      tilingRender.processStacked(container, child2, params, 1);
      tilingRender.processStacked(container, child3, params, 2);

      expect(child1.rect!.y).toBe(0);
      expect(child1.rect!.height).toBe(800);

      expect(child2.rect!.y).toBe(stackHeight);
      expect(child2.rect!.height).toBe(800 - stackHeight);

      expect(child3.rect!.y).toBe(stackHeight * 2);
      expect(child3.rect!.height).toBe(800 - stackHeight * 2);

      [child1, child2, child3].forEach((child) => {
        expect(child.rect!.x).toBe(0);
        expect(child.rect!.width).toBe(1000);
      });
    });

    it("should respect container offset", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.STACKED;
      container.rect = { x: 100, y: 50, width: 800, height: 600 };
      container.childNodes = [new Node(NODE_TYPES.CON, "con"), new Node(NODE_TYPES.CON, "con")];

      const child = new Node(NODE_TYPES.CON, "con");
      const params = {};

      tilingRender.processStacked(container, child, params, 0);

      expect(child.rect!.x).toBe(100);
      expect(child.rect!.y).toBe(50);
    });
  });

  describe("processTabbed", () => {
    it("should show single tab with full container", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.TABBED;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };
      container.childNodes = [new Node(NODE_TYPES.CON, "con")];

      const child = new Node(NODE_TYPES.CON, "con");
      const params = { stackedHeight: 0 };

      tilingRender.processTabbed(container, child, params, 0);

      expect(child.rect!.x).toBe(0);
      expect(child.rect!.y).toBe(0);
      expect(child.rect!.width).toBe(1000);
      expect(child.rect!.height).toBe(800);
    });

    it("should account for tab decoration height", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.TABBED;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };
      container.childNodes = [new Node(NODE_TYPES.CON, "con"), new Node(NODE_TYPES.CON, "con")];

      const child = new Node(NODE_TYPES.CON, "con");
      const stackedHeight = 35;
      const params = { stackedHeight };

      tilingRender.processTabbed(container, child, params, 0);

      expect(child.rect!.y).toBe(stackedHeight);
      expect(child.rect!.height).toBe(800 - stackedHeight);

      expect(child.rect!.x).toBe(0);
      expect(child.rect!.width).toBe(1000);
    });

    it("should show all tabs at same position", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.TABBED;
      container.rect = { x: 0, y: 0, width: 1000, height: 800 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      const child2 = new Node(NODE_TYPES.CON, "con");
      const child3 = new Node(NODE_TYPES.CON, "con");

      container.childNodes = [child1, child2, child3];

      const stackedHeight = 35;
      const params = { stackedHeight };

      tilingRender.processTabbed(container, child1, params, 0);
      tilingRender.processTabbed(container, child2, params, 1);
      tilingRender.processTabbed(container, child3, params, 2);

      [child1, child2, child3].forEach((child) => {
        expect(child.rect!.x).toBe(0);
        expect(child.rect!.y).toBe(stackedHeight);
        expect(child.rect!.width).toBe(1000);
        expect(child.rect!.height).toBe(800 - stackedHeight);
      });
    });

    it("should respect container offset", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.TABBED;
      container.rect = { x: 200, y: 100, width: 800, height: 600 };
      container.childNodes = [new Node(NODE_TYPES.CON, "con")];

      const child = new Node(NODE_TYPES.CON, "con");
      const params = { stackedHeight: 0 };

      tilingRender.processTabbed(container, child, params, 0);

      expect(child.rect!.x).toBe(200);
      expect(child.rect!.y).toBe(100);
    });
  });

  describe("processGap", () => {
    it("should add gaps to all sides", () => {
      const node = new Node(NODE_TYPES.CON, "con");
      node.rect = { x: 0, y: 0, width: 1000, height: 800 };

      const gap = 10;
      vi.spyOn(tilingRender, "calculateGaps").mockReturnValue(gap);

      const result = tilingRender.processGap(node);

      expect(result.x).toBe(gap);
      expect(result.y).toBe(gap);
      expect(result.width).toBe(1000 - gap * 2);
      expect(result.height).toBe(800 - gap * 2);
    });

    it("should handle larger gaps", () => {
      const node = new Node(NODE_TYPES.CON, "con");
      node.rect = { x: 100, y: 50, width: 1000, height: 800 };

      const gap = 20;
      vi.spyOn(tilingRender, "calculateGaps").mockReturnValue(gap);

      const result = tilingRender.processGap(node);

      expect(result.x).toBe(120);
      expect(result.y).toBe(70);
      expect(result.width).toBe(960);
      expect(result.height).toBe(760);
    });

    it("should not add gap if rect too small", () => {
      const node = new Node(NODE_TYPES.CON, "con");
      node.rect = { x: 0, y: 0, width: 15, height: 15 };

      const gap = 10;
      vi.spyOn(tilingRender, "calculateGaps").mockReturnValue(gap);

      const result = tilingRender.processGap(node);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
      expect(result.width).toBe(15);
      expect(result.height).toBe(15);
    });

    it("should handle zero gap", () => {
      const node = new Node(NODE_TYPES.CON, "con");
      node.rect = { x: 10, y: 20, width: 1000, height: 800 };

      vi.spyOn(tilingRender, "calculateGaps").mockReturnValue(0);

      const result = tilingRender.processGap(node);

      expect(result).toEqual({ x: 10, y: 20, width: 1000, height: 800 });
    });
  });

  describe("Layout Integration", () => {
    it("should compute sizes and apply split layout", () => {
      const container = new Node(NODE_TYPES.CON, "con");
      container.layout = LAYOUT_TYPES.HSPLIT;
      container.rect = { x: 0, y: 0, width: 1200, height: 600 };

      const child1 = new Node(NODE_TYPES.CON, "con");
      child1.percent = 0.6;
      const child2 = new Node(NODE_TYPES.CON, "con");
      child2.percent = 0.4;

      const children = [child1, child2];
      const sizes = mockAnvilRuntime.layoutEngine.computeSizes(container, children);
      const params = { sizes };

      tilingRender.processSplit(container, child1, params, 0);
      tilingRender.processSplit(container, child2, params, 1);

      expect(child1.rect!.width).toBe(720);
      expect(child2.rect!.width).toBe(480);
      expect(child1.rect!.x).toBe(0);
      expect(child2.rect!.x).toBe(720);
    });
  });
});

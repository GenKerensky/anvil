/**
 * Unit tests for the Tree class (core tiling operations)
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import St from "gi://St";
import { Tree, NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";

const savedDisplay = (global as any).display;
const savedWindowGroup = (global as any).window_group;

afterAll(() => {
  (global as any).display = savedDisplay;
  (global as any).window_group = savedWindowGroup;
});

describe("Tree", () => {
  let tree: Tree;
  let mockWindowManager: Record<string, any>;
  let mockWorkspaceManager: Record<string, any>;

  beforeEach(() => {
    (global as any).display = {
      get_workspace_manager: vi.fn(),
      get_n_monitors: vi.fn(() => 1),
    } as any;

    (global as any).window_group = {
      contains: vi.fn(() => false),
      add_child: vi.fn(),
      remove_child: vi.fn(),
    } as any;

    mockWorkspaceManager = {
      get_n_workspaces: vi.fn(() => 1),
      get_workspace_by_index: vi.fn((i: number) => ({
        index: () => i,
      })),
    };

    (global as any).display.get_workspace_manager.mockReturnValue(mockWorkspaceManager);

    const mockSettings = {
      get_boolean: vi.fn(() => true),
      get_uint: vi.fn(() => 0),
    };
    mockWindowManager = {
      ext: {
        settings: mockSettings,
      },
      get settings() {
        return mockSettings;
      },
      focusMetaWindow: null,
      determineSplitLayout: vi.fn(() => LAYOUT_TYPES.HSPLIT),
      floatingWindow: vi.fn(() => false),
      bindWorkspaceSignals: vi.fn(),
    };

    tree = new Tree(mockWindowManager as any);
  });

  describe("Constructor", () => {
    it("should create tree with root type", () => {
      expect(tree.nodeType).toBe(NODE_TYPES.ROOT);
    });

    it("should set ROOT layout", () => {
      expect(tree.layout).toBe(LAYOUT_TYPES.ROOT);
    });

    it("should set default stack height", () => {
      expect(tree.defaultStackHeight).toBe(35);
    });

    it("should have TreeHost (not concrete WindowManager)", () => {
      expect(tree.host).toBe(mockWindowManager);
      expect(tree.host.determineSplitLayout).toBeDefined();
    });

    it("should initialize workspaces", () => {
      const workspaces = tree.nodeWorkpaces;
      expect(workspaces.length).toBeGreaterThan(0);
    });
  });

  describe("findNode", () => {
    it("should find root node by value", () => {
      const found = tree.findNode(tree.nodeValue);

      expect(found).toBe(tree);
    });

    it("should find workspace node", () => {
      const ws = tree.nodeWorkpaces[0];
      const found = tree.findNode(ws.nodeValue);

      expect(found).toBe(ws);
    });

    it("should return null for non-existent node", () => {
      const found = tree.findNode("nonexistent-node");

      expect(found).toBeNull();
    });

    it("should find nested nodes", () => {
      const monitors = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR);
      const containerBin = new St.Bin();
      const container = tree.createNode(monitors[0].nodeValue, NODE_TYPES.CON, containerBin);
      const found = tree.findNode(containerBin);

      expect(found).toBe(container);
    });
  });

  describe("createNode", () => {
    it("should create node under parent", () => {
      const monitors = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR);
      const containerBin = new St.Bin();
      const newNode = tree.createNode(monitors[0].nodeValue, NODE_TYPES.CON, containerBin);

      expect(newNode).toBeDefined();
      expect(newNode!.nodeType).toBe(NODE_TYPES.CON);
      expect(newNode!.nodeValue).toBe(containerBin);
    });

    it("should add node to parent children", () => {
      const monitor = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
      const initialChildCount = monitor.childNodes.length;

      tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

      expect(monitor.childNodes.length).toBe(initialChildCount + 1);
    });

    it("should set node settings from tree", () => {
      const workspace = tree.nodeWorkpaces[0];
      const newNode = tree.createNode(workspace.nodeValue, NODE_TYPES.CON, new St.Bin());

      expect(newNode!.settings).toBe(tree.settings);
    });

    it("should create node with default TILE mode", () => {
      const monitor = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
      const newNode = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

      expect(newNode).toBeDefined();
    });

    it("should return undefined if parent not found", () => {
      const newNode = tree.createNode("nonexistent-parent", NODE_TYPES.CON, new St.Bin());

      expect(newNode).toBeUndefined();
    });

    it("should handle inserting after window parent", () => {
      const monitor = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];

      const node1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());
      const node2 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

      expect(monitor.childNodes).toContain(node1);
      expect(monitor.childNodes).toContain(node2);
    });
  });

  describe("nodeWorkspaces", () => {
    it("should return all workspace nodes", () => {
      const workspaces = tree.nodeWorkpaces;

      expect(Array.isArray(workspaces)).toBe(true);
      workspaces.forEach((ws) => {
        expect(ws.nodeType).toBe(NODE_TYPES.WORKSPACE);
      });
    });

    it("should find workspaces initialized in constructor", () => {
      const workspaces = tree.nodeWorkpaces;

      expect(workspaces.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("nodeWindows", () => {
    it("should return empty array when no windows", () => {
      const windows = tree.nodeWindows;

      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBe(0);
    });

    it("should return all window nodes when windows exist", () => {
      const monitor = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];
      tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());

      const windows = tree.nodeWindows;
      expect(Array.isArray(windows)).toBe(true);
    });
  });

  describe("addWorkspace", () => {
    it("should add new workspace", () => {
      mockWorkspaceManager.get_n_workspaces.mockReturnValue(2);
      mockWorkspaceManager.get_workspace_by_index.mockImplementation((i: number) => ({
        index: () => i,
      }));

      const initialCount = tree.nodeWorkpaces.length;
      const result = tree.addWorkspace(1);

      expect(result).toBe(true);
      expect(tree.nodeWorkpaces.length).toBe(initialCount + 1);
    });

    it("should not add duplicate workspace", () => {
      const initialCount = tree.nodeWorkpaces.length;

      const result = tree.addWorkspace(0);

      expect(result).toBe(false);
      expect(tree.nodeWorkpaces.length).toBe(initialCount);
    });

    it("should set workspace layout to HSPLIT", () => {
      mockWorkspaceManager.get_n_workspaces.mockReturnValue(2);

      tree.addWorkspace(1);
      const workspace = tree.findNode("ws1");

      expect(workspace!.layout).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should create monitors for workspace", () => {
      mockWorkspaceManager.get_n_workspaces.mockReturnValue(2);
      (global as any).display.get_n_monitors.mockReturnValue(2);

      tree.addWorkspace(1);
      const workspace = tree.findNode("ws1");
      const monitors = workspace!.getNodeByType(NODE_TYPES.MONITOR);

      expect(monitors.length).toBe(2);
    });
  });

  describe("removeWorkspace", () => {
    it("should remove existing workspace", () => {
      const result = tree.removeWorkspace(0);

      expect(result).toBe(true);
      expect(tree.nodeWorkpaces.length).toBe(0);
    });

    it("should return false for non-existent workspace", () => {
      const result = tree.removeWorkspace(999);

      expect(result).toBe(false);
    });

    it("should remove workspace from tree", () => {
      tree.removeWorkspace(0);

      const found = tree.findNode("ws0");
      expect(found).toBeNull();
    });
  });

  describe("Tree Structure Integrity", () => {
    it("should maintain parent-child relationships", () => {
      const monitors = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR);

      monitors.forEach((monitor) => {
        expect(monitor.parentNode).toBe(tree.nodeWorkpaces[0]);
      });
    });

    it("should have proper node hierarchy", () => {
      expect(tree.nodeType).toBe(NODE_TYPES.ROOT);

      const workspaces = tree.getNodeByType(NODE_TYPES.WORKSPACE);
      workspaces.forEach((ws) => {
        expect(ws.parentNode).toBe(tree);

        const monitors = ws.getNodeByType(NODE_TYPES.MONITOR);
        monitors.forEach((mon) => {
          expect(mon.parentNode).toBe(ws);
        });
      });
    });

    it("should allow deep nesting", () => {
      const monitor = tree.nodeWorkpaces[0].getNodeByType(NODE_TYPES.MONITOR)[0];

      const bin1 = new St.Bin();
      const bin2 = new St.Bin();
      const bin3 = new St.Bin();

      const container1 = tree.createNode(monitor.nodeValue, NODE_TYPES.CON, bin1);
      const container2 = tree.createNode(bin1, NODE_TYPES.CON, bin2);
      const container3 = tree.createNode(bin2, NODE_TYPES.CON, bin3);

      expect(container3!.level).toBe(container1!.level + 2);
      expect(tree.findNode(bin3)).toBe(container3);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty parent value", () => {
      const result = tree.createNode("", NODE_TYPES.CON, new St.Bin());

      expect(result).toBeUndefined();
    });

    it("should handle null parent value", () => {
      const result = tree.createNode(null, NODE_TYPES.CON, new St.Bin());

      expect(result).toBeUndefined();
    });

    it("should find nodes case-sensitively for string values", () => {
      const workspace = tree.nodeWorkpaces[0];
      expect(tree.findNode("ws0")).toBe(workspace);
      expect(tree.findNode("WS0")).toBeNull();
    });
  });
});

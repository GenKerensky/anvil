import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import Meta from "gi://Meta";

import { LegacyWorkspaceTopology } from "../../../src/lib/extension/legacy-workspace-topology.js";
import { LAYOUT_TYPES, NODE_TYPES, Tree, type Node } from "../../../src/lib/extension/tree.js";
import {
  createMockSettings,
  createMockWindow,
  createTreePresentationStub,
  installGnomeGlobals,
} from "../mocks/helpers/index.js";

describe("LegacyWorkspaceTopology", () => {
  let globals: ReturnType<typeof installGnomeGlobals>;
  let tree: Tree;
  let topology: LegacyWorkspaceTopology;
  let bindWorkspaceSignals: Mock<(workspace: Meta.Workspace) => void>;
  let presentation: ReturnType<typeof createTreePresentationStub>;

  beforeEach(() => {
    globals = installGnomeGlobals({
      display: { monitorCount: 2 },
      workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 1 },
    });
    bindWorkspaceSignals = vi.fn<(workspace: Meta.Workspace) => void>();
    presentation = createTreePresentationStub();
    vi.spyOn(presentation, "ensure");
    vi.spyOn(presentation, "remove");
    let adjacentMonitor: (node: Node, direction: Meta.MotionDirection) => Node | null = () => null;
    tree = new Tree({
      settings: createMockSettings(),
      focusMetaWindow: null,
      presentation,
      determineSplitLayout: () => LAYOUT_TYPES.VSPLIT,
      floatingWindow: () => false,
      adjacentMonitor: (node, direction) => adjacentMonitor(node, direction),
    });
    topology = new LegacyWorkspaceTopology({
      tree,
      determineSplitLayout: () => LAYOUT_TYPES.VSPLIT,
      bindWorkspaceSignals,
    });
    adjacentMonitor = (node, direction) => topology.adjacentMonitorNode(node, direction);
    tree.initialize();
  });

  afterEach(() => {
    tree.dispose();
    globals.cleanup();
    vi.restoreAllMocks();
  });

  it("discovers every GNOME workspace/monitor surface with the owner layouts", () => {
    topology.initialize();

    expect(tree.getNodeByType(NODE_TYPES.WORKSPACE)).toHaveLength(3);
    expect(tree.getNodeByType(NODE_TYPES.MONITOR)).toHaveLength(6);
    expect(tree.findNode("ws1")?.layout).toBe(LAYOUT_TYPES.HSPLIT);
    expect(tree.findNode("mo1ws2")?.layout).toBe(LAYOUT_TYPES.VSPLIT);
  });

  it("binds each discovered workspace exactly once and ignores duplicate adds", () => {
    topology.initialize();

    expect(bindWorkspaceSignals.mock.calls.map(([workspace]) => workspace)).toEqual(
      globals.workspaces
    );
    expect(topology.addWorkspace(1)).toBe(false);
    expect(bindWorkspaceSignals).toHaveBeenCalledTimes(3);
    expect(tree.getNodeByType(NODE_TYPES.WORKSPACE)).toHaveLength(3);
  });

  it("rebuilds a fresh topology after releasing the previous structure", () => {
    topology.initialize();
    const staleWindow = createMockWindow({ workspace: globals.workspaces[0] });
    const staleNode = tree.createNode("mo0ws0", NODE_TYPES.WINDOW, staleWindow)!;

    topology.rebuild();

    expect(tree.findNode(staleWindow)).toBeNull();
    expect(tree.getNodeByType(NODE_TYPES.WORKSPACE)).toHaveLength(3);
    expect(tree.getNodeByType(NODE_TYPES.MONITOR)).toHaveLength(6);
    expect(presentation.remove).toHaveBeenCalledWith(staleNode);
  });

  it("fails safely when Mutter has no workspace for an index", () => {
    globals.workspaceManager.get_workspace_by_index.mockReturnValueOnce(null);

    expect(topology.addWorkspace(99)).toBe(false);

    expect(tree.findNode("ws99")).toBeNull();
    expect(bindWorkspaceSignals).not.toHaveBeenCalled();
  });

  it("removes a middle workspace and reindexes the surviving workspace and monitors", () => {
    topology.initialize();
    const originalWorkspaceTwo = tree.findNode("ws2");
    const originalMonitor = tree.findNode("mo1ws2");

    expect(topology.removeWorkspace(1)).toBe(true);

    expect(tree.findNode("ws1")).toBe(originalWorkspaceTwo);
    expect(tree.findNode("mo1ws1")).toBe(originalMonitor);
    expect(tree.findNode("ws2")).toBeNull();
    expect(tree.findNode("mo1ws2")).toBeNull();
    expect(tree.getNodeByType(NODE_TYPES.WORKSPACE)).toHaveLength(2);
    expect(tree.getNodeByType(NODE_TYPES.MONITOR)).toHaveLength(4);
  });

  it("releases every presentation record in a removed workspace subtree", () => {
    topology.initialize();
    const workspace = tree.findNode("ws1")!;
    const monitor = tree.findNode("mo0ws1")!;
    const metaWindow = createMockWindow({ workspace: globals.workspaces[1] });
    const windowNode = tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow)!;

    expect(topology.removeWorkspace(1)).toBe(true);

    expect(presentation.remove).toHaveBeenCalledWith(windowNode);
    expect(presentation.remove).toHaveBeenCalledWith(monitor);
    expect(presentation.remove).toHaveBeenCalledWith(workspace);
  });

  it("leaves topology unchanged when the requested workspace is missing", () => {
    topology.initialize();
    const before = tree.serializeForTest();

    expect(topology.removeWorkspace(99)).toBe(false);
    expect(tree.serializeForTest()).toEqual(before);
  });

  it("resolves the active and adjacent monitor/workspace nodes through GNOME", () => {
    topology.initialize();
    globals.display.get_current_monitor.mockReturnValue(1);
    globals.display.get_monitor_neighbor_index.mockImplementation(
      (monitor: number, direction: Meta.DisplayDirection) =>
        monitor === 0 && direction === Meta.DisplayDirection.RIGHT ? 1 : -1
    );
    const metaWindow = createMockWindow({ monitor: 0, workspace: globals.workspaces[0] });
    const windowNode = tree.createNode("mo0ws0", NODE_TYPES.WINDOW, metaWindow)!;

    expect(topology.activeMonitorWorkspaceNode()).toBe(tree.findNode("mo1ws1"));
    expect(topology.adjacentMonitorNode(windowNode, Meta.MotionDirection.RIGHT)).toBe(
      tree.findNode("mo1ws0")
    );
    expect(topology.adjacentMonitorNode(windowNode, Meta.MotionDirection.LEFT)).toBeNull();
  });

  it("preserves the window workspace identity and returns null for a missing target node", () => {
    topology.initialize();
    globals.display.get_monitor_neighbor_index.mockReturnValue(1);
    const metaWindow = createMockWindow({ monitor: 0, workspace: globals.workspaces[2] });
    const windowNode = tree.createNode("mo0ws2", NODE_TYPES.WINDOW, metaWindow)!;

    expect(topology.adjacentMonitorNode(windowNode, Meta.MotionDirection.RIGHT)).toBe(
      tree.findNode("mo1ws2")
    );

    tree.removeSubtree(tree.findNode("mo1ws2")!);
    expect(topology.adjacentMonitorNode(windowNode, Meta.MotionDirection.RIGHT)).toBeNull();
  });

  it("does not ask Mutter for a neighbor on a single-monitor topology", () => {
    topology.initialize();
    globals.display.get_n_monitors.mockReturnValue(1);
    const metaWindow = createMockWindow({ monitor: 0, workspace: globals.workspaces[0] });
    const windowNode = tree.createNode("mo0ws0", NODE_TYPES.WINDOW, metaWindow)!;

    expect(topology.adjacentMonitorNode(windowNode, Meta.MotionDirection.RIGHT)).toBeNull();
    expect(globals.display.get_monitor_neighbor_index).not.toHaveBeenCalled();
  });

  it("enumerates windows across workspaces in stable sequence order", () => {
    const later = createMockWindow({ id: 20, workspace: globals.workspaces[0] });
    const earlier = createMockWindow({ id: 10, workspace: globals.workspaces[2] });
    globals.display.get_tab_list.mockImplementation(
      (_tabList: Meta.TabList, workspace: Meta.Workspace) => {
        if (workspace === globals.workspaces[0]) return [later];
        if (workspace === globals.workspaces[2]) return [earlier];
        return [];
      }
    );

    expect(topology.windowsAcrossWorkspaces()).toEqual([earlier, later]);
  });
});

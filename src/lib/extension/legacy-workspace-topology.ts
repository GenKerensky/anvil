/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import Meta from "gi://Meta";

import { LAYOUT_TYPES, NODE_TYPES, type Node, type Tree } from "./tree.js";

export interface LegacyWorkspaceTopologyHost {
  readonly tree: Tree;
  determineSplitLayout(): string;
  bindWorkspaceSignals(workspace: Meta.Workspace): void;
}

/**
 * Owns the legacy tree's GNOME workspace and monitor projection.
 *
 * Tree remains responsible for structural operations. This adapter is the only
 * production owner that discovers GNOME topology, translates it into legacy
 * identities, and reindexes those identities after workspace removal.
 */
export class LegacyWorkspaceTopology {
  constructor(private readonly host: LegacyWorkspaceTopologyHost) {}

  initialize(): void {
    const workspaceManager = global.display.get_workspace_manager();
    for (let index = 0; index < workspaceManager.get_n_workspaces(); index += 1) {
      this.addWorkspace(index);
    }
  }

  rebuild(): void {
    this.host.tree.reset();
    this.initialize();
  }

  addWorkspace(workspaceIndex: number): boolean {
    const { tree } = this.host;
    const identity = this.workspaceIdentity(workspaceIndex);
    if (tree.findNode(identity)) return false;
    const workspace = global.display.get_workspace_manager().get_workspace_by_index(workspaceIndex);
    if (!workspace) return false;

    const workspaceNode = tree.createNode(tree.nodeValue, NODE_TYPES.WORKSPACE, identity);
    if (!workspaceNode) return false;

    workspaceNode.layout = LAYOUT_TYPES.HSPLIT;
    this.host.bindWorkspaceSignals(workspace);
    this.addMonitors(workspaceIndex);
    return true;
  }

  removeWorkspace(workspaceIndex: number): boolean {
    const { tree } = this.host;
    const workspaceNode = tree.findNode(this.workspaceIdentity(workspaceIndex));
    if (!workspaceNode || !tree.removeSubtree(workspaceNode)) return false;

    for (const remaining of tree.getNodeByType(NODE_TYPES.WORKSPACE)) {
      const currentIndex = this.parseWorkspaceIndex(remaining);
      if (currentIndex === null || currentIndex <= workspaceIndex) continue;

      tree.renameNodeIdentity(remaining, this.workspaceIdentity(currentIndex - 1));
      for (const monitor of remaining.getNodeByType(NODE_TYPES.MONITOR)) {
        const monitorIndex = this.parseMonitorIndex(monitor);
        if (monitorIndex !== null) {
          tree.renameNodeIdentity(monitor, this.monitorIdentity(monitorIndex, currentIndex - 1));
        }
      }
    }
    return true;
  }

  activeMonitorWorkspaceNode(): Node | null {
    const display = global.display;
    const workspaceIndex = display.get_workspace_manager().get_active_workspace_index();
    return this.host.tree.findNode(
      this.monitorIdentity(display.get_current_monitor(), workspaceIndex)
    );
  }

  /** Enumerate all normal windows in stable Mutter creation order. */
  windowsAcrossWorkspaces(): Meta.Window[] {
    const workspaceManager = global.display.get_workspace_manager();
    const windows: Meta.Window[] = [];
    for (let index = 0; index < workspaceManager.get_n_workspaces(); index += 1) {
      windows.push(
        ...global.display.get_tab_list(
          Meta.TabList.NORMAL_ALL,
          workspaceManager.get_workspace_by_index(index)
        )
      );
    }
    return windows.sort(
      (first, second) => first.get_stable_sequence() - second.get_stable_sequence()
    );
  }

  adjacentMonitorNode(nodeWindow: Node, direction: Meta.MotionDirection): Node | null {
    const metaWindow = nodeWindow.nodeValue as Meta.Window;
    const displayDirection = this.displayDirection(direction);
    if (displayDirection === null) return null;
    // Mutter 50.1 can crash while resolving a logical neighbor that cannot
    // exist. Avoid entering that API on a single-monitor topology.
    if (global.display.get_n_monitors() < 2) return null;
    const targetMonitor = global.display.get_monitor_neighbor_index(
      metaWindow.get_monitor(),
      displayDirection
    );
    if (targetMonitor < 0) return null;
    return this.host.tree.findNode(
      this.monitorIdentity(targetMonitor, metaWindow.get_workspace().index())
    );
  }

  private addMonitors(workspaceIndex: number): void {
    const { tree } = this.host;
    for (let monitorIndex = 0; monitorIndex < global.display.get_n_monitors(); monitorIndex += 1) {
      const monitorNode = tree.createNode(
        this.workspaceIdentity(workspaceIndex),
        NODE_TYPES.MONITOR,
        this.monitorIdentity(monitorIndex, workspaceIndex)
      );
      if (monitorNode) monitorNode.layout = this.host.determineSplitLayout();
    }
  }

  private workspaceIdentity(index: number): string {
    return `ws${index}`;
  }

  private monitorIdentity(monitorIndex: number, workspaceIndex: number): string {
    return `mo${monitorIndex}ws${workspaceIndex}`;
  }

  private parseWorkspaceIndex(node: Node): number | null {
    const match = String(node.nodeValue).match(/^ws(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  private parseMonitorIndex(node: Node): number | null {
    const match = String(node.nodeValue).match(/^mo(\d+)ws\d+$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  private displayDirection(direction: Meta.MotionDirection): Meta.DisplayDirection | null {
    switch (direction) {
      case Meta.MotionDirection.LEFT:
        return Meta.DisplayDirection.LEFT;
      case Meta.MotionDirection.RIGHT:
        return Meta.DisplayDirection.RIGHT;
      case Meta.MotionDirection.UP:
        return Meta.DisplayDirection.UP;
      case Meta.MotionDirection.DOWN:
        return Meta.DisplayDirection.DOWN;
      default:
        return null;
    }
  }
}

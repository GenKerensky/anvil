/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
// Mtk is available via Meta for Rectangle types; keep Shell/St runtime imports.
import Shell from "gi://Shell";
import type ShellNS from "@girs/shell-18";
import St from "gi://St";

// Shared state
import { Logger } from "../shared/logger.js";

// App imports
import * as Utils from "./utils.js";
import { WINDOW_MODES } from "./window/constants.js";
import {
  ensureWindowTab,
  ensureConDecoration,
  destroyConDecoration,
  refreshTabTitle,
} from "./tab-decoration.js";

/**
 * Narrow host for Tree — no concrete WindowManager import (Stage 7).
 * Dependency direction: tree ← layout ← wm.
 */
export interface TreeHost {
  readonly settings: Gio.Settings;
  readonly focusMetaWindow: Meta.Window | null;
  determineSplitLayout(): string;
  floatingWindow(node: Node<any>): boolean;
  bindWorkspaceSignals(workspace: Meta.Workspace): void;
}

/**
 * Tree invariants:
 * (1) every WINDOW has a MONITOR ancestor
 * (2) after redistributeSiblingPercent, tiled sibling percents sum to ~1
 * (3) FLOAT windows may exist but skip size compute in layout
 */

export const NODE_TYPES = Utils.createEnum([
  "ROOT",
  "MONITOR", //Output in i3
  "CON", //Container in i3
  "WINDOW",
  "WORKSPACE",
]);

export const LAYOUT_TYPES = Utils.createEnum([
  "STACKED",
  "TABBED",
  "ROOT",
  "HSPLIT",
  "VSPLIT",
  "PRESET",
]);

export const ORIENTATION_TYPES = Utils.createEnum(["NONE", "HORIZONTAL", "VERTICAL"]);

export const POSITION = Utils.createEnum(["BEFORE", "AFTER", "UNKNOWN"]);

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Criteria for Node._search / getNodeBy* (B5-5). */
export type NodeSearchCriteria = "VALUE" | "TYPE" | "MODE" | "LAYOUT";

/** True when sibling percent should fall back to equal share (B5-3). */
export function isUnsetPercent(percent: number | undefined | null): boolean {
  return percent === undefined || percent === null || percent <= 0;
}

/**
 * Type guard interface: when isWindow() returns true, the node can be
 * treated as having Meta.Window data for _data and nodeValue.
 */
interface WindowNode extends Node<any> {
  _data: Meta.Window;
  nodeValue: Meta.Window;
}

/** Shape returned by Tree.serializeForTest (B1-3). */
export type TreeTestNode = {
  type: string;
  layout: string | null;
  mode: string | null;
  childCount: number;
  children: TreeTestNode[];
  wmClass?: string | null;
};

function serializeNodeForTest(node: Node<any>): TreeTestNode {
  const children = node.childNodes.map((c) => serializeNodeForTest(c));
  const data: TreeTestNode = {
    type: node.nodeType,
    layout: node.layout ?? null,
    mode: node.mode || null,
    childCount: children.length,
    children,
  };
  if (node.isWindow()) {
    const meta = node.nodeValue as Meta.Window | null;
    data.wmClass =
      meta?.get_wm_class?.() ?? (meta as { wm_class?: string | null } | null)?.wm_class ?? null;
  }
  return data;
}

/**
 * The Node data representation of the following elements in the user's display:
 *
 * Monitor,
 * Window,
 * Container (generic),
 * Workspace
 *
 */
export class Node<T extends string> extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  _type: T;
  _data: Meta.Window | string | St.Bin | null;
  _parent: Node<T> | null;
  _nodes: Node<T>[];
  mode: string = "";
  /**
   * Sibling space share in parent. `undefined` = unset → equal share in computeSizes (B5-3).
   * Do not use 0 for "unset"; explicit 0 is treated as unset only for legacy safety.
   */
  percent: number | undefined = undefined;
  _rect: RectLike | null = null;
  tab: St.BoxLayout | null = null;
  decoration: St.BoxLayout | null = null;
  app: ShellNS.App | null = null;
  /** Clutter.Actor for the compositor — only for WINDOW types */
  _actor: Clutter.Actor | null = null;
  /** Render rect set by processGap — used by processNode rendering */
  renderRect?: RectLike;
  pointer: { x: number; y: number } | null = null;
  actorBin!: St.Bin | null;
  settings!: Gio.Settings | null;
  layout: string | undefined;
  lastTabFocus: any = null;

  // --- WindowManager monkey-patched state (set at runtime) ---
  /** Previous layout before stacked/tabbed toggle */
  prevLayout?: string;
  /** Was floating before mass-float operation */
  prevFloat?: boolean;
  /** Grab mode during grab operations (GRAB_TYPES) */
  grabMode?: string | null;
  /** Initial grab op code */
  initGrabOp?: Meta.GrabOp | null;
  /** Initial rect before resize/drag */
  initRect?: RectLike | null;
  /** Tab style marker for background windows */
  backgroundTab?: boolean;
  /** Preview hint actor during drag-drop tiling */
  previewHint?: St.Bin | null;
  /** Create container flag during drag-drop */
  createCon?: boolean;
  /** Detach window flag during drag-drop */
  detachWindow?: boolean;

  constructor(type: T, data: Meta.Window | string | St.Bin | null) {
    super();
    // TODO - move to GObject property definitions?
    this._type = type; // see NODE_TYPES
    // _data: Meta.Window, unique id strings (Monitor,
    // Workspace or St.Bin - a representation of Container)
    this._data = data;
    this._parent = null;
    this._nodes = []; // Child elements of this node
    this.mode = WINDOW_MODES.DEFAULT as string;
    this.percent = undefined;
    this._rect = null;
    this.tab = null;
    this.decoration = null;
    this.app = null;
    this.pointer = null;

    if (this.isWindow()) {
      // When destroy() is called on Meta.Window, it might not be
      // available so we store it immediately
      this._initMetaWindow();
      this._actor = this._data.get_compositor_private();
      ensureWindowTab(this);
    }

    if (this.isCon()) {
      ensureConDecoration(this);
    }
  }

  get windowActor() {
    return this._actor;
  }

  get actor() {
    switch (this.nodeType) {
      case NODE_TYPES.WINDOW:
        // A Meta.Window was assigned during creation
        // But obtain the Clutter.Actor
        return this._actor;
      case NODE_TYPES.CON:
      case NODE_TYPES.ROOT:
        // A St.Bin was assigned during creation
        return this.nodeValue;
      case NODE_TYPES.MONITOR:
      case NODE_TYPES.WORKSPACE:
        // A separate St.Bin was assigned on another attribute during creation
        return this.actorBin;
      default:
        return null;
    }
  }

  set rect(rect: RectLike | null) {
    this._rect = rect;
    if (!rect) return;
    switch (this.nodeType) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON:
      case NODE_TYPES.MONITOR:
      case NODE_TYPES.ROOT:
      case NODE_TYPES.WORKSPACE:
        if (this.actor) {
          (this.actor as Clutter.Actor).set_size(rect.width, rect.height);
          (this.actor as Clutter.Actor).set_position(rect.x, rect.y);
        }
        break;
    }
  }

  get rect() {
    return this._rect;
  }

  get childNodes() {
    return this._nodes;
  }

  set childNodes(nodes: Node<T>[]) {
    this._nodes = nodes;
  }

  get firstChild(): Node<T> | null {
    if (this._nodes && this._nodes.length >= 1) {
      return this._nodes[0];
    }
    return null;
  }

  get level() {
    let _level = 0;
    let refNode = this.parentNode;
    while (refNode) {
      _level += 1;
      refNode = refNode.parentNode;
    }

    return _level;
  }

  /**
   * Find the index of this relative to the siblings
   */
  get index() {
    if (this.parentNode) {
      const childNodes = this.parentNode.childNodes;
      for (let i = 0; i < childNodes.length; i++) {
        if (childNodes[i] === this) {
          return i;
        }
      }
    }
    return null;
  }

  get lastChild(): Node<T> | null {
    if (this._nodes && this._nodes.length >= 1) {
      return this._nodes[this._nodes.length - 1];
    }
    return null;
  }

  get nextSibling(): Node<T> | null {
    if (this.parentNode) {
      const idx = this.index;
      if (idx !== null && this.parentNode.lastChild !== this) {
        return this.parentNode.childNodes[idx + 1];
      }
    }
    return null;
  }

  get nodeType() {
    return this._type;
  }

  get nodeValue() {
    return this._data;
  }

  get parentNode() {
    return this._parent;
  }

  set parentNode(node: Node<T> | null) {
    this._parent = node;
  }

  get previousSibling(): Node<T> | null {
    if (this.parentNode) {
      const idx = this.index;
      if (idx !== null && this.parentNode.firstChild !== this) {
        return this.parentNode.childNodes[idx - 1];
      }
    }
    return null;
  }

  appendChild(node: Node<any>) {
    if (!node) return null;
    if (node.parentNode) node.parentNode.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  /**
   * Checks if node is a descendant of this,
   * or a descendant of its childNodes, etc
   */
  contains(node: Node<any>) {
    if (!node) return false;
    const searchNode = this.getNodeByValue(node.nodeValue);
    return searchNode ? true : false;
  }

  getNodeByLayout(layout: string) {
    return this._search(layout, "LAYOUT");
  }

  getNodeByMode(mode: string) {
    return this._search(mode, "MODE");
  }

  getNodeByValue(value: unknown) {
    const results = this._search(value, "VALUE");
    return results && results.length >= 1 ? results[0] : null;
  }

  getNodeByType(type: string) {
    const results = this._search(type, "TYPE");
    return results;
  }

  insertBefore(newNode: Node<any>, childNode: Node<any> | null) {
    if (!newNode) return null;
    if (newNode === childNode) return null;
    if (!childNode) {
      this.appendChild(newNode);
      return newNode;
    }
    if (childNode.parentNode !== this) return null;
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    const index = childNode.index;

    if (index === 0) {
      this.childNodes.unshift(newNode);
    } else if (index !== null && index > 0) {
      this.childNodes.splice(index, 0, newNode);
    }
    newNode.parentNode = this;

    return newNode;
  }

  isLayout(name: string) {
    const layout = this.layout;
    if (!layout) return false;

    return name === layout;
  }

  isHSplit() {
    return this.isLayout(LAYOUT_TYPES.HSPLIT);
  }

  isVSplit() {
    return this.isLayout(LAYOUT_TYPES.VSPLIT);
  }

  isStacked() {
    return this.isLayout(LAYOUT_TYPES.STACKED);
  }

  isTabbed() {
    return this.isLayout(LAYOUT_TYPES.TABBED);
  }

  isType(name: string) {
    const type = this.nodeType;
    if (!type) return false;

    return name === type;
  }

  /** @returns {this is WindowNode} */
  isWindow(): this is WindowNode {
    return this.isType(NODE_TYPES.WINDOW);
  }

  isCon() {
    return this.isType(NODE_TYPES.CON);
  }

  isMonitor() {
    return this.isType(NODE_TYPES.MONITOR);
  }

  isWorkspace() {
    return this.isType(NODE_TYPES.WORKSPACE);
  }

  isRoot() {
    return this.isType(NODE_TYPES.ROOT);
  }

  isMode(name: string) {
    const mode = this.mode;
    if (!name) return false;

    return name === mode;
  }

  isFloat() {
    return this.isMode(WINDOW_MODES.FLOAT);
  }

  isTile() {
    return this.isMode(WINDOW_MODES.TILE);
  }

  isGrabTile() {
    return this.isMode(WINDOW_MODES.GRAB_TILE);
  }

  removeChild(node: Node<any>) {
    if (node.isTabbed() && node.decoration) {
      destroyConDecoration(node);
    }

    let refNode;
    if (this.contains(node)) {
      // Since contains() tries to find node on all descendants,
      // detach only from the immediate parent
      const parentNode = node.parentNode;
      if (!parentNode || node.index === null) return null;
      refNode = parentNode.childNodes.splice(node.index, 1)[0];
      if (refNode) refNode.parentNode = null;
    }
    if (!refNode) {
      throw `NodeNotFound ${node}`;
    }
    return refNode;
  }

  /**
   * Backend for getNodeBy[attribute] (B5-5: typed criteria, not free strings).
   */
  _search(term: unknown, criteria: NodeSearchCriteria) {
    const results: Node<any>[] = [];
    const searchFn = (candidate: Node<any>) => {
      switch (criteria) {
        case "VALUE":
          if (candidate.nodeValue === term) results.push(candidate);
          break;
        case "TYPE":
          if (candidate.nodeType === term) results.push(candidate);
          break;
        case "MODE":
          if (candidate.mode === term) results.push(candidate);
          break;
        case "LAYOUT":
          if (candidate.layout && candidate.layout === term) results.push(candidate);
          break;
      }
    };

    this._walk(searchFn, this._traverseBreadthFirst);
    return results;
  }

  // start walking from root and all child nodes
  _traverseBreadthFirst(callback: (node: Node<any>) => void) {
    const queue = new Queue<Node<any>>();
    queue.enqueue(this);

    let currentNode: Node<any> | undefined = queue.dequeue();

    while (currentNode) {
      for (let i = 0, length = currentNode.childNodes.length; i < length; i++) {
        queue.enqueue(currentNode.childNodes[i]);
      }

      callback(currentNode);
      currentNode = queue.dequeue();
    }
  }

  // start walking from bottom to root
  _traverseDepthFirst(callback: (node: Node<any>) => void) {
    const recurse = (currentNode: Node<any>) => {
      for (let i = 0, length = currentNode.childNodes.length; i < length; i++) {
        recurse(currentNode.childNodes[i]);
      }

      callback(currentNode);
    };
    recurse(this);
  }

  _walk(callback: (node: Node<any>) => void, traversal: (cb: (node: Node<any>) => void) => void) {
    traversal.call(this, callback);
  }

  _initMetaWindow() {
    if (this.isWindow()) {
      const windowTracker = Shell.WindowTracker.get_default();
      const metaWin = this.nodeValue;
      const app = windowTracker.get_window_app(metaWin) as ShellNS.App;
      this.app = app;
    }
  }

  // Check if the underlying window actor is still alive. GJS throws
  // on property access of finalized GObjects rather than segfaulting,
  // so a cheap get_name() call is enough to detect dead actors.
  isNodeValid() {
    if (!this.isWindow()) return true;
    try {
      const actor = this._actor;
      if (!actor) return false;
      actor.get_name();
      return true;
    } catch {
      return false;
    }
  }

  render(_from?: any) {
    refreshTabTitle(this);
  }

  get float(): boolean {
    return this.isWindow() && this.mode === WINDOW_MODES.FLOAT;
  }

  set float(value: boolean) {
    if (this.isWindow()) {
      const metaWindow = this.nodeValue;
      const floatAlwaysOnTop = this.settings?.get_boolean("float-always-on-top-enabled") ?? false;
      if (value) {
        this.mode = WINDOW_MODES.FLOAT;
        if (!metaWindow.is_above()) {
          if (floatAlwaysOnTop) metaWindow.make_above();
        }
      } else {
        this.mode = WINDOW_MODES.TILE;
        if (metaWindow.is_above()) {
          metaWindow.unmake_above();
        }
        // If a window is changing from float -> tile (e.g. late classification
        // after metadata arrives for Inkscape/Brave etc.), zero percents on the
        // parent's children so the layout engine will give the newcomer proper
        // space on the next processNode/apply.
        const p = this.parentNode;
        if (p) {
          p.childNodes.forEach((c: any) => {
            c.percent = undefined;
          });
        }
      }
    }
  }

  set tile(value: boolean) {
    this.float = !value;
  }

  resetLayoutSingleChild() {
    const tabbedOrStacked = this.isTabbed() || this.isStacked();
    if (tabbedOrStacked && this.singleOrNoChild()) {
      this.layout = LAYOUT_TYPES.HSPLIT;
    }
  }

  singleOrNoChild() {
    return this.childNodes.length <= 1;
  }
}

/**
 * An implementation of Queue using arrays
 */
export class Queue<T = any> extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  private _elements: T[] = [];

  constructor() {
    super();
    this._elements = [];
  }

  get length() {
    return this._elements.length;
  }

  enqueue(item: T) {
    this._elements.push(item);
  }

  dequeue(): T | undefined {
    return this._elements.shift();
  }
}

export class Tree extends Node<any> {
  static {
    GObject.registerClass(this);
  }
  private _host!: TreeHost;
  windows: Record<string, any> = {};
  allNodeWindows: any[] = [];
  attachNode: Node<any> | null = null;
  defaultStackHeight!: number;

  constructor(host: TreeHost) {
    const rootBin = new St.Bin();
    super(NODE_TYPES.ROOT, rootBin);
    this._host = host;
    this.defaultStackHeight = 35;
    this.settings = host.settings;
    this.layout = LAYOUT_TYPES.ROOT;
    if (!global.window_group.contains(rootBin)) global.window_group.add_child(rootBin);

    this._initWorkspaces();
  }

  get host(): TreeHost {
    return this._host;
  }

  /**
   * Handles new and existing workspaces in the tree
   */
  _initWorkspaces() {
    const wsManager = global.display.get_workspace_manager();
    const workspaces = wsManager.get_n_workspaces();
    for (let i = 0; i < workspaces; i++) {
      this.addWorkspace(i);
    }
  }

  // TODO move to monitor.js
  addMonitor(wsIndex: number) {
    const monitors = global.display.get_n_monitors();
    for (let mi = 0; mi < monitors; mi++) {
      const monitorWsNode = this.createNode(
        `ws${wsIndex}`,
        NODE_TYPES.MONITOR,
        `mo${mi}ws${wsIndex}`
      );
      if (!monitorWsNode) continue;
      monitorWsNode.layout = this._host.determineSplitLayout();
      monitorWsNode.actorBin = new St.Bin();
      if (!global.window_group.contains(monitorWsNode.actorBin))
        global.window_group.add_child(monitorWsNode.actorBin);
    }
  }

  // TODO move to workspace.js
  addWorkspace(wsIndex: number) {
    const wsManager = global.display.get_workspace_manager();
    const workspaceNodeValue = `ws${wsIndex}`;

    const existingWsNode = this.findNode(workspaceNodeValue);
    if (existingWsNode) {
      return false;
    }

    const newWsNode = this.createNode(this.nodeValue, NODE_TYPES.WORKSPACE, workspaceNodeValue);
    if (!newWsNode) return false;

    const workspace = wsManager.get_workspace_by_index(wsIndex);
    newWsNode.layout = LAYOUT_TYPES.HSPLIT;
    newWsNode.actorBin = new St.Bin({ style_class: "workspace-actor-bg" });

    if (!global.window_group.contains(newWsNode.actorBin))
      global.window_group.add_child(newWsNode.actorBin);

    this._host.bindWorkspaceSignals(workspace!);
    this.addMonitor(wsIndex);

    return true;
  }

  // TODO move to workspace.js
  removeWorkspace(wsIndex: number) {
    const workspaceNodeData = `ws${wsIndex}`;
    const existingWsNode = this.findNode(workspaceNodeData);
    if (!existingWsNode) {
      return false;
    }

    if (global.window_group.contains(existingWsNode.actorBin!))
      global.window_group.remove_child(existingWsNode.actorBin!);

    this.removeChild(existingWsNode);

    // Phase E fix: Re-index remaining workspace nodes after deletion
    // Credit: enklht/forge PR #516
    const allWorkspaces = this.getNodeByType(NODE_TYPES.WORKSPACE);
    for (const wsNode of allWorkspaces) {
      const wsMatch = (wsNode.nodeValue as string).match(/^ws(\d+)$/);
      if (!wsMatch) continue;
      const currentIdx = parseInt(wsMatch[1], 10);
      if (currentIdx <= wsIndex) continue;

      // Re-index workspace node itself
      (wsNode as unknown as { _data: unknown })._data = `ws${currentIdx - 1}`;

      // Re-index its monitor children
      const monitorNodes = wsNode.getNodeByType(NODE_TYPES.MONITOR);
      for (const monNode of monitorNodes) {
        const monMatch = (monNode.nodeValue as string).match(/^(mo\d+)ws\d+$/);
        if (monMatch) {
          (monNode as unknown as { _data: unknown })._data = `${monMatch[1]}ws${currentIdx - 1}`;
        }
      }
    }

    return true;
  }

  get nodeWorkpaces() {
    const nodeWorkspaces = this.getNodeByType(NODE_TYPES.WORKSPACE);
    return nodeWorkspaces;
  }

  get nodeWindows() {
    const nodeWindows = this.getNodeByType(NODE_TYPES.WINDOW);
    return nodeWindows;
  }

  /**
   * Creates a new Node and attaches it to a parent toData.
   * Parent can be MONITOR or CON types only.
   */
  createNode(
    parentObj: unknown,
    type: string,
    value: unknown,
    mode: string = WINDOW_MODES.TILE as string
  ) {
    const parentNode = this.findNode(parentObj);
    let child;

    if (parentNode) {
      child = new Node(type, value as Meta.Window | string | St.Bin | null);
      child.settings = this.settings;

      if (child.isWindow()) child.mode = mode;

      // Append after a window
      if (parentNode.isWindow()) {
        const grandParentNode = parentNode.parentNode!;
        grandParentNode.insertBefore(child, parentNode.nextSibling);
        Logger.debug(
          `Parent is a window, attaching to this window's parent ${grandParentNode.nodeType}`
        );
      } else {
        // Append as the last item of the container
        parentNode.appendChild(child);
      }
    }
    return child;
  }

  /**
   * Finds any Node in the tree using data
   * Data types can be in the form of Meta.Window or unique id strings
   * for Workspace, Monitor and Container
   *
   * Workspace id strings takes the form `ws{n}`.
   * Monitor id strings takes the form `mo{m}ws{n}`
   * Container id strings takes the form `mo{m}ws{n}c{x}`
   *
   */
  findNode(data: unknown) {
    const searchNode = this.getNodeByValue(data);
    return searchNode;
  }

  /**
   * Find the NodeWindow using the Meta.WindowActor
   */
  findNodeByActor(windowActor: Clutter.Actor) {
    let searchNode;
    const criteriaMatchFn = (node: Node<any>) => {
      if (node.isWindow() && node.actor === windowActor) {
        searchNode = node;
      }
    };

    this._walk(criteriaMatchFn, this._traverseDepthFirst);

    return searchNode;
  }

  /**
   * Obtains the non-floating, non-minimized list of nodes
   * Useful for calculating the rect areas
   */
  getTiledChildren(items: Node<any>[]) {
    const filterFn = (node: Node<any>) => {
      if (node.isWindow()) {
        const floating = node.isFloat();
        const grabTiling = node.isGrabTile();
        const metaWindow = node.nodeValue as Meta.Window;
        // A Node[Window]._data is a Meta.Window
        const included = !metaWindow.minimized && !(floating || grabTiling);
        if (included) {
          return true;
        }
      }
      // handle split containers
      if (node.isCon()) {
        return this.getTiledChildren(node.childNodes).length > 0;
      }
      return false;
    };

    return items ? items.filter(filterFn) : [];
  }

  /**
   * Give the next sibling/parent/descendant on the tree based
   * on a given Meta.MotionDirection
   *
   * Credits: borrowed logic from tree.c of i3
   */
  next(node: Node<any>, direction: Meta.MotionDirection): Node<any> | null {
    if (!node) return null;
    const orientation = Utils.orientationFromDirection(direction);
    const position = Utils.positionFromDirection(direction);
    const previous = position === POSITION.BEFORE;

    const type = node.nodeType;

    switch (type) {
      case NODE_TYPES.ROOT:
        // Root is the top of the tree
        if (node.childNodes.length > 1) {
          if (previous) {
            return node.firstChild;
          } else {
            return node.lastChild;
          }
        } else {
          return node.firstChild;
        }
      case NODE_TYPES.WORKSPACE:
        // Let gnome-shell handle this?
        break;
      case NODE_TYPES.MONITOR: {
        // Find the next monitor
        const nodeWindow = this.findFirstNodeWindowFrom(node);
        if (!nodeWindow) return null;
        return this.nextMonitor(nodeWindow, position, orientation);
      }
    }

    while (node.nodeType !== NODE_TYPES.WORKSPACE) {
      if (node.nodeType === NODE_TYPES.MONITOR) {
        return this.next(node, direction);
      }
      const parentNode = node.parentNode;
      if (!parentNode) return null;
      const parentOrientation = Utils.orientationFromLayout(parentNode.layout!);

      if (parentNode.childNodes.length > 1 && orientation === parentOrientation) {
        const sibling = previous ? node.previousSibling : node.nextSibling;
        if (sibling) {
          return sibling;
        }
      }
      if (!node.parentNode) break;
      node = node.parentNode;
    }

    return null;
  }

  nextMonitor(nodeWindow: Node<any>, position: string, orientation: string) {
    if (!nodeWindow) return null;
    const nodeValue = nodeWindow.nodeValue as Meta.Window;
    // Use the built in logic to determine adjacent monitors
    const monitorDirection = Utils.directionFrom(position, orientation)!;
    const targetMonitor = global.display.get_monitor_neighbor_index(
      nodeValue.get_monitor(),
      monitorDirection
    );
    if (targetMonitor < 0) return null;
    const monWs = `mo${targetMonitor}ws${nodeValue.get_workspace().index()}`;
    const monitorNode = this.findNode(monWs);
    return monitorNode;
  }

  findAncestorMonitor(node: Node<any>) {
    return this.findAncestor(node, NODE_TYPES.MONITOR);
  }

  findAncestor(node: Node<any>, ancestorType: string) {
    let ancestorNode: Node<any> | undefined;

    while (node && ancestorType && !node.isRoot()) {
      if (node.isType(ancestorType)) {
        ancestorNode = node;
        break;
      } else {
        node = node.parentNode!;
      }
    }

    return ancestorNode;
  }

  nextVisible(node: Node<any>, direction: Meta.MotionDirection): Node<any> | null {
    if (!node) return null;
    let next = this.next(node, direction);
    if (
      next &&
      next.nodeType === NODE_TYPES.WINDOW &&
      next.nodeValue &&
      (next.nodeValue as Meta.Window).minimized
    ) {
      next = this.nextVisible(next, direction);
    }
    return next;
  }

  /**
   * Performs cleanup of dangling parents in addition to removing the
   * node from the parent.
   */
  removeNode(node: Node<any>) {
    let oldChild;

    const cleanUpParent = (existParent: Node<any>) => {
      if (this.getTiledChildren(existParent.childNodes).length === 0) {
        existParent.percent = undefined;
        // Bug #470 fix: Don't reset sibling percents across workspace/monitor boundaries
        // Ported from jcrussell/forge
        if (
          existParent.parentNode &&
          !existParent.parentNode.isWorkspace() &&
          !existParent.parentNode.isMonitor()
        ) {
          this.resetSiblingPercent(existParent.parentNode);
        }
      }
      // Bug #470 fix: Only reset siblings within CON level, not workspace/monitor level
      // Ported from jcrussell/forge
      if (!existParent.isWorkspace() && !existParent.isMonitor()) {
        this.resetSiblingPercent(existParent);
      }
    };

    const parentNode = node.parentNode;
    if (!parentNode) return false;

    // If parent has only this window, remove the parent instead
    if (parentNode.childNodes.length === 1 && parentNode.nodeType !== NODE_TYPES.MONITOR) {
      const existParent = parentNode.parentNode;
      if (!existParent) return false;
      oldChild = existParent.removeChild(parentNode);
      cleanUpParent(existParent);
    } else {
      const existParent = node.parentNode!;
      oldChild = existParent.removeChild(node);
      if (!this._host.floatingWindow(node)) cleanUpParent(existParent);
    }

    // If only a single tab remains, exit tabbed layout
    if (
      this.settings?.get_boolean("auto-exit-tabbed") &&
      parentNode.nodeType === NODE_TYPES.CON &&
      parentNode.layout === LAYOUT_TYPES.TABBED &&
      parentNode.childNodes.length === 1
    ) {
      parentNode.layout = this._host.determineSplitLayout();
      this.resetSiblingPercent(parentNode);
      parentNode.lastTabFocus = null;
    }

    if (node === this.attachNode) {
      this.attachNode = null;
    } else {
      // Find the next focus node as attachNode
      this.attachNode = this.findNode(this._host.focusMetaWindow);
    }

    return oldChild ? true : false;
  }

  /** Zero sibling percents (equal-share on next layout). Pure structure helper. */
  resetSiblingPercent(parentNode: Node<any> | null) {
    if (!parentNode) return;
    parentNode.childNodes.forEach((n: Node<any>) => {
      n.percent = undefined;
    });
  }

  findFirstNodeWindowFrom(node: Node<any>) {
    const results = node.getNodeByType(NODE_TYPES.WINDOW);
    if (results.length > 0) {
      return results[0];
    }
    return null;
  }

  debugTree() {
    if (!Logger.isDebugEnabled()) return;
    // this.debugChildNodes(this);
  }

  /**
   * Official test serialization (B1-3) — use instead of walking private `_nodes`.
   */
  serializeForTest(): TreeTestNode {
    return serializeNodeForTest(this);
  }

  debugChildNodes(node: Node<any>) {
    if (!Logger.isDebugEnabled()) return;
    this.debugNode(this);
    node.childNodes.forEach((child: Node<any>) => {
      this.debugChildNodes(child);
    });
  }

  debugParentNodes(node: Node<any>) {
    if (!Logger.isDebugEnabled()) return;
    if (node) {
      if (node.parentNode) {
        this.debugParentNodes(node.parentNode);
      }
      this.debugNode(node);
    }
  }

  debugNode(node: Node<any>) {
    if (!Logger.isDebugEnabled()) return;
    let spacing = "";
    const dashes = "-->";
    const level = node.level;
    for (let i = 0; i < level; i++) {
      const parentSpacing = i === 0 ? " " : "|";
      spacing += `${parentSpacing}   `;
    }
    const rootSpacing = level === 0 ? "#" : "*";

    let attributes = "";

    if (node.isWindow && node.isWindow()) {
      const metaWindow = node.nodeValue;
      attributes += `class:'${metaWindow.get_wm_class()}',title:'${
        metaWindow.title
      }',string:'${metaWindow}'${metaWindow === this._host.focusMetaWindow ? " FOCUS" : ""}`;
    } else if (node.isCon() || node.isMonitor() || node.isWorkspace()) {
      attributes += `${node.nodeValue}`;
      if (node.isCon() || node.isMonitor()) {
        attributes += `,layout:${node.layout}`;
      }
    }

    if (node.rect) {
      attributes += `,rect:${node.rect.width}x${node.rect.height}+${node.rect.x}+${node.rect.y}`;
      const pointerCoord = global.get_pointer();
      const pointerInside = Utils.rectContainsPoint(
        node.rect!,
        pointerCoord as unknown as [number, number]
      )
        ? "yes"
        : "no";
      attributes += `,pointer:${pointerInside}`;
    }

    if (level !== 0) Logger.debug(`${spacing}|`);
    Logger.debug(
      `${spacing}${rootSpacing}${dashes} ${node.nodeType}#${
        node.index !== null ? node.index : "-"
      } @${attributes}`
    );
  }

  findParent(childNode: Node<any>, parentNodeType: string) {
    const parents = this.getNodeByType(parentNodeType);
    // Only get the first parent
    return parents.filter((p) => p.contains(childNode))[0];
  }
}

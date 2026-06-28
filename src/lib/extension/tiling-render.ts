/*
 * Tiling Render — float classification, layout geometry, gaps, constraints, apply.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import St from "gi://St";

import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";
import { LAYOUT_TYPES, NODE_TYPES, type Node, type RectLike, type Tree } from "./tree.js";

const WINDOW_MODE_TILE = "TILE";

export interface TilingRenderDeps {
  settings: Gio.Settings;
  getTree: () => Tree;
  moveWindow: (metaWindow: Meta.Window, rect: RectLike) => void;
  getAllNodeWindows: () => Node<any>[];
  isFloatingExempt: (metaWindow: Meta.Window) => boolean;
  isActiveWindowWorkspaceTiled: (metaWindow: Meta.Window) => boolean;
  getTiledChildren: (childNodes: Node<any>[]) => Node<any>[];
  getResizeCount: (windowId: number) => number;
  findParent: (node: Node<any>, type: string) => Node<any> | null;
}

export class TilingRender extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  private _deps: TilingRenderDeps;

  constructor(deps: TilingRenderDeps) {
    super();
    this._deps = deps;
  }

  render(from?: string) {
    const tree = this._deps.getTree();
    Logger.debug(`render tree ${from ? "from " + from : ""}`);
    this.processFloats();

    // Extra inkscape state dump on every render
    try {
      const all = this._deps.getAllNodeWindows();
      const inks = all.filter((n: any) => {
        const m = n.nodeValue as Meta.Window;
        const c = m?.get_wm_class?.() || "";
        return c.toLowerCase().includes("inkscape");
      });
      if (inks.length > 0) {
        inks.forEach((n: any) => {
          const m = n.nodeValue as Meta.Window;
          Logger.info(
            `[INKSCAPE-RENDER-STATE] from=${from} id=${m.get_id()} title=${JSON.stringify(
              m.get_title()
            )} float=${n.float} mode=${(n as any).mode} rect=${JSON.stringify(n.rect)}`
          );
        });
      }
    } catch (e) {}

    this.processNode(tree);
    this.apply(tree);
    this.cleanTree();
    tree.debugTree();
    Logger.debug(`*********************************************`);
  }

  processFloats() {
    this._deps.getAllNodeWindows().forEach((nodeWindow) => {
      const metaWindow = nodeWindow.nodeValue as Meta.Window;
      const wmClass = metaWindow?.get_wm_class?.() || "";
      const isInk = wmClass.toLowerCase().includes("inkscape");
      const exempt = this._deps.isFloatingExempt(metaWindow);
      const wsTiled = this._deps.isActiveWindowWorkspaceTiled(metaWindow);
      const before = nodeWindow.float;
      if (exempt || !wsTiled) {
        nodeWindow.float = true;
      } else {
        nodeWindow.float = false;
      }
      if (isInk) {
        Logger.info(
          `[INKSCAPE-FLOAT-SET] id=${metaWindow.get_id()} title=${JSON.stringify(
            metaWindow.get_title()
          )} before=${before} after=${nodeWindow.float} exempt=${exempt} wsTiled=${wsTiled}`
        );
      }
    });
  }

  calculateGaps(node: Node<any>) {
    if (!node) return 0;

    const settings = this._deps.settings;
    const gapSize = settings.get_uint("window-gap-size");
    const gapIncrement = settings.get_uint("window-gap-size-increment");
    let gap = gapSize * gapIncrement;

    if (!node.isRoot()) {
      const hideGapWhenSingle = settings.get_boolean("window-gap-hidden-on-single");
      const parentNode = this._deps.findParent(node, NODE_TYPES.MONITOR);
      if (parentNode) {
        const tiled = parentNode
          .getNodeByMode(WINDOW_MODE_TILE)
          .filter((t) => t.isWindow() && !t.nodeValue.minimized);
        if (tiled.length == 1 && hideGapWhenSingle) gap = 0;
      }
    }

    return gap;
  }

  processGap(node: Node<any>) {
    const rect = node.rect!;
    let nodeWidth = rect.width;
    let nodeHeight = rect.height;
    let nodeX = rect.x;
    let nodeY = rect.y;
    const gap = this.calculateGaps(node);

    if (nodeWidth > gap * 2 && nodeHeight > gap * 2) {
      nodeX += gap;
      nodeY += gap;
      nodeWidth -= gap * 2;
      nodeHeight -= gap * 2;
    }
    return { x: nodeX, y: nodeY, width: nodeWidth, height: nodeHeight };
  }

  enforceUltrawideSize(node: Node<any>, rect: RectLike): RectLike {
    if (!node.isWindow()) {
      Logger.debug(`enforceUltrawideSize: node is not a window, skipping`);
      return rect;
    }
    const metaWindow = node.nodeValue as Meta.Window;
    const monitorIndex = metaWindow.get_monitor();
    Logger.debug(
      `enforceUltrawideSize: window_id=${metaWindow.get_id()}, monitorIndex=${monitorIndex}, rect=${JSON.stringify(
        rect
      )}`
    );
    const constraints = this.getMonitorConstraints(monitorIndex);
    if (!constraints) {
      Logger.debug(`enforceUltrawideSize: no constraints found`);
      return rect;
    }
    if (!constraints.enabled) {
      Logger.debug(`enforceUltrawideSize: constraints disabled`);
      return rect;
    }

    const resizeCount = this._deps.getResizeCount(metaWindow.get_id());
    if (constraints.resizeExempt && resizeCount >= 1) {
      let monitorNode = node.parentNode;
      while (monitorNode && !monitorNode.isMonitor()) {
        monitorNode = monitorNode.parentNode;
      }
      if (monitorNode) {
        const tiledChildren = this._deps.getTiledChildren(monitorNode.childNodes);
        if (tiledChildren.length === 1) {
          const frameRect = metaWindow.get_frame_rect();
          let width = frameRect.width;
          let height = frameRect.height;
          if (width > rect.width) width = rect.width;
          if (height > rect.height) height = rect.height;
          const x = rect.x + Math.floor((rect.width - width) / 2);
          const y = rect.y + Math.floor((rect.height - height) / 2);
          Logger.debug(
            `enforceUltrawideSize: resize-exempt solo centered from ${JSON.stringify(
              rect
            )} to ${JSON.stringify({ x, y, width, height })}`
          );
          return { x, y, width, height };
        }
      }
      Logger.debug(
        `enforceUltrawideSize: skipping (resize exempt, window was manually resized, not solo)`
      );
      return rect;
    }

    const { maxWidth, maxHeight } = constraints;
    let { x, y, width, height } = rect;
    let changed = false;
    if (maxWidth > 0 && width > maxWidth) {
      x += Math.floor((width - maxWidth) / 2);
      width = maxWidth;
      changed = true;
    }
    if (maxHeight > 0 && height > maxHeight) {
      y += Math.floor((height - maxHeight) / 2);
      height = maxHeight;
      changed = true;
    }
    if (changed) {
      Logger.debug(
        `enforceUltrawideSize: CLAMPED from ${JSON.stringify(rect)} to ${JSON.stringify({
          x,
          y,
          width,
          height,
        })}`
      );
      return { x, y, width, height };
    }
    Logger.debug(`enforceUltrawideSize: within limits, no change needed`);
    return rect;
  }

  apply(node: Node<any>) {
    if (!node) return;
    const tiledChildren = node
      .getNodeByMode(WINDOW_MODE_TILE)
      .filter((t: Node<any>) => t.isWindow());
    tiledChildren.forEach((w: Node<any>) => {
      if (w.renderRect) {
        if (w.renderRect.width > 0 && w.renderRect.height > 0) {
          const metaWin = w.nodeValue as Meta.Window;
          try {
            this._deps.moveWindow(metaWin, w.renderRect);
          } catch {}
        } else {
          Logger.debug(`ignoring apply for ${w.renderRect.width}x${w.renderRect.height}`);
        }
      }

      if ((w.nodeValue as any).firstRender) (w.nodeValue as any).firstRender = false;
    });
  }

  cleanTree() {
    const tree = this._deps.getTree();

    const orphanCons = tree.getNodeByType(NODE_TYPES.CON).filter((c) => c.childNodes.length === 0);
    const hasOrphanCons = orphanCons.length > 0;

    orphanCons.forEach((o) => {
      tree.removeNode(o);
    });

    const invalidWindows = tree.getNodeByType(NODE_TYPES.WINDOW).filter((w) => {
      const metaWindow = w.nodeValue as Meta.Window;
      const wmClass = (metaWindow as any).wm_class;
      return wmClass === "gjs";
    });

    invalidWindows.forEach((w) => {
      tree.removeNode(w);
    });

    const grandParentCons = tree
      .getNodeByType(NODE_TYPES.CON)
      .filter((c) => c.childNodes.length === 1 && c.childNodes[0].nodeType === NODE_TYPES.CON);

    grandParentCons.forEach((c) => {
      c.layout = LAYOUT_TYPES.HSPLIT;
    });

    if (hasOrphanCons || invalidWindows.length > 0) {
      const tree = this._deps.getTree();
      this.processNode(tree);
      this.apply(tree);
    }
  }

  processNode(node: Node<any>) {
    if (!node) return;

    const tree = this._deps.getTree();

    if (node.nodeType === NODE_TYPES.ROOT) {
      node.childNodes.forEach((child: Node<any>) => {
        this.processNode(child);
      });
    }

    if (node.nodeType === NODE_TYPES.WORKSPACE) {
      node.childNodes.forEach((child: Node<any>) => {
        this.processNode(child);
      });
    }

    const params: Record<string, any> = {};

    if (node.nodeType === NODE_TYPES.MONITOR || node.nodeType === NODE_TYPES.CON) {
      if (node.childNodes.length === 0) {
        return;
      }

      if (node.nodeType === NODE_TYPES.MONITOR) {
        const monitorIndex = Utils.monitorIndex(node.nodeValue as string);
        const monitorArea = global.display
          .get_workspace_manager()
          .get_active_workspace()
          .get_work_area_for_monitor(monitorIndex);
        if (!monitorArea) return;
        node.rect = monitorArea;
        node.rect = this.processGap(node);
      }

      const tiledChildren = tree.getTiledChildren(node.childNodes);
      const sizes = tree.computeSizes(node, tiledChildren);

      params.sizes = sizes;
      const showTabs = this._deps.settings.get_boolean("showtab-decoration-enabled");
      params.stackedHeight = showTabs ? tree.defaultStackHeight * Utils.dpi() : 0;
      params.tiledChildren = tiledChildren;

      const decoration = node.decoration;

      if (decoration) {
        const decoChildren = decoration.get_children();
        decoChildren.forEach((decoChild: Clutter.Actor) => {
          decoration.remove_child(decoChild);
        });
      }

      tiledChildren
        .filter((c: Node<any>) => c.isNodeValid())
        .forEach((child: Node<any>, index: number) => {
          if (node.layout === LAYOUT_TYPES.HSPLIT || node.layout === LAYOUT_TYPES.VSPLIT) {
            this.processSplit(node, child, params, index);
          } else if (node.layout === LAYOUT_TYPES.STACKED) {
            this.processStacked(node, child, params, index);
          } else if (node.layout === LAYOUT_TYPES.TABBED) {
            this.processTabbed(node, child, params, index);
          }
          this.processNode(child);
        });
    }

    if (node.isWindow()) {
      const m = node.nodeValue as Meta.Window;
      const c = m?.get_wm_class?.() || "";
      if (c.toLowerCase().includes("inkscape")) {
        Logger.info(
          `[INKSCAPE-PROCESS-WINDOW] id=${m.get_id()} title=${JSON.stringify(
            m.get_title()
          )} float=${node.float} hasRect=${!!node.rect}`
        );
      }
      if (!node.rect) node.rect = m.get_work_area_current_monitor();
      node.renderRect = this.processGap(node);
      node.renderRect = this.enforceUltrawideSize(node, node.renderRect);
    }
  }

  processSplit(node: Node<any>, child: Node<any>, params: Record<string, any>, index: number) {
    const layout = node.layout;
    const nodeRect = node.rect!;
    let nodeWidth: number;
    let nodeHeight: number;
    let nodeX: number;
    let nodeY: number;

    if (layout === LAYOUT_TYPES.HSPLIT) {
      nodeWidth = params.sizes[index];
      nodeHeight = nodeRect.height;
      nodeX = nodeRect.x;
      if (index != 0) {
        let i = 1;
        while (i <= index) {
          nodeX += params.sizes[i - 1];
          i++;
        }
      }
      nodeY = nodeRect.y;
    } else if (layout === LAYOUT_TYPES.VSPLIT) {
      nodeWidth = nodeRect.width;
      nodeHeight = params.sizes[index];
      nodeX = nodeRect.x;
      nodeY = nodeRect.y;
      if (index != 0) {
        let i = 1;
        while (i <= index) {
          nodeY += params.sizes[i - 1];
          i++;
        }
      }
    } else {
      return;
    }

    child.rect = {
      x: nodeX,
      y: nodeY,
      width: nodeWidth,
      height: nodeHeight,
    };
  }

  processStacked(node: Node<any>, child: Node<any>, params: Record<string, any>, index: number) {
    const layout = node.layout;
    const rect = node.rect!;
    const nodeWidth = rect.width;
    let nodeHeight = rect.height;
    const nodeX = rect.x;
    let nodeY = rect.y;
    const stackHeight = this._deps.getTree().defaultStackHeight;

    if (layout === LAYOUT_TYPES.STACKED) {
      if (node.childNodes.length > 1) {
        nodeY += stackHeight * index;
        nodeHeight -= stackHeight * index;
      }

      child.rect = {
        x: nodeX,
        y: nodeY,
        width: nodeWidth,
        height: nodeHeight,
      };
    }
  }

  processTabbed(node: Node<any>, child: Node<any>, params: Record<string, any>, _index: number) {
    const layout = node.layout;
    const nodeRect = node.rect!;
    let nodeWidth: number;
    let nodeHeight: number;
    let nodeX: number;
    let nodeY: number;

    if (layout === LAYOUT_TYPES.TABBED) {
      nodeWidth = nodeRect.width;
      nodeX = nodeRect.x;
      nodeY = nodeRect.y;
      nodeHeight = nodeRect.height;

      const alwaysShowDecorationTab = true;

      if (node.childNodes.length > 1 || alwaysShowDecorationTab) {
        nodeY = nodeRect.y + params.stackedHeight;
        nodeHeight = nodeRect.height - params.stackedHeight;
        if (node.decoration && child.isWindow() && child.isNodeValid()) {
          const gap = this.calculateGaps(node);
          const renderRect = this.processGap(node);
          let borderWidth = 0;
          try {
            const actorWithBorder = child._actor as any;
            if (actorWithBorder?.border) {
              borderWidth = actorWithBorder.border.get_theme_node().get_border_width(St.Side.TOP);
            }
          } catch {}

          const adjust = 4 * Utils.dpi();
          const adjustWidth = renderRect.width + (borderWidth * 2 + gap) / adjust;
          const adjustX = renderRect.x - (gap + borderWidth * 2) / (adjust * 2);
          let adjustY = renderRect.y - adjust;

          if (gap === 0) {
            adjustY = renderRect.y;
          }

          const decoration = node.decoration;

          if (decoration !== null && decoration !== undefined) {
            decoration.set_size(adjustWidth, params.stackedHeight);
            decoration.set_position(adjustX, adjustY);
            if (params.tiledChildren.length > 0 && params.stackedHeight !== 0) {
              decoration.show();
            } else {
              decoration.hide();
            }
            if (child.tab && !decoration.contains(child.tab)) {
              try {
                decoration.add_child(child.tab);
              } catch {}
            }
          }

          child.render();
        }
      }

      child.rect = {
        x: nodeX,
        y: nodeY,
        width: nodeWidth,
        height: nodeHeight,
      };
    }
  }

  getMonitorConnector(monitorIndex: number): string | null {
    try {
      const mgr = global.backend.get_monitor_manager();
      const logicalMonitors = mgr.get_logical_monitors() ?? [];
      Logger.debug(
        `_getMonitorConnector: monitorIndex=${monitorIndex}, logicalMonitors.length=${logicalMonitors.length}`
      );
      const logicalMonitor = logicalMonitors[monitorIndex];
      if (!logicalMonitor) {
        Logger.debug(`_getMonitorConnector: no logicalMonitor at index ${monitorIndex}`);
        return null;
      }
      const monitors = logicalMonitor.get_monitors();
      Logger.debug(`_getMonitorConnector: monitors.length=${monitors.length}`);
      if (monitors.length > 0) {
        const connector = monitors[0].get_connector();
        Logger.debug(`_getMonitorConnector: connector="${connector}"`);
        return connector;
      }
      return null;
    } catch (e) {
      Logger.debug(`_getMonitorConnector: exception: ${e}`);
      return null;
    }
  }

  getMonitorConstraints(monitorIndex: number): {
    maxWidth: number;
    maxHeight: number;
    enabled: boolean;
    resizeExempt: boolean;
  } | null {
    const connector = this.getMonitorConnector(monitorIndex);
    if (!connector) {
      Logger.debug(`_getMonitorConstraints: no connector for monitor ${monitorIndex}`);
      return null;
    }
    const rawConstraints = this._deps.settings.get_value("monitor-constraints").deep_unpack();
    Logger.debug(
      `_getMonitorConstraints: connector="${connector}", rawConstraints=${JSON.stringify(
        rawConstraints
      )}`
    );
    const constraints = rawConstraints as Array<
      [
        connector: string,
        maxWidth: number,
        maxHeight: number,
        enabled: boolean,
        resizeExempt: boolean
      ]
    >;
    for (const entry of constraints) {
      Logger.debug(
        `_getMonitorConstraints: checking entry[0]="${entry[0]}" against connector="${connector}"`
      );
      if (entry[0] === connector) {
        Logger.debug(
          `_getMonitorConstraints: MATCH! maxWidth=${entry[1]}, maxHeight=${entry[2]}, enabled=${entry[3]}, resizeExempt=${entry[4]}`
        );
        return {
          maxWidth: entry[1],
          maxHeight: entry[2],
          enabled: entry[3],
          resizeExempt: entry[4],
        };
      }
    }
    Logger.debug(`_getMonitorConstraints: no matching entry for connector="${connector}"`);
    return null;
  }
}

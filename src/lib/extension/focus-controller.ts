/**
 * FocusController — single entry for directional focus (B9-1, B9-3).
 *
 * Layout algebra (next-window graph) lives on LayoutEngine; stacked/tabbed
 * focus helpers live here so command paths share one module for "make this
 * window the focus target and raise siblings".
 */

import Meta from "gi://Meta";

import { LAYOUT_TYPES, type Node } from "./tree.js";
import { safeRaise } from "./mutter-safe.js";
import type { LayoutEngine } from "./layout-engine.js";

export interface FocusControllerHost {
  readonly layoutEngine: LayoutEngine;
  isRenderFrozen(): boolean;
  queueEvent(eventObj: { name: string; callback: () => void }, interval?: number): void;
  renderTree(from: string, force?: boolean): void;
}

export class FocusController {
  private _host: FocusControllerHost;

  constructor(host: FocusControllerHost) {
    this._host = host;
  }

  /** Directional focus via LayoutEngine (single entry for keyboard Focus). */
  focusDirection(node: Node<any> | null, direction: Meta.MotionDirection): Node<any> | null {
    return this._host.layoutEngine.focus(node, direction);
  }

  updateStackedFocus(focusNodeWindow: Node<any> | null | undefined): void {
    if (!focusNodeWindow?.parentNode) return;
    if (this._host.isRenderFrozen()) return;
    const parentNode = focusNodeWindow.parentNode;
    if (parentNode.layout === LAYOUT_TYPES.STACKED) {
      parentNode.appendChild(focusNodeWindow);
      parentNode.childNodes
        .filter((child: Node<any>) => child.isWindow())
        .forEach((child: Node<any>) => safeRaise(child.nodeValue as Meta.Window));
      this._host.queueEvent({
        name: "render-focus-stack",
        callback: () => {
          this._host.renderTree("focus-stacked");
        },
      });
    }
  }

  updateTabbedFocus(focusNodeWindow: Node<any> | null | undefined): void {
    if (!focusNodeWindow?.parentNode) return;
    if (this._host.isRenderFrozen()) return;
    if (focusNodeWindow.parentNode.layout === LAYOUT_TYPES.TABBED) {
      safeRaise(focusNodeWindow.nodeValue as Meta.Window);
    }
  }
}

import Meta from "gi://Meta";

import type {
  Direction,
  NonEmptyDirections,
  OperationId,
  TilingEvent,
  TilingInspection,
  TilingTransition,
  WindowFact,
  WindowId,
} from "../tiling/index.js";
import { axisForDirection } from "../tiling/index.js";
import * as Utils from "./utils.js";

export interface GnomeGrabOperationPort {
  knownWindowId(metaWindow: Meta.Window): WindowId | undefined;
  windowFact(metaWindow: Meta.Window): WindowFact | null;
  allocateOperationId(): OperationId;
  dispatch(event: TilingEvent): TilingTransition;
  inspect(): TilingInspection;
}

type ResizeAxisObservation = Readonly<{
  direction: Direction;
  startSize: number;
  containerExtent: number;
  primaryToWindowScale: number;
  lastShareDelta: number;
}>;

type ResizeObservation = Readonly<{
  windowId: WindowId;
  operationId: OperationId;
  axes: readonly ResizeAxisObservation[];
}>;

function portableDirections(grabOp: Meta.GrabOp): NonEmptyDirections | undefined {
  const decomposed = Utils.decomposeGrabOp(grabOp);
  const directions = decomposed
    .map((operation) => {
      switch (Utils.directionFromGrab(operation)) {
        case Meta.MotionDirection.LEFT:
          return "left";
        case Meta.MotionDirection.RIGHT:
          return "right";
        case Meta.MotionDirection.UP:
          return "up";
        case Meta.MotionDirection.DOWN:
          return "down";
        default:
          return undefined;
      }
    })
    .filter((direction): direction is Direction => direction !== undefined);
  const [first, ...rest] = directions;
  return first ? [first, ...rest] : undefined;
}

export class GnomeGrabOperationAdapter {
  private readonly port: GnomeGrabOperationPort;
  private activeResize?: ResizeObservation;

  constructor(port: GnomeGrabOperationPort) {
    this.port = port;
  }

  reset(): void {
    this.activeResize = undefined;
  }

  beginResize(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void {
    const id = this.port.knownWindowId(metaWindow);
    const directions = portableDirections(grabOp);
    const fact = this.port.windowFact(metaWindow);
    if (!id || !directions || !fact) return;

    const existing = this.activeResize;
    if (existing) {
      this.port.dispatch({ type: "OperationCancelled", operationId: existing.operationId });
      this.activeResize = undefined;
    }

    const operationId = this.port.allocateOperationId();
    const transition = this.port.dispatch({
      type: "OperationStarted",
      operation: {
        id: operationId,
        kind: "resize",
        windowId: id,
        directions,
      },
    });
    if (transition.status !== "committed") return;

    const inspection = this.port.inspect();
    const active = inspection.operations.find((candidate) => candidate.id === operationId);
    const axes = (active?.boundaries ?? [])
      .map((boundary): ResizeAxisObservation | undefined => {
        const container = inspection.renderPlan.containers.find(
          (candidate) => candidate.id === boundary.containerId
        );
        const horizontal = axisForDirection(boundary.direction) === "horizontal";
        const containerExtent = horizontal ? container?.rect.width : container?.rect.height;
        const startSize = horizontal ? fact.frame.width : fact.frame.height;
        const primaryWindow = inspection.renderPlan.windows.find(
          (candidate) => candidate.id === boundary.primaryChildId
        );
        const primaryContainer = inspection.renderPlan.containers.find(
          (candidate) => candidate.id === boundary.primaryChildId
        );
        const primaryExtent = horizontal
          ? primaryWindow?.frame.width ?? primaryContainer?.rect.width
          : primaryWindow?.frame.height ?? primaryContainer?.rect.height;
        if (
          !containerExtent ||
          containerExtent <= 0 ||
          !startSize ||
          startSize <= 0 ||
          !primaryExtent ||
          primaryExtent <= 0
        )
          return undefined;
        return {
          direction: boundary.direction,
          startSize,
          containerExtent,
          primaryToWindowScale: primaryExtent / startSize,
          lastShareDelta: 0,
        };
      })
      .filter((axis): axis is ResizeAxisObservation => axis !== undefined);
    if (!active || axes.length !== active.boundaries.length) {
      this.port.dispatch({ type: "OperationCancelled", operationId });
      return;
    }
    this.activeResize = { windowId: id, operationId, axes };
  }

  updateResize(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    const active = id === this.activeResize?.windowId ? this.activeResize : undefined;
    const fact = active ? this.port.windowFact(metaWindow) : null;
    if (!id || !active || !fact) return;
    const shareDeltas: Partial<Record<Direction, number>> = {};
    let changed = false;
    const axes = active.axes.map((axis) => {
      const horizontal = axisForDirection(axis.direction) === "horizontal";
      const currentSize = horizontal ? fact.frame.width : fact.frame.height;
      const shareDelta =
        ((currentSize - axis.startSize) * axis.primaryToWindowScale) / axis.containerExtent;
      shareDeltas[axis.direction] = shareDelta;
      if (shareDelta !== axis.lastShareDelta) changed = true;
      return { ...axis, lastShareDelta: shareDelta };
    });
    if (!changed) return;
    const transition = this.port.dispatch({
      type: "OperationUpdated",
      operationId: active.operationId,
      update: { shareDeltas },
    });
    if (transition.status !== "committed") return;
    this.activeResize = { ...active, axes };
  }

  endResize(metaWindow: Meta.Window, cancelled: boolean): void {
    const id = this.port.knownWindowId(metaWindow);
    const active = id === this.activeResize?.windowId ? this.activeResize : undefined;
    if (!id || !active) return;
    this.port.dispatch({
      type: cancelled ? "OperationCancelled" : "OperationCommitted",
      operationId: active.operationId,
    });
    this.activeResize = undefined;
  }

  withdrawWindow(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    if (id === this.activeResize?.windowId) this.activeResize = undefined;
  }
}

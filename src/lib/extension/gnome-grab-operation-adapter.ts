import Meta from "gi://Meta";

import type {
  Direction,
  OperationId,
  TilingEvent,
  TilingInspection,
  TilingTransition,
  WindowFact,
  WindowId,
} from "../tiling/index.js";
import * as Utils from "./utils.js";

export interface GnomeGrabOperationPort {
  knownWindowId(metaWindow: Meta.Window): WindowId | undefined;
  windowFact(metaWindow: Meta.Window): WindowFact | null;
  allocateOperationId(): OperationId;
  dispatch(event: TilingEvent): TilingTransition;
  inspect(): TilingInspection;
}

type ResizeObservation = Readonly<{
  operationId: OperationId;
  direction: Direction;
  startSize: number;
  containerExtent: number;
  primaryToWindowScale: number;
  lastShareDelta: number;
}>;

function portableDirection(grabOp: Meta.GrabOp): Direction | undefined {
  const decomposed = Utils.decomposeGrabOp(grabOp);
  if (decomposed.length !== 1) return undefined;
  switch (Utils.directionFromGrab(decomposed[0])) {
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
}

export class GnomeGrabOperationAdapter {
  private readonly port: GnomeGrabOperationPort;
  private readonly resizeObservations = new Map<WindowId, ResizeObservation>();

  constructor(port: GnomeGrabOperationPort) {
    this.port = port;
  }

  reset(): void {
    this.resizeObservations.clear();
  }

  beginResize(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void {
    const id = this.port.knownWindowId(metaWindow);
    const direction = portableDirection(grabOp);
    const fact = this.port.windowFact(metaWindow);
    if (!id || !direction || !fact) return;

    const existing = this.resizeObservations.get(id);
    if (existing) {
      this.port.dispatch({ type: "OperationCancelled", operationId: existing.operationId });
      this.resizeObservations.delete(id);
    }

    const operationId = this.port.allocateOperationId();
    const transition = this.port.dispatch({
      type: "OperationStarted",
      operation: { id: operationId, kind: "resize", windowId: id, direction },
    });
    if (transition.status !== "committed") return;

    const inspection = this.port.inspect();
    const active = inspection.operations.find((candidate) => candidate.id === operationId);
    const container = inspection.renderPlan.containers.find(
      (candidate) => candidate.id === active?.containerId
    );
    const effectiveDirection = active?.direction ?? direction;
    const horizontal = effectiveDirection === "left" || effectiveDirection === "right";
    const containerExtent = horizontal ? container?.rect.width : container?.rect.height;
    const startSize = horizontal ? fact.frame.width : fact.frame.height;
    const primaryWindow = inspection.renderPlan.windows.find(
      (candidate) => candidate.id === active?.primaryChildId
    );
    const primaryContainer = inspection.renderPlan.containers.find(
      (candidate) => candidate.id === active?.primaryChildId
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
    ) {
      this.port.dispatch({ type: "OperationCancelled", operationId });
      return;
    }
    this.resizeObservations.set(id, {
      operationId,
      direction: effectiveDirection,
      startSize,
      containerExtent,
      primaryToWindowScale: primaryExtent / startSize,
      lastShareDelta: 0,
    });
  }

  updateResize(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    const active = id ? this.resizeObservations.get(id) : undefined;
    const fact = active ? this.port.windowFact(metaWindow) : null;
    if (!id || !active || !fact) return;
    const horizontal = active.direction === "left" || active.direction === "right";
    const currentSize = horizontal ? fact.frame.width : fact.frame.height;
    const shareDelta =
      ((currentSize - active.startSize) * active.primaryToWindowScale) / active.containerExtent;
    if (shareDelta === active.lastShareDelta) return;
    const transition = this.port.dispatch({
      type: "OperationUpdated",
      operationId: active.operationId,
      update: { shareDelta },
    });
    if (transition.status !== "committed") return;
    this.resizeObservations.set(id, { ...active, lastShareDelta: shareDelta });
  }

  endResize(metaWindow: Meta.Window, cancelled: boolean): void {
    const id = this.port.knownWindowId(metaWindow);
    const active = id ? this.resizeObservations.get(id) : undefined;
    if (!id || !active) return;
    this.port.dispatch({
      type: cancelled ? "OperationCancelled" : "OperationCommitted",
      operationId: active.operationId,
    });
    this.resizeObservations.delete(id);
  }

  withdrawWindow(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    if (id) this.resizeObservations.delete(id);
  }
}

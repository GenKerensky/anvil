import Meta from "gi://Meta";

import type {
  DragCenterAction,
  Direction,
  NonEmptyDirections,
  OperationId,
  Point,
  ResizeOperationInspection,
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

type DragObservation = Readonly<{
  windowId: WindowId;
  centerAction: DragCenterAction;
  operationId?: OperationId;
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
  private dragSession?: DragObservation;

  constructor(port: GnomeGrabOperationPort) {
    this.port = port;
  }

  reset(): void {
    this.activeResize = undefined;
    this.dragSession = undefined;
  }

  cancelActive(): boolean {
    const operationId = this.activeResize?.operationId ?? this.dragSession?.operationId;
    if (operationId) {
      this.port.dispatch({ type: "OperationCancelled", operationId });
      if (this.port.inspect().operations.some((operation) => operation.id === operationId)) {
        return false;
      }
    }
    this.activeResize = undefined;
    this.dragSession = undefined;
    return true;
  }

  beginResize(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void {
    const id = this.port.knownWindowId(metaWindow);
    const directions = portableDirections(grabOp);
    const fact = this.port.windowFact(metaWindow);
    if (!id || !directions || !fact) return;

    if (!this.cancelActive()) return;

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
    const active = inspection.operations.find(
      (candidate): candidate is ResizeOperationInspection =>
        candidate.id === operationId && candidate.kind === "resize"
    );
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

  prepareDrag(metaWindow: Meta.Window, centerAction: DragCenterAction): void {
    const id = this.port.knownWindowId(metaWindow);
    if (!id) return;
    if (!this.cancelActive()) return;
    this.dragSession = { windowId: id, centerAction };
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

  updateDrag(metaWindow: Meta.Window, pointer: Point, eligible: boolean): void {
    const id = this.port.knownWindowId(metaWindow);
    let session = id === this.dragSession?.windowId ? this.dragSession : undefined;
    if (!id || !session) return;
    if (!eligible) {
      this.suspendDrag(metaWindow);
      return;
    }
    if (!session.operationId) {
      const operationId = this.port.allocateOperationId();
      const transition = this.port.dispatch({
        type: "OperationStarted",
        operation: {
          id: operationId,
          kind: "drag",
          windowId: id,
          centerAction: session.centerAction,
        },
      });
      if (transition.status !== "committed") return;
      session = { ...session, operationId };
      this.dragSession = session;
    }
    const operationId = session.operationId;
    if (!operationId) return;
    this.port.dispatch({
      type: "OperationUpdated",
      operationId,
      update: { pointer },
    });
  }

  suspendDrag(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    const session = id === this.dragSession?.windowId ? this.dragSession : undefined;
    if (!id || !session?.operationId) return;
    this.port.dispatch({ type: "OperationCancelled", operationId: session.operationId });
    if (this.port.inspect().operations.some((operation) => operation.id === session.operationId)) {
      return;
    }
    this.dragSession = { windowId: id, centerAction: session.centerAction };
  }

  end(metaWindow: Meta.Window, cancelled: boolean, commitDrag: boolean): void {
    const id = this.port.knownWindowId(metaWindow);
    if (!id) return;
    const resize = id === this.activeResize?.windowId ? this.activeResize : undefined;
    const drag = id === this.dragSession?.windowId ? this.dragSession : undefined;
    const operationId = resize?.operationId ?? drag?.operationId;
    if (operationId) {
      const shouldCancel = cancelled || (drag !== undefined && !commitDrag);
      const transition = this.port.dispatch({
        type: shouldCancel ? "OperationCancelled" : "OperationCommitted",
        operationId,
      });
      if (transition.status === "rejected" && !shouldCancel) {
        this.port.dispatch({ type: "OperationCancelled", operationId });
      }
      if (this.port.inspect().operations.some((operation) => operation.id === operationId)) return;
    }
    if (resize) this.activeResize = undefined;
    if (drag) this.dragSession = undefined;
  }

  withdrawWindow(metaWindow: Meta.Window): void {
    const id = this.port.knownWindowId(metaWindow);
    if (id === this.activeResize?.windowId) this.activeResize = undefined;
    if (id === this.dragSession?.windowId) this.dragSession = undefined;
  }
}

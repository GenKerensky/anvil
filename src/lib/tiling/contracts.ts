export type TilingIdentity<Kind extends string> = string & { readonly __kind: Kind };

export type WindowId = TilingIdentity<"window">;
export type SurfaceId = TilingIdentity<"surface">;
export type ContainerId = TilingIdentity<"container">;
export type OperationId = TilingIdentity<"operation">;

function identity<Kind extends string>(kind: Kind, value: string): TilingIdentity<Kind> {
  if (value.length === 0) throw new TypeError(`${kind} identity must not be empty`);
  return value as TilingIdentity<Kind>;
}

export const windowId = (value: string): WindowId => identity("window", value);
export const surfaceId = (value: string): SurfaceId => identity("surface", value);
export const operationId = (value: string): OperationId => identity("operation", value);

export type TilingRevision = number;
export type Layout = "horizontal" | "vertical" | "stacked" | "tabbed";
export type Direction = "left" | "right" | "up" | "down";

export type Rect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type SurfaceConstraint = Readonly<{
  maxWidth?: number;
  maxHeight?: number;
  resizeExempt?: boolean;
}>;

export type ParticipationRule = Readonly<{
  id: string;
  action: "tile" | "float";
  applicationId?: string;
  title?: string;
  role?: string;
  transient?: boolean;
  resizable?: boolean;
  tags?: readonly string[];
  windowId?: WindowId;
}>;

export type TilingPolicy = Readonly<{
  enabled: boolean;
  surfaceTiling: Readonly<Record<string, boolean>>;
  allowedLayouts: readonly Layout[];
  defaultLayout: Layout;
  gap: number;
  hideGapWhenSingle: boolean;
  autoSplit: boolean;
  singleTabExit: "preserve" | "split";
  headerExtent: number;
  constraints: Readonly<Record<string, SurfaceConstraint>>;
  participationRules: readonly ParticipationRule[];
  reconcileAttempts: number;
}>;

export type TilingDiagnostic = Readonly<{
  code: string;
  message: string;
  identity?: string;
}>;

export type PlatformCapabilities = Readonly<{
  focus: boolean;
  raise: boolean;
  move: boolean;
  resize: boolean;
}>;

export type SurfaceFact = Readonly<{
  id: SurfaceId;
  workArea: Rect;
  neighbors: Readonly<Partial<Record<Direction, SurfaceId>>>;
  capabilities: PlatformCapabilities;
}>;

export type WindowFact = Readonly<{
  id: WindowId;
  surfaceId: SurfaceId;
  frame: Rect;
  available: boolean;
  capabilities: PlatformCapabilities;
  applicationId?: string;
  title?: string;
  role?: string;
  transientParentId?: WindowId;
  resizable?: boolean;
  tags?: readonly string[];
}>;

export type SurfaceInspection = Readonly<{
  id: SurfaceId;
  workArea: Rect;
  rootId: ContainerId;
  neighbors: Readonly<Partial<Record<Direction, SurfaceId>>>;
  capabilities: PlatformCapabilities;
}>;

export type WindowInspection = Readonly<{
  id: WindowId;
  surfaceId: SurfaceId;
  parentId?: ContainerId;
  participating: boolean;
  available: boolean;
  frame: Rect;
}>;

export type ContainerInspection = Readonly<{
  id: ContainerId;
  surfaceId: SurfaceId;
  parentId?: ContainerId;
  layout: Layout;
  childIds: readonly (ContainerId | WindowId)[];
  weights: Readonly<Record<string, number>>;
  selectedChildId?: ContainerId | WindowId;
}>;

export type OperationInspection = Readonly<{
  id: OperationId;
  kind: "resize" | "drag";
}>;

export type PlacementHintInspection = Readonly<{
  windowId: WindowId;
  surfaceId: SurfaceId;
  parentId?: ContainerId;
  beforeId?: ContainerId | WindowId;
  afterId?: ContainerId | WindowId;
  weight?: number;
  selected: boolean;
}>;

export type SurfaceEvacuationInspection = Readonly<{
  surfaceId: SurfaceId;
  windowIds: readonly WindowId[];
  layout: Layout;
  childIds: readonly (ContainerId | WindowId)[];
  weights: Readonly<Record<string, number>>;
  selectedChildId?: ContainerId | WindowId;
}>;

export type SurfacePlan = Readonly<{
  id: SurfaceId;
  workArea: Rect;
}>;

export type WindowPlan = Readonly<{
  id: WindowId;
  surfaceId: SurfaceId;
  frame: Rect;
}>;

export type ContainerPlan = Readonly<{
  id: ContainerId;
  surfaceId: SurfaceId;
  rect: Rect;
  layout: Layout;
  selectedChildId?: ContainerId | WindowId;
  stackingOrder: readonly (ContainerId | WindowId)[];
}>;

export type PreviewPlan = Readonly<{
  operationId: OperationId;
  surfaceId: SurfaceId;
  rect: Rect;
}>;

export type TilingRenderPlan = Readonly<{
  revision: TilingRevision;
  surfaces: readonly SurfacePlan[];
  windows: readonly WindowPlan[];
  containers: readonly ContainerPlan[];
  previews: readonly PreviewPlan[];
}>;

export type TilingInspection = Readonly<{
  schemaVersion: 1;
  revision: TilingRevision;
  policy: TilingPolicy;
  surfaces: readonly SurfaceInspection[];
  windows: readonly WindowInspection[];
  containers: readonly ContainerInspection[];
  operations: readonly OperationInspection[];
  placementHints: readonly PlacementHintInspection[];
  evacuationHints: readonly SurfaceEvacuationInspection[];
  renderPlan: TilingRenderPlan;
  diagnostics: readonly TilingDiagnostic[];
}>;

export type PlatformSnapshot = Readonly<{
  surfaces: readonly SurfaceFact[];
  windows: readonly WindowFact[];
  focusedWindowId?: WindowId;
}>;

export type PlatformFact =
  | Readonly<{
      type: "WindowAvailabilityObserved";
      windowId: WindowId;
      available: boolean;
    }>
  | Readonly<{
      type: "WindowWithdrawn";
      windowId: WindowId;
    }>
  | Readonly<{
      type: "SurfaceObserved";
      surface: SurfaceFact;
    }>
  | Readonly<{
      type: "SurfaceWithdrawn";
      surfaceId: SurfaceId;
    }>;

export type TilingCommand =
  | Readonly<{
      type: "SetLayout";
      windowId: WindowId;
      layout: Layout;
    }>
  | Readonly<{
      type: "FocusDirection";
      windowId: WindowId;
      direction: Direction;
    }>
  | Readonly<{
      type: "MoveDirection";
      windowId: WindowId;
      direction: Direction;
    }>
  | Readonly<{
      type: "SwapDirection";
      windowId: WindowId;
      direction: Direction;
    }>;

export type TilingEvent =
  | Readonly<{
      type: "PlatformSnapshotObserved";
      snapshot: PlatformSnapshot;
    }>
  | Readonly<{
      type: "FactsObserved";
      facts: readonly PlatformFact[];
    }>
  | Readonly<{
      type: "PolicyReplaced";
      policy: TilingPolicy;
    }>
  | Readonly<{
      type: "CommandRequested";
      command: TilingCommand;
    }>;

type IntentionToken = Readonly<{
  revision: TilingRevision;
  ordinal: number;
}>;

export type TilingIntention =
  | (IntentionToken &
      Readonly<{
        type: "WindowParticipationChanged";
        windowId: WindowId;
        participating: boolean;
      }>)
  | (IntentionToken &
      Readonly<{
        type: "PlaceWindow";
        windowId: WindowId;
        surfaceId: SurfaceId;
        frame: Rect;
      }>)
  | (IntentionToken &
      Readonly<{
        type: "FocusWindow";
        windowId: WindowId;
      }>)
  | (IntentionToken &
      Readonly<{
        type: "PresentContainer";
        containerId: ContainerId;
        surfaceId: SurfaceId;
        layout: Layout;
        selectedChildId?: ContainerId | WindowId;
        stackingOrder: readonly (ContainerId | WindowId)[];
      }>);

export type TilingTransition =
  | Readonly<{
      status: "committed";
      revision: TilingRevision;
      intentions: readonly TilingIntention[];
      diagnostics: readonly TilingDiagnostic[];
    }>
  | Readonly<{
      status: "ignored" | "rejected";
      revision: TilingRevision;
      intentions: readonly [];
      diagnostics: readonly TilingDiagnostic[];
    }>;

export interface TilingStateMachine {
  dispatch(event: TilingEvent): TilingTransition;
  inspect(): TilingInspection;
}

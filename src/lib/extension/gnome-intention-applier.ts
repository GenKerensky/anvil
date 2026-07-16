import Meta from "gi://Meta";

import type {
  IntentionToken,
  PlatformFact,
  Rect,
  SurfaceId,
  TilingIntention,
  WindowId,
} from "../tiling/index.js";
import type { AnvilWindowActor } from "./window/types.js";

type ParticipationIntention = Extract<TilingIntention, { type: "WindowParticipationChanged" }>;
type ContainerIntention = Extract<TilingIntention, { type: "PresentContainer" }>;
type RemoveContainerIntention = Extract<TilingIntention, { type: "RemoveContainerPresentation" }>;
type PreviewIntention = Extract<TilingIntention, { type: "PresentPreview" }>;
type ClearPreviewIntention = Extract<TilingIntention, { type: "ClearPreview" }>;

export type PendingFrameObservation = Readonly<{
  windowId: WindowId;
  surfaceId: SurfaceId;
  causalToken: IntentionToken;
}>;

export type AppliedIntentionBatch = Readonly<{
  facts: readonly PlatformFact[];
  pendingFrames: readonly PendingFrameObservation[];
}>;

export interface GnomeIntentionApplierHost {
  resolveWindow(id: WindowId): Meta.Window | undefined;
  toGlobalRect(surfaceId: SurfaceId, rect: Rect): Rect;
  toLocalRect(surfaceId: SurfaceId, rect: Rect): Rect;
  participationChanged(
    metaWindow: Meta.Window,
    participating: ParticipationIntention["participating"]
  ): void;
  presentContainer(intention: ContainerIntention): void;
  removeContainerPresentation(containerId: RemoveContainerIntention["containerId"]): void;
  raiseWindows(metaWindows: readonly Meta.Window[]): void;
  presentPreview(intention: PreviewIntention): void;
  clearPreview(intention: ClearPreviewIntention): void;
}

function token(intention: TilingIntention): IntentionToken {
  return { revision: intention.revision, ordinal: intention.ordinal };
}

function identity(intention: TilingIntention): string | undefined {
  switch (intention.type) {
    case "WindowParticipationChanged":
    case "PlaceWindow":
    case "FocusWindow":
      return intention.windowId;
    case "PresentContainer":
    case "RemoveContainerPresentation":
    case "RaiseWindows":
      return intention.containerId;
    case "PresentPreview":
    case "ClearPreview":
      return intention.operationId;
  }
}

/**
 * Applies a committed portable intention batch without dispatching back into the core.
 * Delayed frame acknowledgements retain identities and causal tokens only; Runtime schedules
 * `observeSettled()` after Mutter has had a chance to apply the complete batch.
 */
export class GnomeIntentionApplier {
  constructor(private readonly host: GnomeIntentionApplierHost) {}

  apply(intentions: readonly TilingIntention[]): AppliedIntentionBatch {
    const facts: PlatformFact[] = [];
    const pendingFrames: PendingFrameObservation[] = [];
    const withdrawnWindows = new Set<WindowId>();
    const fail = (intention: TilingIntention, code: string): void => {
      facts.push({
        type: "EffectFailed",
        causalToken: token(intention),
        code,
        ...(identity(intention) ? { identity: identity(intention) } : {}),
      });
    };
    const resolveWindow = (
      intention: Extract<TilingIntention, { windowId: WindowId }>
    ): Meta.Window | undefined => {
      const metaWindow = this.host.resolveWindow(intention.windowId);
      if (metaWindow) return metaWindow;
      if (!withdrawnWindows.has(intention.windowId)) {
        facts.push({ type: "WindowWithdrawn", windowId: intention.windowId });
        withdrawnWindows.add(intention.windowId);
      }
      fail(intention, "target-withdrawn");
      return undefined;
    };

    for (const intention of intentions) {
      try {
        switch (intention.type) {
          case "WindowParticipationChanged": {
            const metaWindow = resolveWindow(intention);
            if (metaWindow) this.host.participationChanged(metaWindow, intention.participating);
            break;
          }
          case "PlaceWindow": {
            const metaWindow = resolveWindow(intention);
            if (!metaWindow) break;
            const rect = this.host.toGlobalRect(intention.surfaceId, intention.frame);
            const actor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
            // `window-created` can precede compositor actor creation. Any
            // size-state or frame mutation at that point can crash Mutter.
            // Reconciliation issues a fresh placement once the actor maps.
            if (!actor) {
              pendingFrames.push({
                windowId: intention.windowId,
                surfaceId: intention.surfaceId,
                causalToken: token(intention),
              });
              break;
            }
            try {
              metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
              metaWindow.unmaximize();
            } catch {
              const legacyWindow = metaWindow as unknown as {
                unmaximize(flags: Meta.MaximizeFlags): void;
              };
              legacyWindow.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
              legacyWindow.unmaximize(Meta.MaximizeFlags.VERTICAL);
              legacyWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            }
            actor.remove_all_transitions();
            metaWindow.move_frame(true, rect.x, rect.y);
            metaWindow.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            pendingFrames.push({
              windowId: intention.windowId,
              surfaceId: intention.surfaceId,
              causalToken: token(intention),
            });
            break;
          }
          case "FocusWindow": {
            const metaWindow = resolveWindow(intention);
            if (metaWindow) metaWindow.activate(global.display.get_current_time());
            break;
          }
          case "PresentContainer":
            this.host.presentContainer(intention);
            break;
          case "RemoveContainerPresentation":
            this.host.removeContainerPresentation(intention.containerId);
            break;
          case "RaiseWindows": {
            const metaWindows = intention.windowIds.flatMap((windowId) => {
              const metaWindow = this.host.resolveWindow(windowId);
              if (metaWindow) return [metaWindow];
              if (!withdrawnWindows.has(windowId)) {
                facts.push({ type: "WindowWithdrawn", windowId });
                withdrawnWindows.add(windowId);
              }
              facts.push({
                type: "EffectFailed",
                causalToken: token(intention),
                code: "target-withdrawn",
                identity: windowId,
              });
              return [];
            });
            this.host.raiseWindows(metaWindows);
            break;
          }
          case "PresentPreview":
            this.host.presentPreview(intention);
            break;
          case "ClearPreview":
            this.host.clearPreview(intention);
            break;
        }
      } catch {
        fail(intention, "effect-error");
      }
    }

    return { facts, pendingFrames };
  }

  observeSettled(pendingFrames: readonly PendingFrameObservation[]): PlatformFact[] {
    const facts: PlatformFact[] = [];
    const withdrawnWindows = new Set<WindowId>();
    for (const pending of pendingFrames) {
      const metaWindow = this.host.resolveWindow(pending.windowId);
      if (!metaWindow) {
        if (!withdrawnWindows.has(pending.windowId)) {
          facts.push({ type: "WindowWithdrawn", windowId: pending.windowId });
          withdrawnWindows.add(pending.windowId);
        }
        facts.push({
          type: "EffectFailed",
          causalToken: { ...pending.causalToken },
          code: "target-withdrawn",
          identity: pending.windowId,
        });
        continue;
      }
      try {
        const frame = metaWindow.get_frame_rect();
        facts.push({
          type: "FrameObserved",
          windowId: pending.windowId,
          frame: this.host.toLocalRect(pending.surfaceId, frame),
          causalToken: { ...pending.causalToken },
        });
      } catch {
        facts.push({
          type: "EffectFailed",
          causalToken: { ...pending.causalToken },
          code: "observe-error",
          identity: pending.windowId,
        });
      }
    }
    return facts;
  }
}

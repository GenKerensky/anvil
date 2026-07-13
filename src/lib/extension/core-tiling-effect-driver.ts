import type { PlatformFact, TilingIntention, TilingTransition } from "../tiling/index.js";
import type { EventSchedulerPort } from "./event-scheduler.js";
import type { AppliedIntentionBatch, PendingFrameObservation } from "./gnome-intention-applier.js";

export interface CoreIntentionApplierPort {
  apply(intentions: readonly TilingIntention[]): AppliedIntentionBatch;
  observeSettled(pendingFrames: readonly PendingFrameObservation[]): readonly PlatformFact[];
}

/**
 * Enforces the commit/apply/settle boundary for core-mode transitions.
 * The state machine is never called while an intention batch is being applied.
 */
export class CoreTilingEffectDriver {
  constructor(
    private readonly applier: CoreIntentionApplierPort,
    private readonly scheduler: EventSchedulerPort,
    private readonly submitFacts: (facts: readonly PlatformFact[]) => void,
    private readonly requestReconcile: () => void
  ) {}

  consume(transition: TilingTransition): void {
    if (transition.status !== "committed") return;
    const applied = this.applier.apply(transition.intentions);
    if (applied.facts.length === 0 && applied.pendingFrames.length === 0) return;
    this.scheduler.enqueue(
      {
        name: `core-effect-results:${transition.revision}`,
        callback: () => {
          const settled = this.applier.observeSettled(applied.pendingFrames);
          const facts = [...applied.facts, ...settled];
          if (facts.length > 0) this.submitFacts(facts);
          if (applied.pendingFrames.length > 0) this.requestReconcile();
        },
      },
      220
    );
  }
}

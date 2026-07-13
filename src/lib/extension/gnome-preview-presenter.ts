import St from "gi://St";

import type { OperationId, Rect, SurfaceId, TilingIntention } from "../tiling/index.js";

type PresentPreviewIntention = Extract<TilingIntention, { type: "PresentPreview" }>;

export interface GnomePreviewPresenterHost {
  enabled(): boolean;
  toGlobalRect(surfaceId: SurfaceId, rect: Rect): Rect;
}

/** Owns drag-preview actors requested by portable operation render plans. */
export class GnomePreviewPresenter {
  private readonly actors = new Map<OperationId, St.Bin>();

  constructor(private readonly host: GnomePreviewPresenterHost) {}

  present(intention: PresentPreviewIntention): void {
    if (!this.host.enabled()) {
      this.clear(intention.operationId);
      return;
    }
    let actor = this.actors.get(intention.operationId);
    if (!actor) {
      actor = new St.Bin({ style_class: "window-tilepreview-tiled" });
      (actor as St.Bin & { type: string }).type = "anvil-core-preview";
      this.actors.set(intention.operationId, actor);
      global.window_group.add_child(actor);
    }
    const rect = this.host.toGlobalRect(intention.surfaceId, intention.rect);
    actor.set_position(rect.x, rect.y);
    actor.set_size(rect.width, rect.height);
    actor.show();
  }

  clear(operationId: OperationId): void {
    const actor = this.actors.get(operationId);
    if (!actor) return;
    this.actors.delete(operationId);
    if (global.window_group.contains(actor)) global.window_group.remove_child(actor);
    actor.destroy();
  }

  destroy(): void {
    for (const operationId of [...this.actors.keys()]) this.clear(operationId);
  }

  inspect(): readonly Readonly<{ operationId: OperationId; rect: Rect; visible: boolean }>[] {
    return [...this.actors.entries()].map(([operationId, actor]) => ({
      operationId,
      rect: { x: actor.x, y: actor.y, width: actor.width, height: actor.height },
      visible: actor.visible,
    }));
  }
}

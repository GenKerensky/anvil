import Meta from "gi://Meta";
import St from "gi://St";

import type { ContainerId, Rect, SurfaceId, TilingIntention, WindowId } from "../tiling/index.js";
import type { AnvilWindowActor } from "./window/types.js";

type PresentContainerIntention = Extract<TilingIntention, { type: "PresentContainer" }>;

export interface GnomeContainerPresenterHost {
  resolveWindow(id: WindowId): Meta.Window | undefined;
  toGlobalRect(surfaceId: SurfaceId, rect: Rect): Rect;
}

type Presentation = Readonly<{ actor: St.BoxLayout }>;

/** Owns GNOME tab/stack actors while the portable state machine owns their desired state. */
export class GnomeContainerPresenter {
  private readonly presentations = new Map<ContainerId, Presentation>();

  constructor(private readonly host: GnomeContainerPresenterHost) {}

  present(intention: PresentContainerIntention): void {
    if (!intention.headerRect) {
      this.remove(intention.containerId);
      return;
    }
    const actor = this.presentation(intention.containerId).actor;
    this.clearChildren(actor);
    for (const windowId of intention.windowIds) {
      const metaWindow = this.host.resolveWindow(windowId);
      if (!metaWindow) continue;
      const tab = new St.BoxLayout({ style_class: "window-tabbed-tab", x_expand: true });
      if (windowId === intention.selectedWindowId) {
        tab.add_style_class_name("window-tabbed-tab-active");
      }
      const title = new St.Button({ x_expand: true, label: metaWindow.get_title() ?? "" });
      const close = new St.Button({
        style_class: "window-tabbed-tab-close",
        child: new St.Icon({ icon_name: "window-close-symbolic" }),
      });
      title.connect("clicked", () => metaWindow.activate(global.display.get_current_time()));
      close.connect("clicked", () => metaWindow.delete(global.get_current_time()));
      tab.add_child(title);
      tab.add_child(close);
      actor.add_child(tab);
    }
    const rect = this.host.toGlobalRect(intention.surfaceId, intention.headerRect);
    actor.set_position(rect.x, rect.y);
    actor.set_size(rect.width, rect.height);
    this.attach(actor, intention.selectedWindowId);
    actor.show();
  }

  remove(containerId: ContainerId): void {
    const presentation = this.presentations.get(containerId);
    if (!presentation) return;
    const { actor } = presentation;
    this.presentations.delete(containerId);
    this.clearChildren(actor);
    if (global.window_group.contains(actor)) global.window_group.remove_child(actor);
    actor.destroy();
  }

  destroy(): void {
    for (const containerId of [...this.presentations.keys()]) this.remove(containerId);
  }

  inspect(): readonly Readonly<{
    containerId: ContainerId;
    rect: Rect;
    visible: boolean;
    tabCount: number;
  }>[] {
    return [...this.presentations.entries()].map(([containerId, { actor }]) => ({
      containerId,
      rect: { x: actor.x, y: actor.y, width: actor.width, height: actor.height },
      visible: actor.visible,
      tabCount: actor.get_children().length,
    }));
  }

  private presentation(containerId: ContainerId): Presentation {
    const existing = this.presentations.get(containerId);
    if (existing) return existing;
    const actor = new St.BoxLayout({ style_class: "window-tabbed-bg" });
    (actor as St.BoxLayout & { type: string }).type = "anvil-core-deco";
    const presentation = { actor };
    this.presentations.set(containerId, presentation);
    return presentation;
  }

  private attach(actor: St.BoxLayout, selectedWindowId?: WindowId): void {
    const selectedActor = selectedWindowId
      ? (this.host
          .resolveWindow(selectedWindowId)
          ?.get_compositor_private() as AnvilWindowActor | null)
      : null;
    if (global.window_group.contains(actor)) global.window_group.remove_child(actor);
    if (selectedActor && global.window_group.contains(selectedActor)) {
      global.window_group.insert_child_below(actor, selectedActor);
    } else {
      global.window_group.add_child(actor);
    }
  }

  private clearChildren(actor: St.BoxLayout): void {
    for (const child of actor.get_children()) {
      actor.remove_child(child);
      child.destroy();
    }
  }
}

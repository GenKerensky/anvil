import { describe, expect, it, vi } from "vitest";
import St from "gi://St";

import { GnomeContainerPresenter } from "../../../src/lib/extension/gnome-container-presenter.js";
import { surfaceId, windowId } from "../../../src/lib/tiling/index.js";
import { createMockWindow, installGnomeGlobals } from "../mocks/helpers/index.js";

describe("GnomeContainerPresenter", () => {
  it("renders identity-based tabs at the portable header rectangle", () => {
    const globals = installGnomeGlobals();
    const surface = surfaceId("surface:1");
    const firstId = windowId("window:1");
    const secondId = windowId("window:2");
    const first = createMockWindow({ title: "First" });
    const second = createMockWindow({ title: "Second" });
    const activate = vi.spyOn(second, "activate");
    const presenter = new GnomeContainerPresenter({
      resolveWindow: (id) => (id === firstId ? first : id === secondId ? second : undefined),
      toGlobalRect: (_surfaceId, rect) => ({ ...rect, x: rect.x + 100, y: rect.y + 200 }),
    });

    presenter.present({
      type: "PresentContainer",
      revision: 2,
      ordinal: 0,
      containerId: "container:1" as never,
      surfaceId: surface,
      layout: "tabbed",
      headerRect: { x: 10, y: 20, width: 800, height: 35 },
      selectedWindowId: secondId,
      windowIds: [firstId, secondId],
      stackingOrder: [firstId, secondId],
    });

    const [actor] = globals.windowGroup!._children as St.BoxLayout[];
    expect(actor).toMatchObject({
      type: "anvil-core-deco",
      x: 110,
      y: 220,
      width: 800,
      height: 35,
      visible: true,
    });
    const tabs = actor.get_children() as St.BoxLayout[];
    expect(tabs).toHaveLength(2);
    expect(tabs[0].get_child_at_index(0)).toMatchObject({ label: "First" });
    expect(tabs[1].get_style_class_name()).toContain("window-tabbed-tab-active");
    tabs[1].get_child_at_index(0)!.emit("clicked");
    expect(activate).toHaveBeenCalledOnce();

    presenter.remove("container:1" as never);
    expect(globals.windowGroup!._children).toEqual([]);
    expect(actor).toMatchObject({ _destroyed: true });
    globals.cleanup();
  });

  it("removes stale presentation when policy omits header geometry", () => {
    const globals = installGnomeGlobals();
    const id = windowId("window:1");
    const presenter = new GnomeContainerPresenter({
      resolveWindow: () => createMockWindow(),
      toGlobalRect: (_surfaceId, rect) => ({ ...rect }),
    });
    const base = {
      type: "PresentContainer" as const,
      revision: 1,
      ordinal: 0,
      containerId: "container:1" as never,
      surfaceId: surfaceId("surface:1"),
      layout: "stacked" as const,
      windowIds: [id],
      stackingOrder: [id],
    };
    presenter.present({ ...base, headerRect: { x: 0, y: 0, width: 100, height: 35 } });
    expect(globals.windowGroup!._children).toHaveLength(1);

    presenter.present({ ...base, revision: 2 });

    expect(globals.windowGroup!._children).toEqual([]);
    globals.cleanup();
  });
});

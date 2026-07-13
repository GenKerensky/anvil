import { describe, expect, it } from "vitest";

import { GnomePreviewPresenter } from "../../../src/lib/extension/gnome-preview-presenter.js";
import { operationId, surfaceId } from "../../../src/lib/tiling/index.js";
import { installGnomeGlobals } from "../mocks/helpers/index.js";

describe("GnomePreviewPresenter", () => {
  it("applies and clears surface-local preview geometry", () => {
    const globals = installGnomeGlobals();
    const operation = operationId("operation:1");
    const presenter = new GnomePreviewPresenter({
      enabled: () => true,
      toGlobalRect: (_surfaceId, rect) => ({ ...rect, x: rect.x + 100, y: rect.y + 200 }),
    });

    presenter.present({
      type: "PresentPreview",
      revision: 2,
      ordinal: 0,
      operationId: operation,
      surfaceId: surfaceId("surface:1"),
      rect: { x: 10, y: 20, width: 400, height: 300 },
    });

    expect(presenter.inspect()).toEqual([
      {
        operationId: operation,
        rect: { x: 110, y: 220, width: 400, height: 300 },
        visible: true,
      },
    ]);
    presenter.clear(operation);
    expect(presenter.inspect()).toEqual([]);
    expect(globals.windowGroup!._children).toEqual([]);
    globals.cleanup();
  });

  it("does not retain previews when runtime policy disables them", () => {
    const globals = installGnomeGlobals();
    const presenter = new GnomePreviewPresenter({
      enabled: () => false,
      toGlobalRect: (_surfaceId, rect) => ({ ...rect }),
    });
    presenter.present({
      type: "PresentPreview",
      revision: 1,
      ordinal: 0,
      operationId: operationId("operation:1"),
      surfaceId: surfaceId("surface:1"),
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(globals.windowGroup!._children).toEqual([]);
    globals.cleanup();
  });
});

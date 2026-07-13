import { describe, expect, it, vi } from "vitest";

import { GnomeGrabOperationAdapter } from "../../../src/lib/extension/gnome-grab-operation-adapter.js";
import {
  operationId,
  surfaceId,
  windowId,
  type TilingEvent,
  type TilingTransition,
} from "../../../src/lib/tiling/index.js";

describe("GnomeGrabOperationAdapter", () => {
  it("cancels a drag if its commit is rejected", () => {
    const metaWindow = {} as never;
    const events: TilingEvent[] = [];
    const dispatch = vi.fn((event: TilingEvent): TilingTransition => {
      events.push(event);
      return {
        status: event.type === "OperationCommitted" ? "rejected" : "committed",
        revision: events.length,
        intentions: [],
        diagnostics:
          event.type === "OperationCommitted"
            ? [{ code: "stale-operation-topology", message: "stale" }]
            : [],
      };
    });
    const adapter = new GnomeGrabOperationAdapter({
      knownWindowId: () => windowId("window"),
      windowFact: () => null,
      allocateOperationId: () => operationId("operation"),
      dispatch,
      inspect: () => ({ operations: [] } as never),
    });

    adapter.prepareDrag(metaWindow, "swap");
    adapter.updateDrag(metaWindow, { surfaceId: surfaceId("surface"), x: 10, y: 10 }, true);
    adapter.end(metaWindow, false, true);

    expect(events.map((event) => event.type)).toEqual([
      "OperationStarted",
      "OperationUpdated",
      "OperationCommitted",
      "OperationCancelled",
    ]);
  });

  it("retains an operation handle while core still reports it active", () => {
    const metaWindow = {} as never;
    const id = operationId("operation");
    const events: TilingEvent[] = [];
    const adapter = new GnomeGrabOperationAdapter({
      knownWindowId: () => windowId("window"),
      windowFact: () => null,
      allocateOperationId: () => id,
      dispatch: (event) => {
        events.push(event);
        return {
          status:
            event.type === "OperationStarted" || event.type === "OperationUpdated"
              ? "committed"
              : "rejected",
          revision: events.length,
          intentions: [],
          diagnostics: [],
        } as TilingTransition;
      },
      inspect: () => ({ operations: [{ id }] } as never),
    });

    adapter.prepareDrag(metaWindow, "swap");
    adapter.updateDrag(metaWindow, { surfaceId: surfaceId("surface"), x: 10, y: 10 }, true);
    adapter.end(metaWindow, false, true);
    expect(adapter.cancelActive()).toBe(false);
    adapter.prepareDrag(metaWindow, "tabbed");

    expect(events.map((event) => event.type)).toEqual([
      "OperationStarted",
      "OperationUpdated",
      "OperationCommitted",
      "OperationCancelled",
      "OperationCancelled",
      "OperationCancelled",
    ]);
    expect(events.filter((event) => event.type === "OperationStarted")).toHaveLength(1);
  });
});

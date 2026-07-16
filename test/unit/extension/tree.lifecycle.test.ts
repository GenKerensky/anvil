import { describe, expect, it } from "vitest";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { createTreeFixture } from "../mocks/helpers/index.js";

describe("Tiling Tree lifecycle", () => {
  it("removes owned actors and can initialize cleanly again", () => {
    const ctx = createTreeFixture();
    const initialActorCount = ctx.windowGroup._children.length;
    expect(initialActorCount).toBeGreaterThan(0);

    ctx.tree.dispose();
    expect(ctx.windowGroup._children).toHaveLength(0);
    expect(ctx.tree.childNodes).toHaveLength(0);
    expect(ctx.tree.nodeValue).toBe("root");

    ctx.tree.initialize();
    ctx.tree._initWorkspaces();
    expect(ctx.windowGroup._children).toHaveLength(initialActorCount);
    expect(ctx.tree.getNodeByType(NODE_TYPES.WORKSPACE).length).toBeGreaterThan(0);
  });
});

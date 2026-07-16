import { describe, expect, it, vi } from "vitest";
import Meta from "gi://Meta";

import {
  findEligibleResizePair,
  percentsFromSizeDelta,
  planPercentResize,
} from "../../../src/lib/extension/grab-resize-policy.js";
import {
  Node,
  NODE_TYPES,
  ORIENTATION_TYPES,
  POSITION,
  type RectLike,
  type NodeType,
} from "../../../src/lib/extension/tree.js";

function node(identity: string, type: NodeType = NODE_TYPES.CON): Node {
  return new Node(type, identity);
}

describe("findEligibleResizePair", () => {
  it("walks past unavailable candidates", () => {
    const focus = node("focus");
    const floating = node("floating");
    const minimized = node("minimized");
    const eligible = node("eligible");
    const nextVisible = vi.fn((current: Node) => {
      if (current === focus) return floating;
      if (current === floating) return minimized;
      if (current === minimized) return eligible;
      return null;
    });

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.RIGHT,
        nextVisible,
        isEligible: (candidate) => candidate === eligible,
      })
    ).toBe(eligible);
    expect(nextVisible).toHaveBeenCalledTimes(3);
  });

  it("stops at a surface boundary", () => {
    const focus = node("focus");
    const boundary = node("boundary", NODE_TYPES.MONITOR);
    const remote = node("remote");

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.RIGHT,
        nextVisible: (current) => (current === focus ? boundary : remote),
        isBoundary: (candidate) => candidate === boundary,
        isEligible: (candidate) => candidate === remote,
      })
    ).toBeNull();
  });

  it("terminates malformed traversal cycles", () => {
    const focus = node("focus");
    const unavailable = node("unavailable");
    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.UP,
        nextVisible: () => unavailable,
        isEligible: () => false,
      })
    ).toBeNull();
  });
});

describe("percentsFromSizeDelta", () => {
  it.each([
    { changePx: 100, firstPercent: 0.6, secondPercent: 0.4 },
    { changePx: -100, firstPercent: 0.4, secondPercent: 0.6 },
  ])("converts a $changePx pixel delta into normalized shares", (expected) => {
    expect(
      percentsFromSizeDelta({
        firstSize: 500,
        secondSize: 500,
        parentSize: 1000,
        changePx: expected.changePx,
      })
    ).toEqual({
      firstPercent: expected.firstPercent,
      secondPercent: expected.secondPercent,
    });
  });

  it.each([0, -1])("rejects nonpositive parent geometry (%i)", (parentSize) => {
    expect(
      percentsFromSizeDelta({ firstSize: 10, secondSize: 10, parentSize, changePx: 5 })
    ).toBeNull();
  });
});

describe("planPercentResize", () => {
  it("plans a same-parent resize without mutating node shares", () => {
    const parent = node("parent");
    parent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const focus = node("focus", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    focus.rect = { x: 0, y: 0, width: 500, height: 800 };
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    focus.percent = 0.5;
    pair.percent = 0.5;
    parent.appendChild(focus);
    parent.appendChild(pair);

    const plan = planPercentResize({
      focusNode: focus,
      resizePair: pair,
      initRect: focus.rect,
      currentRect: { x: 0, y: 0, width: 600, height: 800 },
      orientation: ORIENTATION_TYPES.HORIZONTAL,
      position: POSITION.AFTER,
      tiledChildCount: (candidate) => candidate.childNodes.length,
    });

    expect(plan).toMatchObject({
      firstNode: focus,
      secondNode: pair,
      firstPercent: 0.6,
      secondPercent: 0.4,
    });
    expect([focus.percent, pair.percent]).toEqual([0.5, 0.5]);
  });

  it("plans a vertical same-parent resize without mutating node shares", () => {
    const parent = node("parent");
    parent.rect = { x: 0, y: 0, width: 800, height: 1000 };
    const focus = node("focus", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    focus.rect = { x: 0, y: 0, width: 800, height: 500 };
    pair.rect = { x: 0, y: 500, width: 800, height: 500 };
    focus.percent = 0.5;
    pair.percent = 0.5;
    parent.appendChild(focus);
    parent.appendChild(pair);

    const plan = planPercentResize({
      focusNode: focus,
      resizePair: pair,
      initRect: focus.rect,
      currentRect: { x: 0, y: 0, width: 800, height: 600 },
      orientation: ORIENTATION_TYPES.VERTICAL,
      position: POSITION.AFTER,
      tiledChildCount: (candidate) => candidate.childNodes.length,
    });

    expect(plan).toMatchObject({
      firstNode: focus,
      secondNode: pair,
      firstPercent: 0.6,
      secondPercent: 0.4,
    });
    expect([focus.percent, pair.percent]).toEqual([0.5, 0.5]);
  });

  it.each([
    {
      name: "horizontal BEFORE",
      orientation: ORIENTATION_TYPES.HORIZONTAL,
      position: POSITION.BEFORE,
      parentRect: { x: 0, y: 0, width: 1000, height: 800 },
      pairRect: { x: 0, y: 0, width: 500, height: 800 },
      firstRect: { x: 500, y: 0, width: 500, height: 800 },
      initRect: { x: 0, y: 0, width: 500, height: 400 },
      currentRect: { x: 0, y: 0, width: 600, height: 400 },
      pairFirst: true,
    },
    {
      name: "vertical AFTER",
      orientation: ORIENTATION_TYPES.VERTICAL,
      position: POSITION.AFTER,
      parentRect: { x: 0, y: 0, width: 800, height: 1000 },
      pairRect: { x: 0, y: 500, width: 800, height: 500 },
      firstRect: { x: 0, y: 0, width: 800, height: 500 },
      initRect: { x: 0, y: 0, width: 400, height: 500 },
      currentRect: { x: 0, y: 0, width: 400, height: 600 },
      pairFirst: false,
    },
  ])("plans a different-parent $name boundary without mutation", (scenario) => {
    const focusParent = node("focus-parent");
    const focus = node("focus", NODE_TYPES.WINDOW);
    focusParent.appendChild(focus);
    const pairParent = node("pair-parent");
    pairParent.rect = scenario.parentRect;
    const first = node("first", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    first.rect = scenario.firstRect;
    pair.rect = scenario.pairRect;
    first.percent = 0.5;
    pair.percent = 0.5;
    const ordered = scenario.pairFirst ? [pair, first] : [first, pair];
    ordered.forEach((candidate) => pairParent.appendChild(candidate));

    const plan = planPercentResize({
      focusNode: focus,
      resizePair: pair,
      initRect: scenario.initRect as RectLike,
      currentRect: scenario.currentRect as RectLike,
      orientation: scenario.orientation,
      position: scenario.position,
      tiledChildCount: (candidate) => candidate.childNodes.length,
    });

    expect(plan).toMatchObject({
      firstNode: first,
      secondNode: pair,
      firstPercent: 0.6,
      secondPercent: 0.4,
    });
    expect([first.percent, pair.percent]).toEqual([0.5, 0.5]);
  });

  it("rejects invalid parent geometry instead of applying zero shares", () => {
    const parent = node("parent");
    parent.rect = { x: 0, y: 0, width: 0, height: 800 };
    const focus = node("focus", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    focus.rect = { x: 0, y: 0, width: 500, height: 800 };
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    parent.appendChild(focus);
    parent.appendChild(pair);

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: focus.rect,
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: (candidate) => candidate.childNodes.length,
      })
    ).toBeNull();
  });

  it.each(["resize pair", "initial rect", "orientation", "position"] as const)(
    "rejects a missing or invalid %s",
    (invalidField) => {
      const parent = node("parent");
      parent.rect = { x: 0, y: 0, width: 1000, height: 800 };
      const focus = node("focus", NODE_TYPES.WINDOW);
      const pair = node("pair", NODE_TYPES.WINDOW);
      focus.rect = { x: 0, y: 0, width: 500, height: 800 };
      pair.rect = { x: 500, y: 0, width: 500, height: 800 };
      parent.appendChild(focus);
      parent.appendChild(pair);
      const args: Parameters<typeof planPercentResize>[0] = {
        focusNode: focus,
        resizePair: pair,
        initRect: focus.rect,
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: (candidate) => candidate.childNodes.length,
      };

      if (invalidField === "resize pair") args.resizePair = null;
      if (invalidField === "initial rect") args.initRect = null;
      if (invalidField === "orientation") args.orientation = ORIENTATION_TYPES.NONE;
      if (invalidField === "position") args.position = POSITION.UNKNOWN;

      expect(planPercentResize(args)).toBeNull();
    }
  );

  it.each(["pair", "parent"] as const)("rejects a missing %s rectangle", (missingRect) => {
    const parent = node("parent");
    parent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const focus = node("focus", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    focus.rect = { x: 0, y: 0, width: 500, height: 800 };
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    parent.appendChild(focus);
    parent.appendChild(pair);
    if (missingRect === "pair") pair.rect = null;
    if (missingRect === "parent") parent.rect = null;

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: focus.rect,
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: (candidate) => candidate.childNodes.length,
      })
    ).toBeNull();
  });

  it("rejects a resize pair whose parent does not contain it", () => {
    const focusParent = node("focus-parent");
    const focus = node("focus", NODE_TYPES.WINDOW);
    focusParent.appendChild(focus);
    const pairParent = node("pair-parent");
    pairParent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const pair = node("pair", NODE_TYPES.WINDOW);
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    pair.parentNode = pairParent;

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: { x: 0, y: 0, width: 500, height: 800 },
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: () => 2,
      })
    ).toBeNull();
  });

  it.each([
    { position: POSITION.AFTER, pairFirst: true },
    { position: POSITION.BEFORE, pairFirst: false },
  ])("rejects an out-of-range $position opposite sibling", ({ position, pairFirst }) => {
    const focusParent = node("focus-parent");
    const focus = node("focus", NODE_TYPES.WINDOW);
    focusParent.appendChild(focus);
    const pairParent = node("pair-parent");
    pairParent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const pair = node("pair", NODE_TYPES.WINDOW);
    const sibling = node("sibling", NODE_TYPES.WINDOW);
    pair.rect = { x: 0, y: 0, width: 500, height: 800 };
    sibling.rect = { x: 500, y: 0, width: 500, height: 800 };
    (pairFirst ? [pair, sibling] : [sibling, pair]).forEach((candidate) =>
      pairParent.appendChild(candidate)
    );

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: { x: 0, y: 0, width: 500, height: 800 },
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position,
        tiledChildCount: (candidate) => candidate.childNodes.length,
      })
    ).toBeNull();
  });

  it("rejects a boundary whose opposite sibling has no rectangle", () => {
    const focusParent = node("focus-parent");
    const focus = node("focus", NODE_TYPES.WINDOW);
    focusParent.appendChild(focus);
    const pairParent = node("pair-parent");
    pairParent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const first = node("first", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    pairParent.appendChild(first);
    pairParent.appendChild(pair);

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: { x: 0, y: 0, width: 500, height: 800 },
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: (candidate) => candidate.childNodes.length,
      })
    ).toBeNull();
  });

  it("rejects a same-parent resize with fewer than two tiled children", () => {
    const parent = node("parent");
    parent.rect = { x: 0, y: 0, width: 1000, height: 800 };
    const focus = node("focus", NODE_TYPES.WINDOW);
    const pair = node("pair", NODE_TYPES.WINDOW);
    focus.rect = { x: 0, y: 0, width: 500, height: 800 };
    pair.rect = { x: 500, y: 0, width: 500, height: 800 };
    parent.appendChild(focus);
    parent.appendChild(pair);

    expect(
      planPercentResize({
        focusNode: focus,
        resizePair: pair,
        initRect: focus.rect,
        currentRect: { x: 0, y: 0, width: 600, height: 800 },
        orientation: ORIENTATION_TYPES.HORIZONTAL,
        position: POSITION.AFTER,
        tiledChildCount: () => 1,
      })
    ).toBeNull();
  });
});

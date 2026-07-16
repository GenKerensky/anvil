/* Pure Grab-Resize pair selection and percent planning. */

import Meta from "gi://Meta";

import { ORIENTATION_TYPES, POSITION, type Node, type RectLike } from "./tree.js";

export function percentsFromSizeDelta(args: {
  firstSize: number;
  secondSize: number;
  parentSize: number;
  changePx: number;
}): { firstPercent: number; secondPercent: number } | null {
  const { firstSize, secondSize, parentSize, changePx } = args;
  if (parentSize <= 0) return null;
  return {
    firstPercent: (firstSize + changePx) / parentSize,
    secondPercent: (secondSize - changePx) / parentSize,
  };
}

export function findEligibleResizePair(args: {
  focusNode: Node;
  direction: Meta.MotionDirection;
  nextVisible: (node: Node, direction: Meta.MotionDirection) => Node | null;
  isEligible: (node: Node) => boolean;
  isBoundary?: (node: Node) => boolean;
}): Node | null {
  const { focusNode, direction, nextVisible, isEligible, isBoundary = () => false } = args;
  const visited = new Set<Node>([focusNode]);
  let cursor = focusNode;

  while (true) {
    const candidate = nextVisible(cursor, direction);
    if (!candidate || visited.has(candidate)) return null;
    if (isBoundary(candidate)) return null;
    if (isEligible(candidate)) return candidate;
    visited.add(candidate);
    cursor = candidate;
  }
}

export type PercentResizePlan = {
  firstNode: Node;
  secondNode: Node;
  firstPercent: number;
  secondPercent: number;
};

export function planPercentResize(args: {
  focusNode: Node;
  resizePair: Node | null;
  initRect: RectLike | null;
  currentRect: RectLike;
  orientation: string | undefined;
  position: string | undefined;
  tiledChildCount: (node: Node) => number;
}): PercentResizePlan | null {
  const { focusNode, resizePair, initRect, currentRect, orientation, position, tiledChildCount } =
    args;
  if (!resizePair || !initRect) return null;

  let firstNode = focusNode;
  const sameParent = resizePair.parentNode === focusNode.parentNode;
  if (sameParent) {
    if (!focusNode.parentNode || tiledChildCount(focusNode.parentNode) <= 1) return null;
  } else {
    const pairParent = resizePair.parentNode;
    if (!pairParent || tiledChildCount(pairParent) <= 1) return null;
    const offset = position === POSITION.BEFORE ? 1 : -1;
    if (resizePair.index === null) return null;
    const index = resizePair.index + offset;
    if (index < 0 || index >= pairParent.childNodes.length) return null;
    firstNode = pairParent.childNodes[index];
  }

  const firstRect = sameParent ? initRect : firstNode.rect;
  const secondRect = resizePair.rect;
  const parentRect = firstNode.parentNode?.rect;
  if (!firstRect || !secondRect || !parentRect) return null;

  const horizontal = orientation === ORIENTATION_TYPES.HORIZONTAL;
  const vertical = orientation === ORIENTATION_TYPES.VERTICAL;
  if (!horizontal && !vertical) return null;
  const firstSize = horizontal ? firstRect.width : firstRect.height;
  const secondSize = horizontal ? secondRect.width : secondRect.height;
  const parentSize = horizontal ? parentRect.width : parentRect.height;
  const currentSize = horizontal ? currentRect.width : currentRect.height;
  const initialWindowSize = horizontal ? initRect.width : initRect.height;
  const percents = percentsFromSizeDelta({
    firstSize,
    secondSize,
    parentSize,
    changePx: currentSize - initialWindowSize,
  });
  if (!percents) return null;

  return { firstNode, secondNode: resizePair, ...percents };
}

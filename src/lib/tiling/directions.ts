import type { Direction } from "./contracts.js";

export type DirectionAxis = "horizontal" | "vertical";

const directions: readonly Direction[] = ["left", "right", "up", "down"];

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && directions.includes(value as Direction);
}

export function compareDirections(left: Direction, right: Direction): number {
  return directions.indexOf(left) - directions.indexOf(right);
}

export function axisForDirection(direction: Direction): DirectionAxis {
  return direction === "left" || direction === "right" ? "horizontal" : "vertical";
}

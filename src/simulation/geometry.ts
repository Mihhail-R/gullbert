import type { Point } from "./model.js";

export const SIZE = 96;
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function beakOffsetX(facing: number): number {
  if (facing === 1) {
    return 78;
  }
  return 18;
}

/** Includes the screen edges; pointer routines may follow a sample at the boundary. */
export function isPointOnScreen(
  point: Readonly<Point>,
  width: number,
  height: number,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return false;
  }
  if (point.x < 0 || point.x > width) {
    return false;
  }
  return point.y >= 0 && point.y <= height;
}

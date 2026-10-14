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

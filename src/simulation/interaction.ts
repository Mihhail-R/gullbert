import type { SimulationView } from "./capabilities.js";
import { directCleanupObjects } from "./behaviors/cleanup.js";
import { canPickup, pickupRect } from "./behaviors/pickup.js";
import type { HitRect } from "./behaviors/touch.js";

const CLEANUP_HIT_PADDING = 8;

/** Shared by DOM hit regions and native capture. Keep geometry and order identical. */
export function interactionRects(
  sim: Pick<
    SimulationView,
    | "visible"
    | "scene"
    | "time"
    | "bag"
    | "splats"
    | "rubbish"
    | "cones"
    | "looseChips"
    | "crumb"
    | "flight"
    | "goal"
    | "mode"
    | "pickup"
    | "settings"
    | "tidying"
    | "facing"
    | "x"
    | "y"
    | "cleanup"
    | "width"
    | "height"
  >,
  interactive = true,
): HitRect[] {
  if (!interactive || !sim.visible) {
    return [];
  }
  const rects: HitRect[] = [];
  for (const object of directCleanupObjects(sim)) {
    rects.push({
      x: object.x - CLEANUP_HIT_PADDING,
      y: object.y - CLEANUP_HIT_PADDING,
      width: object.width + CLEANUP_HIT_PADDING * 2,
      height: object.height + CLEANUP_HIT_PADDING * 2,
    });
  }
  if (canPickup(sim)) {
    rects.push(pickupRect(sim));
  }
  return rects;
}

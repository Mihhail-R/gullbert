import type { SimulationView } from "./capabilities.js";
import {
  CLEANUP_HIT_PADDING,
  directCleanupObjects,
} from "./behaviors/cleanup.js";
import { canPickup, pickupRect } from "./behaviors/pickup.js";
import type { HitRect } from "./behaviors/touch.js";
import type { CapScene } from "./scenes.js";
import type { ReadonlyValue } from "./presentation.js";

/** The cap is playable only while resting; use this for clicks and capture. */
export function capHitRect(
  scene: ReadonlyValue<CapScene> | null,
): HitRect | null {
  if (scene?.phase !== "ready") {
    return null;
  }

  return {
    x: scene.cap.x - 24,
    y: scene.cap.y - 24,
    width: 48,
    height: 48,
  };
}

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
    | "mode"
    | "tidying"
    | "x"
    | "y"
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

  if (sim.scene?.kind === "cap") {
    const cap = capHitRect(sim.scene);

    if (cap) {
      rects.push(cap);
    }
  }

  return rects;
}

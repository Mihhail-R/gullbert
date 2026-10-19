import type { SimulationView } from "../capabilities.js";
import { beakOffsetX, clamp } from "../geometry.js";
import type { Point } from "../model.js";

export function theatreBeak(sim: Pick<SimulationView, "x" | "facing" | "y">) {
  return {
    x: sim.x + beakOffsetX(sim.facing),
    y: sim.y + 42,
  };
}
export function theatrePointOnScreen(
  sim: Pick<SimulationView, "width" | "height">,
  point: Point,
  margin = 16,
) {
  return {
    x: clamp(point.x, margin, sim.width - margin),
    y: clamp(point.y, margin, sim.height - margin),
  };
}

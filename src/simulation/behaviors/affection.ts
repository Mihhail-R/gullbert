import type { SimulationView } from "../capabilities.js";

/** Small cosmetic movements share visible simulation time with the meal/touch. */
export function affectionMotion(sim: SimulationView) {
  let remaining = Infinity;

  if (sim.mode === "eat" && !sim.scene) {
    remaining = sim.until - sim.time;
  } else if (
    (sim.scene?.kind === "snack" || sim.scene?.kind === "toss") &&
    sim.scene.phase === "eat"
  ) {
    remaining = sim.scene.until - sim.time;
  }

  if (remaining >= 0 && remaining <= 0.65) {
    const elapsed = 0.65 - remaining;
    let y = 0;

    if (elapsed < 0.1 || (elapsed > 0.48 && elapsed < 0.58)) {
      y = 3;
    } else if (elapsed < 0.48) {
      y = -Math.round(Math.sin(((elapsed - 0.1) / 0.38) * Math.PI) * 4) * 3;
    }

    return { kind: "hop", x: 0, y, fluff: false };
  }

  if (sim.touch.reaction === "pet") {
    const beat = Math.floor((sim.time - sim.touch.since) * 6) % 4;
    let direction = sim.facing;

    if (sim.touch.point && sim.touch.point.x < sim.x + 48) {
      direction = -1;
    } else if (sim.touch.point) {
      direction = 1;
    }

    let y = 0;

    if (beat < 2) {
      y = 3;
    }

    return { kind: "scratch", x: direction * 3, y, fluff: beat < 2 };
  }

  return { kind: "", x: 0, y: 0, fluff: false };
}

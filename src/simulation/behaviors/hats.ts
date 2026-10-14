import type { Hat, Settings } from "../model.js";
import type { SimulationView } from "../capabilities.js";
/** Hats are presentation only: selection never owns or interrupts a scene. */
export function normalizeHat(value: unknown): Hat {
  if (value === "captain" || value === "cone") {
    return value;
  } else {
    return "none";
  }
}

export function hatPosture(sim: Pick<SimulationView, "settings">) {
  return normalizeHat(sim.settings?.hat);
}

/** Local CSS pixels inside SimulationView's 96px square, independent of world x/y.
 * The renderer positions a sibling overlay and mirrors that image using flip.
 * Keep rotations at zero so every hat retains the established 3px pixel grid.
 */
export function hatPlacement(
  sim: Pick<SimulationView, "pose" | "scene" | "bag" | "facing" | "settings">,
) {
  const hat = hatPosture(sim);
  if (hat === "none") {
    return null;
  }
  const pose = sim.pose ?? "idle";
  const scene = sim.scene;
  if (
    sim.bag?.attached ||
    (scene?.kind === "gift" && scene.carrying) ||
    scene?.kind === "baguette" ||
    ["bag-trapped", "bag-panic", "bag-shake", "theft-grip"].includes(pose) ||
    pose.startsWith("bath-") ||
    (scene?.kind === "bath" && ["splash", "shake"].includes(scene.phase))
  ) {
    return null;
  }

  let x = 24;
  let y;
  if (hat === "cone") {
    y = -9;
  } else {
    y = -6;
  }
  if (pose === "walkLeft") {
    y -= 3;
  }
  if (pose === "crouch" || pose === "nibble") {
    y += 3;
  }
  if (pose === "nap-wobble") {
    x -= 3;
  }
  const flip = sim.facing < 0;
  if (flip) {
    x = 96 - x - 48;
  }
  return { asset: hat, x, y, width: 48, height: 36, flip, rotation: 0 };
}

/** A one-shot remark for the caller to use when the chosen hat changes. */
export function hatRemark(sim: {
  readonly settings: Readonly<Settings>;
  readonly random: () => number;
}) {
  const hat = hatPosture(sim);
  if (hat === "none") {
    return null;
  }
  const lines = {
    captain: [
      "captain. obviously.",
      "all chips aboard.",
      "port side is also mine.",
    ],
    cone: [
      "safety has arrived.",
      "unauthorised feet detected.",
      "diverting traffic. towards chips.",
    ],
  }[hat];
  if (!lines) {
    return null;
  }
  return lines[Math.floor((sim.random?.() ?? 0) * lines.length) % lines.length];
}

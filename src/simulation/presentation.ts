import type { SimulationView } from "./capabilities.js";
import type { RoutinePresentation } from "./routine.js";
import type { Point } from "./model.js";
import { interactionRects } from "./interaction.js";
import {
  cleanupObjects,
  cleanupTarget,
  directCleanupTarget,
} from "./behaviors/cleanup.js";
import { affectionMotion } from "./behaviors/affection.js";
import { POSES } from "./poses.js";
import { hatPlacement, hatPosture } from "./behaviors/hats.js";

export type ReadonlyValue<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyValue<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyValue<T[Key]> }
    : T;

/** A detached value: rendering cannot advance routines or alter simulation state. */
export type PetPresentation = ReadonlyValue<
  ReturnType<typeof projectPresentation>
>;

/** Internal projection; the runtime supplies its owned state at this seam. */
export function projectPresentation(
  sim: SimulationView,
  pointer: Point | null = null,
  interactive = true,
  routine: RoutinePresentation = {},
) {
  let highlight = null;
  if (pointer && (interactive || sim.tidying)) {
    if (sim.tidying) {
      highlight = cleanupTarget(sim, pointer);
    } else {
      highlight = directCleanupTarget(sim, pointer);
    }
  }
  const affection = affectionMotion(sim);
  let pose = sim.pose;
  let frame = sim.frame;
  if (affection.kind === "hop") {
    pose = "blink";
    if (affection.y > 0) {
      pose = "crouch";
    } else if (affection.y < 0) {
      pose = "wingUp";
    }
    frame = POSES[pose];
  }
  const view = {
    affection,
    rotation: routine.rotation ?? 0,
    width: sim.width,
    height: sim.height,
    time: sim.time,
    x: sim.x,
    y: sim.y,
    facing: sim.facing,
    mode: sim.mode,
    pose,
    frame,
    bubble: sim.bubble,
    hat: hatPosture(sim),
    perch: sim.memory.perch,
    carriedItem: sim.carriedItem,
    gullHidden: sim.scene?.kind === "gift" && sim.scene.phase === "away",
    mood: sim.mood?.name ?? "",
    visualOffset: {
      x: routine.offset?.x ?? 0,
      opacity: routine.offset?.opacity ?? 1,
    },
    crumb: sim.crumb,
    bag: sim.bag,
    bagHidden:
      !sim.bag ||
      (sim.scene?.kind === "caper" &&
        ["trapped", "panic", "shake"].includes(sim.scene.phase)),
    pickupCount: sim.pickup.recent.length,
    carryingRubbish:
      sim.scene?.kind === "relocation" && sim.scene.phase === "return",
    phase: sim.scene?.phase ?? "",
    rubbish: sim.rubbish,
    looseChips: sim.looseChips,
    cleanupObjects: cleanupObjects(sim),
    highlight,
    touchReaction: sim.touch.reaction,
    tidying: sim.tidying,
    splats: sim.splats,
    hitRegions: interactionRects(sim, interactive),
    props: routine.props ?? [],
    guestSpeech: routine.guestSpeech ?? null,
    hatPlacement: hatPlacement({ ...sim, pose }),
  };
  return structuredClone(view);
}

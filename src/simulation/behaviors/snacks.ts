import { dialogue } from "../dialogue.js";
import { observe } from "../observation.js";
import type { ReadonlyValue } from "../presentation.js";
import { scopeCapabilities } from "../capabilities.js";
import { beakOffsetX } from "../geometry.js";
import type { Pose } from "../poses.js";
import type { Point } from "../model.js";
import type { SimulationView, BehaviorCapabilities } from "../capabilities.js";
import type { SceneOwner } from "../routine.js";
import type { Scene, SnackScene as OwnedScene } from "../scenes.js";

export function bagGoal(sim: Pick<BehaviorCapabilities, "body" | "objects">) {
  const bag = sim.objects.snapshot().bag;
  if (!bag) {
    return { x: sim.body.x, y: sim.body.y, facing: sim.body.facing };
  }
  let facing = -1;
  if (bag.x + 24 >= sim.body.x + 48) {
    facing = 1;
  }
  sim.body.face(facing);
  return {
    ...sim.body.safePoint({
      x: bag.x + 24 - beakOffsetX(facing),
      y: bag.y + 24 - 48,
    }),
    facing,
  };
}

export function snackPose(
  sim: Pick<SimulationView, "scene" | "time" | "motionTime">,
): Pose | null {
  if (sim.scene?.kind !== "snack") {
    return null;
  }
  if (sim.scene.phase === "eat") {
    if (Math.floor(sim.time * 6) % 2) {
      return "bag-inspect";
    } else {
      return "idle";
    }
  }
  if (sim.scene.phase === "disappointed") {
    return "bag-offended";
  }
  return (["idle", "walkLeft", "idle", "walkRight"] as const)[
    Math.floor(sim.motionTime * 12) % 4
  ];
}

type Environment = Pick<
  BehaviorCapabilities,
  | "objects"
  | "body"
  | "food"
  | "clock"
  | "destinations"
  | "activity"
  | "speech"
  | "lifecycle"
  | "events"
  | "moods"
>;
export class SnackRoutine implements SceneOwner {
  #environment: Environment;
  #scene: OwnedScene | null = null;
  #identity: object = Object.freeze({});

  constructor(environment: Environment) {
    this.#environment = scopeCapabilities(environment, [
      "objects",
      "body",
      "food",
      "clock",
      "destinations",
      "activity",
      "speech",
      "lifecycle",
      "events",
      "moods",
    ]);
  }
  get scene(): ReadonlyValue<OwnedScene> | null {
    return observe(this.#scene);
  }

  get identity(): object {
    return this.#identity;
  }
  install(scene: ReadonlyValue<Scene>): void {
    this.#scene = structuredClone(scene) as OwnedScene;
    this.#identity = Object.freeze({});
  }
  clear(): void {
    this.#scene = null;
  }
  start(name: string, point?: Point): boolean {
    const handled = this.#startSnack(name, point);
    if (handled && this.#scene) {
      this.#identity = Object.freeze({});
    }
    return handled;
  }
  update(dt: number): "running" | "complete" {
    this.#stepSnack(dt);
    if (!this.#scene) {
      return "complete";
    }
    return "running";
  }
  complete(): void {
    this.#scene = null;
  }
  presentation() {
    const sim = this.#environment;
    return {
      pose:
        snackPose({
          ...sim.body.snapshot(),
          ...sim.activity.snapshot(),
          time: sim.clock.now,
          scene: this.#scene,
        }) ?? undefined,
    };
  }
  interrupt(): void {
    this.#scene = null;
  }
  visibility(): void {}

  #startSnack(name: string, point?: Point) {
    const sim = this.#environment;
    if (name === "place_bag") {
      sim.objects.placeBag({
        x: (point?.x ?? sim.body.width / 2) - 24,
        y: (point?.y ?? sim.body.height / 2) - 24,
      });
      sim.food.clearRequest();
      this.#beginBagMeal();
      return true;
    }
    if (name !== "search_snack") {
      return false;
    }
    sim.food.search();
    if ((sim.objects.snapshot().bag?.servings ?? 0) > 0) {
      this.#beginBagMeal();
    } else {
      this.#scene = {
        kind: "snack",
        phase: "search",
        started: sim.clock.now,
        until: sim.clock.now + 3,
        target: sim.destinations.randomPoint(),
      };
      sim.activity.beginRoutine("snack");
      sim.speech.say(dialogue.gullbert.snacks.surelyThereAreChips, 2.5);
    }
    return true;
  }
  #beginBagMeal() {
    const sim = this.#environment;
    const bag = sim.objects.snapshot().bag;
    if (!bag) {
      return;
    }
    this.#scene = {
      kind: "snack",
      phase: "approach",
      target: { x: sim.body.x, y: sim.body.y },
      bagId: bag.id,
      started: sim.clock.now,
      until: sim.clock.now + 18,
    };
    sim.activity.beginRoutine("snack");
    sim.speech.say(dialogue.gullbert.snacks.chipsPlural, 2);
    sim.food.found();
  }
  #stepSnack(dt: number) {
    const sim = this.#environment;
    const scene = this.#scene;
    if (scene?.kind !== "snack") {
      return false;
    }
    if (scene.bagId != null && scene.bagId !== sim.objects.snapshot().bag?.id) {
      sim.lifecycle.complete();
      sim.lifecycle.rest();
      return true;
    }
    const bag = sim.objects.snapshot().bag;
    if (scene.phase === "approach" && bag) {
      if (sim.body.moveToward(bagGoal(sim), 180, dt)) {
        scene.phase = "eat";
        scene.until = sim.clock.now + 2.05;
        sim.objects.consumeBag(bag.id);
        sim.food.clearRequest();
        sim.events.emit("munch");
        sim.moods.set("snack-minded", sim.clock.now);
      } else if (sim.clock.now >= scene.until) {
        sim.lifecycle.complete();
        sim.lifecycle.rest();
      }
    } else if (scene.phase === "search") {
      sim.body.moveToward(scene.target, 75, dt);
      if (sim.clock.now >= scene.until) {
        scene.phase = "disappointed";
        scene.until = sim.clock.now + 2;
        sim.food.failed(sim.clock.now);
        sim.moods.set("snack-minded", sim.clock.now, { speak: false });
        if (sim.objects.snapshot().bag) {
          sim.speech.say(dialogue.gullbert.snacks.aBagOfBetrayal, 2.5);
        } else {
          sim.speech.say(dialogue.gullbert.snacks.noChipsScandalous, 2.5);
        }
      }
    } else if (sim.clock.now >= scene.until) {
      sim.lifecycle.complete();
      sim.lifecycle.rest(3);
      sim.food.afterBagActivity(sim.clock.now);
    }
    return true;
  }
}
export function attachBag(sim: Pick<BehaviorCapabilities, "body" | "objects">) {
  sim.objects.carryBag({
    x: sim.body.x + beakOffsetX(sim.body.facing) - 24,
    y: sim.body.y + 24,
  });
}
